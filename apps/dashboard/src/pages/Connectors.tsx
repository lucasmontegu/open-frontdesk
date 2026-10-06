import { useQuery } from "@tanstack/react-query";
import { CheckIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { botColor } from "@/components/bot-avatar";
import {
  EmptyState,
  ErrorNote,
  PageHeader,
  Panel,
  RowsLoading,
  StatusPill,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { t } from "@/i18n";
import { api, type IntegrationDto } from "@/lib/api";

const ORDER: IntegrationDto["category"][] = ["models", "voice", "messaging", "crm", "calendar"];

function Mark({ item }: { item: IntegrationDto }) {
  return (
    <span
      className="flex size-11 shrink-0 items-center justify-center rounded-2xl font-semibold text-lg text-white"
      style={{ background: botColor(item.id) }}
      aria-hidden
    >
      {item.name[0]}
    </span>
  );
}

function ConnectorRow({ item, onOpen }: { item: IntegrationDto; onOpen: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-background p-3.5">
      <Mark item={item} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{item.name}</p>
        <p className="line-clamp-1 text-muted-foreground text-sm">
          {t.connectors.descriptions[item.id] ?? ""}
        </p>
      </div>
      {item.status === "connected" ? (
        <span className="flex items-center gap-1 px-2 font-medium text-sm text-success">
          <CheckIcon className="size-4" />
          {t.connectors.connected}
        </span>
      ) : item.status === "coming_soon" ? (
        <StatusPill>{t.connectors.comingSoon}</StatusPill>
      ) : (
        <Button variant="secondary" size="sm" onClick={onOpen}>
          {t.connectors.howTo}
        </Button>
      )}
    </div>
  );
}

export function ConnectorsPage() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<IntegrationDto | null>(null);
  const q = useQuery({ queryKey: ["integrations"], queryFn: api.integrations.list });
  const items = q.data?.items ?? [];
  const needle = query.trim().toLowerCase();
  const filtered = items.filter(
    (i) =>
      !needle ||
      i.name.toLowerCase().includes(needle) ||
      (t.connectors.descriptions[i.id] ?? "").toLowerCase().includes(needle),
  );
  const connected = items.filter((i) => i.status === "connected");

  return (
    <>
      <PageHeader
        title={t.connectors.title}
        subtitle={t.connectors.subtitle}
        actions={
          connected.length > 0 && (
            <span className="flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-sm">
              <span className="flex -space-x-2">
                {connected.slice(0, 4).map((i) => (
                  <span
                    key={i.id}
                    className="flex size-6 items-center justify-center rounded-full border-2 border-muted font-semibold text-[10px] text-white"
                    style={{ background: botColor(i.id) }}
                  >
                    {i.name[0]}
                  </span>
                ))}
              </span>
              {t.connectors.installed(connected.length)}
            </span>
          )
        }
      />
      <InputGroup className="mb-6 h-12 rounded-full bg-muted/70">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          aria-label={t.connectors.search}
          placeholder={t.connectors.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </InputGroup>
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? (
        <RowsLoading />
      ) : filtered.length === 0 ? (
        <EmptyState className="bg-muted/70" icon={SearchIcon} title={t.connectors.noResults} />
      ) : (
        <div className="flex flex-col gap-6">
          {ORDER.map((cat) => {
            const group = filtered.filter((i) => i.category === cat);
            if (group.length === 0) return null;
            return (
              <Panel key={cat} title={t.connectors.categories[cat]}>
                <div className="grid gap-1.5 md:grid-cols-2">
                  {group.map((i) => (
                    <ConnectorRow key={i.id} item={i} onOpen={() => setOpen(i)} />
                  ))}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          {open && (
            <>
              <DialogHeader className="flex-row items-center gap-3">
                <Mark item={open} />
                <div>
                  <DialogTitle>{open.name}</DialogTitle>
                  <DialogDescription>{t.connectors.descriptions[open.id]}</DialogDescription>
                </div>
              </DialogHeader>
              <div className="rounded-2xl bg-muted/70 p-4">
                <p className="mb-3 text-muted-foreground text-sm">{t.connectors.howToHint}</p>
                <pre className="overflow-x-auto rounded-xl bg-hero p-3 font-mono text-hero-foreground text-xs leading-relaxed">
                  {open.env.map((e) => `${e}=`).join("\n")}
                </pre>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
