# Deployment and migrations

One workflow runs through every environment: write the migration locally, merge
to `main` for staging, then promote to production with an approved release.
Staging migrates itself; production migrates during its approved release.

## 1. Local

Add one timestamped migration file under `supabase/migrations/`, later than the
baseline, then apply it to the running isolated stack:

```sh
npm run db:migrate:local
```

The command only accepts the loopback development stack from
`.local/development`. Test the schema and the app with it before pushing. Never
edit a migration that has already been applied anywhere; add another file.

## 2. Merge to main: staging is automatic

A merge to `main` runs CI and the **Deploy isolated staging** workflow. It:

1. validates the staging manifest and isolation tests,
2. writes the private manifest from the `staging` environment,
3. verifies the database secrets,
4. plans pending migrations (`staging-db.mjs plan`),
5. applies them (`staging-db.mjs migrate`),
6. deploys staging.

The wrapper refuses the production project, so only the independent staging
database can be touched. Manual dispatch of the workflow remains available for
re-runs, but no manual migration step is expected.

Required `staging` environment secrets: `STAGING_CONFIGURATION`,
`CLOUDFLARE_STAGING_API_TOKEN`, `CLOUDFLARE_STAGING_ACCOUNT_ID`,
`STAGING_DATABASE_PASSWORD`, `STAGING_SUPABASE_ACCESS_TOKEN`.

If SQL was ever applied to staging by hand, record the version in its ledger
before the next run, or the pipeline will try to apply it again:

```sh
supabase migration repair --status applied <version> --project-ref <staging-ref>
```

## 3. Production: manual, approved release

Production never deploys on merge. Run **Deploy to Cloudflare** from `main` and
type `confirmation=DEPLOY_PRODUCTION`; the workflow releases the exact `main`
SHA selected at dispatch and waits on the `Production` environment. Its order is:

1. credential guards, build, type check and unit tests,
2. pending migrations: `db push --dry-run`, refuse if the baseline or unknown
   remote history is pending, then `db push --yes`,
3. deploy the realtime and web Workers,
4. run the realtime smoke tests.

Migrations use the single `SUPABASE_DB_URL` secret (the session-pooler Postgres
URI); the pinned CLI version comes from `supabase/cli-version`. The one-time
baseline ledger adoption and its protection DDL were completed on 2026-11-03.

The release also re-applies `scripts/r2-cors.json` to the media bucket
(`R2_BUCKET_NAME`). Showcase videos are uploaded straight from the browser to
R2, so the bucket must answer the CORS preflight; without a policy R2 returns
403 and the composer only shows "Network error during upload" (images are
proxied through the Worker and keep working). Replacing the media bucket does
not carry its CORS policy over — the deploy step is what makes a new bucket
usable for video uploads.

The workflow never adopts, repairs or replays the ledger; see
[database baseline](database-baseline.md) and
[database adoption review](database-adoption-review.md).

## Migration rules

- Additive and backward compatible (expand/contract): the currently deployed
  app must keep working during the migration and after a failed release.
- Destructive drops belong in a later release, after the new code is live.
- Applies are forward-only. Never edit an applied file; add a new timestamped
  one.
- No hand-applied SQL in staging or production. The only exceptions are a
  recorded recovery step or the one-time ledger adoption, with the version
  repaired and evidence kept.

## Rollback

A failed code release can roll back safely while migrations follow the additive
rule. Schema changes are not rolled back automatically. Production has no PITR;
take and verify a full dump before any production schema operation and keep the
migration ledger export beside it.

## Related

- [Running isolated environments](environments.md)
- [Production-derived Supabase baseline](database-baseline.md)
- [Production adoption safety review](database-adoption-review.md)
- [Fresh application initialization](database-initialization.md)
