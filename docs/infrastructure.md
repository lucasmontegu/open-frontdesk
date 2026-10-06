# Cloud infrastructure and large campaigns

Status: direction agreed with Lucas on 2026-10-06; nothing is provisioned yet. The goal is a managed cloud that runs the same images as `docker compose`, so self-hosting stays one command and the cloud is "the same thing, operated for you".

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
5. **The contact window is already enforced.** Each organization sets its own (`PUT /api/settings/contact-window`, or the `set_contact_window` MCP tool), because the rules change by country and use case. Organizations that set none use `OFD_CONTACT_DAYS` / `OFD_CONTACT_HOURS`. `mission.contact` defers any attempt outside the window to its next opening.

pg-boss stays the queue. Postgres-only keeps self-hosting simple, the state that matters lives in tables we own, and pg-boss handles millions of jobs a day. Inngest or Trigger.dev (named in the PRD) would add a service every self-hoster has to run, for features the dispatcher pattern does not need. We can revisit if missions grow into long multi-step workflows with human waits.

## Where to run it

Rule: the core is containers plus Postgres and Redis, so every piece below is replaceable, and a self-hoster runs the same images with `docker compose`. Managed services are chosen to scale the long-running work (campaigns, calls) without us operating media servers or databases early on.

| Piece | Now | Later | Notes |
| --- | --- | --- | --- |
| api, worker, voice-worker | Containers on EC2 or Render | ECS on AWS when we need autoscaling per service | Same images as compose. The worker scales on queue depth and dispatcher lag; the voice worker on active calls, draining before scale-in so calls are never cut |
| Media and SIP | LiveKit Cloud | Self-hosted LiveKit if volume makes it cheaper | Removes the hardest piece to operate |
| Redis | Upstash | Same, or Valkey next to the workers | Leases, holds, rate limits. Use the TLS URL (`rediss://`). Billed per command, so keep polling out of Redis |
| Recordings and files | Cloudflare R2 | Same | S3-compatible: LiveKit egress and our code write to it, self-hosters point it at S3 or MinIO |
| Postgres 17 + pgvector | Neon, or our own image on EC2 | Tiger Cloud | See the BM25 note below |
| DNS, TLS, WAF, static dashboard and site | Cloudflare | Same | |

Why not run the core on Cloudflare Workers: voice workers are long-lived Node processes that hold WebRTC media, run native ONNX models (turn detection, noise filtering) and keep a call in memory for minutes. Workers cannot do that (no UDP, CPU-time limits, no native addons). Durable Objects and Queues would also make the cloud depend on primitives a self-hoster cannot run.

Region: for Argentina, the closest full AWS region is São Paulo (`sa-east-1`). Media latency is mostly LiveKit Cloud's job; the API, workers and database should sit in the same region as each other.

**BM25 note.** Knowledge search uses `pg_textsearch` (a Timescale/Tiger Data extension), and migration `0001` creates a `bm25` index. Our Postgres image on EC2 and Tiger Cloud have it. Neon does not as far as we know (to verify), so on Neon that migration fails. To use Neon we would first need a fallback to Postgres's built-in full-text search when the extension is missing. pg-boss also needs a direct connection, not Neon's pooled one, and its polling keeps the compute awake.

## Next steps

1. Pick Neon (needs the BM25 fallback) or our image on EC2 (works today) for the first environment.
2. Build `mission_targets` and the dispatcher (code only, testable locally with compose), with Redis leases and token buckets, No Llame scrubbing at plan time, and attempt caps.
3. A load test against the local stack with fake telephony: 100k targets, 200 concurrent, kill workers mid-run, check nothing is called twice and the report adds up.
4. A staging environment (EC2 or Render, LiveKit Cloud, Upstash, R2) with a budget alarm before anything is created.
