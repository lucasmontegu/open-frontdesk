import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ChevronRightIcon, FilterIcon, FolderKanbanIcon, PlusIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import {
  EmptyState,
  ErrorNote,
  PageHeader,
  Panel,
  PanelRow,
  RowsLoading,
  StatusPill,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";
import { api, type ContactDto, type ObligationDto, type PortfolioDto } from "@/lib/api";
import { formatArs, formatDate } from "@/lib/format";
import { initials } from "./Contacts";

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

function Field({
  id,
  label,
  hint,
  ...props
}: React.ComponentProps<typeof Input> & { id: string; label: string; hint?: string }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>
        {label}
        {hint && <span className="font-normal text-muted-foreground"> ({hint})</span>}
      </Label>
      <Input id={id} name={id} {...props} />
    </div>
  );
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
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="text-xl">{t.portfolios.create}</DialogTitle>
            <DialogDescription>{t.portfolios.emptyHint}</DialogDescription>
          </DialogHeader>
          <Field id="name" label={t.common.name} required />
          <Field id="owner" label={t.portfolios.owner} hint={t.common.optional} />
          <fieldset className="grid gap-3 rounded-2xl bg-muted/60 p-4">
            <legend className="sr-only">{t.portfolios.rule}</legend>
            <p className="flex items-center gap-2 font-medium text-sm">
              <FilterIcon className="size-4" />
              {t.portfolios.rule}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id="days"
                label={t.portfolios.minDaysOverdue}
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
              />
              <Field
                id="amount"
                label={t.portfolios.minAmount}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
              />
            </div>
            <Field id="stages" label={t.portfolios.stages} />
            <Field id="tags" label={t.portfolios.tags} />
          </fieldset>
          {m.error && <ErrorNote error={m.error} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={m.isPending}>
              {t.common.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
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
        subtitle={t.portfolios.subtitle}
        actions={
          <Button size="lg" onClick={() => setCreating(true)}>
            <PlusIcon />
            {t.portfolios.create}
          </Button>
        }
      />
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      <Panel>
        {q.isLoading ? (
          <RowsLoading />
        ) : items.length === 0 ? (
          <EmptyState
            icon={FolderKanbanIcon}
            title={t.portfolios.empty}
            hint={t.portfolios.emptyHint}
            action={
              <Button onClick={() => setCreating(true)}>
                <PlusIcon />
                {t.portfolios.create}
              </Button>
            }
          />
        ) : (
          items.map((p) => (
            <Link
              key={p.id}
              to="/portfolios/$portfolioId"
              params={{ portfolioId: p.id }}
              className="flex flex-wrap items-center gap-3 rounded-2xl bg-background p-4 transition-shadow hover:shadow-sm"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-muted">
                <FolderKanbanIcon className="size-5 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1 basis-48">
                <p className="font-medium">{p.name}</p>
                <p className="text-muted-foreground text-xs">
                  {[p.owner, formatDate(p.createdAt)].filter(Boolean).join(" · ")}
                </p>
              </div>
              <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground text-xs">
                {describeRule(p.rule)}
              </span>
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </Link>
          ))
        )}
      </Panel>
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
  const { portfolioId } = useParams({ from: "/app/portfolios/$portfolioId" });
  const list = useQuery({ queryKey: ["portfolios"], queryFn: api.portfolios.list });
  const members = useQuery({
    queryKey: ["portfolio-members", portfolioId],
    queryFn: () => api.portfolios.members(portfolioId),
  });
  const portfolio = list.data?.items.find((p) => p.id === portfolioId);
  const rows = (members.data?.items ?? []).map(toMemberRow).filter((r) => r.contact);

  return (
    <>
      <PageHeader
        back="/portfolios"
        eyebrow={t.portfolios.title}
        title={portfolio?.name ?? t.portfolios.title}
        subtitle={portfolio ? describeRule(portfolio.rule) : undefined}
      />
      <Panel title={`${t.portfolios.members}${members.data ? ` · ${rows.length}` : ""}`}>
        {members.isLoading ? (
          <RowsLoading />
        ) : members.error ? (
          <ErrorNote error={members.error} onRetry={() => members.refetch()} />
        ) : rows.length === 0 ? (
          <PanelRow className="text-muted-foreground text-sm">{t.portfolios.noMembers}</PanelRow>
        ) : (
          rows.map((r) =>
            r.contact ? (
              <Link
                key={r.contact.id}
                to="/contacts/$contactId"
                params={{ contactId: r.contact.id }}
                className="flex flex-wrap items-center gap-3 rounded-2xl bg-background p-3.5 transition-shadow hover:shadow-sm"
              >
                <span className="flex size-9 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand text-xs">
                  {initials(r.contact.displayName)}
                </span>
                <span className="min-w-0 flex-1 font-medium">{r.contact.displayName}</span>
                <span className="flex flex-wrap gap-1.5">
                  {r.obligations.map((o) => (
                    <StatusPill key={o.id} tone="warning">
                      {o.stage}
                      {o.amount !== null && ` · ${formatArs(o.amount, o.currency)}`}
                    </StatusPill>
                  ))}
                </span>
              </Link>
            ) : null,
          )
        )}
      </Panel>
    </>
  );
}
