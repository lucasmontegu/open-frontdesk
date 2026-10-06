# One image recipe for every OpenFrontDesk process. Pick a process with --target.
#   api           HTTP API + dashboard (port 3000)
#   worker        background jobs
#   voice-worker  LiveKit voice agent
#   web           public site (port 3002)
#   dev           source + dependencies, no build: every app runs in watch mode (docker-compose.dev.yml)

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# Development: dependencies only. docker compose watch syncs the source in and tsx/Vite/Next reload it.
FROM base AS dev
ENV NODE_ENV=development
COPY . .
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build
# Keep only production dependencies for the runtime images.
RUN pnpm deploy --filter @ofd/api --prod --legacy /out/api \
 && pnpm deploy --filter @ofd/worker --prod --legacy /out/worker \
 && pnpm deploy --filter @ofd/voice-worker --prod --legacy /out/voice-worker

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
USER node

FROM runtime AS api
COPY --from=build --chown=node /out/api /app
COPY --from=build --chown=node /app/apps/dashboard/dist /app/public
ENV DASHBOARD_DIR=/app/public PORT=3000
EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM runtime AS worker
COPY --from=build --chown=node /out/worker /app
CMD ["node", "dist/main.js"]

FROM runtime AS voice-worker
COPY --from=build --chown=node /out/voice-worker /app
# Turn detection and noise models are baked into the image so calls never wait on a download.
RUN node dist/main.js download-files
CMD ["node", "dist/main.js", "start"]

FROM runtime AS web
COPY --from=build --chown=node /app/apps/web/.next/standalone /app
COPY --from=build --chown=node /app/apps/web/.next/static /app/apps/web/.next/static
ENV PORT=3002 HOSTNAME=0.0.0.0
EXPOSE 3002
CMD ["node", "apps/web/server.js"]
