import Link from "next/link";

export default function DocsIndex() {
  return (
    <>
      <h1>Documentación</h1>
      <p>
        OpenFrontDesk es un front desk autónomo y de código abierto. Estas guías te llevan de cero a
        tu primera misión.
      </p>
      <ul>
        <li>
          <Link className="text-accent underline" href="/docs/quickstart">
            Inicio rápido
          </Link>
          : levantalo con docker compose.
        </li>
        <li>
          <Link className="text-accent underline" href="/docs/arquitectura">
            Arquitectura
          </Link>
          : cómo está armado por dentro.
        </li>
      </ul>
    </>
  );
}
