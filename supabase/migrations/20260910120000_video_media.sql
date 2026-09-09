-- ============================================================
-- video_media — lifecycle record for the centralized video
-- pipeline (FFmpeg processing).
--
-- Every video upload gets ONE row here. The row is the source of
-- truth for the processing state machine:
--
--   uploaded → processing → ready
--                   ↓
--                 failed  (safe to retry)
--
--   deleted — tombstone; R2 objects are removed and URL columns
--   are nulled so the orphan audit no longer counts them as
--   references (keys are kept for forensics).
--
-- R2 key layout:
--   media/videos/original/{mediaId}          — untouched upload
--   media/videos/processed/{mediaId}.mp4     — canonical H.264 MP4
--   media/videos/posters/{mediaId}.jpg       — single feed thumbnail
--
-- For passthrough uploads (already-browser-perfect sources that are
-- shipped without re-encoding) original_key === processed_key — a
-- single object is stored at the processed key.
--
-- Runtime access is routed through authenticated Next.js service
-- routes (same pattern as every other table here): no anon /
-- authenticated policies are added.
-- ============================================================

create table if not exists public.video_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  community_id uuid references public.communities(id) on delete cascade,
  owner_type text not null default 'showcase'
    check (owner_type in ('showcase')),

  -- ── Processing state machine ──────────────────────────────
  -- uploaded = client-side (wasm) processing; queued = the server-side
  -- transcoder service has been asked to process this upload.
  status text not null default 'uploaded'
    check (status in ('uploaded', 'queued', 'processing', 'ready', 'failed', 'deleted')),
  strategy text
    check (strategy in ('transcode', 'passthrough')),
  attempts integer not null default 0,
  processing_ms integer,
  error_code text,
  error_message text,
  -- Server-side transcoder queue lease: which worker claimed the job and
  -- when; a crashed worker's jobs are reclaimed once the lease expires.
  claimed_by text,
  claimed_at timestamptz,

  -- ── R2 object keys + public URLs ──────────────────────────
  original_key text not null,
  processed_key text,
  poster_key text,
  original_url text,
  processed_url text,
  poster_url text,

  -- ── Probed input metadata (recorded at upload) ────────────
  width integer,
  height integer,
  fps numeric,
  duration_ms integer,
  video_codec text,
  audio_codec text,
  original_size integer,

  -- ── Processed output metadata (recorded at finalize) ──────
  processed_size integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  deleted_at timestamptz
);

create index if not exists video_media_user_created_idx
  on public.video_media (user_id, created_at desc);
create index if not exists video_media_community_status_idx
  on public.video_media (community_id, status);
create index if not exists video_media_status_created_idx
  on public.video_media (status, created_at);

alter table public.video_media enable row level security;