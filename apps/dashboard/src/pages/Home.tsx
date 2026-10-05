import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, CheckIcon, ChevronRightIcon, InboxIcon } from "lucide-react";
import { BotAvatar } from "@/components/bot-avatar";
import {
  EmptyState,
  ErrorNote,
  Panel,
  RowsLoading,
  StatStrip,
  StatusPill,
} from "@/components/common";
import { EventList } from "@/components/events";
import { MissionComposer } from "@/components/mission-composer";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api, type EventDto } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { formatDate, isSameDayAr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { missionTone } from "./Missions";

function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12
    ? t.home.greeting.morning
    : h < 20
      ? t.home.greeting.afternoon
      : t.home.greeting.evening;
}

/** Events per Buenos Aires day for the last 14 days, split into refused and the rest. */
export function dailyActivity(events: Pick<EventDto, "type" | "occurredAt">[], now = new Date()) {
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (13 - i));
    return { key: formatDate(d), date: d, total: 0, refused: 0 };
  });
  const byKey = new Map(days.map((d) => [d.key, d]));
  for (const e of events) {
    const day = byKey.get(formatDate(e.occurredAt));
    if (!day) continue;
    day.total += 1;
    if (e.type === "tool.refused") day.refused += 1;
  }
  return days;
}

function ActivityChart({ events }: { events: EventDto[] }) {
  const days = dailyActivity(events);
  const max = Math.max(1, ...days.map((d) => d.total));
  return (
    <Panel
      title={t.home.chart}
      action={
        <div className="flex items-center gap-3 text-muted-foreground text-xs">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-foreground" />
            {t.home.chartAll}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-brand" />
            {t.home.chartRefused}
          </span>
        </div>
      }
    >
      <div className="rounded-2xl bg-background px-4 pt-5 pb-3">
        <div className="flex h-36 items-end gap-1.5">
          {days.map((d) => (
            <div
              key={d.key}
              className="group relative flex h-full flex-1 flex-col justify-end gap-1"
              title={`${d.key}: ${d.total} · ${d.refused}`}
            >
              {d.refused > 0 && (
                <span
                  className="w-full rounded-md bg-brand"
                  style={{ height: `${Math.max(6, (d.refused / max) * 100)}%` }}
                />
              )}
              <span
                className={cn(
                  "w-full rounded-md transition-colors",
                  d.total - d.refused > 0
                    ? "bg-foreground group-hover:bg-foreground/80"
                    : "bg-muted",
                )}
                style={{ height: `${Math.max(4, ((d.total - d.refused) / max) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
          <span>{days[0]?.key.slice(0, 5)}</span>
          <span>{days[7]?.key.slice(0, 5)}</span>
          <span>{days[13]?.key.slice(0, 5)}</span>
        </div>
      </div>
    </Panel>
  );
}

function SetupChecklist({ steps }: { steps: { done: boolean; label: string; to: string }[] }) {
  const next = steps.findIndex((s) => !s.done);
  if (next === -1) return null;
  return (
    <Panel title={t.home.setup} description={t.home.setupHint}>
      <ol className="flex flex-col gap-1.5">
        {steps.map((s, i) => (
          <li key={s.label}>
            <Link
              to={s.to}
              className={cn(
                "flex items-center gap-3 rounded-2xl bg-background p-3.5 transition-colors hover:bg-background/70",
                i === next && "ring-2 ring-brand/40",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border font-semibold text-sm",
                  s.done ? "border-success bg-success text-white" : "text-muted-foreground",
                )}
              >
                {s.done ? <CheckIcon className="size-4" /> : i + 1}
              </span>
              <span
                className={cn(
                  "flex-1 font-medium text-sm",
                  s.done && "text-muted-foreground line-through",
                )}
              >
                {s.label}
              </span>
              {s.done ? (
                <span className="text-muted-foreground text-xs">{t.home.done}</span>
              ) : (
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              )}
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function HomePage() {
  const { data: session } = authClient.useSession();
  const events = useQuery({
    queryKey: ["events", "recent"],
    queryFn: () => api.events.list({ limit: 200 }),
    refetchInterval: 15_000,
  });
  const missions = useQuery({
    queryKey: ["missions"],
    queryFn: api.missions.list,
    refetchInterval: 15_000,
  });
  const bots = useQuery({ queryKey: ["bots"], queryFn: api.bots.list });
  const contacts = useQuery({
    queryKey: ["contacts", "any"],
    queryFn: () => api.contacts.list({ limit: 1 }),
  });

  const allEvents = events.data?.items ?? [];
  const todays = allEvents.filter((e) => isSameDayAr(e.occurredAt));
  const conversationsToday = todays.filter((e) => e.type === "conversation.started").length;
  const refusedToday = todays.filter((e) => e.type === "tool.refused").length;
  const missionItems = missions.data?.items ?? [];
  const active = missionItems.filter((m) =>
    ["planning", "awaiting_approval", "running"].includes(m.status),
  );
  const botItems = bots.data?.items ?? [];
  const published = botItems.filter((b) => b.publishedVersionId);
  const firstName = session?.user.name?.split(" ")[0];

  const loaded = bots.data && missions.data && contacts.data;
  const steps = [
    { done: botItems.length > 0, label: t.home.steps.bot, to: "/bots" },
    {
      done: published.length > 0,
      label: t.home.steps.publish,
      to: botItems[0] ? `/bots/${botItems[0].id}` : "/bots",
    },
    { done: (contacts.data?.items.length ?? 0) > 0, label: t.home.steps.contacts, to: "/contacts" },
    { done: missionItems.length > 0, label: t.home.steps.mission, to: "/missions" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-5 pt-2 md:pt-6">
        <div className="text-center">
          <p className="font-medium text-muted-foreground text-sm">
            {greeting()}
            {firstName ? `, ${firstName}` : ""}
          </p>
          <h1 className="mt-1 text-balance font-semibold text-3xl tracking-tight md:text-[2.6rem]">
            {t.home.ask}
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-muted-foreground text-sm">{t.home.askHint}</p>
        </div>
        <div className="mx-auto w-full max-w-3xl">
          <MissionComposer />
        </div>
      </section>

      {(events.error || missions.error) && <ErrorNote error={events.error ?? missions.error} />}

      {loaded && <SetupChecklist steps={steps} />}

      <StatStrip
        stats={[
          { label: t.home.conversationsToday, value: events.isLoading ? "–" : conversationsToday },
          {
            label: t.home.activeMissions,
            value: missions.isLoading ? "–" : active.length,
            tone: active.some((m) => m.status === "awaiting_approval") ? "warning" : "default",
          },
          {
            label: t.home.refusedToday,
            value: events.isLoading ? "–" : refusedToday,
            hint: t.home.refusedHint,
            tone: refusedToday > 0 ? "brand" : "default",
          },
          {
            label: t.home.publishedBots,
            value: bots.isLoading ? "–" : published.length,
            hint: t.home.ofTotal(botItems.length),
            tone: "success",
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="flex flex-col gap-6 lg:col-span-3">
          <ActivityChart events={allEvents} />
          <Panel
            title={t.home.recent}
            description={t.home.recentHint}
            action={
              <Button asChild variant="ghost" size="sm">
                <Link to="/activity">
                  {t.common.viewAll}
                  <ArrowRightIcon />
                </Link>
              </Button>
            }
          >
            {events.isLoading ? (
              <RowsLoading />
            ) : allEvents.length === 0 ? (
              <EmptyState icon={InboxIcon} title={t.home.noEvents} />
            ) : (
              <EventList events={allEvents.slice(0, 6)} />
            )}
          </Panel>
        </div>
        <Panel
          className="lg:col-span-2 lg:self-start"
          title={t.home.activeMissions}
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/missions">
                {t.common.viewAll}
                <ArrowRightIcon />
              </Link>
            </Button>
          }
        >
          {missions.isLoading ? (
            <RowsLoading rows={3} />
          ) : active.length === 0 ? (
            <p className="rounded-2xl bg-background p-4 text-muted-foreground text-sm">
              {t.home.noMissions}
            </p>
          ) : (
            active.slice(0, 6).map((m) => (
              <Link
                key={m.id}
                to="/missions/$missionId"
                params={{ missionId: m.id }}
                className="flex items-start gap-3 rounded-2xl bg-background p-3.5 transition-shadow hover:shadow-sm"
              >
                <BotAvatar seed={m.botId} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 font-medium text-sm">{m.instruction}</p>
                  <div className="mt-2">
                    <StatusPill tone={missionTone(m.status)} pulse={m.status === "running"}>
                      {t.missions.statuses[m.status] ?? m.status}
                    </StatusPill>
                  </div>
                </div>
              </Link>
            ))
          )}
        </Panel>
      </div>
    </div>
  );
}
