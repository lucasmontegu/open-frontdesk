export type ApiErrorCode =
  | "not_found"
  | "forbidden"
  | "conflict"
  | "invalid"
  | "policy_refused"
  | "eval_failed"
  | "unauthorized"
  | "network"
  | "unknown";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | (string & {}),
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const KNOWN: ReadonlySet<string> = new Set([
  "not_found",
  "forbidden",
  "conflict",
  "invalid",
  "policy_refused",
  "eval_failed",
  "unauthorized",
]);

export function codeFromStatus(status: number): ApiErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "invalid";
  return "unknown";
}

/**
 * Maps a failed HTTP response to an ApiError. `fallbackMessage(code)` supplies the
 * user-facing text when the server did not send one.
 */
export function mapError(status: number, body: unknown, fallbackMessage: (code: string) => string): ApiError {
  const err = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const code = typeof err?.code === "string" ? err.code : codeFromStatus(status);
  const serverMessage = typeof err?.message === "string" && err.message.length > 0 ? err.message : null;
  const known = KNOWN.has(code) ? code : codeFromStatus(status);
  return new ApiError(status, code, serverMessage ?? fallbackMessage(known), body);
}

export function networkError(fallbackMessage: (code: string) => string): ApiError {
  return new ApiError(0, "network", fallbackMessage("network"));
}
