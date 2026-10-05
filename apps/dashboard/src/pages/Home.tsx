import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { EventsTable } from "../components/EventsTable";
import { Badge, Card, EmptyState, ErrorNote, Loading, PageHeader } from "../components/ui";
import { t } from "../i18n";
import { api } from "../lib/api";
import { isSameDayAr, shortId } from "../lib/format";

export function HomePage() {
  const events = useQuery({
    queryKey: ["events", "recent"],
    queryFn: () => api.events.list({ limit: 100 }),
    refetchInterval: 15_000,
  });
  const missions = useQuery({
    queryKey: ["missions"],
    queryFn: api.missions.list,
    refetchInterval: 15_000,
  });

  const today = (events.data?.items ?? []).filter(
    (e) => e.type === "conversation.started" && isSameDayAr(e.occurredAt),
  ).length;
  const active = (missions.data?.items ?? []).filter((m) =>
    ["planning", "awaiting_approval", "running"].includes(m.status),
  );

  return (
    <>
      <PageHeader title={t.home.title} subtitle={t.home.subtitle} />
      {(events.error || missions.error) && <ErrorNote error={events.error ?? missions.error} />}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card title={t.home.conversationsToday}>
          <p className="text-4xl font-semibold">{events.isLoading ? "…" : today}</p>
        </Card>
        <Card
          title={t.home.activeMissions}
          actions={
            <Link to="/misiones" className="text-sm text-accent underline">
              {t.home.viewAll}
            </Link>
          }
        >
          {active.length === 0 ? (
            <p className="text-sm text-muted">{t.home.noMissions}</p>
          ) : (
            <ul className="space-y-2">
              {active.slice(0, 5).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                  <Link
                    to="/misiones/$missionId"
                    params={{ missionId: m.id }}
                    className="min-w-0 truncate underline"
                  >
                    {m.instruction || shortId(m.id)}
                  </Link>
                  <Badge tone="accent">{t.missions.statuses[m.status] ?? m.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card
        title={t.home.recentEvents}
        className="mt-4"
        actions={
          <Link to="/actividad" className="text-sm text-accent underline">
            {t.home.viewAll}
          </Link>
        }
      >
        {events.isLoading ? (
          <Loading />
        ) : (events.data?.items.length ?? 0) === 0 ? (
          <EmptyState title={t.home.noEvents} />
        ) : (
          <EventsTable events={events.data?.items.slice(0, 8) ?? []} />
        )}
      </Card>
    </>
  );
}
