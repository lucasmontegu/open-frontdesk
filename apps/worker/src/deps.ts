import type { Clock, EventPayloads, EventStore, EventType, InteractionEvent } from "@ofd/core";

/** The slice of a logger the handlers use. pino satisfies it. */
export interface Log {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export const silentLog: Log = { info() {}, warn() {}, error() {} };

export const systemClock: Clock = { now: () => new Date() };

/** Appends an event written by the worker itself (no human or bot actor). */
export function appendSystemEvent<T extends EventType>(
  events: EventStore,
  input: {
    orgId: string;
    type: T;
    payload: EventPayloads[T];
    conversationId?: string | null;
    botVersionId?: string | null;
    contactId?: string | null;
    actorId?: string;
  },
): Promise<InteractionEvent<T>> {
  return events.append({
    orgId: input.orgId,
    type: input.type,
    payload: input.payload,
    conversationId: input.conversationId ?? null,
    botVersionId: input.botVersionId ?? null,
    contactId: input.contactId ?? null,
    actorKind: "system",
    actorId: input.actorId ?? "worker",
    traceId: null,
  });
}

/** Thrown for jobs that can never succeed (bad payload, missing record): pg-boss retries would be noise. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}
