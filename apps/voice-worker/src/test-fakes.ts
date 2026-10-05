import type { BotVersion, Contact, ContactProfile, EventStore, InteractionEvent, ToolGateway } from "@ofd/core";
import { BotConfig } from "@ofd/core";

export const ORG = "org_test";

export const makeContact = (id: string, phone: string): Contact => ({
  id, orgId: ORG, displayName: "Lucía Pérez", identities: [{ kind: "phone", value: phone }], attributes: {}, tags: [], doNotCall: false, createdAt: new Date(0), updatedAt: new Date(0),
});

export const makeVersion = (over: Partial<BotConfig> = {}): BotVersion => ({
  id: "bv_1", orgId: ORG, botId: "bot_1", version: 1, status: "published", evalRunId: null, createdAt: new Date(0),
  config: BotConfig.parse({ name: "Sofi", role: "recepcionista", instructions: "Atendé con calidez.", tools: ["lookup_contact"], ...over }),
});

export class FakeEvents implements EventStore {
  all: InteractionEvent[] = [];
  async append(e: Parameters<EventStore["append"]>[0]) {
    const ev = { ...e, id: `ev_${this.all.length + 1}`, occurredAt: new Date() } as InteractionEvent;
    this.all.push(ev);
    return ev as never;
  }
  async listByConversation(_o: string, id: string) { return this.all.filter((e) => e.conversationId === id); }
  async list() { return { items: this.all, nextCursor: null }; }
}

export const fakeGateway: ToolGateway = {
  list: () => [],
  call: async () => ({ ok: true, output: {} }),
};

export const profileFor = (contact: Contact): ContactProfile => ({ contact, obligations: [], facts: [], recentSummaries: [] });
