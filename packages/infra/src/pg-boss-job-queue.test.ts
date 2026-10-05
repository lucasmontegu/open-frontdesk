import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PgBossJobQueue } from "./pg-boss-job-queue.js";

const url = "postgres://ofd:ofd@localhost:5432/ofd";
const schema = `pgboss_test_${randomBytes(4).toString("hex")}`;
const queue = new PgBossJobQueue({ connectionString: url, schema });

afterAll(async () => {
  await queue.stop();
  execFileSync("psql", [url, "-c", `DROP SCHEMA IF EXISTS ${schema} CASCADE`]);
});

describe("PgBossJobQueue", () => {
  it("delivers an enqueued job to a worker", async () => {
    await queue.start();
    const received = new Promise<{ n: number }>((resolve) => {
      void queue.work<{ n: number }>("crm.sync", async (data) => resolve(data), { pollingIntervalSeconds: 0.5 });
    });
    const id = await queue.enqueue("crm.sync", { n: 42 });
    expect(id).toBeTruthy();
    expect(await received).toEqual({ n: 42 });
  }, 20_000);
});
