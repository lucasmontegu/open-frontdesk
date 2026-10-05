import type { MissionContactJob } from "@ofd/agent";
import type { EventStore, JobQueue, MissionRepository } from "@ofd/core";
import { z } from "zod";
import { type Log, PermanentJobError, silentLog } from "../deps.js";
import { completeMissionIfDone } from "../mission-report.js";

/** The API sets status "running" and appends mission.approved before enqueueing, so any open status is accepted. */
export const MissionExecuteJob = z.object({
  orgId: z.string().min(1),
  missionId: z.string().min(1),
  approvedBy: z.string().nullish(),
});

export interface MissionExecuteDeps {
  missions: MissionRepository;
  jobs: JobQueue;
  events: EventStore;
  log?: Log;
}

export const contactSingletonKey = (missionId: string, contactId: string) =>
  `${missionId}:${contactId}`;

/** Fans a planned mission out into one mission.contact job per target. */
export async function missionExecute(deps: MissionExecuteDeps, data: unknown): Promise<void> {
  const { orgId, missionId } = MissionExecuteJob.parse(data);
  const log = deps.log ?? silentLog;

  const mission = await deps.missions.get(orgId, missionId);
  if (!mission) throw new PermanentJobError(`mission ${missionId} not found`);
  if (!mission.plan) throw new PermanentJobError(`mission ${missionId} has no plan`);
  if (
    mission.status === "cancelled" ||
    mission.status === "completed" ||
    mission.status === "failed"
  ) {
    log.info({ missionId, status: mission.status }, "mission.execute skipped");
    return;
  }

  if (mission.plan.targets.length === 0) {
    await completeMissionIfDone(deps, orgId, missionId, mission.plan);
    return;
  }

  for (const target of mission.plan.targets) {
    if (target.status !== "pending") continue; // a retried execute only fills the gaps
    const job: MissionContactJob = {
      orgId,
      missionId,
      botId: mission.botId,
      contactId: target.contactId,
      channel: target.channel,
      offer: target.offer,
    };
    await deps.jobs.enqueue("mission.contact", job, {
      singletonKey: contactSingletonKey(missionId, target.contactId),
    });
  }
  await deps.missions.update(orgId, missionId, { status: "running" });
  log.info({ missionId, targets: mission.plan.targets.length }, "mission running");
}
