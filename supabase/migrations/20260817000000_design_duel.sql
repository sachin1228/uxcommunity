-- ============================================================
-- Design Duel — competitive UI/UX game.
--
-- Tables, RLS, and server-side game logic for the challenge →
-- fix the UI → submit → anonymous A/B vote → result flow.
--
-- Runtime access is intentionally routed through authenticated
-- Next.js service routes (createServiceClient). No anon/
-- authenticated table policies are added, preventing direct
-- Data API writes. All scoring / XP / deadline / ownership
-- logic lives in the functions below so it can never be
-- manipulated from the client.
-- ============================================================

-- ─── Challenges ─────────────────────────────────────────────
create table if not exists public.design_duel_challenges (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique,
  title                text not null check (char_length(title) between 1 and 120),
  description          text not null check (char_length(description) between 1 and 1000),
  goal                 text not null default '' check (char_length(goal) <= 1000),
  difficulty           text not null check (difficulty in ('easy', 'medium', 'hard')),
  time_limit_seconds   integer not null check (time_limit_seconds between 60 and 3600),
  starting_design      jsonb not null,
  constraints          jsonb not null default '[]'::jsonb,
  status               text not null default 'active' check (status in ('active', 'draft', 'archived')),
  min_votes            integer not null default 5 check (min_votes between 1 and 100),
  duel_duration_minutes integer not null default 60 check (duel_duration_minutes between 5 and 4320),
  featured             boolean not null default false,
  created_at           timestamptz not null default now(),
  expires_at           timestamptz
);

create index if not exists design_duel_challenges_active_idx
  on public.design_duel_challenges (created_at desc) where status = 'active';

-- ─── Submissions ────────────────────────────────────────────
-- One row per (challenge, user). A row starts in `in_progress`
-- when the designer opens the editor (server records the start
-- time) and is finalised by submit_design().
create table if not exists public.design_duel_submissions (
  id              uuid primary key default gen_random_uuid(),
  challenge_id    uuid not null references public.design_duel_challenges(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  status          text not null default 'in_progress' check (status in ('in_progress', 'submitted')),
  design_json     jsonb not null default '{}'::jsonb,
  preview_image   text check (preview_image is null or char_length(preview_image) <= 2048),
  started_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  completion_time integer check (completion_time is null or completion_time >= 0),
  is_late         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (challenge_id, user_id)
);

create index if not exists design_duel_submissions_challenge_idx
  on public.design_duel_submissions (challenge_id, status);

-- ─── Duels ──────────────────────────────────────────────────
create table if not exists public.design_duels (
  id                   uuid primary key default gen_random_uuid(),
  challenge_id         uuid not null references public.design_duel_challenges(id) on delete cascade,
  submission_a_id      uuid not null references public.design_duel_submissions(id) on delete cascade,
  submission_b_id      uuid not null references public.design_duel_submissions(id) on delete cascade,
  status               text not null default 'open' check (status in ('open', 'resolved')),
  winner_submission_id uuid references public.design_duel_submissions(id) on delete set null,
  ends_at              timestamptz not null,
  created_at           timestamptz not null default now(),
  resolved_at          timestamptz,
  check (submission_a_id <> submission_b_id)
);

-- A submission participates in exactly one duel.
create unique index if not exists design_duels_sub_a_uniq on public.design_duels (submission_a_id);
create unique index if not exists design_duels_sub_b_uniq on public.design_duels (submission_b_id);

create index if not exists design_duels_open_created_idx on public.design_duels (status, created_at desc);
create index if not exists design_duels_challenge_idx on public.design_duels (challenge_id, status);

-- ─── Votes ──────────────────────────────────────────────────
create table if not exists public.design_duel_votes (
  id                     uuid primary key default gen_random_uuid(),
  duel_id                uuid not null references public.design_duels(id) on delete cascade,
  voter_id               uuid not null references public.users(id) on delete cascade,
  selected_submission_id uuid not null references public.design_duel_submissions(id) on delete cascade,
  reason                 text check (reason is null or reason in ('hierarchy', 'clarity', 'visual', 'accessibility', 'interaction')),
  created_at             timestamptz not null default now(),
  unique (duel_id, voter_id)
);

create index if not exists design_duel_votes_duel_idx on public.design_duel_votes (duel_id);
create index if not exists design_duel_votes_selected_idx on public.design_duel_votes (selected_submission_id);

-- ─── Competitive rating ─────────────────────────────────────
create table if not exists public.user_design_ratings (
  user_id       uuid primary key references public.users(id) on delete cascade,
  rating        integer not null default 1500,
  wins          integer not null default 0,
  losses        integer not null default 0,
  draws         integer not null default 0,
  duels_played  integer not null default 0,
  win_streak    integer not null default 0,
  best_streak   integer not null default 0,
  last_duel_at  timestamptz,
  updated_at    timestamptz not null default now()
);

-- ─── Game stats / XP ────────────────────────────────────────
create table if not exists public.user_game_stats (
  user_id              uuid primary key references public.users(id) on delete cascade,
  xp                   integer not null default 0,
  challenges_completed integer not null default 0,
  duels_played         integer not null default 0,
  votes_cast           integer not null default 0,
  updated_at           timestamptz not null default now()
);

create table if not exists public.game_xp_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  kind          text not null check (kind in ('challenge_complete', 'vote', 'duel_win', 'streak_bonus', 'top_ten_percent')),
  amount        integer not null check (amount > 0),
  challenge_id  uuid references public.design_duel_challenges(id) on delete cascade,
  submission_id uuid references public.design_duel_submissions(id) on delete cascade,
  duel_id       uuid references public.design_duels(id) on delete cascade,
  created_at    timestamptz not null default now()
);

-- ─── Feed result posts (drives the social feed) ─────────────
create table if not exists public.design_duel_feed_posts (
  id         uuid primary key default gen_random_uuid(),
  duel_id    uuid not null unique references public.design_duels(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 160),
  is_public  boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists design_duel_feed_posts_public_created_idx
  on public.design_duel_feed_posts (created_at desc) where is_public = true;

-- ─── RLS ────────────────────────────────────────────────────
-- Locked down: no anon/authenticated policies, mirroring the
-- community_showcase tables. Everything flows through service routes.
alter table public.design_duel_challenges   enable row level security;
alter table public.design_duel_submissions  enable row level security;
alter table public.design_duels             enable row level security;
alter table public.design_duel_votes        enable row level security;
alter table public.user_design_ratings      enable row level security;
alter table public.user_game_stats          enable row level security;
alter table public.game_xp_events           enable row level security;
alter table public.design_duel_feed_posts   enable row level security;

-- Realtime so resolved duels + live votes can stream to clients.
do $$ begin alter publication supabase_realtime add table public.design_duels; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.design_duel_votes; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.design_duel_feed_posts; exception when duplicate_object then null; end $$;

alter table public.design_duels replica identity full;
alter table public.design_duel_votes replica identity full;
alter table public.design_duel_feed_posts replica identity full;

-- ─── Game logic functions ───────────────────────────────────
-- All scoring happens here. The client only ever sends
-- intent (design JSON, a selected submission id); every number
-- (XP, rating, winner, vote counts) is computed server-side.

-- Award XP if the (user, kind, source) pair hasn't been rewarded
-- before. Returns the amount actually awarded (0 on duplicates),
-- so XP can't be farmed by repeated votes/submissions.
create or replace function public.award_game_xp(
  p_user_id uuid,
  p_kind text,
  p_amount integer,
  p_challenge_id uuid default null,
  p_submission_id uuid default null,
  p_duel_id uuid default null
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_awarded integer := 0;
begin
  if not exists (
    select 1 from public.game_xp_events e
    where e.user_id = p_user_id
      and e.kind = p_kind
      and e.submission_id is not distinct from p_submission_id
      and e.duel_id is not distinct from p_duel_id
  ) then
    insert into public.game_xp_events (user_id, kind, amount, challenge_id, submission_id, duel_id)
    values (p_user_id, p_kind, p_amount, p_challenge_id, p_submission_id, p_duel_id);

    insert into public.user_game_stats (user_id, xp)
    values (p_user_id, p_amount)
    on conflict (user_id) do update
      set xp = public.user_game_stats.xp + p_amount, updated_at = now();

    v_awarded := p_amount;
  end if;
  return v_awarded;
end;
$$;

-- Finalise a submission, validate the challenge deadline, award
-- challenge-completion XP, and try to pair the submission into a
-- duel with an earlier eligible opponent.
create or replace function public.submit_design(
  p_submission_id uuid,
  p_design_json jsonb,
  p_preview_image text default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sub public.design_duel_submissions%rowtype;
  v_chal public.design_duel_challenges%rowtype;
  v_completion integer;
  v_late boolean;
  v_duel uuid := null;
  v_candidate uuid;
  v_xp integer;
begin
  if p_design_json is null
     or jsonb_typeof(p_design_json) <> 'object'
     or jsonb_typeof(p_design_json -> 'components') <> 'array' then
    return jsonb_build_object('status', 'invalid_design');
  end if;

  select * into v_sub from public.design_duel_submissions
    where id = p_submission_id
    for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_sub.status = 'submitted' then
    return jsonb_build_object('status', 'already_submitted', 'submission_id', v_sub.id);
  end if;

  select * into v_chal from public.design_duel_challenges
    where id = v_sub.challenge_id;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  v_completion := greatest(extract(epoch from (now() - v_sub.started_at))::integer, 0);
  v_late := v_completion > v_chal.time_limit_seconds;

  update public.design_duel_submissions
    set status          = 'submitted',
        design_json     = p_design_json,
        preview_image   = coalesce(p_preview_image, preview_image),
        submitted_at    = now(),
        completion_time = v_completion,
        is_late         = v_late,
        updated_at      = now()
    where id = v_sub.id;

  insert into public.user_game_stats (user_id) values (v_sub.user_id)
    on conflict (user_id) do nothing;

  v_xp := public.award_game_xp(v_sub.user_id, 'challenge_complete', 20, v_sub.challenge_id, v_sub.id, null);
  update public.user_game_stats
    set challenges_completed = challenges_completed + 1, updated_at = now()
    where user_id = v_sub.user_id;

  -- Pair into a duel: earliest eligible submitted opponent for the
  -- same challenge, not already in a duel, from a different designer.
  for v_candidate in
    select s.id
    from public.design_duel_submissions s
    where s.challenge_id = v_sub.challenge_id
      and s.status = 'submitted'
      and s.user_id <> v_sub.user_id
      and (s.preview_image is not null or s.design_json <> '{}'::jsonb)
      and not exists (
        select 1 from public.design_duels d
        where d.submission_a_id = s.id or d.submission_b_id = s.id
      )
    order by s.submitted_at asc
    limit 20
  loop
    begin
      insert into public.design_duels (challenge_id, submission_a_id, submission_b_id, ends_at)
      values (v_sub.challenge_id, v_sub.id, v_candidate,
              now() + make_interval(mins => coalesce(v_chal.duel_duration_minutes, 60)))
      returning id into v_duel;
      exit;
    exception when unique_violation then
      continue;
    end;
  end loop;

  return jsonb_build_object(
    'status', 'submitted',
    'submission_id', v_sub.id,
    'duel_id', v_duel,
    'is_late', v_late,
    'completion_time', v_completion,
    'xp_awarded', v_xp
  );
end;
$$;

-- Resolve a duel once it has enough votes (or its window expired
-- with at least one vote). Computes the Elo rating change, awards
-- win / streak XP, and writes the feed result post. Idempotent —
-- returns null when the duel is not ready to resolve.
create or replace function public.resolve_duel(p_duel_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_duel public.design_duels%rowtype;
  v_chal public.design_duel_challenges%rowtype;
  v_a_sub public.design_duel_submissions%rowtype;
  v_b_sub public.design_duel_submissions%rowtype;
  v_a_votes bigint;
  v_b_votes bigint;
  v_total bigint;
  v_winner uuid := null;
  v_winner_user uuid := null;
  v_loser_user uuid := null;
  v_rating_a integer;
  v_rating_b integer;
  v_expected_a numeric;
  v_expected_b numeric;
  v_new_a integer;
  v_new_b integer;
  v_score_a numeric := 0.5;
  v_k constant numeric := 32;
  v_xp_win integer := 0;
  v_xp_streak integer := 0;
begin
  select * into v_duel from public.design_duels where id = p_duel_id for update;
  if not found then return null; end if;

  if v_duel.status = 'resolved' then
    return jsonb_build_object('duel_id', v_duel.id, 'status', 'resolved', 'winner_submission_id', v_duel.winner_submission_id);
  end if;

  select
    count(*) filter (where selected_submission_id = v_duel.submission_a_id),
    count(*) filter (where selected_submission_id = v_duel.submission_b_id)
    into v_a_votes, v_b_votes
  from public.design_duel_votes
  where duel_id = p_duel_id;

  v_total := v_a_votes + v_b_votes;

  select * into v_chal from public.design_duel_challenges where id = v_duel.challenge_id;

  -- Not ready yet.
  if v_total < coalesce(v_chal.min_votes, 5) and now() <= v_duel.ends_at then
    return null;
  end if;

  select * into v_a_sub from public.design_duel_submissions where id = v_duel.submission_a_id;
  select * into v_b_sub from public.design_duel_submissions where id = v_duel.submission_b_id;

  if v_total > 0 and v_a_votes <> v_b_votes then
    v_winner := case when v_a_votes > v_b_votes then v_duel.submission_a_id else v_duel.submission_b_id end;
  end if;

  if v_winner = v_duel.submission_a_id then
    v_winner_user := v_a_sub.user_id; v_loser_user := v_b_sub.user_id;
  elsif v_winner = v_duel.submission_b_id then
    v_winner_user := v_b_sub.user_id; v_loser_user := v_a_sub.user_id;
  end if;

  insert into public.user_design_ratings (user_id) values (v_a_sub.user_id) on conflict (user_id) do nothing;
  insert into public.user_design_ratings (user_id) values (v_b_sub.user_id) on conflict (user_id) do nothing;

  select rating into v_rating_a from public.user_design_ratings where user_id = v_a_sub.user_id;
  select rating into v_rating_b from public.user_design_ratings where user_id = v_b_sub.user_id;

  v_expected_a := 1.0 / (1.0 + power(10.0, (v_rating_b - v_rating_a)::numeric / 400.0));
  v_expected_b := 1.0 - v_expected_a;

  if v_winner = v_duel.submission_a_id then
    v_score_a := 1.0;
  elsif v_winner = v_duel.submission_b_id then
    v_score_a := 0.0;
  else
    v_score_a := 0.5;
  end if;

  v_new_a := greatest(round(v_rating_a + v_k * (v_score_a - v_expected_a))::integer, 100);
  v_new_b := greatest(round(v_rating_b + v_k * ((1.0 - v_score_a) - v_expected_b))::integer, 100);

  update public.user_design_ratings
    set rating = v_new_a,
        wins = wins + case when v_score_a = 1 then 1 else 0 end,
        losses = losses + case when v_score_a = 0 then 1 else 0 end,
        draws = draws + case when v_score_a = 0.5 then 1 else 0 end,
        duels_played = duels_played + 1,
        win_streak = case when v_score_a = 1 then win_streak + 1 else 0 end,
        best_streak = greatest(best_streak, case when v_score_a = 1 then win_streak + 1 else win_streak end),
        last_duel_at = now(),
        updated_at = now()
    where user_id = v_a_sub.user_id;

  update public.user_design_ratings
    set rating = v_new_b,
        wins = wins + case when v_score_a = 0 then 1 else 0 end,
        losses = losses + case when v_score_a = 1 then 1 else 0 end,
        draws = draws + case when v_score_a = 0.5 then 1 else 0 end,
        duels_played = duels_played + 1,
        win_streak = case when v_score_a = 0 then win_streak + 1 else 0 end,
        best_streak = greatest(best_streak, case when v_score_a = 0 then win_streak + 1 else win_streak end),
        last_duel_at = now(),
        updated_at = now()
    where user_id = v_b_sub.user_id;

  insert into public.user_game_stats (user_id) values (v_a_sub.user_id) on conflict (user_id) do nothing;
  insert into public.user_game_stats (user_id) values (v_b_sub.user_id) on conflict (user_id) do nothing;
  update public.user_game_stats
    set duels_played = duels_played + 1, updated_at = now()
    where user_id in (v_a_sub.user_id, v_b_sub.user_id);

  if v_winner_user is not null then
    v_xp_win := public.award_game_xp(v_winner_user, 'duel_win', 50, v_duel.challenge_id, v_winner, v_duel.id);
    if exists (
      select 1 from public.user_design_ratings
      where user_id = v_winner_user and win_streak = 5
    ) then
      v_xp_streak := public.award_game_xp(v_winner_user, 'streak_bonus', 100, v_duel.challenge_id, null, v_duel.id);
    end if;

    insert into public.design_duel_feed_posts (duel_id, user_id, title, is_public)
    values (v_duel.id, v_winner_user, v_chal.title, true)
    on conflict (duel_id) do nothing;
  end if;

  update public.design_duels
    set status = 'resolved', winner_submission_id = v_winner, resolved_at = now()
    where id = v_duel.id;

  return jsonb_build_object(
    'duel_id', v_duel.id,
    'status', 'resolved',
    'winner_submission_id', v_winner,
    'winner_user_id', v_winner_user,
    'a_votes', v_a_votes,
    'b_votes', v_b_votes,
    'vote_count', v_total,
    'new_rating_a', v_new_a,
    'new_rating_b', v_new_b,
    'xp_awarded_win', v_xp_win,
    'xp_awarded_streak', v_xp_streak
  );
end;
$$;

-- Cast a vote for one side of an open duel. Validates ownership,
-- self-voting, duplicate votes, awards vote XP, and resolves the
-- duel when the threshold is met.
create or replace function public.cast_vote(
  p_duel_id uuid,
  p_voter_id uuid,
  p_selected_submission_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_duel public.design_duels%rowtype;
  v_chal public.design_duel_challenges%rowtype;
  v_a_user uuid;
  v_b_user uuid;
  v_a_votes bigint;
  v_b_votes bigint;
  v_total bigint;
  v_resolved boolean := false;
  v_result jsonb := null;
  v_xp integer := 0;
begin
  select * into v_duel from public.design_duels where id = p_duel_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  if v_duel.status <> 'open' then
    return jsonb_build_object('status', 'closed', 'duel_id', v_duel.id);
  end if;

  select user_id into v_a_user from public.design_duel_submissions where id = v_duel.submission_a_id;
  select user_id into v_b_user from public.design_duel_submissions where id = v_duel.submission_b_id;

  if v_a_user = p_voter_id or v_b_user = p_voter_id then
    return jsonb_build_object('status', 'participant');
  end if;

  if p_selected_submission_id not in (v_duel.submission_a_id, v_duel.submission_b_id) then
    return jsonb_build_object('status', 'invalid');
  end if;

  begin
    insert into public.design_duel_votes (duel_id, voter_id, selected_submission_id, reason)
    values (p_duel_id, p_voter_id, p_selected_submission_id,
            case when p_reason in ('hierarchy', 'clarity', 'visual', 'accessibility', 'interaction') then p_reason else null end);
  exception when unique_violation then
    return jsonb_build_object('status', 'already_voted');
  end;

  insert into public.user_game_stats (user_id) values (p_voter_id) on conflict (user_id) do nothing;
  v_xp := public.award_game_xp(p_voter_id, 'vote', 2, null, null, p_duel_id);
  update public.user_game_stats set votes_cast = votes_cast + 1, updated_at = now() where user_id = p_voter_id;

  select
    count(*) filter (where selected_submission_id = v_duel.submission_a_id),
    count(*) filter (where selected_submission_id = v_duel.submission_b_id)
    into v_a_votes, v_b_votes
  from public.design_duel_votes
  where duel_id = p_duel_id;

  v_total := v_a_votes + v_b_votes;
  select * into v_chal from public.design_duel_challenges where id = v_duel.challenge_id;

  if v_total >= coalesce(v_chal.min_votes, 5) or (now() > v_duel.ends_at and v_total > 0) then
    v_result := public.resolve_duel(p_duel_id);
    v_resolved := true;
  end if;

  return jsonb_build_object(
    'status', 'voted',
    'duel_id', v_duel.id,
    'a_votes', v_a_votes,
    'b_votes', v_b_votes,
    'vote_count', v_total,
    'resolved', v_resolved,
    'result', v_result,
    'xp_awarded', v_xp
  );
end;
$$;

-- ─── Leaderboard ────────────────────────────────────────────
-- Returns the top N rated designers for a period, plus the acting
-- user's overall position (even when outside the top N) and the
-- total number of ranked designers.
create or replace function public.get_design_duel_leaderboard(
  p_user_id uuid,
  p_period text default 'weekly',
  p_limit integer default 100
) returns table (item jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  (
  select jsonb_build_object(
    'rank', r.rank,
    'user_id', r.user_id,
    'name', r.name,
    'avatar_url', r.avatar_url,
    'rating', r.rating,
    'wins', r.wins,
    'duels_played', r.duels_played,
    'win_streak', r.win_streak,
    'xp', r.xp,
    'is_me', r.user_id = p_user_id,
    'my_rank_offset', false,
    'total_players', (select count(*)::bigint from public.user_design_ratings rr
      where case when p_period = 'weekly' then rr.last_duel_at is not null and rr.last_duel_at >= now() - interval '7 days' else true end)
  )
  from (
    select
      r.user_id,
      r.rating,
      r.wins,
      r.duels_played,
      r.win_streak,
      coalesce(s.xp, 0) as xp,
      coalesce(u.name, 'Designer') as name,
      dp.avatar_url,
      row_number() over (order by r.rating desc, r.duels_played desc, r.win_streak desc, r.user_id)::bigint as rank,
      case
        when p_period = 'weekly' then r.last_duel_at is not null and r.last_duel_at >= now() - interval '7 days'
        else true
      end as include
    from public.user_design_ratings r
    left join public.user_game_stats s on s.user_id = r.user_id
    left join public.users u on u.id = r.user_id
    left join public.designer_profiles dp on dp.user_id = r.user_id
  ) r
  where r.include
  order by r.rank
  limit least(greatest(p_limit, 1), 500)
  ) union all (
  select jsonb_build_object(
    'rank', q.rank,
    'user_id', p_user_id,
    'name', q.name,
    'avatar_url', q.avatar_url,
    'rating', q.rating,
    'wins', q.wins,
    'duels_played', q.duels_played,
    'win_streak', q.win_streak,
    'xp', q.xp,
    'is_me', true,
    'my_rank_offset', true,
    'total_players', (select count(*)::bigint from public.user_design_ratings rr
      where case when p_period = 'weekly' then rr.last_duel_at is not null and rr.last_duel_at >= now() - interval '7 days' else true end)
  )
  from (
    select
      r.user_id,
      r.rating,
      r.wins,
      r.duels_played,
      r.win_streak,
      coalesce(s.xp, 0) as xp,
      coalesce(u.name, 'Designer') as name,
      dp.avatar_url,
      row_number() over (order by r.rating desc, r.duels_played desc, r.win_streak desc, r.user_id)::bigint as rank
    from public.user_design_ratings r
    left join public.user_game_stats s on s.user_id = r.user_id
    left join public.users u on u.id = r.user_id
    left join public.designer_profiles dp on dp.user_id = r.user_id
  ) q
  where q.user_id = p_user_id
    and q.rank > least(greatest(p_limit, 1), 500)
  );
$$;

revoke all on function public.award_game_xp(uuid, text, integer, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.award_game_xp(uuid, text, integer, uuid, uuid, uuid) to service_role;

revoke all on function public.submit_design(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_design(uuid, jsonb, text) to service_role;

revoke all on function public.resolve_duel(uuid) from public, anon, authenticated;
grant execute on function public.resolve_duel(uuid) to service_role;

revoke all on function public.cast_vote(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cast_vote(uuid, uuid, uuid, text) to service_role;

revoke all on function public.get_design_duel_leaderboard(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.get_design_duel_leaderboard(uuid, text, integer) to service_role;

-- ─── Home feed integration ──────────────────────────────────
-- Add duel result posts as a 5th kind in the home feed union.
create or replace function public.get_home_feed_page(
  p_user_id uuid,
  p_before timestamptz default null,
  p_limit integer default 30
)
returns table (item jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  with duel_info as (
    select
      d.id as duel_id,
      c.title as challenge_title,
      d.winner_submission_id,
      sa.user_id as a_user_id,
      sb.user_id as b_user_id,
      ua.name as a_name,
      ub.name as b_name,
      pa.avatar_url as a_avatar,
      pb.avatar_url as b_avatar,
      sa.preview_image as a_image,
      sb.preview_image as b_image,
      sa.design_json as a_design,
      sb.design_json as b_design,
      (select count(*) from public.design_duel_votes v where v.duel_id = d.id and v.selected_submission_id = d.submission_a_id) as a_votes,
      (select count(*) from public.design_duel_votes v where v.duel_id = d.id and v.selected_submission_id = d.submission_b_id) as b_votes
    from public.design_duels d
    join public.design_duel_challenges c on c.id = d.challenge_id
    join public.design_duel_submissions sa on sa.id = d.submission_a_id
    join public.design_duel_submissions sb on sb.id = d.submission_b_id
    join public.users ua on ua.id = sa.user_id
    join public.users ub on ub.id = sb.user_id
    left join public.designer_profiles pa on pa.user_id = sa.user_id
    left join public.designer_profiles pb on pb.user_id = sb.user_id
    where d.status = 'resolved'
  ),
  candidates as (
    select 'thread'::text as kind, t.id, t.community_id, t.user_id, t.created_at, to_jsonb(t) as payload
    from public.community_threads t
    where t.is_public = true and (p_before is null or t.created_at < p_before)
    union all
    select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
    from public.community_events e
    where e.is_public = true and (p_before is null or e.created_at < p_before)
    union all
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
    from public.community_resources r
    where r.is_public = true and (p_before is null or r.created_at < p_before)
    union all
    select 'showcase', s.id, s.community_id, s.user_id, s.created_at, to_jsonb(s)
    from public.community_showcase_posts s
    where s.is_public = true and (p_before is null or s.created_at < p_before)
    union all
    select 'duel', f.id, null::uuid, f.user_id, f.created_at, to_jsonb(f)
    from public.design_duel_feed_posts f
    where f.is_public = true and (p_before is null or f.created_at < p_before)
  ), page as (
    select * from candidates
    order by created_at desc, id desc
    limit least(greatest(p_limit, 1), 30)
  )
  select
    case when p.kind = 'showcase' then p.payload else (p.payload - 'is_public') end
    || jsonb_build_object(
      '_type', p.kind,
      'duel', case when p.kind = 'duel' then (
        select jsonb_build_object(
          'duel_id', di.duel_id,
          'challenge_title', di.challenge_title,
          'winner', jsonb_build_object(
            'name', case when di.winner_submission_id = di.a_user_id then di.a_name else di.b_name end,
            'avatar_url', case when di.winner_submission_id = di.a_user_id then di.a_avatar else di.b_avatar end,
            'image_url', case when di.winner_submission_id = di.a_user_id then di.a_image else di.b_image end,
            'design_json', case when di.winner_submission_id = di.a_user_id then di.a_design else di.b_design end,
            'percent', case when di.winner_submission_id = di.a_user_id
              then round(di.a_votes * 100.0 / greatest(di.a_votes + di.b_votes, 1))
              else round(di.b_votes * 100.0 / greatest(di.a_votes + di.b_votes, 1)) end
          ),
          'loser', jsonb_build_object(
            'name', case when di.winner_submission_id = di.a_user_id then di.b_name else di.a_name end,
            'avatar_url', case when di.winner_submission_id = di.a_user_id then di.b_avatar else di.a_avatar end,
            'image_url', case when di.winner_submission_id = di.a_user_id then di.b_image else di.a_image end,
            'design_json', case when di.winner_submission_id = di.a_user_id then di.b_design else di.a_design end,
            'percent', case when di.winner_submission_id = di.a_user_id
              then round(di.b_votes * 100.0 / greatest(di.a_votes + di.b_votes, 1))
              else round(di.a_votes * 100.0 / greatest(di.a_votes + di.b_votes, 1)) end
          ),
          'vote_count', di.a_votes + di.b_votes
        )
        from duel_info di
        where di.duel_id = (p.payload ->> 'duel_id')::uuid
      ) else null end,
      'users', case
        when p.kind = 'duel' and (p.payload ->> 'duel_id')::uuid is not null then (
          select jsonb_build_object('name', w.name, 'avatar_url', w.avatar_url)
          from (
            select
              case when di.winner_submission_id = di.a_user_id then di.a_name else di.b_name end as name,
              case when di.winner_submission_id = di.a_user_id then di.a_avatar else di.b_avatar end as avatar_url
            from duel_info di where di.duel_id = (p.payload ->> 'duel_id')::uuid
          ) w limit 1
        )
        when u.id is null then null
        else jsonb_build_object('name', u.name, 'avatar_url', dp.avatar_url)
      end,
      'author', case
        when p.kind = 'showcase' then jsonb_build_object('name', coalesce(u.name, 'Community member'), 'avatar_url', dp.avatar_url)
        else null
      end,
      'community_name', c.name,
      'community_image', c.image_url,
      'comment_count', case p.kind
        when 'thread' then (select count(*) from public.thread_comments x where x.thread_id = p.id)
        when 'resource' then (select count(*) from public.resource_comments x where x.resource_id = p.id)
        when 'event' then (select count(*) from public.event_comments x where x.event_id = p.id)
        when 'showcase' then (select count(*) from public.showcase_comments x where x.post_id = p.id)
        else 0 end,
      'like_count', case
        when p.kind = 'thread' then (select count(*) from public.thread_likes x where x.thread_id = p.id)
        when p.kind = 'event' then (select count(*) from public.event_likes x where x.event_id = p.id)
        when p.kind = 'showcase' then (select count(*) from public.showcase_likes x where x.post_id = p.id)
        else 0 end,
      'user_liked', (p.kind = 'thread' and exists(select 1 from public.thread_likes x where x.thread_id = p.id and x.user_id = p_user_id))
        or (p.kind = 'event' and exists(select 1 from public.event_likes x where x.event_id = p.id and x.user_id = p_user_id))
        or (p.kind = 'showcase' and exists(select 1 from public.showcase_likes x where x.post_id = p.id and x.user_id = p_user_id)),
      'rsvp_count', case when p.kind = 'event' then (select count(*) from public.event_rsvps x where x.event_id = p.id) else 0 end,
      'user_rsvped', p.kind = 'event' and exists(select 1 from public.event_rsvps x where x.event_id = p.id and x.user_id = p_user_id),
      'save_count', case
        when p.kind = 'event' then (select count(*) from public.event_saves x where x.event_id = p.id)
        when p.kind = 'resource' then (select count(*) from public.resource_saves x where x.resource_id = p.id)
        else 0 end,
      'user_saved', case p.kind
        when 'thread' then exists(select 1 from public.thread_saves x where x.thread_id = p.id and x.user_id = p_user_id)
        when 'event' then exists(select 1 from public.event_saves x where x.event_id = p.id and x.user_id = p_user_id)
        when 'resource' then exists(select 1 from public.resource_saves x where x.resource_id = p.id and x.user_id = p_user_id)
        when 'showcase' then exists(select 1 from public.showcase_saves x where x.post_id = p.id and x.user_id = p_user_id)
      end,
      'bookmark_count', case when p.kind = 'resource' then (select count(*) from public.resource_bookmarks x where x.resource_id = p.id) else 0 end,
      'user_bookmarked', p.kind = 'resource' and exists(select 1 from public.resource_bookmarks x where x.resource_id = p.id and x.user_id = p_user_id)
    )
  from page p
  left join public.users u on u.id = p.user_id
  left join public.designer_profiles dp on dp.user_id = p.user_id
  left join public.communities c on c.id = p.community_id
  order by p.created_at desc, p.id desc;
$$;

revoke all on function public.get_home_feed_page(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.get_home_feed_page(uuid, timestamptz, integer) to service_role;