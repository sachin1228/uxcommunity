# k6 Stress Tests

Performance and stress tests for the UX Community API, written with [k6](https://k6.io).

## Directory layout

```
k6/
├── config.js               # Shared options, thresholds, base URL
├── data/                   # Gitignored fixtures (test-users.json) + .gitkeep
├── lib/
│   ├── fixture.js          # Shape + validation rules for generated test users
│   └── fixture.test.mjs    # Unit test for the fixture rules (npm run test:k6-fixtures)
├── utils/
│   ├── auth.js             # Login / logout helpers
│   ├── checks.js           # Reusable check factories
│   └── test-users.js       # Loads the local, gitignored seeded-user fixture
├── tests/                  # Domain-specific test modules (imported by scenarios)
│   ├── 01_public_data.js   # GET /api/data/* and /api/giphy
│   ├── 02_auth.js          # login, logout, me, reset-request
│   ├── 03_applications.js  # POST /api/applications
│   ├── 04_communities.js   # communities, messages, reactions
│   ├── 05_threads.js       # threads, likes, comments
│   ├── 06_events.js        # events, rsvp, event comments
│   ├── 07_profile.js       # profile get/patch, interests, link-preview
│   ├── 08_admin.js         # admin panel read + light write smoke
│   └── 09_chat_messages.js # deep chat coverage: pagination, replies, reactions, delete, read
├── scenarios/              # k6 entry points
│   ├── smoke.js            # 1 VU × 1 iter — sanity check
│   ├── load.js             # Ramp to 50 VUs, hold 5 min — steady-state load
│   ├── stress.js           # Spike to 200 VUs — find the breaking point
│   ├── soak.js             # 20 VUs × 30 min — detect resource leaks
│   ├── chat_load.js        # 20 VUs steady + 100 VU chat spike (one real account)
│   ├── chat_concurrent.js  # Distinct seeded user per VU (login → send → react → read)
│   └── chat_flood.js       # Raw POST /messages throughput with pre-signed JWTs
├── scripts/
│   ├── seed-users.js       # Creates k6user_* fixtures + writes k6/data/test-users.json
│   ├── cleanup-users.js    # Deletes seeded users and the fixture
│   └── rsvp-regression-test.mjs  # Live home-feed RSVP revert regression
├── loadtest-5k.mjs         # 5,000-socket production realtime load test (node, not k6)
└── staging-*.mjs           # Realtime staging smoke / diagnostic / 5k helpers
```

## Prerequisites

### Install k6

**macOS**
```bash
brew install k6
```

**Linux (Debian/Ubuntu)**
```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

**Docker**
```bash
docker pull grafana/k6
# Then replace `k6 run` with:
# docker run --rm -i grafana/k6 run - < k6/scenarios/smoke.js
```

**Windows**
```powershell
winget install k6 --source winget
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `BASE_URL` | No | Target server. Default: `app.uxcommunity.in` |
| `TEST_USER_EMAIL` | Yes* | Approved member account email |
| `TEST_USER_PASSWORD` | Yes* | Approved member account password |
| `ADMIN_EMAIL` | Smoke/admin only | Admin account email |
| `ADMIN_PASSWORD` | Smoke/admin only | Admin account password |
| `TEST_COMMUNITY_ID` | Yes* | UUID of a community the test user belongs to |
| `TEST_THREAD_ID` | No | UUID of an existing thread (used for read-only thread tests when no creation is desired) |
| `TEST_EVENT_ID` | No | UUID of an existing event |
| `SESSION_SECRET` | Seeding only | JWT signing secret of the target environment. Must match it, otherwise the seeded sessions are rejected |
| `SUPABASE_URL` | Seeding only | Supabase project URL used by `npm run k6:seed` / `npm run k6:cleanup` |
| `SUPABASE_SERVICE_ROLE_KEY` | Seeding only | Service-role key; server-side only, never exposed to clients |
| `K6_USER_COUNT` | No | How many seeded users to create (default: 200) |
| `K6_USER_PASSWORD` | No | Password for the seeded users. Reused from the local fixture or generated when omitted |
| `K6_USER_PREFIX` | No | Email prefix for seeded users (default: `k6user`) |
| `CONCURRENT_VUS`, `FLOOD_VUS`, `FLOOD_DURATION` | No | VU counts / duration for the seeded-user chat scenarios |

> \* Required for authenticated test groups. Scenarios that need a real account
> (e.g. `smoke`) stop with an explicit `<VAR> is not set` message instead of
> logging in with a placeholder; the seeded-user chat scenarios stop with the
> exact command that generates the fixture. Never commit values for any of
> these — no credential material belongs in the repository.

---

## Test users and generated fixtures

Credentials are **never committed**. Everything in `k6/data/` except
`.gitkeep` is gitignored (see the `k6/data/*` rule in `.gitignore`), and
`npm run test:k6-fixtures` fails if any credential material is tracked under
`k6/`.

Two kinds of users are involved:

| Kind | Where it comes from | Used by |
|---|---|---|
| **Your accounts** (`TEST_USER_EMAIL`, `ADMIN_EMAIL`, …) | env vars you export locally | `smoke`, `load`, `stress`, `soak`, `chat_load` |
| **Seeded users** (`k6user_NNNN@k6test.invalid`) | `npm run k6:seed` → `k6/data/test-users.json` | `chat_concurrent`, `chat_flood` |

### Seeded users (for the concurrent chat and flood scenarios)

```bash
SUPABASE_URL=https://<project>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
TEST_COMMUNITY_ID=<community-uuid> \
SESSION_SECRET=<same secret as the target environment> \
K6_USER_COUNT=500 \
K6_USER_PASSWORD=<pick a throwaway password> \
  npm run k6:seed
```

What the seeder does:

- creates `k6user_NNNN@k6test.invalid` users plus `designer_profiles` rows and
  community memberships (idempotent — existing users are reused);
- signs a 7-day session JWT per user with `SESSION_SECRET`, exactly like the app
  does on login (`apps/web/lib/auth/session.ts`), and writes it to the local,
  **untracked** `k6/data/test-users.json`;
- refuses to run if `k6/data/test-users.json` would not be gitignored;
- validates every record before writing, so the file can never contain an empty
  password or token.

`K6_USER_PASSWORD` is optional: when you omit it the seeder reuses the password
recorded in the existing local fixture, or generates a random one for this run.
There is no default password in the repository.

Sessions only work against an environment whose `SESSION_SECRET` matches the one
you seeded with — a locally signed JWT is **not** a Supabase Auth session.

Remove the users and the fixture when you are done:

```bash
SUPABASE_URL=https://<project>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  npm run k6:cleanup
```

---

## Running the tests

Always run the **smoke test first** to confirm the app is up and all routes respond before applying heavy load.

Export your own test accounts once per shell — these are real accounts on the
environment you are testing, so keep them out of git (there is no committed
default):

```bash
export BASE_URL=https://your-app.example
export TEST_COMMUNITY_ID=<community-uuid>
export TEST_USER_EMAIL=member@example.com      # an approved member you control
export TEST_USER_PASSWORD='<member-password>'  # never commit this
export ADMIN_EMAIL=admin@example.com           # smoke / admin tests only
export ADMIN_PASSWORD='<admin-password>'       # never commit this
```

Every scenario also accepts the same values as `-e KEY=value` flags. Missing
values surface as explicit `✗ MISSING` / `ERROR:` messages rather than a silent
404 or 401.

### Smoke test
```bash
k6 run k6/scenarios/smoke.js \
  -e BASE_URL="$BASE_URL" \
  -e ADMIN_EMAIL="$ADMIN_EMAIL" \
  -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e TEST_USER_EMAIL="$TEST_USER_EMAIL" \
  -e TEST_USER_PASSWORD="$TEST_USER_PASSWORD" \
  -e TEST_COMMUNITY_ID="$TEST_COMMUNITY_ID"
```

### Load test (steady-state)
```bash
k6 run k6/scenarios/load.js \
  -e BASE_URL="$BASE_URL" \
  -e TEST_USER_EMAIL="$TEST_USER_EMAIL" \
  -e TEST_USER_PASSWORD="$TEST_USER_PASSWORD" \
  -e TEST_COMMUNITY_ID="$TEST_COMMUNITY_ID"
```

### Stress test (spike to 200 VUs)
```bash
k6 run k6/scenarios/stress.js \
  -e BASE_URL="$BASE_URL" \
  -e TEST_USER_EMAIL="$TEST_USER_EMAIL" \
  -e TEST_USER_PASSWORD="$TEST_USER_PASSWORD" \
  -e TEST_COMMUNITY_ID="$TEST_COMMUNITY_ID"
```

### Concurrent chat with thousands of distinct users

This is the big one. Each VU logs in as a **different real user**, so rate
limits don't interfere across VUs.

**Step 1 — seed users into your DB (run once):** see
[Seeded users](#seeded-users-for-the-concurrent-chat-and-flood-scenarios) above,
or in short:

```bash
K6_USER_COUNT=500 npm run k6:seed
```

This creates 500 users with profiles + community membership and writes
`k6/data/test-users.json` (gitignored — credentials stay local).

**Step 2 — run the concurrent chat scenario:**
```bash
k6 run k6/scenarios/chat_concurrent.js \
  -e BASE_URL="$BASE_URL" \
  -e TEST_COMMUNITY_ID="$TEST_COMMUNITY_ID" \
  -e CONCURRENT_VUS=500
```

Each VU: login → poll messages → send message → reply (40%) → react → mark read → delete own message → logout.

Custom metrics tracked: `chat_messages_sent`, `chat_rate_limit_hits`, `chat_reactions_sent`, `chat_message_send_ms`, `chat_poll_ms`.

**Step 3 — clean up after testing:** `npm run k6:cleanup`
(deletes the `@k6test.invalid` users and the local fixture).

---

### Chat load test (20 VUs steady + 100 VU spike)
```bash
k6 run k6/scenarios/chat_load.js \
  -e BASE_URL="$BASE_URL" \
  -e TEST_USER_EMAIL="$TEST_USER_EMAIL" \
  -e TEST_USER_PASSWORD="$TEST_USER_PASSWORD" \
  -e TEST_COMMUNITY_ID="$TEST_COMMUNITY_ID"
```

### Soak test (30 minutes)
```bash
k6 run k6/scenarios/soak.js \
  -e BASE_URL="$BASE_URL" \
  -e TEST_USER_EMAIL="$TEST_USER_EMAIL" \
  -e TEST_USER_PASSWORD="$TEST_USER_PASSWORD" \
  -e TEST_COMMUNITY_ID="$TEST_COMMUNITY_ID"
```

### Chat flood (raw write throughput)

Uses pre-signed JWTs from the seeded fixture — no login calls, so the IP rate
limiter is not involved:

```bash
k6 run k6/scenarios/chat_flood.js \
  -e BASE_URL="$BASE_URL" \
  -e TEST_COMMUNITY_ID="$TEST_COMMUNITY_ID" \
  -e FLOOD_VUS=100 \
  -e FLOOD_DURATION=5m
```

---

## Realtime and regression helpers

These are plain Node scripts (not k6) and talk to the Cloudflare realtime
worker directly; they need `SESSION_SECRET` and, for publishing,
`REALTIME_PUBLISH_SECRET` of the target environment.

| Script | What it does |
|---|---|
| `node k6/loadtest-5k.mjs` | Opens 5,000 authenticated WebSockets against production, subscribes to rooms and measures a single fan-out |
| `node k6/staging-smoke-test.mjs` | Connect → join → subscribe → publish → receive against the staging worker |
| `node k6/staging-loadtest-5k.mjs` | The 5k realtime test pointed at the staging worker |
| `node k6/staging-direct-proof.mjs`, `node k6/staging-diagnostic.mjs` | Room-routing / delivery diagnostics |
| `node k6/scripts/rsvp-regression-test.mjs` | Reproduces the home-feed "I'm going" revert flow against a live environment |

Each script documents its own env vars in its header comment.

---

## Thresholds

All scenarios share these default pass/fail thresholds (defined in `config.js`):

| Metric | Threshold |
|---|---|
| `http_req_duration` p(95) | < 2 000 ms |
| `http_req_duration` p(99) | < 5 000 ms |
| `http_req_failed` (error rate) | < 5 % |
| `checks` (assertion pass rate) | > 95 % |

The stress scenario relaxes the error-rate threshold to 15 % — the goal there is to *find* the breaking point, not pass every check.

---

## Endpoints covered

| Group | Endpoints |
|---|---|
| Public data | `/api/data/cities`, `/api/data/sectors`, `/api/data/interests`, `/api/data/experience-levels`, `/api/giphy` |
| Auth | `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/reset-request` |
| Applications | `POST /api/applications` |
| Home feed | `/api/home/feed` (used by the RSVP regression script) |
| Communities | `/api/communities`, `/api/communities/all`, `/api/communities/:id`, `/api/communities/:id/messages`, `/api/communities/:id/messages/:msgId/reactions`, `/api/communities/:id/read` |
| Threads | `/api/communities/:id/threads`, `/api/communities/:id/threads/:threadId`, `/api/communities/:id/threads/:threadId/like`, `/api/communities/:id/threads/:threadId/comments`, `/api/communities/:id/threads/:threadId/comments/:commentId` |
| Events | `/api/communities/:id/events`, `/api/communities/:id/events/:eventId`, `/api/communities/:id/events/:eventId/rsvp`, `/api/communities/:id/events/:eventId/rsvp/list`, `/api/communities/:id/events/:eventId/comments` |
| Profile | `/api/profile`, `/api/profile/avatar`, `/api/profile/interests`, `/api/lottie-settings`, `/api/link-preview` |
| Admin (read) | `/api/admin/applications`, `/api/admin/users`, `/api/admin/communities`, `/api/admin/cities`, `/api/admin/sectors`, `/api/admin/interests`, `/api/admin/tags` |
| Admin (write, smoke only) | `POST /api/admin/cities`, `POST /api/admin/interests`, `POST /api/admin/upload` |
| Chat (deep, `09_chat_messages.js`) | `GET /api/communities/:id/messages` (list + pagination), `POST` (text, reply, rate-limit burst), `GET /api/communities/:id/messages/:msgId` (single), `POST /api/communities/:id/messages/:msgId/reactions` (add, toggle, switch), `DELETE /api/communities/:id/messages/:msgId` (soft-delete), `PATCH /api/communities/:id/read` |

Not covered: thread/event/resource/showcase **uploads**, push registration, and the
realtime WebSocket protocol (the node scripts below cover that instead).

---

## Verifying the fixture plumbing

```bash
npm run test:k6-fixtures    # shape/validation rules + "no credentials tracked" guards
npm run k6:seed             # writes k6/data/test-users.json (untracked)
k6 inspect k6/scenarios/chat_concurrent.js   # proves the scenarios can load it
```

The unit test needs no network, database, or k6 binary. Running a scenario that
uses seeded users without the fixture fails with the exact command to fix it:

```
k6/data/test-users.json was not found.
Generate it locally with: npm run k6:seed
  Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEST_COMMUNITY_ID, SESSION_SECRET
  SESSION_SECRET must match the target environment so the generated
  sessions are accepted there.
```

---

## Notes

- **Generated fixtures are secrets** — `k6/data/test-users.json` holds plaintext
  passwords and valid session cookies for the seeded `@k6test.invalid` users on
  the environment you seeded into. Keep it local, and `npm run k6:cleanup` when
  you are done. If such a file was ever committed, treat those sessions as
  leaked: delete the users and rotate the environment's `SESSION_SECRET`.
- **Rate-limited endpoints** (`/api/auth/login`, `/api/applications`, `/api/auth/reset-request`) intentionally accept `429 Too Many Requests` as a passing response — the limiter working correctly is the expected behaviour under load.
- **Upload endpoints** (`/api/profile/avatar`, `/api/admin/upload`, `/api/communities/:id/messages/upload`, etc.) are not covered here — multipart file upload with realistic payloads is out of scope for API stress tests.
- **Destructive admin operations** (approve/reject application, block user, delete user) are excluded from load and stress scenarios to avoid corrupting test data.
- Tests create and then delete their own resources (messages, threads, events) where possible to keep the database clean.
