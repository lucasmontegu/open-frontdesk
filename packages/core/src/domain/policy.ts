import { z } from "zod";

/**
 * A policy rule written in CEL. Evaluation is fail-closed: deny rules run before
 * allow rules, a tool with no matching allow rule is refused, and a rule that
 * fails to compile or evaluate refuses rather than permits.
 *
 * Variables available to `when`: tool.name, tool.effect, tool.input, actor.kind,
 * actor.id, actor.role, bot.autonomy, contact.doNotCall, contact.attributes,
 * now.hour, now.weekday (in the org's timezone), initiator ("inbound" | "mission" | "goal" | "user").
 */
export const PolicyRule = z.object({
  id: z.string().min(1),
  effect: z.enum(["allow", "deny"]),
  description: z.string().default(""),
  when: z.string().min(1),
});
export type PolicyRule = z.infer<typeof PolicyRule>;

export const ToolEffect = z.enum(["read", "write", "contact", "transfer"]);
export type ToolEffect = z.infer<typeof ToolEffect>;

export interface PolicyContext {
  tool: { name: string; effect: ToolEffect; input: unknown };
  actor: { kind: "user" | "bot" | "system"; id: string; role?: string };
  bot: { autonomy: number } | null;
  contact: { doNotCall: boolean; attributes: Record<string, unknown> } | null;
  now: { hour: number; weekday: number };
  initiator: "inbound" | "mission" | "goal" | "user";
}

export type PolicyDecision =
  | { outcome: "permit"; ruleId: string }
  | { outcome: "refuse"; ruleId: string; reason: string };
