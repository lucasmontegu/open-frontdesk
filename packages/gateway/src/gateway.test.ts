import type { EventStore, InteractionEvent, NewEvent, PolicyContext, PolicyRule, ToolCallContext, ToolDefinition } from "@ofd/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createToolGateway, evaluatePolicy, validateRule } from "./index.js";

const rule = (id: string, effect: "allow" | "deny", when: string): PolicyRule => ({ id, effect, description: "", when });

const pctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  tool: { name: "send_whatsapp", effect: "contact", input: {} },
  actor: { kind: "bot", id: "b1" },
  bot: { autonomy: 2 },
  contact: { doNotCall: false, attributes: {} },
  now: { hour: 10, weekday: 2 },
  initiator: "inbound",
  ...over,
});

describe("evaluatePolicy", () => {
  it("deny wins over an earlier allow", () => {
    const d = evaluatePolicy([rule("a", "allow", "true"), rule("d", "deny", "tool.name == 'send_whatsapp'")], pctx());
    expect(d).toMatchObject({ outcome: "refuse", ruleId: "d" });
  });
  it("permits on first matching allow", () => {
    expect(evaluatePolicy([rule("n", "allow", "false"), rule("a", "allow", "true")], pctx())).toEqual({ outcome: "permit", ruleId: "a" });
  });
  it("default deny", () => {
    expect(evaluatePolicy([], pctx())).toMatchObject({ outcome: "refuse", ruleId: "default_deny" });
    expect(evaluatePolicy([rule("a", "allow", "false")], pctx())).toMatchObject({ ruleId: "default_deny" });
  });
  it("broken rules fail closed", () => {
    for (const when of ["1 +", "nope.missing.key", "1 + 1", "'str'"]) {
      const d = evaluatePolicy([rule("bad", "allow", when), rule("ok", "allow", "true")], pctx());
      expect(d).toMatchObject({ outcome: "refuse", ruleId: "bad" });
      if (d.outcome === "refuse") expect(d.reason).toContain("bad");
    }
  });
  it("a broken deny rule also refuses", () => {
    expect(evaluatePolicy([rule("bad", "deny", "1 +"), rule("ok", "allow", "true")], pctx())).toMatchObject({ ruleId: "bad" });
  });
  it("validateRule", () => {
    expect(validateRule(rule("x", "allow", "now.hour >= 9"))).toEqual({ ok: true });
    expect(validateRule(rule("x", "allow", "now.hour >="))).toMatchObject({ ok: false });
  });
});

function fakeEvents() {
  const log: string[] = [];
  const events: InteractionEvent[] = [];
  const store: EventStore = {
    async append(e: NewEvent) {
      log.push(`event:${e.type}`);
      const ev = { ...e, id: String(events.length), occurredAt: new Date() } as InteractionEvent;
      events.push(ev);
      return ev as never;
    },
    async listByConversation() { return events; },
    async list() { return { items: events, nextCursor: null }; },
  };
  return { store, log, events };
}

const callCtx: ToolCallContext = {
  orgId: "o1", actor: { kind: "bot", id: "b1", orgId: "o1" as never, botVersionId: "v1" },
  conversationId: "c1", contactId: "k1", botVersionId: "v1", autonomy: 2, initiator: "inbound", traceId: null,
};

function setup(opts: { rules: PolicyRule[]; now?: Date; doNotCall?: boolean; handler?: ToolDefinition["handler"]; timeoutMs?: number }) {
  const { store, log, events } = fakeEvents();
  const tool: ToolDefinition = {
    name: "send_whatsapp", description: "", effect: "contact", timeoutMs: opts.timeoutMs,
    inputSchema: z.object({ text: z.string() }),
    handler: opts.handler ?? (async () => { log.push("handler"); return { sent: true }; }),
  };
  const gw = createToolGateway({
    tools: [tool, { ...tool, name: "other" }], events: store, policies: async () => opts.rules,
    contacts: async () => ({ doNotCall: opts.doNotCall ?? false, attributes: {} }),
    clock: opts.now ? { now: () => opts.now as Date } : undefined,
  });
  return { gw, log, events };
}

describe("ToolGateway", () => {
  it("lists only the bot's tools", () => {
    const { gw } = setup({ rules: [] });
    expect(gw.list(["other"]).map((t) => t.name)).toEqual(["other"]);
  });

  it("refuses unknown tools with an audit record", async () => {
    const { gw, log } = setup({ rules: [rule("a", "allow", "true")] });
    const r = await gw.call("nope", {}, callCtx);
    expect(r).toMatchObject({ ok: false, refused: true, ruleId: "unknown_tool" });
    expect(log).toEqual(["event:tool.requested", "event:tool.refused"]);
  });

  it("records invalid input as tool.failed without running the handler", async () => {
    const { gw, log } = setup({ rules: [rule("a", "allow", "true")] });
    const r = await gw.call("send_whatsapp", { text: 5 }, callCtx);
    expect(r).toMatchObject({ ok: false, refused: false });
    expect(log).toEqual(["event:tool.requested", "event:tool.failed"]);
  });

  it("appends audit events before the handler runs", async () => {
    const { gw, log } = setup({ rules: [rule("a", "allow", "true")] });
    const r = await gw.call("send_whatsapp", { text: "hola" }, callCtx);
    expect(r).toEqual({ ok: true, output: { sent: true } });
    expect(log).toEqual(["event:tool.requested", "event:tool.permitted", "handler", "event:tool.completed"]);
  });

  it("refusal never runs the handler", async () => {
    const { gw, log } = setup({ rules: [] });
    const r = await gw.call("send_whatsapp", { text: "hola" }, callCtx);
    expect(r).toMatchObject({ refused: true, ruleId: "default_deny" });
    expect(log).toEqual(["event:tool.requested", "event:tool.refused"]);
  });

  const hourRule = rule("hours", "allow", "now.hour >= 9 && now.hour < 20");
  it("hour-of-day rules use Buenos Aires time", async () => {
    // 11:00 UTC = 08:00 in Buenos Aires (UTC-3): refused, though 11 would pass in UTC.
    const early = setup({ rules: [hourRule], now: new Date("2026-10-05T11:00:00Z") });
    expect(await early.gw.call("send_whatsapp", { text: "x" }, callCtx)).toMatchObject({ refused: true, ruleId: "default_deny" });
    // 23:00 UTC = 20:00 BA: refused; 13:00 UTC = 10:00 BA: permitted.
    const late = setup({ rules: [hourRule], now: new Date("2026-10-05T23:00:00Z") });
    expect(await late.gw.call("send_whatsapp", { text: "x" }, callCtx)).toMatchObject({ refused: true });
    const ok = setup({ rules: [hourRule], now: new Date("2026-10-05T13:00:00Z") });
    expect(await ok.gw.call("send_whatsapp", { text: "x" }, callCtx)).toMatchObject({ ok: true });
  });

  it("doNotCall blocks a contact-effect tool even with an allow-all rule", async () => {
    const { gw, log } = setup({ rules: [rule("a", "allow", "true")], doNotCall: true });
    const r = await gw.call("send_whatsapp", { text: "x" }, callCtx);
    expect(r).toMatchObject({ refused: true, ruleId: "builtin_do_not_call" });
    expect(log).not.toContain("handler");
  });

  it("handler timeout records tool.failed", async () => {
    const { gw, events } = setup({
      rules: [rule("a", "allow", "true")], timeoutMs: 20,
      handler: () => new Promise(() => {}),
    });
    const r = await gw.call("send_whatsapp", { text: "x" }, callCtx);
    expect(r).toMatchObject({ ok: false, refused: false });
    expect(events.map((e) => e.type)).toEqual(["tool.requested", "tool.permitted", "tool.failed"]);
  });

  it("handler error records tool.failed", async () => {
    const { gw, events } = setup({ rules: [rule("a", "allow", "true")], handler: async () => { throw new Error("boom"); } });
    expect(await gw.call("send_whatsapp", { text: "x" }, callCtx)).toMatchObject({ error: "boom" });
    expect(events.at(-1)?.type).toBe("tool.failed");
  });
});
