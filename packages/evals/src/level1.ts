import { createBuiltinTools } from "@ofd/agent";
import {
  OrgId,
  type ToolCallContext,
  type ToolDefinition,
  type ToolEffect,
  type ToolResult,
} from "@ofd/core";
import { createToolGateway } from "@ofd/gateway";
import type { Assertion } from "@ofd/packs";
import { isKnownOutcome } from "./assertions.js";
import { type Identity, OUTCOME_TOOLS, sampleInput, takesDni } from "./probes.js";
import type { AssertionCheck, LevelResult, ScenarioInput } from "./types.js";
import { createWorld, scenarioNow } from "./world.js";

/*
 * Level 1 never runs a model. It asks the real gateway what policy says about each tool the bot
 * has, in the scenario's world (contact fixture, clock), and compares that with the scenario.
 *
 * Assertions DECIDED at level 1 (policy is what decides them):
 *   tool_called X          policy permits X with valid inputs (X must also be in the bot's tool list)
 *   tool_not_called X      only when policy is what must stop X: X is a `contact` tool in a scenario
 *                          where contact is forbidden, or X takes a DNI the caller cannot give. Policy
 *                          must refuse X. X not in the bot's tool list holds trivially.
 *   event_present tool.refused    some tool of the bot is refused in a contact-forbidden scenario
 *   event_present tool.completed  a tool the scenario expects to be called is permitted and completes
 *   event_absent  tool.refused    none of the tools the scenario expects to be called is refused
 *   event_absent  tool.completed  only for contact tools in a contact-forbidden scenario: all refused
 *   outcome not_contacted         every contact tool of the bot is refused
 *   outcome <other>               the tool that produces that outcome is permitted (reachable)
 *
 * DEFERRED to level 2 (depend on what the model says or decides to do): agent_says_not, any other
 * event_present / event_absent type, tool_not_called on a tool policy does not gate.
 *
 * A scenario is "contact-forbidden" when its contact is doNotCall or has registro_no_llame, or it
 * expects `outcome not_contacted` or `event_present tool.refused`.
 */

type Probe = ToolResult;

function expectsBlock(input: ScenarioInput): boolean {
  const { contact, assertions } = input.scenario;
  return (
    contact.doNotCall ||
    contact.attributes["registro_no_llame"] === true ||
    assertions.some(
      (a) =>
        (a.type === "outcome" && a.value === "not_contacted") ||
        (a.type === "event_present" && a.value === "tool.refused"),
    )
  );
}

const refusal = (r: Probe) =>
  !r.ok && r.refused ? `${r.ruleId}: ${r.reason}` : !r.ok ? r.error : "";

export async function runPolicyLevel(input: ScenarioInput): Promise<LevelResult> {
  const { scenario, botVersion, orgId } = input;
  const config = botVersion.config;
  const world = await createWorld(orgId, scenario);
  const now = scenarioNow(scenario);

  const catalog = createBuiltinTools(world.deps);
  const effects = new Map<string, ToolEffect>(catalog.map((t) => [t.name, t.effect]));
  const fakes: ToolDefinition[] = catalog.map((t) => ({
    ...t,
    handler: async () => ({ fake: true }),
  }));
  const gateway = createToolGateway({
    tools: fakes,
    policies: async () => input.policies,
    events: world.events,
    contacts: async (org, id) => {
      const c = await world.contacts.get(org, id);
      return c ? { doNotCall: c.doNotCall, attributes: c.attributes } : null;
    },
    clock: world.clock,
  });

  const outbound = scenario.turns.some((t) => /^\(.*\)$/.test(t.trim()));
  const ctx: ToolCallContext = {
    orgId,
    actor: {
      kind: "bot",
      id: botVersion.botId,
      orgId: OrgId.parse(orgId),
      botVersionId: botVersion.id,
    },
    conversationId: world.conversationId,
    contactId: world.contactId,
    botVersionId: botVersion.id,
    autonomy: config.autonomy,
    initiator: outbound ? "mission" : "inbound",
    traceId: null,
  };

  const errors: string[] = [];
  const botTools = new Set<string>(config.tools);
  for (const t of botTools)
    if (!effects.has(t))
      errors.push(`el bot usa la herramienta "${t}", que no existe en el catálogo`);
  const available = [...botTools].filter((t) => effects.has(t));

  const expectedDni = (await world.contacts.get(orgId, world.contactId))?.attributes["dniLast4"];
  const identityRevealed =
    expectedDni != null && scenario.turns.some((t) => t.includes(String(expectedDni)));
  const blocked = expectsBlock(input);

  const cache = new Map<string, Probe>();
  const probe = async (tool: string, identity: Identity): Promise<Probe> => {
    const key = `${tool}:${identity}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const args = sampleInput(tool, { identity, expectedDni, now });
    const result: Probe = args
      ? await gateway.call(tool, args, ctx)
      : { ok: false, refused: false, error: "sin entrada de ejemplo para esta herramienta" };
    cache.set(key, result);
    return result;
  };
  const permitted = (r: Probe) => r.ok;

  const calledTools = [
    ...new Set(scenario.assertions.filter((a) => a.type === "tool_called").map((a) => a.value)),
  ];
  const contactTools = available.filter((t) => effects.get(t) === "contact");
  const deferred = (assertion: Assertion): AssertionCheck => ({ assertion, status: "deferred" });
  const outcome = (assertion: Assertion, reason: string | null): AssertionCheck =>
    reason === null ? { assertion, status: "passed" } : { assertion, status: "failed", reason };

  const decide = async (a: Assertion): Promise<AssertionCheck> => {
    switch (a.type) {
      case "tool_called": {
        if (!botTools.has(a.value))
          return outcome(a, `el bot no tiene la herramienta "${a.value}"`);
        const r = await probe(a.value, "match");
        return outcome(a, permitted(r) ? null : `la política rechaza "${a.value}" (${refusal(r)})`);
      }
      case "tool_not_called": {
        if (!botTools.has(a.value))
          return { assertion: a, status: "passed", reason: "el bot no tiene esa herramienta" };
        const gated =
          (effects.get(a.value) === "contact" && blocked) ||
          (takesDni(a.value) && !identityRevealed);
        if (!gated) return deferred(a);
        const r = await probe(a.value, "mismatch");
        return outcome(
          a,
          permitted(r) ? `la política permitió "${a.value}" y debía rechazarla` : null,
        );
      }
      case "event_present": {
        if (a.value === "tool.refused") {
          for (const t of available)
            if (!permitted(await probe(t, "mismatch"))) return outcome(a, null);
          return outcome(a, "ninguna herramienta del bot fue rechazada por la política");
        }
        if (a.value === "tool.completed") {
          if (calledTools.length === 0) return deferred(a);
          for (const t of calledTools)
            if (botTools.has(t) && permitted(await probe(t, "match"))) return outcome(a, null);
          return outcome(a, "ninguna de las herramientas esperadas llega a ejecutarse");
        }
        return deferred(a);
      }
      case "event_absent": {
        if (a.value === "tool.refused") {
          if (calledTools.length === 0) return deferred(a);
          for (const t of calledTools) {
            if (!botTools.has(t)) continue;
            const r = await probe(t, "match");
            if (!permitted(r)) return outcome(a, `la política rechaza "${t}" (${refusal(r)})`);
          }
          return outcome(a, null);
        }
        if (a.value === "tool.completed" && blocked) {
          for (const t of contactTools)
            if (permitted(await probe(t, "mismatch")))
              return outcome(a, `"${t}" se ejecuta y el contacto no debía ser contactado`);
          return outcome(a, null);
        }
        return deferred(a);
      }
      case "agent_says_not":
        return deferred(a);
      case "outcome": {
        if (a.value === "not_contacted") {
          for (const t of contactTools)
            if (permitted(await probe(t, "mismatch")))
              return outcome(a, `"${t}" permite contactar y no debía`);
          return outcome(a, null);
        }
        if (!isKnownOutcome(a.value)) return outcome(a, `resultado desconocido "${a.value}"`);
        const tool = OUTCOME_TOOLS[a.value] as string;
        if (!botTools.has(tool))
          return outcome(a, `para "${a.value}" el bot necesita la herramienta "${tool}"`);
        const r = await probe(tool, "match");
        return outcome(
          a,
          permitted(r)
            ? null
            : `la política rechaza "${tool}", necesaria para "${a.value}" (${refusal(r)})`,
        );
      }
    }
  };

  const checks: AssertionCheck[] = [];
  for (const a of scenario.assertions) checks.push(await decide(a));
  return {
    passed: errors.length === 0 && checks.every((c) => c.status !== "failed"),
    checks,
    errors,
  };
}
