import { createBuiltinTools, createFrontDeskAgent, InMemoryCalendar } from "@ofd/agent";
import {
  ConsoleMessagingProvider,
  KapsoWhatsAppProvider,
  LiveKitTelephonyProvider,
} from "@ofd/channels";
import type { CrmConnector } from "@ofd/core";
import { type MessagingProvider, OrgId, type TelephonyProvider } from "@ofd/core";
import { HubSpotConnector, KommoConnector } from "@ofd/crm";
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
import { createAppointmentsLoader } from "./appointments.js";
import { createOpenAiFactExtractor } from "./facts.js";
import { createMessageComposer } from "./message-composer.js";
import { createPlannerSelector } from "./planners.js";
import { createPolicyResolver } from "./policies.js";
import { connectRedis } from "./redis.js";
import { createHandlers, type HandlerDeps } from "./registry.js";

export interface Container {
  config: Config;
  log: Logger;
  queue: PgBossJobQueue;
  handlers: ReturnType<typeof createHandlers>;
  close(): Promise<void>;
}

class UnconfiguredTelephony implements TelephonyProvider {
  readonly id = "unconfigured";
  async dial(): Promise<{ callId: string }> {
    throw new Error("Outbound calls are not configured: set LIVEKIT_SIP_TRUNK_ID");
  }
}

function crmConnectors(env: Record<string, string | undefined>) {
  return (_orgId: string, connectorId: string): CrmConnector | null => {
    // TODO: per-org connector credentials stored in the database instead of process env.
    if (connectorId === "hubspot" && env["HUBSPOT_TOKEN"]) {
      return new HubSpotConnector({
        baseUrl: env["HUBSPOT_BASE_URL"] ?? "https://api.hubspot.com",
        token: env["HUBSPOT_TOKEN"],
      });
    }
    if (connectorId === "kommo" && env["KOMMO_TOKEN"] && env["KOMMO_BASE_URL"]) {
      return new KommoConnector({ baseUrl: env["KOMMO_BASE_URL"], token: env["KOMMO_TOKEN"] });
    }
    return null;
  };
}

/** The only place in the worker that creates clients. */
export async function createContainer(
  env: Record<string, string | undefined> = process.env,
): Promise<Container> {
  const config = loadConfig(env);
  const log = createLogger(config, "ofd-worker");

  const { db, sql, close: closeDb } = createDb(config.databaseUrl, { max: 5 });
  const repos = createRepositories(db);
  const redis = await connectRedis(config.redisUrl);
  const holds = new RedisHoldStore(redis.client);
  const queue = new PgBossJobQueue({
    connectionString: config.databaseUrl,
    onError: (err) => log.error({ err: err.message }, "pg-boss error"),
  });

  const messaging: MessagingProvider =
    config.kapso.apiKey && config.kapso.baseUrl && env["KAPSO_PHONE_NUMBER_ID"]
      ? new KapsoWhatsAppProvider({
          baseUrl: config.kapso.baseUrl,
          apiKey: config.kapso.apiKey,
          phoneNumberId: env["KAPSO_PHONE_NUMBER_ID"],
        })
      : new ConsoleMessagingProvider(log);
  const telephony: TelephonyProvider = env["LIVEKIT_SIP_TRUNK_ID"]
    ? new LiveKitTelephonyProvider({
        url: config.livekit.url,
        apiKey: config.livekit.apiKey,
        apiSecret: config.livekit.apiSecret,
        sipTrunkId: env["LIVEKIT_SIP_TRUNK_ID"],
      })
    : new UnconfiguredTelephony();

  // TODO: real CalendarProvider (Google Calendar / clinic system). The in-memory one has no slots until something adds them.
  const calendar = new InMemoryCalendar();

  const gateway = createToolGateway({
    tools: createBuiltinTools({
      contacts: repos.contacts,
      obligations: repos.obligations,
      knowledge: repos.knowledge,
      calendar,
      holds,
      messaging,
      jobs: queue,
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

  const modelConfigured = Boolean(config.openaiApiKey);
  const compose = createMessageComposer({
    timezone: config.timezone,
    onFallback: (err) =>
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "message composition failed, using template",
      ),
    createAgent: modelConfigured
      ? ({ orgId, version, contact, profile, conversationId }) => {
          const agent = createFrontDeskAgent({
            botVersion: version,
            gateway,
            profile,
            events: repos.events,
            toolContext: {
              orgId,
              actor: { kind: "system", id: "system", orgId: OrgId.parse(orgId) },
              conversationId,
              contactId: contact.id,
              botVersionId: version.id,
              autonomy: version.config.autonomy,
              initiator: "mission",
            },
          });
          return { generateText: async (prompt) => (await agent.generate(prompt)).text };
        }
      : null,
  });

  const model = config.defaultModel;
  const modelExtractor =
    config.openaiApiKey && model.startsWith("openai/")
      ? createOpenAiFactExtractor({
          apiKey: config.openaiApiKey,
          model: model.slice("openai/".length),
        })
      : null;

  const plannerFor = createPlannerSelector({
    appointments: createAppointmentsLoader(sql, repos.contacts),
    calendar,
    holds,
    portfolios: repos.portfolios,
  });

  const deps: HandlerDeps = {
    missionPlan: {
      missions: repos.missions,
      bots: repos.bots,
      events: repos.events,
      jobs: queue,
      plannerFor,
      log,
    },
    missionExecute: { missions: repos.missions, jobs: queue, events: repos.events, log },
    missionContact: {
      missions: repos.missions,
      bots: repos.bots,
      contacts: repos.contacts,
      profiles: repos.profiles,
      conversations: repos.conversations,
      events: repos.events,
      jobs: queue,
      gateway,
      telephony,
      compose,
      log,
    },
    extractFacts: {
      events: repos.events,
      facts: repos.facts,
      modelExtractor,
      timezone: config.timezone,
      log,
    },
    // TODO: GoalStore once core has a goals port and table.
    goalTick: { goals: null, log },
    crmSync: {
      contacts: repos.contacts,
      obligations: repos.obligations,
      connectorFor: crmConnectors(env),
      log,
    },
  };

  return {
    config,
    log,
    queue,
    handlers: createHandlers(deps),
    async close() {
      await queue.stop();
      await redis.quit();
      await closeDb();
    },
  };
}
