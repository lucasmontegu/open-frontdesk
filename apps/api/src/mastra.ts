import { Mastra } from "@mastra/core/mastra";
import { MastraServer } from "@mastra/hono";
import { Hono } from "hono";
import type { Container } from "./container.js";

/**
 * Mastra's server routes, mounted under /api/mastra.
 *
 * Agents are built per bot version at runtime (see @ofd/agent), so nothing is registered
 * globally. Mastra's adapter registers its routes asynchronously, so it initializes lazily on
 * the first request instead of making createApp async.
 * TODO: register the mission workflow (createMissionWorkflow) once the API has a planner to give it.
 */
export function createMastraHandler(container: Container) {
  let ready: Promise<Hono> | null = null;

  const init = async () => {
    const mastra = new Mastra({ logger: false });
    const app = new Hono();
    await new MastraServer({ app, mastra, prefix: "" } as ConstructorParameters<
      typeof MastraServer
    >[0]).init();
    return app;
  };

  return async (req: Request): Promise<Response> => {
    ready ??= init().catch((err) => {
      ready = null;
      container.logger.error({ err }, "mastra init failed");
      throw err;
    });
    const app = await ready;
    const url = new URL(req.url);
    url.pathname = url.pathname.replace(/^\/api\/mastra/, "") || "/";
    return app.fetch(new Request(url, req));
  };
}
