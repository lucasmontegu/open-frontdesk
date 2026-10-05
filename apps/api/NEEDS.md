# Needs

- `better-auth` keeps its own `pg.Pool`, which `createAuth` does not expose, so `container.close()` cannot end it. Suggest `createAuth` returning `{ auth, close }`.
- Mastra mounts with no agents or workflows; registering the mission workflow needs a `MissionPlanner`, which the worker owns today.
