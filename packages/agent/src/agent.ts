import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { Memory } from "@mastra/memory";
import type { BotVersion, ContactProfile, EventStore, ToolGateway } from "@ofd/core";
import { buildGatewayTools, type GatewayToolContext } from "./gateway-tools.js";
import {
  FrontDeskInputGuard,
  FrontDeskOutputGuard,
  type GuardContext,
  type OutputRules,
} from "./guards.js";
import { buildInstructions } from "./instructions.js";

export type LanguageModel = MastraModelConfig;

export interface CreateFrontDeskAgentOptions {
  botVersion: BotVersion;
  gateway: ToolGateway;
  toolContext: GatewayToolContext;
  /** Preloaded before the conversation starts; the agent never looks the customer up mid-call. */
  profile: ContactProfile | null;
  memory?: Memory;
  /** Defaults to the bot config's model. */
  model?: string | LanguageModel;
  /** Policy limits enforced on every reply (max discount, legal threats). */
  outputRules?: OutputRules;
  /** When given, guard hits are appended as guard.input_flagged / guard.output_blocked. */
  events?: EventStore;
}

export function createFrontDeskAgent(opts: CreateFrontDeskAgentOptions): Agent {
  const { botVersion, gateway, toolContext, profile } = opts;
  const config = botVersion.config;
  const guardCtx: GuardContext = {
    orgId: toolContext.orgId,
    conversationId: toolContext.conversationId,
    contactId: toolContext.contactId,
    botVersionId: botVersion.id,
  };

  return new Agent({
    id: `front-desk-${botVersion.id}`,
    name: config.name,
    description: config.role,
    instructions: buildInstructions(config, profile),
    model: (opts.model ?? config.model) as MastraModelConfig,
    tools: buildGatewayTools(gateway, config.tools, {
      ...toolContext,
      botVersionId: toolContext.botVersionId ?? botVersion.id,
    }),
    ...(opts.memory ? { memory: opts.memory } : {}),
    inputProcessors: [new FrontDeskInputGuard(guardCtx, opts.events)],
    outputProcessors: [new FrontDeskOutputGuard(opts.outputRules ?? {}, guardCtx, opts.events)],
  });
}
