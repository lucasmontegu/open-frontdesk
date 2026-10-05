import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { t } from "../i18n";
import { authClient } from "../lib/auth";
import { Button } from "./ui";

const items = [
  { to: "/", label: t.nav.home },
  { to: "/contactos", label: t.nav.contacts },
  { to: "/carteras", label: t.nav.portfolios },
  { to: "/bots", label: t.nav.bots },
  { to: "/misiones", label: t.nav.missions },
  { to: "/actividad", label: t.nav.activity },
] as const;

export function Layout() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data: org } = authClient.useActiveOrganization();

  const signOut = async () => {
    await authClient.signOut();
    await navigate({ to: "/ingresar" });
  };

  return (
    <div className="min-h-screen md:flex">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-2 md:hidden">
        <span className="font-semibold">{t.appName}</span>
        <Button
          variant="secondary"
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen((o) => !o)}
        >
          {t.nav.menu}
        </Button>
      </header>
      <aside
        id="sidebar"
        className={`${open ? "block" : "hidden"} border-b border-line bg-surface p-4 md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0`}
      >
        <div className="mb-6 hidden md:block">
          <p className="font-semibold">{t.appName}</p>
          {org && <p className="truncate text-xs text-muted">{org.name}</p>}
        </div>
        <nav aria-label={t.nav.mainNav} className="flex flex-col gap-1">
          {items.map((i) => (
            <Link
              key={i.to}
              to={i.to}
              onClick={() => setOpen(false)}
              activeOptions={{ exact: i.to === "/" }}
              className="rounded-md px-3 py-2 text-sm text-muted hover:bg-line/50 hover:text-fg"
              activeProps={{
                className: "bg-accent/15 !text-accent font-medium",
                "aria-current": "page",
              }}
            >
              {i.label}
            </Link>
          ))}
        </nav>
        <div className="mt-6 md:mt-auto">
          <Button variant="ghost" className="w-full justify-start" onClick={signOut}>
            {t.nav.signOut}
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
