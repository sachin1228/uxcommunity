# Video Processing Pipeline (FFmpeg)

The platform's single, centralized video-processing pipeline. Every video
upload in the app flows through it — there is no per-UI-component
compression logic anywhere.

## Architecture

```
User
  ↓  pick video
Probe (mediabunny + byte inspection) → decide strategy
  ↓
POST /showcase/upload  → original to R2, video_media row (status: queued)
  ↓
Server-side transcoder (apps/transcoder — NATIVE ffmpeg, libx264 CRF 18)
  ↓  claims the job, downloads original, encodes, uploads canonical + poster
POST /api/internal/video/complete  → row → ready, posts patched
  ↓
Serve the canonical MP4 (faststart → Range streaming)

Fallback: if no transcoder is running, the client's ffmpeg.wasm worker
encodes in-browser after a grace period and finalizes directly.
```

### Two engines, one pipeline

The web app deploys to **Cloudflare Workers via OpenNext**, which cannot run
native ffmpeg/ffprobe binaries or child processes, so the pipeline has two
encode engines that share the SAME decision logic and the SAME argv builder
(`@uxcommunity/shared`):

1. **Server-side transcoder** (`apps/transcoder`) — the primary path. A
   small always-on container (Dockerfile included) with native ffmpeg
   installed. It polls `video_media` for `queued` rows, claims them
   atomically (any number of workers may run), encodes with the real
   libx264, uploads the canonical MP4 + poster, and completes the job
   through the web app's internal API (`Authorization: Bearer <API_SECRET>`,
   the same pattern as the realtime worker). Survives the user closing the
   tab; 5–20× faster than wasm; uniform quality and observability.
2. **ffmpeg.wasm in a Web Worker** — the fallback when no transcoder is
   running (e.g. local dev): after a grace period the client probes the
   `queued` job's status, encodes in-browser and finalizes directly. The
   state machine is identical, so the two paths are interchangeable.

Passthrough/remux sources never touch either engine.

### Self-hosted ffmpeg core

The ~31 MB wasm core is **self-hosted at `/ffmpeg/`** (apps/web/public/ffmpeg
— `scripts/fetch-ffmpeg-core.sh` pins the exact build with SHA-256
checksums), so the fallback engine never depends on a third-party CDN. It is
fetched lazily on the first in-browser transcode only and cached by the
browser; sources that pass through never download it. Override the location
with `NEXT_PUBLIC_FFMPEG_CORE_BASE_URL` (e.g. an R2 custom domain).
`@ffmpeg/core` (single-threaded build) needs no SharedArrayBuffer, so no
COOP/COEP headers are required.

## ONE canonical video

Exactly one processed object per upload — **no 480p/720p/1080p variants, no
mobile/desktop renditions**. The canonical object preserves the source's
width, height, aspect ratio and frame rate. Videos are never upscaled and
never downscaled. (A documented, configurable safety ceiling exists for the
_encode_ step only — see Safety limits.)

## Strategy decision (never re-encode an excellent source)

| Source | Strategy | What happens |
|---|---|---|
| H.264 + MP4 + faststart + sane bitrate + playable audio | `passthrough` | shipped as canonical, **zero re-encode** |
| H.264 in MOV / moov at end | `remux` | lossless packet-copy remux (mediabunny) → canonical |
| WebM / VP8 / VP9 / AV1 / HEVC / ProRes | `transcode` | full libx264 encode |
| H.264 + unplayable audio (PCM/AC3) | `transcode` (copyVideo) | video **bit-identical**, audio → AAC only |
| High bitrate for the resolution | `transcode` | CRF 18 re-encode (typically 40–70% smaller, visually lossless) |
| Unprobeable / above safety limits | `passthrough` | shipped untouched — quality beats bytes |

`bitrate` is estimated from `file.size × 8 ÷ duration`; the passthrough
ceiling is 12 Mbps (≤1080p) / 30 Mbps (>1080p), see `VIDEO_PASSTHROUGH`.

## FFmpeg configuration

`packages/shared/src/video/video-config.ts` is the single source of truth
(shared by the web app AND the transcoder service); the exact argv is built
by `buildEncodeArgs` (`video-encode.ts`):

```
ffmpeg -i input.mp4 -map 0:v:0
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -profile:v high
  [-map 0:a:0? -c:a aac -b:a 192k]        ← only when the source has audio
  -movflags +faststart -max_muxing_queue_size 1024
  output.mp4
```

- **CRF 18** — visually transparent default. If testing shows degradation on
  UI/screen-recording content, lower CRF to 17/16 (never touch resolution).
- **Preset** — `slow` up to 1080p; `medium` above (4K): a compute/memory
  bound for in-browser encoding, not a quality concession.
- **`yuv420p`** — maximum browser compatibility. 10-bit (HDR/wide-gamut)
  sources keep `yuv420p10le` (High10 profile auto-selected — the 8-bit High
  profile is omitted, since libx264 rejects `-profile:v high` at 10-bit).
- **Resolution / FPS / AR / rotation** — preserved implicitly: no scale,
  crop or fps filters are ever emitted; ffmpeg's autorotate applies on encode.
- **Audio** — AAC 192k (320k for 5.1/7.1). Silent sources stay silent — no
  synthetic audio track.
- **Faststart** — `+faststart` puts `moov` at the front for Range streaming;
  verified in tests (`isFaststart`).

Before encoding, the engine probes the source (ffmpeg.wasm's built-in
ffprobe in the browser; native ffprobe in the transcoder — codec,
dimensions, fps, pixel format, rotation, bitrate, audio) and refuses to
guess when probing fails (the lossless original becomes canonical via an R2
copy — never a guessed encode).

## Deploying the transcoder

```bash
docker build -f apps/transcoder/Dockerfile -t transcoder .   # from the repo root
docker run --env-file apps/transcoder/.env.example transcoder
```

Required env (see `apps/transcoder/.env.example`): Supabase URL + service
role, R2 credentials + bucket + public URL, the web app's `API_SECRET` and
`APP_URL`. Run as many replicas as you like — claims are atomic and the
processed key is media-ID derived, so duplicate/overlapping processing is
impossible. Crashed workers' leases expire (`CLAIM_LEASE_MS`, default 10
min) and another worker reclaims the job; per-job temp dirs under
`TEMP_DIR` are removed on success and failure; a hard per-job timeout kills
runaway encodes.

## R2 layout

```
media/videos/original/{mediaId}          untouched upload (transcodes only)
media/videos/processed/{mediaId}.mp4     THE canonical video
media/videos/posters/{mediaId}.jpg       single feed thumbnail
```

- Keys derive from the media UUID → finalize is idempotent by construction:
  duplicate processing requests overwrite the **same** object; a `ready` row
  short-circuits; two canonical videos can never exist.
- Passthrough/remux uploads store directly at the processed key
  (`original_key == processed_key`, one object, no copy).
- Once processing succeeds the original object is not exposed to the app
  (attachments always point at the canonical URL; the original URL exists
  only in `video_media` for forensics).
- Objects are tagged `Cache-Control: public, max-age=31536000, immutable`
  (versioned keys) and served via the bucket's custom domain.

## Database — `video_media`

One row per upload. State machine:
`uploaded → processing → ready`, `→ failed` (retry-safe), `→ deleted`
(tombstone); **`queued`** = handed to the server-side transcoder (wasm
fallback uses `uploaded` directly). The row records the original/processed/
poster keys + URLs, probed metadata (width/height/fps/duration/codecs/
sizes), attempts, processing time, error info and the claiming worker
(`claimed_by`/`claimed_at` for lease-based crash recovery).

Migration: `supabase/migrations/20260910120000_video_media.sql`.
Deleted rows keep their keys (forensics) but null the URL columns, so the
admin orphan scan never treats tombstones as live references.

## Lifecycle guarantees

- **Retry**: failed/crashed rows may be finalized again; the processed key
  is overwritten in place. The original stays in R2 — retrying never
  re-uploads.
- **Delete during processing**: finalize verifies the media row is not
  `deleted` and that the owning post still references the media; otherwise
  the output is discarded (R2 objects removed, row tombstoned). If the
  composer tab died before posting, the row is kept until the grace period
  (the user can still post) and then swept.
- **Post delete/edit**: showcase DELETE/PATCH tombstone the `video_media`
  rows for removed attachments and delete all three R2 objects, then the
  existing URL-level unreferenced cleanup runs as a second pass.
- **Abandoned uploads**: rows stuck in `uploaded`/`processing`/`failed`
  beyond the grace period are swept by Admin → Tools → R2 storage health
  (`sweep-abandoned-videos` action, 7-day default) — cleanup stays manual
  and admin-initiated, matching the repo's policy. `video_media` URL columns
  are part of `ALL_MEDIA_LOOKUPS`, so the orphan audit covers video objects
  too.
- **Engine failure fallback**: if the wasm core can't load/probe, the
  client calls finalize with `passthrough: true` and the lossless original
  is copied to the processed key — the upload is never blocked by the
  encoder.

## Frontend UX

Composer tiles show the pipeline state: **Uploading… → Processing… (NN%) →
Ready**, and **Retry** when an encode fails (no re-upload). The post can be
published while processing — the attachment carries
`{ mediaId, status, url: "" }` and the server resolves the canonical URL at
finalize (patching the post even if the tab closed). Feed cards / carousels
/ lightboxes render a "Processing video…" placeholder instead of a broken
player, and "Video unavailable" for failed/deleted media.

## Observability

Structured `[video:metrics]` logs on finalize: media ID, user, community,
strategy, status, width/height/fps/duration, codecs, original/processed
sizes, compression ratio, attempts, processing time, posts patched. The
`video_media` row is the durable metric store; the admin audit reports
stale-video counts.

## Safety limits (platform-level, configurable)

- Original uploads ≤ 25 MB (unchanged product cap).
- Encode throughput ≤ 3840×2160@30 px/s (4K@60 and above pass through
  losslessly instead of encoding).
- Encode duration ≤ 10 min (longer sources pass through).
- Finalize upload ≤ 150 MB (the canonical object can exceed a tiny
  original after a lossless remux).

## Testing

- Unit (always in CI, `npm run test:video-pipeline` + `npm run
  test:transcoder`): probe parsing (1080p/4K/60fps/portrait/square/silent/
  screen-recording/rotation/HDR), encode-args building, strategy decisions
  (passthrough/remux/transcode/copyVideo/safety), server lifecycle
  (idempotency, delete-during-processing, retry, cleanup, sweep, attachment
  resolution, container sniffing), and the transcoder's queue primitives
  (atomic claim, lease reclaim, failure recording) + byte/ffprobe probe
  merging.
- E2E (local, needs ffmpeg on PATH — `bash scripts/test-video-pipeline.sh`):
  generates 10 real sources and runs the exact worker argv, verifying with
  ffprobe that output preserves resolution, FPS, duration, aspect ratio and
  audio, and is faststart + yuv420p(+10le).
- The E2E run caught a real config bug during development (10-bit output
  with `-profile:v high` — libx264 rejects it) — keep it in the loop when
  touching encoder settings.