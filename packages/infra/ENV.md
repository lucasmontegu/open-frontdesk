# Environment variables

Validated at startup by `loadConfig()` from `@ofd/infra`. Empty values count as unset.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| DATABASE_URL | yes | | Postgres 17, e.g. `postgres://ofd:ofd@localhost:5432/ofd` |
| REDIS_URL | yes | | e.g. `redis://localhost:6379` |
| LIVEKIT_URL | yes | | e.g. `ws://localhost:7880` |
| LIVEKIT_API_KEY | yes | | |
| LIVEKIT_API_SECRET | yes | | |
| BETTER_AUTH_SECRET | yes | | At least 16 characters |
| BETTER_AUTH_URL | yes | | Public URL of the API |
| PUBLIC_APP_URL | yes | | Public URL of the dashboard |
| OFD_DEFAULT_MODEL | no | `openai/gpt-5-mini` | Model router id |
| OPENAI_API_KEY | no | | |
| DEEPGRAM_API_KEY | no | | Voice STT |
| CARTESIA_API_KEY | no | | Voice TTS |
| KAPSO_API_KEY | no | | WhatsApp provider |
| KAPSO_BASE_URL | no | | WhatsApp provider base URL |
| PORT | no | `3000` | |
| LOG_LEVEL | no | `info` | fatal, error, warn, info, debug, trace, silent |
| OFD_TIMEZONE | no | `America/Argentina/Buenos_Aires` | |
