# What deleting a user actually leaves behind

Audit of `DELETE /api/admin/users/[id]` — what it removes, what the database
cascades, what survives by design, and what is left stranded in R2.

Scope: `public.users` and everything that references it, plus the R2 bucket
written by `apps/web/lib/r2.ts`. Written alongside
`20260913150000_community_ownership_on_user_delete.sql`.

## The deletion path today

`apps/web/app/api/admin/users/[id]/route.ts` explicitly deletes four things:

| Step | What | Why here rather than a FK |
| --- | --- | --- |
| 1 | `designer_profiles` row | no cascade — profiles are deleted by hand |
| 2 | `users` row | the root; everything else keys off it |
| 3 | `applications` row(s) | frees the email to reapply |
| 4 | `designer_profiles.avatar_url` object in R2 | the bucket is not part of the DB |

Everything else is the database's job, via foreign keys on
`<table>.<col> references users (id)`.

## Cascades away (correctly removed with the account)

These FK rows are `on delete cascade`, so deleting the `users` row removes them:

- Communities: `community_members`, `community_messages`, `community_join_requests`
- Chat/threads: `community_threads`, `thread_comments`, `thread_likes`,
  `thread_poll_votes`, `thread_comment_reactions`, and the persisted
  thread-interaction tables
- Events: `community_events`, event RSVPs, `event_saves`, event likes,
  `event_comments`, `event_comment_reactions`
- Showcase: posts, comments, `showcase_comment_reactions`
- Resources: `community_resources`, `resource_saves`, `resource_comments`,
  `resource_comment_reactions`, `resource_bookmarks`
- Account: `password_resets`, `user_interests`, `notifications` (`user_id`),
  `community_admin_permissions`

## Survives on purpose (attribution, audit trail)

These columns are `on delete set null` so history is not silently rewritten:

| Column | Effect |
| --- | --- |
| `communities.owner_id` | **was the bug** — see below |
| `notifications.actor_id` | notification survives its actor |
| `community_join_requests.decided_by` | who approved/declined is lost, the request is not |
| `community_admin_permissions.granted_by` | grant survives, granter does not |
| `community_admin_activity.actor_id`, `target_user_id` | audit trail survives via the snapshotted `actor_name` |
| `signup_attempts.user_id` | attempt record survives for support tracing |

## The orphan bug (fixed by this change)

`communities.owner_id` was `references users(id) on delete set null`. Deleting a
member therefore **kept every community they had created**, with `owner_id = NULL`
and `is_active = true`. Because `get_all_communities` returns any active
community that still has at least one `community_members` row, those communities
kept appearing in Explore → "Member-led" — owned by nobody, managed by nobody,
and impossible to distinguish from a platform community in the admin UI, which
classified them by `owner_id == null`.

Two things now prevent it:

1. A `before delete` trigger on `users` hands each owned community to the
   longest-standing remaining member, or deletes the community when nobody is
   left. It runs for **every** deletion path, not just the admin API.
2. The Explore and sidebar queries refuse to list a `type = 'user'` community
   with no owner, and a `not valid` check constraint stops new ones existing.

Already-orphaned member-led communities are deleted outright by the migration
(with their content), since a community with no owner has no way to be managed.

## R2 residue

The bucket has no foreign keys, so nothing in the database can reclaim objects.
Two mechanisms cover it:

- **Eager cleanup** on paths that know what they are removing — community
  delete, owner-leave, member removal, avatar/profile change, and now the admin
  user delete (it deletes the media of each owned community it is about to
  destroy, plus the avatar).
- **The orphan audit** (`Tools → R2 storage health`, `/api/admin/r2-audit`)
  lists objects no column references and deletes them after a 7-day grace
  period. Anything the eager paths miss lands here.

### Objects stranded by a user deletion

Once the account's rows cascade, these objects have no referencing row left and
become the audit's responsibility:

| Object | Key prefix | Row that owned it |
| --- | --- | --- |
| Avatar | `avatars/…`, `signup/…` | `designer_profiles.avatar_url` — deleted eagerly |
| Community display picture | `communities/{userId}/…` | `communities.image_url` — eagerly only for owned communities that get deleted |
| Chat message images | `communities/{userId}/…` | `community_messages.image_url` |
| Thread attachments + video posters | `communities/{userId}/…` | `community_threads.attachments` |
| Showcase images/videos/posters | `communities/{userId}/…` | `community_showcase_posts.image_url` / `.attachments` |
| Event covers | `communities/{userId}/…` | `community_events.cover_image_url` |
| Event comment images | `communities/{userId}/…` | `event_comments.image_url` |

### Audit gap fixed here

`event_comments.image_url` was **missing from `ALL_MEDIA_LOOKUPS`** in
`packages/shared/src/r2-media.ts`. Two consequences, both live:

1. Event comment images were **invisible to the reference check**, so the
   orphan audit classified every one of them as an orphan and would delete them
   after the grace period — breaking images still displayed on live comments.
2. Deleting an event comment left its object behind forever; the delete route
   removed the row only.

Both are fixed: the column is now tracked, and
`DELETE /api/communities/[id]/events/[eventId]/comments/[commentId]` reclaims
the object when the row is gone.

## Cleanup plan

1. **Apply the migration** — purges existing ownerless member-led communities
   and installs the trigger, constraint and Explore filter.
2. **Run the orphan audit** (`Tools → R2 storage health → Scan`) after the
   migration. The communities the migration deletes leave their pictures, chat
   images, thread attachments, showcase media and event covers unreferenced in
   the bucket. Review the `orphans` list, then `Delete orphans`.
   - Do this *after* deploying the `event_comments` fix, so the audit's
     reference list is correct and live comment images are protected.
   - Objects younger than the grace window are skipped by default; re-run the
     scan a week later, or pass `force: true`, to clear the rest.
3. **Verify no member-led community is ownerless** (should return zero rows):

   ```sql
   select id, name, created_at
   from public.communities
   where type = 'user' and owner_id is null;
   ```

4. **Confirm the audit is clean** — after step 2 a fresh scan should report
   `potentialOrphans: 0` and `brokenReferences: 0`. A non-zero
   `brokenReferences` means a table holds a URL whose object is gone.
