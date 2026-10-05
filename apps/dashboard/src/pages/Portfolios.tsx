import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorNote,
  Input,
  Loading,
  PageHeader,
  Table,
  Td,
  Th,
} from "../components/ui";
import { t } from "../i18n";
import { api, type ContactDto, type ObligationDto, type PortfolioDto } from "../lib/api";
import { formatArs, formatDate } from "../lib/format";

const csv = (s: FormDataEntryValue | null) =>
  String(s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function describeRule(rule: PortfolioDto["rule"]): string {
  const parts: string[] = [];
  if (rule.minDaysOverdue !== undefined) parts.push(t.portfolios.daysOverdue(rule.minDaysOverdue));
  if (rule.minAmount !== undefined) parts.push(t.portfolios.amountFrom(formatArs(rule.minAmount)));
  if (rule.stages?.length) parts.push(rule.stages.join(", "));
  if (rule.tags?.length) parts.push(rule.tags.map((x) => `#${x}`).join(" "));
  return parts.join(" · ") || t.portfolios.noRule;
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: api.portfolios.create,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["portfolios"] });
      onClose();
    },
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) =>
      String(f.get(k) ?? "").trim() === "" ? undefined : Number(f.get(k));
    const stages = csv(f.get("stages"));
    const tags = csv(f.get("tags"));
    const rule: PortfolioDto["rule"] = {
      ...(num("days") !== undefined && { minDaysOverdue: num("days") }),
      ...(num("amount") !== undefined && { minAmount: num("amount") }),
      ...(stages.length > 0 && { stages }),
      ...(tags.length > 0 && { tags }),
    };
    m.mutate({
      name: String(f.get("name")),
      owner: String(f.get("owner") ?? "").trim() || null,
      rule,
    });
  };
  return (
    <Dialog open={open} onClose={onClose} title={t.portfolios.create}>
      <form onSubmit={submit} className="space-y-4">
        <Input label={t.common.name} name="name" required />
        <Input label={t.portfolios.owner} name="owner" hint={t.common.optional} />
        <fieldset className="space-y-3 rounded-md border border-line p-3">
          <legend className="px-1 text-sm font-medium">{t.portfolios.rule}</legend>
          <Input
            label={t.portfolios.minDaysOverdue}
            name="days"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
          />
          <Input
            label={t.portfolios.minAmount}
            name="amount"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
          />
          <Input label={t.portfolios.stages} name="stages" />
          <Input label={t.portfolios.tags} name="tags" />
        </fieldset>
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

export function PortfoliosPage() {
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["portfolios"], queryFn: api.portfolios.list });
  const items = q.data?.items ?? [];
  return (
    <>
      <PageHeader
        title={t.portfolios.title}
        actions={<Button onClick={() => setCreating(true)}>{t.portfolios.create}</Button>}
      />
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      <Card>
        {q.isLoading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState title={t.portfolios.empty} hint={t.portfolios.emptyHint} />
        ) : (
          <Table caption={t.portfolios.title}>
            <thead>
              <tr>
                <Th>{t.common.name}</Th>
                <Th>{t.portfolios.owner}</Th>
                <Th>{t.portfolios.rule}</Th>
                <Th>{t.common.created}</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <Link
                      to="/carteras/$portfolioId"
                      params={{ portfolioId: p.id }}
                      className="font-medium text-accent underline"
                    >
                      {p.name}
                    </Link>
                  </Td>
                  <Td>{p.owner ?? ""}</Td>
                  <Td>{describeRule(p.rule)}</Td>
                  <Td className="whitespace-nowrap">{formatDate(p.createdAt)}</Td>
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

interface MemberRow {
  contact: ContactDto | null;
  obligations: ObligationDto[];
}

/** Members may arrive as `{contact, obligations}` rows, `{contact, obligation}` rows or bare contacts. */
export function toMemberRow(raw: unknown): MemberRow {
  const r = raw as {
    contact?: ContactDto;
    obligations?: ObligationDto[];
    obligation?: ObligationDto;
  } & Partial<ContactDto>;
  if (r.contact)
    return {
      contact: r.contact,
      obligations: r.obligations ?? (r.obligation ? [r.obligation] : []),
    };
  return { contact: r.displayName ? (r as ContactDto) : null, obligations: [] };
}

export function PortfolioDetailPage() {
  const { portfolioId } = useParams({ from: "/app/carteras/$portfolioId" });
  const list = useQuery({ queryKey: ["portfolios"], queryFn: api.portfolios.list });
  const members = useQuery({
    queryKey: ["portfolio-members", portfolioId],
    queryFn: () => api.portfolios.members(portfolioId),
  });
  const portfolio = list.data?.items.find((p) => p.id === portfolioId);
  const rows = (members.data?.items ?? []).map(toMemberRow).filter((r) => r.contact);

  return (
    <>
      <Link to="/carteras" className="mb-2 inline-block text-sm text-accent underline">
        {t.common.back}
      </Link>
      <PageHeader
        title={portfolio?.name ?? t.portfolios.title}
        subtitle={portfolio ? describeRule(portfolio.rule) : undefined}
      />
      <Card title={t.portfolios.members}>
        {members.isLoading ? (
          <Loading />
        ) : members.error ? (
          <ErrorNote error={members.error} onRetry={() => members.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={t.portfolios.noMembers} />
        ) : (
          <Table caption={t.portfolios.members}>
            <thead>
              <tr>
                <Th>{t.common.name}</Th>
                <Th>{t.contacts.obligations}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.contact?.id}>
                  <Td>
                    {r.contact && (
                      <Link
                        to="/contactos/$contactId"
                        params={{ contactId: r.contact.id }}
                        className="text-accent underline"
                      >
                        {r.contact.displayName}
                      </Link>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      {r.obligations.map((o) => (
                        <Badge key={o.id}>
                          {o.stage}
                          {o.amount !== null && ` · ${formatArs(o.amount, o.currency)}`}
                        </Badge>
                      ))}
                    </div>
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
