import { createStep, createWorkflow } from "@mastra/core/workflows";
import type {
  Clock,
  Contact,
  EventStore,
  HoldStore,
  JobQueue,
  MissionPlan,
  MissionRepository,
  MissionTarget,
  Obligation,
} from "@ofd/core";
import { z } from "zod";
import { type CalendarProvider, offerSlots } from "./calendar.js";
import type { MissionContactJob } from "./types.js";

export interface MissionPlannerInput {
  orgId: string;
  botId: string;
  missionId: string;
  instruction: string;
}

/** Turns an instruction into a plan. Injected so the LLM-backed planner and deterministic ones are interchangeable. */
export type MissionPlanner = (input: MissionPlannerInput) => Promise<MissionPlan>;

const targetSchema = z.object({
  contactId: z.string(),
  channel: z.enum(["whatsapp", "voice"]),
  offer: z.record(z.string(), z.unknown()),
  status: z.enum(["pending", "contacted", "succeeded", "no_answer", "escalated", "failed"]),
});
const planSchema = z.object({
  summary: z.string(),
  targets: z.array(targetSchema),
  estimatedMinutes: z.number(),
  channelStrategy: z.object({
    first: z.enum(["whatsapp", "voice"]),
    fallbackAfterMinutes: z.number().nullable(),
  }),
});

const missionInput = z.object({
  orgId: z.string(),
  botId: z.string(),
  missionId: z.string(),
  instruction: z.string(),
  autonomy: z.number().int().min(1).max(5),
  /** User who created the mission; used when no approval is needed. */
  createdBy: z.string().optional(),
});
const planned = missionInput.extend({ plan: planSchema });
const decided = planned.extend({ approved: z.boolean(), approvedBy: z.string().nullable() });

export const MissionApproval = z.object({ approved: z.boolean(), userId: z.string() });
export type MissionApproval = z.infer<typeof MissionApproval>;

export interface MissionWorkflowDeps {
  planner: MissionPlanner;
  jobs: JobQueue;
  missions: MissionRepository;
  events?: EventStore;
}

const emit = (
  deps: MissionWorkflowDeps,
  orgId: string,
  type: "mission.planned" | "mission.approved",
  payload: never,
) =>
  deps.events?.append({
    orgId,
    type,
    payload,
    conversationId: null,
    botVersionId: null,
    contactId: null,
    actorKind: "system",
    actorId: "mission",
    traceId: null,
  });

export function createMissionWorkflow(deps: MissionWorkflowDeps) {
  const plan = createStep({
    id: "plan",
    inputSchema: missionInput,
    outputSchema: planned,
    async execute({ inputData }) {
      const result = await deps.planner({
        orgId: inputData.orgId,
        botId: inputData.botId,
        missionId: inputData.missionId,
        instruction: inputData.instruction,
      });
      const needsApproval = inputData.autonomy <= 3;
      await deps.missions.update(inputData.orgId, inputData.missionId, {
        plan: result,
        status: needsApproval ? "awaiting_approval" : "planning",
      });
      await emit(deps, inputData.orgId, "mission.planned", {
        missionId: inputData.missionId,
        targets: result.targets.length,
      } as never);
      return { ...inputData, plan: result };
    },
  });

  const approval = createStep({
    id: "approval",
    inputSchema: planned,
    outputSchema: decided,
    resumeSchema: MissionApproval,
    suspendSchema: z.object({ missionId: z.string(), summary: z.string(), targets: z.number() }),
    async execute({ inputData, resumeData, suspend }) {
      if (inputData.autonomy > 3)
        return { ...inputData, approved: true, approvedBy: inputData.createdBy ?? null };
      if (!resumeData) {
        return await suspend({
          missionId: inputData.missionId,
          summary: inputData.plan.summary,
          targets: inputData.plan.targets.length,
        });
      }
      if (!resumeData.approved) {
        await deps.missions.update(inputData.orgId, inputData.missionId, { status: "cancelled" });
        return { ...inputData, approved: false, approvedBy: resumeData.userId };
      }
      await emit(deps, inputData.orgId, "mission.approved", {
        missionId: inputData.missionId,
        userId: resumeData.userId,
      } as never);
      return { ...inputData, approved: true, approvedBy: resumeData.userId };
    },
  });

  const execute = createStep({
    id: "execute",
    inputSchema: decided,
    outputSchema: z.object({
      missionId: z.string(),
      status: z.enum(["running", "cancelled"]),
      enqueued: z.number(),
    }),
    async execute({ inputData }) {
      if (!inputData.approved)
        return { missionId: inputData.missionId, status: "cancelled" as const, enqueued: 0 };
      for (const target of inputData.plan.targets) {
        const job: MissionContactJob = {
          orgId: inputData.orgId,
          missionId: inputData.missionId,
          botId: inputData.botId,
          contactId: target.contactId,
          channel: target.channel,
          offer: target.offer,
        };
        // Singleton key makes a retried execute step idempotent per target.
        await deps.jobs.enqueue("mission.contact", job, {
          singletonKey: `${inputData.missionId}:${target.contactId}`,
        });
      }
      await deps.missions.update(inputData.orgId, inputData.missionId, { status: "running" });
      return {
        missionId: inputData.missionId,
        status: "running" as const,
        enqueued: inputData.plan.targets.length,
      };
    },
  });

  return createWorkflow({
    id: "mission",
    inputSchema: missionInput,
    outputSchema: z.object({
      missionId: z.string(),
      status: z.enum(["running", "cancelled"]),
      enqueued: z.number(),
    }),
  })
    .then(plan)
    .then(approval)
    .then(execute)
    .commit();
}

export interface RescheduleMissionDeps {
  /** Appointments falling inside [from, to), with their contact. No port lists obligations by date, so the caller supplies it. */
  appointments(
    orgId: string,
    range: { from: Date; to: Date },
  ): Promise<Array<{ contact: Contact; obligation: Obligation }>>;
  calendar: CalendarProvider;
  holds: HoldStore;
  clock?: Clock;
  /** Window in which replacement slots are offered, in days after tomorrow. Default 7. */
  offerWindowDays?: number;
  slotHoldSeconds?: number;
}

const DAY = 86_400_000;

/** Deterministic planner for the clinic case: everyone with an appointment tomorrow gets a held alternative slot. */
export function planRescheduleMission(deps: RescheduleMissionDeps): MissionPlanner {
  return async ({ orgId, instruction }) => {
    const now = deps.clock ? deps.clock.now() : new Date();
    const startOfTomorrow = new Date(now);
    startOfTomorrow.setHours(0, 0, 0, 0);
    startOfTomorrow.setTime(startOfTomorrow.getTime() + DAY);
    const endOfTomorrow = new Date(startOfTomorrow.getTime() + DAY);
    const window = {
      from: endOfTomorrow,
      to: new Date(endOfTomorrow.getTime() + (deps.offerWindowDays ?? 7) * DAY),
    };

    const rows = await deps.appointments(orgId, { from: startOfTomorrow, to: endOfTomorrow });
    const seen = new Set<string>();
    const targets: MissionTarget[] = [];
    for (const { contact, obligation } of rows) {
      if (obligation.kind !== "appointment" || contact.doNotCall || seen.has(contact.id)) continue;
      seen.add(contact.id);
      const [slot] = await offerSlots(
        deps.calendar,
        deps.holds,
        orgId,
        contact.id,
        window,
        1,
        deps.slotHoldSeconds ?? 24 * 3600,
      );
      targets.push({
        contactId: contact.id,
        channel: "whatsapp",
        offer: slot
          ? {
              type: "reschedule",
              obligationId: obligation.id,
              slotId: slot.id,
              start: slot.start.toISOString(),
              end: slot.end.toISOString(),
            }
          : { type: "reschedule", obligationId: obligation.id, slotId: null },
        status: "pending",
      });
    }
    const withSlot = targets.filter((t) => t.offer["slotId"]).length;
    return {
      summary: `${instruction} — ${targets.length} pacientes con turno mañana, ${withSlot} con horario alternativo reservado.`,
      targets,
      estimatedMinutes: Math.max(5, targets.length * 2),
      channelStrategy: { first: "whatsapp", fallbackAfterMinutes: 120 },
    };
  };
}
