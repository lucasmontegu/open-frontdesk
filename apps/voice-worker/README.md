# @ofd/voice-worker

LiveKit agent worker (`ofd-voice`) built on `@mastra/livekit`: STT -> Mastra agent -> TTS cascade. The design choice is documented at the top of `src/main.ts`: `createLiveKitWorker({ agent: resolver })` builds the bot version's agent per call, so no agent is registered up front.

Per call:

- **Outbound** (dispatch metadata `{orgId, botVersionId, conversationId, context}` written by `LiveKitTelephonyProvider.dial`): the contact comes from `context.contactId`, or from the conversation's `conversation.started` event.
- **Inbound SIP**: the caller is read from the SIP participant (`sip.phoneNumber`), looked up through contact identities (both `+549...` and `+54...` forms). The bot is `OFD_INBOUND_BOT_VERSION_ID` in `OFD_INBOUND_ORG_ID` (TODO: route by dialed number). Unknown callers are answered without a profile.
- The profile is preloaded with `ProfileLoader`, the agent built with `createFrontDeskAgent` (gateway with built-in tools, org + pack policies, memory with `resourceId = contactId`).
- STT, TTS and turn detection come from the bot version's `voice` config (`deepgram/...` and `cartesia/...` use the self-hosted plugins with `DEEPGRAM_API_KEY` / `CARTESIA_API_KEY`). Tool feedback is "Dame un segundo que lo reviso."
- Events: `customer.message` / `agent.message` per turn, `conversation.started` (inbound), `conversation.ended` and a `conversation.extract_facts` job at the end.

```
pnpm --filter @ofd/voice-worker build
pnpm --filter @ofd/voice-worker download-files   # once: turn detector + VAD models
pnpm --filter @ofd/voice-worker start            # needs LIVEKIT_URL/API_KEY/API_SECRET and the rest of @ofd/infra's env
```
