import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Container } from "../http/env.js";
import { requirePermission } from "../http/middleware.js";
import { validate } from "../http/validate.js";

const searchQuery = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  botId: z.string().optional(),
});
const ingestBody = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  botId: z.string().nullish(),
});

export function knowledgeRoutes(container: Container) {
  const { knowledge } = container.repos;
  return new Hono<AppEnv>()
    .get("/", requirePermission("bots", "read"), validate("query", searchQuery), async (c) => {
      const { q, limit, botId } = c.req.valid("query");
      const items = await knowledge.search(c.get("actor").orgId, q, { limit, botId });
      return c.json({ items, nextCursor: null });
    })
    .post("/", requirePermission("bots", "update"), validate("json", ingestBody), async (c) => {
      const doc = await knowledge.ingest(c.get("actor").orgId, c.req.valid("json"));
      return c.json(doc, 201);
    });
}
