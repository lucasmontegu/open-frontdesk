import type { MissionPlan } from "@ofd/core";
import { describe, expect, it } from "vitest";
import { FakeBots, FakeEvents, FakeJobs, FakeMissions, makeVersion, ORG } from "../fakes.js";
import { missionPlan } from "./mission-plan.js";

const plan: MissionPlan = {
  summary: "plan",
  targets: [{ contactId: "c1", channel: "whatsapp", offer: {}, status: "pending" }],
  estimatedMinutes: 5,
  channelStrategy: { first: "whatsapp", fallbackAfterMinutes: 120 },
};

function setup(autonomy: 1 | 2 | 3 | 4 | 5) {
  const missions = new FakeMissions();
  missions.add({ id: "m1", instruction: "reprogramar los turnos de mañana" });
  const events = new FakeEvents();
  const jobs = new FakeJobs();
  const instructions: string[] = [];
  const deps = {
    missions,
    bots: new FakeBots(makeVersion({ autonomy })) as never,
    events,
    jobs,
    plannerFor: (instruction: string) => {
      instructions.push(instruction);
      return async () => plan;
    },
  };
  return { deps, missions, events, jobs, instructions };
}

describe("mission.plan", () => {
  it("waits for approval when autonomy is 3 or lower", async () => {
    const { deps, missions, events, jobs, instructions } = setup(3);
    await missionPlan(deps, { orgId: ORG, missionId: "m1" });
    const m = missions.items.get("m1");
    expect(m?.status).toBe("awaiting_approval");
    expect(m?.plan).toEqual(plan);
    expect(jobs.of("mission.execute")).toHaveLength(0);
    expect(events.ofType("mission.planned")[0]?.payload).toEqual({ missionId: "m1", targets: 1 });
    expect(instructions).toEqual(["reprogramar los turnos de mañana"]);
  });

  it("enqueues mission.execute when autonomy is above 3", async () => {
    const { deps, missions, jobs } = setup(4);
    await missionPlan(deps, { orgId: ORG, missionId: "m1" });
    expect(missions.items.get("m1")?.status).toBe("planning");
    expect(jobs.of("mission.execute")).toHaveLength(1);
  });

  it("does not re-plan a mission that already moved on", async () => {
    const { deps, missions, events } = setup(3);
    missions.items.set("m1", { ...(missions.items.get("m1") as never), status: "running" });
    await missionPlan(deps, { orgId: ORG, missionId: "m1" });
    expect(events.all).toHaveLength(0);
  });

  it("fails the mission when the bot has no published version", async () => {
    const { deps, missions } = setup(3);
    (deps.bots as unknown as FakeBots).version = null;
    await expect(missionPlan(deps, { orgId: ORG, missionId: "m1" })).rejects.toThrow(/published/);
    expect(missions.items.get("m1")?.status).toBe("failed");
  });
});

describe("mission.plan payload", () => {
  it("accepts the API payload", async () => {
    const { deps } = setup(3);
    await missionPlan(deps, {
      orgId: ORG,
      missionId: "m1",
      botId: "bot_1",
      instruction: "x",
      autonomy: 3,
      createdBy: "user_1",
    });
  });
});
