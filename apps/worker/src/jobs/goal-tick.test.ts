import { describe, expect, it } from "vitest";
import { GoalSpec } from "@ofd/core";
import { ORG } from "../fakes.js";
import { goalTick, type GoalState, type GoalStore } from "./goal-tick.js";

const now = new Date("2026-10-05T12:00:00Z");

function store(over: Partial<GoalState> = {}) {
  const state: GoalState = {
    id: "g1", orgId: ORG, enabled: true, lastTickAt: null, consecutiveFailures: 0,
    spec: GoalSpec.parse({ portfolioId: "pf", objective: "cobrar", kpi: { metric: "recovered", target: 10 }, budgetMinutes: 60, until: "2026-12-01T00:00:00Z", minIntervalMinutes: 60, maxConsecutiveFailures: 3 }),
    ...over,
  };
  const goals: GoalStore = {
    async get() { return state; },
    async save(_o, _g, patch) { Object.assign(state, patch); },
  };
  return { state, goals };
}
const data = { orgId: ORG, goalId: "g1" };

describe("goal.tick", () => {
  it("is a no-op without a store", async () => {
    expect(await goalTick({ goals: null }, data)).toBe("not_configured");
  });

  it("respects minIntervalMinutes", async () => {
    const { goals } = store({ lastTickAt: new Date(now.getTime() - 30 * 60_000) });
    let ran = 0;
    expect(await goalTick({ goals, clock: { now: () => now }, runTick: async () => void ran++ }, data)).toBe("too_soon");
    expect(ran).toBe(0);
  });

  it("runs and resets failures", async () => {
    const { goals, state } = store({ consecutiveFailures: 2, lastTickAt: new Date(now.getTime() - 61 * 60_000) });
    expect(await goalTick({ goals, clock: { now: () => now }, runTick: async () => {} }, data)).toBe("ran");
    expect(state.consecutiveFailures).toBe(0);
    expect(state.lastTickAt).toEqual(now);
  });

  it("auto-disables after maxConsecutiveFailures", async () => {
    const { goals, state } = store({ consecutiveFailures: 2 });
    const deps = { goals, clock: { now: () => now }, runTick: async () => { throw new Error("x"); } };
    expect(await goalTick(deps, data)).toBe("auto_disabled");
    expect(state.enabled).toBe(false);
    expect(await goalTick(deps, data)).toBe("disabled");
  });

  it("disables expired goals", async () => {
    const { goals, state } = store({ spec: GoalSpec.parse({ portfolioId: "pf", objective: "o", kpi: { metric: "m", target: 1 }, budgetMinutes: 1, until: "2026-01-01T00:00:00Z" }) });
    expect(await goalTick({ goals, clock: { now: () => now } }, data)).toBe("expired");
    expect(state.enabled).toBe(false);
  });
});
