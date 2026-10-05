import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button, Card, ErrorNote, Input } from "../components/ui";
import { t } from "../i18n";
import { authClient, slugify } from "../lib/auth";

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <p className="text-lg font-semibold">{t.appName}</p>
          <p className="text-sm text-muted">{t.auth.welcome}</p>
        </div>
        <Card title={title}>{children}</Card>
      </div>
    </main>
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
    const res = await authClient.signIn.email({ email: String(f.get("email")), password: String(f.get("password")) });
    setBusy(false);
    if (res.error) return setError(res.error.message ?? t.errors.unknown);
    await navigate({ to: "/" });
  };

  return (
    <Shell title={t.auth.signInTitle}>
      <form onSubmit={submit} className="space-y-4">
        <Input label={t.auth.email} name="email" type="email" autoComplete="email" required />
        <Input label={t.auth.password} name="password" type="password" autoComplete="current-password" required />
        {error && <ErrorNote error={new Error(error)} />}
        <Button type="submit" disabled={busy} className="w-full">
          {t.auth.signIn}
        </Button>
        <p className="text-center text-sm text-muted">
          {t.auth.noAccount}{" "}
          <Link to="/registro" className="text-accent underline">
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
    <Shell title={t.auth.signUpTitle}>
      <form onSubmit={submit} className="space-y-4">
        <Input label={t.auth.yourName} name="name" autoComplete="name" required />
        <Input label={t.auth.orgName} name="org" required />
        <Input label={t.auth.email} name="email" type="email" autoComplete="email" required />
        <Input label={t.auth.password} name="password" type="password" autoComplete="new-password" minLength={8} hint={t.auth.passwordHint} required />
        {error && <ErrorNote error={new Error(error)} />}
        <Button type="submit" disabled={busy} className="w-full">
          {t.auth.signUp}
        </Button>
        <p className="text-center text-sm text-muted">
          {t.auth.haveAccount}{" "}
          <Link to="/ingresar" className="text-accent underline">
            {t.auth.signIn}
          </Link>
        </p>
      </form>
    </Shell>
  );
}
