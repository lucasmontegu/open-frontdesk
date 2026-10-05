import { z } from "zod";

/** The canonical CRM model. Agents, policies and evals only ever talk to this model. */

export const IdentityKind = z.enum(["phone", "whatsapp", "email", "dni", "cuit", "external"]);
export type IdentityKind = z.infer<typeof IdentityKind>;

export interface ContactIdentity {
  kind: IdentityKind;
  value: string;
  /** For kind "external": which connector the id belongs to, e.g. "hubspot". */
  source?: string;
}

export interface Contact {
  id: string;
  orgId: string;
  displayName: string;
  identities: ContactIdentity[];
  /** Per-org custom fields, validated against the org's field schema. */
  attributes: Record<string, unknown>;
  tags: string[];
  /** True when the contact is on Argentina's Registro Nacional No Llame or opted out. */
  doNotCall: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** A portfolio ("cartera") is a rule-defined segment of contacts and their obligations. */
export const PortfolioRule = z.object({
  minDaysOverdue: z.number().int().nonnegative().optional(),
  minAmount: z.number().nonnegative().optional(),
  stages: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});
export type PortfolioRule = z.infer<typeof PortfolioRule>;

export interface Portfolio {
  id: string;
  orgId: string;
  name: string;
  /** For agencies: whose portfolio this is (the creditor). */
  owner: string | null;
  rule: PortfolioRule;
  createdAt: Date;
}

export const ObligationKind = z.enum(["debt", "opportunity", "appointment"]);
export type ObligationKind = z.infer<typeof ObligationKind>;

/** A debt, a lead or an appointment, with a stage and an amount. */
export interface Obligation {
  id: string;
  orgId: string;
  contactId: string;
  portfolioId: string | null;
  kind: ObligationKind;
  stage: string;
  amount: number | null;
  currency: string | null;
  dueAt: Date | null;
  attributes: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A fact remembered about a contact. Never stored without provenance: every fact
 * points at the event it was extracted from.
 */
export interface ContactFact {
  id: string;
  orgId: string;
  contactId: string;
  key: string;
  value: string;
  confidence: number;
  sourceEventId: string;
  sourceConversationId: string;
  createdAt: Date;
}

/** The profile preloaded into the agent's context when a conversation starts. */
export interface ContactProfile {
  contact: Contact;
  obligations: Obligation[];
  facts: ContactFact[];
  recentSummaries: string[];
}
