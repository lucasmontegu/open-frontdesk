import { describe, expect, it, vi } from "vitest";
import { ConsoleMessagingProvider } from "./console-provider.js";
import { KapsoWhatsAppProvider } from "./kapso-whatsapp.js";
import { type LiveKitClients, LiveKitTelephonyProvider } from "./livekit-telephony.js";
import { parseInboundSipMetadata } from "./sip-metadata.js";

describe("KapsoWhatsAppProvider", () => {
  const input = { orgId: "o", to: "+5491112345678", text: "Hola", conversationId: "c1" };

  it("posts a text message and returns the provider id", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] })),
    );
    const p = new KapsoWhatsAppProvider({
      baseUrl: "https://k.test/",
      apiKey: "key",
      phoneNumberId: "123",
      fetch,
    });
    expect(await p.send(input)).toEqual({ providerMessageId: "wamid.1" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://k.test/meta/whatsapp/v24.0/123/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("key");
    expect(JSON.parse(init.body as string)).toMatchObject({
      to: "5491112345678",
      type: "text",
      text: { body: "Hola" },
    });
  });

  it("throws on HTTP errors", async () => {
    const fetch = vi.fn(async () => new Response("bad", { status: 400 }));
    const p = new KapsoWhatsAppProvider({
      baseUrl: "https://k.test",
      apiKey: "k",
      phoneNumberId: "1",
      fetch,
    });
    await expect(p.send(input)).rejects.toThrow(/400/);
  });
});

describe("ConsoleMessagingProvider", () => {
  it("logs instead of sending", async () => {
    const info = vi.fn();
    const p = new ConsoleMessagingProvider({ info });
    const r = await p.send({ orgId: "o", to: "+54911", text: "hi", conversationId: "c" });
    expect(r.providerMessageId).toMatch(/^console_/);
    expect(info).toHaveBeenCalledOnce();
    expect(p.sent).toHaveLength(1);
  });
});

describe("LiveKitTelephonyProvider", () => {
  it("creates the room, dispatches ofd-voice and dials via SIP", async () => {
    const calls: string[] = [];
    const clients = {
      rooms: {
        createRoom: vi.fn(async () => {
          calls.push("room");
          return {} as never;
        }),
      },
      dispatch: {
        createDispatch: vi.fn(async () => {
          calls.push("dispatch");
          return {} as never;
        }),
      },
      sip: {
        createSipParticipant: vi.fn(async () => {
          calls.push("sip");
          return { sipCallId: "SCL_1", participantId: "PA_1" } as never;
        }),
      },
    } satisfies LiveKitClients;
    const p = new LiveKitTelephonyProvider({
      url: "ws://lk",
      apiKey: "k",
      apiSecret: "s",
      sipTrunkId: "ST_1",
      clients,
    });

    const out = await p.dial({
      orgId: "o1",
      to: "+5491112345678",
      botVersionId: "bv1",
      conversationId: "conv1",
      context: { debt: 10 },
    });

    expect(out).toEqual({ callId: "SCL_1" });
    expect(calls).toEqual(["room", "dispatch", "sip"]);
    expect(clients.rooms.createRoom).toHaveBeenCalledWith(
      expect.objectContaining({ name: "conv1" }),
    );
    const [room, agent, opts] = clients.dispatch.createDispatch.mock.calls[0] as unknown as [
      string,
      string,
      { metadata: string },
    ];
    expect([room, agent]).toEqual(["conv1", "ofd-voice"]);
    expect(JSON.parse(opts.metadata)).toEqual({
      orgId: "o1",
      botVersionId: "bv1",
      conversationId: "conv1",
      context: { debt: 10 },
    });
    expect(clients.sip.createSipParticipant).toHaveBeenCalledWith(
      "ST_1",
      "+5491112345678",
      "conv1",
      expect.any(Object),
    );
  });
});

describe("parseInboundSipMetadata", () => {
  it("reads sip.* attributes", () => {
    expect(
      parseInboundSipMetadata({
        attributes: {
          "sip.phoneNumber": "5491112345678",
          "sip.trunkPhoneNumber": "+541150000000",
          "sip.callID": "SCL_9",
          "sip.trunkID": "ST_2",
        },
      }),
    ).toEqual({
      callerPhone: "+5491112345678",
      calledNumber: "+541150000000",
      callId: "SCL_9",
      trunkId: "ST_2",
    });
  });
  it("falls back to the identity", () => {
    expect(
      parseInboundSipMetadata({ identity: "sip_+5491112345678", attributes: {} }).callerPhone,
    ).toBe("+5491112345678");
  });
  it("returns nulls when nothing is known", () => {
    expect(parseInboundSipMetadata({ identity: "agent-1" })).toEqual({
      callerPhone: null,
      calledNumber: null,
      callId: null,
      trunkId: null,
    });
  });
});
