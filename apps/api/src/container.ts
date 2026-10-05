import { createBuiltinTools, InMemoryCalendar } from "@ofd/agent";
import { type Auth, createAuth } from "@ofd/auth";
import {
  ConsoleMessagingProvider,
  KapsoWhatsAppProvider,
  LiveKitTelephonyProvider,
} from "@ofd/channels";
import type {
  HoldStore,
  JobQueue,
  MessagingProvider,
  TelephonyProvider,
  ToolGateway,
} from "@ofd/core";
import { createDb, createRepositories, type Repositories } from "@ofd/db";
import { createToolGateway } from "@ofd/gateway";
import {
  type Config,
  createLogger,
  createRedis,
  type Logger,
  PgBossJobQueue,
  RedisHoldStore,
} from "@ofd/infra";
import { getBuiltinPack } from "@ofd/packs";
import { mergePolicies } from "./services/policies.js";
import { createReleaseGate, type ReleaseGate } from "./services/release-gate.js";

export interface Container {
  config: Config;
  logger: Logger;
  repos: Repositories;
  auth: Auth;
  jobs: JobQueue;
  holds: HoldStore;
  messaging: MessagingProvider;
  telephony: TelephonyProvider;
  releaseGate: ReleaseGate;
  /** Gateway for one bot: org policies plus the policies of the bot's installed pack. */
  gatewayFor(input: { botId: string | null; packId?: string | null }): ToolGateway;
  /** Liveness probes used by /api/health. Each rejects when the dependency is down. */
  checks: { db(): Promise<void>; redis(): Promise<void> };
  close(): Promise<void>;
}

export async function createContainer(config: Config): Promise<Container> {
  const logger = createLogger(config, "ofd-api");
  const { db, sql, close: closeDb } = createDb(config.databaseUrl);
  const repos = createRepositories(db);

  const auth = createAuth({
    databaseUrl: config.databaseUrl,
    secret: config.auth.secret,
    baseURL: config.auth.url,
    trustedOrigins: [config.publicAppUrl],
  });

  const redis = createRedis(config.redisUrl);
  const holds = new RedisHoldStore(redis);

  const queue = new PgBossJobQueue({
    connectionString: config.databaseUrl,
    onError: (err) => logger.error({ err }, "job queue error"),
  });
  await queue.start();

  const messaging: MessagingProvider =
    config.kapso.apiKey && config.kapso.baseUrl
      ? new KapsoWhatsAppProvider({
          baseUrl: config.kapso.baseUrl,
          apiKey: config.kapso.apiKey,
          phoneNumberId: process.env.KAPSO_PHONE_NUMBER_ID ?? "",
        })
      : new ConsoleMessagingProvider(logger);

  const telephony = new LiveKitTelephonyProvider({
    url: config.livekit.url,
    apiKey: config.livekit.apiKey,
    apiSecret: config.livekit.apiSecret,
    sipTrunkId: process.env.LIVEKIT_SIP_TRUNK_ID ?? "",
  });

  // TODO: replace with a real calendar connector; the in-memory one is for local development.
  const calendar = new InMemoryCalendar();
  const tools = createBuiltinTools({
    contacts: repos.contacts,
    obligations: repos.obligations,
    knowledge: repos.knowledge,
    calendar,
    holds,
    messaging,
    jobs: queue,
    events: repos.events,
  });

  return {
    config,
    logger,
    repos,
    auth,
    jobs: queue,
    holds,
    messaging,
    telephony,
    releaseGate: createReleaseGate(repos),
    gatewayFor({ botId, packId }) {
      const packRules = packId ? (getBuiltinPack(packId)?.policies ?? []) : [];
      return createToolGateway({
        tools,
        events: repos.events,
        timezone: config.timezone,
        contacts: async (orgId, contactId) => {
          const c = await repos.contacts.get(orgId, contactId);
          return c ? { doNotCall: c.doNotCall, attributes: c.attributes } : null;
        },
        policies: async (ctx) =>
          mergePolicies(await repos.policies.rulesFor(ctx.orgId, botId), packRules),
      });
    },
    checks: {
      db: async () => {
        await sql`select 1`;
      },
      redis: async () => {
        await (redis as unknown as { ping(): Promise<string> }).ping();
      },
    },
    async close() {
      await queue.stop();
      await closeDb();
      (redis as unknown as { disconnect(): void }).disconnect();
    },
  };
}
