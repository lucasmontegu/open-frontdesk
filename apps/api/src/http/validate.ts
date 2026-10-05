import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";
import { body } from "./errors.js";

/** zValidator that answers with the API's error envelope and a 400. */
export const validate = <T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) return c.json(body("invalid", "Invalid request", result.error.issues), 400);
  });
