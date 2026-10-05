import type { Contact, ContactRepository, CrmConnector, ObligationRepository } from "@ofd/core";

export type FieldOwner = "external" | "local";

/** Which side wins when both have a value. Safe defaults: the CRM owns identity data, we own do-not-call. */
export interface FieldOwnership {
  displayName: FieldOwner;
  tags: FieldOwner;
  doNotCall: FieldOwner;
  attributes: { default: FieldOwner; overrides?: Record<string, FieldOwner> };
}

export const DEFAULT_FIELD_OWNERSHIP: FieldOwnership = {
  displayName: "external",
  tags: "external",
  doNotCall: "local",
  attributes: { default: "external" },
};

export interface SyncResult {
  created: number;
  updated: number;
  obligations: number;
  errors: Array<{ externalId: string | null; message: string }>;
}

export class CrmSyncService {
  constructor(
    private readonly deps: { contacts: ContactRepository; obligations: ObligationRepository; connector: CrmConnector },
    private readonly ownership: FieldOwnership = DEFAULT_FIELD_OWNERSHIP,
  ) {}

  /** Pulls from the connector and upserts into the canonical model, keyed by external identity first. */
  async pull(orgId: string, since: Date | null): Promise<SyncResult> {
    const { contacts, obligations, connector } = this.deps;
    const result: SyncResult = { created: 0, updated: 0, obligations: 0, errors: [] };

    for await (const item of connector.pull(orgId, since)) {
      const externalId = item.contact.identities.find((i) => i.kind === "external" && i.source === connector.id)?.value ?? null;
      try {
        let existing: Contact | null = null;
        for (const identity of orderedIdentities(item.contact.identities, connector.id)) {
          existing = await contacts.findByIdentity(orgId, identity);
          if (existing) break;
        }

        let contact: Contact;
        if (existing) {
          contact = await contacts.update(orgId, existing.id, this.merge(existing, item.contact));
          result.updated++;
        } else {
          contact = await contacts.create(orgId, {
            displayName: item.contact.displayName,
            identities: item.contact.identities,
            attributes: item.contact.attributes,
            tags: item.contact.tags,
            doNotCall: item.contact.doNotCall,
          });
          result.created++;
        }

        if (item.obligations.length > 0) {
          const current = await obligations.listByContact(orgId, contact.id);
          for (const o of item.obligations) {
            const extId = o.attributes["externalId"];
            const match = extId !== undefined ? current.find((c) => c.attributes["externalId"] === extId) : undefined;
            await obligations.upsert(orgId, { ...o, contactId: contact.id, ...(match ? { id: match.id } : {}) });
            result.obligations++;
          }
        }
      } catch (err) {
        result.errors.push({ externalId, message: (err as Error).message });
      }
    }
    return result;
  }

  /** Writes a conversation outcome back to the CRM. Returns false when the contact has no link to this connector. */
  async pushOutcome(
    orgId: string,
    contactId: string,
    outcome: { summary: string; outcome: string; facts: Array<{ key: string; value: string }> },
  ): Promise<boolean> {
    const contact = await this.deps.contacts.get(orgId, contactId);
    const link = contact?.identities.find((i) => i.kind === "external" && i.source === this.deps.connector.id);
    if (!link) return false;
    await this.deps.connector.pushOutcome(orgId, { externalContactId: link.value, ...outcome });
    return true;
  }

  private merge(existing: Contact, incoming: Pick<Contact, "displayName" | "tags" | "doNotCall" | "attributes">) {
    const o = this.ownership;
    const attributes: Record<string, unknown> = { ...existing.attributes };
    for (const [key, value] of Object.entries(incoming.attributes)) {
      const owner = o.attributes.overrides?.[key] ?? o.attributes.default;
      if (owner === "external" || !(key in existing.attributes)) attributes[key] = value;
    }
    return {
      displayName: o.displayName === "external" && incoming.displayName ? incoming.displayName : existing.displayName,
      tags: o.tags === "external" ? incoming.tags : existing.tags,
      doNotCall: o.doNotCall === "external" ? incoming.doNotCall : existing.doNotCall,
      attributes,
    };
  }
}

function orderedIdentities(identities: Contact["identities"], connectorId: string) {
  const external = identities.filter((i) => i.kind === "external" && i.source === connectorId);
  const rest = identities.filter((i) => i.kind !== "external");
  return [...external, ...rest];
}
