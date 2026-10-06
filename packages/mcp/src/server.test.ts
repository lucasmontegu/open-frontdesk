import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "./server.js";

interface Call {
  method: string;
  url: URL;
  auth: string | null;
  body: unknown;
}

async function rig(
  respond: (c: Call) => { status?: number; json: unknown } = () => ({ json: { ok: true } }),
) {
  const calls: Call[] = [];
  const fakeFetch = (async (input: URL | string, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      auth: new Headers(init?.headers).get("authorization"),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const r = respond(call);
    return new Response(JSON.stringify(r.json), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const server = createMcpServer({
    baseUrl: "https://ofd.example/",
    apiKey: "k_123",
    fetch: fakeFetch,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    return { isError: res.isError ?? false, text: res.content[0]!.text };
  };
  return { calls, call, client };
}

describe("openfrontdesk mcp server", () => {
  it("exposes the tools", async () => {
    const { client } = await rig();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "approve_mission",
      "create_bot_from_pack",
      "create_mission",
      "get_contact_window",
      "get_mission",
      "import_contacts_csv",
      "list_contacts",
      "list_packs",
      "set_contact_window",
    ]);
  });

  it("set_contact_window -> PUT, or DELETE with reset", async () => {
    const { calls, call } = await rig();
    const rules = [{ days: [1, 2, 3, 4, 5], start: "07:00", end: "22:00" }];
    await call("set_contact_window", { timezone: "America/Mexico_City", rules });
    await call("set_contact_window", { reset: true });
    expect(calls.map((c) => [c.method, c.url.pathname])).toEqual([
      ["PUT", "/api/settings/contact-window"],
      ["DELETE", "/api/settings/contact-window"],
    ]);
    expect(calls[0]!.body).toEqual({ timezone: "America/Mexico_City", rules });
  });

  it("list_packs -> GET /api/packs with the bearer key", async () => {
    const { calls, call } = await rig(() => ({ json: [{ id: "cobranza-ar" }] }));
    const r = await call("list_packs");
    expect(r.isError).toBe(false);
    expect(r.text).toContain("cobranza-ar");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "GET", auth: "Bearer k_123" });
    expect(calls[0]!.url.href).toBe("https://ofd.example/api/packs");
  });

  it("create_bot_from_pack -> POST /api/bots", async () => {
    const { calls, call } = await rig(() => ({
      status: 201,
      json: { id: "bot_1", name: "Cobranza" },
    }));
    await call("create_bot_from_pack", { name: "Cobranza", packId: "cobranza-ar" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      body: { name: "Cobranza", packId: "cobranza-ar" },
    });
    expect(calls[0]!.url.pathname).toBe("/api/bots");
  });

  it("create_bot_from_pack with publish reads the bot and publishes its latest version", async () => {
    const { calls, call } = await rig((c) =>
      c.url.pathname === "/api/bots"
        ? { status: 201, json: { id: "bot_1" } }
        : c.method === "GET"
          ? { json: { bot: { id: "bot_1" }, versions: [{ id: "bv_1", version: 1 }] } }
          : { json: { version: { status: "published" } } },
    );
    const r = await call("create_bot_from_pack", { name: "X", packId: "ventas-ar", publish: true });
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      "POST /api/bots",
      "GET /api/bots/bot_1",
      "POST /api/bots/bot_1/versions/bv_1/publish",
    ]);
    expect(r.text).toContain("published");
  });

  it("list_contacts -> GET /api/contacts with query params", async () => {
    const { calls, call } = await rig(() => ({ json: { items: [], nextCursor: null } }));
    await call("list_contacts", { search: "ana", limit: 10 });
    expect(calls[0]!.url.pathname).toBe("/api/contacts");
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ search: "ana", limit: "10" });
  });

  it("import_contacts_csv -> POST /api/contacts/import", async () => {
    const { calls, call } = await rig();
    await call("import_contacts_csv", { csv: "nombre,telefono\nAna,1155" });
    expect(calls[0]).toMatchObject({ method: "POST", body: { csv: "nombre,telefono\nAna,1155" } });
    expect(calls[0]!.url.pathname).toBe("/api/contacts/import");
  });

  it("create_mission, get_mission and approve_mission hit the mission routes", async () => {
    const { calls, call } = await rig();
    await call("create_mission", {
      botId: "bot_1",
      instruction: "Reprogramá los turnos de mañana",
    });
    await call("get_mission", { missionId: "mis/1" });
    await call("approve_mission", { missionId: "mis_1" });
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      "POST /api/missions",
      "GET /api/missions/mis%2F1",
      "POST /api/missions/mis_1/approve",
    ]);
    expect(calls[0]!.body).toEqual({
      botId: "bot_1",
      instruction: "Reprogramá los turnos de mañana",
    });
  });

  it("returns API errors as readable tool errors", async () => {
    const { call } = await rig(() => ({
      status: 409,
      json: { error: { code: "conflict", message: "The bot has no published version" } },
    }));
    const r = await call("create_mission", { botId: "b", instruction: "x" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("409");
    expect(r.text).toContain("The bot has no published version");
  });

  it("rejects invalid arguments before calling the API", async () => {
    const { calls, call } = await rig();
    const r = await call("approve_mission", {});
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
