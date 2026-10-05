import { Link } from "@tanstack/react-router";
import { AlertCircleIcon, ArrowLeftIcon, type LucideIcon, RotateCwIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

/** Eyebrow breadcrumb, optional back link, big title and right-aligned actions. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  back,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  back?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4 md:mb-8">
      <div className="flex min-w-0 items-start gap-3 md:gap-4">
        {back && (
          <Button
            asChild
            variant="outline"
            size="icon-lg"
            className="mt-1 shrink-0"
            aria-label={t.common.back}
          >
            <Link to={back}>
              <ArrowLeftIcon />
            </Link>
          </Button>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wider">
              {eyebrow}
            </p>
          )}
          <h1 className="text-balance font-semibold text-3xl tracking-tight md:text-4xl">
            {title}
          </h1>
          {subtitle && <p className="mt-2 max-w-2xl text-muted-foreground text-sm">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** The soft grey rounded block every page is built from. */
export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-3xl bg-muted/70 p-2", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-2 px-3 pt-3 pb-3">
          <div className="min-w-0">
            {title && <h2 className="font-semibold text-base">{title}</h2>}
            {description && <p className="mt-0.5 text-muted-foreground text-sm">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cn("flex flex-col gap-1.5", bodyClassName)}>{children}</div>
    </section>
  );
}

/** A white row inside a Panel. */
export function PanelRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl bg-background p-4", className)}>{children}</div>;
}

export interface Stat {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "brand";
}

const statTone: Record<NonNullable<Stat["tone"]>, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  brand: "text-brand",
};

/** A row of big numbers with optional proportional bar underneath. */
export function StatStrip({
  stats,
  bar,
}: {
  stats: Stat[];
  bar?: { value: number; tone: NonNullable<Stat["tone"]> }[];
}) {
  const total = bar?.reduce((s, b) => s + b.value, 0) ?? 0;
  return (
    <section className="rounded-3xl bg-muted/70 p-5 md:p-6">
      <dl
        className={cn(
          "grid grid-cols-2 gap-x-4 gap-y-5",
          stats.length === 5 ? "md:grid-cols-5" : "md:grid-cols-4",
        )}
      >
        {stats.map((s) => (
          <div key={s.label} className="min-w-0">
            <dt className="truncate font-medium text-muted-foreground text-xs uppercase tracking-wider">
              {s.label}
            </dt>
            <dd
              className={cn(
                "mt-1 font-semibold text-4xl tabular-nums",
                statTone[s.tone ?? "default"],
              )}
            >
              {s.value}
            </dd>
            {s.hint && <dd className="mt-1 truncate text-muted-foreground text-sm">{s.hint}</dd>}
          </div>
        ))}
      </dl>
      {bar && total > 0 && (
        <div className="mt-5 flex h-2 gap-1" aria-hidden>
          {bar
            .filter((b) => b.value > 0)
            .map((b, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: segments have no identity
                key={i}
                className={cn("rounded-full", {
                  "bg-foreground/80": b.tone === "default",
                  "bg-success": b.tone === "success",
                  "bg-warning": b.tone === "warning",
                  "bg-destructive": b.tone === "danger",
                  "bg-brand": b.tone === "brand",
                })}
                style={{ flexGrow: b.value }}
              />
            ))}
        </div>
      )}
    </section>
  );
}

export type Tone = "neutral" | "success" | "warning" | "danger" | "brand";

const pillTone: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-destructive",
  brand: "bg-brand-soft text-brand",
};

/** A soft colored pill with a status dot. */
export function StatusPill({
  tone = "neutral",
  children,
  pulse = false,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 font-medium text-xs",
        pillTone[tone],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full bg-current", pulse && "animate-pulse")} />
      {children}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("rounded-2xl bg-background", className)}>
      <EmptyHeader>
        {Icon && (
          <EmptyMedia variant="icon" className="size-12 rounded-2xl">
            <Icon />
          </EmptyMedia>
        )}
        <EmptyTitle>{title}</EmptyTitle>
        {hint && <EmptyDescription>{hint}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : t.errors.unknown;
  return (
    <Alert variant="destructive" className="rounded-2xl">
      <AlertCircleIcon />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{message}</span>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCwIcon />
            {t.common.retry}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function PageLoading() {
  return (
    <div role="status" aria-label={t.common.loading} className="space-y-4">
      <Skeleton className="h-10 w-64 rounded-2xl" />
      <Skeleton className="h-28 w-full rounded-3xl" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48 rounded-3xl" />
        <Skeleton className="h-48 rounded-3xl" />
      </div>
    </div>
  );
}

export function RowsLoading({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label={t.common.loading} className="flex flex-col gap-1.5">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
        <Skeleton key={i} className="h-16 rounded-2xl bg-background" />
      ))}
    </div>
  );
}
