import { Hono } from "hono";
import type { AppEnv, Container } from "../http/env.js";
import { requirePermission } from "../http/middleware.js";

export type IntegrationCategory = "models" | "voice" | "messaging" | "crm" | "calendar";
export type IntegrationStatus = "connected" | "not_configured" | "coming_soon";

export interface Integration {
  id: string;
  name: string;
  category: IntegrationCategory;
  status: IntegrationStatus;
  /** Environment variables that turn it on; never their values. */
  env: string[];
}

/**
 * The connector catalog with what this deployment has configured. Credentials still come from
 * the environment (see each app's NEEDS.md); this only reports which ones are present.
 */
export function integrationCatalog(
  config: Container["config"],
  env: Record<string, string | undefined> = process.env,
): Integration[] {
  const has = (...keys: (string | undefined)[]) => keys.every((k) => Boolean(k));
  const status = (on: boolean): IntegrationStatus => (on ? "connected" : "not_configured");
  return [
    {
      id: "openai",
      name: "OpenAI",
      category: "models",
      status: status(has(config.openaiApiKey)),
      env: ["OPENAI_API_KEY"],
    },
    {
      id: "livekit",
      name: "LiveKit",
      category: "voice",
      status: status(has(config.livekit.url, config.livekit.apiKey)),
      env: ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"],
    },
    {
      id: "twilio-sip",
      name: "Twilio SIP",
      category: "voice",
      status: status(has(env.LIVEKIT_SIP_TRUNK_ID)),
      env: ["LIVEKIT_SIP_TRUNK_ID"],
    },
    {
      id: "deepgram",
      name: "Deepgram",
      category: "voice",
      status: status(has(config.deepgramApiKey)),
      env: ["DEEPGRAM_API_KEY"],
    },
    {
      id: "cartesia",
      name: "Cartesia",
      category: "voice",
      status: status(has(config.cartesiaApiKey)),
      env: ["CARTESIA_API_KEY"],
    },
    {
      id: "kapso",
      name: "WhatsApp (Kapso)",
      category: "messaging",
      status: status(has(config.kapso.apiKey, config.kapso.baseUrl)),
      env: ["KAPSO_API_KEY", "KAPSO_BASE_URL", "KAPSO_PHONE_NUMBER_ID"],
    },
    {
      id: "hubspot",
      name: "HubSpot",
      category: "crm",
      status: status(has(env.HUBSPOT_TOKEN)),
      env: ["HUBSPOT_TOKEN"],
    },
    {
      id: "kommo",
      name: "Kommo",
      category: "crm",
      status: status(has(env.KOMMO_TOKEN, env.KOMMO_BASE_URL)),
      env: ["KOMMO_TOKEN", "KOMMO_BASE_URL"],
    },
    {
      id: "google-calendar",
      name: "Google Calendar",
      category: "calendar",
      status: "coming_soon",
      env: [],
    },
  ];
}

export function integrationRoutes(container: Container) {
  return new Hono<AppEnv>().get("/", requirePermission("bots", "read"), (c) =>
    c.json({ items: integrationCatalog(container.config), nextCursor: null }),
  );
}
