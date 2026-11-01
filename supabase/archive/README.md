# Inactive SQL backup

`legacy-sql.tar.gz` is a reference-only backup of the former migration directories,
partial schema, seeds, reset operation, and one-off repair. It is outside migration
discovery and must never be extracted into `supabase/migrations` or executed by the
new workflow. The baseline and fresh-database tests do not read this archive.

Current production metadata is the source for the new baseline. This archive is
not a migration ledger, an installation prerequisite, or a reconciliation plan.
