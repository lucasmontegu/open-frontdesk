import type { Clock, ContactIdentity, MissionPlan, MissionTarget, PortfolioRepository } from "@ofd/core";
import { planRescheduleMission, type CalendarProvider, type MissionPlanner, type RescheduleMissionDeps } from "@ofd/agent";
import type { HoldStore } from "@ofd/core";
import type { AppointmentsLoader } from "./appointments.js";

export interface PlannerSelectorDeps {
  appointments: AppointmentsLoader;
  calendar: CalendarProvider;
  holds: HoldStore;
  portfolios: PortfolioRepository;
  clock?: Clock;
}

const APPOINTMENT_WORDS = /\b(turnos?|citas?|appointments?|reprogram\w*|reagend\w*|reschedul\w*)\b/i;

export const isAppointmentInstruction = (instruction: string): boolean => APPOINTMENT_WORDS.test(instruction);

const normalize = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const reachable = (identities: ContactIdentity[]) => identities.some((i) => i.kind === "whatsapp" || i.kind === "phone");

const MAX_TARGETS = 500;

/**
 * Generic planner: targets the members of a portfolio. The portfolio is the one whose name the
 * instruction mentions, or the only one the org has.
 * TODO: let the LLM planner pick the portfolio and build a per-contact offer.
 */
export function planPortfolioMission(deps: Pick<PlannerSelectorDeps, "portfolios">): MissionPlanner {
  return async ({ orgId, instruction }): Promise<MissionPlan> => {
    const all = await deps.portfolios.list(orgId);
    const text = normalize(instruction);
    const named = all.filter((p) => text.includes(normalize(p.name)));
    const chosen = named.length === 1 ? named[0] : all.length === 1 ? all[0] : undefined;
    const empty = (summary: string): MissionPlan => ({
      summary,
      targets: [],
      estimatedMinutes: 0,
      channelStrategy: { first: "whatsapp", fallbackAfterMinutes: null },
    });
    if (!chosen) return empty(`${instruction} — no se pudo determinar la cartera; mencioná su nombre en la instrucción.`);

    const targets: MissionTarget[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = await deps.portfolios.members(orgId, chosen.id, { limit: 100, cursor });
      for (const { contact, obligation } of page.items) {
        if (seen.has(contact.id) || contact.doNotCall || !reachable(contact.identities)) continue;
        seen.add(contact.id);
        targets.push({
          contactId: contact.id,
          channel: "whatsapp",
          offer: { type: "outreach", obligationId: obligation.id, kind: obligation.kind, amount: obligation.amount, currency: obligation.currency, instruction },
          status: "pending",
        });
      }
      cursor = page.nextCursor;
    } while (cursor && targets.length < MAX_TARGETS);

    return {
      summary: `${instruction} — ${targets.length} contactos de la cartera "${chosen.name}".`,
      targets: targets.slice(0, MAX_TARGETS),
      estimatedMinutes: Math.max(5, targets.length * 2),
      channelStrategy: { first: "whatsapp", fallbackAfterMinutes: 120 },
    };
  };
}

/** Picks the planner for an instruction: appointment/turno wording uses the reschedule planner, anything else the portfolio one. */
export function createPlannerSelector(deps: PlannerSelectorDeps): (instruction: string) => MissionPlanner {
  const reschedule: RescheduleMissionDeps = {
    appointments: deps.appointments,
    calendar: deps.calendar,
    holds: deps.holds,
    ...(deps.clock ? { clock: deps.clock } : {}),
  };
  const rescheduler = planRescheduleMission(reschedule);
  const generic = planPortfolioMission(deps);
  return (instruction) => (isAppointmentInstruction(instruction) ? rescheduler : generic);
}
