import { describe, expect, it } from "vitest";
import { findContactByPhone, parseSipParticipant, phoneCandidates, routeInbound } from "./inbound.js";
import { makeContact, ORG } from "./test-fakes.js";

describe("inbound SIP", () => {
  it("reads caller and dialed number from participant attributes", () => {
    expect(parseSipParticipant({ identity: "sip_x", attributes: { "sip.phoneNumber": "+5491112345678", "sip.trunkPhoneNumber": "541143210000" } })).toEqual({ callerPhone: "+5491112345678", calledNumber: "+541143210000" });
  });

  it("falls back to the participant identity", () => {
    expect(parseSipParticipant({ identity: "sip_+5491112345678" }).callerPhone).toBe("+5491112345678");
    expect(parseSipParticipant({ identity: "someone" }).callerPhone).toBeNull();
  });

  it("tries both Argentine mobile formats", () => {
    expect(phoneCandidates("+5491112345678")).toEqual(["+5491112345678", "+541112345678"]);
    expect(phoneCandidates("+541112345678")).toEqual(["+541112345678", "+5491112345678"]);
    expect(phoneCandidates("+12025550123")).toEqual(["+12025550123"]);
  });

  it("identifies the contact by caller phone through identities", async () => {
    const lucia = makeContact("c1", "+541112345678");
    const asked: string[] = [];
    const contacts = {
      async findByIdentity(_o: string, i: { kind: string; value: string }) {
        asked.push(`${i.kind}:${i.value}`);
        return i.kind === "phone" && i.value === "+541112345678" ? lucia : null;
      },
    };
    expect((await findContactByPhone(contacts, ORG, "+5491112345678"))?.id).toBe("c1");
    expect(asked[0]).toBe("phone:+5491112345678");
    expect(await findContactByPhone({ findByIdentity: async () => null }, ORG, "+5491100000000")).toBeNull();
  });

  it("routes by env until number routing exists", () => {
    expect(routeInbound({ OFD_INBOUND_ORG_ID: "o", OFD_INBOUND_BOT_VERSION_ID: "bv" }, "+54114")).toEqual({ orgId: "o", botVersionId: "bv" });
    expect(() => routeInbound({}, null)).toThrow(/OFD_INBOUND/);
  });
});
