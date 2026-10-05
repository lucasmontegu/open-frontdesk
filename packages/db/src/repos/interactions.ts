import type {
  Clock,
  ConversationRepository,
  EventStore,
  EventType,
  InteractionEvent,
  Mission,
  MissionRepository,
  NewEvent,
  Page,
  PolicyRepository,
  PolicyRule,
} from "@ofd/core";
import { notFound } from "@ofd/core";
import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { Db } from "../client.js";
import { newId } from "../ids.js";
import { conversations, events, missions, policies } from "../schema/index.js";
import { clampLimit, decodeCursor, encodeCursor, toPage } from "./util.js";

const toEvent = (r: typeof events.$inferSelect): InteractionEvent => ({
  id: r.id,
  orgId: r.orgId,
  type: r.type,
  payload: r.payload as never,
  conversationId: r.conversationId,
  botVersionId: r.botVersionId,
  contactId: r.contactId,
  actorKind: r.actorKind,
  actorId: r.actorId,
  traceId: r.traceId,
  occurredAt: r.occurredAt,
});

export class PgEventStore implements EventStore {
  constructor(private readonly db: Db) {}

  async append<T extends EventType>(event: NewEvent<T>): Promise<InteractionEvent<T>> {
    const rows = await this.db
      .insert(events)
      .values({
        id: newId("ev"),
        orgId: event.orgId,
        type: event.type,
        payload: event.payload as Record<string, unknown>,
        conversationId: event.conversationId,
        botVersionId: event.botVersionId,
        contactId: event.contactId,
        actorKind: event.actorKind,
        actorId: event.actorId,
        traceId: event.traceId,
        occurredAt: event.occurredAt ?? new Date(),
      })
      .returning();
    return toEvent(rows[0] as typeof events.$inferSelect) as InteractionEvent<T>;
  }

  async listByConversation(orgId: string, conversationId: string): Promise<InteractionEvent[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(and(eq(events.orgId, orgId), eq(events.conversationId, conversationId)))
      .orderBy(asc(events.occurredAt), asc(events.seq));
    return rows.map(toEvent);
  }

  /** Most recent first. */
  async list(
    orgId: string,
    opts: { limit?: number; cursor?: string | null; types?: EventType[]; contactId?: string } = {},
  ): Promise<Page<InteractionEvent>> {
    const limit = clampLimit(opts.limit);
    const conds = [eq(events.orgId, orgId)];
    if (opts.types && opts.types.length > 0) conds.push(inArray(events.type, opts.types));
    if (opts.contactId) conds.push(eq(events.contactId, opts.contactId));
    const cur = decodeCursor(opts.cursor, 2);
    if (cur) {
      const at = new Date(Number(cur[0]));
      const seq = Number(cur[1]);
      conds.push(or(lt(events.occurredAt, at), and(eq(events.occurredAt, at), lt(events.seq, seq))) as never);
    }
    const rows = await this.db
      .select()
      .from(events)
      .where(and(...conds))
      .orderBy(desc(events.occurredAt), desc(events.seq))
      .limit(limit + 1);
    const page = toPage(rows, limit, (r) => encodeCursor(r.occurredAt.getTime(), r.seq));
    return { items: page.items.map(toEvent), nextCursor: page.nextCursor };
  }
}

export class PgConversationRepository implements ConversationRepository {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  async start(
    orgId: string,
    input: { channel: string; contactId: string | null; botVersionId: string; direction: "inbound" | "outbound"; missionId?: string | null },
  ): Promise<{ id: string }> {
    const id = newId("cv");
    await this.db.insert(conversations).values({
      id,
      orgId,
      channel: input.channel,
      direction: input.direction,
      contactId: input.contactId,
      botVersionId: input.botVersionId,
      missionId: input.missionId ?? null,
      startedAt: this.clock.now(),
    });
    return { id };
  }

  async end(orgId: string, id: string, outcome: string, summary?: string): Promise<void> {
    const rows = await this.db
      .update(conversations)
      .set({ outcome, summary: summary ?? null, endedAt: this.clock.now() })
      .where(and(eq(conversations.orgId, orgId), eq(conversations.id, id)))
      .returning({ id: conversations.id });
    if (rows.length === 0) throw notFound("conversation");
  }
}

export class PgPolicyRepository implements PolicyRepository {
  constructor(private readonly db: Db) {}

  /** Returns the org's own rules in stored order. Pack rules are merged in by the caller. */
  async rulesFor(orgId: string, _botId: string | null): Promise<PolicyRule[]> {
    const rows = await this.db.select().from(policies).where(eq(policies.orgId, orgId)).orderBy(asc(policies.position));
    return rows.map((r) => ({ id: r.ruleId, effect: r.effect, description: r.description, when: r.whenExpr }));
  }

  /** Replaces the org's rule set atomically. */
  async setOrgRules(orgId: string, rules: PolicyRule[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(policies).where(eq(policies.orgId, orgId));
      if (rules.length === 0) return;
      await tx.insert(policies).values(
        rules.map((r, position) => ({
          id: newId("pol"),
          orgId,
          ruleId: r.id,
          effect: r.effect,
          description: r.description,
          whenExpr: r.when,
          position,
        })),
      );
    });
  }
}

const toMission = (r: typeof missions.$inferSelect): Mission => ({ ...r });

export class PgMissionRepository implements MissionRepository {
  constructor(private readonly db: Db) {}

  async create(orgId: string, input: { botId: string; createdBy: string; instruction: string }): Promise<Mission> {
    const rows = await this.db
      .insert(missions)
      .values({ id: newId("ms"), orgId, botId: input.botId, createdBy: input.createdBy, instruction: input.instruction })
      .returning();
    return toMission(rows[0] as typeof missions.$inferSelect);
  }

  async get(orgId: string, id: string): Promise<Mission | null> {
    const rows = await this.db.select().from(missions).where(and(eq(missions.orgId, orgId), eq(missions.id, id)));
    return rows[0] ? toMission(rows[0]) : null;
  }

  async list(orgId: string): Promise<Mission[]> {
    const rows = await this.db.select().from(missions).where(eq(missions.orgId, orgId)).orderBy(desc(missions.createdAt));
    return rows.map(toMission);
  }

  async update(orgId: string, id: string, patch: Partial<Pick<Mission, "status" | "plan" | "report">>): Promise<Mission> {
    const rows = await this.db
      .update(missions)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(missions.orgId, orgId), eq(missions.id, id)))
      .returning();
    if (!rows[0]) throw notFound("mission");
    return toMission(rows[0]);
  }
}
