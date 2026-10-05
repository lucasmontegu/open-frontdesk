import type { ConversationRepository, EventStore, JobQueue } from "@ofd/core";
import type { PreparedCall } from "./call.js";

/** Records the customer's and the agent's words of one turn in the event log. */
export async function recordTurn(
  events: EventStore,
  call: Pick<PreparedCall, "orgId" | "conversationId" | "contactId" | "version">,
  turn: { customer: string[]; agent: string },
): Promise<void> {
  const base = {
    orgId: call.orgId,
    conversationId: call.conversationId,
    botVersionId: call.version.id,
    contactId: call.contactId,
    traceId: null,
  };
  for (const text of turn.customer) {
    if (text.trim())
      await events.append({
        ...base,
        type: "customer.message",
        payload: { text },
        actorKind: "customer",
        actorId: call.contactId,
      });
  }
  if (turn.agent.trim())
    await events.append({
      ...base,
      type: "agent.message",
      payload: { text: turn.agent },
      actorKind: "bot",
      actorId: call.version.botId,
    });
}

/** Closes the conversation and queues fact extraction. Never throws: it runs during shutdown. */
export async function finishCall(
  deps: {
    conversations: ConversationRepository;
    events: EventStore;
    jobs: JobQueue;
    log?: { warn(o: object, m?: string): void };
  },
  call: Pick<PreparedCall, "orgId" | "conversationId" | "contactId" | "version">,
  outcome = "completed",
): Promise<void> {
  try {
    await deps.conversations.end(call.orgId, call.conversationId, outcome);
    await deps.events.append({
      orgId: call.orgId,
      type: "conversation.ended",
      payload: { outcome },
      conversationId: call.conversationId,
      botVersionId: call.version.id,
      contactId: call.contactId,
      actorKind: "system",
      actorId: "voice-worker",
      traceId: null,
    });
    await deps.jobs.enqueue(
      "conversation.extract_facts",
      { orgId: call.orgId, conversationId: call.conversationId },
      { singletonKey: `facts:${call.conversationId}` },
    );
  } catch (err) {
    deps.log?.warn(
      {
        conversationId: call.conversationId,
        err: err instanceof Error ? err.message : String(err),
      },
      "finishing the call failed",
    );
  }
}
