import { fileURLToPath } from "node:url";
import type { ObligationKind } from "@ofd/core";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "./client.js";
import { createRepositories } from "./repositories.js";
import { contacts, conversations, knowledgeDocs, missions, portfolios } from "./schema/index.js";

export const DEMO_ORG_ID = "org_demo";

const DAY = 86_400_000;

const people: Array<{
  name: string;
  phone: string;
  tags: string[];
  debt?: { days: number; amount: number };
  appointmentTomorrowHour?: number;
}> = [
  {
    name: "Lucía Fernández",
    phone: "+5491145670001",
    tags: ["paciente"],
    appointmentTomorrowHour: 9,
  },
  {
    name: "Martín Gómez",
    phone: "+5491145670002",
    tags: ["paciente"],
    appointmentTomorrowHour: 10,
  },
  {
    name: "Camila Rodríguez",
    phone: "+5491145670003",
    tags: ["paciente"],
    appointmentTomorrowHour: 11,
  },
  {
    name: "Joaquín Sosa",
    phone: "+5491145670004",
    tags: ["paciente"],
    appointmentTomorrowHour: 15,
  },
  {
    name: "Valentina Pérez",
    phone: "+5491145670005",
    tags: ["deudor"],
    debt: { days: 30, amount: 85000 },
  },
  {
    name: "Nicolás Acosta",
    phone: "+5491145670006",
    tags: ["deudor"],
    debt: { days: 45, amount: 120000 },
  },
  {
    name: "Florencia Díaz",
    phone: "+5491145670007",
    tags: ["deudor"],
    debt: { days: 60, amount: 210500 },
  },
  {
    name: "Tomás Benítez",
    phone: "+5491145670008",
    tags: ["deudor", "moroso"],
    debt: { days: 90, amount: 450000 },
  },
  {
    name: "Agustina Romero",
    phone: "+5491145670009",
    tags: ["deudor"],
    debt: { days: 90, amount: 38000 },
  },
  {
    name: "Facundo Ibarra",
    phone: "+5491145670010",
    tags: ["deudor"],
    debt: { days: 15, amount: 62000 },
  },
];

const docs = [
  {
    title: "Política de turnos y reprogramaciones",
    content:
      "Los turnos se pueden reprogramar sin cargo hasta 24 horas antes de la consulta. Si el paciente no avisa, el turno se considera ausente. Para reprogramar, ofrecé los próximos horarios disponibles y confirmá por WhatsApp.",
  },
  {
    title: "Planes de pago para deudas atrasadas",
    content:
      "Podés ofrecer hasta 6 cuotas sin interés para deudas de hasta 60 días de atraso, y hasta 12 cuotas con un interés del 3% mensual para deudas de más de 90 días. El pago se realiza por transferencia o Mercado Pago.",
  },
  {
    title: "Horarios y ubicación de la clínica",
    content:
      "La clínica atiende de lunes a viernes de 8 a 19 horas y los sábados de 9 a 13 horas, en Av. Santa Fe 1234, Ciudad de Buenos Aires. Hay cobertura de las principales obras sociales y prepagas.",
  },
];

/** Deletes and recreates the demo org's data, so running it twice yields the same result. */
export async function seedDemo(
  db: Db,
  orgId = DEMO_ORG_ID,
): Promise<{ contacts: number; obligations: number; docs: number }> {
  await db.transaction(async (tx) => {
    for (const table of [knowledgeDocs, missions, conversations, portfolios, contacts]) {
      await tx.delete(table).where(eq(table.orgId, orgId));
    }
  });

  const repos = createRepositories(db);
  const clinic = await repos.portfolios.create(orgId, {
    name: "Clínica: turnos de mañana",
    owner: "Clínica Demo",
    rule: { stages: ["scheduled"] },
  });
  const collections = await repos.portfolios.create(orgId, {
    name: "Cobranzas: mora desde 30 días",
    owner: "Acreedor Demo S.A.",
    rule: { minDaysOverdue: 30, stages: ["overdue"] },
  });

  const now = Date.now();
  const tomorrow = new Date(now + DAY);
  let obligationCount = 0;
  for (const p of people) {
    const contact = await repos.contacts.create(orgId, {
      displayName: p.name,
      identities: [
        { kind: "phone", value: p.phone },
        { kind: "whatsapp", value: p.phone },
      ],
      tags: p.tags,
      attributes: { ciudad: "Buenos Aires" },
    });
    const make = async (
      kind: ObligationKind,
      portfolioId: string,
      stage: string,
      dueAt: Date,
      amount: number | null,
    ) => {
      await repos.obligations.upsert(orgId, {
        contactId: contact.id,
        portfolioId,
        kind,
        stage,
        amount,
        currency: amount === null ? null : "ARS",
        dueAt,
        attributes: {},
      });
      obligationCount++;
    };
    if (p.debt)
      await make(
        "debt",
        collections.id,
        "overdue",
        new Date(now - p.debt.days * DAY),
        p.debt.amount,
      );
    if (p.appointmentTomorrowHour !== undefined) {
      const at = new Date(tomorrow);
      at.setUTCHours(p.appointmentTomorrowHour + 3, 0, 0, 0); // ART is UTC-3
      await make("appointment", clinic.id, "scheduled", at, null);
    }
  }

  for (const d of docs) await repos.knowledge.ingest(orgId, d);
  return { contacts: people.length, obligations: obligationCount, docs: docs.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const { db, close } = createDb(url, { max: 2 });
  seedDemo(db)
    .then((r) => console.log(`seeded ${DEMO_ORG_ID}:`, r))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(close);
}
