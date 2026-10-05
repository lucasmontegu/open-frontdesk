import type { Contact, ContactRepository, Obligation } from "@ofd/core";
import type { Sql } from "@ofd/db";

export type AppointmentsLoader = (
  orgId: string,
  range: { from: Date; to: Date },
) => Promise<Array<{ contact: Contact; obligation: Obligation }>>;

interface Row {
  id: string;
  contact_id: string;
  portfolio_id: string | null;
  kind: Obligation["kind"];
  stage: string;
  amount: string | null;
  currency: string | null;
  due_at: Date | null;
  attributes: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

/**
 * Appointments (obligations of kind 'appointment') whose due_at falls in [from, to).
 * No repository port lists obligations by date, so the worker queries the table directly.
 */
export function createAppointmentsLoader(sql: Sql, contacts: Pick<ContactRepository, "get">): AppointmentsLoader {
  return async (orgId, { from, to }) => {
    const rows = (await sql`
      select id, contact_id, portfolio_id, kind, stage, amount, currency, due_at, attributes, created_at, updated_at
      from obligations
      where org_id = ${orgId} and kind = 'appointment' and due_at >= ${from.toISOString()}::timestamptz and due_at < ${to.toISOString()}::timestamptz
      order by due_at asc
    `) as unknown as Row[];

    const byContact = new Map<string, Contact | null>();
    const out: Array<{ contact: Contact; obligation: Obligation }> = [];
    for (const r of rows) {
      if (!byContact.has(r.contact_id)) byContact.set(r.contact_id, await contacts.get(orgId, r.contact_id));
      const contact = byContact.get(r.contact_id);
      if (!contact) continue;
      out.push({
        contact,
        obligation: {
          id: r.id,
          orgId,
          contactId: r.contact_id,
          portfolioId: r.portfolio_id,
          kind: r.kind,
          stage: r.stage,
          amount: r.amount === null ? null : Number(r.amount),
          currency: r.currency,
          dueAt: r.due_at,
          attributes: r.attributes,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        },
      });
    }
    return out;
  };
}
