import { z } from "zod";

/**
 * Dispatch metadata for outbound calls. Must match VoiceDispatchMetadata in @ofd/channels
 * (LiveKitTelephonyProvider.dial writes it as JSON in the agent dispatch).
 */
export const OutboundDispatch = z.object({
  orgId: z.string().min(1),
  botVersionId: z.string().min(1),
  conversationId: z.string().min(1),
  context: z.record(z.string(), z.unknown()).default({}),
});
export type OutboundDispatch = z.infer<typeof OutboundDispatch>;

export type ParsedDispatch = { kind: "outbound"; dispatch: OutboundDispatch } | { kind: "inbound" };

/**
 * Outbound calls carry {orgId, botVersionId, conversationId, context}. Anything else (inbound SIP
 * rules dispatch with empty metadata) is treated as an inbound call.
 */
export function parseDispatchMetadata(raw: unknown): ParsedDispatch {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return parseObject(raw);
  if (typeof raw !== "string" || raw.trim() === "") return { kind: "inbound" };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { kind: "inbound" };
  }
  return json && typeof json === "object" && !Array.isArray(json) ? parseObject(json) : { kind: "inbound" };
}

function parseObject(obj: object): ParsedDispatch {
  const candidate = obj as Record<string, unknown>;
  // No bot version at all means an inbound dispatch rule; a partial outbound payload is a bug worth failing loudly.
  if (candidate["botVersionId"] === undefined && candidate["conversationId"] === undefined) return { kind: "inbound" };
  return { kind: "outbound", dispatch: OutboundDispatch.parse(candidate) };
}
