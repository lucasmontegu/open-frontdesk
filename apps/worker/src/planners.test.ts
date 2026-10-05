import { InMemoryCalendar } from "@ofd/agent";
import type { Obligation, Portfolio, PortfolioRepository } from "@ofd/core";
import { describe, expect, it } from "vitest";
import { makeContact, ORG } from "./fakes.js";
import { createPlannerSelector, isAppointmentInstruction } from "./planners.js";

const obligation = (contactId: string): Obligation => ({
  id: `ob_${contactId}`,
  orgId: ORG,
  contactId,
  portfolioId: "pf_1",
  kind: "debt",
  stage: "overdue",
  amount: 1000,
  currency: "ARS",
  dueAt: null,
  attributes: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const portfolio = (id: string, name: string): Portfolio => ({
  id,
  orgId: ORG,
  name,
  owner: null,
  rule: {},
  createdAt: new Date(0),
});

function portfolios(
  list: Portfolio[],
  members: ReturnType<typeof makeContact>[],
): PortfolioRepository {
  return {
    async create() {
      throw new Error("unused");
    },
    async get() {
      return null;
    },
    async list() {
      return list;
    },
    async members() {
      return {
        items: members.map((c) => ({ contact: c, obligation: obligation(c.id) })),
        nextCursor: null,
      };
    },
  };
}

const holds = { tryHold: async () => true, release: async () => {} };

describe("planner selection", () => {
  it("detects appointment wording", () => {
    expect(isAppointmentInstruction("Reprogramar los turnos de mañana")).toBe(true);
    expect(isAppointmentInstruction("cobrar a la cartera mora 90")).toBe(false);
  });

  it("uses the reschedule planner for turnos and queries appointments for tomorrow", async () => {
    let asked: { from: Date; to: Date } | null = null;
    const calendar = new InMemoryCalendar();
    const select = createPlannerSelector({
      appointments: async (_o, range) => {
        asked = range;
        return [
          { contact: makeContact("1"), obligation: { ...obligation("1"), kind: "appointment" } },
        ];
      },
      calendar,
      holds,
      portfolios: portfolios([], []),
      clock: { now: () => new Date("2026-10-05T15:00:00Z") },
    });
    const plan = await select("avisar a los pacientes con turno mañana")({
      orgId: ORG,
      botId: "b",
      missionId: "m",
      instruction: "avisar a los pacientes con turno mañana",
    });
    expect(asked).not.toBeNull();
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]?.offer["type"]).toBe("reschedule");
  });

  it("targets a portfolio's reachable, callable members otherwise", async () => {
    const members = [
      makeContact("1"),
      makeContact("2", { doNotCall: true }),
      makeContact("3", { identities: [] }),
    ];
    const select = createPlannerSelector({
      appointments: async () => [],
      calendar: new InMemoryCalendar(),
      holds,
      portfolios: portfolios([portfolio("pf_1", "Mora 90")], members),
    });
    const plan = await select("contactar la cartera Mora 90")({
      orgId: ORG,
      botId: "b",
      missionId: "m",
      instruction: "contactar la cartera Mora 90",
    });
    expect(plan.targets.map((t) => t.contactId)).toEqual(["1"]);
    expect(plan.channelStrategy).toEqual({ first: "whatsapp", fallbackAfterMinutes: 120 });
  });

  it("returns an empty plan when the portfolio is ambiguous", async () => {
    const select = createPlannerSelector({
      appointments: async () => [],
      calendar: new InMemoryCalendar(),
      holds,
      portfolios: portfolios(
        [portfolio("a", "Mora 30"), portfolio("b", "Mora 90")],
        [makeContact("1")],
      ),
    });
    const plan = await select("llamar a todos")({
      orgId: ORG,
      botId: "b",
      missionId: "m",
      instruction: "llamar a todos",
    });
    expect(plan.targets).toHaveLength(0);
  });
});
