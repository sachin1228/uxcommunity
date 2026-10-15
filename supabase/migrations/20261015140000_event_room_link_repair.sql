-- ============================================================
-- Account deletion with event rooms
--
-- Incident (2026-10-15): an admin "Delete account" on the Users page failed
-- with 23503 —
--   insert or update on table "communities" violates foreign key constraint
--   "communities_event_id_fkey"
--   Key (event_id)=… is not present in table "community_events"
--
-- The account hosted events and owned (or belonged to) the event rooms that
-- linked them. Deleting the account cascades the events away, and the same
-- transaction keeps updating the rooms afterwards — the ownership handover
-- and the membership counter maintenance. PostgreSQL skips the FK check on
-- the FIRST update of a row in a transaction but re-checks on every later
-- one; whether the counter update lands before or after the event cascade's
-- own set-null depends on trigger firing order (oid order), and when it lands
-- after, the room still carries the link and the check aborts the whole
-- delete. Any room that keeps getting updated while its event dies is
-- exposed; fixing it by loosening the constraint cannot work, because the
-- constraint is not the problem — the intermediate state is.
--
-- This migration:
--   1. Drops dangling links left behind by earlier events (rows the FK can
--      no longer produce but could still wedge a delete — see the drift
--      repro in supabase/tests/event_room_link_repair.test.sql).
--   2. Teaches the BEFORE DELETE handover trigger to unlink, up front, EVERY
--      room pointing at an event the departing user hosts — before any
--      cascade has a chance to update those rows. The room keeps its people
--      and its chat; only the link goes, the same state event deletion
--      itself produces (20260925140000_event_delete_keeps_group_chat).
--      Order-independent, and it also covers a room the departing user has
--      no membership in, whatever the constraint's action.
--
-- The repair and the trigger swap run as separate statements; both are
-- idempotent, so re-running the migration is safe.
-- ============================================================

-- ─── 1. Drop links whose event row is already gone ──────────
update public.communities as c
   set event_id = null
 where c.event_id is not null
   and not exists (
     select 1 from public.community_events as e where e.id = c.event_id
   );


-- ─── 2. The handover unlinks hosted-event rooms first ───────
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
  -- Every event this user hosts dies with the account (community_events
  -- cascades from users). Unlink the rooms pointing at them before anything
  -- else: the deletion's cascades go on to update these rooms (membership
  -- counter maintenance, the handover below), and a later update re-checks
  -- the FK against a link whose event row is already gone — aborting the
  -- whole account deletion with 23503. The room keeps its people and its
  -- chat; only the link goes.
  update public.communities as c
     set event_id = null
   where c.event_id in (
           select e.id from public.community_events as e where e.user_id = old.id
         );

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
      -- A genuine drift row (link to an event row already gone) would abort
      -- this handover the moment the row is updated again; drop the stale
      -- link before reassigning.
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
  'Before a user is deleted, unlinks every room pointing at an event they host, then hands each community they own to the longest-standing remaining member — or deletes the community when it would be left with no owner.';
