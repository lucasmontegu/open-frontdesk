import { DomainError } from "@ofd/core";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export function clampLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}

/** Cursors are opaque to callers: base64url of "a|b". */
export function encodeCursor(...parts: Array<string | number>): string {
  return Buffer.from(parts.join("|")).toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined, arity: number): string[] | null {
  if (!cursor) return null;
  const parts = Buffer.from(cursor, "base64url").toString().split("|");
  if (parts.length !== arity || parts.some((p) => p === "")) throw new DomainError("invalid", "invalid cursor");
  return parts;
}

/** Splits a limit+1 result set into a page. */
export function toPage<T>(rows: T[], limit: number, cursorOf: (last: T) => string) {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last !== undefined ? cursorOf(last) : null };
}

export const num = (v: string | null): number | null => (v === null ? null : Number(v));
