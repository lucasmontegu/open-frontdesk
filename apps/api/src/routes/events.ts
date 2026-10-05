import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Container } from "../http/env.js";
import { requirePermission } from "../http/middleware.js";
import { validate } from "../http/validate.js";

const EVENT_TYPES = [
  "conversation.started", "conversation.ended", "customer.message", "agent.message", "guard.input_flagged",
  "guard.output_blocked", "tool.requested", "tool.permitted", "tool.refused", "tool.completed", "tool.failed",
  "transfer.requested", "transfer.completed", "takeover.started", "takeover.ended", "fact.extracted",
  "mission.planned", "mission.approved", "mission.completed",
] as const;

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
  type: z.string().optional(),
  contactId: z.string().optional(),
});

export function eventRoutes(container: Container) {
  const { events } = container.repos;
  return new Hono<AppEnv>().get("/", requirePermission("calls", "read"), validate("query", listQuery), async (c) => {
    const q = c.req.valid("query");
    const types = q.type
      ? q.type.split(",").filter((t): t is (typeof EVENT_TYPES)[number] => (EVENT_TYPES as readonly string[]).includes(t))
      : undefined;
    return c.json(await events.list(c.get("actor").orgId, { limit: q.limit, cursor: q.cursor, contactId: q.contactId, types }));
  });
}

export function conversationRoutes(container: Container) {
  return new Hono<AppEnv>().get("/:id/events", requirePermission("calls", "read"), async (c) => {
    const items = await container.repos.events.listByConversation(c.get("actor").orgId, c.req.param("id"));
    return c.json({ items, nextCursor: null });
  });
}
