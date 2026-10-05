import { useInfiniteQuery } from "@tanstack/react-query";
import { ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { EmptyState, ErrorNote, PageHeader, Panel, RowsLoading } from "@/components/common";
import { EventList } from "@/components/events";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { t } from "@/i18n";
import { api } from "@/lib/api";

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
          <ToggleGroup
            type="single"
            value={onlyRefused ? "refused" : "all"}
            onValueChange={(v) => v && setOnlyRefused(v === "refused")}
            className="rounded-full bg-muted p-1"
          >
            {(
              [
                ["all", t.activity.all],
                ["refused", t.activity.onlyRefused],
              ] as const
            ).map(([v, label]) => (
              <ToggleGroupItem
                key={v}
                value={v}
                className="h-9 rounded-full! px-4 text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
              >
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      <Panel>
        {q.isLoading ? (
          <RowsLoading rows={6} />
        ) : events.length === 0 ? (
          <EmptyState icon={ShieldCheckIcon} title={t.activity.empty} />
        ) : (
          <EventList events={events} />
        )}
        {q.hasNextPage && (
          <div className="py-2 text-center">
            <Button
              variant="outline"
              disabled={q.isFetchingNextPage}
              onClick={() => q.fetchNextPage()}
            >
              {t.common.loadMore}
            </Button>
          </div>
        )}
      </Panel>
    </>
  );
}
