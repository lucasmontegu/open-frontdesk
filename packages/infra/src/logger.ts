import { type Logger, pino } from "pino";
import type { Config } from "./config.js";

export type { Logger };

/** JSON logs to stdout. Pretty printing is left to the shell (`| pino-pretty`) if wanted. */
export function createLogger(config: Pick<Config, "logLevel">, name = "ofd"): Logger {
  return pino({ name, level: config.logLevel });
}
