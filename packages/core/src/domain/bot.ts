import { z } from "zod";

/** The five autonomy levels a customer enables per bot. */
export const AutonomyLevel = z.union([
  z.literal(1), // responds: answers inbound calls and messages
  z.literal(2), // acts: uses tools within policy
  z.literal(3), // follows up: re-contacts on its own; missions need owner approval
  z.literal(4), // owns a goal: KPI + budget, reports; missions may run without approval
  z.literal(5), // improves: proposes playbook changes, gated by evals + human approval
]);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

export const Channel = z.enum(["voice", "whatsapp", "web"]);
export type Channel = z.infer<typeof Channel>;

export const VoiceConfig = z.object({
  stt: z.string().default("deepgram/nova-3"),
  tts: z.string().default("cartesia/sonic-3"),
  language: z.string().default("es-AR"),
  turnDetection: z.enum(["multilingual", "vad", "stt"]).default("multilingual"),
});
export type VoiceConfig = z.infer<typeof VoiceConfig>;

/**
 * Immutable configuration of one bot version. Calls and conversations reference
 * the version they ran with, never the mutable bot.
 */
export const BotConfig = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  goal: z.string().default(""),
  instructions: z.string().min(1),
  language: z.string().default("es-AR"),
  model: z.string().default("openai/gpt-5-mini"),
  autonomy: AutonomyLevel.default(2),
  channels: z.array(Channel).default(["voice", "whatsapp"]),
  voice: VoiceConfig.default({
    stt: "deepgram/nova-3",
    tts: "cartesia/sonic-3",
    language: "es-AR",
    turnDetection: "multilingual",
  }),
  /** Tool names this bot may request. The gateway still evaluates policy on every call. */
  tools: z.array(z.string()).default([]),
  /** Pack this version was installed from, if any. */
  pack: z.object({ id: z.string(), version: z.string() }).optional(),
});
export type BotConfig = z.infer<typeof BotConfig>;

export const BotVersionStatus = z.enum([
  "draft",
  "evaluating",
  "published",
  "rejected",
  "archived",
]);
export type BotVersionStatus = z.infer<typeof BotVersionStatus>;

export interface Bot {
  id: string;
  orgId: string;
  name: string;
  publishedVersionId: string | null;
  createdAt: Date;
}

export interface BotVersion {
  id: string;
  orgId: string;
  botId: string;
  version: number;
  config: BotConfig;
  status: BotVersionStatus;
  evalRunId: string | null;
  createdAt: Date;
}
