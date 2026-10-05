import type {
  Contact,
  ContactRepository,
  JobName,
  JobQueue,
  KnowledgeSearch,
  MessagingProvider,
  Obligation,
  ObligationRepository,
  ToolCallContext,
  ToolDefinition,
} from "@ofd/core";
import { describe, expect, it } from "vitest";
import { createBuiltinTools } from "./builtin-tools.js";
import { InMemoryCalendar, InMemoryHoldStore, offerSlots } from "./calendar.js";
import { baseCtx } from "./test-helpers.js";

const NAMES = [
  "lookup_contact",
  "search_knowledge",
  "find_available_slots",
  "book_appointment",
  "reschedule_appointment",
  "cancel_appointment",
  "get_payment_options",
  "register_promise_to_pay",
  "send_payment_link",
  "send_whatsapp",
  "schedule_callback",
  "transfer_to_human",
  "qualify_lead",
  "book_demo",
  "update_lead_stage",
];
const t0 = new Date("2026-10-06T12:00:00Z");
const mk = (id: string, attrs: Record<string, unknown> = {}): Contact => ({
  id,
  orgId: "org1",
  displayName: id,
  identities: [{ kind: "whatsapp", value: "+5411" + id }],
  attributes: attrs,
  tags: [],
  doNotCall: false,
  createdAt: t0,
  updatedAt: t0,
});

function setup() {
  const contacts = new Map([
    ["c1", mk("c1", { dniLast4: "3456" })],
    ["c2", mk("c2")],
  ]);
  const obs: Obligation[] = [
    {
      id: "o1",
      orgId: "org1",
      contactId: "c1",
      portfolioId: null,
      kind: "debt",
      stage: "overdue",
      amount: 1000,
      currency: "ARS",
      dueAt: null,
      attributes: {},
      createdAt: t0,
      updatedAt: t0,
    },
  ];
  const sent: string[] = [];
  const jobs: Array<{ name: string; data: unknown; opts: unknown }> = [];
  const calendar = new InMemoryCalendar();
  const holds = new InMemoryHoldStore();
  calendar.addSlots(
    "org1",
    [0, 1, 2].map((h) => ({
      start: new Date(t0.getTime() + h * 3600_000),
      end: new Date(t0.getTime() + (h + 1) * 3600_000),
    })),
  );
  const tools = createBuiltinTools({
    contacts: {
      get: async (_o: string, id: string) => contacts.get(id) ?? null,
      findByIdentity: async () => contacts.get("c1") ?? null,
    } as unknown as ContactRepository,
    obligations: {
      listByContact: async () => obs,
      upsert: async (_o: string, i: Partial<Obligation>) => {
        const idx = obs.findIndex((x) => x.id === i.id);
        const row = {
          ...(idx >= 0 ? obs[idx]! : { id: "new", orgId: "org1", createdAt: t0, updatedAt: t0 }),
          ...i,
        } as Obligation;
        if (idx >= 0) obs[idx] = row;
        else obs.push(row);
        return row;
      },
    } as unknown as ObligationRepository,
    knowledge: {
      search: async () => [{ id: "k", title: "Horarios", content: "9 a 18", score: -1 }],
    } as unknown as KnowledgeSearch,
    calendar,
    holds,
    messaging: {
      id: "m",
      send: async (i) => (sent.push(i.text), { providerMessageId: "p1" }),
    } as MessagingProvider,
    jobs: {
      enqueue: async (name: JobName, data: object, opts?: unknown) => (
        jobs.push({ name, data, opts }), "j1"
      ),
    } as JobQueue,
    paymentLinks: { create: async () => ({ url: "https://pay/1" }) },
    paymentPolicy: { maxDiscountPercent: 15, maxInstallments: 3, maxPromiseDays: 30 },
    clock: { now: () => t0 },
  });
  const by = Object.fromEntries(tools.map((x) => [x.name, x])) as Record<string, ToolDefinition>;
  const ctx = (over: Partial<ToolCallContext> = {}): ToolCallContext => ({
    ...baseCtx,
    traceId: null,
    ...over,
  });
  return { by, ctx, tools, calendar, holds, sent, jobs, obs };
}

describe("builtin tools", () => {
  it("exports every tool by its exact name", () => {
    expect(
      setup()
        .tools.map((t) => t.name)
        .sort(),
    ).toEqual([...NAMES].sort());
  });

  it("payment options respect the org policy", async () => {
    const { by, ctx } = setup();
    const r = (await by.get_payment_options!.handler({ obligationId: "o1" }, ctx())) as {
      options: Array<{ discountPercent: number; type: string }>;
    };
    expect(Math.max(...r.options.map((o) => o.discountPercent))).toBe(15);
    expect(r.options.filter((o) => o.type === "installments")).toHaveLength(2);
  });

  it("rejects promises beyond the allowed horizon and below-minimum payment links", async () => {
    const { by, ctx } = setup();
    await expect(
      by.register_promise_to_pay!.handler(
        { obligationId: "o1", amount: 500, promisedDate: "2027-03-01" },
        ctx(),
      ),
    ).rejects.toThrow(/máximo/);
    await expect(
      by.send_payment_link!.handler({ obligationId: "o1", amount: 300 }, ctx()),
    ).rejects.toThrow(/debajo/);
    await expect(
      by.send_payment_link!.handler({ obligationId: "o1", amount: 850 }, ctx()),
    ).resolves.toMatchObject({ sent: true });
  });

  it("holds slots so two contacts never get the same one", async () => {
    const { by, ctx } = setup();
    const input = { from: "2026-10-06T00:00:00Z", to: "2026-10-07T00:00:00Z", count: 2 };
    const a = (await by.find_available_slots!.handler(input, ctx({ contactId: "c1" }))) as {
      slots: Array<{ slotId: string }>;
    };
    const b = (await by.find_available_slots!.handler(input, ctx({ contactId: "c2" }))) as {
      slots: Array<{ slotId: string }>;
    };
    expect(a.slots).toHaveLength(2);
    expect(b.slots).toHaveLength(1);
    expect(a.slots.map((s) => s.slotId)).not.toContain(b.slots[0]!.slotId);
  });

  it("offerSlots skips slots already held", async () => {
    const { calendar, holds } = setup();
    const range = { from: new Date(0), to: new Date(9e12) };
    const x = await offerSlots(calendar, holds, "org1", "a", range, 3);
    const y = await offerSlots(calendar, holds, "org1", "b", range, 3);
    expect(x).toHaveLength(3);
    expect(y).toHaveLength(0);
  });

  it("books, then reschedule and cancel verify dniLast4", async () => {
    const { by, ctx } = setup();
    const found = (await by.find_available_slots!.handler(
      { from: "2026-10-06T00:00:00Z", to: "2026-10-07T00:00:00Z", count: 2 },
      ctx(),
    )) as { slots: Array<{ slotId: string }> };
    const booked = (await by.book_appointment!.handler(
      { slotId: found.slots[0]!.slotId },
      ctx(),
    )) as { bookingId: string };
    const args = { bookingId: booked.bookingId, newSlotId: found.slots[1]!.slotId };
    await expect(
      by.reschedule_appointment!.handler({ ...args, dniLast4: "0000" }, ctx()),
    ).rejects.toThrow(/no coinciden/);
    await expect(
      by.reschedule_appointment!.handler({ ...args, dniLast4: "3456" }, ctx()),
    ).resolves.toMatchObject({ rescheduled: true });
    await expect(
      by.cancel_appointment!.handler({ bookingId: booked.bookingId, dniLast4: "3456" }, ctx()),
    ).resolves.toMatchObject({ cancelled: true });
  });

  it("schedules callbacks on the queue and sends whatsapp", async () => {
    const { by, ctx, jobs, sent } = setup();
    await by.schedule_callback!.handler(
      { inMinutes: 30, channel: "voice", reason: "llamar" },
      ctx(),
    );
    expect(jobs[0]).toMatchObject({ name: "mission.contact", opts: { startAfterSeconds: 1800 } });
    await by.send_whatsapp!.handler({ text: "hola" }, ctx());
    expect(sent).toEqual(["hola"]);
  });

  it("qualifies leads and updates stage", async () => {
    const { by, ctx, obs } = setup();
    await by.qualify_lead!.handler({ need: "x", score: 4 }, ctx());
    expect(obs.find((o) => o.kind === "opportunity")?.stage).toBe("qualified");
    await by.update_lead_stage!.handler({ stage: "proposal" }, ctx());
    expect(obs.find((o) => o.kind === "opportunity")?.stage).toBe("proposal");
  });
});
