import { Mastra } from "@mastra/core";
import { InMemoryStore } from "@mastra/core/storage";
import { describe, expect, it } from "vitest";
import type { Contact, JobName, JobQueue, MissionRepository, Obligation } from "@ofd/core";
import { InMemoryCalendar, InMemoryHoldStore } from "./calendar.js";
import { createMissionWorkflow, planRescheduleMission } from "./mission.js";

const t0 = new Date("2026-10-05T10:00:00");
const tomorrow = new Date("2026-10-06T10:00:00");
const contact = (id: string): Contact => ({ id, orgId: "org1", displayName: id, identities: [], attributes: {}, tags: [], doNotCall: false, createdAt: t0, updatedAt: t0 });
const appt = (c: string): Obligation => ({ id: "ob-" + c, orgId: "org1", contactId: c, portfolioId: null, kind: "appointment", stage: "scheduled", amount: null, currency: null, dueAt: tomorrow, attributes: {}, createdAt: t0, updatedAt: t0 });

function rig() {
  const calendar = new InMemoryCalendar();
  calendar.addSlots("org1", [8, 9, 10].map((d) => ({ start: new Date(`2026-10-0${d > 9 ? 9 : 8}T1${d - 8}:00:00`), end: new Date(`2026-10-0${d > 9 ? 9 : 8}T1${d - 7}:00:00`) })));
  const holds = new InMemoryHoldStore();
  const planner = planRescheduleMission({
    appointments: async () => [c("a"), c("b")].map((x) => ({ contact: x, obligation: appt(x.id) })),
    calendar,
    holds,
    clock: { now: () => t0 },
  });
  const jobs: Array<{ name: string; data: any; opts: any }> = [];
  const updates: unknown[] = [];
  const missions = { update: async (_o: string, _id: string, patch: unknown) => (updates.push(patch), {}) } as unknown as MissionRepository;
  const queue = { enqueue: async (name: JobName, data: object, opts?: unknown) => (jobs.push({ name, data, opts }), "j") } as JobQueue;
  const workflow = createMissionWorkflow({ planner, jobs: queue, missions });
  // Suspend/resume snapshots need storage, so the workflow runs inside a Mastra instance.
  const mastra = new Mastra({ workflows: { mission: workflow }, storage: new InMemoryStore() });
  return { planner, jobs, updates, wf: mastra.getWorkflow("mission") };
  function c(id: string) {
    return contact(id);
  }
}

describe("planRescheduleMission", () => {
  it("gives each patient a different held slot", async () => {
    const { planner } = rig();
    const plan = await planner({ orgId: "org1", botId: "b", missionId: "m", instruction: "Reprogramá los turnos de mañana" });
    expect(plan.targets).toHaveLength(2);
    const ids = plan.targets.map((t) => t.offer["slotId"]);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every(Boolean)).toBe(true);
  });
});

describe("mission workflow", () => {
  const input = { orgId: "org1", botId: "b", missionId: "m1", instruction: "Reprogramá", autonomy: 3, createdBy: "u1" };

  it("suspends for approval at autonomy 3 and enqueues after resume", async () => {
    const { wf, jobs, updates } = rig();
    const run = await wf.createRun();
    const res = await run.start({ inputData: input });
    expect(res.status).toBe("suspended");
    expect(jobs).toHaveLength(0);
    expect(updates[0]).toMatchObject({ status: "awaiting_approval" });
    const done = await run.resume({ step: "approval", resumeData: { approved: true, userId: "u9" } });
    expect(done.status).toBe("success");
    expect(jobs.map((j) => j.name)).toEqual(["mission.contact", "mission.contact"]);
    expect(updates.at(-1)).toMatchObject({ status: "running" });
  });

  it("cancels when approval is declined", async () => {
    const { wf, jobs, updates } = rig();
    const run = await wf.createRun();
    await run.start({ inputData: input });
    await run.resume({ step: "approval", resumeData: { approved: false, userId: "u9" } });
    expect(jobs).toHaveLength(0);
    expect(updates.at(-1)).toMatchObject({ status: "cancelled" });
  });

  it("runs straight through at autonomy 4", async () => {
    const { wf, jobs } = rig();
    const res = await (await wf.createRun()).start({ inputData: { ...input, autonomy: 4 } });
    expect(res.status).toBe("success");
    expect(jobs).toHaveLength(2);
  });
});
