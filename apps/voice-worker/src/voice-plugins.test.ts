import { describe, expect, it } from "vitest";
import { createVoiceComponents, toolFeedback } from "./voice-plugins.js";

describe("voice components", () => {
  const calls: unknown[] = [];
  const factories = {
    deepgramStt: (o: unknown) => ({ kind: "stt", o }),
    cartesiaTts: (o: unknown) => (calls.push(o), { kind: "tts", o }),
  };

  it("builds Deepgram and Cartesia plugins from the version's voice config and caches them", () => {
    const c = createVoiceComponents({ deepgramApiKey: "dk", cartesiaApiKey: "ck" }, factories);
    const voice = { stt: "deepgram/nova-3", tts: "cartesia/sonic-3", language: "es-AR" };
    expect(c.stt(voice)).toEqual({
      kind: "stt",
      o: { model: "nova-3", language: "es-419", apiKey: "dk" },
    });
    expect(c.tts(voice)).toEqual({
      kind: "tts",
      o: { model: "sonic-3", language: "es", apiKey: "ck" },
    });
    expect(c.tts(voice)).toBe(c.tts(voice));
    expect(calls).toHaveLength(1);
  });

  it("passes unknown providers through as inference model strings", () => {
    const c = createVoiceComponents({}, factories);
    expect(c.stt({ stt: "assemblyai/universal", language: "es-AR" })).toBe("assemblyai/universal");
  });

  it("requires the API key for the self-hosted plugins", () => {
    const c = createVoiceComponents({}, factories);
    expect(() => c.stt({ stt: "deepgram/nova-3", language: "es-AR" })).toThrow(/DEEPGRAM_API_KEY/);
  });

  it("speaks Spanish while a tool runs", () => {
    expect(toolFeedback({ toolName: "find_available_slots" })).toBe(
      "Dame un segundo que lo reviso.",
    );
    expect(toolFeedback({ toolName: "transfer_to_human" })).toMatch(/te paso/);
  });
});
