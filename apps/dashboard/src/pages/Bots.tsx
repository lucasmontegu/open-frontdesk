import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Badge, Button, Card, Dialog, EmptyState, ErrorNote, Input, Loading, PageHeader, Select, Table, Td, Th } from "../components/ui";
import { t } from "../i18n";
import { type BotVersionDto, type EvalOutcome, api, evalOutcomeFrom } from "../lib/api";
import { ApiError } from "../lib/api-error";
import { formatDate } from "../lib/format";

const statusTone = { published: "ok", rejected: "danger", evaluating: "warn", draft: "neutral", archived: "neutral" } as const;

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const packs = useQuery({ queryKey: ["packs"], queryFn: api.packs.list });
  const m = useMutation({
    mutationFn: api.bots.create,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["bots"] });
      onClose();
    },
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const packId = String(f.get("pack") ?? "");
    m.mutate({ name: String(f.get("name")), ...(packId && { packId }) });
  };
  return (
    <Dialog open={open} onClose={onClose} title={t.bots.create}>
      <form onSubmit={submit} className="space-y-4">
        <Input label={t.bots.botName} name="name" required />
        <Select label={t.bots.fromPack} name="pack" defaultValue="">
          <option value="">{t.bots.noPack}</option>
          {(packs.data?.items ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.version})
            </option>
          ))}
        </Select>
        {packs.data && packs.data.items.length === 0 && <p className="text-xs text-muted">{t.bots.packsEmpty}</p>}
        {m.error && <ErrorNote error={m.error} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={m.isPending}>
            {t.common.create}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function BotsPage() {
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["bots"], queryFn: api.bots.list });
  const items = q.data?.items ?? [];
  return (
    <>
      <PageHeader title={t.bots.title} actions={<Button onClick={() => setCreating(true)}>{t.bots.create}</Button>} />
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      <Card>
        {q.isLoading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState title={t.bots.empty} hint={t.bots.emptyHint} />
        ) : (
          <Table caption={t.bots.title}>
            <thead>
              <tr>
                <Th>{t.common.name}</Th>
                <Th>{t.common.status}</Th>
                <Th>{t.common.created}</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id}>
                  <Td>
                    <Link to="/bots/$botId" params={{ botId: b.id }} className="font-medium text-accent underline">
                      {b.name}
                    </Link>
                  </Td>
                  <Td>{b.publishedVersionId ? <Badge tone="ok">{t.bots.published}</Badge> : <Badge>{t.bots.noPublished}</Badge>}</Td>
                  <Td className="whitespace-nowrap">{formatDate(b.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <CreateDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

interface PublishState {
  versionId: string;
  ok: boolean;
  message: string;
  outcome: EvalOutcome | null;
}

function EvalPanel({ state }: { state: PublishState }) {
  const o = state.outcome;
  return (
    <div role="status" className={`mb-4 rounded-md px-4 py-3 text-sm ${state.ok ? "bg-ok-bg text-ok" : "bg-danger-bg text-danger"}`}>
      <p className="font-medium">{state.ok ? t.bots.published_ok : t.bots.rejected}</p>
      {!state.ok && state.message && (
        <p className="mt-1">
          <span className="font-medium">{t.bots.reason}:</span> {state.message}
        </p>
      )}
      {o && (
        <div className="mt-2">
          <p className="font-medium">{t.bots.evalResult}</p>
          {o.summary && <p>{o.summary}</p>}
          {o.score !== undefined && <p>{Math.round(o.score * 100)}%</p>}
          {o.failures && o.failures.length > 0 && (
            <ul className="list-disc pl-5">
              {o.failures.map((f, i) => (
                <li key={`${f.scenario}-${i}`}>
                  {f.scenario && <strong>{f.scenario}: </strong>}
                  {f.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function BotDetailPage() {
  const { botId } = useParams({ from: "/app/bots/$botId" });
  const qc = useQueryClient();
  const [result, setResult] = useState<PublishState | null>(null);
  const q = useQuery({ queryKey: ["bot", botId], queryFn: () => api.bots.get(botId) });

  const publish = useMutation({
    mutationFn: (v: BotVersionDto) => api.bots.publish(botId, v.id),
    onSuccess: (res, v) => {
      const outcome = evalOutcomeFrom(res);
      const ok = res.version ? res.version.status === "published" : outcome?.passed !== false;
      setResult({ versionId: v.id, ok, message: "", outcome });
    },
    onError: (err, v) => {
      const e = err instanceof ApiError ? err : null;
      setResult({ versionId: v.id, ok: false, message: err.message, outcome: evalOutcomeFrom(e?.details) });
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ["bot", botId] });
      await qc.invalidateQueries({ queryKey: ["bots"] });
    },
  });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const { bot, versions } = q.data;
  const sorted = [...versions].sort((a, b) => b.version - a.version);

  return (
    <>
      <Link to="/bots" className="mb-2 inline-block text-sm text-accent underline">
        {t.common.back}
      </Link>
      <PageHeader title={bot.name} />
      {result && <EvalPanel state={result} />}
      <Card title={t.bots.versions}>
        {sorted.length === 0 ? (
          <EmptyState title={t.common.none} />
        ) : (
          <Table caption={t.bots.versions}>
            <thead>
              <tr>
                <Th>{t.bots.versions}</Th>
                <Th>{t.common.status}</Th>
                <Th>{t.bots.autonomy}</Th>
                <Th>{t.common.created}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((v) => (
                <tr key={v.id}>
                  <Td>
                    {t.bots.version(v.version)}
                    {v.id === bot.publishedVersionId && " ✓"}
                  </Td>
                  <Td>
                    <Badge tone={statusTone[v.status]}>{t.bots.versionStatus[v.status] ?? v.status}</Badge>
                  </Td>
                  <Td>{v.config.autonomy}</Td>
                  <Td className="whitespace-nowrap">{formatDate(v.createdAt)}</Td>
                  <Td>
                    {(v.status === "draft" || v.status === "rejected") && (
                      <Button disabled={publish.isPending} onClick={() => publish.mutate(v)}>
                        {publish.isPending && publish.variables?.id === v.id ? t.bots.publishing : t.bots.publish}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
