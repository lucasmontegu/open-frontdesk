import { parse } from "csv-parse/sync";
import type { ContactIdentity, ContactRepository, ObligationKind, ObligationRepository } from "@ofd/core";
import { normalizeArgentinePhone } from "./phone.js";

/** Maps canonical fields to CSV header names. */
export interface ImportMapping {
  displayName: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  dni?: string;
  cuit?: string;
  /** Column with tags separated by `tagSeparator` (default ","). */
  tags?: string;
  tagSeparator?: string;
  /** attribute name -> CSV header */
  attributes?: Record<string, string>;
  obligation?: {
    kind?: string;
    amount?: string;
    currency?: string;
    dueDate?: string;
    stage?: string;
    defaultKind?: ObligationKind;
    defaultStage?: string;
    defaultCurrency?: string;
  };
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export interface ImportDeps {
  orgId: string;
  contacts: ContactRepository;
  obligations: ObligationRepository;
}

const KIND_ALIASES: Record<string, ObligationKind> = {
  debt: "debt",
  deuda: "debt",
  opportunity: "opportunity",
  oportunidad: "opportunity",
  lead: "opportunity",
  appointment: "appointment",
  turno: "appointment",
  cita: "appointment",
};

/** Accepts "1234.56", "1.234,56", "$ 1.234,56" and "1.234". */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Accepts ISO (2026-03-31) and Argentine (31/03/2026) dates. */
export function parseDate(raw: string): Date | null {
  const s = raw.trim();
  const ar = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  const d = ar ? new Date(Date.UTC(Number(ar[3]), Number(ar[2]) - 1, Number(ar[1]))) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function importContactsCsv(csvText: string, mapping: ImportMapping, deps: ImportDeps): Promise<ImportResult> {
  const { orgId } = deps;
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  let records: Record<string, string>[];
  try {
    records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
  } catch (err) {
    result.errors.push({ row: 0, message: `Invalid CSV: ${(err as Error).message}` });
    return result;
  }

  for (const [i, record] of records.entries()) {
    const row = i + 2; // header is row 1
    const cell = (col?: string) => (col ? (record[col] ?? "").trim() : "");
    try {
      const identities = buildIdentities(cell, mapping);
      const displayName = cell(mapping.displayName);
      if (!displayName && identities.length === 0) {
        result.skipped++;
        continue;
      }
      if (!displayName) throw new Error("Missing display name");
      if (identities.length === 0) throw new Error("No valid phone, email or document to identify the contact");

      const tags = cell(mapping.tags)
        .split(mapping.tagSeparator ?? ",")
        .map((t) => t.trim())
        .filter(Boolean);
      const attributes: Record<string, unknown> = {};
      for (const [name, col] of Object.entries(mapping.attributes ?? {})) {
        const v = cell(col);
        if (v) attributes[name] = v;
      }

      let existing = null;
      for (const identity of identities) {
        existing = await deps.contacts.findByIdentity(orgId, identity);
        if (existing) break;
      }

      let contactId: string;
      if (existing) {
        const updated = await deps.contacts.update(orgId, existing.id, {
          displayName,
          tags: [...new Set([...existing.tags, ...tags])],
          attributes: { ...existing.attributes, ...attributes },
        });
        contactId = updated.id;
        result.updated++;
      } else {
        const created = await deps.contacts.create(orgId, { displayName, identities, attributes, tags });
        contactId = created.id;
        result.created++;
      }

      const obligation = buildObligation(cell, mapping);
      if (obligation) {
        const current = await deps.obligations.listByContact(orgId, contactId);
        const match = current.find((o) => o.kind === obligation.kind && o.amount === obligation.amount && o.dueAt?.getTime() === obligation.dueAt?.getTime());
        await deps.obligations.upsert(orgId, { ...obligation, contactId, portfolioId: match?.portfolioId ?? null, attributes: match?.attributes ?? {}, ...(match ? { id: match.id } : {}) });
      }
    } catch (err) {
      result.errors.push({ row, message: (err as Error).message });
    }
  }
  return result;
}

function buildIdentities(cell: (col?: string) => string, m: ImportMapping): ContactIdentity[] {
  const out: ContactIdentity[] = [];
  const phone = cell(m.phone);
  if (phone) {
    const n = normalizeArgentinePhone(phone);
    if (!n) throw new Error(`Invalid phone: ${phone}`);
    out.push({ kind: "phone", value: n });
  }
  const wa = cell(m.whatsapp);
  if (wa) {
    const n = normalizeArgentinePhone(wa);
    if (!n) throw new Error(`Invalid WhatsApp number: ${wa}`);
    out.push({ kind: "whatsapp", value: n });
  }
  const email = cell(m.email).toLowerCase();
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Invalid email: ${email}`);
    out.push({ kind: "email", value: email });
  }
  const dni = cell(m.dni).replace(/\D/g, "");
  if (dni) out.push({ kind: "dni", value: dni });
  const cuit = cell(m.cuit).replace(/\D/g, "");
  if (cuit) out.push({ kind: "cuit", value: cuit });
  return out;
}

function buildObligation(cell: (col?: string) => string, m: ImportMapping) {
  const o = m.obligation;
  if (!o) return null;
  const amountRaw = cell(o.amount);
  const kindRaw = cell(o.kind);
  const stageRaw = cell(o.stage);
  const dueRaw = cell(o.dueDate);
  if (!amountRaw && !kindRaw && !stageRaw && !dueRaw) return null;

  const kind = kindRaw ? KIND_ALIASES[kindRaw.toLowerCase()] : (o.defaultKind ?? "debt");
  if (!kind) throw new Error(`Unknown obligation kind: ${kindRaw}`);
  const amount = amountRaw ? parseAmount(amountRaw) : null;
  if (amountRaw && amount === null) throw new Error(`Invalid amount: ${amountRaw}`);
  const dueAt = dueRaw ? parseDate(dueRaw) : null;
  if (dueRaw && !dueAt) throw new Error(`Invalid due date: ${dueRaw}`);
  return {
    kind,
    amount,
    currency: cell(o.currency).toUpperCase() || (amount !== null ? (o.defaultCurrency ?? "ARS") : null),
    dueAt,
    stage: stageRaw || o.defaultStage || "new",
  };
}
