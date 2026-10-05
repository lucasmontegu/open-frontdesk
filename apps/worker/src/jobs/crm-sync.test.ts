import type { Contact, CrmConnector } from "@ofd/core";
import { describe, expect, it } from "vitest";
import { ORG } from "../fakes.js";
import { crmSync } from "./crm-sync.js";

describe("crm.sync", () => {
  it("does nothing when the connector is not configured", async () => {
    expect(
      await crmSync(
        { contacts: {} as never, obligations: {} as never, connectorFor: () => null },
        { orgId: ORG, connectorId: "hubspot" },
      ),
    ).toBeNull();
  });

  it("pulls from the connector into the canonical model", async () => {
    const created: unknown[] = [];
    const connector: CrmConnector = {
      id: "fake",
      async *pull() {
        yield {
          contact: {
            displayName: "Ana",
            identities: [{ kind: "external", value: "x1", source: "fake" }],
            attributes: {},
            tags: [],
            doNotCall: false,
          },
          obligations: [],
        };
      },
      async pushOutcome() {},
    };
    const contacts = {
      async findByIdentity() {
        return null;
      },
      async create(_o: string, input: unknown) {
        created.push(input);
        return { id: "c1" } as Contact;
      },
    };
    const res = await crmSync(
      { contacts: contacts as never, obligations: {} as never, connectorFor: () => connector },
      { orgId: ORG, connectorId: "fake" },
    );
    expect(res?.created).toBe(1);
    expect(created).toHaveLength(1);
  });
});
