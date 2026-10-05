import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const valid = {
  DATABASE_URL: "postgres://x",
  REDIS_URL: "redis://x",
  LIVEKIT_URL: "ws://x",
  LIVEKIT_API_KEY: "k",
  LIVEKIT_API_SECRET: "s",
  BETTER_AUTH_SECRET: "0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:3000",
  PUBLIC_APP_URL: "http://localhost:5173",
};

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig(valid);
    expect(c.defaultModel).toBe("openai/gpt-5-mini");
    expect(c.port).toBe(3000);
    expect(c.timezone).toBe("America/Argentina/Buenos_Aires");
    expect(c.logLevel).toBe("info");
    expect(c.openaiApiKey).toBeUndefined();
  });

  it("reports every missing and invalid variable at once", () => {
    let err: unknown;
    try {
      loadConfig({ DATABASE_URL: "postgres://x", PORT: "abc", BETTER_AUTH_URL: "nope" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const msg = (err as Error).message;
    for (const name of [
      "REDIS_URL",
      "LIVEKIT_URL",
      "LIVEKIT_API_KEY",
      "LIVEKIT_API_SECRET",
      "BETTER_AUTH_SECRET",
      "PUBLIC_APP_URL",
      "PORT",
      "BETTER_AUTH_URL",
    ]) {
      expect(msg).toContain(name);
    }
    expect(msg).not.toContain("DATABASE_URL");
  });
});
