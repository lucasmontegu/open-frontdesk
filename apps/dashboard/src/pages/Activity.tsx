import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { EventsTable } from "../components/EventsTable";
import { Button, Card, EmptyState, ErrorNote, Loading, PageHeader } from "../components/ui";
import { t } from "../i18n";
import { api } from "../lib/api";

export function ActivityPage() {
  const [onlyRefused, setOnlyRefused] = useState(false);
  const q = useInfiniteQuery({
    queryKey: ["events", "audit", onlyRefused],
    queryFn: ({ pageParam }) =>
      api.events.list({
        limit: 50,
        cursor: pageParam,
        type: onlyRefused ? "tool.refused" : undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const all = q.data?.pages.flatMap((p) => p.items) ?? [];
  const events = onlyRefused ? all.filter((e) => e.type === "tool.refused") : all;

  return (
    <>
      <PageHeader
        title={t.activity.title}
        subtitle={t.activity.subtitle}
        actions={
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyRefused}
              onChange={(e) => setOnlyRefused(e.target.checked)}
              className="size-4 accent-[var(--accent)]"
            />
            {t.activity.onlyRefused}
          </label>
        }
      />
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      <Card>
        {q.isLoading ? (
          <Loading />
        ) : events.length === 0 ? (
          <EmptyState title={t.activity.empty} />
        ) : (
          <EventsTable events={events} />
        )}
        {q.hasNextPage && (
          <div className="mt-4 text-center">
            <Button
              variant="secondary"
              disabled={q.isFetchingNextPage}
              onClick={() => q.fetchNextPage()}
            >
              {t.common.loadMore}
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
