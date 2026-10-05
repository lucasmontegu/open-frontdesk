import { describe, expect, it } from "vitest";
import type { CrmConnector } from "@ofd/core";
import { CrmSyncService } from "./sync-service.js";
import { FakeContactRepository, FakeObligationRepository, fakeFetch } from "./fakes.test-helpers.js";
import { HubSpotConnector } from "./connectors/hubspot.js";
import { KommoConnector } from "./connectors/kommo.js";

const item = (name: string, extra = {}) => ({
  contact: { displayName: name, identities: [{ kind: "external" as const, value: "42", source: "fake" }, { kind: "phone" as const, value: "+5491112345678" }], attributes: { plan: "pro" }, tags: ["crm"], doNotCall: false, ...extra },
  obligations: [{ portfolioId: null, kind: "opportunity" as const, stage: "open", amount: 10, currency: "ARS", dueAt: null, attributes: { externalId: "d1" } }],
});

function connector(items: ReturnType<typeof item>[]) {
  const pushed: unknown[] = [];
  const c: CrmConnector = {
    id: "fake",
    async *pull() { yield* items; },
    async pushOutcome(_o, input) { pushed.push(input); },
  };
  return { c, pushed };
}

describe("CrmSyncService", () => {
  it("creates then updates by external identity, honoring field ownership", async () => {
    const contacts = new FakeContactRepository();
    const obligations = new FakeObligationRepository();
    const first = connector([item("Ana")]);
    await new CrmSyncService({ contacts, obligations, connector: first.c }).pull("o", null);
    const local = [...contacts.rows.values()][0]!;
    await contacts.update("o", local.id, { attributes: { plan: "local", note: "x" }, doNotCall: true });

    const second = connector([item("Ana María", { attributes: { plan: "enterprise" } })]);
    const svc = new CrmSyncService(
      { contacts, obligations, connector: second.c },
      { displayName: "external", tags: "external", doNotCall: "local", attributes: { default: "external", overrides: { plan: "local" } } },
    );
    const r = await svc.pull("o", null);
    expect(r).toMatchObject({ created: 0, updated: 1, obligations: 1, errors: [] });
    const c = contacts.rows.get(local.id)!;
    expect(contacts.rows.size).toBe(1);
    expect(c.displayName).toBe("Ana María");
    expect(c.attributes).toEqual({ plan: "local", note: "x" });
    expect(c.doNotCall).toBe(true);
    expect(obligations.rows.size).toBe(1); // matched by attributes.externalId
  });

  it("pushes outcomes using the external link", async () => {
    const contacts = new FakeContactRepository();
    const obligations = new FakeObligationRepository();
    const { c, pushed } = connector([item("Ana")]);
    const svc = new CrmSyncService({ contacts, obligations, connector: c });
    await svc.pull("o", null);
    const id = [...contacts.rows.keys()][0]!;
    expect(await svc.pushOutcome("o", id, { summary: "s", outcome: "paid", facts: [] })).toBe(true);
    expect(pushed).toEqual([{ externalContactId: "42", summary: "s", outcome: "paid", facts: [] }]);
    const unlinked = await contacts.create("o", { displayName: "X", identities: [] });
    expect(await svc.pushOutcome("o", unlinked.id, { summary: "s", outcome: "x", facts: [] })).toBe(false);
  });
});

describe("HubSpotConnector", () => {
  it("paginates contacts and posts a note", async () => {
    const { fetch, calls } = fakeFetch([
      { body: { results: [{ id: "1", properties: { firstname: "Ana", lastname: "P", phone: "011 15 1234 5678", email: "A@x.com" } }], paging: { next: { after: "100" } } } },
      { body: { results: [{ id: "2", properties: { email: "b@x.com" } }] } },
      { body: { id: "n1" } },
    ]);
    const hs = new HubSpotConnector({ baseUrl: "https://hs.test", token: "tok", fetch });
    const out = [];
    for await (const x of hs.pull("o", new Date(1000))) out.push(x);
    expect(out.map((x) => x.contact.displayName)).toEqual(["Ana P", "b@x.com"]);
    expect(out[0]!.contact.identities).toContainEqual({ kind: "phone", value: "+5491112345678" });
    expect(JSON.parse(calls[1]!.init!.body as string).after).toBe("100");
    expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe("Bearer tok");

    await hs.pushOutcome("o", { externalContactId: "1", summary: "Prometió pagar", outcome: "promise", facts: [{ key: "k", value: "v" }] });
    expect(calls[2]!.url).toBe("https://hs.test/crm/v3/objects/notes");
    expect(JSON.parse(calls[2]!.init!.body as string).associations[0].to.id).toBe("1");
  });

  it("throws on API errors", async () => {
    const { fetch } = fakeFetch([{ status: 401, body: "no" }]);
    const hs = new HubSpotConnector({ baseUrl: "https://hs.test", token: "t", fetch });
    await expect((async () => { for await (const _ of hs.pull("o", null)) { /* drain */ } })()).rejects.toThrow(/401/);
  });
});

describe("KommoConnector", () => {
  it("follows next links, handles 204, and posts a note", async () => {
    const { fetch, calls } = fakeFetch([
      { body: { _embedded: { contacts: [{ id: 7, name: "Beto", custom_fields_values: [{ field_code: "PHONE", values: [{ value: "+54 9 351 456 7890" }] }, { field_code: "EMAIL", values: [{ value: "B@x.com" }] }] }] }, _links: { next: { href: "https://k.test/api/v4/contacts?page=2" } } } },
      { status: 204 },
      { body: [] },
    ]);
    const k = new KommoConnector({ baseUrl: "https://k.test", token: "tok", fetch });
    const out = [];
    for await (const x of k.pull("o", null)) out.push(x);
    expect(out).toHaveLength(1);
    expect(out[0]!.contact.identities).toEqual([
      { kind: "external", value: "7", source: "kommo" },
      { kind: "phone", value: "+5493514567890" },
      { kind: "email", value: "b@x.com" },
    ]);
    expect(calls[1]!.url).toBe("https://k.test/api/v4/contacts?page=2");
    await k.pushOutcome("o", { externalContactId: "7", summary: "hola", outcome: "ok", facts: [] });
    expect(calls[2]!.url).toBe("https://k.test/api/v4/contacts/7/notes");
    expect(JSON.parse(calls[2]!.init!.body as string)[0].note_type).toBe("common");
  });
});
