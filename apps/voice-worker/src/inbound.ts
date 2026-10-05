import type { Contact, ContactRepository } from "@ofd/core";

export interface InboundSipInfo {
  callerPhone: string | null;
  calledNumber: string | null;
}

const asE164 = (v: string | undefined | null): string | null => {
  const s = v?.trim();
  if (!s) return null;
  const digits = s.replace(/[^\d+]/g, "");
  if (!digits) return null;
  return digits.startsWith("+") ? digits : `+${digits}`;
};

/**
 * Reads the caller from a LiveKit SIP participant: attributes sip.phoneNumber (caller) and
 * sip.trunkPhoneNumber (dialed number), falling back to the identity "sip_+5491112345678".
 * (Same contract as parseInboundSipMetadata in @ofd/channels, which this app does not depend on.)
 */
export function parseSipParticipant(participant: { identity?: string; attributes?: Record<string, string> | null }): InboundSipInfo {
  const a = participant.attributes ?? {};
  const fromIdentity = /^sip[_-](\+?\d+)$/.exec(participant.identity ?? "")?.[1];
  return { callerPhone: asE164(a["sip.phoneNumber"]) ?? asE164(fromIdentity), calledNumber: asE164(a["sip.trunkPhoneNumber"]) };
}

/** Argentine mobiles appear both as +54 9 11... and +54 11...; carriers are inconsistent, so try both. */
export function phoneCandidates(e164: string): string[] {
  const out = [e164];
  if (e164.startsWith("+549")) out.push(`+54${e164.slice(4)}`);
  else if (e164.startsWith("+54") && !e164.startsWith("+549")) out.push(`+549${e164.slice(3)}`);
  return out;
}

export async function findContactByPhone(contacts: Pick<ContactRepository, "findByIdentity">, orgId: string, phone: string): Promise<Contact | null> {
  for (const value of phoneCandidates(phone)) {
    for (const kind of ["phone", "whatsapp"] as const) {
      const found = await contacts.findByIdentity(orgId, { kind, value });
      if (found) return found;
    }
  }
  return null;
}

export interface InboundRoute {
  orgId: string;
  botVersionId: string;
}

/**
 * Which org and bot answer a number.
 * TODO: route by dialed number (a table of number -> org + bot version); for now one bot answers everything.
 */
export function routeInbound(env: Record<string, string | undefined>, _calledNumber: string | null): InboundRoute {
  const orgId = env["OFD_INBOUND_ORG_ID"];
  const botVersionId = env["OFD_INBOUND_BOT_VERSION_ID"];
  if (!orgId || !botVersionId) throw new Error("Inbound calls need OFD_INBOUND_ORG_ID and OFD_INBOUND_BOT_VERSION_ID");
  return { orgId, botVersionId };
}
