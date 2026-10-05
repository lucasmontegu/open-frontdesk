import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { RedisHoldStore } from "./redis-hold-store.js";

const redis = new Redis("redis://localhost:6379");
const prefix = `ofd:test:${randomUUID()}:`;
const store = new RedisHoldStore(redis, prefix);

afterAll(async () => {
  redis.disconnect();
});

describe("RedisHoldStore", () => {
  it("refuses a second holder", async () => {
    expect(await store.tryHold("slot-1", "a", 30)).toBe(true);
    expect(await store.tryHold("slot-1", "b", 30)).toBe(false);
  });

  it("only the holder can release", async () => {
    expect(await store.tryHold("slot-2", "a", 30)).toBe(true);
    await store.release("slot-2", "b");
    expect(await store.tryHold("slot-2", "b", 30)).toBe(false);
    await store.release("slot-2", "a");
    expect(await store.tryHold("slot-2", "b", 30)).toBe(true);
  });

  it("expires after the TTL", async () => {
    expect(await store.tryHold("slot-3", "a", 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 1300));
    expect(await store.tryHold("slot-3", "b", 30)).toBe(true);
  });
});
