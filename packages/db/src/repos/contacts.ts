import type { Contact, ContactIdentity, ContactRepository, Page } from "@ofd/core";
import { DomainError, notFound } from "@ofd/core";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { newId } from "../ids.js";
import { contactIdentities, contacts } from "../schema/index.js";
import { clampLimit, decodeCursor, encodeCursor, toPage } from "./util.js";

export type ContactRow = typeof contacts.$inferSelect;

export async function hydrateContacts(db: Db, orgId: string, rows: ContactRow[]): Promise<Contact[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const idents = await db
    .select()
    .from(contactIdentities)
    .where(and(eq(contactIdentities.orgId, orgId), inArray(contactIdentities.contactId, ids)));
  const byContact = new Map<string, ContactIdentity[]>();
  for (const i of idents) {
    const list = byContact.get(i.contactId) ?? [];
    list.push({ kind: i.kind, value: i.value, ...(i.source ? { source: i.source } : {}) });
    byContact.set(i.contactId, list);
  }
  return rows.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    displayName: r.displayName,
    identities: byContact.get(r.id) ?? [],
    attributes: r.attributes,
    tags: r.tags,
    doNotCall: r.doNotCall,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class PgContactRepository implements ContactRepository {
  constructor(private readonly db: Db) {}

  async create(
    orgId: string,
    input: { displayName: string; identities: ContactIdentity[]; attributes?: Record<string, unknown>; tags?: string[]; doNotCall?: boolean },
  ): Promise<Contact> {
    const id = newId("ct");
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(contacts).values({
          id,
          orgId,
          displayName: input.displayName,
          createdAt: new Date(),
          attributes: input.attributes ?? {},
          tags: input.tags ?? [],
          doNotCall: input.doNotCall ?? false,
        });
        if (input.identities.length > 0) {
          await tx.insert(contactIdentities).values(
            input.identities.map((i) => ({ id: newId("ci"), orgId, contactId: id, kind: i.kind, value: i.value, source: i.source ?? null })),
          );
        }
      });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw new DomainError("conflict", "an identity already belongs to another contact");
      throw err;
    }
    const created = await this.get(orgId, id);
    if (!created) throw notFound("contact");
    return created;
  }

  async get(orgId: string, id: string): Promise<Contact | null> {
    const rows = await this.db.select().from(contacts).where(and(eq(contacts.orgId, orgId), eq(contacts.id, id))).limit(1);
    return (await hydrateContacts(this.db, orgId, rows))[0] ?? null;
  }

  async findByIdentity(orgId: string, identity: Pick<ContactIdentity, "kind" | "value">): Promise<Contact | null> {
    const rows = await this.db
      .select({ contact: contacts })
      .from(contactIdentities)
      .innerJoin(contacts, eq(contacts.id, contactIdentities.contactId))
      .where(
        and(eq(contactIdentities.orgId, orgId), eq(contactIdentities.kind, identity.kind), eq(contactIdentities.value, identity.value)),
      )
      .limit(1);
    const row = rows[0];
    return row ? ((await hydrateContacts(this.db, orgId, [row.contact]))[0] ?? null) : null;
  }

  async update(
    orgId: string,
    id: string,
    patch: Partial<Pick<Contact, "displayName" | "attributes" | "tags" | "doNotCall">>,
  ): Promise<Contact> {
    const rows = await this.db
      .update(contacts)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(contacts.orgId, orgId), eq(contacts.id, id)))
      .returning();
    if (rows.length === 0) throw notFound("contact");
    return (await hydrateContacts(this.db, orgId, rows))[0] as Contact;
  }

  async list(orgId: string, opts: { limit?: number; cursor?: string | null; search?: string } = {}): Promise<Page<Contact>> {
    const limit = clampLimit(opts.limit);
    const cur = decodeCursor(opts.cursor, 2);
    const conds = [eq(contacts.orgId, orgId)];
    const term = opts.search?.trim();
    if (term) {
      const pattern = `%${escapeLike(term)}%`;
      conds.push(
        sql`(${contacts.displayName} ilike ${pattern} or exists (
          select 1 from ${contactIdentities}
          where ${contactIdentities.contactId} = ${contacts.id}
            and ${contactIdentities.orgId} = ${orgId}
            and ${contactIdentities.value} ilike ${pattern}))`,
      );
    }
    if (cur) {
      const [ts, id] = cur as [string, string];
      const at = new Date(Number(ts));
      conds.push(or(lt(contacts.createdAt, at), and(eq(contacts.createdAt, at), lt(contacts.id, id))) as never);
    }
    const rows = await this.db
      .select()
      .from(contacts)
      .where(and(...conds))
      .orderBy(desc(contacts.createdAt), desc(contacts.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (r) => encodeCursor(r.createdAt.getTime(), r.id));
    return { items: await hydrateContacts(this.db, orgId, page.items), nextCursor: page.nextCursor };
  }
}
