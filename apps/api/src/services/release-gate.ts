import type { BotVersion, PolicyRule } from "@ofd/core";
import type { Repositories } from "@ofd/db";
import { runReleaseGate } from "@ofd/evals";
import type { EvalScenario } from "@ofd/packs";

export interface ReleaseGateInput {
  orgId: string;
  botVersion: BotVersion;
  scenarios: EvalScenario[];
  policies: PolicyRule[];
  /** Model for the conversation-level evals; null runs the policy level only. */
  conversation?: { model: string } | null;
}

export interface EvalRunRecord {
  id: string;
  passed: boolean;
  score: number;
  summary: string;
  failures: { scenario: string; reason: string }[];
}

/** Runs the evals and persists the eval run. Injectable on the container so tests can stub it. */
export type ReleaseGate = (input: ReleaseGateInput) => Promise<EvalRunRecord>;

/**
 * The only module that touches @ofd/evals and the evalRuns repository, so the rest of the app
 * compiles even while those are in flux.
 */
export function createReleaseGate(repos: Repositories): ReleaseGate {
  return async (input) => {
    const result = await runReleaseGate({
      orgId: input.orgId,
      botVersion: input.botVersion,
      scenarios: input.scenarios,
      policies: input.policies,
      conversation: input.conversation ?? null,
    });
    const row = await repos.evalRuns.create(input.orgId, {
      botVersionId: input.botVersion.id,
      passed: result.passed,
      score: result.score,
      summary: result.summary,
      failures: result.failures,
    });
    return {
      id: row.id,
      passed: result.passed,
      score: result.score,
      summary: result.summary,
      failures: result.failures,
    };
  };
}
