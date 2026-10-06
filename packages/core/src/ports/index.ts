import type { Bot, BotConfig, BotVersion, BotVersionStatus } from "../domain/bot.js";
import type { ContactWindow } from "../domain/contact-window.js";
import type {
  Contact,
  ContactFact,
  ContactIdentity,
  ContactProfile,
  Obligation,
  Portfolio,
  PortfolioRule,
} from "../domain/crm.js";
import type { EventType, InteractionEvent, NewEvent } from "../domain/events.js";
import type { Mission, MissionPlan, MissionStatus } from "../domain/mission.js";
import type { PolicyRule } from "../domain/policy.js";

/**
 * Ports are the only way the application reaches infrastructure. Adapters live in
 * @ofd/db (Postgres), @ofd/channels (Kapso, LiveKit, Twilio) and @ofd/crm (connectors).
 * Every method is scoped by orgId; implementations must filter by it.
 */

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ListOptions {
  limit?: number;
  cursor?: string | null;
}

export interface ContactRepository {
  create(
    orgId: string,
    input: {
      displayName: string;
      identities: ContactIdentity[];
      attributes?: Record<string, unknown>;
      tags?: string[];
      doNotCall?: boolean;
    },
  ): Promise<Contact>;
  get(orgId: string, id: string): Promise<Contact | null>;
  findByIdentity(
    orgId: string,
    identity: Pick<ContactIdentity, "kind" | "value">,
  ): Promise<Contact | null>;
  update(
    orgId: string,
    id: string,
    patch: Partial<Pick<Contact, "displayName" | "attributes" | "tags" | "doNotCall">>,
  ): Promise<Contact>;
  list(orgId: string, opts?: ListOptions & { search?: string }): Promise<Page<Contact>>;
}

export interface PortfolioRepository {
  create(
    orgId: string,
    input: { name: string; owner?: string | null; rule: PortfolioRule },
  ): Promise<Portfolio>;
  get(orgId: string, id: string): Promise<Portfolio | null>;
  list(orgId: string): Promise<Portfolio[]>;
  /** Contacts and obligations that match the portfolio rule right now. */
  members(
    orgId: string,
    id: string,
    opts?: ListOptions,
  ): Promise<Page<{ contact: Contact; obligation: Obligation }>>;
}

export interface ObligationRepository {
  upsert(
    orgId: string,
    input: Omit<Obligation, "id" | "orgId" | "createdAt" | "updatedAt"> & { id?: string },
  ): Promise<Obligation>;
  listByContact(orgId: string, contactId: string): Promise<Obligation[]>;
}

export interface ContactFactRepository {
  add(orgId: string, fact: Omit<ContactFact, "id" | "orgId" | "createdAt">): Promise<ContactFact>;
  listByContact(orgId: string, contactId: string): Promise<ContactFact[]>;
}

export interface ProfileLoader {
  /** Builds the context preloaded at the start of every conversation. No lookups mid-call. */
  load(orgId: string, contactId: string): Promise<ContactProfile | null>;
}

export interface BotRepository {
  create(orgId: string, name: string): Promise<Bot>;
  get(orgId: string, id: string): Promise<Bot | null>;
  list(orgId: string): Promise<Bot[]>;
  createVersion(orgId: string, botId: string, config: BotConfig): Promise<BotVersion>;
  getVersion(orgId: string, versionId: string): Promise<BotVersion | null>;
  listVersions(orgId: string, botId: string): Promise<BotVersion[]>;
  setVersionStatus(
    orgId: string,
    versionId: string,
    status: BotVersionStatus,
    evalRunId?: string | null,
  ): Promise<BotVersion>;
  /** Only callable after the version's eval run passed. */
  publish(orgId: string, botId: string, versionId: string): Promise<Bot>;
}

export interface EventStore {
  append<T extends EventType>(event: NewEvent<T>): Promise<InteractionEvent<T>>;
  listByConversation(orgId: string, conversationId: string): Promise<InteractionEvent[]>;
  list(
    orgId: string,
    opts?: ListOptions & { types?: EventType[]; contactId?: string },
  ): Promise<Page<InteractionEvent>>;
}

export interface ConversationRepository {
  start(
    orgId: string,
    input: {
      channel: string;
      contactId: string | null;
      botVersionId: string;
      direction: "inbound" | "outbound";
      missionId?: string | null;
    },
  ): Promise<{ id: string }>;
  end(orgId: string, id: string, outcome: string, summary?: string): Promise<void>;
}

export interface PolicyRepository {
  /** Org-level rules plus the rules of the bot's installed pack. */
  rulesFor(orgId: string, botId: string | null): Promise<PolicyRule[]>;
  setOrgRules(orgId: string, rules: PolicyRule[]): Promise<void>;
}

/** Per-organization settings. Null means "not set": callers fall back to the deployment default. */
export interface OrgSettingsRepository {
  getContactWindow(orgId: string): Promise<ContactWindow | null>;
  setContactWindow(orgId: string, window: ContactWindow | null): Promise<void>;
}

export interface MissionRepository {
  create(
    orgId: string,
    input: { botId: string; createdBy: string; instruction: string },
  ): Promise<Mission>;
  get(orgId: string, id: string): Promise<Mission | null>;
  list(orgId: string): Promise<Mission[]>;
  update(
    orgId: string,
    id: string,
    patch: Partial<Pick<Mission, "status" | "plan" | "report">>,
  ): Promise<Mission>;
}

export interface KnowledgeSearch {
  /** Hybrid search: BM25 (pg_textsearch) + vector similarity (pgvector). */
  search(
    orgId: string,
    query: string,
    opts?: { limit?: number; botId?: string },
  ): Promise<Array<{ id: string; title: string; content: string; score: number }>>;
  ingest(
    orgId: string,
    doc: { title: string; content: string; botId?: string | null },
  ): Promise<{ id: string }>;
}

/** Short-lived holds so the same slot is never offered to two contacts. Backed by Redis. */
export interface HoldStore {
  tryHold(key: string, holder: string, ttlSeconds: number): Promise<boolean>;
  release(key: string, holder: string): Promise<void>;
}

export interface MessagingProvider {
  readonly id: string;
  send(input: {
    orgId: string;
    to: string;
    text: string;
    conversationId: string;
  }): Promise<{ providerMessageId: string }>;
}

export interface TelephonyProvider {
  readonly id: string;
  /** Places an outbound call and dispatches the voice agent into it. */
  dial(input: {
    orgId: string;
    to: string;
    botVersionId: string;
    conversationId: string;
    context?: Record<string, unknown>;
  }): Promise<{ callId: string }>;
}

/** External CRM sync. The canonical model stays local; connectors mirror and write back. */
export interface CrmConnector {
  readonly id: string;
  pull(
    orgId: string,
    since: Date | null,
  ): AsyncIterable<{
    contact: Omit<Contact, "id" | "orgId" | "createdAt" | "updatedAt">;
    obligations: Array<Omit<Obligation, "id" | "orgId" | "contactId" | "createdAt" | "updatedAt">>;
  }>;
  pushOutcome(
    orgId: string,
    input: {
      externalContactId: string;
      summary: string;
      outcome: string;
      facts: Array<{ key: string; value: string }>;
    },
  ): Promise<void>;
}

export interface JobQueue {
  enqueue<T extends object>(
    name: JobName,
    data: T,
    opts?: { startAfterSeconds?: number; singletonKey?: string },
  ): Promise<string>;
}

export type JobName =
  | "mission.plan"
  | "mission.execute"
  | "mission.contact"
  | "conversation.extract_facts"
  | "goal.tick"
  | "crm.sync";

export interface Clock {
  now(): Date;
}

export type MissionStatusTransition = { from: MissionStatus; to: MissionStatus };
export type { MissionPlan };

/**
 * A tool a bot can request. Handlers never run directly: every call goes through
 * the ToolGateway, which evaluates policy and writes the audit event first.
 */
export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  effect: import("../domain/policy.js").ToolEffect;
  /** Zod schema for the input. Kept as `unknown` here so core does not leak zod generics. */
  inputSchema: import("zod").ZodType<I>;
  timeoutMs?: number;
  handler(input: I, ctx: ToolCallContext): Promise<O>;
}

export interface ToolCallContext {
  orgId: string;
  actor: import("../domain/identity.js").Actor;
  conversationId: string | null;
  contactId: string | null;
  botVersionId: string | null;
  autonomy: number | null;
  initiator: import("../domain/policy.js").PolicyContext["initiator"];
  traceId: string | null;
}

export type ToolResult<O = unknown> =
  | { ok: true; output: O }
  | { ok: false; refused: true; ruleId: string; reason: string }
  | { ok: false; refused: false; error: string };

export interface ToolGateway {
  /** Tools registered and visible to a given bot version. */
  list(botTools: string[]): ToolDefinition[];
  /** Resolve → evaluate policy → append audit event → execute → append result event. */
  call(toolName: string, input: unknown, ctx: ToolCallContext): Promise<ToolResult>;
}
