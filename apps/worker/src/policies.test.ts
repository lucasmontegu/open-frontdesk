import { describe, expect, it } from "vitest";
import type { ToolCallContext } from "@ofd/core";
import { FakeBots, makeVersion, ORG } from "./fakes.js";
import { createPolicyResolver } from "./policies.js";

const ctx = { orgId: ORG, botVersionId: "bv_1" } as ToolCallContext;
const rule = (id: string) => ({ id, effect: "allow" as const, description: "", when: "true" });

describe("policy resolver", () => {
  it("adds the pack's policies to the org rules, org rules winning on id clashes", async () => {
    const resolve = createPolicyResolver({
      policies: { rulesFor: async () => [rule("org_a"), rule("shared")], setOrgRules: async () => {} },
      bots: new FakeBots(makeVersion({ pack: { id: "cobranza-ar", version: "1" } })) as never,
      packPolicies: (id) => (id === "cobranza-ar" ? [rule("pack_a"), rule("shared")] : []),
    });
    expect((await resolve(ctx)).map((r) => r.id)).toEqual(["org_a", "shared", "pack_a"]);
  });

  it("reads the real builtin pack", async () => {
    const resolve = createPolicyResolver({
      policies: { rulesFor: async () => [], setOrgRules: async () => {} },
      bots: new FakeBots(makeVersion({ pack: { id: "cobranza-ar", version: "1" } })) as never,
    });
    expect((await resolve(ctx)).length).toBeGreaterThan(0);
  });
});
