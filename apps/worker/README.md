# @ofd/worker

pg-boss job handlers. `src/container.ts` is the only place that creates clients; `src/main.ts` starts the queue and registers one handler per job name. Handlers in `src/jobs/` are pure functions of `(deps, data)` and are tested with fakes.

| Job | Payload | What it does |
| --- | --- | --- |
| `mission.plan` | `{orgId, missionId, ...}` | Picks a planner from the instruction (turno/cita wording: `planRescheduleMission`; otherwise the members of a portfolio), saves the plan, `awaiting_approval` when autonomy <= 3, else enqueues `mission.execute`. Appends `mission.planned`. |
| `mission.execute` | `{orgId, missionId, approvedBy?}` | One `mission.contact` per pending target (singleton per mission+contact), status `running`. Idempotent: accepts a mission already `running`. |
| `mission.contact` | `MissionContactJob` | Starts a conversation and sends the offer with the gateway's `send_whatsapp` (agent-composed with a model key, template without). Schedules a check job; if nobody replied and the strategy has a fallback it dials via `TelephonyProvider`. Settles the target; when all are final writes the `MissionReport`, status `completed`, `mission.completed`. |
| `conversation.extract_facts` | `{orgId, conversationId}` | Facts from the event log (model when `OPENAI_API_KEY` is set, deterministic rules otherwise) into `ContactFactRepository` with `sourceEventId` + confidence, appends `fact.extracted`. |
| `goal.tick` | `{orgId, goalId}` | Skeleton: honors `minIntervalMinutes`, auto-disables after `maxConsecutiveFailures`. No-op until a goal store exists. |
| `crm.sync` | `{orgId, connectorId, since?}` | Pulls through `CrmSyncService`. Connectors come from `HUBSPOT_TOKEN` / `KOMMO_TOKEN`+`KOMMO_BASE_URL`. |

Policies for the gateway are the org rules plus the policies of the bot version's pack (`getBuiltinPack`).

Optional env beyond `@ofd/infra`'s: `KAPSO_PHONE_NUMBER_ID` (with `KAPSO_API_KEY` + `KAPSO_BASE_URL` for real WhatsApp; otherwise messages are logged), `LIVEKIT_SIP_TRUNK_ID` (outbound calls).

```
pnpm --filter @ofd/worker build && pnpm --filter @ofd/worker start
pnpm --filter @ofd/worker test
```
