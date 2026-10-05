import { z } from "zod";

const optionalString = z.string().min(1).optional();

export const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  LIVEKIT_URL: z.string().min(1),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16, "must be at least 16 characters"),
  BETTER_AUTH_URL: z.url(),
  PUBLIC_APP_URL: z.url(),
  OFD_DEFAULT_MODEL: z.string().min(1).default("openai/gpt-5-mini"),
  OPENAI_API_KEY: optionalString,
  DEEPGRAM_API_KEY: optionalString,
  CARTESIA_API_KEY: optionalString,
  KAPSO_API_KEY: optionalString,
  KAPSO_BASE_URL: z.url().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  OFD_TIMEZONE: z.string().min(1).default("America/Argentina/Buenos_Aires"),
});

export type RawConfig = z.infer<typeof ConfigSchema>;

export interface Config {
  databaseUrl: string;
  redisUrl: string;
  livekit: { url: string; apiKey: string; apiSecret: string };
  auth: { secret: string; url: string };
  publicAppUrl: string;
  defaultModel: string;
  openaiApiKey?: string;
  deepgramApiKey?: string;
  cartesiaApiKey?: string;
  kapso: { apiKey?: string; baseUrl?: string };
  port: number;
  logLevel: RawConfig["LOG_LEVEL"];
  timezone: string;
}

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

/** Validates the environment once at startup; reports every problem at once. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // Treat empty strings as unset so `FOO=` in a .env file behaves like a missing variable.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ""),
  );
  const parsed = ConfigSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => {
        const name = String(i.path[0] ?? "(root)");
        return i.code === "invalid_type" && i.input === undefined
          ? `${name}: missing`
          : `${name}: ${i.message}`;
      }),
    );
  }
  const c = parsed.data;
  return {
    databaseUrl: c.DATABASE_URL,
    redisUrl: c.REDIS_URL,
    livekit: { url: c.LIVEKIT_URL, apiKey: c.LIVEKIT_API_KEY, apiSecret: c.LIVEKIT_API_SECRET },
    auth: { secret: c.BETTER_AUTH_SECRET, url: c.BETTER_AUTH_URL },
    publicAppUrl: c.PUBLIC_APP_URL,
    defaultModel: c.OFD_DEFAULT_MODEL,
    openaiApiKey: c.OPENAI_API_KEY,
    deepgramApiKey: c.DEEPGRAM_API_KEY,
    cartesiaApiKey: c.CARTESIA_API_KEY,
    kapso: { apiKey: c.KAPSO_API_KEY, baseUrl: c.KAPSO_BASE_URL },
    port: c.PORT,
    logLevel: c.LOG_LEVEL,
    timezone: c.OFD_TIMEZONE,
  };
}
