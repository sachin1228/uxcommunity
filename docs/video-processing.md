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
Upload original (or canonical for passthrough)     POST /showcase/upload
  ↓  video_media row created (status: uploaded|ready)
FFmpeg worker (ffmpeg.wasm in a Web Worker)        ← only for transcodes
  ↓  libx264 CRF 18, progress events
Finalize (canonical MP4 + poster → R2)             POST /showcase/video-finalize
  ↓  row → ready, owning post(s) patched server-side
Serve the canonical MP4 (faststart → Range streaming)
```

### Why ffmpeg.wasm in the browser?

The web app deploys to **Cloudflare Workers via OpenNext**, which cannot run
native ffmpeg/ffprobe binaries or child processes. The FFmpeg engine is
therefore ffmpeg.wasm (`@ffmpeg/ffmpeg` + `@ffmpeg/core`, MIT) running in a
dedicated Web Worker on the user's machine. It is the real FFmpeg — the same
libx264 encoder, presets and CRF semantics — so the quality settings below
apply exactly as written.

- The ~31 MB wasm core is fetched lazily on the **first transcode only** and
  cached by the browser. Sources that pass through never download it.
- `@ffmpeg/core` (single-threaded build) needs no SharedArrayBuffer, so no
  COOP/COEP headers are required.
- Self-host the core by setting `NEXT_PUBLIC_FFMPEG_CORE_BASE_URL` to a
  directory serving `ffmpeg-core.js` + `ffmpeg-core.wasm`
  (default: jsDelivr `@ffmpeg/core@0.12.10/dist/umd`).

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

`apps/web/lib/video/video-config.ts` is the single source of truth; the
exact argv is built by `buildEncodeArgs` (`video-encode.ts`):

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

Before encoding, the worker probes the source with ffmpeg.wasm's built-in
ffprobe (codec, dimensions, fps, pixel format, rotation, bitrate, audio) and
refuses to guess when probing fails (`probe-failed` → the lossless original
becomes canonical via an R2 copy — never a guessed encode).

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

One row per upload. State machine: `uploaded → processing → ready`,
`→ failed` (retry-safe), `→ deleted` (tombstone). The row records the
original/processed/poster keys + URLs, probed metadata (width/height/fps/
duration/codecs/sizes), attempts, processing time and error info.

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

- Unit (always in CI, `npm run test:video-pipeline`): probe parsing
  (1080p/4K/60fps/portrait/square/silent/screen-recording/rotation/HDR),
  encode-args building, strategy decisions (passthrough/remux/transcode/
  copyVideo/safety), server lifecycle (idempotency, delete-during-processing,
  retry, cleanup, sweep, attachment resolution, container sniffing).
- E2E (local, needs ffmpeg on PATH — `bash scripts/test-video-pipeline.sh`):
  generates 10 real sources and runs the exact worker argv, verifying with
  ffprobe that output preserves resolution, FPS, duration, aspect ratio and
  audio, and is faststart + yuv420p(+10le).
- The E2E run caught a real config bug during development (10-bit output
  with `-profile:v high` — libx264 rejects it) — keep it in the loop when
  touching encoder settings.