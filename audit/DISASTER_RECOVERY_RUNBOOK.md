# Disaster Recovery Runbook

Date: 2026-10-30
Companion documents: [`BACKUP_DISASTER_RECOVERY_AUDIT.md`](./BACKUP_DISASTER_RECOVERY_AUDIT.md) (what exists and what does not), [`BACKUP_IMPLEMENTATION.md`](./BACKUP_IMPLEMENTATION.md) (how the automation is built and configured).

> **In an incident, read §1 and §2 first.** They tell you what to do in the first five minutes and the order in which components must come back. Every scenario below then stands alone.

---

## 1. First five minutes

1. **Stop writing.** If data is still being destroyed (a bad migration, a runaway delete), take the application out of service before investigating:
   ```bash
   cd apps/web && npx wrangler deployments list   # identify the live version
   ```
   Then either revert the offending deploy (§7) or, for a database-level incident, disable the API by rolling back to a version that does not run the destructive path. **Do not** "try a fix" against production before taking a snapshot — take the snapshot first (§10).
2. **Take a safety copy of whatever is left**, even if it looks broken:
   ```bash
   node scripts/backup/backup-postgres.mjs --out-dir ./incident-snapshot
   ```
   This is local, needs no bucket, and encrypts to `BACKUP_AGE_RECIPIENT`. It takes seconds and prevents making the incident worse.
3. **Identify the newest good backup** — do not assume the newest one is good:
   ```bash
   node scripts/backup/verify-backup.mjs --latest --download
   ```
4. **Write down the timeline** (what happened, when, what you ran). It is required for the post-incident review and it is the thing people forget.

## 2. Recovery ordering

Components depend on each other in a fixed order. Restoring out of order produces a "working" system that silently points at missing data.

```
1. Accounts & credentials   (Cloudflare, Supabase, GitHub)
        ↓
2. Secrets                  (escrow → GitHub Actions secrets → Worker secrets)
        ↓
3. PostgreSQL               (data first: nothing else is useful without it)
        ↓
4. R2 buckets & objects     (the database stores URLs; files must exist at those keys)
        ↓
5. Worker configuration     (wrangler.toml vars point at the restored project/domain)
        ↓
6. Deploy web, then realtime
        ↓
7. Durable Objects          (recreate themselves; no restore step)
        ↓
8. DNS / custom domains     (last: only once the thing behind them answers)
```

**Why PostgreSQL before R2:** a restored database that references missing objects renders broken images and unreadable résumés everywhere. Restoring files first would leave them unreferenced and tempting to prune.

**Why Durable Objects need no step:** they hold only caches (§6).

**Why DNS last:** pointing `app.uxcommunity.in` at a Worker that has no database turns a partial outage into a confusing one.

## 3. Scenario 1 — complete PostgreSQL database loss

*Examples: the Supabase project was deleted, the database is corrupted, or the region is unavailable.*

**Detection**
- Every API route returns 5xx; `psql "$SUPABASE_DB_URL" -c 'select 1'` fails.
- Supabase dashboard shows the project paused/deleted, or the database will not start.
- Distinguish from an application bug: if `/api/health` reports Supabase down but R2 up, this is the database.

**Immediate containment**
1. Do not recreate the project over the same ref — Supabase deletes the project's backups with it. If the project still exists but is broken, **stop and open a Supabase support ticket before deleting anything.**
2. If the project is already gone, create a new project in `ap-southeast-2` and note its new ref, database password and pooler URL.

**Recovery source**
- Primary: the newest verified encrypted dump in `s3://$BACKUP_R2_BUCKET/db/…`.
- Secondary: Supabase's own daily backup (Pro+ only, unverified — see audit §2.4).

**Recovery steps**
```bash
# 0. Prerequisites: PostgreSQL 17 client, age, and the offline age identity.
export AGE_IDENTITY=~/uxc-backup-key.txt
export SUPABASE_DB_URL='postgresql://postgres.<new-ref>:<password>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres'
export BACKUP_R2_BUCKET=… BACKUP_R2_ACCOUNT_ID=… BACKUP_R2_ACCESS_KEY_ID=… BACKUP_R2_SECRET_ACCESS_KEY=…

# 1. Confirm the backup is intact BEFORE touching the target.
node scripts/backup/verify-backup.mjs --latest --download

# 2. Restore. The script verifies both checksums, recreates the extensions the
#    dump needs, and refuses a target equal to SUPABASE_DB_URL unless
#    --allow-production is passed.
node scripts/backup/restore-postgres.mjs --latest --target-url "$SUPABASE_DB_URL" --identity "$AGE_IDENTITY"

# 3. If the dump predates the newest migrations, apply what is missing.
#    (A dump already contains all migrations that existed when it was taken.)
```

**Data consistency checks** (the restore script runs the first two)
- Row counts match the manifest for `users`, `communities`, `community_members`, `community_messages`, `dm_conversations`, `dm_messages`, `job_posts`, `job_applications`. A mismatch fails the restore; investigate before continuing.
- `invalid indexes = 0`, `unvalidated foreign keys = 0`, `public tables > 0`.
- Manual spot check:
  ```sql
  select count(*) from public.users;
  select count(*) from public.community_messages;
  select count(*) from public.community_messages m
    left join public.communities c on c.id = m.community_id where c.id is null;  -- must be 0
  ```

**Validation after restoration**
1. **Revoke every session that predates the restore.** A restore resurrects `auth_sessions` rows for sessions revoked after the dump was taken:
   ```sql
   delete from public.auth_sessions;
   ```
   Everybody signs in again. This is intentional.
2. Point the app at the new project: update `NEXT_PUBLIC_SUPABASE_URL` in `apps/web/wrangler.toml`, set the `SUPABASE_SERVICE_ROLE_KEY` GitHub secret to the new project's service-role key, and redeploy (§7).
3. Sign in on the web app, open a community, send a message, confirm it appears in the mobile app.

**Rollback**
- Restoring is itself destructive (`pg_restore --clean` drops and recreates objects). If the restored data is wrong, restore an **older** dump into the same target — the previous attempt is not preserved.
- If you restored into a *new* project and it is wrong, abandon it and create another; the old project ref (if it still exists) is untouched.

**Target RTO:** 1–2 hours. **Measured locally:** restore of the full 76-table schema took **287–935 ms**; the time is dominated by provisioning and verification, not by the data.

## 4. Scenario 2 — accidental deletion of records

*Examples: a moderator deleted a community, a `users` row was removed, a bulk update blanked a column.*

**Detection**
- User report, or an audit row (`moderation_logs`, `moderation_audit_log`) that does not match the data.
- Deletions cascade: deleting a `users` row removes memberships, messages, DMs and applications through `on delete cascade`.

**Immediate containment**
- Stop the source of the deletion (disable the admin tool path, roll back the deploy that introduced it).
- Snapshot immediately (§1.2) so later writes do not push the deleted rows further out of reach.

**Recovery source**
- The newest dump that **predates** the deletion. Check `createdAt` in the manifest; if the deletion is newer than the newest dump, use the next older one.
- Supabase PITR if it is enabled (unverified) — restore to a point just before the delete, into a new project.

**Recovery steps** — never restore an old dump over production for a single row
```bash
# 1. Restore the chosen dump into a scratch database.
createdb uxc_recovery
node scripts/backup/restore-postgres.mjs \
  --object "db/2026/10/29/uxcommunity-20261029T023000Z.dump.age" \
  --target-url "postgresql://postgres@127.0.0.1:5432/uxc_recovery" \
  --identity "$AGE_IDENTITY"

# 2. Extract only the rows you need, as CSV.
psql "postgresql://postgres@127.0.0.1:5432/uxc_recovery" \
  -c "\copy (select * from public.communities) to 'communities.csv' csv header"
```

Then merge them on production through a staging table, so a row that still
exists is not duplicated and any constraint violation is caught before it
touches a real table:

```sql
-- psql against production.
create temp table incoming_communities (like public.communities including all);
\copy incoming_communities from 'communities.csv' csv header

insert into public.communities
select * from incoming_communities
on conflict (id) do nothing;
```

The same pattern applies to every table, restoring parents before children so
foreign keys resolve.

**Data consistency checks**
- `select count(*)` for the affected table before/after.
- Cascade completeness: a restored community must have its `community_members`, `community_messages`, `community_threads`, `community_events` — restore children in FK order (parent first).
- Re-run the orphan check from §3.

**Validation**
- The affected user can see their data again.
- No duplicate rows: `select id, count(*) from public.communities group by id having count(*) > 1;` returns nothing (the PK makes this impossible, which is the point of `on conflict do nothing`).

**Rollback**
- The restore only inserts; to undo, delete exactly the ids you inserted (keep the id list).

**Target RTO:** 30–60 minutes.

## 5. Scenario 3 — R2 object deletion

*Examples: a user deleted their avatar, a cleanup job removed the wrong prefix, a résumé was deleted with its application.*

**Detection**
- Broken images/videos; 404 from the media host.
- R2 Data Access Logs (if enabled) show the `DeleteObject` call. **They are not enabled today** — enabling them is recommended in `BACKUP_IMPLEMENTATION.md` §9.

**Immediate containment**
- Disable the code path that deleted the object, and disable any scheduled cleanup (the chat retention sweep runs every 6 hours).
- **Do not empty or reconfigure the bucket.**

**Recovery source**
- The nightly mirror at `s3://$BACKUP_R2_BUCKET/r2/<bucket>/<key>`.
- **Limit:** an object deleted *before* the first successful mirror run is unrecoverable. R2 has no versioning and no undelete (audit §3.2).

**Recovery steps**
```bash
# 1. Is it in the backup?
node scripts/backup/restore-r2.mjs --bucket uxcommunity-private --list | grep "resumes/<user>/"

# 2. Restore one object.
node scripts/backup/restore-r2.mjs --bucket uxcommunity-private --key "resumes/<user>/<file>.pdf"

# 3. Or a prefix (for example one conversation's DM images).
node scripts/backup/restore-r2.mjs --bucket uxcommunity-private --prefix "dm/<conversation-id>/"
```
The script refuses to overwrite an existing object unless `--overwrite` is passed, copies server-side (no download), and verifies the object's size after the copy.

**Data consistency checks**
- The restored key matches the URL stored in the database (`r2KeyFromUrl` in `apps/web/lib/r2.ts` is the same parser used everywhere).
- For private files, the database row still points at the key; no row update is needed.

**Validation**
- Load the URL in a signed-in browser. **Private objects must still require the app's signed-URL path** — never make the object public to "fix" it.
- For a public object served through the CDN custom domain, purge the URL:
  ```bash
  # Cloudflare dashboard → Caching → Purge by URL
  ```
  Uploads are `Cache-Control: immutable`, so a previously cached copy can outlive the origin delete.

**Rollback**
- Restoring an object is additive. To undo, delete the key again (which is irreversible — be sure).

**Target RTO:** under 30 minutes for a known object.

## 6. Scenario 4 — private R2 bucket failure

*Examples: the `uxcommunity-private` bucket was deleted, its credentials were revoked, or R2 is unavailable in the region.*

**Detection**
- Every résumé/verification/DM image request 5xx or 403; `HeadBucket` fails.
- The dependency monitor emails admins (R2 is an alerting dependency).

**Immediate containment**
- Do not create a new bucket with the same name until you have checked whether Cloudflare support can restore the original. Creating it first forecloses that option.

**Recovery source**
- Full mirror under `r2/uxcommunity-private/`. Measured size at audit time: **2 objects, 1.28 MiB** — a complete restore is seconds.

**Recovery steps**
```bash
# 1. Create the bucket (same name, private, no public access).
#    Dashboard → R2 → Create bucket → uxcommunity-private

# 2. Restore everything.
node scripts/backup/restore-r2.mjs --bucket uxcommunity-private --all

# 3. Restore the CORS configuration (private bucket intentionally has none).
```

**Data consistency checks**
- `restore-r2.mjs` verifies size per object and reports any failure; a non-zero exit means at least one object did not copy.
- Count objects in the backup and in the restored bucket; they must match.
- Every `member_resumes.url`, `account_verification_requests.work_sample_urls[]` and `dm_messages.image_url` must resolve through the app.

**Validation**
- Request a résumé as its owner and as the job poster: both must work.
- Request it as an unrelated member: must be refused.
- Confirm the bucket is **not** public (no custom domain, no `r2.dev` access).

**Rollback**
- A restored bucket is additive; there is nothing to roll back beyond deleting the bucket again, which you never want to do during an incident.

## 7. Scenario 5 — Cloudflare Worker deployment failure

*Examples: a deploy broke the app, a Worker was deleted, secrets were blanked by a bad `wrangler secret bulk`.*

**Detection**
- `wrangler deployments list` shows a new version at the same time errors started.
- Errors are 500/502 on every route rather than on one feature.

**Immediate containment**
- **Roll back first, diagnose second.**

**Recovery steps**
```bash
cd apps/web
npx wrangler deployments list
npx wrangler rollback            # or: npx wrangler rollback <version-id>

# Realtime worker (no versioned rollback UI): redeploy the last good commit.
git log --oneline -5
git checkout <last-good-commit> -- apps/realtime
cd apps/realtime && npx wrangler deploy
```

If the Worker is gone entirely:
```bash
cd apps/web && npm run deploy                  # rebuild + deploy
cd apps/realtime && npx wrangler deploy
```

If secrets were blanked, the deploy workflow repopulates them from GitHub secrets (`.github/workflows/deploy.yml`, "Set web worker secrets"). Re-run the workflow rather than hand-setting them.

**Data consistency checks**
- `curl -s https://app.uxcommunity.in/api/health | jq` — every dependency should be healthy.
- Sign in, load the feed, send one message.
- `wrangler deployments list` shows the intended version as current.

**Validation**
- Realtime: open two browsers, confirm a message sent in one arrives in the other.
- Push: confirm the notification cron still runs (`wrangler tail` on the realtime worker).

**Rollback**
- Rolling back is the rollback. Note that a Worker rollback does **not** roll back database migrations — see §8.

## 8. Scenario 6 — Durable Object data or availability failure

*Examples: a DO namespace is corrupted, a class cannot be instantiated, alarms stop firing.*

**Detection**
- Realtime sockets fail to connect; presence counts are wrong; community chat stops fanning out.
- `wrangler tail` shows exceptions from `Room`/`UserDO`.

**Immediate containment**
- Restart the object by redeploying the realtime worker (this evicts instances).
- If a single community is affected, the object id is derived from the community id — the rest of the product keeps working.

**Recovery source**
- **None needed for data**: measured in source, DOs persist only `auth:<communityId>:<userId>` membership cache entries, `revoke-room:<room>` counters and the monitor's `state`. There is no user data in them (audit §4.2).
- Cloudflare SQLite PITR covers 30 days, but it is only reachable from inside the object's code via bookmarks and `onNextSessionRestoreBookmark()`, then `ctx.abort()`.

**Recovery steps** (only if the object's storage is genuinely wrong)
```ts
// Inside the Durable Object, on an admin-only route:
const bookmark = await this.ctx.storage.getBookmarkForTime(Date.now() - 60 * 60 * 1000);
await this.ctx.storage.onNextSessionRestoreBookmark(bookmark);
this.ctx.abort(); // restart and apply
```

If storage is merely stale or unreadable, the safe action is to **drop the cache**, not to restore it:
```ts
await this.ctx.storage.deleteAll();
```
The membership cache repopulates on the next connection; the revocation registry repopulates as sockets reconnect.

**Data consistency checks**
- Membership checks still resolve (a member can join a room; a non-member is refused).
- Presence counts match the number of connected clients.

**Validation**
- Two clients in the same community see each other's messages.
- A revoked session is closed within the fan-out window.

**Rollback**
- Cache loss is not rollback-able, and does not need to be. No user-visible data is involved.

**Security note:** after any DO storage loss, a socket belonging to a just-revoked session may stay open until its next revalidation. The session row is already revoked, so it cannot revalidate — but if the loss coincides with a security incident, rotate `SESSION_SECRET` (§9) to force every client to re-authenticate.

## 9. Scenario 7 — compromised credentials

*Examples: a leaked service-role key, a public GitHub secret, a stolen R2 token, a phishing victim with dashboard access.*

**Detection**
- Unexpected rows, admin actions, or storage usage; a secret scanning alert; a provider security notice.
- Supabase/Cloudflare audit logs (enable them — see `BACKUP_IMPLEMENTATION.md` §9).

**Immediate containment — rotate in this order**

| Order | Secret | Why first | Effect |
|---|---|---|---|
| 1 | `SUPABASE_SERVICE_ROLE_KEY` | It bypasses RLS over the entire database | Update GitHub secret, redeploy |
| 2 | Database password | Direct psql access to everything | Supabase → Settings → Database → Reset password; update `SUPABASE_DB_URL` |
| 3 | `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Read/write/delete on all media | Roll the token; update GitHub secrets; redeploy |
| 4 | `SESSION_SECRET` | Forgery of session cookies | **Logs everyone out**; also invalidates realtime JWTs |
| 5 | `REALTIME_PUBLISH_SECRET`, `API_SECRET` | Internal endpoints | Update in both Workers |
| 6 | `UPSTASH_REDIS_REST_TOKEN` | Rate-limit bypass | Roll in Upstash |
| 7 | `RESEND_API_KEY`, `GIPHY_API_KEY`, `FCM_SERVICE_ACCOUNT` | Email/push abuse | Roll at each provider |
| 8 | `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Admin panel | Change the password, then rotate the secret |

**Recovery source** — not a backup problem. The question is *what did they change?* Compare against the newest dump:
```bash
node scripts/backup/restore-postgres.mjs --latest \
  --target-url "postgresql://postgres@127.0.0.1:5432/uxc_forensics" --identity "$AGE_IDENTITY" --allow-count-drift
```
Diff rows created or modified after the compromise window.

**Data consistency checks**
- `select id, email, created_at from public.users order by created_at desc limit 20;` — unexpected accounts?
- `select * from public.moderation_logs order by created_at desc limit 50;`
- Any new rows in `community_admin_permissions`?
- R2: any objects uploaded in the window (`ListObjectsV2` by `LastModified`).

**Validation**
- Old credentials fail: `curl` with the old service key returns 401.
- All sessions are gone (`select count(*) from public.auth_sessions` is 0).
- The app works end to end with the new credentials.

**Rollback** — none. Rotation is one-way; do not restore old values.

**Post-incident:** if the compromise included database writes, restore the last pre-compromise dump rather than deleting rows one by one.

## 10. Scenario 8 — accidental destructive migration

*Examples: a migration ran `drop table`, `delete from`, or a type change that lost data; a migration was applied to the wrong project.*

**Detection**
- A deploy that included a migration is followed by missing data or 500s.
- The migration file itself is the evidence — read it before assuming.

**Immediate containment**
1. **Stop the deploy pipeline** (disable the workflow) so the next push does not run more migrations.
2. **Take a snapshot now** (§1.2). Do not run any further DDL.
3. Identify the exact migration and whether it ran inside a transaction. Supabase's SQL editor does **not** wrap statements in a transaction by default; the CLI does per-file.

**Recovery source**
- The dump taken immediately before the migration. **This is why a manual snapshot is mandatory before any risky migration** — take one with:
  ```bash
  node scripts/backup/backup-postgres.mjs --out-dir ./pre-migration-$(date +%Y%m%dT%H%M)
  ```
- Otherwise, the newest nightly dump (up to 24 h of loss).

**Recovery steps**
```bash
# Option A — in place (the schema is known-bad and must go back as a whole).
node scripts/backup/restore-postgres.mjs --file ./pre-migration-…/uxcommunity-….dump.age \
  --manifest ./pre-migration-…/manifest.json \
  --target-url "$SUPABASE_DB_URL" --identity "$AGE_IDENTITY" --allow-production

# Option B — forward repair (preferred when the damage is narrow):
# write a new migration that re-inserts the lost rows from a scratch restore,
# then apply it normally.
```

**Data consistency checks**
- Compare row counts against the pre-migration dump's manifest (the restore script does this automatically).
- Check that schema objects exist: `select count(*) from pg_tables where schemaname='public'` should equal the previous count.
- Verify functions and triggers referenced by the app survive: `select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1;`

**Validation**
- Apply the *next* migration in a staging database before production.
- Run `npm run test:backup` and the SQL tests (`supabase/tests/run-local.sh`) against a schema built from the restored dump.

**Rollback**
- Option A's rollback is restoring a newer dump; the migration's effects are gone either way.
- Option B's rollback is a compensating migration. Keep migrations append-only — never edit an applied migration.

## 11. Scenario 9 — complete application infrastructure outage

*Examples: the Cloudflare account is suspended, the domain is lost, or both providers are unreachable.*

**Detection** — the site is unreachable, DNS does not resolve, or the dashboard login fails.

**Immediate containment**
- Communicate status to users (the marketing site is a separate repository and deployment — keep it independent).
- Do **not** delete DNS records or Workers while troubleshooting; they cost nothing and are needed for recovery.

**Recovery source**
- Code and configuration: this repository.
- Data: the backup bucket, which should live in a **different account** from production to survive an account-level outage (see `BACKUP_IMPLEMENTATION.md` §4).
- Secrets: the escrow record (§12).

**Recovery steps, in dependency order**
1. Restore account access (Cloudflare, Supabase, GitHub) — the runbook cannot recover a lost login; that is what §12 is for.
2. Recreate the R2 buckets (`drafthub`, `uxcommunity-private`), then restore objects (§6, `--all`).
3. Create the Supabase project in `ap-southeast-2` and restore the database (§3).
4. Re-enter secrets in GitHub (from escrow) and in Supabase/Cloudflare as needed.
5. Update `apps/web/wrangler.toml` `[vars]` with the new Supabase URL if the ref changed.
6. Deploy: `npm run deploy:web`, then `npm run deploy:realtime`.
7. Repoint DNS for `app.`, `rt.` and the media host.
8. Re-enable the scheduled workflows (`backup.yml`, `deploy.yml`).

**Data consistency checks** — all of §3 and §6, plus:
- Every URL in `member_resumes`, `account_verification_requests`, `dm_messages.image_url` resolves.
- `select count(*) from public.users` matches the last verified manifest.

**Validation**
- Full smoke test: sign in, feed, community chat (two clients), DM with an image, job post + application, notification arrives.
- `node scripts/backup/verify-backup.mjs --latest` returns to green (backups resumed).

**Rollback**
- Once DNS points at the new infrastructure, the old one is stale. Keep the old Worker versions for a week before deleting anything.

**Target RTO:** 4–8 hours with escrowed secrets and a working backup; **unbounded** without them.

## 12. Secret and DNS escrow (currently MISSING)

There is no automated escrow, and there must never be one inside this repository. Create, once, an out-of-band record (1Password/Bitwarden shared vault or a printed sheet in a safe) containing:

| Field | Example value |
|---|---|
| Supabase project ref + region + database password | `eauupthwlnarkauwifmw`, `ap-southeast-2` |
| Supabase service-role key | (secret; store in the vault) |
| Cloudflare account id + a break-glass API token | |
| R2 bucket names and a bucket-scoped token | |
| Age **private** key | `AGE-SECRET-KEY-…` |
| Resend, Upstash, Giphy, FCM service account | |
| `SESSION_SECRET`, `API_SECRET`, `REALTIME_PUBLISH_SECRET` | |
| Admin email + password | |
| GitHub organisation owner + recovery codes | |

**Rules**
- The age private key is the only thing that can decrypt backups. If it is lost, **every backup is permanently unreadable.** Store two copies in two physical locations.
- Never store any of these values in git, in a backup artifact, in a screenshot, or in a chat message.
- Review the escrow every 6 months and after every rotation.

**DNS records to record** (currently only in the Cloudflare dashboard):

| Name | Type | Target |
|---|---|---|
| `app.uxcommunity.in` | Worker route / CNAME | `uxcommunity-web` |
| `rt.uxcommunity.in` | Worker route / CNAME | `uxcommunity-realtime` |
| media host (`R2_PUBLIC_URL`) | CNAME | R2 bucket custom domain |

## 13. Production restore drill (not yet performed)

The restore drill in `scripts/backup/restore-drill.mjs` proves the tooling against a locally built schema. **It does not prove that a production dump contains production data.** Until the following has been run once, the audit's verdict stays "partially ready".

**Procedure** (isolated, never overwrites production)
1. Create a **separate** Supabase project (`uxc-restore-drill`), same region.
2. Run:
   ```bash
   export AGE_IDENTITY=~/uxc-backup-key.txt
   node scripts/backup/verify-backup.mjs --latest --download
   node scripts/backup/restore-postgres.mjs --latest \
     --target-url "postgresql://postgres.<drill-ref>:<pw>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres" \
     --identity "$AGE_IDENTITY"
   ```
3. Record: backup `createdAt`, restore wall-clock time, row counts per table, and any `countDiffs`.
4. Restore one private object into a scratch bucket and confirm it is **not** publicly readable.
5. Point a local `npm run dev` at the drill project (set `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `apps/web/.dev.vars` **temporarily**), sign in, open a community, read a thread.
6. Apply the next migration to the drill project and confirm it applies cleanly.
7. **Destroy the drill project**, restore `.dev.vars`, and record the results in this document.

**Acceptance criteria:** every table's count matches the manifest; restore completes in under 10 minutes; the app renders community content from restored data; private files remain private.

## 14. Appendix

### 14.1 Command reference

| Task | Command |
|---|---|
| Back up now (upload) | `npm run backup:db` |
| Back up now (local only) | `npm run backup:db -- --out-dir ./snapshot` |
| Mirror media | `npm run backup:media` |
| Check the newest backup | `npm run backup:verify -- --latest --download` |
| Restore newest to a target | `npm run backup:restore -- --latest --target-url "$TARGET" --identity "$AGE_IDENTITY"` |
| Restore a specific backup | `npm run backup:restore -- --object <key> --target-url "$TARGET"` |
| List backup contents | `npm run backup:restore -- --bucket uxcommunity-private --list` (media) |
| Restore media | `node scripts/backup/restore-r2.mjs --bucket <bucket> --key <key>` |
| Full local drill | `npm run backup:drill` |
| Unit tests | `npm run test:backup` |

### 14.2 Measured drill results (2026-10-30, PostgreSQL 17.11)

| Metric | Value |
|---|---|
| Schema built from | 1 `schema.sql` + 206 migrations |
| Tables restored | 76 |
| Plaintext dump | 666,228 bytes |
| Encrypted object | 666,588 bytes |
| Backup time | 0.5–0.9 s |
| Restore time | 0.29–0.94 s |
| Row counts after restore | exact match (`users` 3, `communities` 8, `community_messages` 43, `companies` 574, `job_posts` 1, `job_applications` 1, `dm_messages` 1) |
| Invalid indexes / unvalidated FKs | 0 / 0 |

### 14.3 What this runbook cannot do

- Recover an object deleted before the first successful media mirror.
- Recover data newer than the newest dump (no PITR).
- Recover the age private key. **Without it the backups are noise.**
- Recover a deleted Supabase project's provider-side backups (Supabase deletes them with the project).
