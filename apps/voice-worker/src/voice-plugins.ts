import type { VoiceConfig } from "@ofd/core";

export const TOOL_FEEDBACK_DEFAULT = "Dame un segundo que lo reviso.";

/** Spoken while a tool runs, so the caller never hears silence. */
export function toolFeedback(toolCall: { toolName: string }): string {
  return toolCall.toolName === "transfer_to_human"
    ? "Un momento, te paso con alguien del equipo."
    : TOOL_FEEDBACK_DEFAULT;
}

export interface VoiceKeys {
  deepgramApiKey?: string | undefined;
  cartesiaApiKey?: string | undefined;
}

export interface VoiceFactories {
  deepgramStt(opts: { model: string; language: string; apiKey?: string }): unknown;
  cartesiaTts(opts: { model: string; language: string; apiKey?: string }): unknown;
}

/** "es-AR" -> Deepgram's Latin American Spanish; other languages pass through. */
export const deepgramLanguage = (language: string) =>
  language.toLowerCase().startsWith("es") ? "es-419" : language;
export const cartesiaLanguage = (language: string) => language.split("-")[0] ?? language;

const split = (spec: string): [string, string] => {
  const i = spec.indexOf("/");
  return i < 0 ? ["", spec] : [spec.slice(0, i), spec.slice(i + 1)];
};

/**
 * Turns the bot version's voice config into LiveKit session components. "deepgram/..." and
 * "cartesia/..." build the self-hosted plugins with our own API keys; any other id is passed through
 * as a LiveKit inference model string. Instances are cached so a call does not pay construction twice.
 */
export function createVoiceComponents(keys: VoiceKeys, factories: VoiceFactories) {
  const cache = new Map<string, unknown>();
  const memo = (key: string, make: () => unknown) => {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key);
  };
  return {
    stt(voice: Pick<VoiceConfig, "stt" | "language">): unknown {
      const [provider, model] = split(voice.stt);
      if (provider !== "deepgram") return voice.stt;
      if (!keys.deepgramApiKey)
        throw new Error("DEEPGRAM_API_KEY is required for voice calls (stt " + voice.stt + ")");
      return memo(`stt:${voice.stt}:${voice.language}`, () =>
        factories.deepgramStt({
          model,
          language: deepgramLanguage(voice.language),
          apiKey: keys.deepgramApiKey as string,
        }),
      );
    },
    tts(voice: Pick<VoiceConfig, "tts" | "language">): unknown {
      const [provider, model] = split(voice.tts);
      if (provider !== "cartesia") return voice.tts;
      if (!keys.cartesiaApiKey)
        throw new Error("CARTESIA_API_KEY is required for voice calls (tts " + voice.tts + ")");
      return memo(`tts:${voice.tts}:${voice.language}`, () =>
        factories.cartesiaTts({
          model,
          language: cartesiaLanguage(voice.language),
          apiKey: keys.cartesiaApiKey as string,
        }),
      );
    },
  };
}
