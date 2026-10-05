import { type Dictionary, esAR } from "./es-AR";

const dictionaries: Record<string, Dictionary> = { "es-AR": esAR };

/** Active dictionary. Only es-AR ships today; select by navigator.language when more are added. */
export const t: Dictionary = dictionaries["es-AR"] ?? esAR;
