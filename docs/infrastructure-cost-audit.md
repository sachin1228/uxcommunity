# Third-Party Services, Infrastructure Cost & Scalability Audit

**UX Community** · audit date **2026-10-13** · revision 1

> **What this document is.** An evidence-based inventory of every external
> service, paid dependency and infrastructure component this application
> touches, followed by a cost model that projects the monthly bill at 1K /
> 10K / 100K / 1M registered users.
>
> **How to read it.** Two kinds of statement appear below and they are labelled
> apart on purpose:
>
> - **FACT** — read out of this repository, with the file and (where useful)
>   the line that proves it.
> - **ESTIMATE** — arithmetic from a stated assumption. Every assumption lives
>   in [`scripts/cost-model.mjs`](../scripts/cost-model.mjs) as a named
>   constant, so you can change one number and re-run the whole projection
>   instead of arguing with a table:
>
>   ```bash
>   node scripts/cost-model.mjs
>   ```
>
> **Prices are not from memory.** Every unit price quoted here was read off the
> vendor's own live pricing page during this audit; the URLs are listed in
> [§11 Pricing sources](#11-pricing-sources). Prices change — re-read that
> section before signing anything.
>
> This does not replace [`INFRASTRUCTURE-AUDIT.md`](../INFRASTRUCTURE-AUDIT.md),
> which is the structural/flow audit. Where the two disagree (route count,
> Vercel, connection pooling), this document is the newer reading and says so.

---

## 1. Executive summary

### 1.1 The headline

| Registered users | Modelled monthly bill | Cost per registered user | Largest cost driver |
|---:|---:|---:|---|
| 1,000 | **~$34** | $0.034 | Supabase Pro plan floor ($25) |
| 10,000 | **~$99** | $0.0099 | Durable Object duration + Upstash Redis |
| 100,000 | **~$1,029** | $0.0103 | Upstash Redis (45%), Durable Object duration (33%) |
| 1,000,000 | **~$10,561** | $0.0106 | Upstash Redis (44%), Durable Object duration (32%) |

The comfortable version of that table: **unit cost flattens at roughly one cent
per registered user per month** and nothing in the stack has a runaway
super-linear term. There is no per-user-priced vendor (no Supabase Auth MAU, no
per-seat AI API, no per-message SMS) anywhere in the architecture.

The uncomfortable version: **two lines account for ~76% of the bill above 100K
users, and both are consequences of choices made for other reasons** — an
Upstash Redis round trip on *every single request* (a rate limiter), and Durable
Object *duration* (a realtime hub that stays awake). Neither is a vendor
problem. Both are fixable in application code, and §9 puts a number on each fix.

### 1.2 Top findings

1. **The global rate limiter is the single most expensive line item per
   request.** `apps/web/middleware.ts` runs `checkGlobalRequestRateLimit()` on
   every non-static request, and each `Ratelimit.limit()` call costs **4–5 Redis
   commands** (Upstash's own published cost table for a sliding window with no
   analytics). That is ~5.2 commands per dynamic request once the 32 per-route
   limit call sites are included. At 100K users the model bills **$462/month**
   for throttling. — FACT (code) + FACT (Upstash cost table)

2. **Above ~40K users the flat-rate escape hatch closes.** Upstash's Fixed plans
   bill a flat monthly fee with *no command charge*, but cap throughput at
   **10,000 commands/second**. The app's peak demand crosses that ceiling at
   about **39K users** (§7, derived), so the cheap fix works early and stops
   working exactly when the bill starts to matter. — ESTIMATE (model) + FACT
   (plan limits)

3. **Durable Object duration, not requests, is the realtime cost.** The worker
   uses the WebSocket **hibernation** API
   ([`apps/realtime/src/room.ts:213,222`](../apps/realtime/src/room.ts#L213)), so
   an idle room costs nothing. But a room that stays awake costs GB-seconds at
   **128 MB per object**, and the model puts duration at **$337/month at 100K**
   and **$3,415/month at 1M** on a "1 hour of active time per room per day"
   assumption. If rooms are effectively always-awake that line becomes
   **$2,731 / $27,355**. This is the least certain and most leveraged number in
   the audit — see §5.3. — ESTIMATE (scenario) + FACT (hibernation API)

4. **Cloudflare Images is configured but never used, so it bills $0 today — and
   it is the highest-multiplier dormant cost in the repo.** `apps/web/wrangler.toml`
   binds the `IMAGES` service, and
   [`next.config.js`](../apps/web/next.config.js) declares `images.remotePatterns`
   for Supabase and GIPHY, but **no file imports `next/image`** (0 imports across
   the app; 14 plain `<img>` tags). Unique transformations are billed per
   *variant per image per month*; the moment someone swaps in `<Image>` across
   avatars and feed cards, each distinct URL × width becomes its own billed
   transformation at $0.50/1,000 after the 5,000 free. — FACT + FACT (pricing)

5. **Supabase MAU is not a cost, because Supabase Auth is not used.** No
   `supabase.auth.*`, no `.storage.from()`, no `.channel()` call exists anywhere
   (0 matches). Auth is custom JWT (`jose` + `bcryptjs`, httpOnly cookie), so the
   app sits *below* every Supabase MAU tier forever. Supabase bills on **plan +
   compute + disk + egress** only. — FACT

6. **There is no direct Postgres connection anywhere, so the "500 concurrent
   database connections" wall from the older audit does not exist.** The repo
   has no `pg`/`postgres` client dependency; every query goes through
   `@supabase/supabase-js` over HTTPS REST (PostgREST), which Supabase pools
   itself. The binding constraint at scale is therefore **database size forcing a
   bigger compute instance**, not connections. — FACT

7. **Video and audio never touch the application server, which is worth a lot.**
   [`apps/web/lib/video/video-upload.ts`](../apps/web/lib/video/video-upload.ts)
   documents it as a deliberate design: the browser asks for a presigned PUT,
   streams the file straight to R2, and the server only sees metadata. There is
   **no multipart proxy fallback** — a 50 MB video is refused
   ([`lib/video/upload-guard.ts`](../apps/web/lib/video/upload-guard.ts),
   `MAX_PROXY_BODY_BYTES = 10 MB`). Consequently **media egress is free** (R2
   egress is free in all storage classes) and the app keeps no transcoding,
   moderation or media-processing vendor at all: the only decode work is
   `ffmpeg.wasm`/`mediabunny`/`pdfjs-dist` running **in the user's browser**.
   — FACT

8. **The bandwidth story is inverted from a normal web app.** Cloudflare does
   not charge for Workers egress or CDN bandwidth, and R2 egress is free, so
   *serving* media is a fixed cost. The metered byte path is the opposite one:
   **Postgres → Worker**, billed as Supabase egress at $0.09/GB past 250 GB. The
   existing performance audit's #1 finding (the sidebar endpoint transferring
   unbounded row history) is therefore *directly* a bill, not just a latency
   problem: at 10 KB/query instead of 2 KB the model adds **$877/month at 1M
   users**. — FACT (pricing) + ESTIMATE (model)

9. **GIPHY is the one vendor whose limit the app probably already exceeds, and
   it is not a money problem yet.** The proxy at
   [`apps/web/app/api/giphy/route.ts`](../apps/web/app/api/giphy/route.ts) calls
   GIPHY **server-side** with a single key; GIPHY's current developer docs put a
   **beta key at 100 API calls/hour** and require production keys to be applied
   for (pricing then discussed privately). The route does set
   `next: { revalidate: 60 }`, which absorbs repeats — but GIF search is a
   per-user action and 100/hour is a small number. Separately, GIPHY's own
   integration guidance says search should be called **client-side** and asks
   developers not to proxy. — FACT (code) + FACT (GIPHY docs)

10. **CI is free if the repository is public, and ~$6–60/month if it is not.**
    Three workflows run `npm ci` plus an OpenNext build. GitHub bills
    standard runners at **$0 for public repositories** and **$0.006/minute past
    2,000 free minutes** for private ones on the Free plan. — FACT (workflows) +
    FACT (GitHub pricing)

11. **The realtime worker has Observability enabled, and that pricing changes on
    2026-12-01.** `apps/realtime/wrangler.toml` sets `[observability] enabled =
    true` with `invocation_logs = true`, which is one log event per invocation.
    Workers Logs is currently included (20M events/month on Paid, 7-day
    retention); from **1 December 2026** Workers Logs moves to Cloudflare
    Observability pricing, announced at **$0.25/GB ingested and $0.10/GB-month
    stored**. This is the only scheduled price change that affects this
    application. — FACT (config) + FACT (announced change)

12. **Nothing else is a surprise.** No AI/LLM API, no embeddings, no vector
    database, no moderation service, no error-tracking or analytics SDK (no
    Sentry/PostHog/Datadog/Logtail), no queue, no D1, no container, no
    third-party SMS, no paid CMS, and no Vercel. The complete list of *actual*
    vendors is 8 items long (§2) plus the two app-store fees (§5.7).

---

## 2. Complete billable-surface inventory

Every row below was found in the repository. "Billed dimension" is what the
vendor actually meters — that is the number that scales.

| # | Service | What it does here | Evidence | Plan today | Billed dimension |
|---|---|---|---|---|---|
| 1 | **Cloudflare Workers** | The web app (Next.js via OpenNext) | `apps/web/wrangler.toml` — `name = "uxcommunity-web"`, `main = ".open-next/worker.js"` | Workers Paid ($5/account) | Requests (>10M), CPU-ms (>30M) |
| 1b | **Cloudflare Workers — static assets** | JS/CSS/emoji served by the `ASSETS` binding | `apps/web/wrangler.toml` — `assets = { directory = ".open-next/assets", binding = "ASSETS" }`; `next.config.js` sets 1-year immutable emoji caching | included | **Free and unlimited** |
| 1c | **Cloudflare Service binding** | Worker self-reference for SSR internals | `[[services]] binding = "WORKER_SELF_REFERENCE"` | included | not separately billed |
| 2 | **Cloudflare Durable Objects** | Realtime: one `Room` per community, one `UserDO` per user, one `AlertMonitor` | `apps/realtime/wrangler.toml` — `[durable_objects] bindings = COMMUNITY_DO/Room, USER_DO/UserDO, ALERT_MONITOR/AlertMonitor`; migrations `v1`–`v4` all `new_sqlite_classes` | Workers Paid | DO requests (>1M), **duration GB-s** (>400K), SQLite row reads/writes, DO storage (>5 GB) |
| 3 | **Cloudflare Cron Triggers** | Dependency health monitor, every 5 minutes | `apps/realtime/wrangler.toml` — `[triggers] crons = ["*/5 * * * *"]` | included | **No separate charge**; the invocation counts as a Worker/DO request |
| 4 | **Cloudflare R2 — media bucket** | All uploads: avatars, chat media, threads, events, resources, showcase, lottie | `apps/web/lib/r2.ts` (S3 client from `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`); bucket named by `R2_BUCKET_NAME`; served from `R2_PUBLIC_URL` | usage | Storage $0.015/GB-mo, Class A $4.50/M, Class B $0.36/M, **egress free** |
| 5 | **Cloudflare R2 — Next.js incremental cache** | `unstable_cache` / ISR backing store | `apps/web/open-next.config.ts` → `r2IncrementalCache`; binding `NEXT_INC_CACHE_R2_BUCKET` → bucket `uxcommunity-web-next-cache` | usage | Same rates. **Grows every deploy and nothing prunes it** (documented in `wrangler.toml`) |
| 6 | **Cloudflare Images** | Would power `next/image` optimization | `apps/web/wrangler.toml` — `[images] binding = "IMAGES"` | **unused** | 5,000 unique transformations/mo free, then $0.50/1,000 |
| 7 | **Cloudflare CDN / DNS / TLS** | Edge cache in front of R2 and the Worker | R2 custom domain guidance in `apps/web/wrangler.toml` (`R2_PUBLIC_URL` MUST be a custom domain or the edge cache never engages) | Free plan | **$0** — CDN bandwidth is unmetered |
| 8 | **Supabase (PostgreSQL)** | The only database. 61 tables, 72 SQL functions | `supabase/migrations/` (183 files); `apps/web/lib/supabase/service.ts`; `@supabase/supabase-js` | Pro (assumed — Free cannot hold 10K users) | Plan $25, compute, disk >8 GB, **egress >250 GB** |
| 9 | **Upstash Redis** | Sliding-window rate limiting only (not a cache) | `apps/web/lib/auth/rate-limit.ts`, `apps/web/lib/global-request-rate-limit.ts` | Free (500K cmd/mo) → PAYG | **Commands** ($0.20/100K) |
| 10 | **Resend** | Transactional email: 6 templates + dependency-down alerts | `apps/web/lib/email/index.ts`; `apps/web/lib/health/alert.ts` | Free (3,000/mo) → Pro $20 | Emails/month |
| 11 | **GIPHY** | GIF/sticker search, proxied server-side | `apps/web/app/api/giphy/route.ts`; probe in `lib/health/dependencies.ts` | Beta key | **100 API calls/hour** (beta); production key = private pricing |
| 12 | **Expo Push Service** | Mobile chat notifications (FCM/APNs underneath) | `apps/web/lib/push/expo.ts` → `https://exp.host/--/api/v2/push/send` | free | **Free**, capped at 600 notifications/sec/project |
| 13 | **Expo EAS (Build/Submit/Update)** | Mobile release pipeline | `expo-app-standalone 3/eas.json` (development/preview/production profiles) | Free tier | Builds (15/platform/mo), then credits |
| 14 | **Apple Developer / Google Play** | Store presence for the mobile app | implied by `eas.json` `submit.production` | required | $99/yr + $25 once |
| 15 | **GitHub Actions** | CI (types, tests, audits), deploy, per-PR preview workers | `.github/workflows/{ci,deploy,preview}.yml` | Free | Runner minutes — **$0 if public**, $0.006/min if private past 2,000 |

### 2.1 What a request actually costs (end-to-end)

Three different vendors are metered by the same user click. For a single
authenticated API request:

| Hop | Metered by | Cost per unit |
|---|---|---|
| Browser → Cloudflare edge | Workers request | $0.30/M |
| Worker executes (JWT verify, routing, render) | Workers CPU-ms | $0.02/M ms |
| Worker → Upstash (middleware limiter, 4–5 cmds) | Upstash commands | $0.20/100K |
| Worker → Supabase REST (~2 queries) | Supabase egress bytes | $0.09/GB |
| Worker → R2 (only on upload) | R2 Class A op | $4.50/M |
| Worker → realtime `/publish` | DO request | $0.15/M |
| Fan-out to N sockets in the room | — | **free** (outgoing WS messages are not billed) |

Two of those are effectively free and it matters: **outgoing WebSocket
messages cost nothing**, so broadcast fan-out does not scale the bill with room
size. The cost that *does* scale with room size is the **Expo push fan-out**
(§5.6) — and that is a rate-limit wall, not a dollar wall.

---

## 3. What is NOT used

The brief asked not to assume services are present. These were each checked and
are **absent**, which is itself a finding, because each one is a whole category
of cost this application does not carry.

| Category | Status | How it was checked |
|---|---|---|
| Supabase Auth (MAU billing) | **not used** | 0 matches for `supabase.auth`; auth is custom JWT (`lib/auth/session.ts`, `jose`) |
| Supabase Storage | **not used** | 0 matches for `.storage.from(` — all media is R2 |
| Supabase Realtime | **not used** | 0 matches for `.channel(` — realtime is Cloudflare Durable Objects |
| Supabase Edge Functions | **not used** | no `supabase/functions/` directory |
| Supabase connection pooler as a *product* | n/a | no `pg`/`postgres` dependency; all access is PostgREST over HTTPS |
| AI / LLM APIs, embeddings, vector DB | **none** | repo-wide search for openai/anthropic/gemini/cohere/mistral/replicate/huggingface found only *company names inside seed data* (`data/company-directory/mnc-companies.json`) |
| Moderation / transcoding services | **none** | the only env var that looked like one (`MODERATION_IMAGE_SERVICE_URL`) exists in **no** file |
| Video/audio processing vendor | **none** | `mediabunny`, `@ffmpeg/ffmpeg`, `@jsquash/webp` are client-side wasm; no server transcode route exists |
| Email/SMS/OTP vendors beyond Resend | **none** | only `resend` in `apps/web/package.json`; `lib/email/index.ts` is the single send site |
| Analytics, error tracking, APM | **none** | repo-wide search for sentry/posthog/datadog/logtail/axiom/newrelic/bugsnag/amplitude/mixpanel/segment/hotjar/clarity returned only unrelated `Segmented`/`segment` UI identifiers |
| Job queue / background worker platform | **none** | no Queues binding; deferred work uses `after()` → `waitUntil` |
| Vercel / Netlify / alternate host | **removed** | `package.json` has `audit:vercel`, and `ci.yml` runs a **blocking** `scripts/audit-vercel.mjs` that fails if one returns |
| Cloudflare D1 / KV / Hyperdrive / Containers | **none** | not in either `wrangler.toml` |
| Docker / self-hosted CI runners | **none** | all workflows are `runs-on: ubuntu-latest` |
| Cloudflare Workers Builds | **not used** | deploys run in GitHub Actions; `README.md` explains Cloudflare's Git integration is disconnected |

> **Non-cost observation.** `apps/web/app/api/admin/load-test/impl.ts` spawns
> `child_process` to run the k6 binary. That cannot work on Cloudflare Workers
> (no child processes), so the in-app load-test runner is a local-development
> surface only. It costs nothing, but it is dead code in production and worth
> deleting or gating.

---

## 4. Traffic and scale model

All projections in §6 come from these inputs. Change them in
[`scripts/cost-model.mjs`](../scripts/cost-model.mjs) and re-run.

| Input | Value | Basis |
|---|---|---|
| Monthly active ratio | 70% of registered | ESTIMATE (carried from the existing audit) |
| Daily active ratio | 30% of MAU → **0.21 × registered** | ESTIMATE |
| HTTP requests per DAU/day | 100 | ESTIMATE (existing audit's "normal" profile) |
| Dynamic (billable) share | 70% of HTTP | **FACT-derived**: the middleware matcher excludes static extensions, and `ASSETS` requests are free |
| DB round trips per request | 2 | Existing audit (~200 ops/user/day at 100 requests) |
| Bytes per DB row transfer | 2 KB | ESTIMATE — the sensitivity that matters most (§8.1) |
| Realtime events per DAU/day | 100 | ESTIMATE |
| Sockets per peak user | 5 (sidebar cap is 15) | **FACT**: `SIDEBAR_REALTIME_LIMIT` |
| Peak concurrency | 10% of DAU | ESTIMATE |
| Peak RPS | 0.05 × registered | **FACT-derived** from `docs/performance-audit.md` concurrency model (1K→50, 10K→500, 100K→5,000 rps) |
| DO requests per DAU/day | 15 | ESTIMATE (socket opens + publishes + inbound messages ÷ 20) |
| DO active seconds per room/day | 3,600 (steady) | **Scenario** — §5.3 |
| Awake rooms per 1,000 users/day | 20 | ESTIMATE |
| R2 Class A per DAU/day | 1.2 | ESTIMATE (upload PUTs + admin audit lists) |
| R2 Class B per DAU/day | 2 | ESTIMATE (edge-cache misses on media) |
| Media stored per user, year 1 | 20 MB | ESTIMATE — video-driven |
| Postgres growth per user, year 1 | 1.5 MB | ESTIMATE |
| Emails per user per year | 6 | ESTIMATE (invites, resets, verification codes, application outcomes) |
| Upstash checks per dynamic request | 1.15 | **FACT-derived**: 1 global check in middleware + 32 per-route limit call sites |
| Upstash commands per check | 4.5 | **FACT**: Upstash's published sliding-window cost |

### 4.1 Resulting scale

| Users | MAU | DAU | Worker req/mo | DB queries/mo | DB egress GB/mo | DB size GB | Media GB | DO req/mo | Peak sockets | Peak rps | Peak Upstash cmd/s |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1K | 700 | 210 | 0.4M | 1.3M | 2.4 | 1.5 | 19.5 | 0.10M | 105 | 50 | 259 |
| 10K | 7,000 | 2,100 | 4.5M | 12.8M | 24.4 | 14.6 | 195.3 | 0.96M | 1,050 | 500 | 2,588 |
| 100K | 70,000 | 21,000 | 44.7M | 127.7M | 243.5 | 146.5 | 1,953.1 | 9.58M | 10,500 | 5,000 | 25,875 |
| 1M | 700,000 | 210,000 | 446.9M | 1,276.8M | 2,435.3 | 1,464.8 | 19,531.3 | 95.76M | 105,000 | 50,000 | 258,750 |

**Note the shape.** Workers requests grow linearly and stay cheap. Upstash
commands/s cross a provider's hard ceiling (10,000/s) between 10K and 100K
users. DB *size* crosses a compute tier between 10K and 100K. Media crosses R2's
free 10 GB before 1K users. Nothing here is quadratic — the pain is in
**tier boundaries**, which is where a bill jumps rather than slides.

---

## 5. Per-service analysis

### 5.1 Cloudflare Workers — the web app

**Evidence.** `apps/web/wrangler.toml`: `name = "uxcommunity-web"`,
`compatibility_date = "2026-08-01"`, `nodejs_compat`, `global_fetch_strictly_public`,
static `ASSETS` binding, `WORKER_SELF_REFERENCE` service binding. 156 route
handlers under `apps/web/app/api/` (61 under `communities/`, 42 under `admin/`),
and **no server actions** (`"use server"` appears 0 times — every mutation is a
route handler).

**Billing.** $5/month per account, 10M requests included then **$0.30/M**;
30M CPU-ms included then **$0.02/M CPU-ms**. Duration is not billed. Static
asset requests are free.

**Modelled cost.** Requests: $5 → $15.41 (100K) → $136 (1M). CPU at 20 ms/request:
$1.19 → $17.28 → $178.

**Why CPU is cheap here and worth watching anyway.** The CPU sensitivity is
remarkably flat — 5 ms vs 50 ms per request moves the 100K total by only $40,
because Workers CPU is priced at $0.02 per *million* ms. The real CPU risk is
not the average but the variance: `next.config.js` keeps a 30 s client Router
Cache (`experimental.staleTimes.dynamic = 30`) precisely because RSC renders are
expensive, and a single heavy dashboard page costs many times the CPU of an API
call that only parses a JSON body. An average hides that entirely. **Instrument
p50 and p99 CPU-ms per route before trusting the 20 ms assumption.**

**Risk: cache-bucket writes always hit the Worker.** `open-next.config.ts` uses
`r2IncrementalCache` with no regional cache, so every `unstable_cache` read is an
R2 round trip. That is modelled as a Class B op per read and shown in §5.4.

### 5.2 Cloudflare Durable Objects — realtime

**Evidence.** `apps/realtime/wrangler.toml` declares three classes across four
migrations, all `new_sqlite_classes`: `Room` (v1), `UserDO` (v2), `AlertMonitor`
(v4). Routing lives in `apps/realtime/src/room-routing.ts`. The fan-out is
bounded (`FANOUT_CONCURRENCY = 40`, `FANOUT_RETRY_ATTEMPTS = 3`).

**Billing (three separate meters, easy to conflate).**

| Meter | Included (Paid) | Overage |
|---|---|---|
| DO requests | 1M/month | $0.15/M |
| DO duration | 400,000 GB-s/month | $12.50/M GB-s |
| SQLite row reads | 25 billion/month | $0.001/M rows |
| SQLite row writes | 50M/month | $1/M rows |
| DO storage | 5 GB-month | $0.20/GB-month |

A WebSocket open counts as one DO request; **20 inbound messages are billed as
one request**, and **outgoing messages are free**. Duration is charged while the
object is active and *not* hibernating, at 128 MB per object.

**Why hibernation is the whole ballgame.** `Room` accepts sockets with
`ctx.acceptWebSocket(server)` and persists state with `serializeAttachment`
([`room.ts:213,222`](../apps/realtime/src/room.ts#L213)); on wake it rebuilds
from `ctx.getWebSockets()`. An idle-but-connected room therefore costs **$0 in
duration**. The bill is set entirely by how long rooms are *awake*.

**Modelled cost.** DO requests are negligible ($1.29 at 100K). Duration is not:

| Scenario (active time per room per day) | 1K | 10K | 100K | 1M |
|---|---:|---:|---:|---:|
| Idle (60 s — truly bursty) | $0 | $0 | $0.70 | $52 |
| **Steady (1 h) — the model's default** | $0 | $29.20 | $337 | $3,415 |
| Busy (8 h — effectively always-on rooms) | $22.36 | $268.60 | $2,731 | $27,355 |

**Interpretation.** Rooms are awake when events flow and sleep ~10 s after the
last one. A community whose chat has a message every few seconds stays awake for
the duration of that activity. The `busy` row is what a **large, always-chatty
community** looks like; the `steady` row models a portfolio of mostly-quiet rooms
with a few active ones. **Do not budget the default without measuring** — the
honest statement is "duration is between **$0 and ~$4 per room-month**":

| Room activity | GB-s/month | Cost per room-month |
|---|---:|---:|
| 1 h/day | 13,680 | **$0.17** |
| 8 h/day | 109,440 | **$1.37** |
| Always awake (24 h/day) | 328,320 | **$4.10** |

So no single room is a budget event — 1,000 always-awake rooms are. Cheapest
control: encourage hibernation by not writing on every keystroke, and never add
a per-room alarm that fires more often than the room needs.

### 5.3 Cloudflare R2 and edge delivery

**Evidence.** Two buckets, deliberately not merged (`apps/web/wrangler.toml`
comments say so explicitly): the media bucket behind `R2_BUCKET_NAME` /
`R2_PUBLIC_URL`, and `uxcommunity-web-next-cache` behind
`NEXT_INC_CACHE_R2_BUCKET`. Uploads are tagged
`Cache-Control: public, max-age=31536000, immutable`, so the edge cache absorbs
repeat views; `R2_PUBLIC_URL` **must** be a custom domain or r2.dev bypasses the
cache entirely.

**Billing.** Storage $0.015/GB-month; Class A $4.50/M; **Class B $0.36/M**;
**egress $0 in every storage class**. Free: 10 GB, 1M Class A, 10M Class B.

**Modelled cost.** Storage $0.17 → $2.81 → $29.18 → $293. Operations $0 → $4.90
→ $121 (dominated by the incremental cache's Class B reads, since a cache read
per request is modelled at 0.5/dynamic request).

**The two real risks are both storage-growth, not traffic.**

1. **The incremental-cache bucket only grows.** Both the repo documentation and
   `/admin/health` acknowledge it: every deploy writes the same small key set
   under a *new build prefix* and nothing expires the previous ones. The admin
   page flags degraded past 25,000 entries or 1 GiB. Storage is cheap
   ($0.015/GB-mo), so this is a hygiene problem rather than a budget problem —
   but it is unbounded by construction and nobody prunes it.
2. **Video is the media-storage driver.** Everything else is compressed
   client-side before upload (`lib/image-client.ts`), but video ships the
   **unmodified original** to R2 by presigned PUT. Storage at 20 MB/user/year
   costs $293/month at 1M users; at 100 MB/user it is $1,465/month. This is a
   product decision (retention, per-file cap, or a lifecycle rule), not an
   architecture flaw.

**One metered read path worth knowing about.** `apps/web/app/api/image-download/route.ts`
streams R2 objects *through the Worker* so the browser gets
`Content-Disposition: attachment` without CORS. That path costs Worker CPU plus
an R2 Class B op per download, and it does not benefit from the edge cache. It is
only used for save-to-disk, so volume should be low — verify it stays that way.

### 5.4 Supabase (PostgreSQL)

**Evidence.** `apps/web/lib/supabase/service.ts` builds the client from
`SUPABASE_SERVICE_ROLE_KEY`; every API route and Server Component queries
through it, **bypassing RLS** (a deliberate consequence of custom JWT auth).
183 migration files; 61 tables; 72 SQL functions; exactly one extension,
`pg_trgm`. No `pg`, no `postgres`, no connection string — so **no direct
Postgres connections**.

**Billing.** Pro $25/month; includes $10 of compute credit (covers Micro),
8 GB disk, 250 GB uncached egress. Overage: **$0.125/GB-month disk**,
**$0.09/GB egress**. Compute is priced per size and is the real lever.

**Modelled cost.** $25 → $30.83 (Small) → $142.31 (Large) → $1,353.78 (4XL).

**What actually drives it: database size forcing compute.** Using Supabase's own
recommended maximum database size per compute tier:

| Users | DB size (1.5 MB/user/yr) | Compute the model selects | Cost |
|---:|---:|---|---:|
| 1K | 1.5 GB | Micro (10 GB) | $10 (covered by credit) |
| 10K | 14.6 GB | Small (50 GB) | $15 |
| 100K | 146.5 GB | Large (200 GB) | $110 |
| 1M | 1,464.8 GB | 4XL (2 TB) | $960 |

**Connections are a non-issue, and the older audit is wrong about this.** The
`INFRASTRUCTURE-AUDIT.md` claim that "at 10K concurrent users… 500 DB connections
needed" assumed a serverless function holding a Postgres connection. This app
never opens one: `@supabase/supabase-js` speaks HTTP to PostgREST, which Supabase
pools internally. The correct constraints to watch are **PostgREST concurrency**
and **compute CPU**, not `max_connections`.

**Egress is the sleeper.** At 2 KB/query the 250 GB allowance lasts until ~100K
users. But the performance audit's #1 finding — the sidebar endpoint transferring
unbounded historical reaction rows — is a bytes-per-query multiplier. At 10 KB per
query instead of 2 KB:

| | 10K | 100K | 1M |
|---|---:|---:|---:|
| Supabase line | $30.83 | **$229.40** | **$2,230.49** |
| Whole bill | $99.03 | $1,115.97 | $11,437.44 |

So the *same* fix improves latency, memory, **and** the second-largest bill line.

### 5.5 Cloudflare Images — dormant

`[images] binding = "IMAGES"` is present and `next.config.js` declares
`images.remotePatterns` for Supabase Storage and the GIPHY CDN. **No source file
imports `next/image`** (0 matches; 14 raw `<img>` tags instead). Cloudflare
Images bills **$0.50 per 1,000 unique transformations** after 5,000 free, and
"unique" means a distinct transformation **variant per image per calendar
month** — repeated requests for the same variant count once. So cost grows with
the number of *distinct images anyone views in a month* multiplied by the number
of widths/formats requested for each, **not** with page views: a feed that puts
30 distinct avatars and 20 feed images on screen, each requested at 5 widths, is
250 unique transformations in that month. It is a bill that tracks content
volume, which is exactly the shape that surprises people. **With the binding in
place, this is one import away from being live.** Either adopt `next/image`
deliberately and budget it, or delete the `IMAGES` binding and the remote
patterns so nobody turns it on by accident.

### 5.6 Upstash Redis — the rate limiter

**Evidence.** `apps/web/lib/auth/rate-limit.ts` constructs
`new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(limit, "Ns"),
analytics: false })` — **no `ephemeralCache`**, so every check is a Redis
round trip. `apps/web/lib/global-request-rate-limit.ts` sets
`burst: 50/10s` and `sustained: 300/60s`, and caches the *sustained* verdict per
worker for 2 s (a real optimisation: it turns two round trips into ~one).
`middleware.ts` calls it on every non-static request; 32 further per-route call
sites cover login, signup, password reset, applications, chat sends, content
creation, comments and reactions.

**Billing.** Free 500K commands/month. PAYG **$0.20 per 100,000 commands**
(no base fee). Fixed plans bill flat with **no command charge**, capped at
**10,000 commands/s** (250 MB: $10, 1 GB: $20, 5 GB: $100).

**Cost per check, from Upstash's own published table:** a sliding window with no
analytics/denylist costs **5 commands** for an identifier's first check and
**4** for subsequent normal checks. The model uses 4.5.

**Modelled cost — the biggest controllable line in the audit:**

| Users | Commands/month | PAYG | Peak cmd/s | Best available price |
|---:|---:|---:|---:|---|
| 1K | 2.3M | $3.63 | 259 | $3.63 (below the $10 flat floor) |
| 10K | 23.1M | $45.25 | 2,588 | **$10** (Fixed 250MB) |
| 100K | 231.3M | $461.52 | 25,875 | $461.52 — **over the 10K/s ceiling** |
| 1M | 2,312.6M | $4,624.21 | 258,750 | $4,624.21 — **over the ceiling** |

Two facts fall out of that table:

- **The flat-rate escape hatch is real but temporary.** It saves 78% at 10K
  users and closes once peak command rate passes 10,000/s, i.e. somewhere around
  **40K registered users**.
- **The structural fix is not a plan change, it is a cache.** The middleware
  already caches the sustained verdict for 2 s per isolate. Caching the *burst*
  verdict — or moving the global guard to a per-isolate token bucket with Redis
  as a backstop — cuts commands per request from ~5 toward ~1 and would move the
  1M-user line from $4,624 to under $1,000.

### 5.7 Resend

**Evidence.** One send site,
[`apps/web/lib/email/index.ts`](../apps/web/lib/email/index.ts) →
`getResend().emails.send({...})`, with six templates (company verification,
invitation, password reset, rejection, resume signup, welcome), plus
dependency-down alerts in [`lib/health/alert.ts`](../apps/web/lib/health/alert.ts).
The daily health monitor adds at most one "down", one reminder per hour while
down, and one "recovered" per outage — a month-long outage is ~720 emails.

**Billing.** Free 3,000/month (100/day, 3 domains, 30-day retention). Pro
**$20 for 50,000/month**, then **$0.90 per 1,000**. API limit 10 req/s per team.

**Modelled cost.** $0 → $20 → $20 → $425. Email is the cheapest thing in the
stack; the only realistic risk is the **Free plan's 100/day ceiling**, which a
single bulk action (a large community invite or application wave) can hit.

### 5.8 GIPHY

**Evidence.** [`apps/web/app/api/giphy/route.ts`](../apps/web/app/api/giphy/route.ts)
builds `GET https://api.giphy.com/v1/{gifs|stickers}/{search|trending}` with the
key appended server-side, `rating=g`, and `fetch(url, { next: { revalidate: 60 } })`.
The health page probes `gifs/trending?limit=1`.

**Terms.** GIPHY's current developer docs put new keys at **100 API calls/hour**
and describe production keys as an application that GIPHY reviews, after which
pricing is discussed privately. There is **no public rate card**. Attribution
("Powered By GIPHY" + logo) is mandatory and is not a fee waiver. GIPHY's own
integration guidance says search calls should be made **client-side** and asks
developers not to proxy API calls or media loads.

**Assessment.** $0 today, but three separate exposure points: the 100/hour beta
ceiling is small for a per-user feature; the production-key path is a private
commercial negotiation (i.e. an unpriced vendor); and the server-side proxy is
against the vendor's stated integration guidance. The 60 s revalidate roughly
caps *distinct* upstream calls per minute to the number of distinct
(query, type, offset, limit) tuples, which is the only thing keeping the beta
key alive. **Treat GIPHY as an unknown-cost vendor, not a free one.**

### 5.9 Expo (push + builds) and app stores

**Evidence.** `apps/web/lib/push/expo.ts` posts to
`https://exp.host/--/api/v2/push/send` with `EXPO_MAX_BATCH = 100` (a provider
hard cap), `EXPO_RATE_LIMIT_PER_SEC = 600`, `EXPO_MAX_CONCURRENCY = 6`, retries
with backoff, and receipt reconciliation in `lib/push/receipts.ts`. The mobile
app registers tokens via `POST /api/push/register`. `expo-app-standalone 3/eas.json`
defines development/preview/production build profiles and a `submit.production`
target.

**Billing.** Expo's push service is **free**, capped at **600
notifications/second per project**. EAS Build Free allows **15 Android + 15 iOS
builds/month**; Starter is $19/month with $45 of build credit, then $1–$4 per
build by platform/worker. EAS Submit is included; EAS Update is unlimited by
count but metered by MAU/bandwidth/storage. Store fees: **$99/year Apple** and
**$25 once Google**.

**Assessment of the real constraint.** Push is free in dollars and *linear in
code*: sending one chat message fans out to every offline member of the room,
chunked at 100/request with a 600/s project-wide ceiling. The cost of growth here
is not money, it is **latency and 429s** — and the code is honest about it:
`expo.ts` notes the pacer is per-invocation and cannot see other isolates, with
Expo's own 429 as the backstop. Above some community size, a per-room fan-out
becomes the slowest part of sending a message. That is a §8 wall, not a §6 line.

### 5.10 GitHub Actions

**Evidence.** Three workflows: `ci.yml` (typecheck, full web unit suite, mobile
realtime/cache suites, comment audit, Vercel-drift audit, credential-guard
tests, advisory ESLint), `deploy.yml` (`npm ci` → credential guards → realtime
deploy → realtime smoke test → OpenNext build → typecheck → unit tests → web
deploy → secret push), `preview.yml` (a per-PR Worker).

**Billing.** Standard GitHub-hosted runners are **free for public
repositories**. For private repositories the Free plan includes **2,000
minutes/month**, then **$0.006/minute** (Linux x64, rounded up per job).

**Modelled cost.** Public: **$0**. Private, worked example: 100 pushes/month ×
~12 min (`npm ci` + OpenNext build) = 1,200 min, plus 40 PRs × ~15 min = 600 min
→ 1,800 min, **under** the 2,000 allowance. At 200 pushes + 80 PRs it becomes
~3,600 min → 1,600 over → **$9.60/month**. Even a busy repository is a rounding
error; note it only because a repo visibility change silently converts $0 into a
bill.

---

## 6. Cost projections

Baseline: steady room activity (1 h/room/day), 20 ms CPU per request, 2 KB per DB
query. Reproduce with `node scripts/cost-model.mjs`.

| Line item | 1K users | 10K users | 100K users | 1M users |
|---|---:|---:|---:|---:|
| Cloudflare Workers — requests | $5.00 | $5.00 | $15.41 | $136.06 |
| Cloudflare Workers — CPU time | — | $1.19 | $17.28 | $178.15 |
| Cloudflare Durable Objects — requests | — | — | $1.29 | $14.21 |
| **Cloudflare Durable Objects — duration** | — | **$29.20** | **$337.00** | **$3,415.00** |
| Cloudflare R2 — storage | $0.17 | $2.81 | $29.18 | $292.85 |
| Cloudflare R2 — operations | — | — | $4.90 | $121.46 |
| Cloudflare Images — transformations | — | — | — | — |
| **Supabase — plan + compute + disk + egress** | **$25.00** | **$30.83** | **$142.31** | **$1,353.78** |
| **Upstash Redis — rate limiting** | $3.63 | $10.00 | **$461.52** | **$4,624.21** |
| Resend | — | $20.00 | $20.00 | $425.00 |
| GitHub Actions (public repo) | — | — | — | — |
| Expo Push / EAS Build | — | — | — | — |
| GIPHY | — | — | — | — |
| **Total** | **$33.80** | **$99.03** | **$1,028.88** | **$10,560.73** |

*(`—` means zero, not "unavailable".)*

> **The model assumes the cheapest available plan is chosen.** The Upstash line
> at 10K users is **$10** because that is the Fixed plan, not the $45.25 the
> pay-as-you-go meter would charge — i.e. the table already banks
> recommendation #2 in §9. At 100K and 1M the flat plans are unavailable (§5.6),
> so the line is genuine pay-as-you-go. Supabase likewise assumes the operator
> right-sizes compute as the database grows, which is a manual action, not an
> automatic one.

### 6.1 Unit economics

| Users | Total $/month | $ per registered user | $ per DAU |
|---:|---:|---:|---:|
| 1K | $33.80 | $0.0338 | $0.16 |
| 10K | $99.03 | $0.0099 | $0.05 |
| 100K | $1,028.88 | $0.0103 | $0.05 |
| 1M | $10,560.73 | $0.0106 | $0.05 |

Unit cost **falls 3.4× from 1K to 10K** (the Pro plan floor and the fixed Upstash
plan stop mattering), then is flat to 1M. There is no scale penalty in the
architecture — only two lines that scale faster than users.

### 6.2 Sensitivities

| Scenario | 10K | 100K | 1M |
|---|---:|---:|---:|
| **Idle rooms** (60 s active/room/day) | $69.83 | $692.58 | $7,197.73 |
| Baseline | $99.03 | $1,028.88 | $10,560.73 |
| **Busy rooms** (8 h active/room/day) | **$373.68** | **$3,422.88** | **$34,500.73** |
| CPU-light (5 ms/request) | $97.84 | $1,015.47 | $10,426.67 |
| CPU-heavy (50 ms/request) | $101.71 | $1,055.69 | $10,828.86 |
| **Heavy DB rows** (10 KB/query) | $99.03 | **$1,115.97** | **$11,437.44** |

**Read the first and last rows.** CPU per request is a rounding error (±2–4%);
room activity and bytes-per-query move the bill by ±130% and ±20% respectively.
If you instrument three things this quarter, make them: DO duration per room,
CPU-ms per route, and bytes returned per DB query.

---

## 7. What becomes expensive first

Every threshold below is **derived**, not guessed: each one is where a modelled
usage number crosses a published inclusion limit, computed from the same
constants as §6 (solve for the user count, not the other way round). Re-derive
them with `node scripts/cost-model.mjs` after changing an assumption.

| Rank | Users | Trigger | Consequence |
|---|---|---:|---|
| 1 | **~410** | Media crosses R2's 10 GiB free storage | R2 storage starts billing (pennies — $0.015/GB-mo) |
| 2 | **~1.5K** | DO duration crosses 400,000 GB-s/month (steady rooms) | The largest Cloudflare line starts billing; $29/mo by 10K users |
| 3 | **~2.4K** | Upstash pay-as-you-go passes $10/month | Switch to a Fixed plan; also the moment to fix the check itself |
| 4 | **~6.1K** | Resend's **100 emails/day** Free ceiling | A bulk invite or verification wave starts failing silently |
| 5 | **~6.8K** | DB crosses 10 GiB | Supabase compute Micro → Small ($15) |
| 6 | **~34K** | DB crosses 50 GiB | Compute → Medium ($60) |
| 7 | **~39K** | **Peak Redis command rate passes 10,000/s** | **The flat-rate Upstash escape hatch closes** |
| 8 | **~68K** | DB crosses 100 GiB | Compute → Large ($110) |
| 9 | **~103K** | Supabase egress passes 250 GB/month | $0.09/GB begins; unbounded-row endpoints now cost real money |
| 10 | **~137K** | DB crosses 200 GiB | Compute → XL ($210) |
| 11 | **~683K** | DB crosses 1 TiB | Compute → 2XL ($410) |
| 12 | **~1.37M** | DB crosses 2 TiB | Compute → 4XL ($960) — a single **$550/month step** |
| 13 | 2026-12-01 | Cloudflare Workers Logs repricing | Realtime invocation logs become a metered GB cost |

**Where the thresholds move if the assumptions are wrong.** Ranks 1, 2 and 9 are
the most assumption-sensitive: media per user scales ranks 1 and (indirectly) the
R2 line, room activity scales rank 2 by up to 8×, and bytes-per-DB-query scales
rank 9 by up to 5×. Ranks 3–8 and 10–12 depend on Postgres growth per user, which
is the most predictable input in the model.

The two that should worry you are **#7** and **#12**: both are *discrete jumps*
that arrive with no warning from a dashboard that only trends, and one of them
(the Upstash ceiling) removes the cheap option at the same moment it becomes
necessary.

---

## 8. Risk register (walls that are not dollars)

Cost is only half of scalability. These are the limits that break before the bill
does.

### 8.1 Postgres → Worker bytes (HIGH)

The performance audit's top finding: `apps/web/app/api/communities/route.ts`
fetches all memberships, member rows, up to `communityCount × 10` messages and
reactions across all joined communities, aggregating in Node. Bytes transferred
grow with **history**, not with the number of communities on screen. This is
simultaneously a latency problem, a memory problem, and (per §5.4) up to
**$877/month at 1M users**. Ranked #1 for a reason.

### 8.2 Durable Object duration (HIGH, uncertain)

See §5.2. The worst case is not catastrophic per room ($12.50 per million GB-s
= **$1.37 per room-month at 8 h/day**), but it is unbounded in the number of busy
rooms and there is no per-room budget or alarm. **Instrument it**: log active
seconds per Room DO and alert on the top-N rooms.

### 8.3 Global rate limiter as a per-request dependency (HIGH)

Every request pays a Redis round trip in latency *and* ~5 commands in money, and
the limiter **fails open** if Redis is unreachable (by design, documented in
`README.md`). So a Redis degradation produces two simultaneous failures: an
unbounded bill of retries and no rate limiting. It is also a single point of
*latency* on the hot path for every page and API call.

### 8.4 GIPHY beta ceiling + proxy direction (MEDIUM)

100 calls/hour with a server-side proxy the vendor asks you not to build. Fix by
caching aggressively, using separate keys per platform, and reading GIPHY's
current integration guidance before launch.

### 8.5 Expo push fan-out is linear in room size (MEDIUM)

Free, but one message → every offline member, capped at 100/request and 600/s
project-wide, with only a per-invocation pacer. At very large communities the
*send* becomes slow and 429-prone. Mitigation is product-level (per-community
batching windows, mute defaults) rather than infrastructure.

### 8.6 Supabase compute is a hard ceiling (MEDIUM)

Direct connection limits are irrelevant here, but compute CPU is not: the app's
heaviest RPC (`get_home_feed_page`, measured at 0.8–1.8 s wall) runs on every
feed load. A single compute tier upgrade is $50–$850/month, decided by Supabase's
disk-size recommendation, not by the app.

### 8.7 Observability repricing, 2026-12-01 (LOW–MEDIUM)

`invocation_logs = true` on the realtime worker. Today included; after the
announced change, Workers Logs is billed by **GB ingested ($0.25) and GB-month
stored ($0.10)**. Set a `head_sampling_rate` or disable invocation logs on the
realtime worker before that date if volume is non-trivial.

### 8.8 Cloudflare Images is one import away from billing (LOW, but binary)

See §5.5.

### 8.9 Single-vendor concentration (STRUCTURAL)

Cloudflare is Workers, Durable Objects, R2, CDN, DNS and (via `next/image`)
the image pipeline. Supabase is the entire database. There is no fallback
provider for either, and the app cannot run without both. That is a normal,
defensible choice at this scale — but it means a Cloudflare Workers incident is a
full outage, and the health monitor that would tell you lives **inside** the
realtime Worker's cron (`apps/realtime/wrangler.toml`), so it stops alerting
exactly when the realtime Worker is what broke. `README.md` acknowledges this.

---

## 9. Recommendations, ranked by dollars saved per unit of work

| # | Change | Effort | Saves | Where |
|---|---|---|---|---|
| 1 | **Cache or replace the per-request global rate-limit check** (cache the burst verdict per isolate, or use an in-isolate token bucket with Redis as backstop) | M | **~$3,700/mo at 1M, ~$369/mo at 100K** (a 5× cut in Redis commands) | `lib/global-request-rate-limit.ts`, `middleware.ts` |
| 2 | **Switch Upstash to a Fixed plan at ~2.4K users** (flat, no command charge, 10K cmd/s) | XS | **$35/mo at 10K** — and it defers point 7 in §7 | Upstash dashboard |
| 3 | **Bound the sidebar/read-model rows** (DB-side aggregates; return only displayed fields) | M | up to **$877/mo at 1M** + latency + memory | `app/api/communities/route.ts`, `lib/communities/read-models.ts` |
| 4 | **Instrument DO active-seconds per room; alert on top-N** | S | makes #5 decidable instead of guessed | `apps/realtime/src/room.ts` |
| 5 | **Add a regional cache to `r2IncrementalCache`** instead of a raw R2 read per `unstable_cache` access | S | cuts R2 Class B ops ~10× | `apps/web/open-next.config.ts` |
| 6 | **Prune the incremental-cache bucket per deploy** (lifecycle rule on old build prefixes) | S | keeps an unbounded bucket bounded | `apps/web/wrangler.toml` / R2 lifecycle |
| 7 | **Apply an R2 lifecycle/retention policy to raw video** (or a per-user quota) | S | the only line that grows with *media*, not users | R2 bucket config |
| 8 | **Either use `next/image` deliberately or delete the `IMAGES` binding and remote patterns** | XS | removes a silent future bill | `apps/web/wrangler.toml`, `next.config.js` |
| 9 | **Set `head_sampling_rate` or disable invocation logs on the realtime worker** before 2026-12-01 | XS | avoids the announced Observability repricing | `apps/realtime/wrangler.toml` |
| 10 | **Set a Resend daily-cap alert** (the 100/day Free ceiling) and move to Pro before an invite wave | XS | prevents silent email loss | `lib/health/dependencies.ts` |
| 11 | **Re-check GIPHY's current integration terms** (client-side search, per-platform keys, production key) | S | unpriced vendor → priced vendor | `app/api/giphy/route.ts` |
| 12 | **Delete or gate the k6 admin route** | XS | removes production-dead code | `app/api/admin/load-test/` |
| 13 | **Add a CI budget assertion for the model** so a change that triples commands/request fails a build | M | keeps this audit alive | `scripts/cost-model.mjs` + a test |

**Do #1 and #2 first.** Together they address the largest line in the audit and
the one that is pure waste (a per-request network call for a limit that the code
already caches a *different* verdict for).

---

## 10. Verification notes and limitations

**What was verified against the running system.** Nothing was executed against
production. All pricing was read from vendor pricing pages during this audit; all
architectural claims were read from tracked source files. The cost model is
arithmetic only — no live billing API was queried, so there is no
ground-truth invoice to compare against.

**Where this audit is least certain, in order:**

1. **DO duration** — depends on Cloudflare's eviction policy interacting with
   real room activity; modelled as a 3-point scenario, not measured.
2. **Bytes per DB query** — the single input with the widest plausible range
   (1 KB–10 KB), and the one the performance audit already flags as unbounded.
3. **CPU-ms per request** — 20 ms assumed; which matters less for dollars than
   for the Free-tier 10 ms limit, so measure before drawing conclusions.
4. **Room activity model** (`awakeRoomsPerThousandUsers = 20`) — a stand-in for
   actual community-activity distribution.
5. **APIs used / requests per user** — carried from the existing audit's
   "normal" profile and **not** re-measured from logs in this pass.

**Claims deliberately corrected from `INFRASTRUCTURE-AUDIT.md`:**

| Older audit said | This audit finds |
|---|---|
| "129 API route handlers" | **156** `route.ts` files |
| "next/image used sparingly (16 transformations in 30 days)" | **0** `next/image` imports; 14 raw `<img>` tags |
| "Supabase free tier: 60 connections / Pro: 200–500; at 10K users 500 connections needed" | **No direct Postgres connections exist** — all access is PostgREST over HTTPS |
| "Supabase Team $599 at 100K users 'due to connection limits'" | Compute/disk drive the tier; MAU is $0 because Supabase Auth is unused |
| Cost tables marked "estimates based on publicly available tier information" | Every unit price replaced with the vendor's current published figure + URL (§11) |

**To make this audit stronger:** export the last 30 days from the Cloudflare
dashboard (Workers requests, CPU-ms, DO duration and GB-s, R2 Class A/B and
bytes), Supabase (egress, disk, compute), Upstash (command count, peak cmd/s),
and Resend (emails sent) — then replace the assumptions in
`scripts/cost-model.mjs` with actuals. The model is built so that is a
find-and-replace, not a rewrite.

---

## 11. Pricing sources

All pages read during this audit (2026-10-13). Re-verify before budget approval —
vendors change list prices without notice, and one of them
(Cloudflare Observability, 2026-12-01) already has a scheduled change.

| Service | Source |
|---|---|
| Cloudflare Workers — requests, CPU, Cron, limits | https://developers.cloudflare.com/workers/platform/pricing/ · https://developers.cloudflare.com/workers/platform/limits/ |
| Cloudflare Durable Objects — requests, duration, SQLite storage, WebSocket message accounting | https://developers.cloudflare.com/durable-objects/platform/pricing/ |
| Cloudflare R2 — storage, Class A/B, free egress, IA class | https://developers.cloudflare.com/r2/pricing/ |
| Cloudflare Images / `IMAGES` binding transformations | https://developers.cloudflare.com/images/pricing/ · https://opennext.js.org/cloudflare/howtos/image |
| Cloudflare Workers Logs + announced Observability repricing | https://developers.cloudflare.com/workers/observability/logs/workers-logs/ · https://blog.cloudflare.com/one-observability-platform/ |
| OpenNext incremental cache on R2 | https://opennext.js.org/cloudflare/caching |
| Supabase — plans, compute sizes, connections | https://supabase.com/pricing · https://supabase.com/docs/guides/platform/compute-and-disk |
| Supabase — disk, IOPS, egress, IPv4, read replicas, PITR billing | https://supabase.com/docs/guides/platform/manage-your-usage/disk-size · https://supabase.com/docs/guides/platform/manage-your-usage/egress · https://supabase.com/docs/guides/platform/backups |
| Upstash Redis — plans, PAYG, Fixed | https://upstash.com/pricing/redis · https://upstash.com/docs/redis/overall/billing |
| Upstash Ratelimit — commands per check | https://upstash.com/docs/redis/sdks/ratelimit-ts/costs |
| Resend — plans, quotas, overage, API rate limit | https://resend.com/pricing · https://resend.com/docs/knowledge-base/account-quotas-and-limits · https://resend.com/docs/api-reference/rate-limit |
| GIPHY — beta key limits, production key, attribution | https://developers.giphy.com/docs/api/ · https://support.giphy.com/hc/en-us/articles/360028134111-GIPHY-API-Terms-of-Service |
| Expo — push limits, EAS Build/pricing | https://docs.expo.dev/push-notifications/faq/ · https://expo.dev/pricing · https://docs.expo.dev/billing/usage-based-pricing/ |
| GitHub Actions — included minutes, runner pricing, public-repo policy | https://docs.github.com/en/billing/concepts/product-billing/github-actions · https://docs.github.com/en/billing/reference/actions-runner-pricing |
| Apple / Google store fees | https://developer.apple.com/help/account/membership/program-enrollment/ · https://support.google.com/googleplay/android-developer/answer/6112435 |

---

## 12. Appendix — repo evidence index

| Claim | File |
|---|---|
| Web Worker config, `ASSETS`, `IMAGES`, cache bucket, `[vars]` | `apps/web/wrangler.toml` |
| Realtime Worker: 3 DO classes, 4 migrations, 5-min cron, observability | `apps/realtime/wrangler.toml` |
| WebSocket hibernation + attachment persistence | `apps/realtime/src/room.ts`, `src/socket-registry.ts` |
| Room/user routing, fan-out concurrency and retry bounds | `apps/realtime/src/index.ts`, `src/room-routing.ts` |
| Alert monitor cron | `apps/realtime/src/alert-monitor.ts` |
| R2 incremental cache binding | `apps/web/open-next.config.ts` |
| `next/image` config + Router Cache TTL + proxy body limit | `apps/web/next.config.js` |
| Global + per-route rate limiting; fail-open behaviour | `apps/web/middleware.ts`, `lib/global-request-rate-limit.ts`, `lib/auth/rate-limit.ts` |
| Supabase service-role client, no other client | `apps/web/lib/supabase/service.ts` |
| Email sending (single site) | `apps/web/lib/email/index.ts` |
| Dependency health probes + down/recovery alerts | `apps/web/lib/health/dependencies.ts`, `lib/health/alert.ts` |
| Push delivery config, Expo caps, receipts | `apps/web/lib/push/expo.ts`, `lib/push/receipts.ts` |
| Direct-to-R2 video upload, no proxy fallback, 10 MB body cap | `apps/web/lib/video/video-upload.ts`, `lib/video/upload-guard.ts` |
| Image download proxy (Worker + R2 read) | `apps/web/app/api/image-download/route.ts` |
| GIPHY proxy + 60 s revalidate | `apps/web/app/api/giphy/route.ts` |
| R2 schema-of-record for media references | `packages/shared/src/r2-media.ts` |
| CI / deploy / preview workflows | `.github/workflows/{ci,deploy,preview}.yml` |
| Mobile build + submit profiles | `expo-app-standalone 3/eas.json` |
| Cost model and every assumption | `scripts/cost-model.mjs` |
| Structural audit, flows, concurrency model | `INFRASTRUCTURE-AUDIT.md` |
| Ranked performance findings (row-transfer amplification) | `docs/performance-audit.md` |
| Verified realtime scale ceiling (1,000 same-room users) | `docs/realtime-5k-loadtest-audit.md` |
