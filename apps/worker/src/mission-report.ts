import type { EventStore, MissionPlan, MissionReport, MissionRepository, MissionTarget } from "@ofd/core";
import { appendSystemEvent } from "./deps.js";

export const isFinalTargetStatus = (s: MissionTarget["status"]) => s !== "pending" && s !== "contacted";

export function computeReport(targets: MissionTarget[]): MissionReport {
  const count = (s: MissionTarget["status"]) => targets.filter((t) => t.status === s).length;
  return {
    total: targets.length,
    succeeded: count("succeeded"),
    noAnswer: count("no_answer"),
    escalated: count("escalated"),
    failed: count("failed"),
  };
}

/** Writes the final report and completes the mission when every target is final. Returns true when it completed. */
export async function completeMissionIfDone(
  deps: { missions: MissionRepository; events: EventStore },
  orgId: string,
  missionId: string,
  plan: MissionPlan,
): Promise<boolean> {
  if (!plan.targets.every((t) => isFinalTargetStatus(t.status))) return false;
  const report = computeReport(plan.targets);
  await deps.missions.update(orgId, missionId, { status: "completed", report, plan });
  await appendSystemEvent(deps.events, { orgId, type: "mission.completed", payload: { missionId, report }, actorId: "mission.contact" });
  return true;
}

/**
 * Sets one target's status in the stored plan, then completes the mission if that was the last open target.
 * Read-modify-write on the plan: safe while the queue runs one handler at a time per worker.
 * TODO: lock the mission row (or keep target status in its own table) before running several workers.
 */
export async function updateTargetStatus(
  deps: { missions: MissionRepository; events: EventStore },
  orgId: string,
  missionId: string,
  contactId: string,
  status: MissionTarget["status"],
): Promise<void> {
  const mission = await deps.missions.get(orgId, missionId);
  if (!mission?.plan) return;
  const plan: MissionPlan = {
    ...mission.plan,
    targets: mission.plan.targets.map((t) => (t.contactId === contactId ? { ...t, status } : t)),
  };
  if (mission.status === "completed" || mission.status === "cancelled") return;
  if (!(await completeMissionIfDone(deps, orgId, missionId, plan))) {
    await deps.missions.update(orgId, missionId, { plan });
  }
}
