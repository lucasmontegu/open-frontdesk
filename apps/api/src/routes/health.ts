import { Hono } from "hono";
import type { AppEnv, Container } from "../http/env.js";

export function healthRoutes(container: Container) {
  return new Hono<AppEnv>().get("/", async (c) => {
    const probe = (fn: () => Promise<void>) =>
      fn().then(
        () => "ok" as const,
        () => "down" as const,
      );
    const [db, redis] = await Promise.all([probe(container.checks.db), probe(container.checks.redis)]);
    const ok = db === "ok" && redis === "ok";
    return c.json({ status: ok ? "ok" : "degraded", db, redis }, ok ? 200 : 503);
  });
}
