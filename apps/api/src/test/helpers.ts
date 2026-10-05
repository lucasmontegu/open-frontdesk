import { randomUUID } from "node:crypto";
import { createAuth } from "@ofd/auth";
import { ConsoleMessagingProvider } from "@ofd/channels";
import type { HoldStore, JobName, JobQueue, TelephonyProvider } from "@ofd/core";
import { createDb, createRepositories } from "@ofd/db";
import { createLogger, loadConfig } from "@ofd/infra";
import type { createApp } from "../app.js";
import type { Container } from "../container.js";
import type { ReleaseGate } from "../services/release-gate.js";

export const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://ofd:ofd@localhost:5432/ofd";

export const testConfig = () =>
  loadConfig({
    DATABASE_URL,
    REDIS_URL: "redis://localhost:6379",
    LIVEKIT_URL: "ws://localhost:7880",
    LIVEKIT_API_KEY: "devkey",
    LIVEKIT_API_SECRET: "devsecret",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
    BETTER_AUTH_URL: "http://localhost:3000",
    PUBLIC_APP_URL: "http://localhost:3000",
    LOG_LEVEL: "silent",
  });

export interface TestContainer extends Container {
  enqueued: Array<{ name: JobName; data: unknown }>;
  gateResult: { current: Awaited<ReturnType<ReleaseGate>> };
  shutdown(): Promise<void>;
}

/** Real Postgres and real better-auth; queue, holds, messaging, telephony and the gate are doubles. */
export function createTestContainer(): TestContainer {
  const config = testConfig();
  const logger = createLogger(config);
  const { db, sql, close } = createDb(config.databaseUrl, { max: 4 });
  const repos = createRepositories(db);
  const enqueued: TestContainer["enqueued"] = [];
  const jobs: JobQueue = {
    async enqueue(name, data) {
      enqueued.push({ name, data });
      return `job_${enqueued.length}`;
    },
  };
  const holds: HoldStore = { tryHold: async () => true, release: async () => {} };
  const telephony: TelephonyProvider = { id: "fake", dial: async () => ({ callId: "call_1" }) };
  const gateResult: TestContainer["gateResult"] = {
    current: { id: "ev_stub", passed: true, score: 1, summary: "ok", failures: [] },
  };
  return {
    config,
    logger,
    repos,
    auth: createAuth({
      databaseUrl: config.databaseUrl,
      secret: config.auth.secret,
      baseURL: config.auth.url,
      trustedOrigins: [config.publicAppUrl],
    }),
    jobs,
    holds,
    messaging: new ConsoleMessagingProvider(logger),
    telephony,
    // Persists a real eval run (the publish rule checks it) with the outcome the test chose.
    releaseGate: async (input) => {
      const { id: _id, ...outcome } = gateResult.current;
      const row = await repos.evalRuns.create(input.orgId, {
        botVersionId: input.botVersion.id,
        ...outcome,
      });
      return { id: row.id, ...outcome };
    },
    gatewayFor: () => {
      throw new Error("not used in tests");
    },
    checks: { db: async () => void (await sql`select 1`), redis: async () => {} },
    close,
    shutdown: close,
    enqueued,
    gateResult,
  };
}

export type Session = { cookie: string; userId: string };

export class Client {
  constructor(
    private readonly app: ReturnType<typeof createApp>,
    private cookie = "",
  ) {}

  setCookie(cookie: string) {
    this.cookie = cookie;
  }

  async request(method: string, path: string, body?: unknown) {
    const res = await this.app.request(path, {
      method,
      headers: {
        origin: "http://localhost:3000",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie();
    if (setCookie.length) {
      const jar = new Map(
        this.cookie
          .split("; ")
          .filter(Boolean)
          .map((p) => [p.split("=")[0], p] as const),
      );
      for (const c of setCookie) {
        const pair = c.split(";")[0] ?? "";
        jar.set(pair.split("=")[0], pair);
      }
      this.cookie = [...jar.values()].join("; ");
    }
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as any) : null };
  }

  get = (path: string) => this.request("GET", path);
  post = (path: string, body?: unknown) => this.request("POST", path, body ?? {});
}

/** Signs up a user and returns a client carrying their session cookie. */
export async function signUp(app: ReturnType<typeof createApp>, tag: string) {
  const client = new Client(app);
  const email = `${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const res = await client.post("/api/auth/sign-up/email", {
    email,
    password: "password-1234",
    name: tag,
  });
  if (res.status !== 200)
    throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { client, userId: res.body.user.id as string, email };
}

/** Owner with a fresh organization (becomes the active one). */
export async function signUpOwner(app: ReturnType<typeof createApp>) {
  const owner = await signUp(app, "owner");
  const slug = `org-${randomUUID().slice(0, 8)}`;
  const org = await owner.client.post("/api/auth/organization/create", { name: slug, slug });
  if (org.status !== 200)
    throw new Error(`create org failed: ${org.status} ${JSON.stringify(org.body)}`);
  return { ...owner, orgId: org.body.id as string };
}
