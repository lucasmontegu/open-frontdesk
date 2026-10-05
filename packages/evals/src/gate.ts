import type { PolicyRule } from "@ofd/core";
import { validateRule } from "@ofd/gateway";
import { runPolicyLevel } from "./level1.js";
import { runConversationLevelSafe } from "./level2.js";
import type {
  AssertionCheck,
  EvalFailure,
  EvalRunResult,
  LevelResult,
  ReleaseGateInput,
  ScenarioInput,
  ScenarioResult,
} from "./types.js";

/** Runs one scenario at level 1 and, when `conversation` is given, at level 2. */
export async function runScenario(input: ScenarioInput): Promise<ScenarioResult> {
  const { scenario } = input;
  let policy: LevelResult;
  try {
    policy = await runPolicyLevel(input);
  } catch (e) {
    const reason = `error al evaluar la política: ${e instanceof Error ? e.message : String(e)}`;
    policy = { passed: false, checks: [], errors: [reason] };
  }
  const conversation = input.conversation ? await runConversationLevelSafe(input) : null;
  return { scenarioId: scenario.id, title: scenario.title, policy, conversation };
}

const describeCheck = (c: AssertionCheck) =>
  `${c.assertion.type} ${c.assertion.value}: ${c.reason ?? "falló"}`;

function collect(scenarioId: string, level: LevelResult, prefix: string, failures: EvalFailure[]) {
  for (const e of level.errors) failures.push({ scenario: scenarioId, reason: `${prefix}${e}` });
  for (const c of level.checks)
    if (c.status === "failed")
      failures.push({ scenario: scenarioId, reason: `${prefix}${describeCheck(c)}` });
}

/**
 * The publish gate. Level 1 (policy) always runs and needs no network; level 2 (simulated
 * conversations) runs only when `conversation` is given. The gate passes only if every level that ran passed.
 */
export async function runReleaseGate(input: ReleaseGateInput): Promise<EvalRunResult> {
  const failures: EvalFailure[] = [];
  let passedCount = 0;
  let failedCount = 0;
  let deferredCount = 0;

  let policyOk = true;
  for (const rule of input.policies) {
    const v = validateRule(rule);
    if (v.ok) {
      passedCount++;
    } else {
      failedCount++;
      policyOk = false;
      failures.push({ scenario: `policy:${rule.id}`, reason: `la regla no compila: ${v.error}` });
    }
  }

  let conversationOk = true;
  for (const scenario of input.scenarios) {
    const result = await runScenario({
      orgId: input.orgId,
      botVersion: input.botVersion,
      policies: input.policies,
      scenario,
      conversation: input.conversation ?? null,
    });
    for (const [level, prefix] of [
      [result.policy, input.conversation ? "[política] " : ""],
      [result.conversation, "[conversación] "],
    ] as const) {
      if (!level) continue;
      collect(scenario.id, level, prefix, failures);
      for (const c of level.checks) {
        if (c.status === "passed") passedCount++;
        else if (c.status === "failed") failedCount++;
        else deferredCount++;
      }
      failedCount += level.errors.length;
    }
    if (!result.policy.passed) policyOk = false;
    if (result.conversation && !result.conversation.passed) conversationOk = false;
  }

  const total = passedCount + failedCount;
  const score = total === 0 ? 1 : passedCount / total;
  const conversationLevel = input.conversation ? (conversationOk ? "passed" : "failed") : "skipped";
  const passed = policyOk && conversationLevel !== "failed";

  const parts = [
    `Política: ${policyOk ? "OK" : "FALLÓ"}`,
    input.conversation
      ? `Conversación: ${conversationOk ? "OK" : "FALLÓ"}`
      : "Conversación: omitida",
    `${passedCount}/${total} verificaciones correctas en ${input.scenarios.length} escenarios y ${input.policies.length} reglas`,
  ];
  if (!input.conversation && deferredCount > 0)
    parts.push(
      `${deferredCount} verificaciones de comportamiento quedan para el nivel de conversación`,
    );
  if (failures.length > 0) parts.push(`${failures.length} fallas`);

  return {
    passed,
    score,
    summary: `${parts.join(". ")}.`,
    failures,
    levels: { policy: policyOk ? "passed" : "failed", conversation: conversationLevel },
  };
}

/** Save-time check: the rules that do not compile with the gateway's CEL engine. */
export function invalidPolicyRules(rules: PolicyRule[]): Array<{ ruleId: string; error: string }> {
  const bad: Array<{ ruleId: string; error: string }> = [];
  for (const rule of rules) {
    const v = validateRule(rule);
    if (!v.ok) bad.push({ ruleId: rule.id, error: v.error });
  }
  return bad;
}
