import { type ContactIdentity, IdentityKind, notFound } from "@ofd/core";
import { type ImportMapping, importContactsCsv } from "@ofd/crm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Container } from "../http/env.js";
import { requirePermission } from "../http/middleware.js";
import { validate } from "../http/validate.js";

const listQuery = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

const identity = z.object({ kind: IdentityKind, value: z.string().min(1), source: z.string().optional() });
const createBody = z.object({
  displayName: z.string().min(1),
  identities: z.array(identity).default([]),
  attributes: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  doNotCall: z.boolean().optional(),
});
const patchBody = z.object({
  displayName: z.string().min(1).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  doNotCall: z.boolean().optional(),
});
const importBody = z.object({ csv: z.string().min(1) });

/** Accepts the headers a Spanish-speaking operator would export from a spreadsheet. */
export const DEFAULT_IMPORT_ALIASES = {
  displayName: ["displayName", "nombre", "nombre completo", "name", "cliente", "apellido y nombre"],
  phone: ["phone", "telefono", "teléfono", "tel", "celular"],
  whatsapp: ["whatsapp", "wsp"],
  email: ["email", "mail", "correo", "e-mail"],
  dni: ["dni", "documento"],
  cuit: ["cuit", "cuil"],
  tags: ["tags", "etiquetas"],
  amount: ["monto", "importe", "amount", "deuda", "saldo"],
  currency: ["moneda", "currency"],
  dueDate: ["vencimiento", "fecha de vencimiento", "dueDate", "fecha"],
  stage: ["etapa", "stage", "estado"],
  kind: ["tipo", "kind"],
} as const;

const norm = (s: string) => s.trim().toLowerCase();

/** Builds an ImportMapping from the CSV header line using the alias table. */
export function mappingFromHeaders(csv: string): ImportMapping {
  const firstLine = (csv.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "").trim();
  const delimiter = firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
  const headers = firstLine.split(delimiter).map((h) => h.trim().replace(/^"|"$/g, ""));
  const find = (aliases: readonly string[]) => headers.find((h) => aliases.some((a) => norm(a) === norm(h)));
  const col = (key: keyof typeof DEFAULT_IMPORT_ALIASES) => find(DEFAULT_IMPORT_ALIASES[key]);
  const mapping: ImportMapping = { displayName: col("displayName") ?? "" };
  for (const key of ["phone", "whatsapp", "email", "dni", "cuit", "tags"] as const) {
    const h = col(key);
    if (h) mapping[key] = h;
  }
  const obligation = {
    kind: col("kind"),
    amount: col("amount"),
    currency: col("currency"),
    dueDate: col("dueDate"),
    stage: col("stage"),
  };
  if (Object.values(obligation).some(Boolean)) mapping.obligation = obligation;
  return mapping;
}

export function contactRoutes(container: Container) {
  const { contacts, obligations, profiles } = container.repos;
  return new Hono<AppEnv>()
    .get("/", requirePermission("contacts", "read"), validate("query", listQuery), async (c) => {
      const q = c.req.valid("query");
      const page = await contacts.list(c.get("actor").orgId, { search: q.q, limit: q.limit, cursor: q.cursor });
      return c.json(page);
    })
    .post("/", requirePermission("contacts", "create"), validate("json", createBody), async (c) => {
      const input = c.req.valid("json");
      const contact = await contacts.create(c.get("actor").orgId, { ...input, identities: input.identities as ContactIdentity[] });
      return c.json(contact, 201);
    })
    .post("/import", requirePermission("contacts", "create"), validate("json", importBody), async (c) => {
      const { csv } = c.req.valid("json");
      const result = await importContactsCsv(csv, mappingFromHeaders(csv), { orgId: c.get("actor").orgId, contacts, obligations });
      return c.json(result);
    })
    .get("/:id", requirePermission("contacts", "read"), async (c) => {
      const profile = await profiles.load(c.get("actor").orgId, c.req.param("id"));
      if (!profile) throw notFound("contact");
      return c.json(profile);
    })
    .patch("/:id", requirePermission("contacts", "update"), validate("json", patchBody), async (c) => {
      const orgId = c.get("actor").orgId;
      if (!(await contacts.get(orgId, c.req.param("id")))) throw notFound("contact");
      const contact = await contacts.update(orgId, c.req.param("id"), c.req.valid("json"));
      return c.json(contact);
    });
}
