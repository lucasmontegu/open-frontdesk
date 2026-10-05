import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import type { AppEnv } from "./http/env.js";

/** Serves the dashboard build at / with SPA fallback to index.html for non-API paths. */
export function mountDashboard(app: Hono<AppEnv>, dir: string) {
  const root = resolve(dir);
  app.use("*", async (c, next) => (c.req.path.startsWith("/api/") || c.req.path === "/api" ? next() : serveStatic({ root: relative(root) })(c, next)));
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api")) return c.notFound();
    return c.html(await readFile(join(root, "index.html"), "utf8"));
  });
}

// serveStatic resolves roots against process.cwd(), so hand it a cwd-relative path.
const relative = (abs: string) => {
  const rel = abs.startsWith(process.cwd()) ? abs.slice(process.cwd().length).replace(/^\//, "") : abs;
  return rel || ".";
};
