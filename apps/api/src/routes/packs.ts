import { notFound } from "@ofd/core";
import { getBuiltinPack, listBuiltinPacks, type Pack } from "@ofd/packs";
import { Hono } from "hono";
import type { AppEnv, Container } from "../http/env.js";
import { requirePermission } from "../http/middleware.js";

/** What the dashboard's pack gallery shows: the default bot plus counts. */
function summary(p: Pack) {
  const bot = p.manifest.defaultBot;
  return {
    id: p.manifest.id,
    name: p.manifest.name,
    version: p.manifest.version,
    description: p.manifest.description,
    locale: p.manifest.locale,
    role: bot.role,
    goal: bot.goal,
    autonomy: bot.autonomy,
    channels: bot.channels,
    tools: bot.tools,
    policyCount: p.policies.length,
    scenarioCount: p.scenarios.length,
  };
}

export function packRoutes(_container: Container) {
  return new Hono<AppEnv>()
    .get("/", requirePermission("bots", "read"), (c) => c.json(listBuiltinPacks().map(summary)))
    .get("/:id", requirePermission("bots", "read"), (c) => {
      const pack = getBuiltinPack(c.req.param("id"));
      if (!pack) throw notFound("pack");
      return c.json({
        ...summary(pack),
        policies: pack.policies,
        scenarios: pack.scenarios.map((s) => ({ id: s.id, title: s.title, goal: s.goal })),
      });
    });
}
