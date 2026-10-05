import type {
  Clock,
  EventStore,
  EventType,
  EventPayloads,
  PolicyContext,
  PolicyRule,
  ToolCallContext,
  ToolDefinition,
  ToolGateway,
  ToolResult,
} from "@ofd/core";
import { evaluatePolicy } from "./policy.js";

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

export interface ToolGatewayOptions {
  tools: ToolDefinition[];
  policies: (ctx: ToolCallContext) => Promise<PolicyRule[]>;
  events: EventStore;
  contacts?: (orgId: string, contactId: string) => Promise<{ doNotCall: boolean; attributes: Record<string, unknown> } | null>;
  clock?: Clock;
  timezone?: string;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Hour (0-23) and weekday (0 = Sunday) in the given timezone. */
export function localTime(date: Date, timezone: string): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const weekday = WEEKDAYS[parts.find((p) => p.type === "weekday")?.value ?? ""] ?? 0;
  return { hour, weekday };
}

class TimeoutError extends Error {}

async function withTimeout<T>(run: () => Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function createToolGateway(opts: ToolGatewayOptions): ToolGateway {
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const clock: Clock = opts.clock ?? { now: () => new Date() };
  const timezone = opts.timezone ?? DEFAULT_TIMEZONE;

  const record = <T extends EventType>(ctx: ToolCallContext, type: T, payload: EventPayloads[T]) =>
    opts.events.append({
      orgId: ctx.orgId,
      type,
      payload,
      conversationId: ctx.conversationId,
      botVersionId: ctx.botVersionId,
      contactId: ctx.contactId,
      actorKind: ctx.actor.kind,
      actorId: ctx.actor.id,
      traceId: ctx.traceId,
    });

  const refuse = async (ctx: ToolCallContext, tool: string, ruleId: string, reason: string): Promise<ToolResult> => {
    await record(ctx, "tool.refused", { tool, rule: ruleId, reason });
    return { ok: false, refused: true, ruleId, reason };
  };

  return {
    list(botTools) {
      const allowed = new Set(botTools);
      return opts.tools.filter((t) => allowed.has(t.name));
    },

    async call(toolName, input, ctx) {
      const tool = byName.get(toolName);
      if (!tool) {
        await record(ctx, "tool.requested", { tool: toolName, input });
        return refuse(ctx, toolName, "unknown_tool", `La herramienta "${toolName}" no existe`);
      }

      const parsed = tool.inputSchema.safeParse(input);
      if (!parsed.success) {
        const error = `Invalid input: ${parsed.error.message}`;
        await record(ctx, "tool.requested", { tool: toolName, input });
        await record(ctx, "tool.failed", { tool: toolName, error });
        return { ok: false, refused: false, error };
      }

      // Anything that throws before the decision is recorded must still refuse, never act.
      let decision: ReturnType<typeof evaluatePolicy>;
      try {
        const contact = ctx.contactId && opts.contacts ? await opts.contacts(ctx.orgId, ctx.contactId) : null;
        const policyCtx: PolicyContext = {
          tool: { name: tool.name, effect: tool.effect, input: parsed.data },
          actor: { kind: ctx.actor.kind, id: ctx.actor.id, ...(ctx.actor.kind === "user" ? { role: ctx.actor.role } : {}) },
          bot: ctx.autonomy === null ? null : { autonomy: ctx.autonomy },
          contact: contact ? { doNotCall: contact.doNotCall, attributes: contact.attributes } : null,
          now: localTime(clock.now(), timezone),
          initiator: ctx.initiator,
        };
        if (tool.effect === "contact" && policyCtx.contact?.doNotCall) {
          decision = {
            outcome: "refuse",
            ruleId: "builtin_do_not_call",
            reason: "El contacto está marcado como no contactar",
          };
        } else {
          decision = evaluatePolicy(await opts.policies(ctx), policyCtx);
        }
      } catch (e) {
        decision = {
          outcome: "refuse",
          ruleId: "policy_error",
          reason: `No se pudo evaluar la política: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      await record(ctx, "tool.requested", { tool: toolName, input: parsed.data });
      if (decision.outcome === "refuse") {
        return refuse(ctx, toolName, decision.ruleId, decision.reason);
      }
      await record(ctx, "tool.permitted", { tool: toolName, rule: decision.ruleId });

      const started = Date.now();
      try {
        const output = await withTimeout(() => tool.handler(parsed.data, ctx), tool.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        await record(ctx, "tool.completed", { tool: toolName, output, durationMs: Date.now() - started });
        return { ok: true, output };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        await record(ctx, "tool.failed", { tool: toolName, error });
        return { ok: false, refused: false, error };
      }
    },
  };
}
