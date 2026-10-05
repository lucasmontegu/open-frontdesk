import type {
  Clock,
  ContactIdentity,
  ContactRepository,
  EventStore,
  HoldStore,
  JobQueue,
  KnowledgeSearch,
  MessagingProvider,
  Obligation,
  ObligationRepository,
  ToolCallContext,
  ToolDefinition,
  ToolEffect,
} from "@ofd/core";
import { z } from "zod";
import { type CalendarProvider, offerSlots, slotHoldKey } from "./calendar.js";
import {
  DEFAULT_PAYMENT_POLICY,
  type MissionContactJob,
  type PaymentLinkProvider,
  type PaymentPolicy,
} from "./types.js";

export interface BuiltinToolDeps {
  contacts: ContactRepository;
  obligations: ObligationRepository;
  knowledge: KnowledgeSearch;
  calendar: CalendarProvider;
  holds: HoldStore;
  messaging: MessagingProvider;
  jobs: JobQueue;
  events?: EventStore;
  paymentLinks?: PaymentLinkProvider;
  paymentPolicy?: PaymentPolicy;
  clock?: Clock;
  /** How long an offered slot stays held. Default 15 minutes. */
  slotHoldSeconds?: number;
}

function defineTool<S extends z.ZodType>(def: {
  name: string;
  description: string;
  effect: ToolEffect;
  inputSchema: S;
  timeoutMs?: number;
  handler(input: z.infer<S>, ctx: ToolCallContext): Promise<unknown>;
}): ToolDefinition {
  return { timeoutMs: 15_000, ...def } as unknown as ToolDefinition;
}

const money = (n: number) => Math.round(n * 100) / 100;

function requireContact(ctx: ToolCallContext): string {
  if (!ctx.contactId) throw new Error("No hay un cliente identificado en esta conversación");
  return ctx.contactId;
}

function requireConversation(ctx: ToolCallContext): string {
  if (!ctx.conversationId) throw new Error("No hay una conversación activa");
  return ctx.conversationId;
}

/** Appointment changes require the customer's last 4 DNI digits, checked against contact attributes.dniLast4. */
async function verifyDniLast4(
  deps: BuiltinToolDeps,
  ctx: ToolCallContext,
  given: string,
): Promise<void> {
  const contact = await deps.contacts.get(ctx.orgId, requireContact(ctx));
  const expected = contact?.attributes["dniLast4"];
  if (typeof expected !== "string" && typeof expected !== "number")
    throw new Error("No hay un DNI registrado para verificar la identidad");
  if (String(expected) !== given) throw new Error("Los últimos 4 dígitos del DNI no coinciden");
}

function messagingAddress(identities: ContactIdentity[]): string | null {
  return (
    identities.find((i) => i.kind === "whatsapp")?.value ??
    identities.find((i) => i.kind === "phone")?.value ??
    null
  );
}

async function ownObligation(
  deps: BuiltinToolDeps,
  ctx: ToolCallContext,
  id: string,
): Promise<Obligation> {
  const list = await deps.obligations.listByContact(ctx.orgId, requireContact(ctx));
  const found = list.find((o) => o.id === id);
  if (!found) throw new Error("No se encontró esa obligación para este cliente");
  return found;
}

type ObligationPatch = Parameters<ObligationRepository["upsert"]>[1];
const toUpsert = (o: Obligation, patch: Partial<ObligationPatch>): ObligationPatch => ({
  id: o.id,
  contactId: o.contactId,
  portfolioId: o.portfolioId,
  kind: o.kind,
  stage: o.stage,
  amount: o.amount,
  currency: o.currency,
  dueAt: o.dueAt,
  attributes: o.attributes,
  ...patch,
});

export function createBuiltinTools(deps: BuiltinToolDeps): ToolDefinition[] {
  const policy = deps.paymentPolicy ?? DEFAULT_PAYMENT_POLICY;
  const now = () => (deps.clock ? deps.clock.now() : new Date());
  const holdTtl = deps.slotHoldSeconds ?? 15 * 60;
  const holderOf = (ctx: ToolCallContext) => ctx.contactId ?? ctx.conversationId ?? "anonymous";
  const slotView = (s: { id: string; start: Date; end: Date }) => ({
    slotId: s.id,
    start: s.start.toISOString(),
    end: s.end.toISOString(),
  });

  const lookup_contact = defineTool({
    name: "lookup_contact",
    description:
      "Busca a una persona por teléfono, email o DNI cuando no está identificada (por ejemplo, un familiar que llama por otra persona).",
    effect: "read",
    inputSchema: z.object({
      kind: z
        .enum(["phone", "whatsapp", "email", "dni"])
        .describe("Tipo de dato con el que buscar"),
      value: z.string().min(1).describe("Valor a buscar"),
    }),
    async handler({ kind, value }, ctx) {
      const c = await deps.contacts.findByIdentity(ctx.orgId, { kind, value });
      return c ? { found: true, contactId: c.id, displayName: c.displayName } : { found: false };
    },
  });

  const search_knowledge = defineTool({
    name: "search_knowledge",
    description:
      "Busca en la base de conocimiento de la empresa (preguntas frecuentes, precios, políticas, horarios). Usala antes de responder datos del negocio.",
    effect: "read",
    inputSchema: z.object({
      query: z.string().min(2).describe("Consulta en lenguaje natural"),
      limit: z.number().int().min(1).max(5).optional(),
    }),
    async handler({ query, limit }, ctx) {
      const results = await deps.knowledge.search(ctx.orgId, query, { limit: limit ?? 3 });
      return { results: results.map((r) => ({ title: r.title, content: r.content })) };
    },
  });

  const find_available_slots = defineTool({
    name: "find_available_slots",
    description:
      "Busca horarios libres para ofrecerle al cliente. Cada horario queda reservado unos minutos para que no se lo ofrezcan a otra persona.",
    effect: "read",
    inputSchema: z.object({
      from: z.string().describe("Desde (fecha ISO, ej. 2026-10-06T09:00:00-03:00)"),
      to: z.string().describe("Hasta (fecha ISO)"),
      count: z.number().int().min(1).max(5).default(3),
    }),
    async handler({ from, to, count }, ctx) {
      const slots = await offerSlots(
        deps.calendar,
        deps.holds,
        ctx.orgId,
        holderOf(ctx),
        { from: new Date(from), to: new Date(to) },
        count,
        holdTtl,
      );
      return { slots: slots.map(slotView), holdMinutes: Math.round(holdTtl / 60) };
    },
  });

  const book_appointment = defineTool({
    name: "book_appointment",
    description:
      "Reserva un turno en un horario que ofreciste con find_available_slots. Confirmá el horario con el cliente antes.",
    effect: "write",
    inputSchema: z.object({ slotId: z.string().min(1), note: z.string().optional() }),
    async handler({ slotId, note }, ctx) {
      const contactId = requireContact(ctx);
      try {
        const b = await deps.calendar.book(ctx.orgId, {
          contactId,
          slotId,
          ...(note ? { note } : {}),
        });
        return {
          booked: true,
          bookingId: b.id,
          start: b.start.toISOString(),
          end: b.end.toISOString(),
        };
      } finally {
        await deps.holds.release(slotHoldKey(ctx.orgId, slotId), holderOf(ctx));
      }
    },
  });

  const reschedule_appointment = defineTool({
    name: "reschedule_appointment",
    description: "Mueve un turno existente a otro horario que ofreciste con find_available_slots.",
    effect: "write",
    inputSchema: z.object({
      bookingId: z.string().min(1),
      newSlotId: z.string().min(1),
      dniLast4: z
        .string()
        .regex(/^\d{4}$/)
        .describe("Últimos 4 dígitos del DNI, para verificar identidad"),
    }),
    async handler({ bookingId, newSlotId, dniLast4 }, ctx) {
      await verifyDniLast4(deps, ctx, dniLast4);
      const current = await deps.calendar.getBooking(ctx.orgId, bookingId);
      if (!current || current.contactId !== ctx.contactId)
        throw new Error("No se encontró ese turno para este cliente");
      try {
        const b = await deps.calendar.reschedule(ctx.orgId, bookingId, newSlotId);
        return {
          rescheduled: true,
          bookingId: b.id,
          start: b.start.toISOString(),
          end: b.end.toISOString(),
        };
      } finally {
        await deps.holds.release(slotHoldKey(ctx.orgId, newSlotId), holderOf(ctx));
      }
    },
  });

  const cancel_appointment = defineTool({
    name: "cancel_appointment",
    description: "Cancela un turno del cliente. Confirmá con el cliente antes de cancelar.",
    effect: "write",
    inputSchema: z.object({
      bookingId: z.string().min(1),
      dniLast4: z
        .string()
        .regex(/^\d{4}$/)
        .describe("Últimos 4 dígitos del DNI, para verificar identidad"),
    }),
    async handler({ bookingId, dniLast4 }, ctx) {
      await verifyDniLast4(deps, ctx, dniLast4);
      const current = await deps.calendar.getBooking(ctx.orgId, bookingId);
      if (!current || current.contactId !== ctx.contactId)
        throw new Error("No se encontró ese turno para este cliente");
      const b = await deps.calendar.cancel(ctx.orgId, bookingId);
      return { cancelled: true, bookingId: b.id };
    },
  });

  const get_payment_options = defineTool({
    name: "get_payment_options",
    description:
      "Devuelve las formas de pago que la empresa permite para una deuda: pago total, descuento máximo por pago contado y cuotas. No ofrezcas nada fuera de esta lista.",
    effect: "read",
    inputSchema: z.object({ obligationId: z.string().min(1) }),
    async handler({ obligationId }, ctx) {
      const o = await ownObligation(deps, ctx, obligationId);
      if (o.amount == null) throw new Error("La obligación no tiene monto");
      const currency = o.currency ?? "ARS";
      const options: Array<Record<string, unknown>> = [
        { type: "full", total: money(o.amount), currency, discountPercent: 0 },
      ];
      if (policy.maxDiscountPercent > 0) {
        options.push({
          type: "full_with_discount",
          total: money(o.amount * (1 - policy.maxDiscountPercent / 100)),
          currency,
          discountPercent: policy.maxDiscountPercent,
        });
      }
      for (let n = 2; n <= policy.maxInstallments; n++) {
        options.push({
          type: "installments",
          installments: n,
          installmentAmount: money(o.amount / n),
          total: money(o.amount),
          currency,
          discountPercent: 0,
        });
      }
      return {
        obligationId,
        options,
        maxDiscountPercent: policy.maxDiscountPercent,
        maxInstallments: policy.maxInstallments,
      };
    },
  });

  const register_promise_to_pay = defineTool({
    name: "register_promise_to_pay",
    description:
      "Registra la promesa de pago del cliente: qué monto se compromete a pagar y en qué fecha.",
    effect: "write",
    inputSchema: z.object({
      obligationId: z.string().min(1),
      amount: z.number().positive(),
      promisedDate: z.string().describe("Fecha prometida, ISO (YYYY-MM-DD)"),
    }),
    async handler({ obligationId, amount, promisedDate }, ctx) {
      const o = await ownObligation(deps, ctx, obligationId);
      const date = new Date(promisedDate);
      if (Number.isNaN(date.getTime())) throw new Error("Fecha inválida");
      const days = (date.getTime() - now().getTime()) / 86_400_000;
      if (days < -1) throw new Error("La fecha prometida ya pasó");
      if (days > policy.maxPromiseDays)
        throw new Error(
          `La fecha prometida supera el máximo permitido de ${policy.maxPromiseDays} días`,
        );
      if (o.amount != null && amount > o.amount)
        throw new Error("El monto prometido supera la deuda");
      await deps.obligations.upsert(
        ctx.orgId,
        toUpsert(o, {
          stage: "promised",
          attributes: {
            ...o.attributes,
            promise: { amount, date: date.toISOString(), registeredAt: now().toISOString() },
          },
        }),
      );
      return {
        registered: true,
        obligationId,
        amount,
        promisedDate: date.toISOString().slice(0, 10),
      };
    },
  });

  const send_payment_link = defineTool({
    name: "send_payment_link",
    description:
      "Genera un link de pago y se lo envía al cliente por WhatsApp. El monto no puede superar la deuda ni bajar del descuento máximo permitido.",
    effect: "contact",
    inputSchema: z.object({
      obligationId: z.string().min(1),
      amount: z.number().positive().optional(),
    }),
    async handler({ obligationId, amount }, ctx) {
      if (!deps.paymentLinks) throw new Error("Los links de pago no están configurados");
      const contactId = requireContact(ctx);
      const o = await ownObligation(deps, ctx, obligationId);
      if (o.amount == null) throw new Error("La obligación no tiene monto");
      const minAllowed = o.amount * (1 - policy.maxDiscountPercent / 100);
      const toPay = amount ?? o.amount;
      if (toPay > o.amount + 0.005) throw new Error("El monto supera la deuda");
      if (
        toPay < minAllowed - 0.005 &&
        !(policy.maxInstallments > 1 && toPay >= o.amount / policy.maxInstallments - 0.005)
      ) {
        throw new Error("El monto está por debajo de lo permitido");
      }
      const contact = await deps.contacts.get(ctx.orgId, contactId);
      const to = contact && messagingAddress(contact.identities);
      if (!to) throw new Error("El cliente no tiene WhatsApp ni teléfono");
      const link = await deps.paymentLinks.create({
        orgId: ctx.orgId,
        contactId,
        obligationId,
        amount: toPay,
        currency: o.currency ?? "ARS",
      });
      await deps.messaging.send({
        orgId: ctx.orgId,
        to,
        text: `Te dejo el link para pagar: ${link.url}`,
        conversationId: requireConversation(ctx),
      });
      return { sent: true, amount: money(toPay) };
    },
  });

  const send_whatsapp = defineTool({
    name: "send_whatsapp",
    description:
      "Envía un mensaje de WhatsApp al cliente de esta conversación (por ejemplo, un resumen o una confirmación).",
    effect: "contact",
    inputSchema: z.object({ text: z.string().min(1).max(1000) }),
    async handler({ text }, ctx) {
      const contactId = requireContact(ctx);
      const contact = await deps.contacts.get(ctx.orgId, contactId);
      const to = contact && messagingAddress(contact.identities);
      if (!to) throw new Error("El cliente no tiene WhatsApp ni teléfono");
      const r = await deps.messaging.send({
        orgId: ctx.orgId,
        to,
        text,
        conversationId: requireConversation(ctx),
      });
      return { sent: true, messageId: r.providerMessageId };
    },
  });

  const schedule_callback = defineTool({
    name: "schedule_callback",
    description: "Agenda que volvamos a contactar al cliente más tarde, por el canal que prefiera.",
    effect: "write",
    inputSchema: z.object({
      inMinutes: z
        .number()
        .int()
        .min(5)
        .max(60 * 24 * 14)
        .describe("Dentro de cuántos minutos volver a contactarlo"),
      channel: z.enum(["whatsapp", "voice"]).default("whatsapp"),
      reason: z.string().min(1).describe("Motivo del llamado, para retomar la conversación"),
    }),
    async handler({ inMinutes, channel, reason }, ctx) {
      const contactId = requireContact(ctx);
      const job: MissionContactJob = {
        orgId: ctx.orgId,
        missionId: null,
        botId: ctx.actor.kind === "bot" ? ctx.botVersionId : null,
        contactId,
        channel,
        offer: {},
        reason,
      };
      await deps.jobs.enqueue("mission.contact", job, { startAfterSeconds: inMinutes * 60 });
      return { scheduled: true, inMinutes, channel };
    },
  });

  const transfer_to_human = defineTool({
    name: "transfer_to_human",
    description:
      "Pasa la conversación a una persona del equipo. Usala si el cliente lo pide, está muy molesto o la consulta excede lo que podés resolver.",
    effect: "transfer",
    inputSchema: z.object({
      reason: z.string().min(1).describe("Por qué se transfiere, para el operador"),
    }),
    async handler({ reason }, ctx) {
      await deps.events?.append({
        orgId: ctx.orgId,
        type: "transfer.requested",
        payload: { reason },
        conversationId: ctx.conversationId,
        botVersionId: ctx.botVersionId,
        contactId: ctx.contactId,
        actorKind: "bot",
        actorId: ctx.actor.id,
        traceId: ctx.traceId,
      });
      return {
        transferring: true,
        message: "Avisale al cliente que una persona del equipo lo va a atender en breve.",
      };
    },
  });

  const opportunityFor = async (
    ctx: ToolCallContext,
    create: boolean,
  ): Promise<Obligation | null> => {
    const contactId = requireContact(ctx);
    const existing = (await deps.obligations.listByContact(ctx.orgId, contactId)).find(
      (o) => o.kind === "opportunity",
    );
    if (existing || !create) return existing ?? null;
    return deps.obligations.upsert(ctx.orgId, {
      contactId,
      portfolioId: null,
      kind: "opportunity",
      stage: "new",
      amount: null,
      currency: null,
      dueAt: null,
      attributes: {},
    });
  };

  const qualify_lead = defineTool({
    name: "qualify_lead",
    description:
      "Guarda la calificación del interesado: necesidad, presupuesto, plazo y si decide la compra.",
    effect: "write",
    inputSchema: z.object({
      need: z.string().min(1),
      budget: z.string().optional(),
      timeline: z.string().optional(),
      isDecisionMaker: z.boolean().optional(),
      score: z.number().int().min(1).max(5).describe("1 = frío, 5 = listo para comprar"),
    }),
    async handler(q, ctx) {
      const o = (await opportunityFor(ctx, true))!;
      const stage = q.score >= 3 ? "qualified" : "unqualified";
      await deps.obligations.upsert(
        ctx.orgId,
        toUpsert(o, {
          stage,
          attributes: { ...o.attributes, qualification: { ...q, at: now().toISOString() } },
        }),
      );
      return { qualified: q.score >= 3, stage };
    },
  });

  const book_demo = defineTool({
    name: "book_demo",
    description:
      "Agenda una demo con el equipo comercial en un horario ofrecido con find_available_slots.",
    effect: "write",
    inputSchema: z.object({ slotId: z.string().min(1), note: z.string().optional() }),
    async handler({ slotId, note }, ctx) {
      const contactId = requireContact(ctx);
      try {
        const b = await deps.calendar.book(ctx.orgId, {
          contactId,
          slotId,
          kind: "demo",
          ...(note ? { note } : {}),
        });
        const o = await opportunityFor(ctx, true);
        if (o) await deps.obligations.upsert(ctx.orgId, toUpsert(o, { stage: "demo_booked" }));
        return { booked: true, bookingId: b.id, start: b.start.toISOString() };
      } finally {
        await deps.holds.release(slotHoldKey(ctx.orgId, slotId), holderOf(ctx));
      }
    },
  });

  const update_lead_stage = defineTool({
    name: "update_lead_stage",
    description: "Actualiza la etapa del interesado en el embudo comercial.",
    effect: "write",
    inputSchema: z.object({
      stage: z.enum([
        "new",
        "contacted",
        "qualified",
        "unqualified",
        "demo_booked",
        "proposal",
        "won",
        "lost",
      ]),
      note: z.string().optional(),
    }),
    async handler({ stage, note }, ctx) {
      const o = (await opportunityFor(ctx, true))!;
      await deps.obligations.upsert(
        ctx.orgId,
        toUpsert(o, {
          stage,
          attributes: note ? { ...o.attributes, lastNote: note } : o.attributes,
        }),
      );
      return { updated: true, stage };
    },
  });

  return [
    lookup_contact,
    search_knowledge,
    find_available_slots,
    book_appointment,
    reschedule_appointment,
    cancel_appointment,
    get_payment_options,
    register_promise_to_pay,
    send_payment_link,
    send_whatsapp,
    schedule_callback,
    transfer_to_human,
    qualify_lead,
    book_demo,
    update_lead_stage,
  ];
}
