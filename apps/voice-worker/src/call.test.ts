import { createFrontDeskAgent } from "@ofd/agent";
import { describe, expect, it } from "vitest";
import { type CallDeps, prepareCall } from "./call.js";
import {
  FakeEvents,
  fakeGateway,
  makeContact,
  makeVersion,
  ORG,
  profileFor,
} from "./test-fakes.js";

function setup(over: Partial<CallDeps> = {}) {
  const lucia = makeContact("c1", "+541112345678");
  const events = new FakeEvents();
  const started: unknown[] = [];
  const built: Array<{ profileName: string | null; toolContext: unknown }> = [];
  const deps: CallDeps = {
    bots: { getVersion: async (_o, id) => (id === "bv_1" ? makeVersion() : null) },
    contacts: { findByIdentity: async (_o, i) => (i.value === "+541112345678" ? lucia : null) },
    profiles: { load: async (_o, id) => (id === "c1" ? profileFor(lucia) : null) },
    conversations: {
      start: async (_o, input) => {
        started.push(input);
        return { id: "cv_new" };
      },
      end: async () => {},
    },
    events,
    env: { OFD_INBOUND_ORG_ID: ORG, OFD_INBOUND_BOT_VERSION_ID: "bv_1" },
    buildAgent: ({ version, profile, toolContext }) => {
      built.push({ profileName: profile?.contact.displayName ?? null, toolContext });
      return createFrontDeskAgent({
        botVersion: version,
        gateway: fakeGateway,
        toolContext,
        profile,
      });
    },
    ...over,
  };
  return { deps, events, started, built };
}

describe("prepareCall", () => {
  it("builds the agent for an outbound call from dispatch metadata, with memory scoped by contact", async () => {
    const { deps, started, built } = setup();
    const call = await prepareCall(deps, {
      kind: "outbound",
      dispatch: {
        orgId: ORG,
        botVersionId: "bv_1",
        conversationId: "cv_1",
        context: { contactId: "c1" },
      },
    });
    expect(started).toHaveLength(0); // the worker that dialed already started the conversation
    expect(call.conversationId).toBe("cv_1");
    expect(call.contactId).toBe("c1");
    expect(call.memory).toEqual({ thread: "cv_1", resource: "c1" });
    expect(built[0]?.profileName).toBe("Lucía Pérez");
    expect(built[0]?.toolContext).toMatchObject({
      orgId: ORG,
      contactId: "c1",
      conversationId: "cv_1",
      botVersionId: "bv_1",
      initiator: "mission",
      autonomy: 2,
    });
    const agent = call.agent as { id: string; name: string };
    expect(agent.id).toBe("front-desk-bv_1");
    expect(agent.name).toBe("Sofi");
  });

  it("finds the outbound contact in the conversation's events when the context lacks it", async () => {
    const { deps, events } = setup();
    await events.append({
      orgId: ORG,
      type: "conversation.started",
      payload: { channel: "voice", contactId: "c1", direction: "outbound" },
      conversationId: "cv_1",
      botVersionId: "bv_1",
      contactId: "c1",
      actorKind: "system",
      actorId: null,
      traceId: null,
    });
    const call = await prepareCall(deps, {
      kind: "outbound",
      dispatch: { orgId: ORG, botVersionId: "bv_1", conversationId: "cv_1", context: {} },
    });
    expect(call.contactId).toBe("c1");
  });

  it("identifies an inbound caller by phone, starts the conversation and records it", async () => {
    const { deps, started, events, built } = setup();
    const call = await prepareCall(deps, {
      kind: "inbound",
      callerPhone: "+5491112345678",
      calledNumber: "+541143210000",
    });
    expect(call.contactId).toBe("c1");
    expect(call.conversationId).toBe("cv_new");
    expect(started[0]).toMatchObject({
      channel: "voice",
      direction: "inbound",
      contactId: "c1",
      botVersionId: "bv_1",
    });
    expect(events.all.map((e) => e.type)).toEqual(["conversation.started"]);
    expect(built[0]?.toolContext).toMatchObject({ initiator: "inbound" });
  });

  it("answers an unknown caller without a profile", async () => {
    const { deps } = setup();
    const call = await prepareCall(deps, {
      kind: "inbound",
      callerPhone: "+5491100000000",
      calledNumber: null,
    });
    expect(call.contactId).toBeNull();
    expect(call.profile).toBeNull();
    expect(call.memory.resource).toBe("cv_new");
  });

  it("throws for an unknown bot version", async () => {
    const { deps } = setup();
    await expect(
      prepareCall(deps, {
        kind: "outbound",
        dispatch: { orgId: ORG, botVersionId: "nope", conversationId: "cv", context: {} },
      }),
    ).rejects.toThrow(/not found/);
  });
});
