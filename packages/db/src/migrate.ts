import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Ensures the required extensions exist, then applies pending migrations. */
export async function runMigrations(url: string): Promise<void> {
  const { db, sql, close } = createDb(url, { max: 1 });
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await sql`CREATE EXTENSION IF NOT EXISTS pg_textsearch`;
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.log("migrations applied"))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
