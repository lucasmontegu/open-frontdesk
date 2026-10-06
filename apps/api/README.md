# @ofd/api

Hono HTTP API for OpenFrontDesk. It is the composition root of the API process (`src/container.ts`), mounts better-auth at `/api/auth`, Mastra's server routes at `/api/mastra`, and optionally serves the dashboard build.

## Run

```bash
pnpm --filter @ofd/api build
DATABASE_URL=postgres://ofd:ofd@localhost:5432/ofd \
REDIS_URL=redis://localhost:6379 \
LIVEKIT_URL=ws://localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=devsecret \
BETTER_AUTH_SECRET=change-me-change-me-change-me \
BETTER_AUTH_URL=http://localhost:3000 PUBLIC_APP_URL=http://localhost:3000 \
node apps/api/dist/main.js
```

`pnpm --filter @ofd/api dev` runs it with tsx in watch mode. On boot it applies the database migrations and better-auth's tables, starts the pg-boss queue, and listens on `PORT`. SIGTERM/SIGINT stop the HTTP server, the job queue, the database pool and Redis.

## Environment

Validated by `loadConfig()` from `@ofd/infra`:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL`, `REDIS_URL` | yes | Postgres 17 (vector + pg_textsearch) and Redis |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | yes | Outbound calls |
| `BETTER_AUTH_SECRET` (16+ chars), `BETTER_AUTH_URL`, `PUBLIC_APP_URL` | yes | Auth; `PUBLIC_APP_URL` is a trusted origin |
| `PORT` | no | Default 3000 |
| `LOG_LEVEL` | no | Default `info` |
| `OFD_DEFAULT_MODEL`, `OFD_TIMEZONE` | no | |
| `OPENAI_API_KEY` | no | When set, the publish gate also runs conversation-level evals |
| `KAPSO_API_KEY`, `KAPSO_BASE_URL`, `KAPSO_PHONE_NUMBER_ID` | no | WhatsApp via Kapso; without them messages are logged by the console provider |
| `LIVEKIT_SIP_TRUNK_ID` | no | Outbound SIP trunk |

App-specific:

| Variable | Notes |
| --- | --- |
| `OFD_MIGRATE_ON_BOOT` | `false` skips migrations on boot (default: run them) |
| `DASHBOARD_DIR` | Path to the dashboard build; served at `/` with SPA fallback to `index.html` for non-`/api` paths |

## Auth and errors

Sign up and sign in through `/api/auth/*` (better-auth, cookie session). Every other `/api` route (except `/api/health`) needs a session with an active organization; the member's role becomes the request `Actor` and each route checks `can(role, resource, action)` from `@ofd/auth`.

Errors are `{ "error": { "code", "message", "details?" } }`: `unauthorized` 401, `not_found` 404, `forbidden` and `policy_refused` 403, `conflict` 409, `invalid` 400 (also request validation), `eval_failed` 422.

## Routes

| Method | Path | Permission |
| --- | --- | --- |
| GET | /api/health | public |
| * | /api/auth/* | better-auth |
| GET, POST | /api/contacts | contacts read / create |
| POST | /api/contacts/import | contacts create. Body `{csv}`; Spanish headers (nombre, telefono, whatsapp, email, dni, monto, vencimiento, etapa, tipo) are mapped automatically |
| GET, PATCH | /api/contacts/:id | contacts read / update. GET returns the contact profile |
| GET, POST | /api/portfolios | portfolios read / create |
| GET | /api/portfolios/:id/members | portfolios read |
| GET, POST | /api/bots | bots read / create (`packId` installs a pack as draft version 1) |
| GET | /api/bots/:id | bots read. `{bot, versions}` |
| POST | /api/bots/:id/versions | bots update |
| POST | /api/bots/:id/versions/:versionId/publish | bots publish. Runs the release gate; 200 `{version, evalRun}` or 422 `eval_failed` with `details.evalRun` |
| GET | /api/packs | bots read |
| GET, POST | /api/missions | missions read / create (needs a published bot; enqueues `mission.plan`) |
| GET | /api/missions/:id | missions read |
| POST | /api/missions/:id/approve | missions approve (enqueues `mission.execute`) |
| GET | /api/conversations/:id/events | calls read |
| GET | /api/events | calls read. Filters `type`, `contactId`, `limit`, `cursor` |
| GET, POST | /api/knowledge | search (`q`) / ingest |
| GET, PUT, DELETE | /api/settings/contact-window | policies read / update. `{window, source}`; `source` is `organization` or `default`. PUT takes `{timezone, rules: [{days, start, end}]}`, DELETE goes back to the default |
| * | /api/mastra/* | Mastra server (initialized lazily on first request) |

List endpoints return `{items, nextCursor}`.

## Tests

`pnpm --filter @ofd/api test` builds the app with `createApp(container)` against the local Postgres, real better-auth, and doubles for the queue, holds, channels and the release gate. See `src/test/helpers.ts`.
