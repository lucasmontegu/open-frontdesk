/** Sample tool inputs for the builtin tool catalog, so level 1 can call every tool through the real gateway. */

export type Identity = "match" | "mismatch";

const DAY = 86_400_000;

/** Returns a schema-valid input for a builtin tool, or null for a tool that is not in the catalog. */
export function sampleInput(
  tool: string,
  opts: { identity: Identity; expectedDni: unknown; now: Date },
): Record<string, unknown> | null {
  const expected = opts.expectedDni == null ? null : String(opts.expectedDni);
  const wrong = expected === "9999" ? "0000" : "9999";
  const dniLast4 =
    opts.identity === "match" && expected && /^\d{4}$/.test(expected) ? expected : wrong;
  const from = opts.now.toISOString();
  const to = new Date(opts.now.getTime() + 7 * DAY).toISOString();

  const catalog: Record<string, Record<string, unknown>> = {
    lookup_contact: { kind: "phone", value: "1155550000" },
    search_knowledge: { query: "horarios de atención" },
    find_available_slots: { from, to, count: 3 },
    book_appointment: { slotId: "slot-1" },
    reschedule_appointment: { bookingId: "booking-1", newSlotId: "slot-2", dniLast4 },
    cancel_appointment: { bookingId: "booking-1", dniLast4 },
    get_payment_options: { obligationId: "ob-1" },
    register_promise_to_pay: { obligationId: "ob-1", amount: 1, promisedDate: to.slice(0, 10) },
    send_payment_link: { obligationId: "ob-1" },
    send_whatsapp: { text: "Hola" },
    schedule_callback: { inMinutes: 30, channel: "whatsapp", reason: "retomar la conversación" },
    transfer_to_human: { reason: "el cliente lo pidió" },
    qualify_lead: { need: "atender consultas", score: 3 },
    book_demo: { slotId: "slot-1" },
    update_lead_stage: { stage: "contacted" },
  };
  return catalog[tool] ?? null;
}

/** Tools whose input carries the customer's DNI digits, so a wrong value is the "cannot verify identity" case. */
export function takesDni(tool: string): boolean {
  return tool === "reschedule_appointment" || tool === "cancel_appointment";
}

/** The tool that has to be allowed for a scenario `outcome` assertion to be reachable. */
export const OUTCOME_TOOLS: Record<string, string> = {
  promise_to_pay: "register_promise_to_pay",
  transferred: "transfer_to_human",
  demo_booked: "book_demo",
  opted_out: "update_lead_stage",
  rescheduled: "reschedule_appointment",
  appointment_booked: "book_appointment",
};
