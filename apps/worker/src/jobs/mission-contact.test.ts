import type { MissionPlan } from "@ofd/core";
import { describe, expect, it } from "vitest";
import {
  FakeBots,
  FakeContacts,
  FakeConversations,
  FakeEvents,
  FakeGateway,
  FakeJobs,
  FakeMissions,
  FakeTelephony,
  fakeProfiles,
  makeContact,
  makeVersion,
  ORG,
} from "../fakes.js";
import { missionContact } from "./mission-contact.js";

const strategy = (fallbackAfterMinutes: number | null): MissionPlan["channelStrategy"] => ({
  first: "whatsapp",
  fallbackAfterMinutes,
});

function setup(
  opts: {
    fallback?: number | null;
    contact?: ReturnType<typeof makeContact>;
    targets?: string[];
  } = {},
) {
  const contact = opts.contact ?? makeContact("1");
  const targets = (opts.targets ?? [contact.id]).map((id) => ({
    contactId: id,
    channel: "whatsapp" as const,
    offer: { type: "reschedule" },
    status: "pending" as const,
  }));
  const missions = new FakeMissions();
  missions.add({
    id: "m1",
    status: "running",
    plan: {
      summary: "s",
      estimatedMinutes: 1,
      targets,
      channelStrategy: strategy(opts.fallback === undefined ? 120 : opts.fallback),
    },
  });
  const jobs = new FakeJobs();
  const events = new FakeEvents();
  const gateway = new FakeGateway();
  const telephony = new FakeTelephony();
  const conversations = new FakeConversations();
  const composed: string[] = [];
  const now = new Date("2026-10-05T12:00:00Z");
  const deps = {
    missions,
    bots: new FakeBots() as never,
    contacts: new FakeContacts([contact, makeContact("2")]) as never,
    profiles: fakeProfiles,
    conversations,
    events,
    jobs,
    gateway,
    telephony,
    compose: async ({ offer }: { offer: Record<string, unknown> }) => {
      composed.push(JSON.stringify(offer));
      return "Hola, ¿reprogramamos?";
    },
    clock: { now: () => now },
  };
  const job = (over: object = {}) => ({
    orgId: ORG,
    missionId: "m1",
    botId: "bot_1",
    contactId: contact.id,
    channel: "whatsapp",
    offer: { type: "reschedule" },
    ...over,
  });
  const status = (id = contact.id) =>
    missions.items.get("m1")?.plan?.targets.find((t) => t.contactId === id)?.status;
  return {
    deps,
    job,
    missions,
    jobs,
    events,
    gateway,
    telephony,
    conversations,
    composed,
    status,
    now,
  };
}

describe("mission.contact", () => {
  it("sends the offer through the gateway send_whatsapp tool and schedules the follow-up check", async () => {
    const t = setup();
    await missionContact(t.deps, t.job());
    expect(t.gateway.calls).toHaveLength(1);
    expect(t.gateway.calls[0]?.tool).toBe("send_whatsapp");
    expect(t.gateway.calls[0]?.input).toEqual({ text: "Hola, ¿reprogramamos?" });
    expect(t.gateway.calls[0]?.ctx).toMatchObject({
      orgId: ORG,
      contactId: "1",
      initiator: "mission",
      autonomy: 2,
      botVersionId: "bv_1",
    });
    expect(t.events.ofType("conversation.started")).toHaveLength(1);
    expect(t.events.ofType("agent.message")).toHaveLength(1);
    expect(t.status()).toBe("contacted");
    const check = t.jobs.of("mission.contact")[0];
    expect(check?.data).toMatchObject({
      attempt: "check",
      stage: "first",
      since: t.now.toISOString(),
    });
    expect(check?.opts?.startAfterSeconds).toBe(120 * 60);
    expect(check?.opts?.singletonKey).toBe("m1:1:check:first");
  });

  it("dials a voice fallback when nobody answered, then settles as no_answer", async () => {
    const t = setup();
    await missionContact(
      t.deps,
      t.job({ attempt: "check", stage: "first", since: t.now.toISOString() }),
    );
    expect(t.telephony.dialed).toHaveLength(1);
    expect(t.telephony.dialed[0]).toMatchObject({ to: "+54911" + "0000001", botVersionId: "bv_1" });
    expect(t.telephony.dialed[0]?.context).toMatchObject({ contactId: "1", missionId: "m1" });
    const next = t.jobs.of("mission.contact")[0];
    expect(next?.data).toMatchObject({ attempt: "check", stage: "fallback", channel: "voice" });
    await missionContact(t.deps, next?.data);
    expect(t.status()).toBe("no_answer");
  });

  it("marks succeeded when the customer replied before the check", async () => {
    const t = setup();
    await t.events.append({
      orgId: ORG,
      type: "customer.message",
      payload: { text: "sí, dale" },
      conversationId: "cv_1",
      botVersionId: null,
      contactId: "1",
      actorKind: "customer",
      actorId: null,
      traceId: null,
      occurredAt: new Date(t.now.getTime() + 1000),
    });
    await missionContact(
      t.deps,
      t.job({ attempt: "check", stage: "first", since: t.now.toISOString() }),
    );
    expect(t.status()).toBe("succeeded");
    expect(t.telephony.dialed).toHaveLength(0);
  });

  it("completes the mission with a report when all targets are final", async () => {
    const t = setup({ targets: ["1", "2"] });
    await missionContact(
      t.deps,
      t.job({ attempt: "check", stage: "fallback", since: t.now.toISOString() }),
    );
    expect(t.missions.items.get("m1")?.status).toBe("running");
    await missionContact(
      t.deps,
      t.job({ contactId: "2", attempt: "check", stage: "fallback", since: t.now.toISOString() }),
    );
    const m = t.missions.items.get("m1");
    expect(m?.status).toBe("completed");
    expect(m?.report).toEqual({ total: 2, succeeded: 0, noAnswer: 2, escalated: 0, failed: 0 });
    expect(t.events.ofType("mission.completed")).toHaveLength(1);
  });

  it("fails the target when the gateway refuses", async () => {
    const t = setup({ targets: ["1"] });
    t.gateway.result = {
      ok: false,
      refused: true,
      ruleId: "quiet_hours",
      reason: "fuera de horario",
    };
    await missionContact(t.deps, t.job());
    expect(t.conversations.ended[0]?.outcome).toBe("refused");
    expect(t.missions.items.get("m1")?.status).toBe("completed");
    expect(t.missions.items.get("m1")?.report?.failed).toBe(1);
  });

  it("does not contact do-not-call contacts", async () => {
    const t = setup({ contact: makeContact("1", { doNotCall: true }) });
    await missionContact(t.deps, t.job());
    expect(t.gateway.calls).toHaveLength(0);
    expect(t.status()).toBe("failed");
  });

  it("skips cancelled missions", async () => {
    const t = setup();
    t.missions.items.set("m1", { ...(t.missions.items.get("m1") as never), status: "cancelled" });
    await missionContact(t.deps, t.job());
    expect(t.gateway.calls).toHaveLength(0);
  });

  it("sends a callback (no mission) without touching any plan", async () => {
    const t = setup();
    await missionContact(t.deps, {
      orgId: ORG,
      missionId: null,
      botId: "bv_1",
      contactId: "1",
      channel: "whatsapp",
      offer: {},
      reason: "retomar el pago",
    });
    expect(t.gateway.calls).toHaveLength(1);
    expect(t.jobs.sent).toHaveLength(0);
  });
});
