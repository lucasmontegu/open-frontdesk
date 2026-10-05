import { DomainError, type BotConfig } from "@ofd/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { newId } from "./ids.js";
import { runMigrations } from "./migrate.js";
import { createRepositories, type Repositories } from "./repositories.js";
import { evalRuns } from "./schema/index.js";

const url = process.env.DATABASE_URL ?? "postgres://ofd:ofd@localhost:5432/ofd";
const { db, close } = createDb(url, { max: 4 });
let repos: Repositories;

// Unique org ids per run keep tests isolated from each other and from the demo seed.
const run = newId("t");
const orgA = `${run}_a`;
const orgB = `${run}_b`;
const DAY = 86_400_000;

const botConfig: BotConfig = {
  name: "Test",
  role: "r",
  goal: "",
  instructions: "i",
  language: "es-AR",
  model: "m",
  autonomy: 2,
  channels: ["voice"],
  voice: { stt: "s", tts: "t", language: "es-AR", turnDetection: "multilingual" },
  tools: [],
};

beforeAll(async () => {
  await runMigrations(url);
  repos = createRepositories(db);
});
afterAll(() => close());

describe("org isolation", () => {
  it("org B cannot read or change org A data", async () => {
    const c = await repos.contacts.create(orgA, { displayName: "Ana", identities: [{ kind: "phone", value: `+54911${run}` }] });
    expect(await repos.contacts.get(orgB, c.id)).toBeNull();
    expect(await repos.contacts.findByIdentity(orgB, { kind: "phone", value: `+54911${run}` })).toBeNull();
    expect((await repos.contacts.findByIdentity(orgA, { kind: "phone", value: `+54911${run}` }))?.id).toBe(c.id);
    expect((await repos.contacts.list(orgB)).items).toHaveLength(0);
    await expect(repos.contacts.update(orgB, c.id, { displayName: "X" })).rejects.toMatchObject({ code: "not_found" });

    const bot = await repos.bots.create(orgA, "b");
    expect(await repos.bots.get(orgB, bot.id)).toBeNull();
    await expect(repos.bots.createVersion(orgB, bot.id, botConfig)).rejects.toBeInstanceOf(DomainError);
  });
});

describe("contacts", () => {
  it("lists with search and cursor pagination", async () => {
    const org = `${run}_list`;
    for (let i = 0; i < 5; i++) {
      await repos.contacts.create(org, { displayName: `Persona ${i}`, identities: [{ kind: "email", value: `p${i}@${run}.test` }] });
    }
    const p1 = await repos.contacts.list(org, { limit: 2 });
    const p2 = await repos.contacts.list(org, { limit: 2, cursor: p1.nextCursor });
    const p3 = await repos.contacts.list(org, { limit: 2, cursor: p2.nextCursor });
    const ids = [...p1.items, ...p2.items, ...p3.items].map((c) => c.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(p3.nextCursor).toBeNull();
    expect((await repos.contacts.list(org, { search: "persona 3" })).items).toHaveLength(1);
    expect((await repos.contacts.list(org, { search: `p4@${run}` })).items).toHaveLength(1);
  });
});

describe("portfolio rules", () => {
  it("matches obligations by days overdue, amount, stage and tags", async () => {
    const org = `${run}_pf`;
    const mk = async (name: string, tags: string[], days: number, amount: number, stage: string) => {
      const c = await repos.contacts.create(org, { displayName: name, identities: [], tags });
      await repos.obligations.upsert(org, {
        contactId: c.id, portfolioId: null, kind: "debt", stage, amount, currency: "ARS",
        dueAt: new Date(Date.now() - days * DAY), attributes: {},
      });
      return c.id;
    };
    const old = await mk("Viejo", ["vip"], 90, 1000, "overdue");
    await mk("Reciente", ["vip"], 10, 1000, "overdue");
    await mk("Chico", ["vip"], 90, 10, "overdue");
    await mk("Otra etapa", ["vip"], 90, 1000, "legal");
    await mk("Sin tag", ["otro"], 90, 1000, "overdue");

    const pf = await repos.portfolios.create(org, { name: "mora", rule: { minDaysOverdue: 60, minAmount: 500, stages: ["overdue"], tags: ["vip"] } });
    const members = await repos.portfolios.members(org, pf.id);
    expect(members.items.map((m) => m.contact.id)).toEqual([old]);
    expect(members.items[0]?.obligation.amount).toBe(1000);

    const loose = await repos.portfolios.create(org, { name: "todo", rule: { minDaysOverdue: 30 } });
    expect((await repos.portfolios.members(org, loose.id)).items).toHaveLength(4);
    expect(await repos.portfolios.members(`${org}_x`, pf.id).catch((e: DomainError) => e.code)).toBe("not_found");
  });
});

describe("events", () => {
  it("appends and lists in order, newest first for the audit list", async () => {
    const conv = await repos.conversations.start(orgA, { channel: "voice", contactId: null, botVersionId: "bv_x", direction: "inbound" });
    const at = new Date();
    const base = { orgId: orgA, conversationId: conv.id, botVersionId: "bv_x", contactId: null, actorId: null, traceId: null };
    const e1 = await repos.events.append({ ...base, type: "customer.message", payload: { text: "hola" }, actorKind: "customer", occurredAt: at });
    const e2 = await repos.events.append({ ...base, type: "agent.message", payload: { text: "buen día" }, actorKind: "bot", occurredAt: at });
    const e3 = await repos.events.append({ ...base, type: "customer.message", payload: { text: "gracias" }, actorKind: "customer", occurredAt: new Date(at.getTime() + 5) });

    expect((await repos.events.listByConversation(orgA, conv.id)).map((e) => e.id)).toEqual([e1.id, e2.id, e3.id]);
    expect(await repos.events.listByConversation(orgB, conv.id)).toEqual([]);

    const recent = await repos.events.list(orgA, { limit: 2 });
    expect(recent.items.map((e) => e.id)).toEqual([e3.id, e2.id]);
    const next = await repos.events.list(orgA, { limit: 2, cursor: recent.nextCursor });
    expect(next.items[0]?.id).toBe(e1.id);
    expect((await repos.events.list(orgA, { types: ["agent.message"] })).items.every((e) => e.type === "agent.message")).toBe(true);
  });

  it("is append-only at the database level", async () => {
    const e = await repos.events.append({
      orgId: orgA, type: "customer.message", payload: { text: "x" }, conversationId: null, botVersionId: null,
      contactId: null, actorKind: "customer", actorId: null, traceId: null,
    });
    await expect(db.$client`update events set type = 'agent.message' where id = ${e.id}`).rejects.toThrow(/append-only/);
    await expect(db.$client`delete from events where id = ${e.id}`).rejects.toThrow(/append-only/);
  });
});

describe("knowledge search", () => {
  it("returns the matching Spanish doc first and stays inside the org", async () => {
    const org = `${run}_kb`;
    await repos.knowledge.ingest(org, { title: "Turnos", content: "Los turnos se reprograman hasta 24 horas antes de la consulta médica." });
    await repos.knowledge.ingest(org, { title: "Pagos", content: "Las deudas atrasadas se pagan en cuotas por transferencia bancaria." });
    await repos.knowledge.ingest(org, { title: "Horarios", content: "La clínica atiende de lunes a viernes por la mañana." });
    await repos.knowledge.ingest(`${org}_other`, { title: "Ajeno", content: "Reprogramar turnos de otra empresa, turnos turnos turnos." });

    const hits = await repos.knowledge.search(org, "cómo reprogramar un turno", { limit: 3 });
    expect(hits[0]?.title).toBe("Turnos");
    expect(hits.every((h) => h.title !== "Ajeno")).toBe(true);
    expect((await repos.knowledge.search(org, "cuotas de la deuda"))[0]?.title).toBe("Pagos");
  });

  it("fuses BM25 with vectors when an embedder is injected", async () => {
    const org = `${run}_kbv`;
    const embed = async (text: string) => {
      const v = new Array<number>(1536).fill(0);
      v[text.toLowerCase().includes("turno") ? 0 : 1] = 1;
      return v;
    };
    const hybrid = createRepositories(db, { embed }).knowledge;
    await hybrid.ingest(org, { title: "Turnos", content: "Reprogramar turnos con anticipación." });
    await hybrid.ingest(org, { title: "Pagos", content: "Cuotas y transferencias." });
    const hits = await hybrid.search(org, "turno", { limit: 2 });
    expect(hits[0]?.title).toBe("Turnos");
  });
});

describe("bot versions", () => {
  it("numbers versions 1..n per bot and gates publish on a passing eval", async () => {
    const bot = await repos.bots.create(orgA, "cobranza");
    const other = await repos.bots.create(orgA, "recepción");
    const [v1, v2] = await Promise.all([repos.bots.createVersion(orgA, bot.id, botConfig), repos.bots.createVersion(orgA, bot.id, botConfig)]);
    const o1 = await repos.bots.createVersion(orgA, other.id, botConfig);
    expect([v1.version, v2.version].sort()).toEqual([1, 2]);
    expect(o1.version).toBe(1);
    expect((await repos.bots.listVersions(orgA, bot.id)).map((v) => v.version)).toEqual([1, 2]);

    // draft: refused
    await expect(repos.bots.publish(orgA, bot.id, v1.id)).rejects.toMatchObject({ code: "conflict" });

    // evaluating with a failed run: refused
    const bad = newId("er");
    await db.insert(evalRuns).values({ id: bad, orgId: orgA, botVersionId: v1.id, passed: false });
    await repos.bots.setVersionStatus(orgA, v1.id, "evaluating", bad);
    await expect(repos.bots.publish(orgA, bot.id, v1.id)).rejects.toMatchObject({ code: "conflict" });

    // evaluating with a passing run: published, bot points at it
    const good = newId("er");
    await db.insert(evalRuns).values({ id: good, orgId: orgA, botVersionId: v1.id, passed: true });
    await repos.bots.setVersionStatus(orgA, v1.id, "evaluating", good);
    const published = await repos.bots.publish(orgA, bot.id, v1.id);
    expect(published.publishedVersionId).toBe(v1.id);
    expect((await repos.bots.getVersion(orgA, v1.id))?.status).toBe("published");
  });
});

describe("profile, policies, missions", () => {
  it("loads the profile with obligations, facts and the last 3 summaries", async () => {
    const org = `${run}_prof`;
    const c = await repos.contacts.create(org, { displayName: "Perfil", identities: [] });
    await repos.obligations.upsert(org, { contactId: c.id, portfolioId: null, kind: "appointment", stage: "scheduled", amount: null, currency: null, dueAt: new Date(), attributes: {} });
    await repos.facts.add(org, { contactId: c.id, key: "pref", value: "mañana", confidence: 0.9, sourceEventId: "ev_1", sourceConversationId: "cv_1" });
    for (let i = 1; i <= 4; i++) {
      const cv = await repos.conversations.start(org, { channel: "voice", contactId: c.id, botVersionId: "bv", direction: "inbound" });
      await repos.conversations.end(org, cv.id, "ok", `resumen ${i}`);
      await new Promise((r) => setTimeout(r, 5));
    }
    const profile = await repos.profiles.load(org, c.id);
    expect(profile?.obligations).toHaveLength(1);
    expect(profile?.facts).toHaveLength(1);
    expect(profile?.recentSummaries).toEqual(["resumen 4", "resumen 3", "resumen 2"]);
    expect(await repos.profiles.load(orgA, c.id)).toBeNull();
  });

  it("stores org rules and missions", async () => {
    await repos.policies.setOrgRules(orgA, [
      { id: "r1", effect: "deny", description: "", when: "contact.doNotCall" },
      { id: "r2", effect: "allow", description: "", when: "true" },
    ]);
    expect((await repos.policies.rulesFor(orgA, null)).map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(await repos.policies.rulesFor(orgB, null)).toEqual([]);

    const m = await repos.missions.create(orgA, { botId: "bot_x", createdBy: "u1", instruction: "llamar" });
    expect(m.status).toBe("planning");
    const upd = await repos.missions.update(orgA, m.id, { status: "running" });
    expect(upd.status).toBe("running");
    expect(await repos.missions.get(orgB, m.id)).toBeNull();
  });
});

describe("eval runs", () => {
  it("stores score, summary and failures and lists by version", async () => {
    const bot = await repos.bots.create(orgA, "Evals");
    const v = await repos.bots.createVersion(orgA, bot.id, botConfig);
    const run1 = await repos.evalRuns.create(orgA, { botVersionId: v.id, passed: false, score: 0.5, summary: "1/2", failures: [{ scenario: "s", reason: "r" }] });
    const run2 = await repos.evalRuns.create(orgA, { botVersionId: v.id, passed: true, score: 1, summary: "2/2", failures: [] });
    expect(await repos.evalRuns.get(orgA, run1.id)).toMatchObject({ passed: false, score: 0.5, failures: [{ scenario: "s", reason: "r" }] });
    expect(await repos.evalRuns.get(orgB, run1.id)).toBeNull();
    expect((await repos.evalRuns.listByVersion(orgA, v.id)).map((r) => r.id).sort()).toEqual([run1.id, run2.id].sort());
  });
});
