import { z } from "zod";

/** Every tenant-owned record carries this id. Isolation is enforced in the backend, never the UI. */
export const OrgId = z.string().min(1).brand<"OrgId">();
export type OrgId = z.infer<typeof OrgId>;

export const Role = z.enum(["owner", "admin", "supervisor", "operator", "viewer"]);
export type Role = z.infer<typeof Role>;

/** Resources that permissions are granted on. Mirrors better-auth's access-control statements. */
export const Resource = z.enum([
  "bots",
  "portfolios",
  "contacts",
  "calls",
  "recordings",
  "policies",
  "missions",
  "billing",
  "members",
]);
export type Resource = z.infer<typeof Resource>;

export const Action = z.enum([
  "read",
  "create",
  "update",
  "delete",
  "publish",
  "approve",
  "takeover",
]);
export type Action = z.infer<typeof Action>;

/**
 * Who is acting. People and bots are both principals and go through the same permission
 * and policy checks.
 */
export type Actor =
  | { kind: "user"; id: string; orgId: OrgId; role: Role; portfolioIds?: string[] }
  | { kind: "bot"; id: string; orgId: OrgId; botVersionId: string }
  | { kind: "system"; id: "system"; orgId: OrgId };
