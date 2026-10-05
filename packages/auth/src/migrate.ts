import { getMigrations } from "better-auth/db/migration";
import { type AuthConfig, authOptions } from "./auth.js";

/** Creates or updates better-auth's tables (user, session, organization, member, ...). */
export async function migrateAuth(config: AuthConfig): Promise<void> {
  const options = authOptions(config);
  try {
    const { runMigrations } = await getMigrations(options);
    await runMigrations();
  } finally {
    await options.database.end();
  }
}
