import { Redis } from "ioredis";

/** The one place a Redis client is created, so apps do not depend on ioredis directly. */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 2 });
}

export type { Redis };
