import { migrateAuth } from "@ofd/auth";
import { runMigrations } from "@ofd/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import {
  Client,
  createTestContainer,
  DATABASE_URL,
  signUp,
  signUpOwner,
  type TestContainer,
  testConfig,
} from "./test/helpers.js";

let container: TestContainer;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const config = testConfig();
  await runMigrations(DATABASE_URL);
  await migrateAuth({
    databaseUrl: DATABASE_URL,
    secret: config.auth.secret,
    baseURL: config.auth.url,
  });
  container = createTestContainer();
  app = createApp(container);
}, 60_000);

afterAll(async () => {
  await container.shutdown();
});

describe("health and auth", () => {
  it("answers /api/health without a session", async () => {
    const res = await new Client(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await new Client(app).get("/api/contacts");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("requires a session even for unknown API routes", async () => {
    const res = await new Client(app).get("/api/nope");
    expect(res.status).toBe(401);
  });
});

describe("contacts", () => {
  it("lets an owner create a contact and list it", async () => {
    const owner = await signUpOwner(app);
    const created = await owner.client.post("/api/contacts", {
      displayName: "Ana Pérez",
      identities: [{ kind: "whatsapp", value: "+5491155550001" }],
    });
    expect(created.status).toBe(201);
    const list = await owner.client.get("/api/contacts");
    expect(list.status).toBe(200);
    expect(list.body.items.map((c: { id: string }) => c.id)).toContain(created.body.id);
    const search = await owner.client.get("/api/contacts?q=Ana");
    expect(search.body.items).toHaveLength(1);
    const detail = await owner.client.get(`/api/contacts/${created.body.id}`);
    expect(detail.body.contact.displayName).toBe("Ana Pérez");
  });

  it("accepts an organization API key as a Bearer token", async () => {
    const owner = await signUpOwner(app);
    const key = await owner.client.post("/api/auth/api-key/create", {
      organizationId: owner.orgId,
      name: "mcp",
    });
    expect(key.status).toBe(200);
    const res = await app.request("/api/contacts", {
      headers: { authorization: `Bearer ${key.body.key}` },
    });
    expect(res.status).toBe(200);
    const bad = await app.request("/api/contacts", {
      headers: { authorization: "Bearer ofd_not-a-key" },
    });
    expect(bad.status).toBe(401);
  });

  it("validates the body", async () => {
    const owner = await signUpOwner(app);
    const res = await owner.client.post("/api/contacts", { displayName: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid");
  });

  it("forbids a viewer from creating a contact", async () => {
    const owner = await signUpOwner(app);
    const viewer = await signUp(app, "viewer");
    await container.auth.api.addMember({
      body: { userId: viewer.userId, role: "viewer", organizationId: owner.orgId },
    });
    const active = await viewer.client.post("/api/auth/organization/set-active", {
      organizationId: owner.orgId,
    });
    expect(active.status).toBe(200);

    expect((await viewer.client.get("/api/contacts")).status).toBe(200);
    const res = await viewer.client.post("/api/contacts", { displayName: "No Puede" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
  });

  it("imports a CSV with Spanish headers", async () => {
    const owner = await signUpOwner(app);
    const csv = [
      "nombre,telefono,email,dni,monto,vencimiento,etapa,tipo",
      'Juan Gómez,11 5555-0002,juan@example.com,30111222,"1.234,56",31/03/2026,mora,deuda',
      ",,,,,,,",
      "Sin Datos,,,,,,,",
    ].join("\n");
    const res = await owner.client.post("/api/contacts/import", { csv });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.errors).toHaveLength(1);
    const list = await owner.client.get("/api/contacts");
    expect(list.body.items[0].displayName).toBe("Juan Gómez");
    const detail = await owner.client.get(`/api/contacts/${list.body.items[0].id}`);
    expect(detail.body.obligations[0]).toMatchObject({
      kind: "debt",
      amount: 1234.56,
      stage: "mora",
    });
  });
});

describe("bots", () => {
  it("creates a bot from a pack, rejects a failing gate with 422 and publishes a passing one", async () => {
    const owner = await signUpOwner(app);
    const packs = await owner.client.get("/api/packs");
    expect(packs.body.length).toBeGreaterThan(0);

    const bot = await owner.client.post("/api/bots", {
      name: "Cobranzas",
      packId: packs.body[0].id,
    });
    expect(bot.status).toBe(201);
    const detail = await owner.client.get(`/api/bots/${bot.body.id}`);
    expect(detail.body.versions).toHaveLength(1);
    expect(detail.body.versions[0].config.pack.id).toBe(packs.body[0].id);
    const versionId = detail.body.versions[0].id;
    const publish = `/api/bots/${bot.body.id}/versions/${versionId}/publish`;

    container.gateResult.current = {
      id: "ev_fail",
      passed: false,
      score: 0.5,
      summary: "1 of 2 failed",
      failures: [{ scenario: "no_llamar", reason: "called a do-not-call contact" }],
    };
    const failed = await owner.client.post(publish);
    expect(failed.status).toBe(422);
    expect(failed.body.error.code).toBe("eval_failed");
    expect(failed.body.error.details.evalRun.failures[0].scenario).toBe("no_llamar");
    const afterFail = await owner.client.get(`/api/bots/${bot.body.id}`);
    expect(afterFail.body.versions[0].status).toBe("rejected");
    expect(afterFail.body.bot.publishedVersionId).toBeNull();

    container.gateResult.current = {
      id: "",
      passed: true,
      score: 1,
      summary: "all green",
      failures: [],
    };
    const ok = await owner.client.post(publish);
    expect(ok.status).toBe(200);
    expect(ok.body.version.status).toBe("published");
    expect(ok.body.evalRun.passed).toBe(true);
    const afterOk = await owner.client.get(`/api/bots/${bot.body.id}`);
    expect(afterOk.body.bot.publishedVersionId).toBe(versionId);
  });
});

describe("missions", () => {
  it("requires a published bot, enqueues planning and approval", async () => {
    const owner = await signUpOwner(app);
    const bot = await owner.client.post("/api/bots", {
      name: "B",
      packId: (await owner.client.get("/api/packs")).body[0].id,
    });
    const early = await owner.client.post("/api/missions", {
      instruction: "llamar a todos",
      botId: bot.body.id,
    });
    expect(early.status).toBe(409);

    const versionId = (await owner.client.get(`/api/bots/${bot.body.id}`)).body.versions[0].id;
    container.gateResult.current = { id: "", passed: true, score: 1, summary: "ok", failures: [] };
    expect(
      (await owner.client.post(`/api/bots/${bot.body.id}/versions/${versionId}/publish`)).status,
    ).toBe(200);

    const mission = await owner.client.post("/api/missions", {
      instruction: "llamar a todos",
      botId: bot.body.id,
    });
    expect(mission.status).toBe(201);
    expect(container.enqueued.at(-1)?.name).toBe("mission.plan");

    const notReady = await owner.client.post(`/api/missions/${mission.body.id}/approve`);
    expect(notReady.status).toBe(409);
    await container.repos.missions.update(owner.orgId, mission.body.id, {
      status: "awaiting_approval",
    });
    const approved = await owner.client.post(`/api/missions/${mission.body.id}/approve`);
    expect(approved.status).toBe(200);
    expect(container.enqueued.at(-1)?.name).toBe("mission.execute");
  });
});

describe("mastra", () => {
  it("serves Mastra routes under /api/mastra for signed-in users", async () => {
    const owner = await signUpOwner(app);
    const res = await owner.client.get("/api/mastra/agents");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });
});
