# k6 Stress Tests

Performance and stress tests for the drafthub API, written with [k6](https://k6.io).

## Directory layout

```
k6/
├── config.js               # Shared options, thresholds, base URL
├── utils/
│   ├── auth.js             # Login / logout helpers
│   └── checks.js           # Reusable check factories
├── tests/                  # Domain-specific test modules (imported by scenarios)
│   ├── 01_public_data.js   # GET /api/data/* and /api/giphy
│   ├── 02_auth.js          # login, logout, me, reset-request
│   ├── 03_applications.js  # POST /api/applications
│   ├── 04_communities.js   # communities, messages, reactions
│   ├── 05_threads.js       # threads, votes, comments
│   ├── 06_events.js        # events, rsvp, event comments
│   ├── 07_profile.js       # profile get/patch, interests, link-preview
│   └── 08_admin.js         # admin panel read + light write smoke
└── scenarios/
    ├── smoke.js            # 1 VU × 1 iter — sanity check
    ├── load.js             # Ramp to 50 VUs, hold 5 min — steady-state load
    ├── stress.js           # Spike to 200 VUs — find the breaking point
    └── soak.js             # 20 VUs × 30 min — detect resource leaks
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
| `BASE_URL` | No | Target server. Default: `drafthub-web.vercel.app` |
| `TEST_USER_EMAIL` | Yes* | Approved member account email |
| `TEST_USER_PASSWORD` | Yes* | Approved member account password |
| `ADMIN_EMAIL` | Smoke/admin only | Admin account email |
| `ADMIN_PASSWORD` | Smoke/admin only | Admin account password |
| `TEST_COMMUNITY_ID` | Yes* | UUID of a community the test user belongs to |
| `TEST_THREAD_ID` | No | UUID of an existing thread (used for read-only thread tests when no creation is desired) |
| `TEST_EVENT_ID` | No | UUID of an existing event |

> \* Required for authenticated test groups; tests will still run and report 404/401 if omitted.

---

## Running the tests

Always run the **smoke test first** to confirm the app is up and all routes respond before applying heavy load.

### Smoke test
```bash
k6 run k6/scenarios/smoke.js \
  -e BASE_URL=drafthub-web.vercel.app \
  -e ADMIN_EMAIL=admin@drafthub.com \
  -e ADMIN_PASSWORD=sachingalaxy1228@ \
  -e TEST_USER_EMAIL=patilsachin1228@gmail.com \
  -e TEST_USER_PASSWORD=sachin1228 \
  -e TEST_COMMUNITY_ID=2d98706f-367c-441b-9d5d-ace92fa8a859
```

### Load test (steady-state)
```bash
k6 run k6/scenarios/load.js \
  -e BASE_URL=drafthub-web.vercel.app \
  -e TEST_USER_EMAIL=patilsachin1228@gmail.com \
  -e TEST_USER_PASSWORD=sachin1228 \
  -e TEST_COMMUNITY_ID=2d98706f-367c-441b-9d5d-ace92fa8a859
```

### Stress test (spike to 200 VUs)
```bash
k6 run k6/scenarios/stress.js \
  -e BASE_URL=drafthub-web.vercel.app \
  -e TEST_USER_EMAIL=patilsachin1228@gmail.com \
  -e TEST_USER_PASSWORD=sachin1228 \
  -e TEST_COMMUNITY_ID=2d98706f-367c-441b-9d5d-ace92fa8a859
```

### Concurrent chat with thousands of distinct users

This is the big one. Each VU logs in as a **different real user**, so rate
limits don't interfere across VUs.

**Step 1 — seed users into your DB (run once):**
```bash
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
TEST_COMMUNITY_ID=2d98706f-367c-441b-9d5d-ace92fa8a859 \
K6_USER_COUNT=500 \
node k6/scripts/seed-users.js
```

This creates 500 users with profiles + community membership and writes
`k6/data/test-users.json` (gitignored — credentials stay local).

**Step 2 — run the concurrent chat scenario:**
```bash
k6 run k6/scenarios/chat_concurrent.js \
  -e BASE_URL=https://drafthub-web.vercel.app \
  -e TEST_COMMUNITY_ID=2d98706f-367c-441b-9d5d-ace92fa8a859 \
  -e CONCURRENT_VUS=500
```

Each VU: login → poll messages → send message → reply (40%) → react → mark read → delete own message → logout.

Custom metrics tracked: `chat_messages_sent`, `chat_rate_limit_hits`, `chat_reactions_sent`, `chat_message_send_ms`, `chat_poll_ms`.

**Step 3 — clean up after testing:**
```bash
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
node k6/scripts/cleanup-users.js
```

---

### Chat load test (20 VUs steady + 100 VU spike)
```bash
k6 run k6/scenarios/chat_load.js \
  -e BASE_URL=https://drafthub-web.vercel.app \
  -e TEST_USER_EMAIL=member@example.com \
  -e TEST_USER_PASSWORD=your-user-password \
  -e TEST_COMMUNITY_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### Soak test (30 minutes)
```bash
k6 run k6/scenarios/soak.js \
  -e BASE_URL=drafthub-web.vercel.app \
  -e TEST_USER_EMAIL=patilsachin1228@gmail.com \
  -e TEST_USER_PASSWORD=sachin1228 \
  -e TEST_COMMUNITY_ID=2d98706f-367c-441b-9d5d-ace92fa8a859
```

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
| Public data | `/api/data/cities`, `/api/data/companies`, `/api/data/sectors`, `/api/data/interests`, `/api/data/experience-levels`, `/api/giphy` |
| Auth | `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/reset-request` |
| Applications | `POST /api/applications` |
| Communities | `/api/communities`, `/api/communities/all`, `/api/communities/:id`, `/api/communities/:id/stats`, `/api/communities/:id/messages`, `/api/communities/:id/messages/:id/reactions`, `/api/communities/:id/read` |
| Threads | `/api/communities/:id/threads`, `/api/communities/:id/threads/:id`, `/api/communities/:id/threads/:id/vote`, `/api/communities/:id/threads/:id/comments` |
| Events | `/api/communities/:id/events`, `/api/communities/:id/events/:id`, `/api/communities/:id/events/:id/rsvp`, `/api/communities/:id/events/:id/rsvp/list`, `/api/communities/:id/events/:id/comments` |
| Profile | `/api/profile`, `/api/profile/interests`, `/api/profile/threads`, `/api/lottie-settings`, `/api/link-preview` |
| Admin (read) | `/api/admin/applications`, `/api/admin/users`, `/api/admin/communities`, `/api/admin/cities`, `/api/admin/sectors`, `/api/admin/companies`, `/api/admin/interests`, `/api/admin/moderation`, `/api/admin/tags` |
| Chat (deep) | `GET /api/communities/:id/messages` (list + pagination), `POST` (text, reply, burst), `GET /api/communities/:id/messages/:id` (single), `POST /api/communities/:id/messages/:id/reactions` (add, toggle, switch), `DELETE` (soft-delete), `PATCH /api/communities/:id/read`, `GET /api/communities/:id/stats` |
| Admin (write, smoke only) | `POST /api/admin/cities`, `POST /api/admin/interests` |

---

## Notes

- **Rate-limited endpoints** (`/api/auth/login`, `/api/applications`, `/api/auth/reset-request`) intentionally accept `429 Too Many Requests` as a passing response — the limiter working correctly is the expected behaviour under load.
- **Upload endpoints** (`/api/profile/avatar`, `/api/admin/upload`, `/api/communities/:id/messages/upload`, etc.) are not covered here — multipart file upload with realistic payloads is out of scope for API stress tests.
- **Destructive admin operations** (approve/reject application, block user, delete user) are excluded from load and stress scenarios to avoid corrupting test data.
- Tests create and then delete their own resources (messages, threads, events) where possible to keep the database clean.
