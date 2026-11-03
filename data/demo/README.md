# Product video demo

Run `npm run seed:demo` from the repository root after `npm run env:setup` and `npm run env:seed`. If the local stack and reference catalogs already exist, run only `npm run seed:demo`. Refresh the running local app afterwards.

This explicit command seeds only the verified development Supabase stack belonging to this checkout. It does not run in setup, migrations, CI, staging, or deployment. It preserves existing rows and uses deterministic identifiers with conflict-ignore inserts, so repeating it fills missing records without duplicating the dataset. Interrupted runs can be repeated. Existing seeded content is not refreshed or overwritten; timestamps are relative to the first successful insertion.

The database fixture bypass is scoped to each insert transaction to accommodate member join and posting budgets. Foreign keys, validation, membership counters, and other triggers stay enabled; normal application limits are unchanged. Each batch commits separately.

## Included

- 100 fictional members with profiles, stock portraits, varied cities and design roles
- 10 fictional studios and 30 general vacancies plus 8 matching vacancies per existing local profile with salaries, skills, responsibilities, and requirements
- 12 communities: 9 public and 3 private, with rules and connected membership
- 120 discussion posts, including 12 polls, and 48 visual showcases
- 24 real external design resources, including tutorial videos
- One native video attachment: the Big Buck Bunny trailer, credited to Blender Foundation under CC BY 3.0
- 12 upcoming events with attendees, comments, and covers
- 360 chat messages, 420 thread comments, likes, poll votes, and showcase comments
- Saved content, 8 curated library resources, direct conversations, job applications, and job notifications

Matching vacancies use each existing account’s actual role and experience level, with matching or unrestricted city and sector criteria. Each profile receives six hiring and two referral roles; the seed checks their `can_apply` status through `get_job_feed`. Motion and 3D roles include relevant responsibilities and skills.

Existing unblocked local accounts are joined to all 12 rooms and receive saved items, a conversation, and job notifications. Normal privacy boundaries still apply to other accounts. Demo jobs and people are fictional; external learning resources and media are real. No emails or push messages are sent by this script.

## Recording

Use your current local account, or sign in as `designer.1@demo.invalid` using `DEV_USER_PASSWORD` from `.local/development/environment.json`. The script never prints the password. `.local/development/demo-summary.json` stores the generated counts and source links.

Suggested tour: Feed → a photo showcase → poll and replies → private Portfolio Review Circle → chat → Events → Resources → Library → Jobs → Saved → direct messages.

Photos are remote Unsplash references credited in showcase captions. Studio marks use DiceBear shapes; fictional members use stock Pravatar portraits. The native animation reference includes creator and license attribution in its post. External media requires internet access; check playback and allow images to load before recording. See `editorial.json` for the resource/source manifest and original editorial copy. No third-party articles or job listings are copied into the dataset.

The seed verifies the persisted IDs and exact counts for users, communities, posts, showcases, jobs, resources, and events before reporting success. The full script was executed twice locally to exercise conflict handling.

## Temporary staging test

Use the manual **Temporary staging demo data** Actions workflow, with action `seed` and a unique run ID such as `staging-video-20261103`. It reuses the staging environment's existing secrets and verifies the live application/database identity before any write. This does not deploy the website. All inserts commit in one transaction. Existing staging accounts are not modified; use `designer.1.<run-id>@demo.invalid` with staging's `DEV_USER_PASSWORD`, or join a public demo community from an existing account. Private demo rooms are accessible to their demo members.

Keep the seed Actions run URL. After testing, dispatch the same workflow with action `cleanup`, the same dataset ID, and the numeric seed Actions run ID. It restores that run's exact cleanup inventory from an artifact and verifies the staging project again. The artifact is retained for 90 days; download and retain it if testing lasts longer. Cleanup is manual, so data stays available until testing is finished. Cleanup removes seeded rows and cascading activity inside those demo-owned records, including interactions you add while testing. It does not delete unrelated staging accounts or content. Media uses external URLs, so this run creates no R2 objects to remove.

Local equivalent (requires the staging settings and operator token):

```
node --import tsx scripts/environments/demo-staging.mjs seed --run staging-video-20261103
node --import tsx scripts/environments/demo-staging.mjs cleanup --run staging-video-20261103
```

The staging lifecycle has guard/unit checks, but has not been executed against staging yet. A dataset makes network and database latency more representative for manual testing. It does not simulate concurrent traffic; images and video are hosted externally, so their timing is not an R2 upload/delivery benchmark.
