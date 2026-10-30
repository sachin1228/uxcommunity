# Backup Implementation

Date: 2026-10-30
Branch: `feat/backup-disaster-recovery`
Read with: [`BACKUP_DISASTER_RECOVERY_AUDIT.md`](./BACKUP_DISASTER_RECOVERY_AUDIT.md) (what was missing), [`DISASTER_RECOVERY_RUNBOOK.md`](./DISASTER_RECOVERY_RUNBOOK.md) (how to recover).

## 1. What was built

The smallest system that answers the audit's findings without adding a paid provider:

| File | Role |
|---|---|
| `scripts/backup/backup-postgres.mjs` | Dump → SHA-256 → encrypt with age → upload → verify by HEAD → apply retention |
| `scripts/backup/backup-r2.mjs` | Additive mirror of the media buckets into the backup bucket, verified by re-listing |
| `scripts/backup/verify-backup.mjs` | Proves a backup exists, is intact and is fresh (`--max-age-hours`, default 36) |
| `scripts/backup/restore-postgres.mjs` | Verify checksums → decrypt → guard the target → `pg_restore` → check counts and structure |
| `scripts/backup/restore-r2.mjs` | Copy one object, a prefix, or a whole bucket back from the mirror |
| `scripts/backup/restore-drill.mjs` | End-to-end proof: builds a throwaway PostgreSQL 17, backs it up, restores it elsewhere, compares |
| `scripts/backup/notify-failure.mjs` | Emails admins when a scheduled run fails |
| `scripts/backup/lib/*.mjs` | Config validation, S3 client with retries, PostgreSQL wrappers, manifest/retention logic, logging |
| `scripts/backup/fixtures/drill-seed.sql` | Deterministic seed rows for the drill |
| `.github/workflows/backup.yml` | Daily backup + verification; weekly restore drill; failure alerts |

Nothing in `apps/web` or `apps/realtime` changed. The application's runtime behaviour is untouched; this branch only adds tooling and documentation.

## 2. How a backup runs

```
pg_dump (custom format, compressed, application schemas only)
   ↓
SHA-256 of the plaintext dump
   ↓
age encrypt to the operator's PUBLIC key          ← plaintext never leaves the machine
   ↓
SHA-256 of the ciphertext
   ↓
PUT  s3://BACKUP_R2_BUCKET/db/YYYY/MM/DD/uxcommunity-<ts>.dump.age
PUT  …/uxcommunity-<ts>.dump.age.sha256
PUT  …/uxcommunity-<ts>.manifest.json
   ↓
HEAD the object and compare Content-Length        ← a 200 from PUT is not proof
   ↓
retention: delete backups older than N days, keeping the newest K
   ↓
delete the local plaintext AND ciphertext
```

A manifest records the source, server version, extensions, row counts, both checksums and sizes. It is what makes a restore verifiable rather than hopeful.

### 2.1 Key layout

```
db/2026/10/30/uxcommunity-20261030T023000Z.dump.age
db/2026/10/30/uxcommunity-20261030T023000Z.dump.age.sha256
db/2026/10/30/uxcommunity-20261030T023000Z.manifest.json
r2/drafthub/<original key>
r2/uxcommunity-private/<original key>
r2/<bucket>/_manifest.json
```

Date-partitioned so listing is cheap and keys sort chronologically; media keeps its original key under its bucket name so two buckets can never collide.

## 3. Design decisions

**Public-key encryption (age), not a passphrase.** The machine that runs backups holds only the *public* key. A compromised CI runner, a leaked repository secret, or a stolen laptop cannot decrypt a single stored backup. The private key never exists in CI and is never written to the repository.

**`pg_dump`, not a provider snapshot.** Supabase's own backups depend on the plan, cannot be downloaded on Free, and disappear with the project. A logical dump can be restored into any PostgreSQL 17 instance, can restore a single table, and is readable a decade from now.

**Exclude the Supabase-managed schemas instead of `--schema=public`.** Two concrete failures, found by the restore drill rather than in production:

1. `pg_dump --schema=public` **omits `CREATE EXTENSION`**. Restoring then failed on the first column default that calls `gen_random_bytes()`, because `pgcrypto` was never installed in the target.
2. It emits `CREATE SCHEMA public`, which fails against any target where `public` already exists — every Supabase project.

The exclude list keeps the dump self-contained (extensions remain referenced, no schema DDL for `public`), and `restore-postgres.mjs` recreates the recorded extensions before `pg_restore`. The `extensions` schema itself is excluded and recreated the same way, so restoring into a project that already has it does not collide.

**Additive media mirror.** The script copies and never deletes. A deletion in production must not propagate to the backup — that is the whole point. Reconciliation is by key + size (R2's ETag is not a content MD5 for multipart objects, so it cannot be compared across buckets).

**GitHub Actions, not a Worker cron.** The application's existing cron runs inside the same Cloudflare account it protects. A scheduled GitHub job survives a Cloudflare outage; the database dump needs no Cloudflare access at all.

**Retention in the script, not a bucket lifecycle rule.** A lifecycle rule on the backup bucket would also expire the media mirror, which has no expiry. Deleting only keys matching `db/…/uxcommunity-<ts>.manifest.json` means a bug in retention cannot touch a media object.

## 4. Configuration

### 4.1 Create the backup bucket

A dedicated bucket, **never** the media bucket or the Next.js cache bucket:

```bash
npx wrangler r2 bucket create uxcommunity-backups
```

Or: Cloudflare dashboard → R2 → Create bucket → `uxcommunity-backups` (private, no custom domain, no public access).

**Offsite option (recommended).** R2 has no replication, and a bucket in the same account is not a separate failure domain. To keep the copy somewhere else, point `BACKUP_S3_ENDPOINT` at any S3-compatible store (a second Cloudflare account, Backblaze B2, MinIO) and supply that store's credentials. Nothing else changes.

### 4.2 Generate the encryption keypair

Once, on a trusted machine:

```bash
age-keygen -o ~/uxc-backup-key.txt      # prints the public key: age1…
age-keygen -y ~/uxc-backup-key.txt      # re-print the public key
chmod 600 ~/uxc-backup-key.txt
```

- The **public** key (`age1…`) goes into the `BACKUP_AGE_RECIPIENT` secret. It is not sensitive.
- The **private** key stays offline, in two physical locations (runbook §12). If it is lost, every backup is unreadable.

### 4.3 Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `SUPABASE_DB_URL` | yes | Session-mode pooler URL (**port 5432**), including the database password. Not the service-role key |
| `BACKUP_R2_BUCKET` | yes | The backup bucket |
| `BACKUP_R2_ACCOUNT_ID` | yes\* | Cloudflare account id (falls back to `R2_ACCOUNT_ID`) |
| `BACKUP_R2_ACCESS_KEY_ID` | yes | Token with **read on the media buckets and read/write on the backup bucket** |
| `BACKUP_R2_SECRET_ACCESS_KEY` | yes | |
| `BACKUP_AGE_RECIPIENT` | yes | `age1…` public key |
| `BACKUP_S3_ENDPOINT` | no | Non-R2 destination; overrides the R2 endpoint |
| `BACKUP_PREFIX` | no | Default `db` |
| `BACKUP_RETENTION_DAYS` | no | Default `30` |
| `BACKUP_KEEP_MINIMUM` | no | Default `7` (always kept, whatever the age) |
| `BACKUP_EXCLUDE_SCHEMAS` | no | Defaults to the Supabase-managed list in `lib/config.mjs` |
| `BACKUP_COUNT_TABLES` | no | Tables whose exact counts are recorded |
| `BACKUP_MEDIA_SOURCES` | no | Defaults to `R2_BUCKET_NAME,R2_PRIVATE_BUCKET_NAME` |
| `AGE_IDENTITY` | restore only | Path to the private key (or pass `--identity`) |

\* not needed when `BACKUP_S3_ENDPOINT` is set.

**A note on the token scope.** The media mirror reads the two media buckets and writes the backup bucket, so a single token must cover all three. R2 tokens can be scoped to a list of buckets; create one for `drafthub`, `uxcommunity-private`, `uxcommunity-backups` with *Object Read & Write*. If `BACKUP_R2_*` is unset the scripts fall back to the media token (`R2_*`), which will fail to write the backup bucket unless that token is scoped for it — set the dedicated variables in production.

### 4.4 GitHub Actions secrets

Add under Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `SUPABASE_DB_URL` | `postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres` |
| `BACKUP_R2_BUCKET` | `uxcommunity-backups` |
| `BACKUP_R2_ACCOUNT_ID` | Cloudflare account id |
| `BACKUP_R2_ACCESS_KEY_ID` | token access key |
| `BACKUP_R2_SECRET_ACCESS_KEY` | token secret |
| `BACKUP_AGE_RECIPIENT` | `age1…` |

Reused if already present: `R2_BUCKET_NAME`, `R2_PRIVATE_BUCKET_NAME`, `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL`.

The workflow fails at "Verify required secrets" with the missing names, before any dump runs.

### 4.5 First run

```bash
# Dry run: no upload, no retention, proves the dump and encryption work.
node scripts/backup/backup-postgres.mjs --dry-run

# Local run: leaves encrypted artifacts in ./backup-out for inspection.
node scripts/backup/backup-postgres.mjs --no-upload --out-dir ./backup-out

# Real run.
node scripts/backup/backup-postgres.mjs
node scripts/backup/backup-r2.mjs
node scripts/backup/verify-backup.mjs --latest --download
```

Or trigger the workflow manually: Actions → Backup → Run workflow.

### 4.6 Local prerequisites

- PostgreSQL client **17** (the server is 17.6; `pg_dump` refuses a newer server). macOS: `brew install postgresql@17` and put its `bin` first, or set `PG_BIN=/opt/homebrew/opt/postgresql@17/bin`.
- `age` (`brew install age`, `apt-get install age`).

## 5. Testing evidence

### 5.1 Unit tests — 30 passing

```bash
npm run test:backup
```

Cover: key naming, manifest validation, retention (including "never empty the store" and "ignore unparseable timestamps"), config validation and secret redaction, the production-target guard, retry classification (5xx/429 retried, 4xx not), backoff bounds, and the argument parser's refusal of unknown options.

### 5.2 Restore drill — passing

```bash
PG_BIN=/opt/homebrew/opt/postgresql@17/bin npm run backup:drill
```

It builds a real PostgreSQL 17.11 cluster, applies `supabase/schema.sql` plus all 206 migrations (76 tables), seeds users/communities/members/messages/companies/jobs/applications/DMs, generates a throwaway age keypair, runs the **real** backup script, runs the **real** verify script, restores into a **separate empty database** with the **real** restore script, and re-checks everything independently.

Measured result (2026-10-30):

| Metric | Value |
|---|---|
| Tables restored | 76 |
| Plaintext / ciphertext | 666,228 B / 666,588 B |
| Backup | 0.5–0.9 s |
| Restore | 0.29–0.94 s (varies with machine load) |
| Row counts | exact match on all 9 checked tables |
| Invalid indexes / unvalidated FKs | 0 / 0 |
| Orphan community messages | 0 |
| Migration history re-applied to the restored database | healthy afterwards |

**What this proves:** the tooling works, the schema round-trips, checksums verify, encryption/decryption works with a real key, and a restore into a clean PostgreSQL 17 succeeds.

**What it does not prove:** that a production dump contains production data. That requires the production password and is listed as an open item (audit §7, PROD-1; runbook §13).

### 5.3 Media mirror — dry-run against the real buckets

```bash
BACKUP_R2_BUCKET=<scratch-bucket> node scripts/backup/backup-r2.mjs --dry-run
```

Result: `drafthub` 4,464 objects / 26,671,052 B; `uxcommunity-private` 2 objects / 1,342,175 B; exit 0. Listing, comparison and reporting are exercised against real data.

**Not exercised:** an actual copy round-trip, because that would write to a production bucket. It is classified CONFIGURED, not VERIFIED, until the first production run.

## 6. Retention and privacy

- Database backups: **30 days**, at least the newest **7** kept unconditionally.
- Media mirror: **no automatic deletion**. Removing media from the backup is a deliberate operator action; the mirror is meant to outlive deletions.
- **Privacy trade-off, stated explicitly:** community chat images are hard-deleted from production after 15 days by the retention sweep. The mirror keeps them for as long as the mirror exists. That is intentional for recovery, but it means the backup bucket must be treated as holding personal data: private access only, no public domain, and access limited to the backup token.
- The manifest records host, database and row counts — no secrets, no row contents.

## 7. Tuning the schedule

| Frequency | Cost | RPO |
|---|---|---|
| Daily 02:30 UTC (current) | $0 | 24 h |
| Every 6 hours | $0 — GitHub Actions minutes only | 6 h |
| Hourly | ~720 runs/month; still inside 2,000 private-repo minutes only if each run is < 2.7 min (unlikely with `npm ci`) | 1 h |

To tighten: edit the `cron` in `.github/workflows/backup.yml` and lower `BACKUP_RETENTION_DAYS` if storage matters (it does not at this size). Do this at public launch.

## 8. Monitoring and alerts

1. **Freshness gate** — `verify-backup.mjs --max-age-hours 36` fails the run if the newest backup is older than 36 hours. One missed run is tolerated; two are not.
2. **Integrity gate** — the same step re-downloads the object and compares SHA-256.
3. **Upload verification** — `backup-postgres.mjs` HEADs every object and compares size.
4. **Mirror verification** — `backup-r2.mjs` re-lists the destination and fails on any object whose size differs.
5. **Admin email** — on failure, `notify-failure.mjs` posts to Resend using the existing `RESEND_API_KEY` / `EMAIL_FROM` / `ADMIN_EMAIL`. It never fails the job (the job has already failed).

A failed scheduled workflow also shows red in the Actions tab, but that is not an alert — nobody watches at 02:30.

## 9. Cost

### 9.1 Measured inputs

| Item | Value | Source |
|---|---|---|
| Public media | 26,671,052 B (25.4 MiB) | measured |
| Private media | 1,342,175 B (1.28 MiB) | measured |
| Database dump | 666,228 B for 76 tables with representative data | measured by the drill |
| 30 daily dumps | ~20 MB | estimated from the above |
| **Total stored after one month** | **~50 MB (0.05 GB)** | estimate |

### 9.2 Confirmed prices (provider pages, 2026-10-30)

| Item | Price | Confirmed |
|---|---|---|
| R2 Standard storage | $0.015 / GB-month, first 10 GB free | ✅ <https://developers.cloudflare.com/r2/pricing/> |
| R2 Class A (writes, copies, lists) | $4.50 / million, first 1 M free | ✅ same |
| R2 Class B (reads, heads) | $0.36 / million, first 10 M free | ✅ same |
| R2 deletes | free | ✅ same |
| Supabase Pro | $25 / month, includes 7-day daily backups | ✅ <https://supabase.com/pricing> |
| Supabase PITR | ~$100 / month per 7 days retention; requires Small compute ($15, −$10 credit) | ✅ <https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery> |
| GitHub Actions | free for public repos; 2,000 min/month included on Free for private | ✅ documented plan terms |

### 9.3 What this costs

At the measured volume: **0.05 GB → $0.00075/month**, which is inside R2's 10 GB free tier → **$0.00/month**. The first mirror run copies 4,466 objects (~4,500 Class A operations, about $0.02 if the free allowance were exhausted; it is not). Daily incremental runs are a handful of list and copy operations.

GitHub Actions: one `npm ci` (~1–2 min) plus the job (~1–2 min) per day ≈ 90–120 min/month; the weekly drill adds ~10 min/week ≈ 40 min/month. **Total ≈ 130–160 minutes/month**, inside the 2,000-minute allowance. *Estimated, not measured* — confirm on the account's billing page after the first month.

### 9.4 Three strategies

| Strategy | Components | Monthly cost | RPO | RTO |
|---|---|---|---|---|
| **Cheapest acceptable** | This automation only: daily encrypted dump (7-day retention) + media mirror, on the current Supabase plan | **$0** (R2 + GitHub free tiers; Resend free tier) | 24 h | 1–2 h |
| **Recommended** | This automation at 30-day retention + weekly restore drill + Supabase Pro for a second, provider-side daily backup + an off-account copy via `BACKUP_S3_ENDPOINT` | **$0 if already on Pro; $25 if upgrading from Free** (off-account copy ≈ $0 at this size) | 24 h (6 h by tightening the cron) | ~1 h |
| **Higher resilience** | Recommended + PITR (7-day) + 6-hourly dumps + R2 bucket lock on the `db/` prefix + R2 Data Access Logs | **~$105–130** ($100 PITR + $15 Small compute − $10 credit, plus ≈$0 storage) | ~2 min | 30–60 min |

**Recommendation: the "Recommended" row, minus PITR.** It is $0–25/month, removes the single-provider dependency that caused the audit's critical findings, and the drill keeps proving it works. PITR's $100/month buys a 24 h → 2 min RPO improvement that a pre-launch product with 2 users does not need; revisit when a lost day of writes costs more than $100.

**Confirmed vs estimated:** R2 and Supabase unit prices are confirmed from the providers' current pages. Storage volume after a month, GitHub minutes and future media growth are estimates derived from measured current values.

## 10. Hardening not done (deliberately)

| Item | Why not now | When |
|---|---|---|
| R2 **bucket lock** on the `db/` prefix | Prevents even an operator from deleting backups; needs the dashboard and a retention decision | Before public launch |
| **R2 Data Access Logs** | Needed to answer "who deleted this object"; adds log storage cost | With the first paying user |
| **Off-account copy** | Configured but not provisioned (`BACKUP_S3_ENDPOINT` is empty) | When a second account exists |
| **PITR** | ~$100/month for an RPO improvement not yet needed | At public launch, if a lost day is unacceptable |
| **Durable Object export** | No authoritative data to export (audit §4) | Never, unless DOs start storing state |
| **Secret escrow automation** | Values must never touch the repository; this is a human process | Runbook §12, do it now |
| **Cross-region restore test** | The drill runs locally; a production restore into another region is untested | Runbook §13 |

## 11. Operating tasks

| Cadence | Task |
|---|---|
| Daily | Nothing — the workflow runs and alerts on failure |
| Weekly | Confirm the drill run is green (Actions → Backup → Weekly restore drill) |
| Monthly | `npm run backup:verify -- --latest --download`; confirm the run summary shows a growing object count |
| Quarterly | Restore one private file via `restore-r2.mjs` into a scratch bucket and confirm it is not public |
| Every 6 months | Run the production restore drill (runbook §13); review the secret escrow; rotate the R2 backup token |
| On rotation | Update the GitHub secret, then trigger the workflow manually to prove it still works |

## 12. Limitations, stated plainly

1. **No production restore has been performed.** The tooling and the repository's schema are proven; production data is not. This is the single largest remaining gap.
2. **Media restore is untested end to end.** Listing and comparison run against real buckets; an actual copy round-trip has not been executed because it would write to a production bucket.
3. **Up to 24 hours of data can be lost** (no PITR).
4. **The age private key is a single point of failure.** Two offline copies are mandatory; the runbook covers it.
5. **The backup bucket is created by an operator**, not by the tooling — R2's S3 API cannot create buckets.
6. **A new Supabase schema outside the exclude list can make `pg_dump` fail.** That is a loud failure (the run goes red and emails), not a silent one; add the schema to `BACKUP_EXCLUDE_SCHEMAS`.
7. **Restoring an old dump resurrects sessions revoked after it was taken.** The runbook requires clearing `auth_sessions` after a restore.
