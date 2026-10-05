import { type BuiltinToolDeps, InMemoryCalendar, InMemoryHoldStore } from "@ofd/agent";
import type {
  Clock,
  Contact,
  ContactProfile,
  ContactRepository,
  EventStore,
  EventType,
  InteractionEvent,
  JobQueue,
  KnowledgeSearch,
  MessagingProvider,
  NewEvent,
  Obligation,
  ObligationRepository,
  Page,
} from "@ofd/core";
import type { EvalScenario } from "@ofd/packs";

/** Used when a scenario has no `now`: a Tuesday at 11:00 in Argentina, inside every pack's contact hours. */
export const DEFAULT_NOW = "2026-10-06T11:00:00-03:00";

export function scenarioNow(scenario: EvalScenario): Date {
  const now = new Date(scenario.now ?? DEFAULT_NOW);
  if (Number.isNaN(now.getTime()))
    throw new Error(`scenario "${scenario.id}": invalid "now": ${scenario.now}`);
  return now;
}

export class InMemoryEventStore implements EventStore {
  readonly events: InteractionEvent[] = [];
  constructor(private readonly clock: Clock) {}

  async append<T extends EventType>(event: NewEvent<T>): Promise<InteractionEvent<T>> {
    const stored = {
      ...event,
      id: `ev-${this.events.length + 1}`,
      occurredAt: event.occurredAt ?? this.clock.now(),
    } as InteractionEvent<T>;
    this.events.push(stored as unknown as InteractionEvent);
    return stored;
  }

  async listByConversation(orgId: string, conversationId: string): Promise<InteractionEvent[]> {
    return this.events.filter((e) => e.orgId === orgId && e.conversationId === conversationId);
  }

  async list(
    orgId: string,
    opts: { limit?: number; types?: EventType[]; contactId?: string } = {},
  ): Promise<Page<InteractionEvent>> {
    const items = this.events
      .filter((e) => e.orgId === orgId)
      .filter((e) => !opts.types || opts.types.includes(e.type))
      .filter((e) => !opts.contactId || e.contactId === opts.contactId)
      .slice(0, opts.limit ?? 200);
    return { items, nextCursor: null };
  }
}

class InMemoryContacts implements ContactRepository {
  readonly byId = new Map<string, Contact>();

  async create(orgId: string, input: Parameters<ContactRepository["create"]>[1]): Promise<Contact> {
    const now = new Date();
    const contact: Contact = {
      id: `ct-${this.byId.size + 1}`,
      orgId,
      displayName: input.displayName,
      identities: input.identities,
      attributes: input.attributes ?? {},
      tags: input.tags ?? [],
      doNotCall: input.doNotCall ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(contact.id, contact);
    return contact;
  }
  async get(orgId: string, id: string) {
    const c = this.byId.get(id);
    return c && c.orgId === orgId ? c : null;
  }
  async findByIdentity(orgId: string, identity: { kind: string; value: string }) {
    return (
      [...this.byId.values()].find(
        (c) =>
          c.orgId === orgId &&
          c.identities.some((i) => i.kind === identity.kind && i.value === identity.value),
      ) ?? null
    );
  }
  async update(orgId: string, id: string, patch: Parameters<ContactRepository["update"]>[2]) {
    const current = await this.get(orgId, id);
    if (!current) throw new Error("contact not found");
    const next = { ...current, ...patch, updatedAt: new Date() };
    this.byId.set(id, next);
    return next;
  }
  async list(orgId: string) {
    return { items: [...this.byId.values()].filter((c) => c.orgId === orgId), nextCursor: null };
  }
}

class InMemoryObligations implements ObligationRepository {
  private readonly byId = new Map<string, Obligation>();

  async upsert(
    orgId: string,
    input: Parameters<ObligationRepository["upsert"]>[1],
  ): Promise<Obligation> {
    const now = new Date();
    const id = input.id ?? `ob-${this.byId.size + 1}`;
    const previous = this.byId.get(id);
    const { id: _ignored, ...rest } = input;
    const next: Obligation = {
      ...rest,
      id,
      orgId,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.byId.set(id, next);
    return next;
  }
  async listByContact(orgId: string, contactId: string) {
    return [...this.byId.values()].filter((o) => o.orgId === orgId && o.contactId === contactId);
  }
}

export interface SentMessage {
  to: string;
  text: string;
}

export interface World {
  orgId: string;
  contactId: string;
  conversationId: string;
  now: Date;
  clock: Clock;
  events: InMemoryEventStore;
  contacts: ContactRepository;
  calendar: InMemoryCalendar;
  deps: BuiltinToolDeps;
  sent: SentMessage[];
  profile(): Promise<ContactProfile>;
}

/** Everything a scenario needs, in memory: its contact fixture, a calendar with free slots, stub providers. */
export async function createWorld(orgId: string, scenario: EvalScenario): Promise<World> {
  const now = scenarioNow(scenario);
  const clock: Clock = { now: () => now };
  const events = new InMemoryEventStore(clock);
  const contacts = new InMemoryContacts();
  const obligations = new InMemoryObligations();
  const calendar = new InMemoryCalendar();
  const sent: SentMessage[] = [];

  const fixture = scenario.contact;
  const contact = await contacts.create(orgId, {
    displayName: fixture.displayName,
    identities: [{ kind: "whatsapp", value: "+5491100000000" }],
    attributes: fixture.attributes,
    doNotCall: fixture.doNotCall,
  });

  // Free slots for the next two weeks: hourly, 9-12 and 14-18 Argentina time.
  const slots: Array<{ start: Date; end: Date }> = [];
  const day0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let d = 1; d <= 14; d++) {
    for (const hour of [9, 10, 11, 14, 15, 16, 17]) {
      const start = new Date(day0 + d * 86_400_000 + (hour + 3) * 3_600_000);
      slots.push({ start, end: new Date(start.getTime() + 3_600_000) });
    }
  }
  calendar.addSlots(orgId, slots);

  for (const o of fixture.obligations) {
    const dueAt = o.dueAt ? new Date(o.dueAt) : null;
    let attributes = o.attributes;
    if (o.kind === "appointment" && dueAt && !Number.isNaN(dueAt.getTime())) {
      const [slot] = calendar.addSlots(orgId, [
        { start: dueAt, end: new Date(dueAt.getTime() + 1_800_000) },
      ]);
      const booking = await calendar.book(orgId, { contactId: contact.id, slotId: slot!.id });
      attributes = { ...attributes, bookingId: booking.id };
    }
    await obligations.upsert(orgId, {
      contactId: contact.id,
      portfolioId: null,
      kind: o.kind,
      stage: o.stage,
      amount: o.amount,
      currency: o.currency,
      dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null,
      attributes,
    });
  }

  const knowledge: KnowledgeSearch = {
    search: async () => [],
    ingest: async () => ({ id: "kn-1" }),
  };
  const messaging: MessagingProvider = {
    id: "eval",
    send: async ({ to, text }) => {
      sent.push({ to, text });
      return { providerMessageId: `msg-${sent.length}` };
    },
  };
  const jobs: JobQueue = { enqueue: async () => "job-1" };

  const deps: BuiltinToolDeps = {
    contacts,
    obligations,
    knowledge,
    calendar,
    holds: new InMemoryHoldStore(() => now.getTime()),
    messaging,
    jobs,
    events,
    paymentLinks: { create: async () => ({ url: "https://pagos.example/eval" }) },
    clock,
  };

  return {
    orgId,
    contactId: contact.id,
    conversationId: "conv-eval",
    now,
    clock,
    events,
    contacts,
    calendar,
    deps,
    sent,
    async profile() {
      const fresh = (await contacts.get(orgId, contact.id)) ?? contact;
      return {
        contact: fresh,
        obligations: await obligations.listByContact(orgId, contact.id),
        facts: [],
        recentSummaries: [],
      };
    },
  };
}
