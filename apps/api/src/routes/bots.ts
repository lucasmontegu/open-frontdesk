import { BotConfig, DomainError, notFound } from "@ofd/core";
import { getBuiltinPack } from "@ofd/packs";
import { Hono } from "hono";
import { z } from "zod";
import { HttpError } from "../http/errors.js";
import type { AppEnv, Container } from "../http/env.js";
import { requirePermission } from "../http/middleware.js";
import { mergePolicies } from "../services/policies.js";
import { validate } from "../http/validate.js";

const createBody = z.object({ name: z.string().min(1), packId: z.string().optional(), config: BotConfig.partial().optional() });
const versionBody = z.object({ config: BotConfig });

export function botRoutes(container: Container) {
  const { bots, policies } = container.repos;

  const loadBot = async (orgId: string, id: string) => {
    const bot = await bots.get(orgId, id);
    if (!bot) throw notFound("bot");
    return bot;
  };

  return new Hono<AppEnv>()
    .get("/", requirePermission("bots", "read"), async (c) => {
      const items = await bots.list(c.get("actor").orgId);
      return c.json({ items, nextCursor: null });
    })
    .post("/", requirePermission("bots", "create"), validate("json", createBody), async (c) => {
      const orgId = c.get("actor").orgId;
      const { name, packId, config } = c.req.valid("json");
      let base: BotConfig | null = null;
      if (packId) {
        const pack = getBuiltinPack(packId);
        if (!pack) throw new DomainError("invalid", `Unknown pack: ${packId}`);
        base = { ...pack.manifest.defaultBot, pack: { id: pack.manifest.id, version: pack.manifest.version } };
      }
      // Without a pack or config there is nothing to install: create the bot only.
      let draft: BotConfig | null = null;
      if (base || config) {
        const parsed = BotConfig.safeParse({ ...(base ?? {}), ...(config ?? {}), name: config?.name ?? base?.name ?? name });
        if (!parsed.success) throw new DomainError("invalid", `Invalid bot config: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
        draft = parsed.data;
      }
      const bot = await bots.create(orgId, name);
      if (draft) await bots.createVersion(orgId, bot.id, draft);
      return c.json(bot, 201);
    })
    .get("/:id", requirePermission("bots", "read"), async (c) => {
      const orgId = c.get("actor").orgId;
      const bot = await loadBot(orgId, c.req.param("id"));
      return c.json({ bot, versions: await bots.listVersions(orgId, bot.id) });
    })
    .post("/:id/versions", requirePermission("bots", "update"), validate("json", versionBody), async (c) => {
      const orgId = c.get("actor").orgId;
      const bot = await loadBot(orgId, c.req.param("id"));
      const version = await bots.createVersion(orgId, bot.id, c.req.valid("json").config);
      return c.json(version, 201);
    })
    .post("/:id/versions/:versionId/publish", requirePermission("bots", "publish"), async (c) => {
      const orgId = c.get("actor").orgId;
      const bot = await loadBot(orgId, c.req.param("id"));
      const version = await bots.getVersion(orgId, c.req.param("versionId"));
      if (!version || version.botId !== bot.id) throw notFound("bot version");
      if (version.status !== "draft" && version.status !== "rejected") {
        throw new DomainError("conflict", `A ${version.status} version cannot be published`);
      }

      const pack = version.config.pack ? getBuiltinPack(version.config.pack.id) : null;
      const orgRules = await policies.rulesFor(orgId, bot.id);
      await bots.setVersionStatus(orgId, version.id, "evaluating");

      let evalRun: Awaited<ReturnType<typeof container.releaseGate>>;
      try {
        evalRun = await container.releaseGate({
          orgId,
          botVersion: { ...version, status: "evaluating" },
          scenarios: pack?.scenarios ?? [],
          policies: mergePolicies(orgRules, pack?.policies ?? []),
          conversation: container.config.openaiApiKey ? { model: version.config.model } : null,
        });
      } catch (err) {
        await bots.setVersionStatus(orgId, version.id, "draft");
        throw err;
      }

      const outcome = { passed: evalRun.passed, score: evalRun.score, summary: evalRun.summary, failures: evalRun.failures };
      if (!evalRun.passed) {
        await bots.setVersionStatus(orgId, version.id, "rejected", evalRun.id);
        throw new HttpError(422, "eval_failed", "The version did not pass the release evals", { evalRun: outcome });
      }
      await bots.setVersionStatus(orgId, version.id, "evaluating", evalRun.id);
      await bots.publish(orgId, bot.id, version.id);
      return c.json({ version: await bots.getVersion(orgId, version.id), evalRun: outcome });
    });
}
