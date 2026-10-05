import { describe, expect, it } from "vitest";
import { FakeEvents, FakeFacts, ORG } from "../fakes.js";
import { extractFacts } from "./extract-facts.js";

async function conversation(events: FakeEvents, lines: Array<["customer" | "agent", string]>, at = new Date("2026-10-05T15:00:00Z")) {
  for (const [role, text] of lines) {
    await events.append({
      orgId: ORG, type: role === "customer" ? "customer.message" : "agent.message", payload: { text }, conversationId: "cv_1", botVersionId: "bv_1", contactId: "c1",
      actorKind: role === "customer" ? "customer" : "bot", actorId: null, traceId: null, occurredAt: at,
    });
  }
}

describe("conversation.extract_facts (rules)", () => {
  it("extracts promise-to-pay date, preferred channel and appointment confirmation with provenance", async () => {
    const events = new FakeEvents();
    const facts = new FakeFacts();
    await conversation(events, [
      ["agent", "Hola, te escribo por tu saldo y por el turno del jueves."],
      ["customer", "Te pago el viernes, pero escribime por whatsapp"],
      ["customer", "El turno lo confirmo, ahí estoy"],
    ]);
    const res = await extractFacts({ events, facts }, { orgId: ORG, conversationId: "cv_1" });
    expect(res.stored).toBe(3);
    const byKey = Object.fromEntries(facts.items.map((f) => [f.key, f]));
    expect(byKey["promise_to_pay_date"]?.value).toBe("2026-10-09");
    expect(byKey["preferred_channel"]?.value).toBe("whatsapp");
    expect(byKey["appointment_confirmed"]?.value).toBe("true");
    for (const f of facts.items) {
      expect(f.sourceConversationId).toBe("cv_1");
      expect(events.all.some((e) => e.id === f.sourceEventId && e.type === "customer.message")).toBe(true);
      expect(f.confidence).toBeGreaterThan(0);
    }
    expect(events.ofType("fact.extracted")).toHaveLength(3);
  });

  it("parses explicit dates", async () => {
    const events = new FakeEvents();
    const facts = new FakeFacts();
    await conversation(events, [["customer", "Pago el 15 de octubre sin falta"]]);
    await extractFacts({ events, facts }, { orgId: ORG, conversationId: "cv_1" });
    expect(facts.items[0]).toMatchObject({ key: "promise_to_pay_date", value: "2026-10-15" });
  });

  it("is idempotent", async () => {
    const events = new FakeEvents();
    const facts = new FakeFacts();
    await conversation(events, [["customer", "Pago mañana"]]);
    await extractFacts({ events, facts }, { orgId: ORG, conversationId: "cv_1" });
    const again = await extractFacts({ events, facts }, { orgId: ORG, conversationId: "cv_1" });
    expect(again.stored).toBe(0);
    expect(facts.items).toHaveLength(1);
  });

  it("uses the model extractor when given and falls back to rules when it fails", async () => {
    const events = new FakeEvents();
    const facts = new FakeFacts();
    await conversation(events, [["customer", "Prefiero que me hablen a la tarde"]]);
    await extractFacts({ events, facts, modelExtractor: async () => [{ key: "preferred_contact_hours", value: "tarde", confidence: 0.8, lineIndex: 0 }] }, { orgId: ORG, conversationId: "cv_1" });
    expect(facts.items.map((f) => f.key)).toEqual(["preferred_contact_hours"]);

    const events2 = new FakeEvents();
    const facts2 = new FakeFacts();
    await conversation(events2, [["customer", "Pago hoy"]]);
    await extractFacts({ events: events2, facts: facts2, modelExtractor: async () => { throw new Error("boom"); } }, { orgId: ORG, conversationId: "cv_1" });
    expect(facts2.items[0]?.key).toBe("promise_to_pay_date");
  });

  it("ignores model facts that point at agent lines", async () => {
    const events = new FakeEvents();
    const facts = new FakeFacts();
    await conversation(events, [["agent", "Quedamos el lunes"], ["customer", "ok"]]);
    await extractFacts({ events, facts, modelExtractor: async () => [{ key: "x_fact", value: "v", confidence: 0.9, lineIndex: 0 }] }, { orgId: ORG, conversationId: "cv_1" });
    expect(facts.items).toHaveLength(0);
  });
});
