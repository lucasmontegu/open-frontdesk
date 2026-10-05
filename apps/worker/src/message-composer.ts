import type { BotVersion, Contact, ContactProfile } from "@ofd/core";
import { templateMessage } from "./message-template.js";

export interface ComposeInput {
  orgId: string;
  version: BotVersion;
  contact: Contact;
  profile: ContactProfile | null;
  conversationId: string;
  offer: Record<string, unknown>;
  reason?: string;
}

export type MessageComposer = (input: ComposeInput) => Promise<string>;

/** What the composer needs from an agent: one text generation. */
export interface TextAgent {
  generateText(prompt: string): Promise<string>;
}

export function outreachPrompt(input: Pick<ComposeInput, "contact" | "offer" | "reason">): string {
  return [
    "Vas a escribirle por WhatsApp a este cliente para iniciar la conversación.",
    `Cliente: ${input.contact.displayName}.`,
    `Qué ofrecer o pedir (datos del plan): ${JSON.stringify(input.offer)}.`,
    input.reason ? `Motivo: ${input.reason}.` : "",
    "Escribí SOLO el texto del mensaje: breve (máximo 3 oraciones), cálido, en español rioplatense con voseo, sin inventar datos que no estén arriba.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Composes the first message with the front-desk agent of the bot version (so tone and instructions match).
 * Without a model (no API key) or when generation fails, falls back to the deterministic template.
 */
export function createMessageComposer(opts: {
  /** Null when no model API key is configured. */
  createAgent: ((input: ComposeInput) => TextAgent) | null;
  timezone?: string;
  onFallback?: (err: unknown) => void;
}): MessageComposer {
  return async (input) => {
    const template = () =>
      templateMessage({
        contact: input.contact,
        config: input.version.config,
        offer: input.offer,
        ...(input.reason ? { reason: input.reason } : {}),
        ...(opts.timezone ? { timezone: opts.timezone } : {}),
      });
    if (!opts.createAgent) return template();
    try {
      const text = (await opts.createAgent(input).generateText(outreachPrompt(input))).trim();
      return text.length > 0 ? text.slice(0, 1000) : template();
    } catch (err) {
      opts.onFallback?.(err);
      return template();
    }
  };
}
