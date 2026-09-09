# Transcoder deployment runbook

Operational guide for `apps/transcoder` — the server-side encode engine of
the video pipeline. It polls `video_media` rows in `queued` state, encodes
originals with **native ffmpeg** using the exact shared argv the browser
worker uses (libx264, CRF 18, faststart), uploads the canonical MP4 + poster
to R2, and completes jobs through the web app's internal API.

If no transcoder is running, the client falls back to the in-browser
ffmpeg.wasm worker after a grace period — video processing degrades to
slower, tab-bound encodes, but never breaks.

## Prerequisites

| Requirement | Why |
|---|---|
| Docker (or Node ≥ 22 + ffmpeg/ffprobe on PATH) | runtime |
| Supabase project (URL + service-role key) | job queue (`video_media` table) |
| Cloudflare R2 bucket + API credentials | original/processed/poster objects |
| Web app `API_SECRET` + public `APP_URL` | internal `/api/internal/video/complete` auth |
| Network access to Supabase, R2, and the web app | job lifecycle |

The `video_media` migration (`supabase/migrations/20260910120000_video_media.sql`)
must be applied before first run.

## Environment variables

All documented in `apps/transcoder/.env.example`. Required:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key (claims jobs, marks failures) |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API credentials |
| `R2_BUCKET_NAME` | bucket (must match the web app) |
| `R2_PUBLIC_URL` | bucket custom domain (must match the web app) |
| `API_SECRET` | MUST equal the web app's `API_SECRET` |
| `APP_URL` | web app base URL, e.g. `https://app.uxcommunity.in` |

Optional:

| Variable | Default | Description |
|---|---|---|
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | binary locations |
| `WORKER_ID` | `transcoder-<hostname>` | unique per instance (health dashboard label) |
| `POLL_INTERVAL_MS` | `5000` | queue poll interval |
| `JOB_BATCH_SIZE` | `2` | jobs processed per poll cycle |
| `CLAIM_LEASE_MS` | `600000` (10 min) | crash-recovery lease; must exceed the longest encode |
| `PROCESS_TIMEOUT_MS` | `1500000` (25 min) | hard per-job timeout (kills runaway encodes) |
| `TEMP_DIR` | `/tmp/transcoder` | per-job temp dirs (cleaned on success and failure) |
| `HEALTH_PORT` / `HEALTH_BIND` | `9090` / `0.0.0.0` | health endpoint for probes + admin dashboard |

## Build & run (Docker)

Build from the **repo root** (npm workspaces — the lockfile references every
workspace manifest and the service depends on `@uxcommunity/shared`):

```bash
docker build -f apps/transcoder/Dockerfile -t transcoder:latest .

docker run -d --name transcoder \
  --restart unless-stopped \
  --env-file apps/transcoder/.env.production \
  -p 9090:9090 \
  -v transcoder-tmp:/tmp/transcoder \
  transcoder:latest
```

Local (no Docker):

```bash
npm install            # repo root (workspaces)
cp apps/transcoder/.env.example apps/transcoder/.env.production  # fill values
set -a; source apps/transcoder/.env.production; set +a
npm run start --workspace=apps/transcoder
```

### Scaling

Run **any number of replicas** — claims are atomic (conditional UPDATE on
`status = 'queued'`), the processed R2 key is media-ID derived (idempotent
overwrite), and crashed workers' leases are reclaimed by the next poll.
Typical starting point: 2 replicas; add more as the queue depth grows.

### Container probes

```yaml
# compose example
healthcheck:
  test: ["CMD", "curl", "-fsS", "http://127.0.0.1:9090/health"]
  interval: 30s
  timeout: 5s
  retries: 3
```

`/health` returns `200` when ffmpeg, ffprobe, Supabase and R2 all check out,
`503` (`status: "degraded"`) when any check fails. Also reports queue depth
and per-worker job stats (`jobsProcessed`, `jobsFailed`, `lastError`) — the
admin dashboard renders the same payload.

## Admin dashboard

Admin → **Tools → Video pipeline health** proxies the worker(s) `/health`
endpoints. Configure the web app with:

```
TRANSCODER_HEALTH_URL=http://transcoder-1:9090,http://transcoder-2:9090
```

The web app fetches these server-side (Cloudflare Workers), so the
transcoder URLs are never exposed to browsers. The card shows per-worker
status chips (ffmpeg / ffprobe / Supabase / R2), queue depth, and job stats.

## Verifying end-to-end

1. **Start the worker** — logs should show:
   ```
   [transcoder] starting worker "transcoder-1" (...)
   [transcoder] health endpoint: http://0.0.0.0:9090/health
   ```
2. **Check health**: `curl http://127.0.0.1:9090/health` → `"status": "ok"`
   with all four checks green.
3. **Upload a video** that needs transcoding (WebM, HEVC, or a high-bitrate
   MP4) through the showcase composer in the web app.
4. **Watch the job flow**:
   ```
   [transcoder] job <mediaId> started (strategy=transcode)
   [transcoder] job <mediaId> done in 12345ms
   ```
5. **Verify in the DB** (`video_media` row for that media ID):
   `status` went `queued → processing → ready`, `processed_key` and
   `processed_url` are set, `attempts` incremented.
6. **Verify in R2**: `media/videos/processed/{mediaId}.mp4` and
   `media/videos/posters/{mediaId}.jpg` exist.
7. **Verify in the UI**: the composer tile flipped to Ready, and any already
   published post shows the processed video.

Negative test: stop the worker, upload a video, confirm the client falls
back to in-browser processing after the grace period and still completes.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Job stuck in `queued` | worker not running / DB unreachable | check worker logs + `/health`; Supabase check shows the failure |
| `ffmpeg` check red | binary missing in image/host | install ffmpeg (Dockerfile does), or set `FFMPEG_PATH` |
| `complete route returned 401` | `API_SECRET` mismatch | set the worker's `API_SECRET` to the web app's value |
| `complete route returned 404` | `APP_URL` wrong / route not deployed | deploy the web app (route: `/api/internal/video/complete`) |
| R2 check red / upload 403 | R2 credentials or bucket name wrong | verify against the web app's values |
| Job failed with a timeout | encode exceeds `PROCESS_TIMEOUT_MS` | raise the timeout (and `CLAIM_LEASE_MS` to stay above it) |
| Worker crashes mid-encode | any | lease reclaims the job after `CLAIM_LEASE_MS`; the row goes back to `processing` under a new claim — re-encode is safe (media-ID keyed) |
| Health dashboard shows nothing | `TRANSCODER_HEALTH_URL` unset | set it in the web app env (see above) |

## Metrics & observability

- Structured `[transcoder]` job logs: media ID, strategy, duration, outcome.
- `/health`: queue depth, per-worker processed/failed counts, last error,
  uptime — the same payload the admin dashboard renders.
- The durable record is the `video_media` row (status, attempts,
  `processing_ms`, `error_code/message`) plus the web app's
  `[video:metrics]` logs at completion.