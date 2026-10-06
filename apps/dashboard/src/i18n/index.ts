import { enUS } from "./en-US";
import { type Dictionary, esAR } from "./es-AR";

export type Locale = "es-AR" | "en-US";

export const locales: { id: Locale; label: string }[] = [
  { id: "es-AR", label: "Español (Argentina)" },
  { id: "en-US", label: "English (US)" },
];

const dictionaries: Record<Locale, Dictionary> = { "es-AR": esAR, "en-US": enUS };
const KEY = "ofd.locale";

/** The stored choice, else the browser language, else es-AR. */
function detect(): Locale {
  if (typeof window === "undefined") return "es-AR";
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "es-AR" || stored === "en-US") return stored;
  } catch {
    // Storage blocked: fall through to the browser language.
  }
  return navigator.language?.toLowerCase().startsWith("en") ? "en-US" : "es-AR";
}

export const locale: Locale = detect();

/** Active dictionary, chosen once per page load. */
export const t: Dictionary = dictionaries[locale];

/** Stores the choice and reloads so every string and format switches at once. */
export function setLocale(next: Locale) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Private mode: the reload falls back to the browser language.
  }
  window.location.reload();
}

if (typeof document !== "undefined") document.documentElement.lang = locale;
