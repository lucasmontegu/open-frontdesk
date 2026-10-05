import Link from "next/link";
import type { ReactNode } from "react";

const links = [
  ["/docs", "Introducción"],
  ["/docs/quickstart", "Inicio rápido"],
  ["/docs/arquitectura", "Arquitectura"],
] as const;

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10 md:flex-row">
      <nav aria-label="Documentación" className="flex gap-4 text-sm md:w-48 md:flex-col md:gap-2">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className="text-muted hover:text-fg">{label}</Link>
        ))}
      </nav>
      <article className="min-w-0 flex-1 space-y-4 [&_h1]:text-3xl [&_h1]:font-semibold [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:text-muted [&_li]:text-muted [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </article>
    </div>
  );
}
