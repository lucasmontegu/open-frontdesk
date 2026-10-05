export interface InboundSipInfo {
  callerPhone: string | null;
  calledNumber: string | null;
  callId: string | null;
  trunkId: string | null;
}

const asE164 = (v: string | undefined): string | null => {
  const s = v?.trim();
  if (!s) return null;
  const digits = s.replace(/[^\d+]/g, "");
  if (!digits) return null;
  return digits.startsWith("+") ? digits : `+${digits}`;
};

/**
 * Reads the caller from a LiveKit SIP participant. LiveKit sets these attributes on SIP participants:
 * sip.phoneNumber (caller), sip.trunkPhoneNumber (number dialed), sip.callID, sip.trunkID.
 * Falls back to the participant identity ("sip_+5491112345678") when attributes are missing.
 */
export function parseInboundSipMetadata(participant: {
  identity?: string;
  attributes?: Record<string, string> | null;
}): InboundSipInfo {
  const a = participant.attributes ?? {};
  const fromIdentity = /^sip[_-](\+?\d+)$/.exec(participant.identity ?? "")?.[1];
  return {
    callerPhone: asE164(a["sip.phoneNumber"]) ?? asE164(fromIdentity),
    calledNumber: asE164(a["sip.trunkPhoneNumber"]),
    callId: a["sip.callID"] ?? null,
    trunkId: a["sip.trunkID"] ?? null,
  };
}
