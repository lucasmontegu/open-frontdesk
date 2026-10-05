import type { JobName } from "@ofd/core";
import { crmSync, type CrmSyncDeps } from "./jobs/crm-sync.js";
import { extractFacts, type ExtractFactsDeps } from "./jobs/extract-facts.js";
import { goalTick, type GoalTickDeps } from "./jobs/goal-tick.js";
import { missionContact, type MissionContactDeps } from "./jobs/mission-contact.js";
import { missionExecute, type MissionExecuteDeps } from "./jobs/mission-execute.js";
import { missionPlan, type MissionPlanDeps } from "./jobs/mission-plan.js";

export interface HandlerDeps {
  missionPlan: MissionPlanDeps;
  missionExecute: MissionExecuteDeps;
  missionContact: MissionContactDeps;
  extractFacts: ExtractFactsDeps;
  goalTick: GoalTickDeps;
  crmSync: CrmSyncDeps;
}

/** The queue surface registration needs; PgBossJobQueue satisfies it. */
export interface WorkRegistrar {
  work<T extends object>(name: JobName, handler: (data: T, meta: { id: string; signal: AbortSignal }) => Promise<void>): Promise<string>;
}

export type Handlers = Record<JobName, (data: unknown) => Promise<void>>;

export function createHandlers(deps: HandlerDeps): Handlers {
  return {
    "mission.plan": (d) => missionPlan(deps.missionPlan, d),
    "mission.execute": (d) => missionExecute(deps.missionExecute, d),
    "mission.contact": (d) => missionContact(deps.missionContact, d),
    "conversation.extract_facts": async (d) => void (await extractFacts(deps.extractFacts, d)),
    "goal.tick": async (d) => void (await goalTick(deps.goalTick, d)),
    "crm.sync": async (d) => void (await crmSync(deps.crmSync, d)),
  };
}

/** Registers every handler. Returns the job names registered. */
export async function registerHandlers(queue: WorkRegistrar, handlers: Handlers): Promise<JobName[]> {
  const names = Object.keys(handlers) as JobName[];
  for (const name of names) {
    await queue.work<object>(name, async (data) => handlers[name](data));
  }
  return names;
}
