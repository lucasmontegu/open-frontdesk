import Link from "next/link";
import type { ReactNode } from "react";

export const GITHUB_URL = "https://github.com/lucasmontegu/open-frontdesk";

export function Header() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="font-semibold">
          OpenFrontDesk
        </Link>
        <nav className="flex items-center gap-5 text-sm text-muted">
          <Link href="/docs" className="hover:text-fg">
            Docs
          </Link>
          <a href={GITHUB_URL} className="hover:text-fg">
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line py-8 text-center text-sm text-muted">
      OpenFrontDesk, Apache-2.0. Hecho en Argentina.
    </footer>
  );
}

export function ButtonLink({
  href,
  children,
  primary,
}: {
  href: string;
  children: ReactNode;
  primary?: boolean;
}) {
  const cls = primary ? "bg-accent text-accent-fg" : "border border-line bg-surface text-fg";
  return (
    <a
      href={href}
      className={`inline-flex items-center rounded-md px-5 py-3 text-sm font-medium ${cls}`}
    >
      {children}
    </a>
  );
}

export function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-line bg-surface p-4 font-mono text-sm">
      <code>{children}</code>
    </pre>
  );
}
