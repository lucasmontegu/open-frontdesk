# Needs / notes

- Cross-check "every pack policy compiles with the real CEL engine" cannot live in packs or gateway (neither depends on the other, and gateway has no `yaml`). Suggested home: `@ofd/evals` or `@ofd/cli` (both depend on gateway + packs): for each `listBuiltinPacks()` pack, `validateRule(rule)` must be ok for every `pack.policies` rule. I verified manually against `evaluatePolicy` (permit/deny cases for hours, doNotCall, legal flag, identity check): all behave as intended.
- Tool input conventions the policies rely on (agent package must implement the tools accordingly):
  - `recepcion-ar`: `reschedule_appointment` and `cancel_appointment` take `dniLast4: string` in their input; the contact's `attributes.dniLast4` is the reference value. A mismatch or missing value is refused by rule `verificar-identidad`.
  - `cobranza-ar`: contact attribute `reclamo_legal: true` blocks `register_promise_to_pay` / `send_payment_link`.
  - `ventas-ar`: contact attribute `registro_no_llame: true` (or `doNotCall`) blocks contact tools.
- Scenario `outcome` assertion values used: promise_to_pay, transferred, not_contacted, demo_booked, opted_out, rescheduled, appointment_booked. The evals package should map them to conversation outcomes.
- Scenario `now` (optional ISO string) is the simulated clock for time-dependent policies; the evals runner should feed it to the gateway `clock`.
