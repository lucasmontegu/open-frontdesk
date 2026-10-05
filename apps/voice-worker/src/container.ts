import * as cartesia from "@livekit/agents-plugin-cartesia";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import {
  createBuiltinTools,
  createFrontDeskAgent,
  createMemory,
  InMemoryCalendar,
} from "@ofd/agent";
import { ConsoleMessagingProvider, KapsoWhatsAppProvider } from "@ofd/channels";
import type { JobName, JobQueue, MessagingProvider } from "@ofd/core";
import { createDb, createRepositories } from "@ofd/db";
import { createToolGateway } from "@ofd/gateway";
import {
  type Config,
  createLogger,
  type Logger,
  loadConfig,
  PgBossJobQueue,
  RedisHoldStore,
} from "@ofd/infra";
import type { CallDeps } from "./call.js";
import { createPolicyResolver } from "./policies.js";
import { connectRedis } from "./redis.js";
import { createVoiceComponents } from "./voice-plugins.js";

export interface Container {
  config: Config;
  log: Logger;
  callDeps: CallDeps;
  jobs: JobQueue;
  voice: ReturnType<typeof createVoiceComponents>;
  repos: ReturnType<typeof createRepositories>;
  close(): Promise<void>;
}

/** Starts pg-boss on first use: most calls never enqueue anything until they end. */
class LazyJobQueue implements JobQueue {
  private starting: Promise<void> | null = null;
  constructor(private readonly queue: PgBossJobQueue) {}

  async enqueue<T extends object>(
    name: JobName,
    data: T,
    opts?: { startAfterSeconds?: number; singletonKey?: string },
  ): Promise<string> {
    this.starting ??= this.queue.start();
    await this.starting;
    return this.queue.enqueue(name, data, opts);
  }

  stop(): Promise<void> {
    return this.queue.stop();
  }
}

/** The only place in the voice worker that creates clients. */
export async function createContainer(
  env: Record<string, string | undefined> = process.env,
): Promise<Container> {
  const config = loadConfig(env);
  const log = createLogger(config, "ofd-voice-worker");

  const { db, close: closeDb } = createDb(config.databaseUrl, { max: 5 });
  const repos = createRepositories(db);
  const redis = await connectRedis(config.redisUrl);
  const holds = new RedisHoldStore(redis.client);
  const jobs = new LazyJobQueue(
    new PgBossJobQueue({
      connectionString: config.databaseUrl,
      onError: (err) => log.error({ err: err.message }, "pg-boss error"),
    }),
  );
  const messaging: MessagingProvider =
    config.kapso.apiKey && config.kapso.baseUrl && env["KAPSO_PHONE_NUMBER_ID"]
      ? new KapsoWhatsAppProvider({
          baseUrl: config.kapso.baseUrl,
          apiKey: config.kapso.apiKey,
          phoneNumberId: env["KAPSO_PHONE_NUMBER_ID"],
        })
      : new ConsoleMessagingProvider(log);
  // Memory is scoped by contact (resourceId) and shared with every other channel.
  const memory = createMemory({ connectionString: config.databaseUrl });

  // TODO: real CalendarProvider shared with the worker and API.
  const calendar = new InMemoryCalendar();
  const gateway = createToolGateway({
    tools: createBuiltinTools({
      contacts: repos.contacts,
      obligations: repos.obligations,
      knowledge: repos.knowledge,
      calendar,
      holds,
      messaging,
      jobs,
      events: repos.events,
    }),
    policies: createPolicyResolver({ policies: repos.policies, bots: repos.bots }),
    events: repos.events,
    contacts: async (orgId, contactId) => {
      const c = await repos.contacts.get(orgId, contactId);
      return c ? { doNotCall: c.doNotCall, attributes: c.attributes } : null;
    },
    timezone: config.timezone,
  });

  const callDeps: CallDeps = {
    bots: repos.bots,
    contacts: repos.contacts,
    profiles: repos.profiles,
    conversations: repos.conversations,
    events: repos.events,
    env,
    buildAgent: ({ version, profile, toolContext }) =>
      createFrontDeskAgent({
        botVersion: version,
        gateway,
        toolContext: { ...toolContext, actor: { ...toolContext.actor } },
        profile,
        memory,
        events: repos.events,
      }),
  };

  if (!config.openaiApiKey)
    log.warn({}, "OPENAI_API_KEY is not set: the agent cannot generate replies");

  const voice = createVoiceComponents(
    { deepgramApiKey: config.deepgramApiKey, cartesiaApiKey: config.cartesiaApiKey },
    {
      deepgramStt: (o) =>
        new deepgram.STT({
          model: o.model,
          language: o.language,
          ...(o.apiKey ? { apiKey: o.apiKey } : {}),
        }),
      cartesiaTts: (o) =>
        new cartesia.TTS({
          model: o.model,
          language: o.language,
          ...(o.apiKey ? { apiKey: o.apiKey } : {}),
        }),
    },
  );

  return {
    config,
    log,
    callDeps,
    jobs,
    voice,
    repos,
    async close() {
      await jobs.stop();
      await redis.quit();
      await closeDb();
    },
  };
}
