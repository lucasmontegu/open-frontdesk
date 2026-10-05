import { describe, expect, it } from "vitest";
import { FakeEvents, FakeJobs, FakeMissions, ORG } from "../fakes.js";
import { missionExecute } from "./mission-execute.js";

describe("mission.execute", () => {
  it("enqueues one singleton contact job per pending target and sets running", async () => {
    const missions = new FakeMissions();
    missions.add({
      id: "m1",
      status: "awaiting_approval",
      plan: {
        summary: "s",
        estimatedMinutes: 5,
        channelStrategy: { first: "whatsapp", fallbackAfterMinutes: null },
        targets: [
          { contactId: "c1", channel: "whatsapp", offer: { a: 1 }, status: "pending" },
          { contactId: "c2", channel: "voice", offer: {}, status: "pending" },
          { contactId: "c3", channel: "whatsapp", offer: {}, status: "contacted" },
        ],
      },
    });
    const jobs = new FakeJobs();
    await missionExecute(
      { missions, jobs, events: new FakeEvents() },
      { orgId: ORG, missionId: "m1" },
    );
    expect(missions.items.get("m1")?.status).toBe("running");
    expect(jobs.of("mission.contact").map((j) => j.opts?.singletonKey)).toEqual(["m1:c1", "m1:c2"]);
    expect(jobs.of("mission.contact")[0]?.data).toMatchObject({
      orgId: ORG,
      missionId: "m1",
      contactId: "c1",
      channel: "whatsapp",
      offer: { a: 1 },
    });
  });

  it("completes an empty plan right away", async () => {
    const missions = new FakeMissions();
    const events = new FakeEvents();
    missions.add({
      id: "m2",
      status: "planning",
      plan: {
        summary: "",
        estimatedMinutes: 0,
        targets: [],
        channelStrategy: { first: "whatsapp", fallbackAfterMinutes: null },
      },
    });
    await missionExecute(
      { missions, jobs: new FakeJobs(), events },
      { orgId: ORG, missionId: "m2" },
    );
    expect(missions.items.get("m2")?.status).toBe("completed");
    expect(events.ofType("mission.completed")).toHaveLength(1);
  });

  it("skips cancelled missions", async () => {
    const missions = new FakeMissions();
    missions.add({
      id: "m3",
      status: "cancelled",
      plan: {
        summary: "",
        estimatedMinutes: 0,
        targets: [{ contactId: "c", channel: "whatsapp", offer: {}, status: "pending" }],
        channelStrategy: { first: "whatsapp", fallbackAfterMinutes: null },
      },
    });
    const jobs = new FakeJobs();
    await missionExecute(
      { missions, jobs, events: new FakeEvents() },
      { orgId: ORG, missionId: "m3" },
    );
    expect(jobs.sent).toHaveLength(0);
  });
});

describe("mission.execute from the API", () => {
  it("accepts the API payload and a mission already marked running", async () => {
    const missions = new FakeMissions();
    missions.add({
      id: "m4",
      status: "running",
      plan: {
        summary: "",
        estimatedMinutes: 1,
        channelStrategy: { first: "whatsapp", fallbackAfterMinutes: null },
        targets: [{ contactId: "c1", channel: "whatsapp", offer: {}, status: "pending" }],
      },
    });
    const jobs = new FakeJobs();
    await missionExecute(
      { missions, jobs, events: new FakeEvents() },
      { orgId: ORG, missionId: "m4", approvedBy: "user_1" },
    );
    expect(jobs.of("mission.contact")).toHaveLength(1);
  });
});
