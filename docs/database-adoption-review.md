# Production adoption safety review — no production operations performed

Reviewed `docs/database-baseline.md` against the current baseline and pinned CLI.
The baseline file remains unchanged. No production SQL, connection with write
permissions, ledger read/repair, deployment or production adoption occurred.

| Finding | Resolution / remaining gate |
| --- | --- |
| `ADD COLUMN IF NOT EXISTS` could silently accept the wrong definition | Removed IF NOT EXISTS; run only if absent. Existing exact Boolean/NOT NULL/default true is verified, otherwise stop. |
| Uniqueness preflight can race with signups | Treat it as informational; the concurrent unique index is the final arbiter. Preserve NULLs and all users; never deduplicate automatically. |
| Concurrent build inside a transaction/pool can fail or leave invalid index | Require direct/session connection, separate top-level command, bounded timeouts and validity/shape inspection. Never hide an invalid index with IF NOT EXISTS. |
| Partial SQL failure could be followed by later adoption steps | Require `psql -X -v ON_ERROR_STOP=1`; every failed block stops. Attach only a verified complete index under short lock timeout. |
| A syntactically valid arbitrary baseline digest was accepted | Ledger block now requires the exact SHA-256 of this reviewed baseline. |
| Blind ledger DELETE could discard racing migrations | Freeze deploys, secure complete ledger export, approve canonical row digest, lock ledger and verify that digest in the same transaction before replacement. Reject baseline/later entries. |
| History could be replaced before protections existed | Transaction rechecks exact column and valid unique-constraint contracts. Complete read-only schema/ACL/RLS/routine comparison remains a prerequisite, never replaced by those two guards. |
| Stale or forward-migrated comparison artifact could be used | Require a verified artifact for this exact baseline revision and `--exact`; refresh production metadata and review every difference during the approved operation. |
| Baseline DDL could run on populated production | Adoption inserts a comment-only ledger record; it never executes baseline SQL. Prohibit baseline, db push/reset/repair and test fixtures on production. The baseline's empty-public guard is an extra defense, not permission to run it there. |
| Metadata replacement is irreversible after commit without backup | Require a secured, verified restorable ledger export and database backup, rehearse restore, document rollback boundary and separate approval. |
| Future migrations could replay history | Single active directory, immutable baseline, all filenames validated; new files strictly later than baseline. Pinned CLI and pending-list inspection after adoption; local CI rehearses baseline-ledger adoption and a forward migration. |

Remaining operator responsibilities: confirm the actual target identity and
approved revision; arrange the deployment freeze and backups; refresh the live
read-only comparison; resolve concurrent/invalid-index states; schedule locks
and monitor scans; explicitly approve protection DDL and separately approve
ledger replacement. These cannot be inferred from a passing disposable test.
The stored snapshot is dated 31 October 2026, not a live adoption-time guarantee.

No initialization is needed on existing production. Merging this repository-only
workflow does not alter its schema/history. No baseline migration should be run
there before merging. The two missing protections and history adoption remain a
separate approved production operation.
