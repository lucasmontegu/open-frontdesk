import { listBuiltinPacks } from "@ofd/packs";
import { Hono } from "hono";
import type { AppEnv, Container } from "../http/env.js";
import { requirePermission } from "../http/middleware.js";

export function packRoutes(_container: Container) {
  return new Hono<AppEnv>().get("/", requirePermission("bots", "read"), (c) =>
    c.json(
      listBuiltinPacks().map((p) => ({
        id: p.manifest.id,
        name: p.manifest.name,
        version: p.manifest.version,
        description: p.manifest.description,
      })),
    ),
  );
}
