import type { LanguageModel } from "@ofd/agent";

// Copied from packages/agent/src/test-helpers.ts (excluded from that package's build).
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
        content:
          "text" in s
            ? [{ type: "text", text: s.text }]
            : [
                {
                  type: "tool-call",
                  toolCallId: `call-${i}`,
                  toolName: s.tool,
                  input: JSON.stringify(s.input),
                },
              ],
        finishReason: "text" in s ? "stop" : "tool-calls",
        usage,
        warnings: [],
      };
    },
    async doStream(options: { prompt: unknown }) {
      prompts.push(options.prompt);
      const s = next();
      const parts: unknown[] = [
        { type: "stream-start", warnings: [] },
        { type: "response-metadata", id: `r${i}`, modelId: "mock", timestamp: new Date() },
      ];
      if ("text" in s) {
        parts.push(
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: s.text },
          { type: "text-end", id: "t" },
        );
      } else {
        parts.push({
          type: "tool-call",
          toolCallId: `call-${i}`,
          toolName: s.tool,
          input: JSON.stringify(s.input),
        });
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
