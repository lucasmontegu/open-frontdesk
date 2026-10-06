# OpenFrontDesk

Open-source AI front desk for LATAM: autonomous workers that answer, collect and sell over voice and WhatsApp, under policies you control.

- **Configurable per bot.** Reception, collections or sales, from certified packs (`recepcion-ar`, `cobranza-ar`, `ventas-ar`) or your own config.
- **Autonomy you can dial.** From answering questions (level 1) to owning a goal with a budget (level 4). Natural-language missions such as "Contactá a todos los pacientes de mañana y ofreceles un nuevo turno" are planned, approved and then executed.
- **Safe by construction.** Every tool call goes through a gateway that evaluates CEL policies, fails closed and writes the audit event first. A bot version only goes live after its evals pass.
- **Voice as a cascade.** STT, the same Mastra agent used on WhatsApp, then TTS, on LiveKit. What you test in text is what answers the phone.
- **CRM included.** Contacts, portfolios and obligations built in, or sync with HubSpot and Kommo.
- **Remembers every customer.** Mastra Memory scoped by contact plus extracted facts, all in your own Postgres.

## Run it locally

You need Docker with Compose.

```bash
cp .env.example .env        # add OPENAI_API_KEY at least
docker compose up -d --build
```

| URL | What |
| --- | --- |
| http://localhost:3000 | Dashboard and API (`/api`) |
| http://localhost:3002 | Public site and docs |

`docker compose up` starts Postgres 17 (with pgvector and pg_textsearch), Redis, LiveKit, runs migrations, then starts the API, the jobs worker and the site. Create your account at http://localhost:3000/sign-up.

Voice is opt in, because it needs Deepgram and Cartesia keys (and a SIP trunk for real phone calls):

```bash
docker compose --profile voice up -d --build
```

Without `OPENAI_API_KEY` the app still runs, but publishing a bot only runs the policy evals, not the simulated conversations, and outbound messages use templates.

## Develop

Node 22 and pnpm 10.

```bash
pnpm install
docker compose up -d postgres redis livekit
pnpm db:migrate && pnpm db:seed   # demo organization with contacts and bots
pnpm dev                          # every app in watch mode
pnpm build && pnpm test
```

## Layout

```
apps/       api, worker, voice-worker, dashboard (Vite), web (Next.js)
packages/   core, db, gateway, packs, crm, agent, evals, channels, infra, auth, cli, mcp
docker/     Postgres image and LiveKit config
```

`@ofd/core` holds the domain and the ports. Everything else is an adapter, and each process builds its dependencies in one `container.ts`. Read [ARCHITECTURE.md](ARCHITECTURE.md) for the dependency rules, data model, request flows and HTTP API.

## Use it from your own AI

`@ofd/mcp` is an MCP server that lets Claude, ChatGPT or any MCP client manage contacts, bots and missions. Create an organization API key (`POST /api/auth/api-key/create`) and run it with `OFD_API_URL=http://localhost:3000` and `OFD_API_KEY`.

## License

The core is [Apache-2.0](LICENSE). Cloud-only features will live in `ee/` under a commercial license.
