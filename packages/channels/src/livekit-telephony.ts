import { AgentDispatchClient, RoomServiceClient, SipClient } from "livekit-server-sdk";
import type { TelephonyProvider } from "@ofd/core";

export const VOICE_AGENT_NAME = "ofd-voice";

/** The subset of the livekit-server-sdk clients we use, so tests can fake them. */
export interface LiveKitClients {
  rooms: Pick<RoomServiceClient, "createRoom">;
  dispatch: Pick<AgentDispatchClient, "createDispatch">;
  sip: Pick<SipClient, "createSipParticipant">;
}

export interface LiveKitTelephonyOptions {
  /** LiveKit server URL (ws:// or http(s)://; the SDK accepts both). */
  url: string;
  apiKey: string;
  apiSecret: string;
  /** Outbound SIP trunk id configured in LiveKit. */
  sipTrunkId: string;
  clients?: LiveKitClients;
}

/** Metadata the voice worker receives in the agent job. */
export interface VoiceDispatchMetadata {
  orgId: string;
  botVersionId: string;
  conversationId: string;
  context: Record<string, unknown>;
}

export class LiveKitTelephonyProvider implements TelephonyProvider {
  readonly id = "livekit";
  private readonly clients: LiveKitClients;

  constructor(private readonly opts: LiveKitTelephonyOptions) {
    this.clients = opts.clients ?? {
      rooms: new RoomServiceClient(opts.url, opts.apiKey, opts.apiSecret),
      dispatch: new AgentDispatchClient(opts.url, opts.apiKey, opts.apiSecret),
      sip: new SipClient(opts.url, opts.apiKey, opts.apiSecret),
    };
  }

  async dial(input: { orgId: string; to: string; botVersionId: string; conversationId: string; context?: Record<string, unknown> }): Promise<{ callId: string }> {
    const room = input.conversationId;
    await this.clients.rooms.createRoom({ name: room, emptyTimeout: 60, departureTimeout: 20 });

    const metadata: VoiceDispatchMetadata = {
      orgId: input.orgId,
      botVersionId: input.botVersionId,
      conversationId: input.conversationId,
      context: input.context ?? {},
    };
    await this.clients.dispatch.createDispatch(room, VOICE_AGENT_NAME, { metadata: JSON.stringify(metadata) });

    const participant = await this.clients.sip.createSipParticipant(this.opts.sipTrunkId, input.to, room, {
      participantIdentity: `sip-${input.conversationId}`,
      participantName: input.to,
      participantAttributes: { "ofd.orgId": input.orgId, "ofd.conversationId": input.conversationId },
    });
    return { callId: participant.sipCallId || participant.participantId };
  }
}
