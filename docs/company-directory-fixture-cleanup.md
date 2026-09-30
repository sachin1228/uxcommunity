# Removing the Acme counter-example fixture from production

**Date:** 2026-09-30 · **Scope:** production (`eauupthwlnarkauwifmw`) · **Rows removed:** 2
(one company, one domain claim) · **Rows modified besides those:** 0.

## Why this existed

`data/company-directory/curated.json` keeps `acme-technologies-example` on purpose: it is
the counter-example that documents rules like "a name that merely looks like a domain
proves nothing". The committed 1,000-company prototype import (2026-09-29) shipped it,
because the generator had no notion of a non-production record.

The pipeline is fixed (`FIXTURE_SOURCES` / `isProductionRecord()` in
`scripts/generate-company-directory-v2.mjs`): records whose `source` is `example` are
filtered before anything is merged, and a build fails if a fixture ever reaches the
export. The regenerated 4,576-company candidate contains no example rows.

That fix cannot remove a row that is already in the database, and the importer never
deletes (`docs/company-directory-architecture.md`). The existing production row was
therefore removed by a deliberate, guarded, one-off transaction, recorded here.

## The rows that were removed

Company (deleted row, verbatim):

```json
{"id":"8cc3ecae-45ab-5608-abfe-4c54b05ac3e6","name":"Acme Technologies","slug":"acme-technologies-example","logo_url":null,"created_by":null,"is_active":true,"created_at":"2026-09-29T22:05:27.802551+00:00","updated_at":"2026-09-29T22:05:27.802551+00:00","country_code":"IN","industry":"unknown","entity_status":"unknown","source":"example","source_id":null,"jurisdiction":"IN","source_confidence":null,"directory_rank":21,"last_checked_at":null}
```

Domain claim (deleted row, verbatim):

```json
{"id":"9849a71e-178a-4545-8392-1f482f5fd17f","company_id":"8cc3ecae-45ab-5608-abfe-4c54b05ac3e6","domain":"acmetech.io","verified":false,"verified_at":null,"created_at":"2026-09-29T22:05:27.802551+00:00","domain_type":"primary_website","evidence_confidence":"unknown","source":"example","first_seen_at":"2026-09-29T22:05:27.802551+00:00","last_checked_at":null}
```

## Guards checked before the delete

All inside the same transaction, each one `raise exception` on failure, so a mismatch
would have rolled the whole cleanup back:

* the row still had `source = 'example'` and `created_by is null` (the untouched fixture,
  not a company a member created);
* exactly one domain claim was attached, and it was `acmetech.io`, `verified = false`;
* zero references from `company_members`, `company_email_verifications` (by `company_id`,
  `domain_owner_company_id` or the domain), `company_domain_delegations`,
  `company_domain_reviews`, `designer_profiles`, `company_aliases`, `domain_evidence` or
  `company_relationships`;
* `DELETE` of the company affected exactly one row.

Every FK into `companies` was also inventoried first; the only tables that could have held
a reference were the nine above, and all were empty for this id.

## Effect

| Table | Before | After |
| --- | --- | --- |
| companies | 1,000 | **999** |
| company_domains | 1,009 | **1,008** |
| domain_evidence | 40 | 40 |
| company_aliases | 31 | 31 |
| company_relationships | 17 | 17 |
| company_members | 1 | 1 |
| company_email_verifications | 5 | 5 |
| verified claims | 1 | 1 |

The verified claim (`hdfc-bank` / `hdfcbank.com`, verified_at `2026-09-30 06:33:15.490393+00`)
and its membership are byte-identical after the cleanup; both were out of scope by
construction (the cleanup touched one company and one domain row).

## Re-run dry run (after the cleanup)

`node scripts/import-company-directory.mjs --dry-run data/company-directory/prototype`
against production, one transaction, rolled back:

* **staged:** 4,576 companies / 4,586 domains / 38 evidence / 31 aliases / 17 relationships, 0 rejected
* **before:** 999 companies / 1,008 claims / 1 verified / 40 evidence
* **after (projected):** 4,576 companies / 4,586 claims / 1 verified / 40 evidence / 31 aliases / 17 relationships
* **guards:** `skipped_verified_claims = 1`, `skipped_member_companies = 0`,
  `unresolved_companies = 0`, `ambiguous_company_matches = 0`, `companies_that_changed_slug = 0`
* **coverage:** production now holds **zero** companies and **zero** domain pairs that the
  export does not contain; the only production claim the import declines to touch is the
  HDFC proof (`skipped_verified_claims`), by design
* post-run production counts are unchanged by the dry run (the transaction rolled back)

## Note

This was a one-off operator cleanup, not committed tooling. If it must be repeated, run it
as a guarded transaction against the exact slug, and re-run the dry run afterwards; the
invariant to restore is "production holds no row the export does not contain, except the
claims a member has proved".

The leftover unlogged staging tables from the 1k import (`_company_directory_stage` and
friends, 7 tables) were not touched by the cleanup or the dry run.

## Import executed (2026-09-30)

The committed import ran right after, on this same candidate:

```
node scripts/import-company-directory.mjs data/company-directory/prototype
```

exit 0, 19.4 s, one transaction committed. Report: `/tmp/uxc-prod-import.json`
(machine-readable, kept for this session only).

* **staged:** 4,576 companies / 4,586 domains / 38 evidence / 31 aliases / 17 relationships, **0 rejected**
* **before:** 999 companies / 1,008 claims / 1 verified / 40 evidence
* **after:** **4,576 companies / 4,586 claims / 1 verified / 40 evidence / 31 aliases / 17 relationships**
* **guards:** `skipped_verified_claims = 1`, `skipped_member_companies = 0`,
  `unresolved_companies = 0`, `ambiguous_company_matches = 0`, `companies_that_changed_slug = 0`

Post-import verification:

* the whole `after` block equals the dry-run projection, field for field;
* the HDFC proof is byte-identical (`hdfc-bank` / `hdfcbank.com`, `corporate_email`,
  `curated`, verified_at `2026-09-30 06:33:15.490393+00`, confidence `low` as the layer states)
  and its `company_members` row is untouched — same user, same `joined_at`;
* forensic check that the proof row was never written: its tuple's `xmin` is `190423`
  (12 transactions older), while everything the import wrote — the `google.com` claim,
  the `hdfc-life` row, and even the `hdfc-bank` *company* row — carries `xmin` `190435`,
  the import transaction;
* 0 companies with `source = 'example'`, 0 rows for `acmetech.io`;
* 0 duplicate companies, 0 duplicate domains, 0 orphan aliases/relationships/evidence;
* `company_members` still 1 and `company_email_verifications` still 5 — the import never
  touches either table;
* the unlogged staging tables were refreshed to the new load
  (`_company_directory_stage` 4,576, `_company_domain_stage` 4,586, evidence 38, aliases 31,
  relationships 17) and now hold this import's rows.

A further `--dry-run` after the import reports `before` equal to `after`
(4,576 / 4,586 / 1 verified / 40 evidence), so a second import would change no row:
**the load is idempotent on production.**
