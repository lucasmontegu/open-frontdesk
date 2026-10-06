import type { BotConfig } from "@ofd/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  BotIcon,
  CheckCircle2Icon,
  CheckIcon,
  FlaskConicalIcon,
  MessageCircleIcon,
  PhoneIcon,
  PlusIcon,
  RocketIcon,
  SaveIcon,
  ShieldBanIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BotAvatar } from "@/components/bot-avatar";
import {
  EmptyState,
  ErrorNote,
  PageHeader,
  PageLoading,
  Panel,
  PanelRow,
  RowsLoading,
  StatStrip,
  StatusPill,
  type Tone,
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { t } from "@/i18n";
import {
  api,
  type BotListItemDto,
  type BotVersionDto,
  type EvalOutcome,
  evalOutcomeFrom,
  type PackDto,
} from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const versionTone: Record<string, Tone> = {
  published: "success",
  rejected: "danger",
  evaluating: "warning",
  draft: "neutral",
  archived: "neutral",
};

const CHANNELS = ["voice", "whatsapp", "web"] as const;
const channelIcon = { voice: PhoneIcon, whatsapp: MessageCircleIcon, web: SparklesIcon } as const;

function ChannelIcons({ channels }: { channels: string[] }) {
  return (
    <span className="flex items-center gap-1">
      {channels.map((c) => {
        const Icon = channelIcon[c as keyof typeof channelIcon] ?? SparklesIcon;
        return (
          <span
            key={c}
            title={t.bots.channelNames[c] ?? c}
            className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <Icon className="size-3.5" />
          </span>
        );
      })}
    </span>
  );
}

const humanTool = (name: string) => name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// ---- Create ---------------------------------------------------------------

function PackCard({
  pack,
  selected,
  onSelect,
}: {
  pack: PackDto | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-start gap-3 rounded-2xl border bg-background p-4 text-left transition-all hover:border-foreground/20",
        selected && "border-brand ring-2 ring-brand/30",
      )}
    >
      {pack ? (
        <BotAvatar seed={pack.id} size={44} />
      ) : (
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-muted">
          <PlusIcon className="size-5 text-muted-foreground" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="font-medium">{pack ? pack.name : t.bots.blank}</span>
          {selected && <CheckIcon className="size-4 text-brand" />}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-muted-foreground text-sm">
          {pack ? pack.description : t.bots.blankHint}
        </span>
        {pack && (
          <span className="mt-2 flex flex-wrap gap-1.5 text-muted-foreground text-xs">
            <span className="rounded-full bg-muted px-2 py-0.5">
              {t.bots.level(pack.autonomy ?? 2)}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5">
              {pack.tools?.length ?? 0} {t.bots.tools.toLowerCase()}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5">
              {pack.policyCount ?? 0} {t.bots.rules.toLowerCase()}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5">
              {pack.scenarioCount ?? 0} {t.bots.evals.toLowerCase()}
            </span>
          </span>
        )}
      </span>
    </button>
  );
}

function CreateBotDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const packs = useQuery({ queryKey: ["packs"], queryFn: api.packs.list, enabled: open });
  const [packId, setPackId] = useState<string | null | undefined>(undefined);
  const [name, setName] = useState("");
  const items = packs.data?.items ?? [];
  const chosen = packId === undefined ? (items[0]?.id ?? null) : packId;

  const m = useMutation({
    mutationFn: api.bots.create,
    onSuccess: async (bot) => {
      await qc.invalidateQueries({ queryKey: ["bots"] });
      onClose();
      await navigate({ to: "/bots/$botId", params: { botId: bot.id } });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate({ name: name.trim(), ...(chosen && { packId: chosen }) });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="text-xl">{t.bots.createTitle}</DialogTitle>
            <DialogDescription>{t.bots.createHint}</DialogDescription>
          </DialogHeader>
          {packs.isLoading ? (
            <RowsLoading rows={3} />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map((p) => (
                <PackCard
                  key={p.id}
                  pack={p}
                  selected={chosen === p.id}
                  onSelect={() => setPackId(p.id)}
                />
              ))}
              <PackCard pack={null} selected={chosen === null} onSelect={() => setPackId(null)} />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="bot-name">{t.bots.botName}</Label>
            <Input
              id="bot-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={items.find((p) => p.id === chosen)?.role ?? "Sofía"}
              required
            />
          </div>
          {m.error && <ErrorNote error={m.error} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={m.isPending || name.trim() === ""}>
              <PlusIcon />
              {t.common.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- List -----------------------------------------------------------------

function BotCard({ bot }: { bot: BotListItemDto }) {
  const c = bot.current;
  return (
    <Link
      to="/bots/$botId"
      params={{ botId: bot.id }}
      className="group flex flex-col gap-4 rounded-3xl bg-muted/70 p-5 transition-colors hover:bg-muted"
    >
      <div className="flex items-start justify-between gap-3">
        <BotAvatar seed={bot.id} size={52} className="transition-transform group-hover:-rotate-6" />
        {bot.publishedVersionId ? (
          <StatusPill tone="success">{t.bots.published}</StatusPill>
        ) : c ? (
          <StatusPill tone={versionTone[c.status]}>{t.bots.versionStatus[c.status]}</StatusPill>
        ) : (
          <StatusPill>{t.bots.noVersion}</StatusPill>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate font-semibold text-lg">{bot.name}</p>
        <p className="line-clamp-2 min-h-10 text-muted-foreground text-sm">
          {c?.goal || c?.role || "—"}
        </p>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-2xl bg-background px-3 py-2">
        <span className="text-sm">
          {c ? (
            <>
              <span className="font-medium">{t.bots.level(c.autonomy)}</span>
              <span className="text-muted-foreground"> · {t.bots.levels[c.autonomy]?.name}</span>
            </>
          ) : (
            <span className="text-muted-foreground">{formatDate(bot.createdAt)}</span>
          )}
        </span>
        {c && <ChannelIcons channels={c.channels} />}
      </div>
    </Link>
  );
}

export function BotsPage() {
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["bots"], queryFn: api.bots.list });
  const items = q.data?.items ?? [];
  return (
    <>
      <PageHeader
        title={t.bots.title}
        subtitle={t.bots.subtitle}
        actions={
          <Button size="lg" onClick={() => setCreating(true)}>
            <PlusIcon />
            {t.bots.create}
          </Button>
        }
      />
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? (
        <RowsLoading rows={3} />
      ) : items.length === 0 ? (
        <EmptyState
          className="bg-muted/70"
          icon={BotIcon}
          title={t.bots.empty}
          hint={t.bots.emptyHint}
          action={
            <Button onClick={() => setCreating(true)}>
              <PlusIcon />
              {t.bots.create}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((b) => (
            <BotCard key={b.id} bot={b} />
          ))}
        </div>
      )}
      <CreateBotDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

// ---- Detail ---------------------------------------------------------------

interface PublishState {
  version: number;
  ok: boolean;
  message: string;
  outcome: EvalOutcome | null;
}

function EvalResult({ state }: { state: PublishState }) {
  const o = state.outcome;
  return (
    <div
      role="status"
      className={cn(
        "rounded-3xl p-5",
        state.ok ? "bg-success-soft text-success" : "bg-danger-soft text-destructive",
      )}
    >
      <p className="flex items-center gap-2 font-semibold">
        {state.ok ? <CheckCircle2Icon className="size-5" /> : <XCircleIcon className="size-5" />}
        {state.ok ? t.bots.published_ok : t.bots.rejected}
      </p>
      <div className="mt-2 space-y-1 text-sm">
        {!state.ok && state.message && (
          <p>
            <span className="font-medium">{t.bots.reason}:</span> {state.message}
          </p>
        )}
        {o?.summary && <p>{o.summary}</p>}
        {o?.score !== undefined && (
          <p className="font-medium">{t.bots.score(Math.round(o.score * 100))}</p>
        )}
        {o?.failures && o.failures.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {o.failures.map((f) => (
              <li
                key={`${f.scenario}-${f.reason}`}
                className="rounded-xl bg-background/70 px-3 py-2 text-foreground"
              >
                {f.scenario && <strong className="font-medium">{f.scenario}: </strong>}
                {f.reason}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type Draft = Pick<BotConfig, "role" | "goal" | "instructions" | "autonomy" | "channels" | "model">;

function blankConfig(name: string): BotConfig {
  return {
    name,
    role: "",
    goal: "",
    instructions: "",
    language: "es-AR",
    model: "openai/gpt-5-mini",
    autonomy: 2,
    channels: ["voice", "whatsapp"],
    voice: {
      stt: "deepgram/nova-3",
      tts: "cartesia/sonic-3",
      language: "es-AR",
      turnDetection: "multilingual",
    },
    tools: [],
  };
}

function AutonomyLadder({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: BotConfig["autonomy"]) => void;
}) {
  const levels = [1, 2, 3, 4, 5] as const;
  return (
    <div className="flex flex-col gap-1.5">
      <PanelRow className="flex flex-col gap-4">
        <ToggleGroup
          type="single"
          value={String(value)}
          onValueChange={(v) => v && onChange(Number(v) as BotConfig["autonomy"])}
          className="grid w-full grid-cols-5 gap-1 rounded-full bg-muted p-1"
          aria-label={t.bots.autonomy}
        >
          {levels.map((n) => (
            <ToggleGroupItem
              key={n}
              value={String(n)}
              className="h-9 rounded-full! px-2 text-muted-foreground text-xs data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm sm:text-sm"
            >
              <span className="hidden sm:inline">{t.bots.levels[n]?.name}</span>
              <span className="sm:hidden">{n}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ol className="flex flex-col gap-2">
          {levels.map((n) => {
            const on = n <= value;
            return (
              <li key={n} className={cn("flex items-start gap-3 text-sm", !on && "opacity-45")}>
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full font-semibold text-[10px]",
                    on ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  {on ? <CheckIcon className="size-3" /> : n}
                </span>
                <span>
                  <span className="font-medium">{t.bots.levels[n]?.name}</span>
                  <span className="text-muted-foreground"> · {t.bots.levels[n]?.hint}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </PanelRow>
    </div>
  );
}

export function BotDetailPage() {
  const { botId } = useParams({ from: "/app/bots/$botId" });
  const qc = useQueryClient();
  const [result, setResult] = useState<PublishState | null>(null);
  const q = useQuery({ queryKey: ["bot", botId], queryFn: () => api.bots.get(botId) });
  const rules = useQuery({
    queryKey: ["bot-policies", botId],
    queryFn: () => api.bots.policies(botId),
  });

  const versions = useMemo(
    () => [...(q.data?.versions ?? [])].sort((a, b) => b.version - a.version),
    [q.data],
  );
  const latest = versions[0];
  const live = versions.find((v) => v.id === q.data?.bot.publishedVersionId);
  const packId = (live ?? latest)?.config.pack?.id;
  const pack = useQuery({
    queryKey: ["pack", packId],
    queryFn: () => api.packs.get(packId as string),
    enabled: Boolean(packId),
  });

  const base: BotConfig | null = q.data
    ? ((latest?.config as BotConfig) ?? blankConfig(q.data.bot.name))
    : null;
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (base && !draft) setDraft(pick(base));
  }, [base, draft]);
  const dirty = Boolean(base && draft && JSON.stringify(pick(base)) !== JSON.stringify(draft));
  const edit = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["bot", botId] });
    await qc.invalidateQueries({ queryKey: ["bots"] });
    await qc.invalidateQueries({ queryKey: ["bot-policies", botId] });
  };

  const save = useMutation({
    mutationFn: () =>
      api.bots.createVersion(botId, { ...(base as BotConfig), ...(draft as Draft) }),
    onSuccess: async (v) => {
      await refresh();
      setDraft(null);
      toast.success(t.bots.draftSaved(v.version));
    },
  });

  const publish = useMutation({
    mutationFn: (v: BotVersionDto) => api.bots.publish(botId, v.id),
    onSuccess: (res, v) => {
      const outcome = evalOutcomeFrom(res);
      const ok = res.version ? res.version.status === "published" : outcome?.passed !== false;
      setResult({ version: v.version, ok, message: "", outcome });
    },
    onError: (err, v) => {
      const e = err instanceof ApiError ? err : null;
      setResult({
        version: v.version,
        ok: false,
        message: err.message,
        outcome: evalOutcomeFrom(e?.details),
      });
    },
    onSettled: refresh,
  });

  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  if (!draft) return <PageLoading />;
  const { bot } = q.data;
  const canPublish =
    latest && (latest.status === "draft" || latest.status === "rejected") && !dirty;
  const ruleItems = rules.data?.items ?? [];
  const scenarios = pack.data?.scenarios ?? [];
  const tools = (latest?.config.tools ?? []) as string[];
  const needsBasics = draft.role.trim() === "" || draft.instructions.trim() === "";

  return (
    <>
      <PageHeader
        back="/bots"
        eyebrow={`${t.bots.title} / ${bot.name}`}
        title={bot.name}
        actions={
          <>
            {live ? (
              <StatusPill tone="success" className="px-3 py-2 text-sm">
                {t.bots.live(live.version)}
              </StatusPill>
            ) : (
              <StatusPill className="px-3 py-2 text-sm">{t.bots.noPublished}</StatusPill>
            )}
            {dirty && (
              <>
                <Button variant="ghost" onClick={() => setDraft(null)}>
                  {t.bots.discard}
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  disabled={save.isPending || needsBasics}
                  onClick={() => save.mutate()}
                >
                  <SaveIcon />
                  {save.isPending ? t.bots.savingDraft : t.bots.newDraft}
                </Button>
              </>
            )}
            {canPublish && (
              <Button size="lg" disabled={publish.isPending} onClick={() => publish.mutate(latest)}>
                <RocketIcon />
                {publish.isPending ? t.bots.publishing : t.bots.publishVersion(latest.version)}
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-6">
        <section className="flex items-center gap-5 rounded-3xl bg-hero p-5 text-hero-foreground md:p-7">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-white/10 md:size-20">
            <BotAvatar seed={bot.id} size={52} />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-[11px] text-hero-foreground/60 uppercase tracking-wider">
              {[
                pack.data?.name,
                latest && t.bots.version(latest.version),
                live && t.bots.since(formatDate(live.createdAt)),
              ]
                .filter(Boolean)
                .join(" · ") || t.bots.noVersion}
            </p>
            <p className="mt-1 text-balance text-lg leading-snug md:text-2xl">
              {draft.goal || draft.role || t.bots.emptyHint}
            </p>
          </div>
        </section>

        {publish.isPending && (
          <div className="rounded-3xl bg-warning-soft p-5 text-warning">
            <p className="flex items-center gap-2 font-semibold">
              <FlaskConicalIcon className="size-5 animate-pulse" />
              {t.bots.publishing}
            </p>
          </div>
        )}
        {result && !publish.isPending && <EvalResult state={result} />}
        {save.error && <ErrorNote error={save.error} />}

        <StatStrip
          stats={[
            { label: t.bots.stats.versions, value: versions.length },
            { label: t.bots.stats.scenarios, value: scenarios.length, tone: "brand" },
            { label: t.bots.stats.rules, value: ruleItems.length },
            { label: t.bots.stats.tools, value: tools.length },
          ]}
        />

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            <Panel title={t.bots.autonomyTitle} description={t.bots.autonomyHint}>
              <AutonomyLadder value={draft.autonomy} onChange={(autonomy) => edit({ autonomy })} />
            </Panel>

            <Panel title={t.bots.config}>
              <PanelRow className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="role">{t.bots.role}</Label>
                    <Input
                      id="role"
                      value={draft.role}
                      onChange={(e) => edit({ role: e.target.value })}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="model">{t.bots.model}</Label>
                    <Input
                      id="model"
                      value={draft.model}
                      onChange={(e) => edit({ model: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="goal">{t.bots.goal}</Label>
                  <Input
                    id="goal"
                    value={draft.goal}
                    onChange={(e) => edit({ goal: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="instructions">{t.bots.instructions}</Label>
                  <Textarea
                    id="instructions"
                    rows={8}
                    value={draft.instructions}
                    onChange={(e) => edit({ instructions: e.target.value })}
                    className="max-h-96 font-mono text-xs leading-relaxed"
                    required
                  />
                </div>
                <fieldset className="grid gap-2">
                  <legend className="mb-2 font-medium text-sm">{t.bots.channels}</legend>
                  <div className="flex flex-wrap gap-2">
                    {CHANNELS.map((c) => {
                      const Icon = channelIcon[c];
                      const on = draft.channels.includes(c);
                      return (
                        <div
                          key={c}
                          className="flex items-center gap-3 rounded-2xl border px-3 py-2 text-sm has-[[data-state=checked]]:border-brand/40 has-[[data-state=checked]]:bg-brand-soft/50"
                        >
                          <Icon className="size-4 text-muted-foreground" />
                          <Label htmlFor={`channel-${c}`}>{t.bots.channelNames[c]}</Label>
                          <Switch
                            id={`channel-${c}`}
                            checked={on}
                            className="data-[state=checked]:bg-brand"
                            onCheckedChange={(v) =>
                              edit({
                                channels: v
                                  ? [...draft.channels, c]
                                  : draft.channels.filter((x) => x !== c),
                              })
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
              </PanelRow>
            </Panel>

            <Panel title={t.bots.tools} description={t.bots.toolsHint}>
              {tools.length === 0 ? (
                <PanelRow className="text-muted-foreground text-sm">{t.common.none}</PanelRow>
              ) : (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {tools.map((tool) => (
                    <PanelRow key={tool} className="flex items-center gap-3 py-3">
                      <span className="flex size-8 items-center justify-center rounded-xl bg-muted">
                        <WrenchIcon className="size-4 text-muted-foreground" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-sm">
                          {humanTool(tool)}
                        </span>
                        <span className="block truncate font-mono text-muted-foreground text-xs">
                          {tool}
                        </span>
                      </span>
                    </PanelRow>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title={t.bots.versions}>
              {versions.length === 0 ? (
                <PanelRow className="text-muted-foreground text-sm">{t.bots.noVersion}</PanelRow>
              ) : (
                versions.map((v) => (
                  <PanelRow key={v.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-muted font-semibold text-sm">
                      {t.bots.versionShort(v.version)}
                    </span>
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-medium">{t.bots.level(v.config.autonomy)}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {v.config.channels.map((c) => t.bots.channelNames[c] ?? c).join(", ")} ·{" "}
                        {formatDate(v.createdAt)}
                      </span>
                    </span>
                    <StatusPill tone={versionTone[v.status]}>
                      {v.id === bot.publishedVersionId
                        ? t.bots.published
                        : t.bots.versionStatus[v.status]}
                    </StatusPill>
                  </PanelRow>
                ))
              )}
            </Panel>
          </div>

          <div className="flex flex-col gap-6">
            <Panel title={t.bots.guardrails} description={t.bots.guardrailsHint}>
              {rules.isLoading ? (
                <RowsLoading rows={3} />
              ) : ruleItems.length === 0 ? (
                <PanelRow className="text-muted-foreground text-sm">{t.bots.noGuardrails}</PanelRow>
              ) : (
                ruleItems.map((r) => (
                  <PanelRow key={r.id} className="py-3.5">
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg",
                          r.effect === "deny"
                            ? "bg-danger-soft text-destructive"
                            : "bg-success-soft text-success",
                        )}
                      >
                        {r.effect === "deny" ? (
                          <ShieldBanIcon className="size-4" />
                        ) : (
                          <ShieldCheckIcon className="size-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium text-sm">{r.id}</p>
                        <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
                          {r.description}
                        </p>
                        <p className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 font-medium",
                              r.effect === "deny"
                                ? "bg-danger-soft text-destructive"
                                : "bg-success-soft text-success",
                            )}
                          >
                            {r.effect === "deny" ? t.bots.ruleDeny : t.bots.ruleAllow}
                          </span>
                          {r.source && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                              {t.bots.ruleSource[r.source]}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  </PanelRow>
                ))
              )}
            </Panel>

            <Panel title={t.bots.evals} description={t.bots.evalsHint}>
              {scenarios.length === 0 ? (
                <PanelRow className="text-muted-foreground text-sm">{t.bots.noScenarios}</PanelRow>
              ) : (
                scenarios.map((s) => (
                  <PanelRow key={s.id} className="flex items-start gap-3 py-3">
                    <FlaskConicalIcon className="mt-0.5 size-4 shrink-0 text-brand" />
                    <span className="min-w-0">
                      <span className="block font-medium text-sm">{s.title}</span>
                      <span className="block text-muted-foreground text-xs">{s.goal}</span>
                    </span>
                  </PanelRow>
                ))
              )}
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}

function pick(c: BotConfig): Draft {
  return {
    role: c.role,
    goal: c.goal,
    instructions: c.instructions,
    autonomy: c.autonomy,
    channels: [...c.channels],
    model: c.model,
  };
}
