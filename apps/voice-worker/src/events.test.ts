import { describe, expect, it } from "vitest";
import type { JobName } from "@ofd/core";
import { finishCall, recordTurn } from "./events.js";
import { FakeEvents, makeVersion, ORG } from "./test-fakes.js";

const call = { orgId: ORG, conversationId: "cv_1", contactId: "c1", version: makeVersion() };

describe("call events", () => {
  it("records customer and agent messages of a turn", async () => {
    const events = new FakeEvents();
    await recordTurn(events, call, { customer: ["hola", " "], agent: "Hola, ¿en qué te ayudo?" });
    expect(events.all.map((e) => [e.type, e.actorKind])).toEqual([["customer.message", "customer"], ["agent.message", "bot"]]);
    expect(events.all[0]?.conversationId).toBe("cv_1");
  });

  it("ends the conversation, appends conversation.ended and queues fact extraction", async () => {
    const events = new FakeEvents();
    const ended: string[] = [];
    const queued: Array<[JobName, object]> = [];
    await finishCall({ conversations: { start: async () => ({ id: "x" }), end: async (_o, id, outcome) => void ended.push(`${id}:${outcome}`) }, events, jobs: { enqueue: async (n, d) => (queued.push([n, d]), "j") } }, call);
    expect(ended).toEqual(["cv_1:completed"]);
    expect(events.all[0]?.type).toBe("conversation.ended");
    expect(queued).toEqual([["conversation.extract_facts", { orgId: ORG, conversationId: "cv_1" }]]);
  });

  it("never throws while shutting down", async () => {
    const warnings: object[] = [];
    await finishCall({ conversations: { start: async () => ({ id: "x" }), end: async () => { throw new Error("db down"); } }, events: new FakeEvents(), jobs: { enqueue: async () => "j" }, log: { warn: (o) => void warnings.push(o) } }, call);
    expect(warnings).toHaveLength(1);
  });
});
