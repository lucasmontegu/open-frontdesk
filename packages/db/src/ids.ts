import { randomUUID } from "node:crypto";

/** Prefixed random ids, e.g. `ct_3f2a...`. Prefixes make ids self-describing in logs. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
