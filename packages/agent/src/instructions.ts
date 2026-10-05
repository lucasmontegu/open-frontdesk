import type { BotConfig, ContactProfile } from "@ofd/core";

const AUTONOMY_RULES: Record<number, string> = {
  1: "Solo respondés consultas entrantes. No iniciás contacto ni ejecutás acciones que cambien datos.",
  2: "Podés usar las herramientas habilitadas dentro de las políticas. Si una herramienta es rechazada, no insistas ni busques rodeos.",
  3: "Podés retomar contacto con clientes, pero las campañas masivas requieren aprobación de una persona del equipo.",
  4: "Tenés un objetivo a cargo y reportás resultados. Aun así, respetá siempre las políticas y los límites de las herramientas.",
  5: "Podés proponer mejoras al guion, pero nunca las aplicás sin aprobación humana.",
};

const fmtDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "sin fecha");

/** Renders the preloaded customer profile. The agent never searches for the customer mid-call. */
export function renderProfileBlock(profile: ContactProfile | null): string {
  if (!profile) {
    return "## Lo que sabés de este cliente\nNo tenés datos previos de esta persona. No inventes información sobre ella.";
  }
  const lines: string[] = [
    "## Lo que sabés de este cliente",
    `Nombre: ${profile.contact.displayName}`,
  ];
  if (profile.contact.doNotCall)
    lines.push(
      "Atención: pidió no ser contactado (No llame). No le ofrezcas llamadas ni mensajes salientes.",
    );
  if (profile.contact.tags.length) lines.push(`Etiquetas: ${profile.contact.tags.join(", ")}`);

  if (profile.obligations.length) {
    lines.push("", "Obligaciones y turnos:");
    for (const o of profile.obligations) {
      const amount = o.amount != null ? ` | monto ${o.amount} ${o.currency ?? ""}`.trimEnd() : "";
      lines.push(`- ${o.kind} (${o.stage}) | vence ${fmtDate(o.dueAt)}${amount} | id ${o.id}`);
    }
  }
  if (profile.facts.length) {
    lines.push("", "Datos conocidos (con fecha en que se registraron):");
    for (const f of profile.facts) lines.push(`- ${f.key}: ${f.value} (${fmtDate(f.createdAt)})`);
  }
  if (profile.recentSummaries.length) {
    lines.push("", "Resúmenes de conversaciones recientes:");
    for (const s of profile.recentSummaries) lines.push(`- ${s}`);
  }
  lines.push(
    "",
    "Usá estos datos con naturalidad. Si algo no figura acá, preguntalo en vez de suponerlo.",
  );
  return lines.join("\n");
}

export function buildInstructions(config: BotConfig, profile: ContactProfile | null): string {
  const identity = [
    `Sos ${config.name}, ${config.role}.`,
    config.goal ? `Tu objetivo: ${config.goal}` : "",
    "Hablás en español rioplatense (Argentina), con voseo, trato cordial y frases cortas.",
    "No sos una persona: si te lo preguntan, decí que sos un asistente virtual.",
    "Nunca pidas ni repitas números completos de tarjeta, CBU/CVU o DNI; el sistema los oculta por seguridad.",
  ].filter(Boolean);

  return [
    config.instructions.trim(),
    "## Identidad\n" + identity.join("\n"),
    `## Autonomía (nivel ${config.autonomy})\n${AUTONOMY_RULES[config.autonomy] ?? AUTONOMY_RULES[2]}\n` +
      "Si una acción es rechazada por política, explicale al cliente que no podés hacerla y ofrecé pasarlo con una persona.",
    renderProfileBlock(profile),
  ].join("\n\n");
}
