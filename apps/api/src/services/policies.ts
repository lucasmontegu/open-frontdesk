import type { PolicyRule } from "@ofd/core";

/** Org rules plus pack rules; an org rule wins over a pack rule with the same id. */
export function mergePolicies(orgRules: PolicyRule[], packRules: PolicyRule[]): PolicyRule[] {
  const seen = new Set(orgRules.map((r) => r.id));
  return [...orgRules, ...packRules.filter((r) => !seen.has(r.id))];
}
