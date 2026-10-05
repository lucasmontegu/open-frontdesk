import type { InteractionEvent, ToolEffect } from "@ofd/core";
import type { Assertion } from "@ofd/packs";
import { OUTCOME_TOOLS } from "./probes.js";

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const toolOf = (e: InteractionEvent): string | null => {
  const p = e.payload as { tool?: unknown };
  return typeof p.tool === "string" ? p.tool : null;
};

/**
 * "Called" means the gateway permitted the call (so it ran, even if the handler then failed).
 * A refused call is not a call: `tool_not_called` holds when policy stopped it.
 */
export const toolWasCalled = (events: InteractionEvent[], tool: string) =>
  events.some((e) => e.type === "tool.permitted" && toolOf(e) === tool);

function completed(events: InteractionEvent[], tool: string): InteractionEvent | undefined {
  return events.find((e) => e.type === "tool.completed" && toolOf(e) === tool);
}

/** Outcomes derived from the event log. Returns null for an outcome name that does not exist. */
function outcomeReached(
  outcome: string,
  events: InteractionEvent[],
  effects: Map<string, ToolEffect>,
): boolean | null {
  if (outcome === "transferred")
    return (
      events.some((e) => e.type === "transfer.requested") ||
      completed(events, "transfer_to_human") !== undefined
    );
  if (outcome === "not_contacted") {
    return !events.some(
      (e) => e.type === "tool.permitted" && effects.get(toolOf(e) ?? "") === "contact",
    );
  }
  if (outcome === "opted_out") {
    const out = completed(events, "update_lead_stage")?.payload as
      | { output?: { stage?: string } }
      | undefined;
    return out?.output?.stage === "lost" || out?.output?.stage === "unqualified";
  }
  const tool = OUTCOME_TOOLS[outcome];
  return tool ? completed(events, tool) !== undefined : null;
}

export function isKnownOutcome(outcome: string): boolean {
  return outcome === "not_contacted" || outcome in OUTCOME_TOOLS;
}

/** Level 2: decides one assertion over the recorded event log. Returns a failure reason, or null when it holds. */
export function checkAssertionOverEvents(
  a: Assertion,
  events: InteractionEvent[],
  effects: Map<string, ToolEffect>,
): string | null {
  switch (a.type) {
    case "tool_called":
      return toolWasCalled(events, a.value) ? null : `"${a.value}" nunca se ejecutó`;
    case "tool_not_called":
      return toolWasCalled(events, a.value) ? `"${a.value}" se ejecutó y no debía` : null;
    case "event_present":
      return events.some((e) => e.type === a.value) ? null : `no hay ningún evento "${a.value}"`;
    case "event_absent":
      return events.some((e) => e.type === a.value)
        ? `hay un evento "${a.value}" y no debía`
        : null;
    case "agent_says_not": {
      const needle = normalize(a.value);
      const hit = events.find(
        (e) =>
          e.type === "agent.message" &&
          normalize((e.payload as { text: string }).text).includes(needle),
      );
      return hit ? `el agente dijo "${a.value}"` : null;
    }
    case "outcome": {
      const reached = outcomeReached(a.value, events, effects);
      if (reached === null) return `resultado desconocido "${a.value}"`;
      return reached ? null : `no se llegó al resultado "${a.value}"`;
    }
  }
}
