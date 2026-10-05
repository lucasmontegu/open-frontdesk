import { DomainError } from "@ofd/core";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

const STATUS = {
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  invalid: 400,
  policy_refused: 403,
  eval_failed: 422,
} as const;

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 500,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const body = (code: string, message: string, details?: unknown) => ({
  error: { code, message, ...(details === undefined ? {} : { details }) },
});

export const errorHandler = (logger: { error(o: object, m: string): void }) => (err: Error, c: Context) => {
  if (err instanceof HttpError) return c.json(body(err.code, err.message, err.details), err.status);
  if (err instanceof DomainError) {
    return c.json(body(err.code, err.message, (err as DomainError & { details?: unknown }).details), STATUS[err.code]);
  }
  if (err instanceof ZodError) return c.json(body("invalid", "Invalid request", err.issues), 400);
  if (err instanceof HTTPException) return c.json(body("invalid", err.message), err.status as 400);
  logger.error({ err }, "unhandled error");
  return c.json(body("internal", "Internal server error"), 500);
};
