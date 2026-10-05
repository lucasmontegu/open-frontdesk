/**
 * Voice worker entry. Run with `node dist/main.js start` (or `dev`).
 *
 * Design choice: @mastra/livekit's `createLiveKitWorker` takes a Mastra instance plus an agent, but
 * `agent` may be a resolver `({ metadata, ctx }) => string | Agent` called once per job, and the
 * returned Agent instance does not have to be registered in Mastra. We use that supported path:
 * the resolver reads the dispatch metadata, identifies the contact (outbound: dispatch context;
 * inbound SIP: caller phone), preloads the profile and builds the bot version's agent with
 * createFrontDeskAgent (gateway tools + memory scoped by contact). STT/TTS/turn detection come
 * from the version's voice config through the `configuration` resolvers, which also run per call.
 * Hence a static `new Mastra({})` is enough and no agent is registered up front.
 *
 * LiveKit loads this file as the job entry inside child processes, so the container is created
 * lazily (first call) instead of at import time, and the CLI only starts when the file is run directly.
 *
 * Hooks used: onTurnComplete (customer.message / agent.message events), onCallEnd
 * (conversation.ended + conversation.extract_facts). The API exposes no per-utterance hook for
 * interrupted agent speech; recorded agent text is what the model streamed, which can include words
 * cut off by barge-in. TODO: reconcile with LiveKit's committed transcript if the difference matters.
 */
import { VOICE_AGENT_NAME } from "@ofd/channels";
import { fileURLToPath } from "node:url";
import type { AgentDefinition } from "@livekit/agents";
import { Mastra } from "@mastra/core/mastra";
import { createLiveKitWorker, runLiveKitWorker } from "@mastra/livekit/worker";
import { turnDetector } from "@livekit/agents-plugin-livekit";
import { parseDispatchMetadata } from "./dispatch.js";
import { prepareCall, type PreparedCall } from "./call.js";
import { createContainer, type Container } from "./container.js";
import { finishCall, recordTurn } from "./events.js";
import { parseSipParticipant } from "./inbound.js";
import { toolFeedback } from "./voice-plugins.js";


let containerPromise: Promise<Container> | null = null;
const getContainer = () => (containerPromise ??= createContainer());

const callsByJob = new Map<string, PreparedCall>();
const callsByConversation = new Map<string, PreparedCall>();

const firstName = (name: string | undefined) => name?.trim().split(/\s+/)[0] ?? "";

export function greetingFor(call: Pick<PreparedCall, "direction" | "version" | "profile">): string {
  const bot = call.version.config.name;
  const who = firstName(call.profile?.contact.displayName);
  return call.direction === "inbound"
    ? `Hola, te comunicaste con ${bot}. Soy un asistente virtual, ¿en qué te puedo ayudar?`
    : `Hola${who ? `, ¿hablo con ${who}?` : ""} Te llamo de parte de ${bot}. Soy un asistente virtual.`;
}

// biome-ignore lint/suspicious/noExplicitAny: the worker user-data type is private to @mastra/livekit
const worker: AgentDefinition<any> = createLiveKitWorker({
  mastra: new Mastra({}),
  turnDetection: "multilingual",
  toolFeedback,

  agent: async ({ ctx }) => {
    const container = await getContainer();
    const parsed = parseDispatchMetadata(ctx.job.metadata);
    let request: Parameters<typeof prepareCall>[1];
    if (parsed.kind === "outbound") {
      request = { kind: "outbound", dispatch: parsed.dispatch };
    } else {
      // Inbound SIP: the caller is the first participant to join.
      await ctx.connect();
      const caller = parseSipParticipant(await ctx.waitForParticipant());
      request = { kind: "inbound", callerPhone: caller.callerPhone, calledNumber: caller.calledNumber };
    }
    const call = await prepareCall(container.callDeps, request);
    callsByJob.set(ctx.job.id, call);
    callsByConversation.set(call.conversationId, call);
    container.log.info({ conversationId: call.conversationId, direction: call.direction, contactId: call.contactId, botVersionId: call.version.id }, "voice call starting");
    return call.agent as never;
  },

  memory: ({ ctx }) => {
    const call = callsByJob.get(ctx.job.id);
    return call ? call.memory : false;
  },

  configuration: {
    greeting: { text: ({ ctx }) => greetingFor(callsByJob.get(ctx.job.id) as PreparedCall), allowInterruptions: false },
    stt: async ({ ctx }) => {
      const call = callsByJob.get(ctx.job.id);
      return call ? ((await getContainer()).voice.stt(call.version.config.voice) as never) : undefined;
    },
    tts: async ({ ctx }) => {
      const call = callsByJob.get(ctx.job.id);
      return call ? ((await getContainer()).voice.tts(call.version.config.voice) as never) : undefined;
    },
    // Turn detectors need the job context, so they are built here, per call.
    turnDetection: ({ ctx }) => {
      const mode = callsByJob.get(ctx.job.id)?.version.config.voice.turnDetection ?? "multilingual";
      return mode === "multilingual" ? (new turnDetector.MultilingualModel() as never) : mode;
    },
  },

  onTurnComplete: async ({ messages, memory, result }) => {
    const call = memory ? callsByConversation.get(memory.thread) : undefined;
    if (!call) return;
    const { callDeps } = await getContainer();
    await recordTurn(callDeps.events, call, { customer: messages.filter((m) => m.role === "user").map((m) => m.content), agent: result.text });
  },

  onCallEnd: async ({ ctx }) => {
    const call = callsByJob.get(ctx.job.id);
    if (!call) return;
    const container = await getContainer();
    await finishCall({ conversations: container.callDeps.conversations, events: container.callDeps.events, jobs: container.jobs, log: container.log }, call);
    callsByJob.delete(ctx.job.id);
    callsByConversation.delete(call.conversationId);
  },
});

export default worker;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runLiveKitWorker({ entry: import.meta.url, agentName: VOICE_AGENT_NAME });
}
