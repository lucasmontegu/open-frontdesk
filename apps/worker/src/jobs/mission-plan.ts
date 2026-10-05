import { z } from "zod";
import type { BotRepository, EventStore, JobQueue, MissionRepository } from "@ofd/core";
import type { MissionPlanner } from "@ofd/agent";
import { appendSystemEvent, type Log, PermanentJobError, silentLog } from "../deps.js";

/** Payload enqueued by the API. The extra fields are informational: the mission row is the source of truth. */
export const MissionPlanJob = z.object({
  orgId: z.string().min(1),
  missionId: z.string().min(1),
  botId: z.string().optional(),
  instruction: z.string().optional(),
  autonomy: z.number().optional(),
  createdBy: z.string().optional(),
});
export type MissionPlanJob = z.infer<typeof MissionPlanJob>;

export interface MissionPlanDeps {
  missions: MissionRepository;
  bots: BotRepository;
  events: EventStore;
  jobs: JobQueue;
  plannerFor(instruction: string): MissionPlanner;
  log?: Log;
}

/** Autonomy at or below this level needs the owner's approval before a mission runs. */
export const MAX_AUTONOMY_NEEDING_APPROVAL = 3;

export async function missionPlan(deps: MissionPlanDeps, data: unknown): Promise<void> {
  const { orgId, missionId } = MissionPlanJob.parse(data);
  const log = deps.log ?? silentLog;

  const mission = await deps.missions.get(orgId, missionId);
  if (!mission) throw new PermanentJobError(`mission ${missionId} not found`);
  // A retried job must not re-plan (and re-hold slots) a mission that already moved on.
  if (mission.status !== "planning") {
    log.info({ missionId, status: mission.status }, "mission.plan skipped: not in planning");
    return;
  }

  const bot = await deps.bots.get(orgId, mission.botId);
  const version = bot?.publishedVersionId ? await deps.bots.getVersion(orgId, bot.publishedVersionId) : null;
  if (!version) {
    await deps.missions.update(orgId, missionId, { status: "failed" });
    throw new PermanentJobError(`bot ${mission.botId} has no published version`);
  }

  const plan = await deps.plannerFor(mission.instruction)({
    orgId,
    botId: mission.botId,
    missionId,
    instruction: mission.instruction,
  });

  const needsApproval = version.config.autonomy <= MAX_AUTONOMY_NEEDING_APPROVAL;
  await deps.missions.update(orgId, missionId, { plan, status: needsApproval ? "awaiting_approval" : "planning" });
  await appendSystemEvent(deps.events, {
    orgId,
    type: "mission.planned",
    payload: { missionId, targets: plan.targets.length },
    botVersionId: version.id,
    actorId: "mission.plan",
  });
  if (!needsApproval) await deps.jobs.enqueue("mission.execute", { orgId, missionId }, { singletonKey: `execute:${missionId}` });
  log.info({ missionId, targets: plan.targets.length, needsApproval }, "mission planned");
}
