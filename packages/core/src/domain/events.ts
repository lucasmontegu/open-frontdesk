import type { Channel } from "./bot.js";

/**
 * Append-only interaction events. The event log is the source for replay, audit,
 * eval assertions, analytics and fact extraction.
 */
export type EventPayloads = {
  "conversation.started": { channel: Channel; contactId: string | null; direction: "inbound" | "outbound"; missionId?: string };
  "conversation.ended": { outcome: string; summary?: string };
  "customer.message": { text: string };
  "agent.message": { text: string };
  "guard.input_flagged": { reason: string };
  "guard.output_blocked": { reason: string; text: string };
  "tool.requested": { tool: string; input: unknown };
  "tool.permitted": { tool: string; rule: string | null };
  "tool.refused": { tool: string; rule: string; reason: string };
  "tool.completed": { tool: string; output: unknown; durationMs: number };
  "tool.failed": { tool: string; error: string };
  "transfer.requested": { reason: string };
  "transfer.completed": { operatorId: string };
  "takeover.started": { userId: string };
  "takeover.ended": { userId: string };
  "fact.extracted": { factId: string; key: string; value: string };
  "mission.planned": { missionId: string; targets: number };
  "mission.approved": { missionId: string; userId: string };
  "mission.completed": { missionId: string; report: MissionReport };
};

export type EventType = keyof EventPayloads;

export interface InteractionEvent<T extends EventType = EventType> {
  id: string;
  orgId: string;
  type: T;
  payload: EventPayloads[T];
  /** Correlation ids. */
  conversationId: string | null;
  botVersionId: string | null;
  contactId: string | null;
  actorKind: "user" | "bot" | "system" | "customer";
  actorId: string | null;
  traceId: string | null;
  occurredAt: Date;
}

export type NewEvent<T extends EventType = EventType> = Omit<InteractionEvent<T>, "id" | "occurredAt"> & {
  occurredAt?: Date;
};

export interface MissionReport {
  total: number;
  succeeded: number;
  noAnswer: number;
  escalated: number;
  failed: number;
}
