# Cloud infrastructure and large campaigns

Status: proposal (2026-10-06). Nothing here is provisioned yet. The goal is a managed cloud that runs the same images as `docker compose`, so self-hosting stays one command and the cloud is "the same thing, operated for you".

## The workload

A campaign of 100,000 contacts is not a compute problem. Each contact is a few small jobs plus, for voice, one call of a few minutes. What limits throughput is everything around the call:

| Limit | Where it comes from | What it means for us |
| --- | --- | --- |
| Concurrent calls | SIP trunk channels, voice-worker capacity, STT/TTS/LLM rate limits | A per-org and per-trunk ceiling we must enforce, not discover |
| Calls per second | Carrier CPS limits | Starting calls must be paced, not fanned out |
| WhatsApp volume | Meta messaging limits per business (tiers of unique users per 24 h) and template rules outside the 24 h window | A per-sender daily budget |
| Contact hours | Law and good practice (configurable per org and use case) | Attempts outside the window wait, they do not run |
| Do-not-call | Argentina's Registro Nacional No Llame (Ley 26.951), the contact's own opt-out | Scrubbed at plan time and re-checked before each attempt |
| Attempts per contact | Regulation for collections, customer experience | A cap per contact per day and per campaign |

Rough sizing for voice: calls per hour ≈ concurrent lines × 60 / average minutes per attempt (ringing and no-answers included). With 50 lines and 2.5 minutes per attempt that is about 1,200 attempts an hour, so 100k contacts take about 83 hours, or 7 to 8 days of 11-hour windows. With 200 lines it is about 2 days. Starting on WhatsApp and calling only those who do not answer cuts the voice volume a lot.

The cost of a campaign is dominated by per-minute telephony, STT, TTS and LLM tokens, not by servers. Infrastructure choices should optimize for reliability and latency first.

## What changes in the code

Today `mission.execute` enqueues one `mission.contact` job per target at once, and target status lives inside the mission's plan JSON. That is fine for a few hundred contacts on one worker. For 100k it breaks in three places: the plan row is rewritten on every status change, nothing limits how many calls start at once, and pausing a mission means cancelling thousands of queued jobs.

The design that replaces it keeps durable state in Postgres and uses the queue only for short work:

1. **`mission_targets` table.** One row per contact: status, channel, attempts, `next_attempt_at`, `lease_until`, last outcome. The report becomes a `GROUP BY status`. 100k rows is small for Postgres.
2. **A dispatcher instead of a fan-out.** A `mission.dispatch` job runs every few seconds per running mission. It computes free capacity (org and trunk concurrency, CPS and WhatsApp budgets), checks the contact window, claims that many due targets with `SELECT ... FOR UPDATE SKIP LOCKED`, sets a lease and enqueues `mission.contact` for each. Several workers can run it at once without double-dialing.
3. **Concurrency leases in Redis.** A call takes a lease keyed by org and trunk with a TTL, and gives it back when the call ends (the voice worker already knows when: `finishCall`). A crashed call frees its slot when the TTL expires. Token buckets in Redis pace CPS and the WhatsApp budget.
4. **Pause, resume, cancel are a status change.** The dispatcher stops claiming; calls in progress finish. Resume after a crash is free: expired leases go back to `pending` and the dispatcher picks them up.
5. **The contact window is already enforced.** `mission.contact` defers any attempt outside `OFD_CONTACT_DAYS` / `OFD_CONTACT_HOURS` to the next opening. It moves to per-org and per-mission settings when those exist.

pg-boss stays the queue. Postgres-only keeps self-hosting simple, the state that matters lives in tables we own, and pg-boss handles millions of jobs a day. Inngest or Trigger.dev (named in the PRD) would add a service every self-hoster has to run, for features the dispatcher pattern does not need. We can revisit if missions grow into long multi-step workflows with human waits.

## Where to run it: AWS for the core, Cloudflare at the edge

**Recommendation: AWS runs everything stateful and everything voice; Cloudflare handles DNS, WAF, the static dashboard and site, and recording storage (R2).**

Why not Cloudflare for the core:

- Voice workers are long-lived Node processes that hold WebRTC media, run native ONNX models (turn detection, noise filtering) and keep a call in memory for minutes. Workers cannot do that (no UDP, CPU-time limits, no native addons). Cloudflare Containers is promising but young; worth revisiting later.
- There is no managed Postgres on Cloudflare. Hyperdrive only pools connections to a database hosted elsewhere, so the database lives in a cloud provider anyway, and the API and workers should sit next to it.
- Durable Objects and Queues would make the cloud depend on primitives a self-hoster cannot run, which breaks the "same images everywhere" rule.

Why AWS:

- São Paulo (`sa-east-1`) is the closest full region to Argentina, and AWS has a Local Zone in Buenos Aires for latency-sensitive media (check which instance types it offers before relying on it). Both matter for voice, where every hop adds to response time.
- Everything we run is a plain container plus Postgres and Redis, which map to managed services one to one, and the same layout ports to the US later.

What Cloudflare adds on top: DNS, TLS and WAF in front of the API, Pages for the dashboard and public site, and R2 for call recordings (no egress fees, S3-compatible, so self-hosters can point the same code at MinIO or S3).

### Target layout (AWS)

| Piece | Service | Notes |
| --- | --- | --- |
| api, worker | ECS on Fargate | Same images as compose. Worker scales on pg-boss queue depth and dispatcher lag |
| voice-worker | ECS on EC2 (or Fargate) | Scales on active calls; drains before scale-in so calls are never cut |
| Media and SIP | LiveKit Cloud first, self-hosted LiveKit on EC2 later | LiveKit Cloud removes the hardest piece to operate. Self-host when volume makes it cheaper |
| Postgres 17 + pgvector + pg_textsearch | See risk below | Point-in-time recovery, one read replica for reports |
| Redis | ElastiCache (Valkey) | Leases, holds, rate limits. Losing it costs in-flight leases only |
| Secrets | Secrets Manager | Per-org provider keys encrypted at rest |
| Infra as code | OpenTofu | Kept in `ee/` or a separate repo; the core never imports AWS SDKs |

**Risk to verify first:** `pg_textsearch` (BM25) comes from Timescale/Tiger Data and is probably not available on RDS or Aurora. Options: Tiger Cloud (managed Postgres on AWS, check region availability), self-managed Postgres on EC2 with the same image we use locally, or a BM25 fallback to Postgres full-text search on RDS. This decision blocks the database choice.

## Next steps

1. Decide the Postgres option above.
2. Build `mission_targets` and the dispatcher (code only, testable locally with compose), with Redis leases and token buckets, No Llame scrubbing at plan time, and attempt caps.
3. A load test against the local stack with fake telephony: 100k targets, 200 concurrent, kill workers mid-run, check nothing is called twice and the report adds up.
4. OpenTofu module for a staging environment, with a budget alarm before anything is created.
