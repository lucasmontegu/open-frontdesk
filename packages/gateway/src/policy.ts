import { Environment } from "@marcbachmann/cel-js";
import type { PolicyContext, PolicyDecision, PolicyRule } from "@ofd/core";

const env = new Environment({ unlistedVariablesAreDyn: true });

type Compiled = ((ctx: Record<string, unknown>) => unknown) | { error: string };

// Compile once per rule id + expression.
const cache = new Map<string, Compiled>();

function compile(rule: PolicyRule): Compiled {
  const key = `${rule.id}\u0000${rule.when}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let compiled: Compiled;
  try {
    compiled = env.parse(rule.when) as (ctx: Record<string, unknown>) => unknown;
  } catch (e) {
    compiled = { error: errorMessage(e) };
  }
  cache.set(key, compiled);
  return compiled;
}

function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split("\n")[0] ?? msg;
}

/** Returns an error message if the rule cannot be compiled, otherwise null. For save-time validation. */
export function validateRule(rule: PolicyRule): { ok: true } | { ok: false; error: string } {
  const compiled = compile(rule);
  return typeof compiled === "function" ? { ok: true } : { ok: false, error: compiled.error };
}

type Match = { matched: true } | { matched: false } | { error: string };

function matches(rule: PolicyRule, ctx: PolicyContext): Match {
  const compiled = compile(rule);
  if (typeof compiled !== "function") return { error: `no compila: ${compiled.error}` };
  try {
    const result = compiled(ctx as unknown as Record<string, unknown>);
    if (typeof result !== "boolean") return { error: "no devolvió un booleano" };
    return { matched: result };
  } catch (e) {
    return { error: `falló al evaluarse: ${errorMessage(e)}` };
  }
}

/**
 * Deny rules first (first match refuses), then allow rules (first match permits),
 * otherwise default deny. Any broken rule refuses: fail closed.
 */
export function evaluatePolicy(rules: PolicyRule[], ctx: PolicyContext): PolicyDecision {
  for (const effect of ["deny", "allow"] as const) {
    for (const rule of rules) {
      if (rule.effect !== effect) continue;
      const m = matches(rule, ctx);
      if ("error" in m) {
        return { outcome: "refuse", ruleId: rule.id, reason: `La regla "${rule.id}" ${m.error}` };
      }
      if (!m.matched) continue;
      if (effect === "allow") return { outcome: "permit", ruleId: rule.id };
      return {
        outcome: "refuse",
        ruleId: rule.id,
        reason: rule.description || `Bloqueado por la regla "${rule.id}"`,
      };
    }
  }
  return { outcome: "refuse", ruleId: "default_deny", reason: "Ninguna regla permite esta acción" };
}
