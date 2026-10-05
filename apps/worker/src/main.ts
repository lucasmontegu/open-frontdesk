import { createContainer } from "./container.js";
import { registerHandlers } from "./registry.js";

async function main() {
  const container = await createContainer();
  const { log, queue } = container;

  await queue.start();
  const names = await registerHandlers(queue, container.handlers);
  log.info({ queues: names }, "worker started");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "worker stopping");
    try {
      await container.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
