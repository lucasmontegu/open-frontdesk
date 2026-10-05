import type { BotVersion, ContactProfile, ToolCallContext, ToolDefinition, ToolGateway, ToolResult } from "@ofd/core";
import { BotConfig } from "@ofd/core";
import type { LanguageModel } from "./agent.js";

export type MockStep = { text: string } | { tool: string; input: unknown };

/** Minimal LanguageModelV2 that replays scripted steps and records every prompt it receives. */
export function mockModel(steps: MockStep[]): LanguageModel & { prompts: unknown[] } {
  let i = 0;
  const prompts: unknown[] = [];
  const next = () => steps[Math.min(i++, steps.length - 1)]!;
  const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
  const model = {
    specificationVersion: "v2" as const,
    provider: "mock",
    modelId: "mock",
    supportedUrls: {},
    prompts,
    async doGenerate(options: { prompt: unknown }) {
      prompts.push(options.prompt);
      const s = next();
      return {
        content: "text" in s ? [{ type: "text", text: s.text }] : [{ type: "tool-call", toolCallId: `call-${i}`, toolName: s.tool, input: JSON.stringify(s.input) }],
        finishReason: "text" in s ? "stop" : "tool-calls",
        usage,
        warnings: [],
      };
    },
    async doStream(options: { prompt: unknown }) {
      prompts.push(options.prompt);
      const s = next();
      const parts: unknown[] = [{ type: "stream-start", warnings: [] }, { type: "response-metadata", id: `r${i}`, modelId: "mock", timestamp: new Date() }];
      if ("text" in s) {
        parts.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: s.text }, { type: "text-end", id: "t" });
      } else {
        parts.push({ type: "tool-call", toolCallId: `call-${i}`, toolName: s.tool, input: JSON.stringify(s.input) });
      }
      parts.push({ type: "finish", finishReason: "text" in s ? "stop" : "tool-calls", usage });
      return {
        stream: new ReadableStream({
          start(c) {
            for (const p of parts) c.enqueue(p);
            c.close();
          },
        }),
      };
    },
  };
  return model as unknown as LanguageModel & { prompts: unknown[] };
}

export class FakeGateway implements ToolGateway {
  calls: Array<{ name: string; input: unknown; ctx: ToolCallContext }> = [];
  constructor(
    private readonly tools: ToolDefinition[],
    private readonly respond: (name: string, input: unknown) => ToolResult = () => ({ ok: true, output: { done: true } }),
  ) {}
  list(names: string[]) {
    return this.tools.filter((t) => names.includes(t.name));
  }
  async call(name: string, input: unknown, ctx: ToolCallContext) {
    this.calls.push({ name, input, ctx });
    return this.respond(name, input);
  }
}

export const baseCtx: Omit<ToolCallContext, "traceId"> = {
  orgId: "org1",
  actor: { kind: "bot", id: "bot1", orgId: "org1" as never, botVersionId: "bv1" },
  conversationId: "conv1",
  contactId: "c1",
  botVersionId: "bv1",
  autonomy: 2,
  initiator: "inbound",
};

export function botVersion(over: Partial<BotConfig> = {}): BotVersion {
  return {
    id: "bv1",
    orgId: "org1",
    botId: "b1",
    version: 1,
    status: "published",
    evalRunId: null,
    createdAt: new Date(),
    config: BotConfig.parse({ name: "Sofi", role: "recepcionista de la clínica", instructions: "Atendé a los pacientes.", tools: ["lookup_contact"], ...over }),
  };
}

export function profile(): ContactProfile {
  const now = new Date("2026-10-01T10:00:00Z");
  return {
    contact: { id: "c1", orgId: "org1", displayName: "Marta Gómez", identities: [], attributes: {}, tags: ["vip"], doNotCall: false, createdAt: now, updatedAt: now },
    obligations: [{ id: "o1", orgId: "org1", contactId: "c1", portfolioId: null, kind: "appointment", stage: "scheduled", amount: null, currency: null, dueAt: new Date("2026-10-06T12:00:00Z"), attributes: {}, createdAt: now, updatedAt: now }],
    facts: [{ id: "f1", orgId: "org1", contactId: "c1", key: "prefiere", value: "turnos a la tarde", confidence: 0.9, sourceEventId: "e1", sourceConversationId: "cv0", createdAt: now }],
    recentSummaries: ["Pidió cambiar el turno de control."],
  };
}
