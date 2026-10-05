import {
  type BotRepository,
  type BotVersion,
  type ContactProfile,
  type ContactRepository,
  type ConversationRepository,
  type EventStore,
  OrgId,
  type ProfileLoader,
  type ToolCallContext,
} from "@ofd/core";
import type { OutboundDispatch } from "./dispatch.js";
import { findContactByPhone, routeInbound } from "./inbound.js";

export interface CallDeps {
  bots: Pick<BotRepository, "getVersion">;
  contacts: Pick<ContactRepository, "findByIdentity">;
  profiles: ProfileLoader;
  conversations: ConversationRepository;
  events: EventStore;
  /** Builds the Mastra agent: createFrontDeskAgent with the gateway and memory in production. */
  buildAgent(input: {
    version: BotVersion;
    profile: ContactProfile | null;
    toolContext: Omit<ToolCallContext, "traceId">;
  }): unknown;
  env?: Record<string, string | undefined>;
}

export interface PreparedCall<A = unknown> {
  orgId: string;
  direction: "inbound" | "outbound";
  version: BotVersion;
  conversationId: string;
  contactId: string | null;
  profile: ContactProfile | null;
  agent: A;
  /** Memory is scoped by contact (resourceId), one thread per conversation. */
  memory: { thread: string; resource: string };
}

export type CallRequest =
  | { kind: "outbound"; dispatch: OutboundDispatch }
  | { kind: "inbound"; callerPhone: string | null; calledNumber: string | null };

/** Resolves who is on the line and which bot answers, then builds the agent with the preloaded profile. */
export async function prepareCall<A = unknown>(
  deps: CallDeps,
  request: CallRequest,
): Promise<PreparedCall<A>> {
  let orgId: string;
  let botVersionId: string;
  let conversationId: string;
  let contactId: string | null;

  if (request.kind === "outbound") {
    ({ orgId, botVersionId, conversationId } = request.dispatch);
    const fromContext = request.dispatch.context["contactId"];
    contactId =
      typeof fromContext === "string"
        ? fromContext
        : await contactFromConversation(deps.events, orgId, conversationId);
  } else {
    ({ orgId, botVersionId } = routeInbound(deps.env ?? process.env, request.calledNumber));
    const contact = request.callerPhone
      ? await findContactByPhone(deps.contacts, orgId, request.callerPhone)
      : null;
    contactId = contact?.id ?? null;
    conversationId = "";
  }

  const version = await deps.bots.getVersion(orgId, botVersionId);
  if (!version) throw new Error(`Bot version ${botVersionId} not found for org ${orgId}`);

  if (request.kind === "inbound") {
    conversationId = (
      await deps.conversations.start(orgId, {
        channel: "voice",
        contactId,
        botVersionId,
        direction: "inbound",
      })
    ).id;
    await deps.events.append({
      orgId,
      type: "conversation.started",
      payload: { channel: "voice", contactId, direction: "inbound" },
      conversationId,
      botVersionId,
      contactId,
      actorKind: "system",
      actorId: "voice-worker",
      traceId: null,
    });
  }

  const profile = contactId ? await deps.profiles.load(orgId, contactId) : null;
  const toolContext: Omit<ToolCallContext, "traceId"> = {
    orgId,
    actor: { kind: "bot", id: version.botId, orgId: OrgId.parse(orgId), botVersionId: version.id },
    conversationId,
    contactId,
    botVersionId: version.id,
    autonomy: version.config.autonomy,
    initiator: request.kind === "inbound" ? "inbound" : "mission",
  };
  const agent = deps.buildAgent({ version, profile, toolContext }) as A;

  return {
    orgId,
    direction: request.kind,
    version,
    conversationId,
    contactId,
    profile,
    agent,
    memory: { thread: conversationId, resource: contactId ?? conversationId },
  };
}

async function contactFromConversation(
  events: EventStore,
  orgId: string,
  conversationId: string,
): Promise<string | null> {
  const list = await events.listByConversation(orgId, conversationId);
  return list.find((e) => e.contactId)?.contactId ?? null;
}
