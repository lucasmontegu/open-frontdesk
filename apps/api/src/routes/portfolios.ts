import { PortfolioRule, notFound } from "@ofd/core";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Container } from "../http/env.js";
import { requirePermission } from "../http/middleware.js";
import { validate } from "../http/validate.js";

const createBody = z.object({ name: z.string().min(1), owner: z.string().nullish(), rule: PortfolioRule });
const pageQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).optional(), cursor: z.string().optional() });

export function portfolioRoutes(container: Container) {
  const { portfolios } = container.repos;
  return new Hono<AppEnv>()
    .get("/", requirePermission("portfolios", "read"), async (c) => {
      const items = await portfolios.list(c.get("actor").orgId);
      return c.json({ items, nextCursor: null });
    })
    .post("/", requirePermission("portfolios", "create"), validate("json", createBody), async (c) => {
      const portfolio = await portfolios.create(c.get("actor").orgId, c.req.valid("json"));
      return c.json(portfolio, 201);
    })
    .get("/:id/members", requirePermission("portfolios", "read"), validate("query", pageQuery), async (c) => {
      const orgId = c.get("actor").orgId;
      if (!(await portfolios.get(orgId, c.req.param("id")))) throw notFound("portfolio");
      return c.json(await portfolios.members(orgId, c.req.param("id"), c.req.valid("query")));
    });
}
