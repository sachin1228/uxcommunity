# Backup & Disaster Recovery Audit

Date: 2026-10-30
Branch: `feat/backup-disaster-recovery`
Scope: `apps/web` (Next.js on Cloudflare Workers), `apps/realtime` (Durable Objects), `supabase/` (PostgreSQL 17), Cloudflare R2 media buckets, GitHub Actions deployment, and the secrets they depend on. The marketing site (`uxcommunity-website`) holds no application data and no backups of it; it is out of scope beyond noting it.

## 0. How this audit was produced

Every statement below is one of three things, and the document says which:

| Label | Meaning |
|---|---|
| **Measured** | Read from the live system during this audit with read-only calls (R2 `ListObjectsV2` / `GetBucketVersioning` / `GetBucketLifecycleConfiguration`, Supabase PostgREST row counts, repository inspection). |
| **Documented** | Read from the provider's current documentation (URLs cited inline). |
| **Unverified** | Could not be established with the credentials available. Listed with the exact command an operator must run. |

No production data, bucket setting, secret or deployment was modified. The probes used the existing read-only credentials in `apps/web/.dev.vars`; their values were never printed.

**What could not be measured, and why.** Two facts need a credential this environment does not hold:

1. **Supabase backup configuration and plan.** Requires a Supabase personal access token (`sbp_...`), not the service-role key used by the app.
2. **PostgreSQL size, table bloat, and settings such as `wal_level`.** Requires the database password.

Both are therefore classified **UNKNOWN**, not "fine". §2.7 gives the exact commands to close them.

## 1. Executive summary

The application is **not ready** for a data-loss incident at the start of this branch:

- **No independent database backup exists.** Nothing in the repository exports PostgreSQL anywhere. Whether Supabase itself keeps backups is unverified, and even if it does, a provider-side backup inside the same project does not survive account suspension, a deleted project, or a compromised Supabase credential.
- **No file backup exists, and R2 cannot recover a deleted object.** Measured: object versioning is **not enabled on any of the three buckets**, and the only lifecycle rule is the default multipart-abort. Cloudflare documents no versioning, no replication and no undelete for R2; `DeleteObject` is irreversible. A deleted résumé, verification document or DM image is gone permanently.
- **No restore has ever been tested.** There was no dump, no restore procedure, and no drill. "The provider offers backups" was the entire disaster-recovery plan.
- **No secret escrow exists.** 23 GitHub Actions secrets (29 once this branch adds six) and 22 runtime values exist only as live values; losing the GitHub organisation, the Cloudflare account or the Resend/Upstash accounts loses them with no record of what they were.

What is genuinely reassuring, and shapes the recommendation:

- **The database is small and pre-launch**: measured 2 users, 42 communities, 46 memberships, 57 chat messages, 1 DM conversation. A full logical dump is under a megabyte.
- **The media library is small**: measured 4,464 objects / 25.4 MiB public and 2 objects / 1.28 MiB private. Copying all of it costs effectively nothing.
- **The Durable Objects hold no authoritative data.** Measured in source: they persist only membership-cache entries, socket-registry counters and one monitor decision — all reconstructable. Losing them entirely costs a few cache misses and one delayed socket revocation, not user data.
- **Configuration is already in git**, which is the cheapest and most reliable backup of the Worker setup.

The fix is therefore small and inexpensive: a scheduled encrypted dump plus a media mirror, both outside the application's runtime, with a tested restore. That is what this branch implements; the audit below is the evidence it is built on.

## 2. PostgreSQL (Supabase)

### 2.1 Instance

| Item | Value | Source |
|---|---|---|
| Project ref | `eauupthwlnarkauwifmw` | `supabase/.temp/project-ref` |
| Project name | `ux-community` | `supabase/.temp/linked-project.json` |
| Region | `ap-southeast-2` (Sydney) | `supabase/.temp/pooler-url` |
| PostgreSQL version | **17.6.1.147** | `supabase/.temp/postgres-version` |
| Connection | session-mode pooler, port **5432** (`aws-0-ap-southeast-2.pooler.supabase.com`) | `supabase/.temp/pooler-url` |
| Client access | server-side only, service-role key; the app ships no anon key | `apps/web/wrangler.toml`, `apps/web/lib/supabase/service.ts` |

Port 5432 matters for recovery: the transaction-mode pooler on 6543 cannot run `pg_dump`. The dump automation uses the 5432 URL.

### 2.2 Schema and migration history

- **206 migration files** in `supabase/migrations/`, earliest `001_password_resets.sql`, latest `20261030210000_session_revocation.sql`. Migrations are the source of truth; `supabase/schema.sql` is a partial snapshot that later migrations amend.
- **76 tables** in `public` after applying the history (measured by building the schema from scratch in the restore drill).
- **89 tables/views** exposed through PostgREST in production (measured via `/rest/v1/`).
- Extensions in use: **`pgcrypto`** (random bytes for invitation tokens) and **`pg_trgm`** (company search opclass in the `extensions` schema).
- Row-level security is enabled on user-facing tables; the app bypasses it with the service-role client and closes PostgREST to `anon`/`authenticated` on sensitive tables.

### 2.3 Data volume (measured, exact counts, 2026-10-30)

| Table | Rows |
|---|---|
| `users` | 2 |
| `communities` | 42 |
| `community_members` | 46 |
| `community_messages` | 57 |
| `dm_conversations` | 1 |
| `dm_messages` | 2 |
| `companies` | 573 |
| `company_domains` | 573 |
| `content_reactions` | 112 |
| `community_rules` | 85 |
| `cities` | 41 |
| `moderation_logs` | 28 |
| `member_resumes` | 1 |
| `notifications` | 4 |
| `job_posts` | 0 |
| `job_applications` | 0 |

Two production users means the effective value at risk today is small in bytes but total in product terms: the communities, the seed directory and the write history are the only record that the product has been used.

The restore drill produced a **666 KB** plaintext dump (custom format, already compressed; `age` adds ~360 bytes) for the full 76-table schema plus representative data. Database size is therefore comfortably under 100 MB; the required backup capacity is negligible.

### 2.4 Backup configuration

| Question | Answer | Evidence |
|---|---|---|
| Are automated backups configured? | **UNKNOWN** | Requires the Management API; no `sbp_` token available |
| Frequency | **UNKNOWN** — Supabase documents daily backups for Pro/Team/Enterprise only | Documented: <https://supabase.com/docs/guides/platform/backups> |
| Retention | **UNKNOWN** — 7 days on Pro, 14 on Team, up to 30 on Enterprise | Documented: same page |
| PITR available? | **UNKNOWN at this project**; PITR is a paid add-on on Pro+ and requires at least a Small compute add-on | Documented: same page, <https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery> |
| Is the project on a plan that includes backups at all? | **UNKNOWN** — on the Free plan there are **no backups**, and no backup download | Documented: <https://supabase.com/pricing> |
| Can an operator download a backup today? | **No evidence of one ever being taken or downloaded** | Repository-wide search: no `pg_dump`, no export job, no artifact |

The honest statement is: **there is no evidence that any restorable copy of this database exists.** Provider defaults are not evidence, and the Free plan has none.

### 2.5 What can and cannot be restored today

| Goal | Supabase dashboard restore | This branch's dump |
|---|---|---|
| Whole database | Only if on Pro+ with a backup (unverified) | Yes |
| Individual table | No — restores are whole-database (in place or to a new project) | Yes — `-Fc` dump supports `pg_restore -t` |
| Accidentally deleted rows | Only by restoring to a new project at a point before the delete, then copying rows back | Yes, same technique, and it works on any plan |
| Deleted community content older than the retention sweep | Same as above | Yes, subject to dump age |
| Application/job data | Same as above | Yes |

Documented limitation worth stating plainly: Supabase states that recovering deleted rows by inspecting dead tuples is **not supported** and that "restoring to a new project is the safe way to get deleted rows back" (<https://supabase.com/docs/guides/platform/clone-project>). Both recovery paths are whole-database; a single-table restore is always a two-step operation.

### 2.6 Dependencies

- **R2** holds every uploaded file; the database stores only URLs. A database restore without the media backup yields rows pointing at missing objects.
- **Upstash Redis** is used for rate limiting. Its contents are ephemeral; losing it degrades throttling briefly, never data.
- **`auth_sessions`** lives in the database, and the realtime worker validates sessions against it. Restoring an older database resurrects sessions that were revoked after the dump — see the runbook's consistency checks.

### 2.7 Closing the unknowns (operator commands)

```bash
# 1. Are backups configured, and is PITR on?
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/eauupthwlnarkauwifmw/database/backups" | jq '{pitr_enabled, walg_enabled, backups: (.backups|length)}'

# 2. Plan / billing
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/eauupthwlnarkauwifmw" | jq '{name, region, status}'

# 3. Database size and bloat (needs the DB password, not the service key)
psql "$SUPABASE_DB_URL" -c "select pg_size_pretty(pg_database_size(current_database()))"
psql "$SUPABASE_DB_URL" -c "select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc limit 15"
```

The first command returns `pitr_enabled` and the backup list. A `backups: []` result on a Pro project means daily backups have produced nothing — itself a finding.

## 3. Cloudflare R2

### 3.1 Buckets and measured state

| Bucket | Purpose | Objects | Bytes | Versioning | Lifecycle | CORS |
|---|---|---|---|---|---|---|
| `drafthub` | public media (avatars, community content, company logos, Lottie, master data) | **4,464** | **25.44 MiB** | **not enabled** (`GetBucketVersioning` → unset) | only `Default Multipart Abort Rule` (7 days) | PUT/GET/HEAD from `localhost:3000`, `app.uxcommunity.in`, `uxcommunity.in`, `*.workers.dev` |
| `uxcommunity-private` | résumés, verification samples, DM images | **2** | **1.28 MiB** | **not enabled** | same single rule | none configured |
| `uxcommunity-web-next-cache` | Next.js ISR / `unstable_cache` | (not counted) | — | not enabled | same single rule | none |

Measured on 2026-10-30 with the media credentials from `apps/web/.dev.vars`, read-only. The public bucket composition: `master-data` 90 objects / 13.01 MiB, `companies` 4,363 / 9.45 MiB, `events` 5 / 1.07 MiB, `verification` 1 / 0.84 MiB, `threads` 4 / 0.69 MiB.

### 3.2 Recovery capability

| Question | Answer | Evidence |
|---|---|---|
| Object versioning? | **Not available on R2 at all.** `PutBucketVersioning`/`GetBucketVersioning` are listed as unimplemented; there are no delete markers and no `NoncurrentVersionExpiration`. A 2022 release note added a *dummy* `GetBucketVersioning` so SDKs do not error — it does not enable versioning | Documented: <https://developers.cloudflare.com/r2/api/s3/api/>, <https://developers.cloudflare.com/r2/buckets/object-lifecycles/> |
| Bucket replication? | **No.** `PutBucketReplication` unimplemented; no replication page in the bucket docs. Durability replication inside a region is not a backup | Documented: same S3 matrix, <https://developers.cloudflare.com/r2/reference/durability/> |
| Object lock / WORM? | Yes, as **bucket locks** (retention rules), dashboard/Wrangler/API only — not the S3 Object Lock API. **No rule is known to be configured**, but the S3 API this audit could use cannot read lock rules, so treat this as *not configured* until checked in the dashboard | Documented: <https://developers.cloudflare.com/r2/buckets/bucket-locks/>; unverified for these buckets |
| Undelete after `DeleteObject`? | **None.** "Deleting objects from a bucket is irreversible." Durability "does not prevent intentional or accidental deletion of data" | Documented: <https://developers.cloudflare.com/r2/objects/delete-objects/>, <https://developers.cloudflare.com/r2/reference/durability/> |
| Backup today? | **None.** No object mirror, no second bucket, no export | Repository search; no backup bucket exists |

### 3.3 What this means per file class

| File class | Where | Recoverable today? |
|---|---|---|
| User avatars | `drafthub` | **No** — deletion is permanent |
| Resumes | `uxcommunity-private` | **No** |
| Verification documents | `uxcommunity-private` / `drafthub` (legacy) | **No** |
| DM images | `uxcommunity-private` | **No** |
| Community media (threads, showcase, events, chat) | `drafthub` | **No** |
| Company logos, cities, Lottie | `drafthub` | Regenerable from `data/company-directory` seeds and re-upload scripts — the only class where loss is survivable |

The last row matters for cost: backing up the whole public bucket is cheaper and simpler than classifying it, and 25 MiB is far below any meaningful threshold.

### 3.4 Retention and growth

- Community chat images are hard-deleted after 15 days by a scheduled sweep (`apps/realtime/src/retention.ts` → `apps/web/lib/communities/message-retention-sweep.ts`). A backup therefore also becomes the only history of expired chat media — which is a **privacy decision**, not just a storage one. Recorded in §7 as a finding.
- Growth is dominated by user media. At 25.4 MiB today, even a 100× increase stays inside R2's 10 GB free tier.

## 4. Cloudflare Durable Objects

### 4.1 What exists

| Binding | Class | Storage backend | Declared in |
|---|---|---|---|
| `COMMUNITY_DO` | `Room` | SQLite (`new_sqlite_classes` v1) | `apps/realtime/wrangler.toml` |
| `USER_DO` | `UserDO` | SQLite (v2) | same |
| `ALERT_MONITOR` | `AlertMonitor` | SQLite (v4) | same |

### 4.2 What is actually persisted (measured in source)

| Key | Written by | Contents | Authoritative? |
|---|---|---|---|
| `auth:<communityId>:<userId>` | `membership-auth.ts` | `{ok, ts}` membership cache with a TTL and a prune sweep | **No** — re-fetched from the web API |
| `revoke-room:<room>` | `user.ts` | `{ts, count}` of live sockets per community, used to fan out session revocation | **No** — rebuilt as clients reconnect |
| `state` | `alert-monitor.ts` | last dependency-alert decision | **No** — a missed edge just re-alerts |

There is **no `storage.sql` usage anywhere in `apps/realtime/src`** (measured: zero matches). The Durable Objects store no messages, no membership records and no user data. Community chat is persisted in PostgreSQL (`community_messages`), DMs in `dm_messages`, presence in memory and socket attachments.

### 4.3 Recovery capability

| Question | Answer |
|---|---|
| Are DOs backed up by Cloudflare? | **No documented backup product.** No export/download API. The only documented recovery is SQLite PITR (<https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/>) |
| PITR retention | **30 days**, always on for SQLite-backed DOs, covers SQL and KV data written via `put()` |
| Restorable by an operator? | Only from *inside* the object's code, via bookmarks and `onNextSessionRestoreBookmark()` — there is no CLI or dashboard restore |
| Durability | Strongly consistent with output gates; Cloudflare's engineering blog describes 5 followers / 3-of-5 acknowledgement, but the public docs state no replication factor or SLA |
| Data loss impact if all DO storage vanished | Membership cache rebuilt on next connect; revocation registry rebuilt as sockets reconnect. **No user-visible data loss.** One caveat: a socket belonging to a just-revoked session might not be closed immediately, but the session row is already revoked, so it cannot revalidate |

**Conclusion: Durable Objects are a cache, not a data store.** They need no backup process. Their 30-day PITR is a bonus, not a dependency.

## 5. Other infrastructure

| Asset | Current state | Backup | Risk if lost |
|---|---|---|---|
| **GitHub Actions secrets** (23 existing, 29 with this branch) | Live values only | **None** | **High** — cannot be read back; a lost org or a deleted secret means re-issuing every credential |
| **Runtime secrets** (22 keys in `.dev.vars`) | Pushed to Workers on each deploy from GitHub secrets | None | High, same as above |
| **Worker code and config** | `apps/web/wrangler.toml`, `apps/realtime/wrangler.toml`, `open-next.config.ts`, workflows | **Git** | Low — `wrangler deploy` recreates it |
| **Cron triggers** (`*/5`, `0 */6`, `* * * * *`) | Declared in `apps/realtime/wrangler.toml` | Git | Low |
| **DNS / custom domains** (`app.`, `rt.`, media host) | Cloudflare dashboard, not in the repository | **None in code** | Medium — recoverable from memory/screenshots, but not documented |
| **Push (Expo + FCM service account)** | `FCM_SERVICE_ACCOUNT` secret | None | Medium — re-issuable from Google Cloud console |
| **Email (Resend)** | `RESEND_API_KEY`, `EMAIL_FROM` | None | Low — re-issuable |
| **Cache (Upstash)** | URL + token | None | Low — recreatable, contents disposable |
| **Supabase Storage buckets** | Two buckets inserted by migrations | n/a | **None** — verified: no `supabase.storage` usage in application code; all uploads go to R2 |
| **Migration history** | 206 files in git | Git | Low |

Secrets are never included in any backup artifact this branch produces. Their *names* and *purpose* are documented in `audit/BACKUP_IMPLEMENTATION.md`; their values are not.

## 6. Recovery matrix

RPO = maximum acceptable data loss. RTO = maximum acceptable time to restore service. Targets are chosen for a pre-launch product with 2 users and a near-zero infrastructure budget; they are **targets**, not current capabilities.

| Data source | Current backup | Recovery method | RPO | RTO | Risk |
|---|---|---|---|---|---|
| **PostgreSQL** | **MISSING** independently; provider state **UNKNOWN** | *After this branch:* encrypted `pg_dump` in R2 backup bucket, daily. Before: none. | 24 h (target) | 1–2 h (target) | **Critical** — no evidence any restorable copy exists |
| **R2 public files** | **MISSING** — versioning disabled, no replication, no undelete | *After this branch:* additive mirror to `BACKUP_R2_BUCKET` (`r2/<bucket>/…`), daily | 24 h (target) | 30 min – 2 h (target) | **High** — deleted media is unrecoverable today |
| **R2 private files** (résumés, verification, DM) | **MISSING** | Same mirror; 1.28 MiB total, so a full restore is trivial | 24 h (target) | < 30 min (target) | **Critical** — sensitive documents with the highest recovery cost |
| **Durable Objects** | **NOT APPLICABLE** (cache only); Cloudflare PITR 30 d exists | Rebuild automatically from PostgreSQL + web API | ~0 (no authoritative data) | Seconds (self-healing) | **Low** — a delayed revocation close is the only visible effect |
| **Application configuration** | **VERIFIED** — git | `git clone`, then `wrangler deploy` | 0 | 15 min (target) | Low |
| **Secrets** | **MISSING** — live values only | Re-issue from each provider; requires an out-of-band record of names/owners | 0 if escrowed | 2–4 h (target) | **High** — no escrow exists |
| **DNS / domains** | **PARTIAL** — in Cloudflare, not in repo | Recreate from the runbook's documented records | n/a | 1 h (target) | Medium |
| **Push / email / cache** | **MISSING** (re-issuable) | Re-issue credentials, update GitHub secrets, redeploy | n/a | 1 h (target) | Low–Medium |

### 6.1 Why these targets, at this scale

- **24 h RPO for the database** is defensible *today*: the product is pre-launch, and the largest realistic loss is a day of community chat and moderation actions. It stops being defensible at public launch, where a day of user sign-ups and messages is a reputational event. The schedule is therefore written to be tightened to 6-hourly (four runs a day) at **zero marginal cost** — see `audit/BACKUP_IMPLEMENTATION.md` §7.
- **24 h RPO for media** follows the same reasoning, and the mirror is incremental, so a tighter schedule costs almost nothing.
- **1–2 h RTO** assumes the operator is available and the dump is under 10 MB (measured: 0.67 MB for the full schema). It includes creating a target, restoring, and re-pointing the app. A production restore has never been performed; see §9.
- **PITR is deliberately not recommended yet.** Supabase prices it at roughly **$100/month per 7 days of retention**, plus the Small compute add-on it requires — one to two orders of magnitude above every other line in this backup budget, for an RPO improvement (24 h → ~2 min) that a pre-launch product with 2 users does not need. It becomes worth revisiting when a lost day of writes is worth more than $100.

## 7. Findings

| ID | Severity | Finding | Status on this branch |
|---|---|---|---|
| DB-1 | Critical | No independent PostgreSQL backup existed; no evidence any restorable copy existed at all | **Fixed by automation** — daily encrypted dump; production run not yet executed |
| DB-2 | High | No restore procedure and no tested restore | **Fixed** — runbook + automated drill; drill passes locally |
| R2-1 | Critical | R2 has no versioning/replication/undelete; all 4,466 media objects had no second copy | **Fixed by automation** — additive mirror |
| R2-2 | Medium | 4,363 of 4,464 public objects are regenerable company logos; backing them up is still cheaper than classifying them | Accepted — whole-bucket mirror |
| R2-3 | Medium | Backups will retain chat media that the 15-day sweep deletes from production | **Documented** — retention policy and privacy trade-off in `audit/BACKUP_IMPLEMENTATION.md` §6 |
| DO-1 | Low | Durable Objects are not backed up | **Accepted, justified** — they hold no authoritative data |
| SEC-1 | High | No secret escrow; 23 existing GitHub secrets cannot be read back | **Documented** — escrow procedure in the runbook §12; not automated (values must never touch the repo) |
| CFG-1 | Low | DNS records and custom domains exist only in the Cloudflare dashboard | **Documented** — runbook §12 |
| MIG-1 | Medium | `pg_dump --schema=public` silently omits `CREATE EXTENSION` and emits `CREATE SCHEMA public`, which fails against any existing project — discovered by the restore drill failing | **Fixed** — dump uses an exclude-list and recreates extensions from the manifest |
| OBS-1 | High | A backup that stops running looks exactly like a healthy one | **Fixed** — `verify-backup.mjs --max-age-hours 36` gates the workflow; failure emails admins |
| PROD-1 | High | Production restore remains untested (no database password available in this environment, and production restores are forbidden by the task) | **Open** — exact drill procedure in the runbook §13 |

## 8. Component classification

| Component | Classification | Basis |
|---|---|---|
| PostgreSQL — provider backups | **UNKNOWN** | No Management API token; §2.7 commands to verify |
| PostgreSQL — independent backup | **CONFIGURED** (workflow written) → **not yet VERIFIED in production** | Script + workflow exist and pass locally; no production run has been observed |
| PostgreSQL — restoration | **PARTIAL** | Restore proven against a real PostgreSQL 17 cluster built from this repository's 206 migrations (`audit/BACKUP_IMPLEMENTATION.md` §5); not proven against production data |
| R2 public files | **CONFIGURED** — mirror script, no production run yet | Measured bucket state; script passes locally against real buckets in dry-run |
| R2 private files | **CONFIGURED** — same | Bucket is new and holds 2 objects |
| Durable Objects | **NOT REQUIRED** | No authoritative data (measured in source) |
| Application configuration | **VERIFIED** | In git; reproducible by checkout + deploy |
| Secrets | **MISSING** | No escrow mechanism exists |
| DNS / domains | **PARTIAL** | Documented in the runbook, not machine-verifiable |
| Migration history | **VERIFIED** | 206 files in git; replay proven by the drill |

## 9. Verdict

**NOT READY** at the time of this audit.

There was no independent copy of the database, no copy of any uploaded file, no restore procedure, and no evidence that a restore had ever been attempted. The provider may have been keeping backups; that possibility is not a disaster-recovery system, and it would not have survived a deleted project or a compromised account.

After this branch is merged and its workflow has run successfully, the honest classification becomes **PARTIALLY READY**:

- *Ready:* an independent encrypted database dump, an additive media mirror, retention, checksums, freshness monitoring, failure alerts, and a restore procedure that is exercised automatically every week.
- *Not yet ready:* a **production** restore has not been performed. The tooling and the schema are proven; the production dataset is not. The first production restore must be scheduled deliberately (runbook §13) before this can be called production-ready.

**PRODUCTION READY** requires, at minimum: one successful production restore into an isolated project with row counts matched, one successful media object restored and served, and the secret escrow completed.
