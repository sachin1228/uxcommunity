# fix: close Supabase data exposure and restore type safety

Base `feat/event-join-questions` → head `fix/supabase-exposure-and-type-safety`
(single commit `479b98c6`, 67 files, +3609 / −440).

## Summary

Two changes, both prerequisites for safely shipping the event-join-questions work:

1. **Critical — public data exposure.** Every client-role read path into `public` is closed: permissive RLS policies dropped, `anon`/`authenticated` table grants revoked, RLS enabled where it was missing, retired tables removed from the Realtime publication.
2. **High — type safety and CI.** `tsc --noEmit` goes from **611 errors to 0**, `next build` no longer ignores type errors, and CI blocks on both.

## 1. Critical: Supabase public read exposure

**What was wrong**

- RLS read policies written as `USING (true)` — or with no `qual` at all — on 30 tables. These are not "authenticated only" policies: they allow *every* role the grant reaches, `anon` included, to read every row.
- `anon` and `authenticated` held `SELECT` grants on those tables.
- `thread_poll_votes` had **RLS disabled entirely** while remaining readable — worse than a bad policy, because no policy can restrict a table with RLS off.
- Retired tables were still members of the `supabase_realtime` publication, publishing row changes to anyone holding the publishable key.

**What the migration does** — `supabase/migrations/20260926000000_close_public_read_exposure.sql`

- Drops every permissive `SELECT`/`ALL` policy (`qual IS NULL OR qual = 'true'`) on the affected tables.
- `REVOKE ALL ON TABLE … FROM anon, authenticated` for those tables **and for every other table in `public`**, so a future table cannot silently inherit client reads.
- Enables RLS on `thread_poll_votes`.
- Removes the retired tables from `supabase_realtime`.
- **Leaves `service_role` untouched.** The web app reaches Postgres only through the server-side service-role client, so no application read path depended on the revoked grants.

**Publishable key and dead clients removed**

The tracked publishable anon key is gone from `apps/web/wrangler.toml`, all three profiles in `expo-app-standalone 3/eas.json`, both READMEs and both env examples. The key itself was never the leak (that was RLS + grants), but the only client using it was dead code: `apps/web/lib/supabase/{browser,client,server}.ts` and `expo-app-standalone 3/lib/supabase.ts` are deleted, along with the `@supabase/ssr` (web) and `@supabase/supabase-js` (mobile) dependencies and the `EXPO_PUBLIC_SUPABASE_*` mobile variables. No JWT remains in the files this PR touches; the only tracked JWT left in the repo is the pre-existing k6 fixture listed under Remaining issues.

**Regression test** — `supabase/tests/public_read_exposure.test.sql` (pgTAP, 7 assertions, wrapped in a transaction): no client-role grants anywhere in `public`, RLS enabled on every table, no permissive read policies, empty Realtime publication, `service_role` can still read, and `anon` gets `42501` on `community_messages`, `community_members` and `notifications`. Run with `npm run test:security`.

## 2. High: type safety

**Root cause.** `lib/supabase/service.ts` built its client from `ReturnType<typeof createClient>` with no `Database` generic. Without it the client's `Schema` resolves to `never`, so every `.from(…)` query type-checked as `never` — the app had no type checking on database access at all. That is what 611 errors and a permanently-true `ignoreBuildErrors` were hiding.

**Fix.** `apps/web/lib/supabase/database.types.ts` (generated from the real schema, checked in with a regeneration header) plus `createClient<Database>` in `lib/supabase/service.ts`, exporting `ServiceClient = SupabaseClient<Database>`. 611 → 0 errors; `ignoreBuildErrors` is now `false`.

No blanket suppressions were added. Real bugs the types exposed and this PR fixes: `poll-votes` treated `option_index` as non-nullable; `POST /api/communities/[id]/join` accepted a request with no `event_id`; admin/moderation routes typed their update payloads loosely; `moderation/image.ts` passed a `Buffer` where `Uint8Array` was required; showcase and thread attachment interfaces had to become type aliases to satisfy `Json`. Three `as unknown as` casts remain, each with an in-code comment explaining why.

**Schema drift migration** — `20260926010000_schema_drift_missing_columns.sql` adds columns that existed only in the dashboard (`experience_levels.is_active`, `experience_levels.updated_at`; `designer_profiles.bio`, `linkedin_url`, `portfolio_url`) so the generated types match the real database. All guarded with `IF NOT EXISTS`.

## 3. CI

- **New `.github/workflows/ci.yml`**: `TypeScript` (blocking), `Unit tests` (blocking), `ESLint` (advisory, `continue-on-error: true` — the 43 pre-existing errors from `eslint-plugin-react-hooks` v6 are documented in the job comment).
- `deploy.yml` / `preview.yml`: added a blocking `Type check` step, removed `continue-on-error` from unit tests, dropped the `NEXT_PUBLIC_SUPABASE_ANON_KEY` guard.
- `apps/web/eslint.config.mjs` ignores generated output (`.next`, `.open-next`, `dist`) — 34 of the 77 reported errors were build artifacts.

## Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` (apps/web) | **611 → 0**, exit 0 |
| Unit tests | 51 files, **439 tests, 0 failures** (2.5 s) |
| `npx next build` | exit 0 with `ignoreBuildErrors: false` |
| `npx eslint .` | 77 errors / 40 warnings, of which 34 errors and all warnings are generated output → 43 pre-existing source errors (advisory gate) |
| `npm run test:security` | authored; see caveat below |

Security verification was performed on a **local Postgres 15 replay** of `supabase/schema.sql` plus every migration (stubbed `auth.uid()`, roles and `storage.buckets`), with real rows seeded, because there is no Supabase CLI link to the hosted project from this branch. After the migration:

```
[anon]          select count(*) from community_messages  ->  ERROR: permission denied for table community_messages (42501)
[service_role]  select count(*) from community_messages  ->  1
client SELECT grants in public                = 0
public tables without RLS                     = 0
supabase_realtime publication entries         = 0
USING (true) read policies for client roles   = 0
```

Before the migration the same harness read the private rows as `anon`, which is how the exposure was reproduced. `supabase test db` (pgTAP) could not be executed against the hosted project — the new test's assertions were run directly against the replay database instead, and CI will pick it up once a project link exists.

## Remaining issues (deliberately not in this PR)

- `k6/data/test-users.json` commits 500 load-test accounts with email, **password** and `sessionToken` (added in #155). The tokens are minted locally by the seeder from `SESSION_SECRET`, so they are not portable session tokens, but the passwords are real for whichever project the seeder ran against — rotate those accounts and have the seeder write the fixture to a gitignored path.
- 43 pre-existing ESLint errors (react-hooks v6). Flip the lint job to blocking after the cleanup, and pin `eslint-config-next` instead of `latest`.
- `companies` exists only in the dashboard; nothing in `supabase/migrations` creates it, so a fresh environment cannot reproduce production.
- `supabase/migrations/20260718_add_image_url_to_master_data.sql` has invalid PL/pgSQL quoting (`do $ begin … end $;`).
- `supabase/migrations/20260814030000_community_list_aggregate_rpcs.sql` references `company_id` before the column exists.
- Regenerating `database.types.ts` needs CLI/project access; the file is committed so day-to-day work is unaffected.
- `expo-app-standalone 3/.env` (untracked, local only) still contains the old key on disk.

## Out of scope

Realtime scaling, push scaling, sidebar performance, observability, caching architecture, authz refactor, oversized components, design-system duplication, migration automation, cost optimization.
