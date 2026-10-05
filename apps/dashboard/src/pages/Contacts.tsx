import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { EventsTable } from "../components/EventsTable";
import { Badge, Button, Card, Dialog, EmptyState, ErrorNote, Input, Loading, PageHeader, Table, Td, Textarea, Th } from "../components/ui";
import { t } from "../i18n";
import { type ContactDto, api } from "../lib/api";
import { formatArs, formatDate, formatPhone } from "../lib/format";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function identity(c: ContactDto, kind: "phone" | "whatsapp" | "email"): string | null {
  const found = c.identities.find((i) => i.kind === kind) ?? (kind === "phone" ? c.identities.find((i) => i.kind === "whatsapp") : undefined);
  return found ? found.value : null;
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
    <Dialog open={open} onClose={onClose} title={t.contacts.importTitle}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">{t.contacts.importHelp}</p>
        <Input label={t.contacts.importFile} type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
        <Textarea label={t.contacts.importText} rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} className="font-mono" required />
        {m.error && <ErrorNote error={m.error} />}
        {m.data && (
          <div role="status" className="rounded-md bg-ok-bg px-3 py-2 text-sm text-ok">
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
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t.common.close}
          </Button>
          <Button type="submit" disabled={m.isPending || csv.trim() === ""}>
            {t.contacts.importSubmit}
          </Button>
        </div>
      </form>
    </Dialog>
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
      <PageHeader title={t.contacts.title} actions={<Button onClick={() => setImporting(true)}>{t.contacts.import}</Button>} />
      <div className="mb-4 max-w-md">
        <Input label={t.contacts.searchLabel} type="search" placeholder={t.contacts.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {list.error && <ErrorNote error={list.error} onRetry={() => list.refetch()} />}
      <Card>
        {list.isLoading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState title={q ? t.contacts.noResults : t.contacts.empty} hint={q ? undefined : t.contacts.emptyHint} />
        ) : (
          <Table caption={t.contacts.title}>
            <thead>
              <tr>
                <Th>{t.common.name}</Th>
                <Th>{t.contacts.phone}</Th>
                <Th>{t.contacts.email}</Th>
                <Th>{t.contacts.tags}</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const phone = identity(c, "phone");
                return (
                  <tr key={c.id}>
                    <Td>
                      <Link to="/contactos/$contactId" params={{ contactId: c.id }} className="font-medium text-accent underline">
                        {c.displayName}
                      </Link>{" "}
                      {c.doNotCall && <Badge tone="danger">{t.contacts.doNotCall}</Badge>}
                    </Td>
                    <Td className="whitespace-nowrap">{phone ? formatPhone(phone) : ""}</Td>
                    <Td>{identity(c, "email") ?? ""}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {c.tags.map((tag) => (
                          <Badge key={tag}>{tag}</Badge>
                        ))}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {list.hasNextPage && (
          <div className="mt-4 text-center">
            <Button variant="secondary" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
              {t.common.loadMore}
            </Button>
          </div>
        )}
      </Card>
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </>
  );
}

function SourceDialog({ conversationId, onClose }: { conversationId: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["conversation-events", conversationId],
    queryFn: () => api.events.forConversation(conversationId as string),
    enabled: conversationId !== null,
  });
  return (
    <Dialog open={conversationId !== null} onClose={onClose} title={t.contacts.sourceTitle}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : <EventsTable events={q.data?.items ?? []} showActor={false} />}
    </Dialog>
  );
}

export function ContactDetailPage() {
  const { contactId } = useParams({ from: "/app/contactos/$contactId" });
  const [source, setSource] = useState<string | null>(null);
  const profile = useQuery({ queryKey: ["contact", contactId], queryFn: () => api.contacts.get(contactId) });
  const timeline = useQuery({ queryKey: ["events", "contact", contactId], queryFn: () => api.events.list({ contactId, limit: 50 }) });

  if (profile.isLoading) return <Loading />;
  if (profile.error || !profile.data) return <ErrorNote error={profile.error} onRetry={() => profile.refetch()} />;
  const { contact, obligations, facts, recentSummaries } = profile.data;
  const phone = identity(contact, "phone");
  // Defensive: if the API ignores the contactId filter, keep only this contact's events.
  const events = (timeline.data?.items ?? []).filter((e) => e.contactId === null || e.contactId === contactId);

  return (
    <>
      <Link to="/contactos" className="mb-2 inline-block text-sm text-accent underline">
        {t.common.back}
      </Link>
      <PageHeader
        title={contact.displayName}
        subtitle={[phone ? formatPhone(phone) : null, identity(contact, "email")].filter(Boolean).join(" · ")}
        actions={contact.doNotCall ? <Badge tone="danger">{t.contacts.doNotCall}</Badge> : undefined}
      />
      <div className="space-y-4">
        <Card title={t.contacts.obligations}>
          {obligations.length === 0 ? (
            <p className="text-sm text-muted">{t.contacts.noObligations}</p>
          ) : (
            <Table caption={t.contacts.obligations}>
              <thead>
                <tr>
                  <Th>{t.contacts.kind}</Th>
                  <Th>{t.contacts.stage}</Th>
                  <Th>{t.contacts.amount}</Th>
                  <Th>{t.contacts.dueAt}</Th>
                </tr>
              </thead>
              <tbody>
                {obligations.map((o) => (
                  <tr key={o.id}>
                    <Td>{t.contacts.kinds[o.kind] ?? o.kind}</Td>
                    <Td>
                      <Badge>{o.stage}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap">{o.amount === null ? "" : formatArs(o.amount, o.currency)}</Td>
                    <Td className="whitespace-nowrap">{o.dueAt ? formatDate(o.dueAt) : ""}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title={t.contacts.facts}>
          {facts.length === 0 ? (
            <p className="text-sm text-muted">{t.contacts.noFacts}</p>
          ) : (
            <ul className="divide-y divide-line">
              {facts.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <span className="font-medium">{f.key}:</span> {f.value}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {t.contacts.confidence(Math.round(f.confidence * 100))}
                    <span>{formatDate(f.createdAt)}</span>
                    <Button variant="ghost" className="min-h-8 px-2 text-xs underline" onClick={() => setSource(f.sourceConversationId)}>
                      {t.contacts.source}: {t.contacts.viewSource}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {recentSummaries.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-medium">{t.contacts.summaries}</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                {recentSummaries.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title={t.contacts.timeline}>
          {timeline.isLoading ? <Loading /> : events.length === 0 ? <p className="text-sm text-muted">{t.contacts.noTimeline}</p> : <EventsTable events={events} />}
        </Card>
      </div>
      <SourceDialog conversationId={source} onClose={() => setSource(null)} />
    </>
  );
}
