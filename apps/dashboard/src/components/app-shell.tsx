import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import {
  AudioLinesIcon,
  BlocksIcon,
  BotIcon,
  FolderKanbanIcon,
  LanguagesIcon,
  LayoutGridIcon,
  LogOutIcon,
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  SendIcon,
  ShieldCheckIcon,
  SunIcon,
  UsersIcon,
} from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type Theme, useTheme } from "@/hooks/use-theme";
import { type Locale, locale, locales, setLocale, t } from "@/i18n";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: t.nav.home, icon: LayoutGridIcon },
  { to: "/bots", label: t.nav.bots, icon: BotIcon },
  { to: "/missions", label: t.nav.missions, icon: SendIcon },
  { to: "/contacts", label: t.nav.contacts, icon: UsersIcon },
  { to: "/portfolios", label: t.nav.portfolios, icon: FolderKanbanIcon },
  { to: "/activity", label: t.nav.activity, icon: ShieldCheckIcon },
  { to: "/connectors", label: t.nav.connectors, icon: BlocksIcon },
] as const;

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-11 items-center justify-center rounded-2xl bg-foreground text-background",
        className,
      )}
    >
      <AudioLinesIcon className="size-5" />
    </span>
  );
}

function initials(name: string | undefined): string {
  return (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/** Missions waiting on a person get a badge on the rail, like an inbox. */
function useAwaitingApproval(): number {
  const q = useQuery({
    queryKey: ["missions"],
    queryFn: api.missions.list,
    refetchInterval: 30_000,
  });
  return (q.data?.items ?? []).filter((m) => m.status === "awaiting_approval").length;
}

function AccountMenu({ side = "right" }: { side?: "right" | "top" }) {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const { data: org } = authClient.useActiveOrganization();
  const { theme, setTheme } = useTheme();

  const signOut = async () => {
    await authClient.signOut();
    await navigate({ to: "/sign-in" });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-full outline-none ring-ring/50 focus-visible:ring-[3px]"
          aria-label={session?.user.name ?? t.nav.menu}
        >
          <Avatar className="size-11 border-2 border-background shadow-sm">
            <AvatarFallback className="bg-brand-soft font-semibold text-brand">
              {initials(session?.user.name)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="end" className="w-60 rounded-2xl p-1.5">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate font-medium">{session?.user.name}</p>
          <p className="truncate text-muted-foreground text-xs">
            {org?.name ?? session?.user.email}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2 rounded-xl">
            {theme === "dark" ? <MoonIcon /> : theme === "light" ? <SunIcon /> : <MonitorIcon />}
            {t.account.theme}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="rounded-2xl">
            <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
              {(["light", "dark", "system"] as const).map((v) => (
                <DropdownMenuRadioItem key={v} value={v} className="rounded-xl">
                  {t.account.themes[v]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2 rounded-xl">
            <LanguagesIcon className="size-4 text-muted-foreground" />
            {t.account.language}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="rounded-2xl">
            <DropdownMenuRadioGroup value={locale} onValueChange={(v) => setLocale(v as Locale)}>
              {locales.map((l) => (
                <DropdownMenuRadioItem key={l.id} value={l.id} className="rounded-xl">
                  {l.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut} className="rounded-xl">
          <LogOutIcon />
          {t.nav.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CountBadge({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-canvas bg-destructive px-1 font-semibold text-[10px] text-white tabular-nums">
      {n > 99 ? "99+" : n}
    </span>
  );
}

function Rail({ awaiting }: { awaiting: number }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[88px] shrink-0 flex-col items-center py-4 md:flex">
      <Link to="/" aria-label={t.appName}>
        <Logo />
      </Link>
      <span className="my-4 h-px w-8 bg-border" />
      <nav aria-label={t.nav.mainNav} className="flex flex-1 flex-col items-center gap-1.5">
        {nav.map(({ to, label, icon: Icon }) => (
          <Tooltip key={to}>
            <TooltipTrigger asChild>
              <Link
                to={to}
                activeOptions={{ exact: to === "/" }}
                className="group flex w-[72px] flex-col items-center gap-1 rounded-2xl py-1.5 text-muted-foreground outline-none ring-ring/50 transition-colors hover:text-foreground focus-visible:ring-[3px]"
                activeProps={{ className: "!text-foreground", "aria-current": "page" }}
              >
                <span className="relative flex size-11 items-center justify-center rounded-2xl transition-colors group-hover:bg-background/70 group-aria-[current=page]:bg-background group-aria-[current=page]:shadow-sm">
                  <Icon className="size-5" />
                  {to === "/missions" && <CountBadge n={awaiting} />}
                </span>
                <span className="max-w-full truncate px-1 font-medium text-[11px]">{label}</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ))}
      </nav>
      <AccountMenu />
    </aside>
  );
}

function MobileBar({ awaiting }: { awaiting: number }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-canvas/90 px-4 py-3 backdrop-blur md:hidden">
      <Link to="/" className="flex items-center gap-2 font-semibold">
        <Logo className="size-9 rounded-xl" />
        {t.appName}
      </Link>
      <div className="flex items-center gap-2">
        <AccountMenu side="top" />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon-lg" aria-label={t.nav.menu} className="relative">
              <MenuIcon />
              <CountBadge n={awaiting} />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 bg-canvas p-4">
            <SheetTitle className="flex items-center gap-2 px-2 pt-2">
              <Logo className="size-9 rounded-xl" />
              {t.appName}
            </SheetTitle>
            <nav aria-label={t.nav.mainNav} className="mt-4 flex flex-col gap-1">
              {nav.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setOpen(false)}
                  activeOptions={{ exact: to === "/" }}
                  className="flex items-center gap-3 rounded-2xl px-3 py-2.5 font-medium text-muted-foreground text-sm hover:bg-background/70 hover:text-foreground"
                  activeProps={{
                    className: "bg-background !text-foreground shadow-sm",
                    "aria-current": "page",
                  }}
                >
                  <Icon className="size-5" />
                  {label}
                  {to === "/missions" && awaiting > 0 && (
                    <span className="ml-auto rounded-full bg-destructive px-2 text-white text-xs">
                      {awaiting}
                    </span>
                  )}
                </Link>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}

/** Grey canvas, icon rail on the left, the page in a big white rounded panel. */
export function AppShell() {
  const awaiting = useAwaitingApproval();
  return (
    <div className="min-h-screen bg-canvas md:flex">
      <Rail awaiting={awaiting} />
      <MobileBar awaiting={awaiting} />
      <main className="min-w-0 flex-1 md:py-3 md:pr-3">
        <div className="min-h-[calc(100vh-1.5rem)] bg-background md:rounded-[28px] md:shadow-sm">
          <div className="mx-auto max-w-6xl px-4 py-6 md:px-10 md:py-10">
            <Outlet />
          </div>
        </div>
      </main>
      <Toaster position="bottom-right" />
    </div>
  );
}
