import type { Bot, BotConfig, BotRepository, BotVersion, BotVersionStatus } from "@ofd/core";
import { DomainError, notFound } from "@ofd/core";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { newId } from "../ids.js";
import { botVersions, bots, evalRuns } from "../schema/index.js";

const toBot = (r: typeof bots.$inferSelect): Bot => ({
  id: r.id,
  orgId: r.orgId,
  name: r.name,
  publishedVersionId: r.publishedVersionId,
  createdAt: r.createdAt,
});

const toVersion = (r: typeof botVersions.$inferSelect): BotVersion => ({ ...r });

export class PgBotRepository implements BotRepository {
  constructor(private readonly db: Db) {}

  async create(orgId: string, name: string): Promise<Bot> {
    const rows = await this.db.insert(bots).values({ id: newId("bot"), orgId, name }).returning();
    return toBot(rows[0] as typeof bots.$inferSelect);
  }

  async get(orgId: string, id: string): Promise<Bot | null> {
    const rows = await this.db.select().from(bots).where(and(eq(bots.orgId, orgId), eq(bots.id, id)));
    return rows[0] ? toBot(rows[0]) : null;
  }

  async list(orgId: string): Promise<Bot[]> {
    const rows = await this.db.select().from(bots).where(eq(bots.orgId, orgId)).orderBy(asc(bots.createdAt));
    return rows.map(toBot);
  }

  /** Versions are numbered 1..n per bot. The bot row is locked so concurrent calls cannot reuse a number. */
  async createVersion(orgId: string, botId: string, config: BotConfig): Promise<BotVersion> {
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`select id from ${bots} where ${bots.orgId} = ${orgId} and ${bots.id} = ${botId} for update`);
      if (locked.length === 0) throw notFound("bot");
      const [{ next }] = (await tx.execute(
        sql`select coalesce(max(${botVersions.version}), 0) + 1 as next from ${botVersions} where ${botVersions.orgId} = ${orgId} and ${botVersions.botId} = ${botId}`,
      )) as unknown as [{ next: number }];
      const rows = await tx
        .insert(botVersions)
        .values({ id: newId("bv"), orgId, botId, version: Number(next), config, status: "draft" })
        .returning();
      return toVersion(rows[0] as typeof botVersions.$inferSelect);
    });
  }

  async getVersion(orgId: string, versionId: string): Promise<BotVersion | null> {
    const rows = await this.db.select().from(botVersions).where(and(eq(botVersions.orgId, orgId), eq(botVersions.id, versionId)));
    return rows[0] ? toVersion(rows[0]) : null;
  }

  async listVersions(orgId: string, botId: string): Promise<BotVersion[]> {
    const rows = await this.db
      .select()
      .from(botVersions)
      .where(and(eq(botVersions.orgId, orgId), eq(botVersions.botId, botId)))
      .orderBy(asc(botVersions.version));
    return rows.map(toVersion);
  }

  async setVersionStatus(
    orgId: string,
    versionId: string,
    status: BotVersionStatus,
    evalRunId?: string | null,
  ): Promise<BotVersion> {
    const rows = await this.db
      .update(botVersions)
      .set({ status, ...(evalRunId !== undefined ? { evalRunId } : {}) })
      .where(and(eq(botVersions.orgId, orgId), eq(botVersions.id, versionId)))
      .returning();
    if (!rows[0]) throw notFound("bot version");
    return toVersion(rows[0]);
  }

  /**
   * Publish rule: the version must be in status 'evaluating' and its evalRunId must point at an
   * eval_runs row of the same org and version with passed = true. Anything else is a 'conflict'.
   * On success the version becomes 'published', the previously published version is archived and
   * bots.published_version_id is switched, all in one transaction.
   */
  async publish(orgId: string, botId: string, versionId: string): Promise<Bot> {
    return this.db.transaction(async (tx) => {
      const botRows = await tx
        .select()
        .from(bots)
        .where(and(eq(bots.orgId, orgId), eq(bots.id, botId)))
        .for("update");
      const bot = botRows[0];
      if (!bot) throw notFound("bot");
      const vRows = await tx
        .select()
        .from(botVersions)
        .where(and(eq(botVersions.orgId, orgId), eq(botVersions.botId, botId), eq(botVersions.id, versionId)));
      const version = vRows[0];
      if (!version) throw notFound("bot version");
      if (version.status !== "evaluating" || !version.evalRunId) {
        throw new DomainError("conflict", "only a version that finished evaluation can be published");
      }
      const runs = await tx
        .select()
        .from(evalRuns)
        .where(and(eq(evalRuns.orgId, orgId), eq(evalRuns.id, version.evalRunId), eq(evalRuns.botVersionId, versionId)));
      if (!runs[0]?.passed) throw new DomainError("conflict", "the eval run did not pass");

      if (bot.publishedVersionId && bot.publishedVersionId !== versionId) {
        await tx
          .update(botVersions)
          .set({ status: "archived" })
          .where(and(eq(botVersions.orgId, orgId), eq(botVersions.id, bot.publishedVersionId)));
      }
      await tx.update(botVersions).set({ status: "published" }).where(and(eq(botVersions.orgId, orgId), eq(botVersions.id, versionId)));
      const updated = await tx.update(bots).set({ publishedVersionId: versionId }).where(and(eq(bots.orgId, orgId), eq(bots.id, botId))).returning();
      return toBot(updated[0] as typeof bots.$inferSelect);
    });
  }
}
