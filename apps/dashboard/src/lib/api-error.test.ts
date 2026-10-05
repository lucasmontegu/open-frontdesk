import { describe, expect, it } from "vitest";
import { ApiError, codeFromStatus, mapError, networkError } from "./api-error";

const fallback = (code: string) => `fallback:${code}`;

describe("mapError", () => {
  it("uses the server error envelope", () => {
    const e = mapError(422, { error: { code: "eval_failed", message: "Falló 2 de 5" } }, fallback);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe("eval_failed");
    expect(e.message).toBe("Falló 2 de 5");
    expect(e.status).toBe(422);
  });
  it("falls back to status mapping when the body is not an envelope", () => {
    const e = mapError(404, "<html>", fallback);
    expect(e.code).toBe("not_found");
    expect(e.message).toBe("fallback:not_found");
  });
  it("keeps unknown server codes but uses a status-based fallback message", () => {
    const e = mapError(500, { error: { code: "weird" } }, fallback);
    expect(e.code).toBe("weird");
    expect(e.message).toBe("fallback:unknown");
  });
});

describe("codeFromStatus", () => {
  it("maps common statuses", () => {
    expect(codeFromStatus(401)).toBe("unauthorized");
    expect(codeFromStatus(403)).toBe("forbidden");
    expect(codeFromStatus(409)).toBe("conflict");
    expect(codeFromStatus(400)).toBe("invalid");
    expect(codeFromStatus(502)).toBe("unknown");
  });
});

describe("networkError", () => {
  it("has status 0", () => {
    const e = networkError(fallback);
    expect(e.status).toBe(0);
    expect(e.code).toBe("network");
  });
});
