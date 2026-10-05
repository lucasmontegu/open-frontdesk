# Needs / notes

- `runReleaseGate` input accepts a superset of the agreed `conversation: { model: string }`: `model` may also be a model object, plus optional `botModel` and `maxTurns`. The simulated customer uses `model`; the bot under test uses `botVersion.config.model` unless `botModel` is given.
- Level 2 knowledge search is an empty stub (no knowledge base in the simulated world), so `search_knowledge` returns no results.
