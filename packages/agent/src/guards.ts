import type { EventStore } from "@ofd/core";
import type { MastraDBMessage } from "@mastra/core/memory";
import type { Processor, ProcessInputArgs, ProcessOutputResultArgs } from "@mastra/core/processors";

/** Phrases (Spanish and English) that usually signal an attempt to override the bot's instructions. */
const INJECTION_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "ignore_instructions", re: /ignor[aá]\w*\s+(todas?\s+)?(las\s+|tus\s+)?(instrucciones|reglas|indicaciones)/i },
  { id: "ignore_instructions_en", re: /ignore\s+(all\s+|any\s+)?(previous|prior|above|your)\s+(instructions|rules|prompts?)/i },
  { id: "forget_instructions", re: /olvid[aá]\w*\s+(todo\s+)?(lo\s+anterior|tus\s+instrucciones|las\s+instrucciones)/i },
  { id: "reveal_prompt", re: /(mostr[aá]\w*|revel[aá]\w*|dec[ií]\w*|repet[ií]\w*|imprim[ií]\w*)\s+(tu|el|las)\s+(system\s*prompt|prompt|instrucciones)/i },
  { id: "reveal_prompt_en", re: /(show|reveal|print|repeat)\s+(me\s+)?(your|the)\s+(system\s+)?(prompt|instructions)/i },
  { id: "role_override", re: /(ahora\s+)?(sos|eres|actu[aá]\s+como|act\s+as|you\s+are\s+now)\s+(un\s+|una\s+)?(dan|admin|administrador|desarrollador|developer|sin\s+restricciones)/i },
  { id: "jailbreak", re: /\b(jailbreak|modo\s+desarrollador|developer\s+mode|do\s+anything\s+now)\b/i },
  { id: "fake_system", re: /(^|\n)\s*(system|sistema)\s*:/i },
];

/** Replaces runs of digits that look like card numbers, CBU/CVU or DNI. Order matters: longest first. */
const REDACTIONS: Array<{ id: string; re: RegExp; label: string }> = [
  { id: "cbu_cvu", re: /(?<![\d])\d{22}(?![\d])/g, label: "[CBU/CVU]" },
  { id: "card", re: /(?<![\d])(?:\d[ -]?){12,18}\d(?![\d])/g, label: "[TARJETA]" },
  { id: "dni_dotted", re: /(?<![\d.])\d{1,2}\.\d{3}\.\d{3}(?![\d.])/g, label: "[DNI]" },
  { id: "dni", re: /(?<![\d.])\d{7,8}(?![\d.])/g, label: "[DNI]" },
];

export interface InputGuardResult {
  /** Text to hand to the model: sensitive digit runs replaced by placeholders. */
  text: string;
  flagged: boolean;
  /** Ids of injection patterns that matched. */
  reasons: string[];
  /** Ids of redaction kinds applied. */
  redacted: string[];
}

export function inputGuard(text: string): InputGuardResult {
  const reasons = INJECTION_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);
  let out = text;
  const redacted: string[] = [];
  for (const r of REDACTIONS) {
    const next = out.replace(r.re, r.label);
    if (next !== out) redacted.push(r.id);
    out = next;
  }
  return { text: out, flagged: reasons.length > 0, reasons, redacted };
}

export interface OutputRules {
  /** Highest discount percentage the bot may promise. Undefined means no discount may be promised. */
  maxDiscountPercent?: number;
  /** Block mentions of legal action (collections). Default true. */
  blockLegalThreats?: boolean;
  /** Extra phrases (regex source strings) that must never appear in a reply. */
  forbiddenPatterns?: string[];
}

export interface OutputGuardResult {
  allowed: boolean;
  /** The original text when allowed, a safe replacement when blocked. */
  text: string;
  reason?: string;
}

export const SAFE_FALLBACK = "Disculpá, eso no lo puedo confirmar yo. Te paso con una persona del equipo para que lo vea con vos.";

const LEGAL_THREAT =
  /\b(demanda\w*|demandar\w*|juicio|abogad\w*|acci[oó]n\s+legal|acciones\s+legales|embarg\w+|denuncia\w*|justicia|tribunal\w*|carta\s+documento|bur[oó]\s+de\s+cr[eé]dito|veraz|nosis)\b/i;
const DISCOUNT = /(\d{1,3}(?:[.,]\d+)?)\s*(?:%|por\s*ciento)/g;
const DISCOUNT_CONTEXT = /(descuent|quita|bonificaci|rebaja|condonaci|te\s+perdon|perdon)/i;

export function outputGuard(text: string, rules: OutputRules = {}): OutputGuardResult {
  const block = (reason: string): OutputGuardResult => ({ allowed: false, text: SAFE_FALLBACK, reason });

  const maxDiscount = rules.maxDiscountPercent ?? 0;
  for (const sentence of text.split(/(?<=[.!?\n])\s+/)) {
    if (!DISCOUNT_CONTEXT.test(sentence)) continue;
    for (const m of sentence.matchAll(DISCOUNT)) {
      const pct = Number(m[1]!.replace(",", "."));
      if (pct > maxDiscount) return block(`discount_above_max: ${pct}% > ${maxDiscount}%`);
    }
  }
  if (rules.blockLegalThreats !== false && LEGAL_THREAT.test(text)) return block("legal_threat");
  for (const src of rules.forbiddenPatterns ?? []) {
    if (new RegExp(src, "i").test(text)) return block(`forbidden_pattern: ${src}`);
  }
  return { allowed: true, text };
}

export interface GuardContext {
  orgId: string;
  conversationId: string | null;
  contactId: string | null;
  botVersionId: string | null;
}

function textOf(m: MastraDBMessage): string {
  return (m.content.parts ?? []).map((p) => (p.type === "text" ? p.text : "")).join("");
}

function mapText(m: MastraDBMessage, fn: (t: string) => string): MastraDBMessage {
  const parts = (m.content.parts ?? []).map((p) => (p.type === "text" ? { ...p, text: fn(p.text) } : p));
  const content = typeof m.content.content === "string" ? fn(m.content.content) : m.content.content;
  return { ...m, content: { ...m.content, parts, content } };
}

/** Mastra processor: redacts and flags the customer's latest messages before the model sees them. */
export class FrontDeskInputGuard implements Processor<"ofd-input-guard"> {
  readonly id = "ofd-input-guard" as const;
  constructor(private readonly ctx: GuardContext, private readonly events?: EventStore) {}

  async processInput({ messages }: ProcessInputArgs): Promise<MastraDBMessage[]> {
    const out: MastraDBMessage[] = [];
    for (const m of messages) {
      if (m.role !== "user") {
        out.push(m);
        continue;
      }
      const res = inputGuard(textOf(m));
      if (res.flagged) await appendGuardEvent(this.events, this.ctx, "guard.input_flagged", { reason: res.reasons.join(",") });
      out.push(res.redacted.length || res.flagged ? mapText(m, (t) => inputGuard(t).text) : m);
    }
    return out;
  }
}

/** Mastra processor: replaces a reply that breaks policy with a safe handoff message. */
export class FrontDeskOutputGuard implements Processor<"ofd-output-guard"> {
  readonly id = "ofd-output-guard" as const;
  constructor(private readonly rules: OutputRules, private readonly ctx: GuardContext, private readonly events?: EventStore) {}

  async processOutputResult({ messages }: ProcessOutputResultArgs): Promise<MastraDBMessage[]> {
    const out: MastraDBMessage[] = [];
    for (const m of messages) {
      if (m.role !== "assistant") {
        out.push(m);
        continue;
      }
      const original = textOf(m);
      const res = outputGuard(original, this.rules);
      if (res.allowed) {
        out.push(m);
        continue;
      }
      await appendGuardEvent(this.events, this.ctx, "guard.output_blocked", { reason: res.reason ?? "blocked", text: original });
      const replaced = mapText(m, () => res.text);
      // Collapse to a single text part so the safe message is not followed by leftover original parts.
      out.push({ ...replaced, content: { ...replaced.content, parts: [{ type: "text", text: res.text }] } });
    }
    return out;
  }
}

async function appendGuardEvent(
  events: EventStore | undefined,
  ctx: GuardContext,
  type: "guard.input_flagged" | "guard.output_blocked",
  payload: { reason: string; text?: string },
): Promise<void> {
  if (!events) return;
  await events.append({
    orgId: ctx.orgId,
    type,
    payload: payload as never,
    conversationId: ctx.conversationId,
    botVersionId: ctx.botVersionId,
    contactId: ctx.contactId,
    actorKind: "system",
    actorId: "guard",
    traceId: null,
  });
}

/** Convenience for non-Mastra callers (voice cascade, tests): guard plus event in one call. */
export async function guardInput(text: string, ctx: GuardContext, events?: EventStore): Promise<InputGuardResult> {
  const res = inputGuard(text);
  if (res.flagged) await appendGuardEvent(events, ctx, "guard.input_flagged", { reason: res.reasons.join(",") });
  return res;
}

export async function guardOutput(text: string, rules: OutputRules, ctx: GuardContext, events?: EventStore): Promise<OutputGuardResult> {
  const res = outputGuard(text, rules);
  if (!res.allowed) await appendGuardEvent(events, ctx, "guard.output_blocked", { reason: res.reason ?? "blocked", text });
  return res;
}
