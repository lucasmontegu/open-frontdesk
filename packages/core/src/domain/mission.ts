import { z } from "zod";
import type { MissionReport } from "./events.js";

/**
 * A mission is a one-off objective given in natural language ("contact tomorrow's
 * patients and offer a new slot"). A goal is a persistent objective with a KPI and
 * a budget. Both run on the same engine.
 */
export const MissionStatus = z.enum([
  "planning",
  "awaiting_approval",
  "running",
  "completed",
  "cancelled",
  "failed",
]);
export type MissionStatus = z.infer<typeof MissionStatus>;

export interface MissionTarget {
  contactId: string;
  channel: "whatsapp" | "voice";
  /** What the bot should offer or ask this contact, e.g. a held calendar slot. */
  offer: Record<string, unknown>;
  status: "pending" | "contacted" | "succeeded" | "no_answer" | "escalated" | "failed";
}

export interface MissionPlan {
  summary: string;
  targets: MissionTarget[];
  estimatedMinutes: number;
  /** Fallback order, e.g. WhatsApp first, call after N hours without answer. */
  channelStrategy: { first: "whatsapp" | "voice"; fallbackAfterMinutes: number | null };
}

export interface Mission {
  id: string;
  orgId: string;
  botId: string;
  createdBy: string;
  instruction: string;
  status: MissionStatus;
  plan: MissionPlan | null;
  report: MissionReport | null;
  createdAt: Date;
  updatedAt: Date;
}

export const GoalSpec = z.object({
  portfolioId: z.string(),
  objective: z.string(),
  kpi: z.object({ metric: z.string(), target: z.number() }),
  budgetMinutes: z.number().int().positive(),
  until: z.coerce.date(),
  /** Safety limits borrowed from openbot's responsibilities. */
  minIntervalMinutes: z.number().int().min(15).default(60),
  maxConsecutiveFailures: z.number().int().positive().default(10),
});
export type GoalSpec = z.infer<typeof GoalSpec>;
