import { Code } from "../../../components/site";

export const metadata = { title: "Inicio rápido: OpenFrontDesk" };

export default function Quickstart() {
  return (
    <>
      <h1>Inicio rápido</h1>
      <p>
        Necesitás Docker con Compose. Todo corre local: Postgres, Redis, LiveKit, la API, el worker
        y el dashboard.
      </p>
      <ol>
        <li>
          Cloná el repositorio y levantá todo:
          <Code>{`git clone https://github.com/lucasmontegu/open-frontdesk
cd open-frontdesk
docker compose up -d --build`}</Code>
        </li>
        <li>
          Abrí <code className="font-mono">http://localhost:3000</code> en el navegador.
        </li>
        <li>Registrate. En el primer registro se crea tu organización y quedás como owner.</li>
        <li>
          Instalá un pack: en <strong>Bots</strong>, creá un bot desde un pack certificado (por
          ejemplo Recepción AR). Publicá la versión; se corren sus evals y solo se publica si pasan.
        </li>
        <li>
          Importá tus contactos desde un CSV en <strong>Contactos</strong>.
        </li>
        <li>
          Corré una misión: en <strong>Misiones</strong> escribí qué querés que haga, revisá el plan
          y apretá Aprobar. El reporte se actualiza solo.
        </li>
      </ol>
      <h2>Variables de entorno</h2>
      <p>
        Para que el bot hable necesitás claves de modelo y de voz (
        <code className="font-mono">OPENAI_API_KEY</code>,{" "}
        <code className="font-mono">DEEPGRAM_API_KEY</code>,{" "}
        <code className="font-mono">CARTESIA_API_KEY</code>) y, para WhatsApp,{" "}
        <code className="font-mono">KAPSO_API_KEY</code>. Definilas antes de levantar:
      </p>
      <Code>{`OPENAI_API_KEY=sk-... DEEPGRAM_API_KEY=... docker compose up -d`}</Code>
    </>
  );
}
