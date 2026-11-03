# Product video demo

Run `npm run seed:demo` from the repository root after `npm run env:setup` and `npm run env:seed`. If the local stack and reference catalogs already exist, run only `npm run seed:demo`. Refresh the running local app afterwards.

This explicit command seeds only the verified development Supabase stack belonging to this checkout. It does not run in setup, migrations, CI, staging, or deployment. It preserves existing rows and uses deterministic identifiers with conflict-ignore inserts, so repeating it fills missing records without duplicating the dataset. Interrupted runs can be repeated. Existing seeded content is not refreshed or overwritten; timestamps are relative to the first successful insertion.

The database fixture bypass is scoped to each insert transaction to accommodate member join and posting budgets. Foreign keys, validation, membership counters, and other triggers stay enabled; normal application limits are unchanged. Each batch commits separately.

## Included

- 100 fictional members with profiles, stock portraits, varied cities and design roles
- 10 fictional studios and 30 realistic vacancies with salaries, skills, responsibilities, and requirements
- 12 communities: 9 public and 3 private, with rules and connected membership
- 120 discussion posts, including 12 polls, and 48 visual showcases
- 24 real external design resources, including tutorial videos
- One native video attachment: the Big Buck Bunny trailer, credited to Blender Foundation under CC BY 3.0
- 12 upcoming events with attendees, comments, and covers
- 360 chat messages, 420 thread comments, likes, poll votes, and showcase comments
- Saved content, 8 curated library resources, direct conversations, job applications, and job notifications

Existing unblocked local accounts are joined to all 12 rooms and receive saved items, a conversation, and job notifications. Normal privacy boundaries still apply to other accounts. Demo jobs and people are fictional; external learning resources and media are real. No emails or push messages are sent by this script.

## Recording

Use your current local account, or sign in as `designer.1@demo.invalid` using `DEV_USER_PASSWORD` from `.local/development/environment.json`. The script never prints the password. `.local/development/demo-summary.json` stores the generated counts and source links.

Suggested tour: Feed → a photo showcase → poll and replies → private Portfolio Review Circle → chat → Events → Resources → Library → Jobs → Saved → direct messages.

Photos are remote Unsplash references credited in showcase captions. Studio marks use DiceBear shapes; fictional members use stock Pravatar portraits. The native animation reference includes creator and license attribution in its post. External media requires internet access; check playback and allow images to load before recording. See `editorial.json` for the resource/source manifest and original editorial copy. No third-party articles or job listings are copied into the dataset.

The seed verifies the persisted IDs and exact counts for users, communities, posts, showcases, jobs, resources, and events before reporting success. The full script was executed twice locally to exercise conflict handling.
