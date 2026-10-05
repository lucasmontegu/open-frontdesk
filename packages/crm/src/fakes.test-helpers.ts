import { randomUUID } from "node:crypto";
import type { Contact, ContactRepository, Obligation, ObligationRepository } from "@ofd/core";

export class FakeContactRepository implements ContactRepository {
  readonly rows = new Map<string, Contact>();

  async create(orgId: string, input: Parameters<ContactRepository["create"]>[1]) {
    const now = new Date();
    const c: Contact = { id: randomUUID(), orgId, displayName: input.displayName, identities: input.identities, attributes: input.attributes ?? {}, tags: input.tags ?? [], doNotCall: input.doNotCall ?? false, createdAt: now, updatedAt: now };
    this.rows.set(c.id, c);
    return c;
  }
  async get(orgId: string, id: string) {
    const c = this.rows.get(id);
    return c && c.orgId === orgId ? c : null;
  }
  async findByIdentity(orgId: string, identity: { kind: string; value: string }) {
    return [...this.rows.values()].find((c) => c.orgId === orgId && c.identities.some((i) => i.kind === identity.kind && i.value === identity.value)) ?? null;
  }
  async update(orgId: string, id: string, patch: Parameters<ContactRepository["update"]>[2]) {
    const c = await this.get(orgId, id);
    if (!c) throw new Error("not found");
    const next = { ...c, ...patch, updatedAt: new Date() };
    this.rows.set(id, next);
    return next;
  }
  async list(orgId: string) {
    return { items: [...this.rows.values()].filter((c) => c.orgId === orgId), nextCursor: null };
  }
}

export class FakeObligationRepository implements ObligationRepository {
  readonly rows = new Map<string, Obligation>();

  async upsert(orgId: string, input: Parameters<ObligationRepository["upsert"]>[1]) {
    const now = new Date();
    const prev = input.id ? this.rows.get(input.id) : undefined;
    const o: Obligation = { ...input, id: input.id ?? randomUUID(), orgId, createdAt: prev?.createdAt ?? now, updatedAt: now };
    this.rows.set(o.id, o);
    return o;
  }
  async listByContact(orgId: string, contactId: string) {
    return [...this.rows.values()].filter((o) => o.orgId === orgId && o.contactId === contactId);
  }
}

/** A fake fetch that answers from a queue of responses and records requests. */
export function fakeFetch(responses: Array<{ status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 500, body: "no response queued" };
    return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  };
  return { fetch: fn, calls };
}
