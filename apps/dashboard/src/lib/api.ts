import type {
  Bot,
  BotConfig,
  BotVersion,
  Contact,
  ContactProfile,
  InteractionEvent,
  Mission,
  Obligation,
  Portfolio,
  PortfolioRule,
} from "@ofd/core";
import { t } from "../i18n";
import { type ApiError, mapError, networkError } from "./api-error";

/** JSON turns Date into ISO strings; this mirrors a core type as it arrives over HTTP. */
export type Wire<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Accepts `T[]` or `{ items, nextCursor? }` so the UI tolerates either list shape. */
export function toPage<T>(body: unknown): Page<T> {
  if (Array.isArray(body)) return { items: body as T[], nextCursor: null };
  const b = (body ?? {}) as { items?: T[]; nextCursor?: string | null };
  return { items: b.items ?? [], nextCursor: b.nextCursor ?? null };
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  query?: Query;
  body?: unknown;
}

const fallbackMessage = (code: string): string => (t.errors as Record<string, string>)[code] ?? t.errors.unknown;

export function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return `/api${path}${qs ? `?${qs}` : ""}`;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? "GET",
      credentials: "include",
      headers: opts.body === undefined ? undefined : { "content-type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw networkError(fallbackMessage);
  }
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) throw mapError(res.status, parsed, fallbackMessage);
  return parsed as T;
}

export type { ApiError };

// ---- Wire types -----------------------------------------------------------

export type ContactDto = Wire<Contact>;
export type ObligationDto = Wire<Obligation>;
export type ProfileDto = Wire<ContactProfile>;
export type PortfolioDto = Wire<Portfolio>;
export type BotDto = Wire<Bot>;
export type BotVersionDto = Wire<BotVersion>;
export type MissionDto = Wire<Mission>;
export type EventDto = Wire<InteractionEvent>;

export interface PackDto {
  id: string;
  name: string;
  version: string;
  description?: string;
}

/** Assumed shape of the eval outcome returned (or embedded in the error) on publish. */
export interface EvalOutcome {
  passed?: boolean;
  score?: number;
  summary?: string;
  failures?: { scenario?: string; reason?: string }[];
}

export interface PublishResponse {
  version?: BotVersionDto;
  evalRun?: EvalOutcome;
  eval?: EvalOutcome;
}

export interface ImportResult {
  created: number;
  updated: number;
  errors?: { row: number; message: string }[];
}

export interface ContactsQuery {
  q?: string;
  cursor?: string;
  limit?: number;
}

// ---- Endpoints ------------------------------------------------------------

export const api = {
  contacts: {
    list: async (q: ContactsQuery) => toPage<ContactDto>(await request("/contacts", { query: { ...q } })),
    get: (id: string) => request<ProfileDto>(`/contacts/${id}`),
    import: (csv: string) => request<ImportResult>("/contacts/import", { method: "POST", body: { csv } }),
  },
  portfolios: {
    list: async () => toPage<PortfolioDto>(await request("/portfolios")),
    create: (input: { name: string; owner?: string | null; rule: PortfolioRule }) =>
      request<PortfolioDto>("/portfolios", { method: "POST", body: input }),
    members: async (id: string) => toPage<unknown>(await request(`/portfolios/${id}/members`)),
  },
  packs: {
    list: async () => toPage<PackDto>(await request("/packs")),
  },
  bots: {
    list: async () => toPage<BotDto>(await request("/bots")),
    get: async (id: string) => normalizeBotDetail(await request<unknown>(`/bots/${id}`)),
    create: (input: { name: string; packId?: string; config?: Partial<BotConfig> }) =>
      request<BotDto>("/bots", { method: "POST", body: input }),
    publish: (botId: string, versionId: string) =>
      request<PublishResponse>(`/bots/${botId}/versions/${versionId}/publish`, { method: "POST" }),
  },
  missions: {
    list: async () => toPage<MissionDto>(await request("/missions")),
    get: (id: string) => request<MissionDto>(`/missions/${id}`),
    create: (input: { instruction: string; botId: string }) =>
      request<MissionDto>("/missions", { method: "POST", body: input }),
    approve: (id: string) => request<MissionDto>(`/missions/${id}/approve`, { method: "POST" }),
  },
  events: {
    list: async (q: { cursor?: string; limit?: number; type?: string; contactId?: string }) =>
      toPage<EventDto>(await request("/events", { query: q })),
    forConversation: async (id: string) => toPage<EventDto>(await request(`/conversations/${id}/events`)),
  },
};

export interface BotDetail {
  bot: BotDto;
  versions: BotVersionDto[];
}

/** The detail endpoint is documented as "Bot with versions"; accept `{bot, versions}` or a flat bot with `versions`. */
export function normalizeBotDetail(body: unknown): BotDetail {
  const b = body as { bot?: BotDto; versions?: BotVersionDto[] } & Partial<BotDto>;
  const bot = (b.bot ?? b) as BotDto;
  return { bot, versions: b.versions ?? [] };
}

/** Extracts the eval outcome from a publish response or a failed-publish ApiError body. */
export function evalOutcomeFrom(body: unknown): EvalOutcome | null {
  const b = body as (PublishResponse & { error?: { details?: { evalRun?: EvalOutcome } } }) | null;
  return b?.evalRun ?? b?.eval ?? b?.error?.details?.evalRun ?? null;
}
