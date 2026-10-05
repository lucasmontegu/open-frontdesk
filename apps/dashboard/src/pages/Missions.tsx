import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import {
  ClockIcon,
  MessageCircleIcon,
  PhoneIcon,
  RouteIcon,
  SendIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react";
import {
  Plan,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from "@/components/ai-elements/plan";
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemDescription,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from "@/components/ai-elements/queue";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { BotAvatar } from "@/components/bot-avatar";
import {
  EmptyState,
  ErrorNote,
  PageHeader,
  PageLoading,
  Panel,
  RowsLoading,
  StatStrip,
  StatusPill,
  type Tone,
} from "@/components/common";
import { MissionComposer } from "@/components/mission-composer";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api, type MissionDto } from "@/lib/api";
import { formatDateTime, formatMinutes, shortId } from "@/lib/format";
import { cn } from "@/lib/utils";

export const missionTone = (s: string): Tone =>
  s === "completed"
    ? "success"
    : s === "failed" || s === "cancelled"
      ? "danger"
      : s === "awaiting_approval"
        ? "warning"
        : "brand";

export function MissionsPage() {
  const missions = useQuery({
    queryKey: ["missions"],
    queryFn: api.missions.list,
    refetchInterval: 15_000,
  });
  const bots = useQuery({ queryKey: ["bots"], queryFn: api.bots.list });
  const botName = new Map((bots.data?.items ?? []).map((b) => [b.id, b.name]));
  const items = [...(missions.data?.items ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  return (
    <>
      <PageHeader title={t.missions.title} subtitle={t.missions.subtitle} />
      <div className="mb-8">
        <MissionComposer autoFocus />
      </div>
      {missions.error && <ErrorNote error={missions.error} onRetry={() => missions.refetch()} />}
      <Panel title={t.missions.list}>
        {missions.isLoading ? (
          <RowsLoading />
        ) : items.length === 0 ? (
          <EmptyState icon={SendIcon} title={t.missions.empty} hint={t.missions.emptyHint} />
        ) : (
          items.map((m) => (
            <Link
              key={m.id}
              to="/missions/$missionId"
              params={{ missionId: m.id }}
              className="flex flex-wrap items-center gap-3 rounded-2xl bg-background p-4 transition-shadow hover:shadow-sm"
            >
              <BotAvatar seed={m.botId} size={36} />
              <div className="min-w-0 flex-1 basis-60">
                <p className="line-clamp-1 font-medium">{m.instruction}</p>
                <p className="mt-0.5 text-muted-foreground text-xs">
                  {botName.get(m.botId) ?? shortId(m.botId)} · {formatDateTime(m.createdAt)}
                  {m.plan ? ` · ${m.plan.targets.length} ${t.missions.targets.toLowerCase()}` : ""}
                </p>
              </div>
              <StatusPill
                tone={missionTone(m.status)}
                pulse={m.status === "running" || m.status === "planning"}
              >
                {t.missions.statuses[m.status] ?? m.status}
              </StatusPill>
            </Link>
          ))
        )}
      </Panel>
    </>
  );
}

const POLLING: ReadonlySet<string> = new Set(["planning", "running"]);

export function shouldPoll(m: Pick<MissionDto, "status"> | undefined): boolean {
  return m === undefined || POLLING.has(m.status);
}

const DONE_TARGET = new Set(["succeeded", "no_answer", "escalated", "failed"]);

const targetTone: Record<string, string> = {
  succeeded: "border-success bg-success",
  failed: "border-destructive bg-destructive",
  escalated: "border-warning bg-warning",
  no_answer: "border-muted-foreground/40 bg-muted-foreground/30",
  contacted: "border-brand bg-brand/30 animate-pulse",
};

export function MissionDetailPage() {
  const { missionId } = useParams({ from: "/app/missions/$missionId" });
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["mission", missionId],
    queryFn: () => api.missions.get(missionId),
    refetchInterval: (query) => (shouldPoll(query.state.data) ? 2500 : false),
  });
  const bots = useQuery({ queryKey: ["bots"], queryFn: api.bots.list });
  const approve = useMutation({
    mutationFn: () => api.missions.approve(missionId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["mission", missionId] });
      await qc.invalidateQueries({ queryKey: ["missions"] });
    },
  });

  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const m = q.data;
  const { plan, report } = m;
  const bot = bots.data?.items.find((b) => b.id === m.botId);
  const names = m.targetNames ?? {};
  const channelName = (c: string) => t.missions.channels[c] ?? c;
  const pending = plan?.targets.filter((x) => !DONE_TARGET.has(x.status)) ?? [];
  const finished = plan?.targets.filter((x) => DONE_TARGET.has(x.status)) ?? [];

  const targetRow = (x: NonNullable<typeof plan>["targets"][number]) => {
    const done = DONE_TARGET.has(x.status);
    const offer = Object.entries(x.offer)
      .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" · ");
    return (
      <QueueItem key={x.contactId} className="rounded-xl py-2">
        <div className="flex items-center gap-2">
          <QueueItemIndicator completed={done} className={cn("size-3", targetTone[x.status])} />
          <QueueItemContent completed={false} className="text-foreground">
            <Link
              to="/contacts/$contactId"
              params={{ contactId: x.contactId }}
              className="font-medium hover:underline"
            >
              {names[x.contactId] ?? shortId(x.contactId)}
            </Link>
          </QueueItemContent>
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
            {x.channel === "voice" ? (
              <PhoneIcon className="size-3.5" />
            ) : (
              <MessageCircleIcon className="size-3.5" />
            )}
            {channelName(x.channel)} · {t.missions.targetStatuses[x.status] ?? x.status}
          </span>
        </div>
        {offer && <QueueItemDescription className="font-mono">{offer}</QueueItemDescription>}
      </QueueItem>
    );
  };

  return (
    <>
      <PageHeader
        back="/missions"
        eyebrow={
          <span className="flex items-center gap-1.5">
            {t.missions.title} / {bot?.name ?? shortId(m.botId)}
          </span>
        }
        title={m.instruction}
        subtitle={formatDateTime(m.createdAt)}
        actions={
          <StatusPill
            tone={missionTone(m.status)}
            pulse={POLLING.has(m.status)}
            className="px-3 py-1.5 text-sm"
          >
            {t.missions.statuses[m.status] ?? m.status}
          </StatusPill>
        }
      />

      <div className="flex flex-col gap-6">
        {m.status === "planning" && !plan && (
          <div className="rounded-3xl bg-muted/70 p-6">
            <Shimmer as="p" className="font-medium text-lg">
              {t.missions.planning}
            </Shimmer>
            <p className="mt-1 text-muted-foreground text-sm">{t.missions.planningHint}</p>
          </div>
        )}

        {m.status === "awaiting_approval" && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-hero p-5 text-hero-foreground md:p-6">
            <div className="flex items-start gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand text-brand-foreground">
                <ShieldCheckIcon className="size-6" />
              </span>
              <div>
                <p className="font-semibold text-lg">{t.missions.awaitingTitle}</p>
                <p className="text-hero-foreground/70 text-sm">{t.missions.awaitingHint}</p>
              </div>
            </div>
            <Button
              size="lg"
              variant="secondary"
              disabled={approve.isPending}
              onClick={() => approve.mutate()}
            >
              <SendIcon />
              {approve.isPending ? t.missions.approving : t.missions.approve}
            </Button>
          </div>
        )}
        {approve.error && <ErrorNote error={approve.error} />}

        {report && (
          <StatStrip
            stats={[
              { label: t.missions.total, value: report.total },
              { label: t.missions.succeeded, value: report.succeeded, tone: "success" },
              { label: t.missions.noAnswer, value: report.noAnswer },
              { label: t.missions.escalated, value: report.escalated, tone: "warning" },
              { label: t.missions.failed, value: report.failed, tone: "danger" },
            ]}
            bar={[
              { value: report.succeeded, tone: "success" },
              { value: report.noAnswer, tone: "default" },
              { value: report.escalated, tone: "warning" },
              { value: report.failed, tone: "danger" },
            ]}
          />
        )}

        {plan && (
          <Plan defaultOpen className="gap-4 rounded-3xl border-0 bg-muted/70 py-5">
            <PlanHeader className="px-5">
              <div>
                <PlanTitle>{t.missions.plan}</PlanTitle>
                <PlanDescription className="text-balance text-foreground">
                  {plan.summary}
                </PlanDescription>
              </div>
              <PlanTrigger />
            </PlanHeader>
            <PlanContent className="space-y-4 px-2">
              <dl className="grid gap-1.5 sm:grid-cols-3">
                {[
                  {
                    icon: UsersIcon,
                    label: t.missions.targets,
                    value: String(plan.targets.length),
                  },
                  {
                    icon: ClockIcon,
                    label: t.missions.estimate,
                    value: formatMinutes(plan.estimatedMinutes),
                  },
                  {
                    icon: RouteIcon,
                    label: t.missions.strategy,
                    value: t.missions.strategyText(
                      channelName(plan.channelStrategy.first),
                      plan.channelStrategy.fallbackAfterMinutes,
                    ),
                  },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="rounded-2xl bg-background p-4">
                    <dt className="flex items-center gap-1.5 text-muted-foreground text-xs">
                      <Icon className="size-3.5" />
                      {label}
                    </dt>
                    <dd className="mt-1 font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              <Queue className="rounded-2xl border-0 bg-background shadow-none">
                {pending.length > 0 && (
                  <QueueSection defaultOpen>
                    <QueueSectionTrigger>
                      <QueueSectionLabel count={pending.length} label={t.missions.pendingTargets} />
                    </QueueSectionTrigger>
                    <QueueSectionContent>
                      <QueueList>{pending.slice(0, 100).map(targetRow)}</QueueList>
                    </QueueSectionContent>
                  </QueueSection>
                )}
                {finished.length > 0 && (
                  <QueueSection defaultOpen>
                    <QueueSectionTrigger>
                      <QueueSectionLabel count={finished.length} label={t.missions.doneTargets} />
                    </QueueSectionTrigger>
                    <QueueSectionContent>
                      <QueueList>{finished.slice(0, 100).map(targetRow)}</QueueList>
                    </QueueSectionContent>
                  </QueueSection>
                )}
              </Queue>
            </PlanContent>
          </Plan>
        )}
      </div>
    </>
  );
}
