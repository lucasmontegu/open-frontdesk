import { migrateAuth } from "@ofd/auth";
import { runMigrations } from "@ofd/db";
import { loadConfig } from "@ofd/infra";

/** One-shot migration entry, used by the `migrate` service in docker compose. */
const config = loadConfig();
await runMigrations(config.databaseUrl);
await migrateAuth({ databaseUrl: config.databaseUrl, secret: config.auth.secret, baseURL: config.auth.url });
console.log("migrations applied");
