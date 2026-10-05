import type { EventDto } from "./api";

/** One-line human description of an event payload. Payload shapes come from EventPayloads in @ofd/core. */
export function eventSummary(e: Pick<EventDto, "type" | "payload">): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  switch (e.type) {
    case "customer.message":
    case "agent.message":
      return s("text");
    case "tool.requested":
    case "tool.permitted":
    case "tool.completed":
    case "tool.failed":
      return s("tool") + (s("error") ? `: ${s("error")}` : "");
    case "tool.refused":
      return `${s("tool")}: ${s("reason")}`;
    case "conversation.started":
      return `${s("channel")} ${s("direction")}`;
    case "conversation.ended":
      return s("summary") || s("outcome");
    case "fact.extracted":
      return `${s("key")} = ${s("value")}`;
    case "guard.input_flagged":
    case "guard.output_blocked":
    case "transfer.requested":
      return s("reason");
    case "mission.planned":
    case "mission.approved":
    case "mission.completed": {
      const r = p.report as Record<string, number> | undefined;
      return r ? `${r.total ?? 0} total · ${r.succeeded ?? 0} ok · ${r.failed ?? 0} ✕` : "";
    }
    default:
      return Object.keys(p).length ? JSON.stringify(p) : "";
  }
}

export function refusalRule(e: Pick<EventDto, "type" | "payload">): string | null {
  if (e.type !== "tool.refused") return null;
  const rule = (e.payload as { rule?: unknown }).rule;
  return typeof rule === "string" ? rule : null;
}
