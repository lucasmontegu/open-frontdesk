import { ContactWindow } from "@ofd/core";
import { Hono } from "hono";
import type { AppEnv, Container } from "../http/env.js";
import { requirePermission } from "../http/middleware.js";
import { validate } from "../http/validate.js";

/** Organization settings. The contact window decides when missions may call or message people. */
export function settingsRoutes(container: Container) {
  const { settings } = container.repos;
  const current = async (orgId: string) => {
    const own = await settings.getContactWindow(orgId);
    return own
      ? { window: own, source: "organization" as const }
      : { window: container.config.contactWindow, source: "default" as const };
  };
  return new Hono<AppEnv>()
    .get("/contact-window", requirePermission("policies", "read"), async (c) =>
      c.json(await current(c.get("actor").orgId)),
    )
    .put(
      "/contact-window",
      requirePermission("policies", "update"),
      validate("json", ContactWindow),
      async (c) => {
        const orgId = c.get("actor").orgId;
        await settings.setContactWindow(orgId, c.req.valid("json"));
        return c.json(await current(orgId));
      },
    )
    .delete("/contact-window", requirePermission("policies", "update"), async (c) => {
      const orgId = c.get("actor").orgId;
      await settings.setContactWindow(orgId, null);
      return c.json(await current(orgId));
    });
}
