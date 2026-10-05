import { DomainError, notFound } from "@ofd/core";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Container } from "../http/env.js";
import { requirePermission } from "../http/middleware.js";
import { validate } from "../http/validate.js";

const createBody = z.object({ instruction: z.string().min(1), botId: z.string().min(1) });

export function missionRoutes(container: Container) {
  const { missions, bots } = container.repos;
  return new Hono<AppEnv>()
    .get("/", requirePermission("missions", "read"), async (c) => {
      const items = await missions.list(c.get("actor").orgId);
      return c.json({ items, nextCursor: null });
    })
    .post("/", requirePermission("missions", "create"), validate("json", createBody), async (c) => {
      const actor = c.get("actor");
      const { instruction, botId } = c.req.valid("json");
      const bot = await bots.get(actor.orgId, botId);
      if (!bot) throw notFound("bot");
      if (!bot.publishedVersionId)
        throw new DomainError("conflict", "The bot has no published version");
      const version = await bots.getVersion(actor.orgId, bot.publishedVersionId);
      const mission = await missions.create(actor.orgId, {
        botId,
        createdBy: actor.id,
        instruction,
      });
      await container.jobs.enqueue("mission.plan", {
        orgId: actor.orgId,
        missionId: mission.id,
        botId,
        instruction,
        autonomy: version?.config.autonomy ?? 2,
        createdBy: actor.id,
      });
      return c.json(mission, 201);
    })
    .get("/:id", requirePermission("missions", "read"), async (c) => {
      const mission = await missions.get(c.get("actor").orgId, c.req.param("id"));
      if (!mission) throw notFound("mission");
      return c.json(mission);
    })
    .post("/:id/approve", requirePermission("missions", "approve"), async (c) => {
      const actor = c.get("actor");
      const mission = await missions.get(actor.orgId, c.req.param("id"));
      if (!mission) throw notFound("mission");
      if (mission.status !== "awaiting_approval") {
        throw new DomainError("conflict", `A mission that is ${mission.status} cannot be approved`);
      }
      const updated = await missions.update(actor.orgId, mission.id, { status: "running" });
      await container.repos.events.append({
        orgId: actor.orgId,
        type: "mission.approved",
        payload: { missionId: mission.id, userId: actor.id },
        conversationId: null,
        botVersionId: null,
        contactId: null,
        actorKind: "user",
        actorId: actor.id,
        traceId: c.get("requestId"),
      });
      await container.jobs.enqueue("mission.execute", {
        orgId: actor.orgId,
        missionId: mission.id,
        approvedBy: actor.id,
      });
      return c.json(updated);
    });
}
