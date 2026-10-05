import { z } from "zod";

export interface TranscriptLine {
  index: number;
  eventId: string;
  role: "customer" | "agent";
  text: string;
  at: Date;
}

export interface RawFact {
  key: string;
  value: string;
  confidence: number;
  /** Index (in the transcript) of the line the fact comes from. */
  lineIndex: number;
}

export const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const MONTHS: Record<string, number> = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};
const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

/** Calendar date (y, m0, d) of `at` in the given timezone. */
function localDate(at: Date, timezone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month") - 1, d: get("day") };
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => Date.UTC(y, m, d);
const DAY = 86_400_000;

/** Parses the first date expression in a Spanish sentence, relative to `ref`. Returns YYYY-MM-DD or null. */
export function parseSpanishDate(
  text: string,
  ref: Date,
  timezone = "America/Argentina/Buenos_Aires",
): string | null {
  const t = norm(text);
  const today = localDate(ref, timezone);
  const todayMs = utc(today.y, today.m, today.d);
  const valid = (y: number, m: number, d: number) => {
    const ms = utc(y, m, d);
    const back = new Date(ms);
    return back.getUTCMonth() === m && back.getUTCDate() === d ? ms : null;
  };

  let m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
  if (m) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : today.y;
    let ms = valid(year, Number(m[2]) - 1, Number(m[1]));
    if (ms !== null && !m[3] && ms < todayMs) ms = valid(year + 1, Number(m[2]) - 1, Number(m[1]));
    return ms === null ? null : iso(ms);
  }
  m = new RegExp(`\\b(\\d{1,2}) de (${Object.keys(MONTHS).join("|")})\\b`).exec(t);
  if (m) {
    const month = MONTHS[m[2] as string] as number;
    let ms = valid(today.y, month, Number(m[1]));
    if (ms !== null && ms < todayMs) ms = valid(today.y + 1, month, Number(m[1]));
    return ms === null ? null : iso(ms);
  }
  if (/\bpasado manana\b/.test(t)) return iso(todayMs + 2 * DAY);
  if (/\bmanana\b/.test(t)) return iso(todayMs + DAY);
  if (/\bhoy\b/.test(t)) return iso(todayMs);
  m = new RegExp(`\\b(${Object.keys(WEEKDAYS).join("|")})\\b`).exec(t);
  if (m) {
    const target = WEEKDAYS[m[1] as string] as number;
    const current = new Date(todayMs).getUTCDay();
    const delta = (target - current + 7) % 7 || 7;
    return iso(todayMs + delta * DAY);
  }
  m = /\bel (\d{1,2})\b/.exec(t);
  if (m) {
    let ms = valid(today.y, today.m, Number(m[1]));
    if (ms !== null && ms < todayMs)
      ms = valid(today.m === 11 ? today.y + 1 : today.y, (today.m + 1) % 12, Number(m[1]));
    return ms === null ? null : iso(ms);
  }
  return null;
}

const PAY_INTENT =
  /\b(pago|pagar|pagare|pagaria|transfiero|transferir|transferencia|deposito|depositar|abono|abonar|cancelo|regularizo|saldo)\b/;
const APPOINTMENT_CONTEXT = /\b(turno|cita|horario|reprogram\w*|reagend\w*|consulta)\b/;
const CONFIRM =
  /\b(confirmo|confirmado|confirmamos|ahi estoy|ahi estare|ahi voy|alli estare|me queda bien|me sirve|dale, voy|si, voy)\b/;
const DECLINE =
  /\b(no puedo ir|no voy a poder|cancelo el turno|cancela el turno|cancelame el turno|no me sirve)\b/;

export interface RuleOptions {
  timezone?: string;
}

/** Deterministic extraction: promise-to-pay dates, preferred channel and appointment confirmations. */
export function extractFactsWithRules(lines: TranscriptLine[], opts: RuleOptions = {}): RawFact[] {
  const out: RawFact[] = [];
  const customer = lines.filter((l) => l.role === "customer");
  const appointmentTalk = lines.some((l) => APPOINTMENT_CONTEXT.test(norm(l.text)));

  const last = <K extends string>(key: K, fact: RawFact) => {
    // Later statements override earlier ones within the same conversation.
    const i = out.findIndex((f) => f.key === key);
    if (i >= 0) out.splice(i, 1);
    out.push(fact);
  };

  for (const line of customer) {
    const t = norm(line.text);
    if (PAY_INTENT.test(t)) {
      const date = parseSpanishDate(line.text, line.at, opts.timezone);
      if (date)
        last("promise_to_pay_date", {
          key: "promise_to_pay_date",
          value: date,
          confidence: 0.7,
          lineIndex: line.index,
        });
    }
    if (
      /\b(no me llamen|no me llames|no llamen)\b/.test(t) ||
      /\b(escribime|escribanme|mandame|mandenme)\b.*\b(whatsapp|mensaje|wsp)\b|\bpor (whatsapp|wsp|wpp)\b/.test(
        t,
      )
    ) {
      last("preferred_channel", {
        key: "preferred_channel",
        value: "whatsapp",
        confidence: 0.75,
        lineIndex: line.index,
      });
    } else if (/\b(llamame|llamenme|llamar|por telefono|por llamada)\b/.test(t)) {
      last("preferred_channel", {
        key: "preferred_channel",
        value: "voice",
        confidence: 0.7,
        lineIndex: line.index,
      });
    } else if (/\b(por mail|por email|por correo|mandame un mail)\b/.test(t)) {
      last("preferred_channel", {
        key: "preferred_channel",
        value: "email",
        confidence: 0.7,
        lineIndex: line.index,
      });
    }
    if (appointmentTalk) {
      if (DECLINE.test(t))
        last("appointment_confirmed", {
          key: "appointment_confirmed",
          value: "false",
          confidence: 0.65,
          lineIndex: line.index,
        });
      else if (CONFIRM.test(t))
        last("appointment_confirmed", {
          key: "appointment_confirmed",
          value: "true",
          confidence: 0.7,
          lineIndex: line.index,
        });
    }
  }
  return out;
}

export const ModelFactsResponse = z.object({
  facts: z.array(
    z.object({
      key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
      value: z.string().min(1).max(300),
      confidence: z.number().min(0).max(1),
      line: z.number().int().nonnegative(),
    }),
  ),
});

export type ModelFactExtractor = (transcript: TranscriptLine[]) => Promise<RawFact[]>;

/** Extraction with OpenAI's chat completions API (JSON mode). Plain fetch so the worker needs no SDK. */
export function createOpenAiFactExtractor(opts: {
  apiKey: string;
  /** Model id without provider prefix, e.g. "gpt-5-mini". */
  model: string;
  baseUrl?: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => Date;
}): ModelFactExtractor {
  const doFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  return async (lines) => {
    const transcript = lines
      .map((l) => `[${l.index}] ${l.role === "customer" ? "CLIENTE" : "AGENTE"}: ${l.text}`)
      .join("\n");
    const res = await doFetch(
      `${(opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model: opts.model,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Extraés hechos duraderos sobre el CLIENTE a partir de una conversación. Respondé solo JSON: " +
                '{"facts":[{"key":"snake_case","value":"texto","confidence":0..1,"line":N}]} donde line es el número [N] del mensaje del cliente que lo sustenta. ' +
                "Claves preferidas: promise_to_pay_date (YYYY-MM-DD), preferred_channel (whatsapp|voice|email), appointment_confirmed (true|false), preferred_contact_hours. " +
                `Hoy es ${(opts.now?.() ?? new Date()).toISOString().slice(0, 10)}. No inventes: si no hay hechos, devolvé {"facts":[]}.`,
            },
            { role: "user", content: transcript },
          ],
        }),
      },
    );
    if (!res.ok)
      throw new Error(`model extraction failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("model extraction returned no content");
    const parsed = ModelFactsResponse.parse(JSON.parse(content));
    const customerLines = new Set(lines.filter((l) => l.role === "customer").map((l) => l.index));
    return parsed.facts
      .filter((f) => customerLines.has(f.line))
      .map((f) => ({ key: f.key, value: f.value, confidence: f.confidence, lineIndex: f.line }));
  };
}
