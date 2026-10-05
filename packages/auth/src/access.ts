import type { Action, Resource, Role } from "@ofd/core";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, ownerAc } from "better-auth/plugins/organization/access";

/**
 * Permissions per resource. better-auth enforces the organization ones (members,
 * invitations); the API enforces the product ones through `can()`.
 */
export const statements = {
  ...defaultStatements,
  bots: ["read", "create", "update", "delete", "publish"],
  portfolios: ["read", "create", "update", "delete"],
  contacts: ["read", "create", "update", "delete"],
  calls: ["read", "takeover"],
  recordings: ["read"],
  policies: ["read", "update"],
  missions: ["read", "create", "approve"],
  billing: ["read", "update"],
  members: ["read", "create", "update", "delete"],
} as const;

export const ac = createAccessControl(statements);

const all = <K extends keyof typeof statements>(k: K) => [...statements[k]];

export const roles = {
  owner: ac.newRole({
    ...ownerAc.statements,
    bots: all("bots"),
    portfolios: all("portfolios"),
    contacts: all("contacts"),
    calls: all("calls"),
    recordings: all("recordings"),
    policies: all("policies"),
    missions: all("missions"),
    billing: all("billing"),
    members: all("members"),
  }),
  admin: ac.newRole({
    ...adminAc.statements,
    bots: all("bots"),
    portfolios: all("portfolios"),
    contacts: all("contacts"),
    calls: all("calls"),
    recordings: all("recordings"),
    policies: all("policies"),
    missions: all("missions"),
    members: all("members"),
  }),
  supervisor: ac.newRole({
    bots: ["read"],
    portfolios: ["read"],
    contacts: ["read", "update"],
    calls: ["read", "takeover"],
    recordings: ["read"],
    policies: ["read"],
    missions: ["read", "create", "approve"],
  }),
  operator: ac.newRole({
    contacts: ["read", "update"],
    calls: ["read", "takeover"],
    missions: ["read"],
  }),
  viewer: ac.newRole({
    bots: ["read"],
    portfolios: ["read"],
    contacts: ["read"],
    calls: ["read"],
    missions: ["read"],
  }),
};

/** Whether a role may perform an action on a product resource. Unknown pairs are denied. */
export function can(role: Role, resource: Resource, action: Action): boolean {
  const granted = (roles[role].statements as Record<string, readonly string[] | undefined>)[
    resource
  ];
  return granted?.includes(action) ?? false;
}
