import { describe, expect, it } from "vitest";
import type { ToolCallContext } from "@ofd/core";
import { createPolicyResolver } from "./policies.js";
import { makeVersion, ORG } from "./test-fakes.js";

describe("policy resolver", () => {
  it("merges the pack's builtin policies into the org rules", async () => {
    const resolve = createPolicyResolver({
      policies: { rulesFor: async () => [{ id: "org_rule", effect: "allow", description: "", when: "true" }], setOrgRules: async () => {} },
      bots: { getVersion: async () => makeVersion({ pack: { id: "cobranza-ar", version: "1" } }) } as never,
    });
    const rules = await resolve({ orgId: ORG, botVersionId: "bv_1" } as ToolCallContext);
    expect(rules[0]?.id).toBe("org_rule");
    expect(rules.length).toBeGreaterThan(1);
  });
});
