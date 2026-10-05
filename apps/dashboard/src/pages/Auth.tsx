import { Link, useNavigate } from "@tanstack/react-router";
import { CheckIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Logo } from "@/components/app-shell";
import { BotAvatar } from "@/components/bot-avatar";
import { ErrorNote } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";
import { authClient, slugify } from "@/lib/auth";

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen bg-canvas p-3">
      <section className="relative hidden flex-1 flex-col justify-between overflow-hidden rounded-[28px] bg-hero p-10 text-hero-foreground lg:flex">
        <div className="flex items-center gap-3 font-semibold text-lg">
          <Logo className="bg-white text-black" />
          {t.appName}
        </div>
        <div className="relative z-10 max-w-md">
          <p className="text-balance font-semibold text-4xl leading-tight tracking-tight">
            {t.auth.welcome}
          </p>
          <p className="mt-4 text-hero-foreground/70">{t.auth.pitch}</p>
          <ul className="mt-8 space-y-3">
            {t.auth.points.map((p) => (
              <li key={p} className="flex items-center gap-3 text-sm">
                <span className="flex size-6 items-center justify-center rounded-full bg-brand">
                  <CheckIcon className="size-3.5" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex gap-3" aria-hidden>
          {["sofia", "cobranza", "ventas", "recepcion"].map((s) => (
            <BotAvatar key={s} seed={s} size={56} />
          ))}
        </div>
      </section>
      <section className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 font-semibold lg:hidden">
            <Logo />
            {t.appName}
          </div>
          <h1 className="font-semibold text-3xl tracking-tight">{title}</h1>
          <p className="mt-1 mb-8 text-muted-foreground">{subtitle}</p>
          {children}
        </div>
      </section>
    </main>
  );
}

function Field({
  id,
  label,
  hint,
  ...props
}: React.ComponentProps<typeof Input> & { id: string; label: string; hint?: string }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} className="h-11 bg-background" {...props} />
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

export function SignInPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await authClient.signIn.email({
      email: String(f.get("email")),
      password: String(f.get("password")),
    });
    setBusy(false);
    if (res.error) return setError(res.error.message ?? t.errors.unknown);
    await navigate({ to: "/" });
  };

  return (
    <Shell title={t.auth.signInTitle} subtitle={t.auth.signInSubtitle}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field id="email" label={t.auth.email} type="email" autoComplete="email" required />
        <Field
          id="password"
          label={t.auth.password}
          type="password"
          autoComplete="current-password"
          required
        />
        {error && <ErrorNote error={new Error(error)} />}
        <Button type="submit" size="lg" disabled={busy} className="mt-2 w-full">
          {t.auth.signIn}
        </Button>
        <p className="text-center text-muted-foreground text-sm">
          {t.auth.noAccount}{" "}
          <Link to="/sign-up" className="font-medium text-foreground underline underline-offset-4">
            {t.auth.signUp}
          </Link>
        </p>
      </form>
    </Shell>
  );
}

export function SignUpPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const orgName = String(f.get("org")).trim();
    setBusy(true);
    setError(null);
    const up = await authClient.signUp.email({
      name: String(f.get("name")),
      email: String(f.get("email")),
      password: String(f.get("password")),
    });
    if (up.error) {
      setBusy(false);
      return setError(up.error.message ?? t.errors.unknown);
    }
    // First sign-up creates the organization and makes it the active one.
    const org = await authClient.organization.create({ name: orgName, slug: slugify(orgName) });
    if (org.error || !org.data) {
      setBusy(false);
      return setError(org.error?.message ?? t.errors.unknown);
    }
    await authClient.organization.setActive({ organizationId: org.data.id });
    setBusy(false);
    await navigate({ to: "/" });
  };

  return (
    <Shell title={t.auth.signUpTitle} subtitle={t.auth.signUpSubtitle}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field id="name" label={t.auth.yourName} autoComplete="name" required />
        <Field id="org" label={t.auth.orgName} required />
        <Field id="email" label={t.auth.email} type="email" autoComplete="email" required />
        <Field
          id="password"
          label={t.auth.password}
          type="password"
          autoComplete="new-password"
          minLength={8}
          hint={t.auth.passwordHint}
          required
        />
        {error && <ErrorNote error={new Error(error)} />}
        <Button type="submit" size="lg" disabled={busy} className="mt-2 w-full">
          {t.auth.signUp}
        </Button>
        <p className="text-center text-muted-foreground text-sm">
          {t.auth.haveAccount}{" "}
          <Link to="/sign-in" className="font-medium text-foreground underline underline-offset-4">
            {t.auth.signIn}
          </Link>
        </p>
      </form>
    </Shell>
  );
}
