import type { BotRepository, PolicyRepository, PolicyRule, ToolCallContext } from "@ofd/core";
import { getBuiltinPack } from "@ofd/packs";

/**
 * Rules the gateway evaluates for a call: the org's own rules plus the policies of the pack the
 * bot version was installed from. Org rules come first and win on id clashes.
 */
export function createPolicyResolver(deps: {
  policies: PolicyRepository;
  bots: BotRepository;
  packPolicies?: (packId: string) => PolicyRule[];
}): (ctx: ToolCallContext) => Promise<PolicyRule[]> {
  const packPolicies = deps.packPolicies ?? ((id: string) => getBuiltinPack(id)?.policies ?? []);
  return async (ctx) => {
    const version = ctx.botVersionId
      ? await deps.bots.getVersion(ctx.orgId, ctx.botVersionId)
      : null;
    const org = await deps.policies.rulesFor(ctx.orgId, version?.botId ?? null);
    const pack = version?.config.pack ? packPolicies(version.config.pack.id) : [];
    const seen = new Set(org.map((r) => r.id));
    return [...org, ...pack.filter((r) => !seen.has(r.id))];
  };
}
