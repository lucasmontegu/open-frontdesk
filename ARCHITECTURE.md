# OpenFrontDesk architecture

OpenFrontDesk is an open-source, self-hostable AI front desk: autonomous workers that answer, collect and sell over voice and WhatsApp, under policies you control. This file is the map of the code. Product decisions live in the PRD v2.

## Principles

1. **Ports and adapters.** `@ofd/core` holds the domain model and the interfaces (ports). It depends on nothing but zod. Every piece of infrastructure (Postgres, Redis, LiveKit, Kapso, an external CRM) is an adapter behind a port.
2. **One composition root per process.** `apps/api`, `apps/worker` and `apps/voice-worker` each build their dependencies in one `container.ts`. Nothing else creates a database client, a Redis client or a provider.
3. **Every action goes through the gateway.** Bots never call a handler directly. `ToolGateway.call` resolves the tool, evaluates CEL policy (fail closed), appends the audit event and only then runs the handler.
4. **Events are the record.** Interactions are append-only `InteractionEvent`s. Evals, analytics, replay and fact extraction read the event log.
5. **Org isolation in the backend.** Every repository method takes `orgId` first and filters by it.
6. **Same agent, every channel.** Voice runs as a cascade (STT, Mastra agent, TTS) on LiveKit, so the agent that answers the phone is the same one tested in text evals and the same one on WhatsApp.
7. **Self-host is one command.** `docker compose up` runs everything. The only infrastructure is Postgres, Redis and LiveKit.

## Layout

```
packages/
  core/      domain types, events, ports. No infrastructure.
  db/        Drizzle schema, migrations, repository adapters, knowledge search (BM25 + vectors), seed
  gateway/   ToolGateway implementation: CEL policies (fail closed) + audit
  packs/     certified packs (cobranza-ar, ventas-ar, recepcion-ar) and their loader
  crm/       CRM services, CSV import, external CRM connectors (HubSpot, Kommo)
  agent/     Mastra agent factory, built-in tools, memory, mission workflow
  evals/     scenarios, simulated customers, event-log assertions, publish gate
  channels/  MessagingProvider (Kapso WhatsApp), TelephonyProvider (LiveKit SIP)
  infra/     env config, logger, Redis HoldStore, pg-boss JobQueue
  auth/      better-auth with organizations, roles and access control
  cli/       `ofd` command: migrate, seed, pack install, eval run
  mcp/       MCP server so a customer's own AI can configure the product
apps/
  api/           Hono HTTP API, Mastra mounted under /api/mastra, serves the dashboard build
  worker/        pg-boss jobs: missions, fact extraction, goals, CRM sync
  voice-worker/  LiveKit agent worker (@mastra/livekit) running the cascade
  dashboard/     Vite + React + TanStack Router operator dashboard
  web/           Next.js public site and docs
docker/          Postgres image (pgvector + pg_textsearch), LiveKit config
```

Dependency direction (never the other way):

```
apps/*  ->  agent, evals, crm, channels, infra, auth, db, gateway, packs  ->  core
```

`gateway`, `packs`, `crm`, `channels` depend only on `core`. `agent` depends on `core` + `gateway`. `evals` depends on `core`, `gateway`, `packs`, `agent`.

## Data

Postgres 17 with `vector` (pgvector) and `pg_textsearch` (BM25). One database, logical domains:

| Domain | Tables |
| --- | --- |
| Identity (better-auth) | user, session, account, verification, organization, member, invitation |
| Bots | bots, bot_versions, policies, eval_runs |
| CRM | contacts, contact_identities, portfolios, obligations, contact_facts |
| Interactions | conversations, events (append-only) |
| Work | missions |
| Knowledge | knowledge_docs (BM25 index on content, `vector(1536)` embedding) |

Mastra stores its own memory tables (threads, messages, working memory) in the same database under the `mastra` schema. Memory is scoped by `resourceId = contactId`, so a contact is remembered across channels.

## Request flows

**Inbound call.** Twilio or a SIP trunk reaches LiveKit SIP, LiveKit dispatches `voice-worker`, which identifies the contact by phone, preloads the profile (`ProfileLoader`), and runs the bot's published version through the cascade. Each tool call goes through the gateway. When the call ends, `conversation.extract_facts` is queued.

**Mission.** `POST /api/missions` stores the instruction and queues `mission.plan`. The worker builds a plan (targets, held slots, channel strategy, estimate). With autonomy 3 the mission waits in `awaiting_approval`; `POST /api/missions/:id/approve` queues `mission.execute`, which fans out one `mission.contact` job per target. Slots are held in Redis (`HoldStore`) so no two contacts are offered the same one. Attempts outside the contact window (`OFD_CONTACT_DAYS`, `OFD_CONTACT_HOURS`) are deferred to its next opening.

**Publishing a bot version.** `POST /api/bots/:id/versions/:versionId/publish` runs the version's eval suite. A failing suite rejects the version; only a passing one becomes the published version.

## HTTP API

All routes are under `/api` and use JSON. People authenticate with the better-auth session cookie and act in the session's active organization. Machine clients (the MCP server, integrations) send an organization API key as `Authorization: Bearer ofd_...` and act as admin of the organization that owns the key; keys are created at `POST /api/auth/api-key/create`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /health | Liveness, DB and Redis checks |
| * | /auth/* | better-auth (sign-up, sign-in, organizations, invitations) |
| GET/POST | /contacts | List (search, cursor) / create |
| GET/PATCH | /contacts/:id | Read with profile / update |
| POST | /contacts/import | CSV import |
| GET/POST | /portfolios | List / create |
| GET | /portfolios/:id/members | Contacts and obligations matching the rule |
| GET/POST | /bots | List / create (optionally from a pack) |
| GET | /bots/:id | Bot with versions |
| POST | /bots/:id/versions | New draft version |
| POST | /bots/:id/versions/:versionId/publish | Run evals, publish if they pass |
| GET | /packs | Installed packs |
| GET/POST | /missions | List / create from an instruction |
| GET | /missions/:id | Mission with plan and report |
| POST | /missions/:id/approve | Approve a planned mission |
| GET | /conversations/:id/events | Event log of one conversation |
| GET | /events | Recent events (audit) |
| GET/POST | /knowledge | Search / ingest documents |
| * | /mastra/* | Mastra server (agents, workflows) via @mastra/hono |

Errors are `{ "error": { "code": string, "message": string } }`, mapped from `DomainError` codes.

## Roles

| Role | Can |
| --- | --- |
| owner | Everything, including billing |
| admin | Members, bots, policies, connectors |
| supervisor | Calls, recordings, takeover, approve missions and playbook changes, in assigned portfolios |
| operator | Receive transfers, handle conversations |
| viewer | Read metrics and calls, no recordings |

## Configuration

All configuration is environment variables, validated at startup by `@ofd/infra`'s `loadConfig()`. See `.env.example`.

## Open source and cloud

[docs/infrastructure.md](docs/infrastructure.md) has the plan for the managed cloud and for campaigns of 100k contacts.

The core is Apache-2.0. Cloud-only features (billing, managed multi-tenancy, SSO/SCIM, large-scale simulation, managed numbers) will live in `ee/` under a commercial license. Everything a single company needs to run a safe bot stays in the core.
