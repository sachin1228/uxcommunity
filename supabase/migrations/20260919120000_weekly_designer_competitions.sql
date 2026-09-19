-- ============================================================
-- Weekly Designer Competitions
--
-- A recurring weekly design challenge for the community:
--
--   Sunday 00:00  →  Friday  18:00   live        (submit + vote)
--   Friday 18:00  →  Saturday 00:00  voting_closed (vote only)
--   Saturday 00:00 → next Sunday     results     (winner + stats)
--   next Sunday   →                  archived    (history, revisitable)
--
-- Status is DERIVED from the stored timestamps (never hand-edited):
-- `public.competition_status()` is the single SQL definition, and
-- `apps/web/lib/competitions/cycle.ts` is the matching TypeScript one.
--
-- All timestamps are stored as UTC (`timestamptz`); the weekly cycle is
-- generated in the configured app timezone (see COMPETITIONS_TIMEZONE,
-- default UTC) so a "Sunday" boundary means the same instant for everyone
-- instead of depending on the visitor's browser locale.
--
-- Every rule that decides a winner (one vote per entry, no self votes, no
-- duplicate votes, entry caps, deadlines) is enforced here as well as in the
-- API route, because votes are community-authoritative data.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Updated-at trigger helper (shared, already used elsewhere)
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 1. Status derivation
--
-- IMMUTABLE so it can be used in views/indexes later: the clock is passed in
-- as `p_at` rather than calling now() internally.
-- ------------------------------------------------------------
create or replace function public.competition_status(
  p_start_at            timestamptz,
  p_submission_deadline timestamptz,
  p_voting_deadline     timestamptz,
  p_at                  timestamptz,
  p_archived_at         timestamptz default null
)
returns text
language sql
immutable
as $$
  select case
    when p_archived_at is not null and p_archived_at <= p_at then 'archived'
    when p_at < p_start_at then 'upcoming'
    when p_at < p_submission_deadline then 'live'
    when p_at < p_voting_deadline then 'voting_closed'
    else 'results'
  end;
$$;

comment on function public.competition_status(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) is
  'Derives the competition lifecycle status from its timestamps. Mirrors lib/competitions/cycle.ts.';

-- ------------------------------------------------------------
-- 2. Competitions
-- ------------------------------------------------------------
create table if not exists public.competitions (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,
  week_number           integer not null check (week_number > 0),
  title                 text not null,
  description           text not null default '',
  -- Structured brief: { problem, challenge, deliverable, dimensions, judging }
  brief                 jsonb not null default '{}'::jsonb,
  -- Admin-editable rule list rendered by the challenge page.
  rules                 jsonb not null default '[]'::jsonb,
  category              text not null default 'Product Design',
  difficulty            text not null default 'intermediate'
    check (difficulty in ('beginner', 'intermediate', 'advanced')),
  cover_image_url       text,
  start_at              timestamptz not null,
  submission_deadline   timestamptz not null,
  voting_deadline       timestamptz not null,
  results_at            timestamptz not null,
  archived_at           timestamptz,
  max_entries_per_user  integer not null default 1
    check (max_entries_per_user between 1 and 10),
  -- { one_vote_per_entry, allow_self_vote, allow_vote_removal, show_live_leaderboard }
  voting_rules          jsonb not null default
    '{"one_vote_per_entry": true, "allow_self_vote": false, "allow_vote_removal": true, "show_live_leaderboard": false}'::jsonb,
  created_by            uuid references public.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint competitions_window_order check (
    start_at < submission_deadline
    and submission_deadline <= voting_deadline
    and voting_deadline <= results_at
  )
);

comment on table public.competitions is
  'One row per weekly design challenge. status is derived via public.competition_status().';
comment on column public.competitions.archived_at is
  'Set when the next weekly cycle starts; from then on the competition lives in the archive.';

create index if not exists idx_competitions_start_at on public.competitions (start_at);
create index if not exists idx_competitions_voting_deadline on public.competitions (voting_deadline);
create index if not exists idx_competitions_results_at on public.competitions (results_at);
create index if not exists idx_competitions_archived_at on public.competitions (archived_at);
-- The "current cycle" scan filters on start_at/voting_deadline and orders by week.
create index if not exists idx_competitions_week on public.competitions (week_number desc);

drop trigger if exists set_competitions_updated_at on public.competitions;
create trigger set_competitions_updated_at
  before update on public.competitions
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. Entries
-- ------------------------------------------------------------
create table if not exists public.competition_entries (
  id                uuid primary key default gen_random_uuid(),
  competition_id    uuid not null references public.competitions (id) on delete cascade,
  user_id           uuid not null references public.users (id) on delete cascade,
  title             varchar(120) not null,
  description       text not null default '',
  -- Card cover (what the gallery shows).
  cover_image_url   text not null,
  -- The main design (what the detail page leads with).
  design_image_url  text not null,
  -- Optional extra shots: [{ name, url, type, size }]
  image_urls        jsonb not null default '[]'::jsonb,
  figma_url         text,
  prototype_url     text,
  tools             jsonb not null default '[]'::jsonb,
  tags              jsonb not null default '[]'::jsonb,
  is_featured       boolean not null default false,
  -- Moderation is a soft delete: the entry stays in history but disappears
  -- from the gallery, its votes stop counting, and the audit trail keeps why.
  soft_deleted_at   timestamptz,
  soft_deleted_by   uuid references public.users (id) on delete set null,
  soft_deleted_reason text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.competition_entries is
  'A designer''s submission. Soft-deleted (never destroyed) so results history stays intact.';

create index if not exists idx_competition_entries_competition_created
  on public.competition_entries (competition_id, created_at desc)
  where soft_deleted_at is null;
create index if not exists idx_competition_entries_competition_votes
  on public.competition_entries (competition_id, is_featured desc, created_at desc)
  where soft_deleted_at is null;
create index if not exists idx_competition_entries_user
  on public.competition_entries (competition_id, user_id)
  where soft_deleted_at is null;

drop trigger if exists set_competition_entries_updated_at on public.competition_entries;
create trigger set_competition_entries_updated_at
  before update on public.competition_entries
  for each row execute function public.set_updated_at();

-- Enforce the competition's entry cap at the database level.
create or replace function public.enforce_competition_entry_cap()
returns trigger
language plpgsql
as $$
declare
  v_max integer;
  v_count integer;
begin
  select max_entries_per_user into v_max
  from public.competitions
  where id = new.competition_id;

  if v_max is null then
    raise exception 'Competition % does not exist', new.competition_id
      using errcode = 'foreign_key_violation';
  end if;

  select count(*) into v_count
  from public.competition_entries
  where competition_id = new.competition_id
    and user_id = new.user_id
    and soft_deleted_at is null
    and id <> new.id;

  if v_count >= v_max then
    raise exception 'Entry limit reached for this competition'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_competition_entry_cap on public.competition_entries;
create trigger enforce_competition_entry_cap
  before insert on public.competition_entries
  for each row execute function public.enforce_competition_entry_cap();

-- ------------------------------------------------------------
-- 4. Votes
--
-- UNIQUE(competition_id, entry_id, user_id) is the duplicate-vote guarantee;
-- the trigger adds the cross-table rules a CHECK cannot express: the entry
-- must belong to the competition, and nobody votes for themselves.
-- ------------------------------------------------------------
create table if not exists public.competition_votes (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  entry_id       uuid not null references public.competition_entries (id) on delete cascade,
  user_id        uuid not null references public.users (id) on delete cascade,
  created_at     timestamptz not null default now(),
  constraint competition_votes_unique_per_entry
    unique (competition_id, entry_id, user_id)
);

comment on constraint competition_votes_unique_per_entry on public.competition_votes is
  'One vote per member per entry — the database-level duplicate guard.';

create index if not exists idx_competition_votes_entry on public.competition_votes (entry_id);
create index if not exists idx_competition_votes_user on public.competition_votes (user_id, created_at desc);
create index if not exists idx_competition_votes_competition on public.competition_votes (competition_id);

create or replace function public.validate_competition_vote()
returns trigger
language plpgsql
as $$
declare
  v_entry_user uuid;
  v_entry_competition uuid;
begin
  select user_id, competition_id into v_entry_user, v_entry_competition
  from public.competition_entries
  where id = new.entry_id;

  if v_entry_competition is null then
    raise exception 'Entry % does not exist', new.entry_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_entry_competition <> new.competition_id then
    raise exception 'Entry does not belong to this competition'
      using errcode = 'check_violation';
  end if;

  if v_entry_user = new.user_id then
    raise exception 'A member cannot vote for their own entry'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_competition_vote on public.competition_votes;
create trigger validate_competition_vote
  before insert on public.competition_votes
  for each row execute function public.validate_competition_vote();

-- ------------------------------------------------------------
-- 5. Comments
-- ------------------------------------------------------------
create table if not exists public.competition_comments (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  entry_id       uuid not null references public.competition_entries (id) on delete cascade,
  user_id        uuid not null references public.users (id) on delete cascade,
  parent_id      uuid references public.competition_comments (id) on delete cascade,
  body           varchar(1000) not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index if not exists idx_competition_comments_entry
  on public.competition_comments (entry_id, created_at);
create index if not exists idx_competition_comments_competition
  on public.competition_comments (competition_id, created_at desc);
create index if not exists idx_competition_comments_parent
  on public.competition_comments (parent_id)
  where parent_id is not null;

drop trigger if exists set_competition_comments_updated_at on public.competition_comments;
create trigger set_competition_comments_updated_at
  before update on public.competition_comments
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 6. Bookmarks
-- ------------------------------------------------------------
create table if not exists public.competition_bookmarks (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  entry_id       uuid not null references public.competition_entries (id) on delete cascade,
  user_id        uuid not null references public.users (id) on delete cascade,
  created_at     timestamptz not null default now(),
  constraint competition_bookmarks_unique unique (entry_id, user_id)
);

create index if not exists idx_competition_bookmarks_user
  on public.competition_bookmarks (user_id, created_at desc);

-- ------------------------------------------------------------
-- 7. Participants
--
-- One row per member who took part in a cycle (submitted, voted, or
-- commented). Keeps "347 designers took part" a single indexed count instead
-- of a union across three tables on every results render.
-- ------------------------------------------------------------
create table if not exists public.competition_participants (
  competition_id uuid not null references public.competitions (id) on delete cascade,
  user_id        uuid not null references public.users (id) on delete cascade,
  first_action   text not null default 'vote'
    check (first_action in ('entry', 'vote', 'comment')),
  joined_at      timestamptz not null default now(),
  primary key (competition_id, user_id)
);

create index if not exists idx_competition_participants_user
  on public.competition_participants (user_id, joined_at desc);

-- ------------------------------------------------------------
-- 8. Broadcast ledger
--
-- Notifications for competition start / deadline / results go to every
-- member, so they must fire exactly once per cycle. This table is the
-- idempotency key: the first caller inserts, everyone else is a no-op.
-- ------------------------------------------------------------
create table if not exists public.competition_broadcasts (
  competition_id  uuid not null references public.competitions (id) on delete cascade,
  kind            text not null check (kind in ('started', 'deadline_24h', 'results')),
  recipient_count integer not null default 0,
  sent_at         timestamptz not null default now(),
  primary key (competition_id, kind)
);

-- ------------------------------------------------------------
-- 9. Audit trail
--
-- Append-only record of the actions that decide a winner: submissions,
-- edits, votes, moderation, and result publication.
-- ------------------------------------------------------------
create table if not exists public.competition_audit_log (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid references public.competitions (id) on delete cascade,
  actor_id       uuid references public.users (id) on delete set null,
  action         text not null,
  entity_type    text,
  entity_id      uuid,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists idx_competition_audit_competition
  on public.competition_audit_log (competition_id, created_at desc);
create index if not exists idx_competition_audit_actor
  on public.competition_audit_log (actor_id, created_at desc);

-- ------------------------------------------------------------
-- 10. Row level security
--
-- Every read and write goes through the Next.js API with the service-role
-- client (custom cookie auth, no Supabase Auth), so the browser roles get no
-- access at all: RLS on, no policies, privileges revoked.
-- ------------------------------------------------------------
alter table public.competitions            enable row level security;
alter table public.competition_entries     enable row level security;
alter table public.competition_votes       enable row level security;
alter table public.competition_comments    enable row level security;
alter table public.competition_bookmarks   enable row level security;
alter table public.competition_participants enable row level security;
alter table public.competition_broadcasts  enable row level security;
alter table public.competition_audit_log   enable row level security;

revoke all on table public.competitions             from anon, authenticated;
revoke all on table public.competition_entries      from anon, authenticated;
revoke all on table public.competition_votes        from anon, authenticated;
revoke all on table public.competition_comments     from anon, authenticated;
revoke all on table public.competition_bookmarks    from anon, authenticated;
revoke all on table public.competition_participants from anon, authenticated;
revoke all on table public.competition_broadcasts   from anon, authenticated;
revoke all on table public.competition_audit_log    from anon, authenticated;

-- ------------------------------------------------------------
-- 11. Read RPCs
--
-- The gallery needs author, vote, comment and per-viewer state for every
-- card in one round trip; doing that in SQL avoids N+1 lookups from the app.
-- ------------------------------------------------------------
create or replace function public.get_competition_entries(
  p_competition_id uuid,
  p_user_id        uuid,
  p_sort           text default 'recent',
  p_limit          integer default 60,
  p_offset         integer default 0
)
returns table (
  id               uuid,
  competition_id   uuid,
  user_id          uuid,
  title            varchar,
  description      text,
  cover_image_url  text,
  design_image_url text,
  image_urls       jsonb,
  figma_url        text,
  prototype_url    text,
  tools            jsonb,
  tags             jsonb,
  is_featured      boolean,
  created_at       timestamptz,
  updated_at       timestamptz,
  author_name      text,
  author_avatar_url text,
  author_role      text,
  vote_count       integer,
  comment_count    integer,
  user_voted       boolean,
  user_bookmarked  boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.id,
    e.competition_id,
    e.user_id,
    e.title,
    e.description,
    e.cover_image_url,
    e.design_image_url,
    e.image_urls,
    e.figma_url,
    e.prototype_url,
    e.tools,
    e.tags,
    e.is_featured,
    e.created_at,
    e.updated_at,
    coalesce(u.name, 'Community member') as author_name,
    dp.avatar_url                        as author_avatar_url,
    dp.job_title                         as author_role,
    coalesce(v.vote_count, 0)::integer   as vote_count,
    coalesce(c.comment_count, 0)::integer as comment_count,
    exists (
      select 1 from public.competition_votes mv
      where mv.entry_id = e.id and mv.user_id = p_user_id
    ) as user_voted,
    exists (
      select 1 from public.competition_bookmarks mb
      where mb.entry_id = e.id and mb.user_id = p_user_id
    ) as user_bookmarked
  from public.competition_entries e
  left join public.users u on u.id = e.user_id
  left join public.designer_profiles dp on dp.user_id = e.user_id
  left join lateral (
    select count(*) as vote_count
    from public.competition_votes v
    where v.entry_id = e.id
  ) v on true
  left join lateral (
    select count(*) as comment_count
    from public.competition_comments cc
    where cc.entry_id = e.id and cc.deleted_at is null
  ) c on true
  where e.competition_id = p_competition_id
    and e.soft_deleted_at is null
  order by
    -- Featured first so an editor's pick leads the gallery, then the chosen
    -- sort. "votes" is only honoured for finished cycles (the API enforces
    -- that) so a live gallery never turns into a leaderboard.
    e.is_featured desc,
    case when p_sort = 'votes' then v.vote_count end desc nulls last,
    case when p_sort = 'oldest' then e.created_at end asc nulls last,
    e.created_at desc,
    e.id desc
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

create or replace function public.get_competition_entry(
  p_competition_id uuid,
  p_entry_id       uuid,
  p_user_id        uuid
)
returns table (
  id               uuid,
  competition_id   uuid,
  user_id          uuid,
  title            varchar,
  description      text,
  cover_image_url  text,
  design_image_url text,
  image_urls       jsonb,
  figma_url        text,
  prototype_url    text,
  tools            jsonb,
  tags             jsonb,
  is_featured      boolean,
  created_at       timestamptz,
  updated_at       timestamptz,
  author_name      text,
  author_avatar_url text,
  author_role      text,
  vote_count       integer,
  comment_count    integer,
  user_voted       boolean,
  user_bookmarked  boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.id,
    e.competition_id,
    e.user_id,
    e.title,
    e.description,
    e.cover_image_url,
    e.design_image_url,
    e.image_urls,
    e.figma_url,
    e.prototype_url,
    e.tools,
    e.tags,
    e.is_featured,
    e.created_at,
    e.updated_at,
    e.author_name,
    e.author_avatar_url,
    e.author_role,
    e.vote_count,
    e.comment_count,
    e.user_voted,
    e.user_bookmarked
  from public.get_competition_entries(p_competition_id, p_user_id, 'recent', 100, 0) e
  where e.id = p_entry_id;
$$;

create or replace function public.get_competition_stats(p_competition_id uuid)
returns table (
  entries      integer,
  designers    integer,
  votes        integer,
  comments     integer,
  participants integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select count(*) from public.competition_entries e
      where e.competition_id = p_competition_id and e.soft_deleted_at is null)::integer,
    (select count(distinct e.user_id) from public.competition_entries e
      where e.competition_id = p_competition_id and e.soft_deleted_at is null)::integer,
    (select count(*) from public.competition_votes v
      join public.competition_entries e on e.id = v.entry_id
      where v.competition_id = p_competition_id and e.soft_deleted_at is null)::integer,
    (select count(*) from public.competition_comments c
      where c.competition_id = p_competition_id and c.deleted_at is null)::integer,
    (select count(*) from public.competition_participants p
      where p.competition_id = p_competition_id)::integer;
$$;

-- Same counters for a whole page of cycles (the archive list) in one round
-- trip instead of one call per row.
create or replace function public.get_competition_stats_bulk(p_competition_ids uuid[])
returns table (
  competition_id uuid,
  entries        integer,
  designers      integer,
  votes          integer,
  comments       integer,
  participants   integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    ids.competition_id,
    (select count(*) from public.competition_entries e
      where e.competition_id = ids.competition_id and e.soft_deleted_at is null)::integer,
    (select count(distinct e.user_id) from public.competition_entries e
      where e.competition_id = ids.competition_id and e.soft_deleted_at is null)::integer,
    (select count(*) from public.competition_votes v
      join public.competition_entries e on e.id = v.entry_id
      where v.competition_id = ids.competition_id and e.soft_deleted_at is null)::integer,
    (select count(*) from public.competition_comments c
      where c.competition_id = ids.competition_id and c.deleted_at is null)::integer,
    (select count(*) from public.competition_participants p
      where p.competition_id = ids.competition_id)::integer
  from unnest(p_competition_ids) as ids(competition_id);
$$;

-- Archived cycles keep their winners; this returns the winning entry per
-- competition for the archive list in one query.
create or replace function public.get_competition_winners(p_competition_ids uuid[])
returns table (
  competition_id    uuid,
  entry_id          uuid,
  user_id           uuid,
  title             varchar,
  cover_image_url   text,
  design_image_url  text,
  author_name       text,
  author_avatar_url text,
  vote_count        integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (e.competition_id)
    e.competition_id,
    e.id,
    e.user_id,
    e.title,
    e.cover_image_url,
    e.design_image_url,
    coalesce(u.name, 'Community member') as author_name,
    dp.avatar_url as author_avatar_url,
    count(v.id)::integer as vote_count
  from public.competition_entries e
  left join public.users u on u.id = e.user_id
  left join public.designer_profiles dp on dp.user_id = e.user_id
  left join public.competition_votes v on v.entry_id = e.id
  where e.competition_id = any(p_competition_ids)
    and e.soft_deleted_at is null
  group by e.competition_id, e.id, e.user_id, e.title, e.cover_image_url,
           e.design_image_url, u.name, dp.avatar_url
  order by e.competition_id,
           count(v.id) desc,
           e.created_at asc;
$$;

-- ------------------------------------------------------------
-- 12. Notification types
--
-- Competitions reuse the existing notifications table: engagement rows carry
-- the same shape as thread/event engagement, and the cycle broadcasts get
-- their own types. entity_type gains the two competition scopes.
-- ------------------------------------------------------------
alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check check (
    type in (
      'thread_comment',
      'thread_reply',
      'thread_like',
      'resource_comment',
      'resource_reply',
      'event_comment',
      'event_reply',
      'event_rsvp',
      'competition_vote',
      'competition_comment',
      'competition_started',
      'competition_deadline',
      'competition_results'
    )
  );

alter table public.notifications
  drop constraint if exists notifications_entity_type_check;

alter table public.notifications
  add constraint notifications_entity_type_check check (
    entity_type in ('community', 'thread', 'resource', 'event', 'competition', 'competition_entry')
  );

-- ------------------------------------------------------------
-- 13. Seed the recurring weekly cycle
--
-- Anchored on the most recent Sunday 00:00 UTC so a fresh environment opens
-- on a live challenge, the results of last week, and next week's brief.
-- Bails out when any cycle already exists, so re-running is a no-op and an
-- existing schedule is never clobbered.
-- ------------------------------------------------------------
do $$
declare
  -- The most recent Sunday 00:00 UTC — the anchor of every weekly cycle.
  v_this_sunday timestamptz := (
    date_trunc('day', now() at time zone 'UTC')
    - make_interval(days => extract(dow from (now() at time zone 'UTC'))::int)
  ) at time zone 'UTC';
begin
  if exists (select 1 from public.competitions) then
    return;
  end if;

  insert into public.competitions (
    slug, week_number, title, description, brief, rules, category, difficulty,
    start_at, submission_deadline, voting_deadline, results_at
  ) values
    (
      'week-04-design-a-better-weather-app',
      4,
      'Design a Better Weather App',
      'Weather apps show numbers. Design one that helps someone decide what to wear before they even open the door.',
      jsonb_build_object(
        'problem', 'Most weather apps answer "what is the temperature?" when people actually want to know "how will my day feel?". Forecast data is dense and the decision it supports is invisible.',
        'challenge', 'Design a mobile weather experience that turns a forecast into a confident daily decision — what to wear, when to leave, and what to bring.',
        'deliverable', 'Three mobile screens plus a short written rationale. Show the primary forecast view, the moment of decision, and what happens on an unusual day.',
        'dimensions', 'Mobile — 390×844. Export at 2x.',
        'judging', 'Clarity of the decision, craft in typography and hierarchy, and originality of the interaction.'
      ),
      '["One submission per person","Design must be original","No AI-generated final designs","Follow the challenge brief","Be respectful when voting and commenting","Submission must be uploaded before the deadline"]'::jsonb,
      'Product Design',
      'intermediate',
      v_this_sunday,
      v_this_sunday + interval '5 days 18 hours',
      v_this_sunday + interval '6 days',
      v_this_sunday + interval '6 days'
    ),
    (
      'week-03-redesign-a-music-player',
      3,
      'Redesign a Music Player',
      'Design a mobile music player experience that makes discovering new music feel more personal.',
      jsonb_build_object(
        'problem', 'Streaming players are optimised for catalogue size, not for taste. Discovery is a list and the player itself tells you almost nothing about the song you are hearing.',
        'challenge', 'Redesign the player screen so it teaches you something about what you are listening to and quietly suggests what is next.',
        'deliverable', 'Two mobile screens and one motion or transition description.',
        'dimensions', 'Mobile — 390×844. Export at 2x.',
        'judging', 'Personalisation that feels earned rather than algorithmic, and restraint in the interface.'
      ),
      '["One submission per person","Design must be original","No AI-generated final designs","Follow the challenge brief","Be respectful when voting and commenting","Submission must be uploaded before the deadline"]'::jsonb,
      'Product Design',
      'advanced',
      v_this_sunday - interval '7 days',
      v_this_sunday - interval '1 day 6 hours',
      v_this_sunday - interval '1 day',
      v_this_sunday - interval '1 day'
    ),
    (
      'week-02-design-a-better-banking-app',
      2,
      'Design a Better Banking App',
      'Make a personal finance app that a first-time earner can understand at a glance.',
      jsonb_build_object(
        'problem', 'Finance apps surface balance and transactions, but say nothing about whether the month is going well.',
        'challenge', 'Design an overview that answers "am I okay this month?" without a single pie chart.',
        'deliverable', 'One overview screen and one detail state.',
        'dimensions', 'Mobile — 390×844. Export at 2x.',
        'judging', 'Trust, legibility, and how honestly the design handles a bad month.'
      ),
      '["One submission per person","Design must be original","No AI-generated final designs","Follow the challenge brief","Be respectful when voting and commenting","Submission must be uploaded before the deadline"]'::jsonb,
      'Fintech',
      'intermediate',
      v_this_sunday - interval '14 days',
      v_this_sunday - interval '8 days 6 hours',
      v_this_sunday - interval '8 days',
      v_this_sunday - interval '8 days'
    ),
    (
      'week-01-redesign-a-travel-experience',
      1,
      'Redesign a Travel Experience',
      'Rethink how someone plans a weekend trip without opening fourteen tabs.',
      jsonb_build_object(
        'problem', 'Trip planning is fragmented across search, notes, maps, and booking.',
        'challenge', 'Design a single planning surface that keeps the trip, not the tool, in the centre.',
        'deliverable', 'Two screens covering planning and the day-of view.',
        'dimensions', 'Mobile — 390×844. Export at 2x.',
        'judging', 'Reduction of steps and a clear point of view.'
      ),
      '["One submission per person","Design must be original","No AI-generated final designs","Follow the challenge brief","Be respectful when voting and commenting","Submission must be uploaded before the deadline"]'::jsonb,
      'Product Design',
      'beginner',
      v_this_sunday - interval '21 days',
      v_this_sunday - interval '15 days 6 hours',
      v_this_sunday - interval '15 days',
      v_this_sunday - interval '15 days'
    ),
    (
      'week-05-design-a-better-onboarding-experience',
      5,
      'Design a Better Onboarding Experience',
      'Design the first ninety seconds of a product that respects the person using it.',
      jsonb_build_object(
        'problem', 'Onboarding is usually a tour of features the designer wanted to ship, not a path to the user''s first success.',
        'challenge', 'Design an onboarding flow that gets someone to a real outcome before it ever explains a setting.',
        'deliverable', 'Three screens covering first open, first action, and first success.',
        'dimensions', 'Mobile — 390×844. Export at 2x.',
        'judging', 'Time to value, restraint, and how the empty state is designed.'
      ),
      '["One submission per person","Design must be original","No AI-generated final designs","Follow the challenge brief","Be respectful when voting and commenting","Submission must be uploaded before the deadline"]'::jsonb,
      'Onboarding',
      'intermediate',
      v_this_sunday + interval '7 days',
      v_this_sunday + interval '12 days 18 hours',
      v_this_sunday + interval '13 days',
      v_this_sunday + interval '13 days'
    );

  -- Older cycles are archived; the live and upcoming cycles are not.
  update public.competitions
  set archived_at = start_at + interval '7 days'
  where week_number <= 3;
end $$;
