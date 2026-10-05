import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import {
  BrainIcon,
  ChevronRightIcon,
  FileUpIcon,
  MailIcon,
  MessagesSquareIcon,
  PhoneIcon,
  SearchIcon,
  UploadIcon,
  UsersIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import {
  EmptyState,
  ErrorNote,
  PageHeader,
  PageLoading,
  Panel,
  PanelRow,
  RowsLoading,
  StatusPill,
} from "@/components/common";
import { ConversationView, EventList } from "@/components/events";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { api, type ContactDto } from "@/lib/api";
import { formatArs, formatDate, formatPhone } from "@/lib/format";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function identity(c: ContactDto, kind: "phone" | "whatsapp" | "email"): string | null {
  const found =
    c.identities.find((i) => i.kind === kind) ??
    (kind === "phone" ? c.identities.find((i) => i.kind === "whatsapp") : undefined);
  return found ? found.value : null;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/** A small CSV with the headers operators usually export, for trying the flow end to end. */
function sampleCsv(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const tomorrow = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  return [
    "nombre,telefono,email,dni,monto,vencimiento,etapa,tipo,etiquetas",
    `Ana Pérez,11 5555-0101,ana@example.com,30111001,,${tomorrow},confirmado,turno,paciente`,
    `Juan Gómez,11 5555-0102,juan@example.com,28222002,"45.000,00",15/08/2026,mora,deuda,cliente`,
    `María López,351 555-0103,maria@example.com,33444003,,${tomorrow},pendiente,turno,paciente`,
    `Carlos Díaz,11 5555-0104,carlos@example.com,27555004,"120.500,00",01/07/2026,mora,deuda,cliente`,
  ].join("\n");
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState("");
  const m = useMutation({
    mutationFn: () => api.contacts.import(csv),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });

  const onFile = async (file: File | undefined) => {
    if (file) setCsv(await file.text());
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="text-xl">{t.contacts.importTitle}</DialogTitle>
            <DialogDescription>{t.contacts.importHelp}</DialogDescription>
          </DialogHeader>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed bg-muted/50 p-6 text-center text-sm transition-colors hover:bg-muted">
            <FileUpIcon className="size-6 text-muted-foreground" />
            <span className="font-medium">{t.contacts.importFile}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="csv">{t.contacts.importText}</Label>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0"
                onClick={() => setCsv(sampleCsv())}
              >
                {t.contacts.sample}
              </Button>
            </div>
            <Textarea
              id="csv"
              rows={7}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              className="max-h-64 font-mono text-xs"
              required
            />
          </div>
          {m.error && <ErrorNote error={m.error} />}
          {m.data && (
            <div
              role="status"
              className="rounded-2xl bg-success-soft px-4 py-3 text-sm text-success"
            >
              {t.contacts.importDone(m.data.created, m.data.updated)}
              {m.data.errors && m.data.errors.length > 0 && (
                <>
                  <p className="mt-2 font-medium">{t.contacts.importErrors}</p>
                  <ul className="list-disc pl-5">
                    {m.data.errors.slice(0, 10).map((er) => (
                      <li key={er.row}>
                        {er.row}: {er.message}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.common.close}
            </Button>
            <Button type="submit" disabled={m.isPending || csv.trim() === ""}>
              <UploadIcon />
              {t.contacts.importSubmit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContactRow({ c }: { c: ContactDto }) {
  const phone = identity(c, "phone");
  const email = identity(c, "email");
  return (
    <Link
      to="/contacts/$contactId"
      params={{ contactId: c.id }}
      className="flex flex-wrap items-center gap-3 rounded-2xl bg-background p-3.5 transition-shadow hover:shadow-sm"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand text-sm">
        {initials(c.displayName)}
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <p className="flex items-center gap-2 truncate font-medium">
          {c.displayName}
          {c.doNotCall && <StatusPill tone="danger">{t.contacts.doNotCall}</StatusPill>}
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-muted-foreground text-xs">
          {phone && (
            <span className="flex items-center gap-1">
              <PhoneIcon className="size-3" />
              {formatPhone(phone)}
            </span>
          )}
          {email && (
            <span className="flex items-center gap-1">
              <MailIcon className="size-3" />
              {email}
            </span>
          )}
        </p>
      </div>
      <div className="flex flex-wrap gap-1">
        {c.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs"
          >
            {tag}
          </span>
        ))}
      </div>
      <ChevronRightIcon className="size-4 text-muted-foreground" />
    </Link>
  );
}

export function ContactsPage() {
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const q = useDebounced(search.trim(), 300);
  const list = useInfiniteQuery({
    queryKey: ["contacts", q],
    queryFn: ({ pageParam }) => api.contacts.list({ q, cursor: pageParam, limit: 25 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title={t.contacts.title}
        subtitle={t.contacts.subtitle}
        actions={
          <Button size="lg" onClick={() => setImporting(true)}>
            <UploadIcon />
            {t.contacts.import}
          </Button>
        }
      />
      <InputGroup className="mb-4 h-12 max-w-lg rounded-full bg-muted/70">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          aria-label={t.contacts.searchLabel}
          placeholder={t.contacts.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </InputGroup>
      {list.error && <ErrorNote error={list.error} onRetry={() => list.refetch()} />}
      <Panel>
        {list.isLoading ? (
          <RowsLoading />
        ) : items.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title={q ? t.contacts.noResults : t.contacts.empty}
            hint={q ? undefined : t.contacts.emptyHint}
            action={
              !q && (
                <Button onClick={() => setImporting(true)}>
                  <UploadIcon />
                  {t.contacts.import}
                </Button>
              )
            }
          />
        ) : (
          items.map((c) => <ContactRow key={c.id} c={c} />)
        )}
        {list.hasNextPage && (
          <div className="py-2 text-center">
            <Button
              variant="outline"
              disabled={list.isFetchingNextPage}
              onClick={() => list.fetchNextPage()}
            >
              {t.common.loadMore}
            </Button>
          </div>
        )}
      </Panel>
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </>
  );
}

function SourceDialog({
  conversationId,
  onClose,
}: {
  conversationId: string | null;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ["conversation-events", conversationId],
    queryFn: () => api.events.forConversation(conversationId as string),
    enabled: conversationId !== null,
  });
  return (
    <Dialog open={conversationId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.contacts.sourceTitle}</DialogTitle>
        </DialogHeader>
        {q.isLoading ? (
          <RowsLoading rows={3} />
        ) : q.error ? (
          <ErrorNote error={q.error} />
        ) : (
          <ConversationView events={q.data?.items ?? []} />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ContactDetailPage() {
  const { contactId } = useParams({ from: "/app/contacts/$contactId" });
  const [source, setSource] = useState<string | null>(null);
  const profile = useQuery({
    queryKey: ["contact", contactId],
    queryFn: () => api.contacts.get(contactId),
  });
  const timeline = useQuery({
    queryKey: ["events", "contact", contactId],
    queryFn: () => api.events.list({ contactId, limit: 50 }),
  });

  if (profile.isLoading) return <PageLoading />;
  if (profile.error || !profile.data)
    return <ErrorNote error={profile.error} onRetry={() => profile.refetch()} />;
  const { contact, obligations, facts, recentSummaries } = profile.data;
  const phone = identity(contact, "phone");
  const email = identity(contact, "email");
  // Defensive: if the API ignores the contactId filter, keep only this contact's events.
  const events = (timeline.data?.items ?? []).filter(
    (e) => e.contactId === null || e.contactId === contactId,
  );

  return (
    <>
      <PageHeader
        back="/contacts"
        eyebrow={`${t.contacts.title} / ${contact.displayName}`}
        title={
          <span className="flex items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand text-xl">
              {initials(contact.displayName)}
            </span>
            {contact.displayName}
          </span>
        }
        subtitle={[phone ? formatPhone(phone) : null, email].filter(Boolean).join(" · ")}
        actions={
          contact.doNotCall ? (
            <StatusPill tone="danger">{t.contacts.doNotCall}</StatusPill>
          ) : undefined
        }
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="flex flex-col gap-6 lg:col-span-3">
          <Panel title={t.contacts.obligations}>
            {obligations.length === 0 ? (
              <PanelRow className="text-muted-foreground text-sm">
                {t.contacts.noObligations}
              </PanelRow>
            ) : (
              obligations.map((o) => (
                <PanelRow key={o.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-sm">
                      {t.contacts.kinds[o.kind] ?? o.kind}
                    </span>
                    <span className="block text-muted-foreground text-xs">
                      {o.dueAt ? `${t.contacts.dueAt} ${formatDate(o.dueAt)}` : ""}
                    </span>
                  </span>
                  {o.amount !== null && (
                    <span className="font-semibold tabular-nums">
                      {formatArs(o.amount, o.currency)}
                    </span>
                  )}
                  <StatusPill>{o.stage}</StatusPill>
                </PanelRow>
              ))
            )}
          </Panel>
          <Panel title={t.contacts.timeline}>
            {timeline.isLoading ? (
              <RowsLoading rows={3} />
            ) : events.length === 0 ? (
              <PanelRow className="text-muted-foreground text-sm">{t.contacts.noTimeline}</PanelRow>
            ) : (
              <EventList events={events} />
            )}
          </Panel>
        </div>
        <Panel className="lg:col-span-2 lg:self-start" title={t.contacts.facts}>
          {facts.length === 0 ? (
            <PanelRow className="text-muted-foreground text-sm">{t.contacts.noFacts}</PanelRow>
          ) : (
            facts.map((f) => (
              <PanelRow key={f.id} className="py-3">
                <p className="flex items-start gap-2 text-sm">
                  <BrainIcon className="mt-0.5 size-4 shrink-0 text-brand" />
                  <span>
                    <span className="font-medium">{f.key}:</span> {f.value}
                  </span>
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                  <span>{t.contacts.confidence(Math.round(f.confidence * 100))}</span>
                  <span>·</span>
                  <span>{formatDate(f.createdAt)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 px-2 text-xs"
                    onClick={() => setSource(f.sourceConversationId)}
                  >
                    <MessagesSquareIcon />
                    {t.contacts.viewSource}
                  </Button>
                </div>
              </PanelRow>
            ))
          )}
          {recentSummaries.length > 0 && (
            <PanelRow>
              <h3 className="mb-2 font-medium text-sm">{t.contacts.summaries}</h3>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground text-sm">
                {recentSummaries.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </PanelRow>
          )}
        </Panel>
      </div>
      <SourceDialog conversationId={source} onClose={() => setSource(null)} />
    </>
  );
}
