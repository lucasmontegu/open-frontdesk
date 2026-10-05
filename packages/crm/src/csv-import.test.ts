import { describe, expect, it } from "vitest";
import { importContactsCsv, parseAmount, parseDate, type ImportMapping } from "./csv-import.js";
import { FakeContactRepository, FakeObligationRepository } from "./fakes.test-helpers.js";

const mapping: ImportMapping = {
  displayName: "nombre",
  phone: "telefono",
  email: "email",
  dni: "dni",
  tags: "etiquetas",
  tagSeparator: ";",
  attributes: { empresa: "empresa" },
  obligation: { amount: "monto", dueDate: "vencimiento", stage: "etapa", currency: "moneda" },
};

const setup = () => {
  const contacts = new FakeContactRepository();
  const obligations = new FakeObligationRepository();
  return { contacts, obligations, deps: { orgId: "org1", contacts, obligations } };
};

describe("importContactsCsv", () => {
  it("creates contacts with normalized phones, tags, attributes and obligations", async () => {
    const { deps, contacts, obligations } = setup();
    const csv = [
      "nombre,telefono,email,dni,etiquetas,empresa,monto,vencimiento,etapa,moneda",
      'Ana Pérez,011 15 1234-5678,ANA@x.com,30.111.222,vip;mora,ACME,"1.234,50",31/03/2026,mora_temprana,ars',
    ].join("\n");
    const r = await importContactsCsv(csv, mapping, deps);
    expect(r).toEqual({ created: 1, updated: 0, skipped: 0, errors: [] });
    const c = [...contacts.rows.values()][0]!;
    expect(c.identities).toContainEqual({ kind: "phone", value: "+5491112345678" });
    expect(c.identities).toContainEqual({ kind: "email", value: "ana@x.com" });
    expect(c.identities).toContainEqual({ kind: "dni", value: "30111222" });
    expect(c.tags).toEqual(["vip", "mora"]);
    expect(c.attributes).toEqual({ empresa: "ACME" });
    const o = [...obligations.rows.values()][0]!;
    expect(o).toMatchObject({ kind: "debt", amount: 1234.5, currency: "ARS", stage: "mora_temprana", contactId: c.id });
    expect(o.dueAt?.toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });

  it("dedupes by phone, updates, and does not duplicate obligations on re-import", async () => {
    const { deps, contacts, obligations } = setup();
    const csv = "nombre,telefono,monto\nAna,1112345678,100\nAna Pérez,+54 9 11 1234 5678,100\n";
    const r = await importContactsCsv(csv, mapping, deps);
    expect(r.created).toBe(1);
    expect(r.updated).toBe(1);
    expect(contacts.rows.size).toBe(1);
    expect(obligations.rows.size).toBe(1);
    expect([...contacts.rows.values()][0]!.displayName).toBe("Ana Pérez");
  });

  it("reports row errors and skips empty rows", async () => {
    const { deps } = setup();
    const csv = "nombre,telefono,monto\nBad,123,\n,,\nOk,1112345678,abc\nGood,1187654321,5\n";
    const r = await importContactsCsv(csv, mapping, deps);
    expect(r.skipped).toBe(1);
    expect(r.created).toBe(2); // "Ok" is created before its obligation fails
    expect(r.errors.map((e) => e.row)).toEqual([2, 4]);
    expect(r.errors[0]?.message).toContain("Invalid phone");
  });
});

describe("parsers", () => {
  it("parses amounts", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("$ 1234.56")).toBe(1234.56);
    expect(parseAmount("1.234")).toBe(1234);
    expect(parseAmount("x")).toBeNull();
  });
  it("parses dates", () => {
    expect(parseDate("2026-01-05")?.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    expect(parseDate("5/1/2026")?.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    expect(parseDate("nope")).toBeNull();
  });
});
