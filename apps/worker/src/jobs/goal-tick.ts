import type { Clock, GoalSpec } from "@ofd/core";
import { z } from "zod";
import { type Log, silentLog, systemClock } from "../deps.js";

export const GoalTickJob = z.object({ orgId: z.string().min(1), goalId: z.string().min(1) });

/**
 * Persistent state of a goal. TODO: core has no GoalRepository port or goals table yet (see NEEDS.md);
 * until then the container wires no store and the handler is a logged no-op.
 */
export interface GoalState {
  id: string;
  orgId: string;
  spec: GoalSpec;
  enabled: boolean;
  lastTickAt: Date | null;
  consecutiveFailures: number;
}

export interface GoalStore {
  get(orgId: string, goalId: string): Promise<GoalState | null>;
  save(
    orgId: string,
    goalId: string,
    patch: Partial<Pick<GoalState, "enabled" | "lastTickAt" | "consecutiveFailures">>,
  ): Promise<void>;
}

export interface GoalTickDeps {
  goals: GoalStore | null;
  /**
   * One planning pass for the goal. TODO: read the KPI, pick contacts from the portfolio within the
   * remaining budget, enqueue mission.contact jobs with initiator "goal".
   */
  runTick?: (goal: GoalState) => Promise<void>;
  clock?: Clock;
  log?: Log;
}

export type GoalTickOutcome =
  | "not_configured"
  | "not_found"
  | "disabled"
  | "expired"
  | "too_soon"
  | "ran"
  | "failed"
  | "auto_disabled";

export async function goalTick(deps: GoalTickDeps, data: unknown): Promise<GoalTickOutcome> {
  const { orgId, goalId } = GoalTickJob.parse(data);
  const log = deps.log ?? silentLog;
  const now = (deps.clock ?? systemClock).now();
  if (!deps.goals) {
    log.warn({ goalId }, "goal.tick: no goal store configured");
    return "not_configured";
  }
  const goal = await deps.goals.get(orgId, goalId);
  if (!goal) return "not_found";
  if (!goal.enabled) return "disabled";
  if (now >= goal.spec.until) {
    await deps.goals.save(orgId, goalId, { enabled: false });
    return "expired";
  }
  // Safety limit: never tick more often than minIntervalMinutes, whatever the scheduler does.
  if (
    goal.lastTickAt &&
    now.getTime() - goal.lastTickAt.getTime() < goal.spec.minIntervalMinutes * 60_000
  )
    return "too_soon";

  try {
    await deps.runTick?.(goal);
    await deps.goals.save(orgId, goalId, { lastTickAt: now, consecutiveFailures: 0 });
    return "ran";
  } catch (err) {
    const failures = goal.consecutiveFailures + 1;
    const disable = failures >= goal.spec.maxConsecutiveFailures;
    log.error(
      { goalId, failures, err: err instanceof Error ? err.message : String(err) },
      "goal.tick failed",
    );
    await deps.goals.save(orgId, goalId, {
      lastTickAt: now,
      consecutiveFailures: failures,
      ...(disable ? { enabled: false } : {}),
    });
    return disable ? "auto_disabled" : "failed";
  }
}
