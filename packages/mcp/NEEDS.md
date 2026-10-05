# Needs / notes

- The server sends `Authorization: Bearer <OFD_API_KEY>`. `ARCHITECTURE.md` says the API authenticates with the better-auth session cookie; `apps/api` must also accept bearer API keys (e.g. better-auth's api-key plugin, resolving to an actor with an org and a role) for this server to work against a real API.
- `create_bot_from_pack` has an optional `publish` flag (runs the release evals and publishes the draft) because missions require a published version and no other tool can publish.
