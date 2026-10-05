import type { BotConfig, Contact } from "@ofd/core";

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

const fmtDate = (iso: string, timezone: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(d);
};

/**
 * Deterministic outreach message (Spanish, voseo) used when no model API key is configured,
 * so local runs work without keys. The offer comes from the mission plan.
 */
export function templateMessage(input: {
  contact: Pick<Contact, "displayName">;
  config: Pick<BotConfig, "name">;
  offer: Record<string, unknown>;
  reason?: string;
  timezone?: string;
}): string {
  const { contact, config, offer } = input;
  const hello = `Hola ${firstName(contact.displayName)}, te escribe ${config.name}.`;
  const tz = input.timezone ?? "America/Argentina/Buenos_Aires";

  if (offer["type"] === "reschedule") {
    const start = typeof offer["start"] === "string" ? fmtDate(offer["start"], tz) : null;
    return start
      ? `${hello} Tenemos que reprogramar tu turno de mañana. Te podemos ofrecer ${start}. ¿Te sirve? Respondé "sí" para confirmarlo o decime qué horario te queda mejor.`
      : `${hello} Tenemos que reprogramar tu turno de mañana. ¿Qué día y horario te queda mejor?`;
  }
  if (input.reason)
    return `${hello} Te escribo por lo que hablamos: ${input.reason}. ¿Seguimos por acá?`;
  if (typeof offer["amount"] === "number") {
    return `${hello} Te escribo por un saldo pendiente de ${offer["amount"]} ${(offer["currency"] as string | null) ?? "ARS"}. ¿Querés que te cuente las opciones para ponerlo al día?`;
  }
  return `${hello} Quería contactarte por una novedad. ¿Tenés un minuto para charlar por acá?`;
}
