import { ButtonLink, GITHUB_URL } from "../components/site";

const controls = [
  {
    title: "Políticas que fallan cerradas",
    body: "Cada acción pasa por un gateway que evalúa tus reglas. Si una regla no compila o no hay un permiso explícito, la acción se rechaza. Nunca se permite por defecto.",
  },
  {
    title: "Evals antes de publicar",
    body: "Una versión del bot solo se publica si pasa su suite de pruebas con clientes simulados. Si falla, queda rechazada y ves el motivo.",
  },
  {
    title: "Aprobación humana",
    body: "Las misiones se planifican y esperan tu aprobación. Ves a quién se va a contactar, por qué canal y cuánto va a tardar antes de que arranque.",
  },
];

const packs = [
  ["Cobranza AR", "Gestión de mora con tono, horarios y límites pensados para Argentina."],
  ["Ventas AR", "Califica consultas, responde objeciones y agenda al comercial."],
  ["Recepción AR", "Atiende, deriva y agenda turnos por teléfono y WhatsApp."],
];

export default function Home() {
  return (
    <main>
      <section className="mx-auto max-w-5xl px-4 py-20">
        <p className="mb-4 text-sm font-medium text-accent">Front desk autónomo, de código abierto</p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Decile qué hacer, no cómo.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted">
          OpenFrontDesk atiende llamadas y WhatsApp, cobra, vende y agenda por su cuenta. Vos le das el
          objetivo en una frase; él arma el plan, lo ejecuta y te lo reporta, siempre dentro de las reglas
          que definiste.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink primary href="/docs/quickstart">Probalo local con docker compose</ButtonLink>
          <ButtonLink href={GITHUB_URL}>Ver en GitHub</ButtonLink>
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="text-2xl font-semibold">Tres puntos de control</h2>
          <p className="mt-2 max-w-2xl text-muted">Autonomía no es perder el control. Estos tres puntos son innegociables.</p>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {controls.map((c, i) => (
              <div key={c.title} className="rounded-lg border border-line p-5">
                <span className="text-sm font-medium text-accent">0{i + 1}</span>
                <h3 className="mt-1 font-semibold">{c.title}</h3>
                <p className="mt-2 text-sm text-muted">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16">
        <h2 className="text-2xl font-semibold">Packs certificados</h2>
        <p className="mt-2 max-w-2xl text-muted">
          Bots listos para instalar, con sus políticas y su suite de evals ya probadas. Los instalás con un
          comando y los ajustás a tu operación.
        </p>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {packs.map(([name, body]) => (
            <div key={name} className="rounded-lg border border-line bg-surface p-5">
              <h3 className="font-semibold">{name}</h3>
              <p className="mt-2 text-sm text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-16 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold">Código abierto</h2>
            <p className="mt-2 text-muted">
              El núcleo es Apache-2.0. Todo lo que una empresa necesita para operar un bot seguro está
              incluido, y se levanta con un solo comando.
            </p>
          </div>
          <div>
            <h2 className="text-2xl font-semibold">Cloud</h2>
            <p className="mt-2 text-muted">
              Si preferís no operar nada, la versión cloud suma facturación, multi-tenencia administrada,
              SSO, simulación a gran escala y números administrados.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16 text-center">
        <h2 className="text-2xl font-semibold">Empezá en cinco minutos</h2>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink primary href="/docs/quickstart">Probalo local con docker compose</ButtonLink>
          <ButtonLink href={GITHUB_URL}>GitHub</ButtonLink>
        </div>
      </section>
    </main>
  );
}
