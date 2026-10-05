import { serve } from "@hono/node-server";
import { migrateAuth } from "@ofd/auth";
import { runMigrations } from "@ofd/db";
import { loadConfig } from "@ofd/infra";
import { createApp } from "./app.js";
import { createContainer } from "./container.js";

async function main() {
  const config = loadConfig();

  if (process.env.OFD_MIGRATE_ON_BOOT !== "false") {
    await runMigrations(config.databaseUrl);
    await migrateAuth({
      databaseUrl: config.databaseUrl,
      secret: config.auth.secret,
      baseURL: config.auth.url,
    });
  }

  const container = await createContainer(config);
  const app = createApp(container, { dashboardDir: process.env.DASHBOARD_DIR });
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    container.logger.info({ port: info.port }, "api listening");
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    container.logger.info({ signal }, "shutting down");
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      (server as { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    await container.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
