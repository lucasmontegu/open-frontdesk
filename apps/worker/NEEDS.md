# Needs

- **Goals port**: core has `GoalSpec` but no `GoalRepository` / goals table. `goal.tick` is wired with `goals: null` (logged no-op).
- **Appointments by date**: no repository port lists obligations by `due_at`; the worker queries the `obligations` table with raw SQL (`src/appointments.ts`). A `ObligationRepository.listByDue(orgId, {kind, from, to})` would replace it.
- **CalendarProvider**: the worker uses `InMemoryCalendar` (no slots), so reschedule offers carry `slotId: null` until a real provider exists.
- **Per-org CRM connector settings** (credentials) instead of env vars.
- **Mission target concurrency**: target statuses live inside the mission plan JSON (read-modify-write). Safe with one worker handling jobs one at a time; needs a row lock or a targets table before scaling out.
