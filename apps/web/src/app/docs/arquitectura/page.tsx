export const metadata = { title: "Arquitectura: OpenFrontDesk" };

const principles = [
  ["Puertos y adaptadores", "El dominio y las interfaces viven en @ofd/core. Postgres, Redis, LiveKit, Kapso o un CRM externo son adaptadores."],
  ["Una raíz de composición por proceso", "api, worker y voice-worker arman sus dependencias en un único container.ts."],
  ["Toda acción pasa por el gateway", "Los bots nunca llaman a un handler directo. El gateway evalúa la política CEL (falla cerrado), registra la auditoría y recién después ejecuta."],
  ["Los eventos son el registro", "Las interacciones son eventos append-only. Evals, analítica, replay y extracción de hechos leen ese log."],
  ["Aislamiento por organización en el backend", "Cada método de repositorio recibe orgId primero y filtra por él."],
  ["El mismo agente en todos los canales", "La voz corre como cascada (STT, agente Mastra, TTS) sobre LiveKit: el mismo agente que atiende el teléfono se prueba en evals de texto y responde por WhatsApp."],
  ["Autoalojarlo es un comando", "docker compose up levanta todo. La infraestructura es Postgres, Redis y LiveKit."],
];

const packages = [
  ["core", "tipos de dominio, eventos y puertos"],
  ["db", "esquema Drizzle, repositorios, búsqueda de conocimiento (BM25 + vectores)"],
  ["gateway", "ToolGateway: políticas CEL y auditoría"],
  ["packs", "packs certificados (cobranza-ar, ventas-ar, recepcion-ar)"],
  ["crm", "servicios de CRM, importación CSV, conectores (HubSpot, Kommo)"],
  ["agent", "fábrica de agentes Mastra, herramientas, memoria, workflow de misiones"],
  ["evals", "escenarios, clientes simulados y compuerta de publicación"],
  ["channels", "WhatsApp (Kapso) y telefonía (LiveKit SIP)"],
  ["auth", "better-auth con organizaciones y roles"],
];

const flows = [
  ["Llamada entrante", "LiveKit SIP despacha al voice-worker, que identifica al contacto por teléfono, precarga su perfil y corre la versión publicada del bot. Al cortar, se encola la extracción de hechos."],
  ["Misión", "POST /api/missions guarda la instrucción y encola la planificación. El worker arma el plan (destinatarios, turnos reservados, estrategia de canal, estimación). Con autonomía 3 queda esperando aprobación; al aprobar, se ejecuta un job por contacto. Los turnos se reservan en Redis para no ofrecer el mismo a dos personas."],
  ["Publicar una versión", "Se corre la suite de evals de la versión. Si falla, se rechaza; solo una versión que pasa queda publicada."],
];

export default function Architecture() {
  return (
    <>
      <h1>Arquitectura</h1>
      <p>Resumen de ARCHITECTURE.md, el mapa del código. Las decisiones de producto viven en el PRD.</p>
      <h2>Principios</h2>
      <ol>
        {principles.map(([t, b]) => (
          <li key={t}><strong className="text-fg">{t}.</strong> {b}</li>
        ))}
      </ol>
      <h2>Paquetes</h2>
      <ul>
        {packages.map(([n, d]) => (
          <li key={n}><code className="font-mono text-fg">{n}</code>: {d}</li>
        ))}
      </ul>
      <p>
        Apps: <code className="font-mono">api</code> (Hono, sirve el dashboard), <code className="font-mono">worker</code>{" "}
        (pg-boss), <code className="font-mono">voice-worker</code> (LiveKit), <code className="font-mono">dashboard</code> y{" "}
        <code className="font-mono">web</code>. Las dependencias van siempre de las apps hacia los paquetes y de los paquetes
        hacia core.
      </p>
      <h2>Datos</h2>
      <p>
        Postgres 17 con pgvector y pg_textsearch (BM25). Dominios: identidad, bots y versiones, CRM, interacciones
        (eventos append-only), misiones y conocimiento. La memoria de Mastra vive en el esquema mastra, con alcance por
        contacto: un contacto se recuerda entre canales.
      </p>
      <h2>Flujos</h2>
      <ul>
        {flows.map(([t, b]) => (
          <li key={t}><strong className="text-fg">{t}.</strong> {b}</li>
        ))}
      </ul>
      <h2>Roles</h2>
      <p>owner, admin, supervisor, operator y viewer, con permisos por recurso y por cartera asignada.</p>
      <h2>Código abierto y cloud</h2>
      <p>
        El núcleo es Apache-2.0. Facturación, multi-tenencia administrada, SSO/SCIM, simulación a gran escala y números
        administrados irán en <code className="font-mono">ee/</code> con licencia comercial.
      </p>
    </>
  );
}
