import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  Select,
  Table,
  Td,
  Textarea,
  Th,
} from "../components/ui";
import { t } from "../i18n";
import { api, type MissionDto } from "../lib/api";
import { formatDateTime, formatMinutes, shortId } from "../lib/format";

const tone = (s: string) =>
  s === "completed"
    ? "ok"
    : s === "failed" || s === "cancelled"
      ? "danger"
      : s === "awaiting_approval"
        ? "warn"
        : "accent";

export function MissionsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const bots = useQuery({ queryKey: ["bots"], queryFn: api.bots.list });
  const missions = useQuery({ queryKey: ["missions"], queryFn: api.missions.list });
  const publishedBots = (bots.data?.items ?? []).filter((b) => b.publishedVersionId);

  const create = useMutation({
    mutationFn: api.missions.create,
    onSuccess: async (m) => {
      await qc.invalidateQueries({ queryKey: ["missions"] });
      await navigate({ to: "/misiones/$missionId", params: { missionId: m.id } });
    },
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    create.mutate({
      instruction: String(f.get("instruction")).trim(),
      botId: String(f.get("bot")),
    });
  };

  const items = missions.data?.items ?? [];

  return (
    <>
      <PageHeader title={t.missions.title} />
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <Textarea
            label={t.missions.prompt}
            name="instruction"
            rows={4}
            placeholder={t.missions.placeholder}
            required
            className="text-base"
          />
          <Select label={t.missions.bot} name="bot" required defaultValue={publishedBots[0]?.id}>
            {publishedBots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          {bots.data && publishedBots.length === 0 && (
            <p className="text-sm text-muted">{t.missions.noBots}</p>
          )}
          {create.error && <ErrorNote error={create.error} />}
          <Button type="submit" disabled={create.isPending || publishedBots.length === 0}>
            {t.missions.submit}
          </Button>
        </form>
      </Card>
      <Card title={t.missions.list} className="mt-4">
        {missions.isLoading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState title={t.missions.empty} />
        ) : (
          <Table caption={t.missions.list}>
            <thead>
              <tr>
                <Th>{t.missions.instruction}</Th>
                <Th>{t.common.status}</Th>
                <Th>{t.common.created}</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id}>
                  <Td>
                    <Link
                      to="/misiones/$missionId"
                      params={{ missionId: m.id }}
                      className="text-accent underline"
                    >
                      {m.instruction}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={tone(m.status)}>{t.missions.statuses[m.status] ?? m.status}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDateTime(m.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

const POLLING: ReadonlySet<string> = new Set(["planning", "running"]);

export function shouldPoll(m: Pick<MissionDto, "status"> | undefined): boolean {
  return m === undefined || POLLING.has(m.status);
}

export function MissionDetailPage() {
  const { missionId } = useParams({ from: "/app/misiones/$missionId" });
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["mission", missionId],
    queryFn: () => api.missions.get(missionId),
    refetchInterval: (query) => (shouldPoll(query.state.data) ? 3000 : false),
  });
  const approve = useMutation({
    mutationFn: () => api.missions.approve(missionId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["mission", missionId] });
      await qc.invalidateQueries({ queryKey: ["missions"] });
    },
  });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const m = q.data;
  const { plan, report } = m;

  return (
    <>
      <Link to="/misiones" className="mb-2 inline-block text-sm text-accent underline">
        {t.common.back}
      </Link>
      <PageHeader
        title={m.instruction}
        subtitle={shortId(m.id)}
        actions={
          <span className="flex items-center gap-2">
            <Badge tone={tone(m.status)}>{t.missions.statuses[m.status] ?? m.status}</Badge>
            {POLLING.has(m.status) && <span className="text-xs text-muted">{t.missions.live}</span>}
          </span>
        }
      />
      <div className="space-y-4">
        {m.status === "planning" && !plan && (
          <Card>
            <p role="status" className="text-sm text-muted">
              {t.missions.planning}
            </p>
          </Card>
        )}

        {plan && (
          <Card title={t.missions.plan}>
            <p className="mb-4 text-sm">{plan.summary}</p>
            <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted">{t.missions.targets}</dt>
                <dd className="text-xl font-semibold">{plan.targets.length}</dd>
              </div>
              <div>
                <dt className="text-muted">{t.missions.estimate}</dt>
                <dd className="text-xl font-semibold">{formatMinutes(plan.estimatedMinutes)}</dd>
              </div>
              <div>
                <dt className="text-muted">{t.missions.strategy}</dt>
                <dd>
                  {t.missions.strategyText(
                    t.missions.channels[plan.channelStrategy.first] ?? plan.channelStrategy.first,
                    plan.channelStrategy.fallbackAfterMinutes,
                  )}
                </dd>
              </div>
            </dl>
            <Table caption={t.missions.targets}>
              <thead>
                <tr>
                  <Th>{t.missions.contact}</Th>
                  <Th>{t.missions.channel}</Th>
                  <Th>{t.missions.offer}</Th>
                  <Th>{t.common.status}</Th>
                </tr>
              </thead>
              <tbody>
                {plan.targets.slice(0, 100).map((x) => (
                  <tr key={x.contactId}>
                    <Td>
                      <Link
                        to="/contactos/$contactId"
                        params={{ contactId: x.contactId }}
                        className="text-accent underline"
                      >
                        {shortId(x.contactId)}
                      </Link>
                    </Td>
                    <Td>{t.missions.channels[x.channel] ?? x.channel}</Td>
                    <Td className="font-mono text-xs">
                      {Object.keys(x.offer).length ? JSON.stringify(x.offer) : ""}
                    </Td>
                    <Td>{t.missions.targetStatuses[x.status] ?? x.status}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {m.status === "awaiting_approval" && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button disabled={approve.isPending} onClick={() => approve.mutate()}>
                  {approve.isPending ? t.missions.approving : t.missions.approve}
                </Button>
                <span className="text-sm text-muted">{t.missions.awaitingHint}</span>
              </div>
            )}
            {approve.error && (
              <div className="mt-3">
                <ErrorNote error={approve.error} />
              </div>
            )}
          </Card>
        )}

        {(report || m.status === "running") && (
          <Card title={t.missions.report}>
            {report ? (
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
                {(
                  [
                    ["total", t.missions.total],
                    ["succeeded", t.missions.succeeded],
                    ["noAnswer", t.missions.noAnswer],
                    ["escalated", t.missions.escalated],
                    ["failed", t.missions.failed],
                  ] as const
                ).map(([k, label]) => (
                  <div key={k}>
                    <dt className="text-muted">{label}</dt>
                    <dd className="text-2xl font-semibold">{report[k]}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p role="status" className="text-sm text-muted">
                {t.missions.live}...
              </p>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
