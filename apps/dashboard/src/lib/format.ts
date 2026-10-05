const TZ = "America/Argentina/Buenos_Aires";

export function formatArs(amount: number, currency: string | null = "ARS"): string {
  const code = currency ?? "ARS";
  const formatted = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: code,
    currencyDisplay: code === "ARS" ? "narrowSymbol" : "symbol",
  }).format(amount);
  return formatted.replace(/ /g, " ");
}

function toDate(value: string | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** dd/mm/yyyy in Buenos Aires time. */
export function formatDate(value: string | Date): string {
  const d = toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

/** dd/mm/yyyy HH:mm (24h) in Buenos Aires time. */
export function formatDateTime(value: string | Date): string {
  const d = toDate(value);
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("day")}/${p("month")}/${p("year")} ${p("hour")}:${p("minute")}`;
}

/** True when the date falls on the same Buenos Aires calendar day as `now`. */
export function isSameDayAr(value: string | Date, now: Date = new Date()): boolean {
  const d = toDate(value);
  return d !== null && formatDate(d) === formatDate(now);
}

/**
 * Formats an Argentine phone number. Mobile numbers (+54 9 ...) become
 * "+54 9 11 1234-5678"; anything unrecognised is returned untouched.
 */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const m = /^549(\d{10})$/.exec(digits);
  if (!m?.[1]) return raw;
  const national = m[1];
  const areaLen = national.startsWith("11") ? 2 : 3;
  const area = national.slice(0, areaLen);
  const sub = national.slice(areaLen);
  const split = sub.length - 4;
  return `+54 9 ${area} ${sub.slice(0, split)}-${sub.slice(split)}`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
