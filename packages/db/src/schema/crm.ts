import type { IdentityKind, ObligationKind, PortfolioRule } from "@ofd/core";
import { boolean, index, jsonb, numeric, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const contacts = pgTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    displayName: text("display_name").notNull(),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    tags: text("tags").array().notNull().default([]),
    doNotCall: boolean("do_not_call").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("contacts_org_created_idx").on(t.orgId, t.createdAt, t.id)],
);

export const contactIdentities = pgTable(
  "contact_identities",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: text("kind").$type<IdentityKind>().notNull(),
    value: text("value").notNull(),
    source: text("source"),
  },
  (t) => [
    uniqueIndex("contact_identities_lookup_uq").on(t.orgId, t.kind, t.value),
    index("contact_identities_contact_idx").on(t.orgId, t.contactId),
  ],
);

export const portfolios = pgTable(
  "portfolios",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    owner: text("owner"),
    rule: jsonb("rule").$type<PortfolioRule>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("portfolios_org_idx").on(t.orgId, t.createdAt)],
);

export const obligations = pgTable(
  "obligations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    portfolioId: text("portfolio_id"),
    kind: text("kind").$type<ObligationKind>().notNull(),
    stage: text("stage").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }),
    currency: text("currency"),
    dueAt: ts("due_at"),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("obligations_org_contact_idx").on(t.orgId, t.contactId),
    index("obligations_org_due_idx").on(t.orgId, t.dueAt),
  ],
);

export const contactFacts = pgTable(
  "contact_facts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    confidence: real("confidence").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    sourceConversationId: text("source_conversation_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("contact_facts_org_contact_idx").on(t.orgId, t.contactId, t.createdAt)],
);
