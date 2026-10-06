import { Hono } from "hono";
import type { Container } from "./container.js";
import type { AppEnv } from "./http/env.js";
import { body, errorHandler } from "./http/errors.js";
import { authenticate, jsonLogging, requestId } from "./http/middleware.js";
import { createMastraHandler } from "./mastra.js";
import { botRoutes } from "./routes/bots.js";
import { contactRoutes } from "./routes/contacts.js";
import { conversationRoutes, eventRoutes } from "./routes/events.js";
import { healthRoutes } from "./routes/health.js";
import { integrationRoutes } from "./routes/integrations.js";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { missionRoutes } from "./routes/missions.js";
import { packRoutes } from "./routes/packs.js";
import { portfolioRoutes } from "./routes/portfolios.js";
import { settingsRoutes } from "./routes/settings.js";
import { mountDashboard } from "./static.js";

export interface AppOptions {
  /** Directory of the dashboard build to serve at /. */
  dashboardDir?: string;
}

export function createApp(container: Container, opts: AppOptions = {}) {
  const app = new Hono<AppEnv>();
  app.use("*", requestId());
  app.use("*", jsonLogging(container));
  app.onError(errorHandler(container.logger));

  // Public routes.
  app.route("/api/health", healthRoutes(container));
  app.on(["GET", "POST"], "/api/auth/*", (c) => container.auth.handler(c.req.raw));

  // Everything else under /api needs a session with an active organization.
  const api = new Hono<AppEnv>();
  api.use("*", authenticate(container));
  api.route("/contacts", contactRoutes(container));
  api.route("/portfolios", portfolioRoutes(container));
  api.route("/bots", botRoutes(container));
  api.route("/packs", packRoutes(container));
  api.route("/missions", missionRoutes(container));
  api.route("/conversations", conversationRoutes(container));
  api.route("/events", eventRoutes(container));
  api.route("/knowledge", knowledgeRoutes(container));
  api.route("/integrations", integrationRoutes(container));
  api.route("/settings", settingsRoutes(container));
  const mastra = createMastraHandler(container);
  api.all("/mastra/*", (c) => mastra(c.req.raw));
  app.route("/api", api);

  app.notFound((c) => c.json(body("not_found", "Route not found"), 404));
  if (opts.dashboardDir) mountDashboard(app, opts.dashboardDir);
  return app;
}
