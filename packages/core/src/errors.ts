/** Errors the HTTP layer maps to status codes. Messages are safe to show to users. */
export class DomainError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "forbidden"
      | "conflict"
      | "invalid"
      | "policy_refused"
      | "eval_failed",
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const notFound = (what: string) => new DomainError("not_found", `${what} not found`);
export const forbidden = (why: string) => new DomainError("forbidden", why);
