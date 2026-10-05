import { BotConfig, PolicyRule } from "@ofd/core";
import { z } from "zod";

export const PackManifest = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  version: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  locale: z.string().min(1),
  defaultBot: BotConfig,
});
export type PackManifest = z.infer<typeof PackManifest>;

export const Assertion = z.object({
  type: z.enum([
    "tool_called",
    "tool_not_called",
    "event_present",
    "event_absent",
    "agent_says_not",
    "outcome",
  ]),
  /** Tool name, event type, forbidden phrase or expected outcome, depending on `type`. */
  value: z.string().min(1),
});
export type Assertion = z.infer<typeof Assertion>;

export const ContactFixture = z.object({
  displayName: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()).default({}),
  doNotCall: z.boolean().default(false),
  obligations: z
    .array(
      z.object({
        kind: z.enum(["debt", "opportunity", "appointment"]),
        stage: z.string().default("new"),
        amount: z.number().nullable().default(null),
        currency: z.string().nullable().default(null),
        dueAt: z.string().nullable().default(null),
        attributes: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .default([]),
});
export type ContactFixture = z.infer<typeof ContactFixture>;

export const EvalScenario = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  title: z.string().min(1),
  /** Who the simulated customer is, in Spanish. */
  persona: z.string().min(1),
  goal: z.string().min(1),
  contact: ContactFixture,
  /** Optional scripted customer lines; when empty the simulated customer improvises from persona + goal. */
  turns: z.array(z.string()).default([]),
  /** Simulated clock for the scenario (ISO 8601 with offset), for time-dependent policies. */
  now: z.string().optional(),
  assertions: z.array(Assertion).min(1),
});
export type EvalScenario = z.infer<typeof EvalScenario>;

export const PolicyFile = z.array(PolicyRule);

export interface Pack {
  manifest: PackManifest;
  policies: PolicyRule[];
  scenarios: EvalScenario[];
}
