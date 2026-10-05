import type {
  Bot,
  BotConfig,
  BotRepository,
  BotVersion,
  Contact,
  ContactFact,
  ContactFactRepository,
  ContactProfile,
  ContactRepository,
  ConversationRepository,
  EventStore,
  InteractionEvent,
  JobName,
  JobQueue,
  Mission,
  MissionRepository,
  ProfileLoader,
  TelephonyProvider,
  ToolCallContext,
  ToolGateway,
  ToolResult,
} from "@ofd/core";
import { BotConfig as BotConfigSchema } from "@ofd/core";

export const ORG = "org_test";

export function makeContact(id: string, over: Partial<Contact> = {}): Contact {
  return {
    id,
    orgId: ORG,
    displayName: `Paciente ${id}`,
    identities: [
      { kind: "whatsapp", value: `+54911${id.padStart(7, "0")}` },
      { kind: "phone", value: `+54911${id.padStart(7, "0")}` },
    ],
    attributes: {},
    tags: [],
    doNotCall: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

export function makeVersion(over: Partial<BotConfig> = {}): BotVersion {
  return {
    id: "bv_1",
    orgId: ORG,
    botId: "bot_1",
    version: 1,
    config: BotConfigSchema.parse({
      name: "Sofi",
      role: "recepcionista",
      instructions: "Atendé con calidez.",
      ...over,
    }),
    status: "published",
    evalRunId: null,
    createdAt: new Date(0),
  };
}

export class FakeJobs implements JobQueue {
  sent: Array<{
    name: JobName;
    data: Record<string, unknown>;
    opts?: { startAfterSeconds?: number; singletonKey?: string };
  }> = [];
  async enqueue<T extends object>(
    name: JobName,
    data: T,
    opts?: { startAfterSeconds?: number; singletonKey?: string },
  ) {
    this.sent.push({ name, data: data as Record<string, unknown>, ...(opts ? { opts } : {}) });
    return `job_${this.sent.length}`;
  }
  of(name: JobName) {
    return this.sent.filter((s) => s.name === name);
  }
}

export class FakeEvents implements EventStore {
  all: InteractionEvent[] = [];
  private seq = 0;
  async append(e: Parameters<EventStore["append"]>[0]) {
    const ev = {
      ...e,
      id: `ev_${++this.seq}`,
      occurredAt: e.occurredAt ?? new Date(),
    } as InteractionEvent;
    this.all.push(ev);
    return ev as never;
  }
  async listByConversation(orgId: string, conversationId: string) {
    return this.all.filter((e) => e.orgId === orgId && e.conversationId === conversationId);
  }
  async list(orgId: string, opts: { types?: string[]; contactId?: string } = {}) {
    const items = this.all
      .filter(
        (e) =>
          e.orgId === orgId &&
          (!opts.types || opts.types.includes(e.type)) &&
          (!opts.contactId || e.contactId === opts.contactId),
      )
      .reverse();
    return { items, nextCursor: null };
  }
  ofType(type: string) {
    return this.all.filter((e) => e.type === type);
  }
}

export class FakeMissions implements MissionRepository {
  items = new Map<string, Mission>();
  add(m: Partial<Mission> & { id: string }): Mission {
    const mission: Mission = {
      orgId: ORG,
      botId: "bot_1",
      createdBy: "user_1",
      instruction: "contactar pacientes",
      status: "planning",
      plan: null,
      report: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      ...m,
    };
    this.items.set(mission.id, mission);
    return mission;
  }
  async create(): Promise<Mission> {
    throw new Error("not used");
  }
  async get(_orgId: string, id: string) {
    return this.items.get(id) ?? null;
  }
  async list() {
    return [...this.items.values()];
  }
  async update(
    _orgId: string,
    id: string,
    patch: Partial<Pick<Mission, "status" | "plan" | "report">>,
  ) {
    const cur = this.items.get(id);
    if (!cur) throw new Error("missing mission");
    const next = { ...cur, ...patch };
    this.items.set(id, next);
    return next;
  }
}

export class FakeBots implements Pick<BotRepository, "get" | "getVersion"> {
  constructor(public version: BotVersion | null = makeVersion()) {}
  async get(_orgId: string, id: string): Promise<Bot | null> {
    if (!this.version || id !== this.version.botId) return null;
    return {
      id: this.version.botId,
      orgId: ORG,
      name: "Sofi",
      publishedVersionId: this.version.id,
      createdAt: new Date(0),
    };
  }
  async getVersion(_orgId: string, id: string) {
    return this.version && id === this.version.id ? this.version : null;
  }
}

export class FakeContacts implements Pick<ContactRepository, "get"> {
  constructor(public contacts: Contact[]) {}
  async get(_orgId: string, id: string) {
    return this.contacts.find((c) => c.id === id) ?? null;
  }
}

export const fakeProfiles: ProfileLoader = {
  async load(_orgId, contactId): Promise<ContactProfile | null> {
    return { contact: makeContact(contactId), obligations: [], facts: [], recentSummaries: [] };
  },
};

export class FakeConversations implements ConversationRepository {
  started: Array<{ id: string; channel: string; missionId?: string | null }> = [];
  ended: Array<{ id: string; outcome: string }> = [];
  async start(_orgId: string, input: { channel: string; missionId?: string | null }) {
    const id = `cv_${this.started.length + 1}`;
    this.started.push({ id, channel: input.channel, missionId: input.missionId });
    return { id };
  }
  async end(_orgId: string, id: string, outcome: string) {
    this.ended.push({ id, outcome });
  }
}

export class FakeFacts implements ContactFactRepository {
  items: ContactFact[] = [];
  async add(orgId: string, fact: Omit<ContactFact, "id" | "orgId" | "createdAt">) {
    const f: ContactFact = {
      ...fact,
      id: `fact_${this.items.length + 1}`,
      orgId,
      createdAt: new Date(0),
    };
    this.items.push(f);
    return f;
  }
  async listByContact(_orgId: string, contactId: string) {
    return this.items.filter((f) => f.contactId === contactId);
  }
}

export class FakeGateway implements ToolGateway {
  calls: Array<{ tool: string; input: unknown; ctx: ToolCallContext }> = [];
  result: ToolResult = { ok: true, output: { sent: true } };
  list() {
    return [];
  }
  async call(tool: string, input: unknown, ctx: ToolCallContext) {
    this.calls.push({ tool, input, ctx });
    return this.result;
  }
}

export class FakeTelephony implements TelephonyProvider {
  readonly id = "fake";
  dialed: Array<Parameters<TelephonyProvider["dial"]>[0]> = [];
  async dial(input: Parameters<TelephonyProvider["dial"]>[0]) {
    this.dialed.push(input);
    return { callId: "call_1" };
  }
}
