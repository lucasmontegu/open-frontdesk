import type { Contact, CrmConnector, Obligation } from "@ofd/core";
import { normalizeArgentinePhone } from "../phone.js";
import { requestJson, type ConnectorOptions, type FetchLike } from "./http.js";

type PulledContact = Omit<Contact, "id" | "orgId" | "createdAt" | "updatedAt">;
type PulledObligation = Omit<Obligation, "id" | "orgId" | "contactId" | "createdAt" | "updatedAt">;

interface HubSpotSearchResponse {
  results: Array<{ id: string; properties: Record<string, string | null> }>;
  paging?: { next?: { after: string } };
}

const PROPERTIES = ["firstname", "lastname", "email", "phone", "mobilephone", "lifecyclestage", "hs_lastmodifieddate"];

/** HubSpot CRM v3. Auth is a private-app token. Default base URL: https://api.hubspot.com */
export class HubSpotConnector implements CrmConnector {
  readonly id = "hubspot";
  private readonly doFetch: FetchLike;

  constructor(private readonly opts: ConnectorOptions) {
    this.doFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  }

  async *pull(_orgId: string, since: Date | null): AsyncIterable<{ contact: PulledContact; obligations: PulledObligation[] }> {
    let after: string | undefined;
    do {
      // TODO verify against vendor API: empty filterGroups is accepted by the search endpoint.
      const body = {
        filterGroups: since ? [{ filters: [{ propertyName: "hs_lastmodifieddate", operator: "GTE", value: String(since.getTime()) }] }] : [],
        properties: PROPERTIES,
        limit: 100,
        ...(after ? { after } : {}),
      };
      const page = await requestJson<HubSpotSearchResponse>(this.doFetch, `${this.opts.baseUrl}/crm/v3/objects/contacts/search`, this.opts.token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      for (const r of page?.results ?? []) yield { contact: toContact(r.id, r.properties), obligations: [] };
      after = page?.paging?.next?.after;
    } while (after);
  }

  async pushOutcome(_orgId: string, input: { externalContactId: string; summary: string; outcome: string; facts: Array<{ key: string; value: string }> }): Promise<void> {
    const lines = [`Resultado: ${input.outcome}`, input.summary, ...input.facts.map((f) => `${f.key}: ${f.value}`)];
    // TODO verify against vendor API: note creation with default association type id 202 (note -> contact).
    await requestJson(this.doFetch, `${this.opts.baseUrl}/crm/v3/objects/notes`, this.opts.token, {
      method: "POST",
      body: JSON.stringify({
        properties: { hs_timestamp: new Date().toISOString(), hs_note_body: lines.join("\n") },
        associations: [{ to: { id: input.externalContactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }] }],
      }),
    });
  }
}

function toContact(id: string, p: Record<string, string | null>): PulledContact {
  const identities: PulledContact["identities"] = [{ kind: "external", value: id, source: "hubspot" }];
  for (const raw of [p["phone"], p["mobilephone"]]) {
    const n = raw ? normalizeArgentinePhone(raw) : null;
    if (n && !identities.some((i) => i.value === n)) identities.push({ kind: "phone", value: n });
  }
  if (p["email"]) identities.push({ kind: "email", value: p["email"].toLowerCase() });
  const name = [p["firstname"], p["lastname"]].filter(Boolean).join(" ").trim();
  return {
    displayName: name || p["email"] || id,
    identities,
    attributes: p["lifecyclestage"] ? { lifecycleStage: p["lifecyclestage"] } : {},
    tags: [],
    doNotCall: false,
  };
}
