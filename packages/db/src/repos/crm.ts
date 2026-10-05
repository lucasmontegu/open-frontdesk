import type {
  ContactFact,
  ContactFactRepository,
  ContactProfile,
  Obligation,
  ObligationRepository,
  Page,
  Portfolio,
  PortfolioRepository,
  PortfolioRule,
  ProfileLoader,
} from "@ofd/core";
import { notFound } from "@ofd/core";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { newId } from "../ids.js";
import { contactFacts, contacts, conversations, obligations, portfolios } from "../schema/index.js";
import { hydrateContacts } from "./contacts.js";
import { clampLimit, decodeCursor, num, toPage } from "./util.js";

type ObligationRow = typeof obligations.$inferSelect;

const toObligation = (r: ObligationRow): Obligation => ({
  id: r.id,
  orgId: r.orgId,
  contactId: r.contactId,
  portfolioId: r.portfolioId,
  kind: r.kind,
  stage: r.stage,
  amount: num(r.amount),
  currency: r.currency,
  dueAt: r.dueAt,
  attributes: r.attributes,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const toPortfolio = (r: typeof portfolios.$inferSelect): Portfolio => ({
  id: r.id,
  orgId: r.orgId,
  name: r.name,
  owner: r.owner,
  rule: r.rule,
  createdAt: r.createdAt,
});

export class PgObligationRepository implements ObligationRepository {
  constructor(private readonly db: Db) {}

  async upsert(
    orgId: string,
    input: Omit<Obligation, "id" | "orgId" | "createdAt" | "updatedAt"> & { id?: string },
  ): Promise<Obligation> {
    const now = new Date();
    const values = {
      contactId: input.contactId,
      portfolioId: input.portfolioId,
      kind: input.kind,
      stage: input.stage,
      amount: input.amount === null ? null : String(input.amount),
      currency: input.currency,
      dueAt: input.dueAt,
      attributes: input.attributes,
      updatedAt: now,
    };
    if (input.id) {
      // Scoped by org: an id owned by another org does not match and the insert below hits the primary key.
      const updated = await this.db
        .update(obligations)
        .set(values)
        .where(and(eq(obligations.orgId, orgId), eq(obligations.id, input.id)))
        .returning();
      if (updated[0]) return toObligation(updated[0]);
    }
    const rows = await this.db
      .insert(obligations)
      .values({ id: input.id ?? newId("ob"), orgId, createdAt: now, ...values })
      .returning();
    return toObligation(rows[0] as ObligationRow);
  }

  async listByContact(orgId: string, contactId: string): Promise<Obligation[]> {
    const rows = await this.db
      .select()
      .from(obligations)
      .where(and(eq(obligations.orgId, orgId), eq(obligations.contactId, contactId)))
      .orderBy(asc(obligations.dueAt), asc(obligations.id));
    return rows.map(toObligation);
  }
}

export class PgPortfolioRepository implements PortfolioRepository {
  constructor(private readonly db: Db) {}

  async create(orgId: string, input: { name: string; owner?: string | null; rule: PortfolioRule }): Promise<Portfolio> {
    const rows = await this.db
      .insert(portfolios)
      .values({ id: newId("pf"), orgId, name: input.name, owner: input.owner ?? null, rule: input.rule })
      .returning();
    return toPortfolio(rows[0] as typeof portfolios.$inferSelect);
  }

  async get(orgId: string, id: string): Promise<Portfolio | null> {
    const rows = await this.db.select().from(portfolios).where(and(eq(portfolios.orgId, orgId), eq(portfolios.id, id)));
    return rows[0] ? toPortfolio(rows[0]) : null;
  }

  async list(orgId: string): Promise<Portfolio[]> {
    const rows = await this.db.select().from(portfolios).where(eq(portfolios.orgId, orgId)).orderBy(asc(portfolios.createdAt));
    return rows.map(toPortfolio);
  }

  /**
   * A portfolio is a saved rule, not a stored membership: every org obligation is tested
   * against the rule at read time. All rule fields are optional and combine with AND.
   * minDaysOverdue needs a due date, so obligations without one never match it.
   * tags match when the contact has at least one of the listed tags.
   */
  async members(
    orgId: string,
    id: string,
    opts: { limit?: number; cursor?: string | null } = {},
  ): Promise<Page<{ contact: import("@ofd/core").Contact; obligation: Obligation }>> {
    const portfolio = await this.get(orgId, id);
    if (!portfolio) throw notFound("portfolio");
    const { minDaysOverdue, minAmount, stages, tags } = portfolio.rule;
    const limit = clampLimit(opts.limit);
    const conds = [eq(obligations.orgId, orgId), eq(contacts.orgId, orgId)];
    if (minDaysOverdue !== undefined) {
      const cutoff = new Date(Date.now() - minDaysOverdue * 86_400_000);
      conds.push(isNotNull(obligations.dueAt), lte(obligations.dueAt, cutoff));
    }
    if (minAmount !== undefined) conds.push(gte(obligations.amount, String(minAmount)));
    if (stages && stages.length > 0) conds.push(inArray(obligations.stage, stages));
    if (tags && tags.length > 0) {
      conds.push(sql`${contacts.tags} && ARRAY[${sql.join(tags.map((t) => sql`${t}`), sql`, `)}]::text[]`);
    }
    const cur = decodeCursor(opts.cursor, 1);
    if (cur) conds.push(gt(obligations.id, cur[0] as string));

    const rows = await this.db
      .select({ obligation: obligations, contact: contacts })
      .from(obligations)
      .innerJoin(contacts, eq(contacts.id, obligations.contactId))
      .where(and(...conds))
      .orderBy(asc(obligations.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (r) => Buffer.from(r.obligation.id).toString("base64url"));
    const hydrated = await hydrateContacts(this.db, orgId, page.items.map((r) => r.contact));
    return {
      items: page.items.map((r, i) => ({ contact: hydrated[i] as never, obligation: toObligation(r.obligation) })),
      nextCursor: page.nextCursor,
    };
  }
}

export class PgContactFactRepository implements ContactFactRepository {
  constructor(private readonly db: Db) {}

  async add(orgId: string, fact: Omit<ContactFact, "id" | "orgId" | "createdAt">): Promise<ContactFact> {
    const rows = await this.db
      .insert(contactFacts)
      .values({ id: newId("cf"), orgId, createdAt: new Date(), ...fact })
      .returning();
    return rows[0] as ContactFact;
  }

  async listByContact(orgId: string, contactId: string): Promise<ContactFact[]> {
    return this.db
      .select()
      .from(contactFacts)
      .where(and(eq(contactFacts.orgId, orgId), eq(contactFacts.contactId, contactId)))
      .orderBy(desc(contactFacts.createdAt), desc(contactFacts.id));
  }
}

export class PgProfileLoader implements ProfileLoader {
  constructor(
    private readonly db: Db,
    private readonly contactsRepo: { get(orgId: string, id: string): Promise<import("@ofd/core").Contact | null> },
    private readonly obligationsRepo: ObligationRepository,
    private readonly factsRepo: ContactFactRepository,
  ) {}

  async load(orgId: string, contactId: string): Promise<ContactProfile | null> {
    const contact = await this.contactsRepo.get(orgId, contactId);
    if (!contact) return null;
    const [obligationList, facts, summaries] = await Promise.all([
      this.obligationsRepo.listByContact(orgId, contactId),
      this.factsRepo.listByContact(orgId, contactId),
      this.db
        .select({ summary: conversations.summary })
        .from(conversations)
        .where(and(eq(conversations.orgId, orgId), eq(conversations.contactId, contactId), isNotNull(conversations.summary)))
        .orderBy(desc(conversations.startedAt))
        .limit(3),
    ]);
    return {
      contact,
      obligations: obligationList,
      facts,
      recentSummaries: summaries.map((s) => s.summary as string),
    };
  }
}
