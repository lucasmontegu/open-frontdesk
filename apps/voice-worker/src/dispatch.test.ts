import { describe, expect, it } from "vitest";
import { parseDispatchMetadata } from "./dispatch.js";

describe("parseDispatchMetadata", () => {
  it("parses outbound dispatch metadata written by LiveKitTelephonyProvider", () => {
    const raw = JSON.stringify({
      orgId: "o",
      botVersionId: "bv",
      conversationId: "cv",
      context: { contactId: "c1" },
    });
    expect(parseDispatchMetadata(raw)).toEqual({
      kind: "outbound",
      dispatch: {
        orgId: "o",
        botVersionId: "bv",
        conversationId: "cv",
        context: { contactId: "c1" },
      },
    });
  });

  it("defaults the context to an empty object", () => {
    const parsed = parseDispatchMetadata(
      JSON.stringify({ orgId: "o", botVersionId: "bv", conversationId: "cv" }),
    );
    expect(parsed).toMatchObject({ kind: "outbound", dispatch: { context: {} } });
  });

  it.each([undefined, null, "", "   ", "not json", "[]", "{}", '{"foo":1}'])(
    "treats %j as inbound",
    (raw) => {
      expect(parseDispatchMetadata(raw)).toEqual({ kind: "inbound" });
    },
  );

  it("fails loudly on a partial outbound payload", () => {
    expect(() =>
      parseDispatchMetadata(JSON.stringify({ orgId: "o", botVersionId: "bv" })),
    ).toThrow();
  });
});
