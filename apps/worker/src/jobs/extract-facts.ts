import type { ContactFactRepository, EventStore, InteractionEvent } from "@ofd/core";
import { z } from "zod";
import { appendSystemEvent, type Log, PermanentJobError, silentLog } from "../deps.js";
import {
  extractFactsWithRules,
  type ModelFactExtractor,
  type RawFact,
  type TranscriptLine,
} from "../facts.js";

export const ExtractFactsJob = z.object({
  orgId: z.string().min(1),
  conversationId: z.string().min(1),
});

export interface ExtractFactsDeps {
  events: EventStore;
  facts: ContactFactRepository;
  /** Null when no model API key is configured: the deterministic rules run alone. */
  modelExtractor?: ModelFactExtractor | null;
  timezone?: string;
  log?: Log;
}

function toTranscript(events: InteractionEvent[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const e of events) {
    if (e.type !== "customer.message" && e.type !== "agent.message") continue;
    const text = (e.payload as { text: string }).text;
    lines.push({
      index: lines.length,
      eventId: e.id,
      role: e.type === "customer.message" ? "customer" : "agent",
      text,
      at: e.occurredAt,
    });
  }
  return lines;
}

export async function extractFacts(
  deps: ExtractFactsDeps,
  data: unknown,
): Promise<{ stored: number }> {
  const { orgId, conversationId } = ExtractFactsJob.parse(data);
  const log = deps.log ?? silentLog;

  const events = await deps.events.listByConversation(orgId, conversationId);
  if (events.length === 0)
    throw new PermanentJobError(`conversation ${conversationId} has no events`);
  const contactId = events.find((e) => e.contactId)?.contactId ?? null;
  if (!contactId) {
    log.info({ conversationId }, "extract_facts: conversation has no identified contact");
    return { stored: 0 };
  }
  const botVersionId = events.find((e) => e.botVersionId)?.botVersionId ?? null;
  const lines = toTranscript(events);

  let raw: RawFact[] = [];
  if (deps.modelExtractor) {
    try {
      raw = await deps.modelExtractor(lines);
    } catch (err) {
      log.warn(
        { conversationId, err: err instanceof Error ? err.message : String(err) },
        "extract_facts: model failed, using rules",
      );
      raw = extractFactsWithRules(lines, { ...(deps.timezone ? { timezone: deps.timezone } : {}) });
    }
  } else {
    raw = extractFactsWithRules(lines, { ...(deps.timezone ? { timezone: deps.timezone } : {}) });
  }

  const existing = await deps.facts.listByContact(orgId, contactId);
  let stored = 0;
  for (const f of raw) {
    const line = lines[f.lineIndex];
    if (!line || line.role !== "customer") continue;
    // Retried jobs and repeated statements must not duplicate a fact.
    if (existing.some((x) => x.key === f.key && x.value === f.value)) continue;
    const fact = await deps.facts.add(orgId, {
      contactId,
      key: f.key,
      value: f.value,
      confidence: f.confidence,
      sourceEventId: line.eventId,
      sourceConversationId: conversationId,
    });
    existing.push(fact);
    await appendSystemEvent(deps.events, {
      orgId,
      type: "fact.extracted",
      payload: { factId: fact.id, key: fact.key, value: fact.value },
      conversationId,
      botVersionId,
      contactId,
      actorId: "conversation.extract_facts",
    });
    stored++;
  }
  log.info({ conversationId, stored }, "facts extracted");
  return { stored };
}
