import type { BotConfig, BotVersionStatus } from "@ofd/core";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const bots = pgTable(
  "bots",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    publishedVersionId: text("published_version_id"),
    createdAt: createdAt(),
  },
  (t) => [index("bots_org_idx").on(t.orgId, t.createdAt)],
);

export const botVersions = pgTable(
  "bot_versions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    config: jsonb("config").$type<BotConfig>().notNull(),
    status: text("status").$type<BotVersionStatus>().notNull().default("draft"),
    evalRunId: text("eval_run_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("bot_versions_bot_version_uq").on(t.orgId, t.botId, t.version)],
);

export const policies = pgTable(
  "policies",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ruleId: text("rule_id").notNull(),
    effect: text("effect").$type<"allow" | "deny">().notNull(),
    description: text("description").notNull().default(""),
    whenExpr: text("when_expr").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("policies_org_rule_uq").on(t.orgId, t.ruleId)],
);

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    botVersionId: text("bot_version_id")
      .notNull()
      .references(() => botVersions.id, { onDelete: "cascade" }),
    passed: boolean("passed").notNull(),
    report: jsonb("report").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("eval_runs_org_version_idx").on(t.orgId, t.botVersionId)],
);
