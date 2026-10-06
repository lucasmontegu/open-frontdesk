import { z } from "zod";

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");

/**
 * When outbound contact is allowed, in local time. Missions never start a call or a
 * WhatsApp conversation outside it; the attempt is deferred to the next opening.
 * The default is a placeholder: the legal hours per country and use case still need confirming.
 */
export const ContactWindow = z
  .object({
    timezone: z.string().min(1),
    /** Days of the week, 0 = Sunday. */
    days: z.array(z.number().int().min(0).max(6)).min(1),
    start: HHMM,
    end: HHMM,
  })
  .refine((w) => w.start < w.end, { message: "start must be before end" });
export type ContactWindow = z.infer<typeof ContactWindow>;

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Calendar date, weekday and minutes since midnight of `at` in `timezone`. */
function localParts(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    seconds: Number(get("second")),
  };
}

/** The instant when the local clock in `timezone` reads `minutes` on the given calendar date. */
function instantAt(
  date: { year: number; month: number; day: number },
  minutes: number,
  timezone: string,
) {
  const wall = Date.UTC(date.year, date.month - 1, date.day, 0, minutes);
  // Two passes settle the offset, including across a DST change.
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), timezone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, 0, p.minutes, p.seconds);
    guess += wall - seen;
  }
  return new Date(guess);
}

/** `at` itself when the window is open, otherwise the next moment it opens. */
export function nextContactTime(window: ContactWindow, at: Date): Date {
  const start = minutesOf(window.start);
  const end = minutesOf(window.end);
  const now = localParts(at, window.timezone);
  if (window.days.includes(now.weekday) && now.minutes >= start && now.minutes < end) return at;

  for (let offset = 0; offset <= 7; offset++) {
    // Noon UTC of the local date plus `offset` days, so the date math never crosses midnight.
    const day = new Date(Date.UTC(now.year, now.month - 1, now.day + offset, 12));
    const date = {
      year: day.getUTCFullYear(),
      month: day.getUTCMonth() + 1,
      day: day.getUTCDate(),
    };
    if (!window.days.includes(day.getUTCDay())) continue;
    if (offset === 0 && now.minutes >= start) continue; // today's window already closed
    return instantAt(date, start, window.timezone);
  }
  throw new Error("unreachable: a window with at least one day opens within a week");
}
