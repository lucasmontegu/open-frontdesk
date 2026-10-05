import type { Contact, CrmConnector, Obligation } from "@ofd/core";
import { normalizeArgentinePhone } from "../phone.js";
import { type ConnectorOptions, type FetchLike, requestJson } from "./http.js";

type PulledContact = Omit<Contact, "id" | "orgId" | "createdAt" | "updatedAt">;
type PulledObligation = Omit<Obligation, "id" | "orgId" | "contactId" | "createdAt" | "updatedAt">;

interface KommoContact {
  id: number;
  name: string;
  custom_fields_values?: Array<{ field_code?: string; values: Array<{ value: string }> }> | null;
}

interface KommoContactsResponse {
  _embedded?: { contacts: KommoContact[] };
  _links?: { next?: { href: string } };
}

/** Kommo API v4. baseUrl is the account domain, e.g. https://acme.kommo.com. Auth is a long-lived token. */
export class KommoConnector implements CrmConnector {
  readonly id = "kommo";
  private readonly doFetch: FetchLike;

  constructor(private readonly opts: ConnectorOptions) {
    this.doFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  }

  async *pull(
    _orgId: string,
    since: Date | null,
  ): AsyncIterable<{ contact: PulledContact; obligations: PulledObligation[] }> {
    const qs = new URLSearchParams({ limit: "250", page: "1" });
    // TODO verify against vendor API: filter[updated_at][from] takes a unix timestamp in seconds.
    if (since) qs.set("filter[updated_at][from]", String(Math.floor(since.getTime() / 1000)));
    let url: string | null = `${this.opts.baseUrl}/api/v4/contacts?${qs}`;
    while (url) {
      const page: KommoContactsResponse | null = await requestJson<KommoContactsResponse>(
        this.doFetch,
        url,
        this.opts.token,
      );
      for (const c of page?._embedded?.contacts ?? [])
        yield { contact: toContact(c), obligations: [] };
      // TODO verify against vendor API: _links.next.href is absolute; an empty page answers 204.
      url = page?._links?.next?.href ?? null;
    }
  }

  async pushOutcome(
    _orgId: string,
    input: {
      externalContactId: string;
      summary: string;
      outcome: string;
      facts: Array<{ key: string; value: string }>;
    },
  ): Promise<void> {
    const text = [
      `Resultado: ${input.outcome}`,
      input.summary,
      ...input.facts.map((f) => `${f.key}: ${f.value}`),
    ].join("\n");
    // TODO verify against vendor API: contact notes endpoint and the "common" note type.
    await requestJson(
      this.doFetch,
      `${this.opts.baseUrl}/api/v4/contacts/${input.externalContactId}/notes`,
      this.opts.token,
      {
        method: "POST",
        body: JSON.stringify([{ note_type: "common", params: { text } }]),
      },
    );
  }
}

function toContact(c: KommoContact): PulledContact {
  const identities: PulledContact["identities"] = [
    { kind: "external", value: String(c.id), source: "kommo" },
  ];
  for (const field of c.custom_fields_values ?? []) {
    for (const { value } of field.values) {
      if (field.field_code === "PHONE") {
        const n = normalizeArgentinePhone(value);
        if (n && !identities.some((i) => i.value === n))
          identities.push({ kind: "phone", value: n });
      } else if (field.field_code === "EMAIL") {
        identities.push({ kind: "email", value: value.toLowerCase() });
      }
    }
  }
  return {
    displayName: c.name || String(c.id),
    identities,
    attributes: {},
    tags: [],
    doNotCall: false,
  };
}
