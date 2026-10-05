import { BotConfig, type BotVersion, type PolicyRule } from "@ofd/core";
import { validateRule } from "@ofd/gateway";
import { getBuiltinPack, listBuiltinPacks, type Pack } from "@ofd/packs";
import { describe, expect, it } from "vitest";
import { runReleaseGate, runScenario } from "./index.js";
import { mockModel } from "./test-helpers.js";

const draft = (pack: Pack): BotVersion => ({
  id: "bv-draft",
  orgId: "org-eval",
  botId: "bot-eval",
  version: 1,
  config: BotConfig.parse({
    ...pack.manifest.defaultBot,
    pack: { id: pack.manifest.id, version: pack.manifest.version },
  }),
  status: "draft",
  evalRunId: null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
});

const gate = (pack: Pack, extra: Partial<Parameters<typeof runReleaseGate>[0]> = {}) =>
  runReleaseGate({
    orgId: "org-eval",
    botVersion: draft(pack),
    scenarios: pack.scenarios,
    policies: pack.policies,
    ...extra,
  });

describe("builtin packs", () => {
  const packs = listBuiltinPacks();

  it("ships packs", () => expect(packs.length).toBeGreaterThanOrEqual(3));

  for (const pack of packs) {
    it(`${pack.manifest.id}: every policy compiles`, () => {
      for (const rule of pack.policies) expect(validateRule(rule), rule.id).toEqual({ ok: true });
    });

    it(`${pack.manifest.id}: passes level 1 of its own scenarios`, async () => {
      const result = await gate(pack);
      expect(result.failures).toEqual([]);
      expect(result).toMatchObject({
        passed: true,
        score: 1,
        levels: { policy: "passed", conversation: "skipped" },
      });
    });
  }
});

describe("level 1", () => {
  const cobranza = getBuiltinPack("cobranza-ar") as Pack;
  const recepcion = getBuiltinPack("recepcion-ar") as Pack;
  const ventas = getBuiltinPack("ventas-ar") as Pack;
  const scenario = (pack: Pack, id: string) => pack.scenarios.find((s) => s.id === id)!;

  it("refuses contact tools out of hours and decides the outcome from policy", async () => {
    const r = await runScenario({
      orgId: "o",
      botVersion: draft(cobranza),
      policies: cobranza.policies,
      scenario: scenario(cobranza, "fuera-de-horario"),
    });
    expect(r.policy.checks.map((c) => c.status)).toEqual(["passed", "passed", "passed"]);
  });

  it("fails when the policy lets a contact tool through on a doNotCall contact", async () => {
    const lenient: PolicyRule[] = [{ id: "all", effect: "allow", description: "", when: "true" }];
    // doNotCall is also stopped by the gateway's built-in guard, so the policy-only case uses the registry attribute.
    const base = scenario(ventas, "registro-no-llame");
    const result = await gate(ventas, {
      policies: lenient,
      scenarios: [{ ...base, contact: { ...base.contact, doNotCall: false } }],
    });
    expect(result.passed).toBe(false);
    expect(result.levels.policy).toBe("failed");
    expect(result.failures.map((f) => f.reason).join("\n")).toContain("send_whatsapp");
  });

  it("refuses to reschedule without a verified DNI when the caller cannot give it", async () => {
    const lenient: PolicyRule[] = [{ id: "all", effect: "allow", description: "", when: "true" }];
    const result = await gate(recepcion, {
      policies: lenient,
      scenarios: [scenario(recepcion, "identidad-no-verificada")],
    });
    expect(result.failures.some((f) => f.reason.includes("reschedule_appointment"))).toBe(true);
  });

  it("fails the gate on a rule that does not compile", async () => {
    const broken: PolicyRule[] = [
      ...cobranza.policies,
      { id: "rota", effect: "deny", description: "", when: "tool.effect ==" },
    ];
    const result = await gate(cobranza, { policies: broken });
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toMatchObject({ scenario: "policy:rota" });
  });

  it("fails a tool_called the policy would refuse", async () => {
    const strict: PolicyRule[] = cobranza.policies.filter((p) => p.id !== "permitir-gestion");
    const result = await gate(cobranza, {
      policies: strict,
      scenarios: [scenario(cobranza, "promesa-de-pago")],
    });
    expect(result.passed).toBe(false);
  });

  it("flags a bot tool missing from the catalog", async () => {
    const version = draft(cobranza);
    version.config.tools = [...version.config.tools, "inventada"];
    const result = await runReleaseGate({
      orgId: "o",
      botVersion: version,
      scenarios: [scenario(cobranza, "promesa-de-pago")],
      policies: cobranza.policies,
    });
    expect(result.failures[0]!.reason).toContain("inventada");
  });
});

describe("level 2 with mock models", () => {
  const cobranza = getBuiltinPack("cobranza-ar") as Pack;
  const scenario = (id: string) => cobranza.scenarios.find((s) => s.id === id)!;

  it("runs a simulated conversation and asserts over the event log", async () => {
    const result = await gate(cobranza, {
      scenarios: [scenario("promesa-de-pago")],
      conversation: {
        model: mockModel([{ text: "[FIN]" }]),
        botModel: mockModel([
          { tool: "get_payment_options", input: { obligationId: "ob-1" } },
          {
            tool: "register_promise_to_pay",
            input: { obligationId: "ob-1", amount: 64000, promisedDate: "2026-10-09" },
          },
          { tool: "send_payment_link", input: { obligationId: "ob-1" } },
          { text: "Listo, quedó registrada tu promesa y te mandé el link." },
        ]),
      },
    });
    expect(result.failures).toEqual([]);
    expect(result).toMatchObject({
      passed: true,
      score: 1,
      levels: { policy: "passed", conversation: "passed" },
    });
  });

  it("fails the conversation level when the agent never does what the scenario expects", async () => {
    const result = await gate(cobranza, {
      scenarios: [scenario("promesa-de-pago")],
      conversation: {
        model: mockModel([{ text: "[FIN]" }]),
        botModel: mockModel([{ text: "Hola, ¿cómo estás?" }]),
      },
    });
    expect(result.passed).toBe(false);
    expect(result.levels).toEqual({ policy: "passed", conversation: "failed" });
    expect(
      result.failures.some(
        (f) => f.reason.startsWith("[conversación]") && f.reason.includes("get_payment_options"),
      ),
    ).toBe(true);
    expect(result.score).toBeLessThan(1);
  });

  it("records a refusal when the agent contacts out of hours, and counts it as not contacted", async () => {
    const result = await gate(cobranza, {
      scenarios: [scenario("fuera-de-horario")],
      conversation: {
        model: mockModel([{ text: "[FIN]" }]),
        botModel: mockModel([
          { tool: "send_payment_link", input: { obligationId: "ob-1" } },
          { text: "No puedo contactarte ahora." },
        ]),
      },
    });
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("uses the customer model to improvise after the scripted turns, until it says [FIN]", async () => {
    const customer = mockModel([{ text: "Dale, gracias." }, { text: "[FIN]" }]);
    const bot = mockModel([{ text: "De nada." }]);
    const r = await runScenario({
      orgId: "o",
      botVersion: draft(cobranza),
      policies: cobranza.policies,
      scenario: {
        ...scenario("fuera-de-horario"),
        turns: ["Hola"],
        assertions: [{ type: "agent_says_not", value: "embargo" }],
      },
      conversation: { model: customer, botModel: bot },
    });
    expect(r.conversation?.transcript).toEqual([
      "Cliente: Hola",
      "Agente: De nada.",
      "Cliente: Dale, gracias.",
      "Agente: De nada.",
    ]);
    expect(r.conversation?.passed).toBe(true);
  });

  it("fails scenarios instead of throwing when the simulation crashes", async () => {
    const broken = {
      ...mockModel([{ text: "x" }]),
      doGenerate: async () => {
        throw new Error("sin API key");
      },
      doStream: async () => {
        throw new Error("sin API key");
      },
    };
    const result = await gate(cobranza, {
      scenarios: [scenario("promesa-de-pago")],
      conversation: { model: mockModel([{ text: "[FIN]" }]), botModel: broken as never },
    });
    expect(result.levels.conversation).toBe("failed");
    expect(result.failures.some((f) => f.reason.includes("la simulación falló"))).toBe(true);
  });
});
