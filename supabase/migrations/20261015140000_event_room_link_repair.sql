-- ============================================================
-- Event rooms whose event row is gone: repair the dangling link
--
-- Incident (2026-10-15): an admin "Delete account" on the Users page failed
-- with 23503 —
--   insert or update on table "communities" violates foreign key constraint
--   "communities_event_id_fkey"
--   Key (event_id)=… is not present in table "community_events"
--
-- The account owned a room row whose communities.event_id pointed at a
-- community_events row that no longer exists. PostgreSQL's FK check skips the
-- first update of a row in a transaction (the old and new keys compare equal),
-- but every later update of the same row in that transaction re-checks the
-- constraint for real — so account deletion, whose cascade updates each owned
-- room twice (the BEFORE DELETE handover in
-- 20260913150000_community_ownership_on_user_delete, then the membership
-- counter maintenance), aborts mid-flight with 23503. Joining such a room
-- fails the same way.
--
-- The constraint itself (20260924130000 added it `on delete cascade`,
-- 20260925140000 re-created it `on delete set null`) cannot leave this state
-- behind: deleting an event nulls the link. A row can only drift while no
-- enforced constraint was in place — SQL-editor surgery of the event table,
-- or a restore with triggers off. This migration:
--
--   1. Drops every stale link — the same end state event deletion produces
--      today: the room outlives its event, only the link goes.
--   2. Re-asserts the canonical constraint (drop if exists + add), so a
--      NOT VALID or wrong-action leftover converges on the intended,
--      validated `on delete set null`.
--   3. Teaches the handover trigger to drop a stale link itself, so a drifted
--      room can never wedge an account deletion again.
--
-- The repair and the constraint swap run in one anonymous block so they land
-- together; the trigger swap is its own statement.
-- ============================================================

do $$
begin
  update public.communities as c
     set event_id = null
   where c.event_id is not null
     and not exists (
       select 1 from public.community_events as e where e.id = c.event_id
     );

  alter table public.communities
    drop constraint if exists communities_event_id_fkey;

  alter table public.communities
    add constraint communities_event_id_fkey
    foreign key (event_id) references public.community_events (id) on delete set null;
end $$;


-- ─── The handover drops a stale link before reassigning ─────
create or replace function public.handle_owned_communities_on_user_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owned      record;
  next_owner uuid;
begin
  for owned in
    select c.id
      from public.communities as c
     where c.owner_id = old.id
     order by c.created_at asc, c.id asc
  loop
    -- Longest-standing member who is not the departing user — the same rule
    -- the in-app "owner leaves" flow (DELETE /api/communities/[id]/members)
    -- uses, so both paths hand a community over identically.
    select cm.user_id
      into next_owner
      from public.community_members as cm
      join public.users as u on u.id = cm.user_id
     where cm.community_id = owned.id
       and cm.user_id <> old.id
     order by cm.joined_at asc, cm.user_id asc
     limit 1;

    if next_owner is not null then
      -- Account deletion updates each owned room several times in one
      -- transaction (this handover, then the membership counter maintenance)
      -- and any update after the first re-checks a stale event link and
      -- aborts the whole deletion with 23503 (the 2026-10-15 admin delete
      -- incident). Drop the stale link first — the same state event deletion
      -- itself produces.
      update public.communities as c
         set event_id = null
       where c.id = owned.id
         and c.event_id is not null
         and not exists (
           select 1 from public.community_events as e where e.id = c.event_id
         );

      update public.communities
         set owner_id = next_owner
       where id = owned.id;

      update public.community_members
         set role = 'owner'
       where community_id = owned.id
         and user_id = next_owner;
    else
      -- Nobody left to hand it to: drop the community rather than leave it
      -- ownerless and permanently unmanageable. lottie_settings is not
      -- covered by the FK cascade, so delete it first.
      delete from public.lottie_settings
       where scope = 'community'
         and scope_key = owned.id::text;

      delete from public.communities where id = owned.id;
    end if;
  end loop;

  return old;
end;
$$;

comment on function public.handle_owned_communities_on_user_delete() is
  'Before a user is deleted, hands each community they own to the longest-standing remaining member, or deletes the community when it would be left with no owner. Drops a stale event link on a room before reassigning it, so a drifted row cannot abort the deletion.';
