import { describe, expect, it } from "vitest";
import { eventSummary, refusalRule } from "./events";

describe("events", () => {
  it("summarises refused tool calls and exposes the rule", () => {
    const e = { type: "tool.refused", payload: { tool: "call.place", rule: "no-night-calls", reason: "Fuera de horario" } } as never;
    expect(eventSummary(e)).toBe("call.place: Fuera de horario");
    expect(refusalRule(e)).toBe("no-night-calls");
  });
  it("returns null rule for other events", () => {
    expect(refusalRule({ type: "agent.message", payload: { text: "hola" } } as never)).toBeNull();
  });
});
