import { randomUUID } from "node:crypto";
import type { Role } from "@ofd/core";
import { can as canRole } from "@ofd/auth";
import type { MiddlewareHandler } from "hono";
import type { Container } from "../container.js";
import { HttpError } from "./errors.js";
import type { AppEnv, Permission } from "./env.js";


export const requestId = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const id = c.req.header("x-request-id") ?? randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
};

export const jsonLogging = (container: Container): MiddlewareHandler<AppEnv> => async (c, next) => {
  const start = Date.now();
  await next();
  container.logger.info(
    { requestId: c.get("requestId"), method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - start },
    "request",
  );
};

const ROLES: Role[] = ["owner", "admin", "supervisor", "operator", "viewer"];

/** better-auth stores a member's role as a comma separated string; pick the most privileged known one. */
function pickRole(raw: string | undefined): Role | null {
  const given = (raw ?? "").split(",").map((r) => r.trim());
  return ROLES.find((r) => given.includes(r)) ?? null;
}

/** Resolves the session and the member's role in the active organization into an Actor. */
export const authenticate = (container: Container): MiddlewareHandler<AppEnv> => async (c, next) => {
  const headers = c.req.raw.headers;
  const session = await container.auth.api.getSession({ headers });
  if (!session) throw new HttpError(401, "unauthorized", "Authentication required");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new HttpError(403, "forbidden", "No active organization on this session");
  const member = await container.auth.api.getActiveMember({ headers });
  const role = pickRole(member?.role);
  if (!member || !role) throw new HttpError(403, "forbidden", "Not a member of the active organization");
  c.set("actor", { kind: "user", id: session.user.id, orgId: orgId as never, role });
  await next();
};

export const requirePermission =
  (...[resource, action]: Permission): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const actor = c.get("actor");
    if (!canRole(actor.role, resource, action)) {
      throw new HttpError(403, "forbidden", `Role ${actor.role} cannot ${action} ${resource}`);
    }
    await next();
  };
