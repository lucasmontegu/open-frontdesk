import type { HoldStore } from "@ofd/core";
import type { Redis } from "ioredis";

// Delete only when the stored holder matches, atomically.
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export class RedisHoldStore implements HoldStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "ofd:hold:",
  ) {}

  async tryHold(key: string, holder: string, ttlSeconds: number): Promise<boolean> {
    const res = await this.redis.set(
      this.prefix + key,
      holder,
      "EX",
      Math.max(1, Math.ceil(ttlSeconds)),
      "NX",
    );
    return res === "OK";
  }

  async release(key: string, holder: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, this.prefix + key, holder);
  }
}
