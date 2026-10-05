import {
  type BotRepository,
  type BotVersion,
  type Clock,
  type Contact,
  type ContactRepository,
  type ConversationRepository,
  type EventStore,
  type JobQueue,
  type MissionPlan,
  type MissionRepository,
  OrgId,
  type ProfileLoader,
  type TelephonyProvider,
  type ToolCallContext,
  type ToolGateway,
} from "@ofd/core";
import { z } from "zod";
import { appendSystemEvent, type Log, PermanentJobError, silentLog, systemClock } from "../deps.js";
import type { MessageComposer } from "../message-composer.js";
import { updateTargetStatus } from "../mission-report.js";
import { contactSingletonKey } from "./mission-execute.js";

/** MissionContactJob from @ofd/agent plus the worker's own follow-up fields. */
export const MissionContactJobSchema = z.object({
  orgId: z.string().min(1),
  missionId: z.string().nullable(),
  botId: z.string().nullable(),
  contactId: z.string().min(1),
  channel: z.enum(["whatsapp", "voice"]),
  offer: z.record(z.string(), z.unknown()).default({}),
  reason: z.string().optional(),
  /** "first" starts a conversation; "check" evaluates the outcome of an earlier attempt. */
  attempt: z.enum(["first", "check"]).default("first"),
  stage: z.enum(["first", "fallback"]).default("first"),
  /** ISO time the checked attempt started: replies before it do not count. */
  since: z.string().optional(),
});
export type MissionContactJobData = z.infer<typeof MissionContactJobSchema>;

/** How long a voice fallback call gets before the target is settled. */
export const VOICE_WAIT_MINUTES = 60;
/** Settling delay when the plan has no fallback. */
export const DEFAULT_CHECK_MINUTES = 24 * 60;

export interface MissionContactDeps {
  missions: MissionRepository;
  bots: BotRepository;
  contacts: ContactRepository;
  profiles: ProfileLoader;
  conversations: ConversationRepository;
  events: EventStore;
  jobs: JobQueue;
  gateway: ToolGateway;
  telephony: TelephonyProvider;
  compose: MessageComposer;
  clock?: Clock;
  log?: Log;
}

type Strategy = MissionPlan["channelStrategy"];

async function resolveVersion(
  deps: MissionContactDeps,
  orgId: string,
  ref: string,
): Promise<BotVersion | null> {
  // Callbacks scheduled by the agent carry a bot version id, missions a bot id.
  const bot = await deps.bots.get(orgId, ref);
  if (bot)
    return bot.publishedVersionId ? deps.bots.getVersion(orgId, bot.publishedVersionId) : null;
  return deps.bots.getVersion(orgId, ref);
}

const phoneFor = (c: Contact) =>
  c.identities.find((i) => i.kind === "phone")?.value ??
  c.identities.find((i) => i.kind === "whatsapp")?.value ??
  null;

export async function missionContact(deps: MissionContactDeps, data: unknown): Promise<void> {
  const job = MissionContactJobSchema.parse(data);
  const log = deps.log ?? silentLog;
  const clock = deps.clock ?? systemClock;

  const mission = job.missionId ? await deps.missions.get(job.orgId, job.missionId) : null;
  if (job.missionId && !mission) throw new PermanentJobError(`mission ${job.missionId} not found`);
  if (
    mission &&
    (mission.status === "cancelled" ||
      mission.status === "completed" ||
      mission.status === "failed")
  ) {
    log.info({ missionId: job.missionId, status: mission.status }, "mission.contact skipped");
    return;
  }

  const ref = job.botId ?? mission?.botId;
  const version = ref ? await resolveVersion(deps, job.orgId, ref) : null;
  const settle = async (status: "succeeded" | "no_answer" | "failed" | "contacted") => {
    if (job.missionId)
      await updateTargetStatus(deps, job.orgId, job.missionId, job.contactId, status);
  };
  if (!version) {
    log.error({ ...job }, "mission.contact: no published bot version");
    await settle("failed");
    return;
  }

  const contact = await deps.contacts.get(job.orgId, job.contactId);
  if (!contact) {
    log.error({ contactId: job.contactId }, "mission.contact: contact not found");
    await settle("failed");
    return;
  }

  const strategy: Strategy = mission?.plan?.channelStrategy ?? {
    first: job.channel,
    fallbackAfterMinutes: null,
  };

  if (job.attempt === "check") {
    const since = job.since ? new Date(job.since) : new Date(0);
    const page = await deps.events.list(job.orgId, {
      contactId: job.contactId,
      types: ["customer.message"],
      limit: 50,
    });
    const replied = page.items.some((e) => e.occurredAt >= since);
    if (replied) return settle("succeeded");
    if (
      job.stage === "first" &&
      strategy.first === "whatsapp" &&
      strategy.fallbackAfterMinutes !== null
    ) {
      await attempt(deps, job, version, contact, "voice", strategy, clock, log);
      return;
    }
    return settle("no_answer");
  }

  if (contact.doNotCall) {
    log.warn({ contactId: contact.id }, "mission.contact: contact is do-not-call");
    return settle("failed");
  }
  await attempt(deps, job, version, contact, job.channel, strategy, clock, log);
}

/** One outbound attempt on a channel, then the follow-up check that decides the target's final status. */
async function attempt(
  deps: MissionContactDeps,
  job: MissionContactJobData,
  version: BotVersion,
  contact: Contact,
  channel: "whatsapp" | "voice",
  strategy: Strategy,
  clock: Clock,
  log: Log,
): Promise<void> {
  const orgId = job.orgId;
  const startedAt = clock.now();
  const conversation = await deps.conversations.start(orgId, {
    channel,
    contactId: contact.id,
    botVersionId: version.id,
    direction: "outbound",
    missionId: job.missionId,
  });
  await appendSystemEvent(deps.events, {
    orgId,
    type: "conversation.started",
    payload: {
      channel,
      contactId: contact.id,
      direction: "outbound",
      ...(job.missionId ? { missionId: job.missionId } : {}),
    },
    conversationId: conversation.id,
    botVersionId: version.id,
    contactId: contact.id,
    actorId: "mission.contact",
  });

  const fail = async (outcome: string, detail: unknown) => {
    log.warn({ contactId: contact.id, channel, outcome, detail }, "mission.contact attempt failed");
    await deps.conversations.end(orgId, conversation.id, outcome);
    if (job.missionId) await updateTargetStatus(deps, orgId, job.missionId, contact.id, "failed");
  };

  try {
    if (channel === "whatsapp") {
      const profile = await deps.profiles.load(orgId, contact.id);
      const text = await deps.compose({
        orgId,
        version,
        contact,
        profile,
        conversationId: conversation.id,
        offer: job.offer,
        ...(job.reason ? { reason: job.reason } : {}),
      });
      const ctx: ToolCallContext = {
        orgId,
        actor: {
          kind: "bot",
          id: version.botId,
          orgId: OrgId.parse(orgId),
          botVersionId: version.id,
        },
        conversationId: conversation.id,
        contactId: contact.id,
        botVersionId: version.id,
        autonomy: version.config.autonomy,
        initiator: "mission",
        traceId: null,
      };
      const res = await deps.gateway.call("send_whatsapp", { text }, ctx);
      if (!res.ok)
        return await fail(
          res.refused ? "refused" : "send_failed",
          res.refused ? res.reason : res.error,
        );
      await deps.events.append({
        orgId,
        type: "agent.message",
        payload: { text },
        conversationId: conversation.id,
        botVersionId: version.id,
        contactId: contact.id,
        actorKind: "bot",
        actorId: version.botId,
        traceId: null,
      });
    } else {
      const to = phoneFor(contact);
      if (!to) return await fail("no_phone", "contact has no phone");
      await deps.telephony.dial({
        orgId,
        to,
        botVersionId: version.id,
        conversationId: conversation.id,
        context: {
          contactId: contact.id,
          missionId: job.missionId,
          offer: job.offer,
          ...(job.reason ? { reason: job.reason } : {}),
        },
      });
    }
  } catch (err) {
    return await fail("error", err instanceof Error ? err.message : String(err));
  }

  if (!job.missionId) return; // a callback has no plan to settle
  await updateTargetStatus(deps, orgId, job.missionId, contact.id, "contacted");
  const first = channel === strategy.first;
  const minutes =
    channel === "voice"
      ? VOICE_WAIT_MINUTES
      : (strategy.fallbackAfterMinutes ?? DEFAULT_CHECK_MINUTES);
  const stage =
    first && channel === "whatsapp" && strategy.fallbackAfterMinutes !== null
      ? "first"
      : "fallback";
  const next: MissionContactJobData = {
    ...job,
    channel,
    attempt: "check",
    stage,
    since: startedAt.toISOString(),
  };
  await deps.jobs.enqueue("mission.contact", next, {
    startAfterSeconds: minutes * 60,
    singletonKey: `${contactSingletonKey(job.missionId, contact.id)}:check:${stage}`,
  });
}
