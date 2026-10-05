import type { EventType, MissionPlan, MissionReport, MissionStatus } from "@ofd/core";
import { bigserial, index, jsonb, pgTable, text, timestamp, vector } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    channel: text("channel").notNull(),
    direction: text("direction").$type<"inbound" | "outbound">().notNull(),
    contactId: text("contact_id"),
    botVersionId: text("bot_version_id").notNull(),
    missionId: text("mission_id"),
    outcome: text("outcome"),
    summary: text("summary"),
    startedAt: ts("started_at").notNull().defaultNow(),
    endedAt: ts("ended_at"),
  },
  (t) => [index("conversations_org_contact_idx").on(t.orgId, t.contactId, t.startedAt)],
);

/** Append-only: a trigger (see the hand-written migration) rejects UPDATE and DELETE. */
export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    /** Tie-breaker so events with the same timestamp keep insertion order. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    orgId: text("org_id").notNull(),
    type: text("type").$type<EventType>().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    conversationId: text("conversation_id"),
    botVersionId: text("bot_version_id"),
    contactId: text("contact_id"),
    actorKind: text("actor_kind").$type<"user" | "bot" | "system" | "customer">().notNull(),
    actorId: text("actor_id"),
    traceId: text("trace_id"),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
  },
  (t) => [
    index("events_org_conversation_idx").on(t.orgId, t.conversationId, t.occurredAt, t.seq),
    index("events_org_occurred_idx").on(t.orgId, t.occurredAt.desc(), t.seq.desc()),
  ],
);

export const missions = pgTable(
  "missions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    botId: text("bot_id").notNull(),
    createdBy: text("created_by").notNull(),
    instruction: text("instruction").notNull(),
    status: text("status").$type<MissionStatus>().notNull().default("planning"),
    plan: jsonb("plan").$type<MissionPlan>(),
    report: jsonb("report").$type<MissionReport>(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("missions_org_created_idx").on(t.orgId, t.createdAt)],
);

export const knowledgeDocs = pgTable(
  "knowledge_docs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    botId: text("bot_id"),
    title: text("title").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("knowledge_docs_org_idx").on(t.orgId, t.botId)],
);
