import type { BotVersion, PolicyRule } from "@ofd/core";
import type { LanguageModel } from "@ofd/agent";
import type { Assertion, EvalScenario } from "@ofd/packs";

export interface EvalFailure {
  scenario: string;
  reason: string;
}

export interface EvalRunResult {
  passed: boolean;
  /** passed assertions / total checked assertions, 0..1 */
  score: number;
  summary: string;
  failures: EvalFailure[];
  levels: { policy: "passed" | "failed"; conversation: "passed" | "failed" | "skipped" };
}

/**
 * Level 2 settings. `model` drives the simulated customer. The bot under test uses its own
 * `config.model` unless `botModel` overrides it (the CLI sets both from `--model`).
 * Both accept a model id or a ready language model object, which is how tests inject mocks.
 */
export interface ConversationOptions {
  model: string | LanguageModel;
  botModel?: string | LanguageModel;
  /** Maximum customer turns per scenario. Default 8. */
  maxTurns?: number;
}

export interface ReleaseGateInput {
  orgId: string;
  botVersion: BotVersion;
  scenarios: EvalScenario[];
  /** Org rules + pack rules. */
  policies: PolicyRule[];
  /** When null or absent, the LLM conversation level is skipped. */
  conversation?: ConversationOptions | null;
}

export interface ScenarioInput {
  orgId: string;
  botVersion: BotVersion;
  scenario: EvalScenario;
  policies: PolicyRule[];
  conversation?: ConversationOptions | null;
}

/** `deferred`: the assertion cannot be decided at this level (level 1 defers behavioral assertions to level 2). */
export type CheckStatus = "passed" | "failed" | "deferred";

export interface AssertionCheck {
  assertion: Assertion;
  status: CheckStatus;
  reason?: string;
}

export interface LevelResult {
  passed: boolean;
  checks: AssertionCheck[];
  /** Problems that are not tied to one assertion (bad tool name, simulation crash). Any error fails the level. */
  errors: string[];
  /** Level 2 only: the simulated conversation, "Cliente: ..." / "Agente: ...". */
  transcript?: string[];
}

export interface ScenarioResult {
  scenarioId: string;
  title: string;
  policy: LevelResult;
  conversation: LevelResult | null;
}
