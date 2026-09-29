# Resetting the company directory

The company directory starts **empty**. The 4,574 companies the v1 seed wrote were
a **bootstrap set** — real names so the "Where do you work?" picker was not an
empty box on day one, each with one unproven website domain — and they are not the
production directory. The production directory is a ~500,000-company dataset
loaded from a generated CSV export by `scripts/import-company-directory.mjs`, with
registry identity and provenance the bootstrap list never had.

This document is the audit of how those rows came to exist, what was removed from
the repository, the one operation that removes them from a database that already
has them, and the evidence that it cannot take anything else with it.

- Operation: `supabase/reset/company_directory_seed_reset.sql` (generated) — **NOT
  a migration**, see §4.
- Runner: `scripts/reset-company-directory-seed.mjs` (`npm run companies:reset:plan`,
  `npm run companies:reset`).
- Generator: `scripts/generate-company-directory-reset.mjs` (`npm run companies:reset:sql`).
- Tests: `supabase/tests/company_directory_seed_retirement.test.sql` (52 assertions)
  and `scripts/generate-company-directory-reset.test.mjs` (15).

---

## 1. The audit: what the old state was, and what is left of it

| Step | Migration | What it did | Where it is now |
| --- | --- | --- | --- |
| 1 | `20260929120000_company_verified_domains.sql` | Created `companies`, `company_domains`, `company_members`, `company_email_verifications`, `company_slugify()`. **No rows.** | kept |
| 2 | `20260929130000_company_directory_hints.sql` | Taught the RPCs what an unverified hint means. **No rows.** | kept |
| 3 | `20260929140000_company_directory.sql` | **The seed**: one `companies` row per Wikidata entity (`insert into public.companies (name, slug)`, no `created_by`) and one `company_domains` row per domain (`verified = false`). 4,574 + 4,574 rows. | **deleted from the repository** |
| 4 | `20260929150000_company_domain_stewardship.sql` | The stewardship schema: typed claims, `domain_evidence`, aliases, relationships, delegations, registry identity, the rewritten RPCs. **No rows.** | kept |
| 5 | `20260929151000_company_directory_backfill.sql` | Attributed exactly the seeded claims: `source = 'wikidata-p856'`, `domain_type = 'primary_website'`, `evidence_confidence = 'unknown'`, plus the same provenance on the companies. | **deleted from the repository** |
| 6 | `20260929152000_company_domain_review.sql` | The operator review queue. **No rows.** | kept |
| 7 | `20260929153000_company_directory_seed_retirement.sql` | The earlier "retire the seed" **migration** — the version of this operation that ran as a side effect of `db push`. | **moved out of `supabase/migrations/`** into `supabase/reset/`, rewritten (§4) |

Also removed with them: `scripts/generate-company-directory.mjs` (the v1
generator, whose only output was migration 3) and
`scripts/generate-company-directory-backfill.mjs` + its test (whose only output was
migration 5). Deleting a migration file deletes no rows — see the note below.

**The v1 seed's data survives as data, not as a migration.** The seed's own
4,574 (name, website domain) pairs are committed as
[`data/company-directory/seeds/wikidata-p856.json`](../data/company-directory/seeds/wikidata-p856.json),
the seed layer the v2 pipeline has always built the directory from. It was exported
from migration 3 before that migration was deleted, and the two were verified equal
at the commit that deleted it (4,574 names and 4,574 domains, zero rows on either
side of the difference). One file now serves both purposes: the seed layer for the
directory build, and the list of rows this operation removes.

### Do not confuse "the migration is gone" with "the rows are gone"

A migration file is instructions; it is not the database. A database that already
applied migration 3 still holds the 4,574 rows, and deleting the file does not
touch it. That is the whole reason this operation exists, and it is why the two
paths are separate:

| Database | State after this change | What to do |
| --- | --- | --- |
| A **fresh** database (local `db reset`, a new Supabase project, CI) | Applies migrations 1, 2, 4 and 6 → `companies` 0, `company_domains` 0, claims 0, evidence 0. Nothing to reset. | nothing |
| A database that **already ran the seed** (production today) | Still holds the 4,574 rows. | run the reset (§3) |

Measured on a database built from this repository (`scripts/…` in §7): companies
**0**, `company_domains` **0**, `domain_evidence` **0**, aliases **0**,
relationships **0**, delegations **0**, reviews **0**, members **0**, verifications
**0** — the seed layer's 4,574-row record is not written by any migration, only by
the operation.

## 2. Production, measured (2026-09-30)

Read from the project with the Supabase tooling, read-only:

```sql
select (select count(*) from public.companies)                                -- 4574
     , (select count(*) from public.companies where created_by is null)        -- 4574
     , (select count(*) from public.company_domains)                           -- 4574
     , (select count(*) from public.company_domains where verified)            -- 1
     , (select count(*) from public.company_members)                           -- 0
     , (select count(*) from public.company_email_verifications)               -- 2
     , (select count(*) from public.designer_profiles where company_id is not null); -- 0
```

Three facts decide how the transition goes:

1. **Only migrations 1, 2 and 3 are applied.** `companies` has no `source`,
   `source_id` or `jurisdiction` column, so migration 4 has not run, and none of
   the tables migration 4 creates exist. **The reset cannot run before migration
   4**, because it plans against those tables; the generated SQL says so with
   `seed_reset_needs_stewardship_schema` instead of failing with a Postgres
   "relation does not exist".
2. **One domain is proved**: `uber.com`, `verified_at 2026-09-29 14:15:52Z`,
   on the seeded company `Uber` (`created_by` null), with **0** members and **0**
   profile pointers.
3. **Two challenges reference that company** (`work_email
   patilsachin1228@uber.com`, `consumed_at` set on both), by the one account that
   used the flow.

So the honest expectation for the production run is **4,573 removed, 1 retained**
— `uber` — and not 4,574 removed. The one retained row is a proof's outcome, and a
directory transition may not delete that; §5 says what to do with it.

### The production run, as applied (2026-09-30)

Run against the linked project with `supabase db query --linked`, in this order:

| Step | Result |
| --- | --- |
| `-f 20260929150000_company_domain_stewardship.sql` | applied; `companies` 8 → 17 columns, the four stewardship tables created, no rows changed |
| `-f 20260929152000_company_domain_review.sql` | applied; `company_domain_reviews` created |
| `-f supabase/reset/company_directory_seed_reset.sql` | the record table + plan + guarded removal defined; **no rows deleted** |
| plan | `recorded 4574`, `would_remove 4573`, `retained 1` — `uber` / `uber.com` / `member_verification` / `verified_claims 1` / `verifications 2` |
| `retire_company_directory_seed(false)` | **refused**: `seed_reset_retained_rows_present`; nothing deleted |
| `retire_company_directory_seed(p_allow_retained => true)` | `companies_removed 4573`, `claims_removed 4573`, `dependents_removed 0`, `companies_retained 1` |
| after | companies **1**, claims **1**, verified **1**, members 0, verifications **2**, profile pointers 0, **users 8 (untouched)**, orphan claims **0** |
| what is left | `Uber` / `uber` / `uber.com`, `domain_type primary_website`, `evidence_confidence unknown`, `verified true` |
| rerun | `0 / 0 / 0`, retained 1 — idempotent |
| operator follow-up | the one retained row was deleted at the operator's request (it was a **test** proof, see §5): `companies` **0**, claims **0**, verified **0**, verifications **0**, users still 8, orphan claims 0 |

The plan and the removal produced exactly the numbers this document predicted, and
exactly the numbers the local reconstruction of production's state produced
(§5 of this file's history: the same 4,573/1 with the same retained row).

## 3. The operation, and how to run it

```bash
# dry run: prints the plan, deletes nothing (the default)
npm run companies:reset:plan

# the removal. Refuses if any seeded company is still referenced (see below);
# --keep-retained removes only the disposable rows after an operator has looked.
npm run companies:reset                      # = --apply
node scripts/reset-company-directory-seed.mjs --apply --keep-retained
```

The runner applies `supabase/reset/company_directory_seed_reset.sql` (idempotent
DDL plus the seed's own list; it deletes nothing), then:

1. prints the plan — recorded seed size, how many rows are still present, how many
   would be removed, how many are retained, the row counts that would go with
   them (claims, evidence, aliases, relationships, reviews, delegations), and
   every retained row with its reason;
2. **checks every foreign key that points at `companies`** against the guard list.
   A table it does not know about is an *UNEXPECTED DEPENDENCY*, and `--apply`
   stops rather than delete rows it has not accounted for;
3. refuses to apply while a retained row exists, unless `--keep-retained` is
   passed. Nothing is deleted by the refusal;
4. removes the disposable rows, then verifies the result: the set of verified
   domains is compared before and after (it may not move, and may not lose a
   row), and no claim may be left without a company.

Applying the SQL file directly is also supported and equivalent to the dry run —
it defines the operation, it does not perform it:

```sql
select * from public.company_directory_seed_retirement_plan();          -- the plan
select * from public.retire_company_directory_seed(p_dry_run => true);  -- counts only
select * from public.retire_company_directory_seed(p_allow_retained => true); -- the removal
```

The three callables are service-role only, `revoke`d from `public, anon,
authenticated`, and the record table has RLS enabled with no policy.

## 4. Why this is not a migration

The previous version of this transition was migration `20260929153000`, and it
applied itself inside a `do` block: `db push` deleted ~4,574 production rows as a
side effect. Two things are wrong with that shape, and both are why the operation
now lives in `supabase/reset/` instead:

- **a destructive step should be startable by a person, after seeing the plan** —
  a migration runs the moment it is pushed, with no dry run and no gate;
- **it must be able to stop.** A migration that raises leaves the push failed and
  half the sequence unapplied; an operation that refuses just exits non-zero and
  asks a question.

The `supabase/reset/` directory is not read by `supabase db push`, `db reset` or a
new project, which is exactly right: a database built from this repository needs
none of it. `supabase/tests/run-local.sh` applies it when building the test
database, so its own contract is exercised on every test run — and it deletes
nothing there either, which the fresh-database numbers in §1 show.

## 5. What it refuses to remove, and why

A seeded company is removable only when **both** anchors agree and nothing
references it:

1. its slug is in the seed's own list (`company_directory_seed_retired.slug`,
   computed by the database's own `company_slugify`);
2. `created_by is null` — no member created it (`on conflict (slug) do nothing`
   means a member's company that pre-empted a seed name is the surviving row);
3. nothing in the database references it:

| Reference | Table | Why it stops the removal |
| --- | --- | --- |
| a member joined it | `company_members` | application data; deleting it deletes somebody's membership |
| a proof or a pending challenge names it (either as owner or as the recorded steward) | `company_email_verifications` | application data; a code in flight must not be deleted |
| a member's profile points at it | `designer_profiles.company_id` | application data |
| it owns a **proved** domain | `company_domains.verified` | only a proof sets this; a directory transition may not undo one |
| a delegation names it (either side) | `company_domain_delegations` | a reviewed arrangement |
| an operator decided about it | `company_domain_reviews` | an auditable human decision |
| it carries any observation | `domain_evidence` | somebody (or the resolver) looked at it |
| it carries a claim the seed did not write, a registry identity, or another layer's provenance | `company_domains` (a second domain, or a provenance that is neither null nor `wikidata-p856`), `companies.source`, `companies.source_id` | it is no longer only seed data |

Those are exactly the twelve foreign keys that point at `companies` — four in
migration 1 and eight added by the later ones — and the runner re-checks the live
list against them before deleting anything.

**A NULL `company_domains.source` is the seed's own claim, not a missing
attribution.** Migration 5 (the backfill) never ran on production, and it is gone
from the repository, so on every database that applied the seed directly the
claims have no provenance. An earlier draft of this SQL treated "not
`wikidata-p856`" as "somebody else wrote it", which classified **all 4,574**
claims as foreign and made the reset refuse to remove anything. Caught by running
this operation against a reconstruction of production's state, and pinned by an
assertion in the SQL test (a `trustpilot` claim with `source` null must be
disposable).

**Directory structure is not application data.** An alias or a
parent/subsidiary relationship belongs to the company and is removed with it; both
are reported by the plan (`aliases`, `relationships`) so the operator sees what
goes. They are deliberately *not* guards, and the test asserts both directions: a
removable row may carry an alias, a second *claim* keeps the row.

**What is never done**: no `truncate`, no `drop table`, no unqualified `delete`,
no reliance on `ON DELETE CASCADE`, no row deleted for disagreeing with another,
no `verified` ever written or cleared, and no user, profile, membership or
verification record touched. Both the generated file and the runner are tested for
exactly that.

### The rows that are kept are reported, not swallowed

`public.company_directory_seed_retained` lists every seeded company a guard
stopped, with the reason (`member_joined`, `member_verification`,
`member_profile_points_at_it`, `owns_a_verified_domain`, `carries_observations`,
`operator_reviewed`, `delegation_names_it`, `claim_the_seed_did_not_write`,
`another_layer_owns_it`, `has_a_registry_identity`).

On production it listed one row: **`uber` / `uber.com`** — a company whose domain
an account had proved, which is why the operation kept it and refused to run
without an explicit acknowledgement (§3).

That row was then **deleted deliberately, by an operator, because the proof was a
test**: `patilsachin1228@uber.com` was never a real mailbox, so the verification
was a test of the OTP flow rather than a member's employment. The operation itself
must never do this — a proof is not something a directory transition gets to
undo — so it was a separate, scoped statement on that one row, recorded here for
traceability:

```sql
-- measured: 1 company, 1 claim, 2 verification records; nothing else referenced it
-- (0 members, 0 profile pointers, 0 evidence, 0 aliases, 0 relationships,
--  0 delegations, 0 reviews)
delete from public.company_email_verifications
 where company_id in (select id from public.companies where slug = 'uber');
delete from public.company_domains
 where company_id in (select id from public.companies where slug = 'uber');
delete from public.companies where slug = 'uber';
```

The `uber` row in `company_directory_seed_retired` is **kept**: that table records
what the v1 seed contained, not what is live, and `uber` really was one of its
4,574 entries. Deleting it would have made the record lie about the seed.

If the same situation ever arises with a *real* proof, the right move is the one
this operation was built for: keep the company, let the imported `Uber` entity
adopt it by registry identity (`source` + `source_id`, §6), and never delete the
member's proof.

## 6. The 500,000-company import stays separate

Not started, and not part of this change:

- the import is `scripts/import-company-directory.mjs`, a hand-run operation over a
  generated CSV export (`companies.csv`, `company_domains.csv`,
  `domain_evidence.csv`, optional aliases and relationships);
- it has a **dry run** (`npm run companies:import:dry`) that reports input rows,
  unique and duplicate companies, unique and duplicate domains, companies without
  domains, domains without sufficient evidence, rejected rows and ambiguous
  identity matches, and it never commits on the dry-run path;
- it writes `verified = false` always — a row that claims `verified` is rejected —
  so no dataset can become a verified company-domain owner;
- it merges by registry identity (`source` + `source_id` + `jurisdiction`), never
  by name, so it can adopt a company a member created or proved instead of
  duplicating it;
- nothing about it is a migration, and no part of this change adds a dataset to
  the repository.

The reset is not a precondition for the import, and the import is not a
precondition for the reset. The recommended order is: migration 4, migration 6,
then the reset, then the import — so the directory never shows a half-imported
state next to 4,574 bootstrap rows.

## 7. Execution order, rollback, validation

### Order (production)

1. **Back up** (`pg_dump` of `public.companies`, `public.company_domains`,
   `public.company_email_verifications`, `public.designer_profiles`, or the whole
   database — it is small).
2. Apply `20260929150000_company_domain_stewardship.sql`. Additive: new columns
   with defaults, new tables, replaced functions. Measured: **0 errors** applied on
   top of the seeded rows, including the proved `uber.com` claim (its claim gets
   `domain_type = 'primary_website'`, `evidence_confidence = 'unknown'`, which is
   exactly the "weak claim" shape the trust model expects for a directory row).
3. Apply `20260929152000_company_domain_review.sql`.
4. `npm run companies:reset:plan` — read the plan. Expect `would be removed 4573`,
   `retained 1` (`uber`).
5. `npm run companies:reset` — the refusal fires, because of that one retained row.
   Nothing is deleted. This is the gate working.
6. Decide about `uber` (§5), then `node scripts/reset-company-directory-seed.mjs
   --apply --keep-retained`. Expect `companies 4573, claims 4573, dependent rows 0`,
   and afterwards `companies 1`, `company_domains 1`, `verified 1`,
   `verifications 2` unchanged, `orphan claims 0`.
7. Import the dataset, when that phase starts.

### Rollback

Lossless for exactly the rows removed, because "nothing references it" *is* the
removal condition:

```bash
git show <commit>:supabase/migrations/20260929140000_company_directory.sql | psql "$DATABASE_URL"
```

re-creates those companies with the same slugs and the same domains. The claims
come back with the same `domain_type`/`evidence_confidence` defaults the seed
now inherits from migration 4, and the record table still names every row, so the
restored state can be diffed against `company_directory_seed_retired`. Nothing
else is affected: the operation did not touch a row outside the seeded companies.

### Validation queries

```sql
-- 1. What was recorded (the whole seed, whatever the live tables say)
select count(*) from public.company_directory_seed_retired;                    -- 4574

-- 2. What is left to remove, and what is kept and why
select count(*) filter (where disposable) as removable,
       count(*) filter (where not disposable) as retained
from public.company_directory_seed_retirement_plan();
select * from public.company_directory_seed_retained;

-- 3. Nothing outside the seed was touched
select count(*) from public.companies c
 join public.company_directory_seed_retired r on r.slug = c.slug
 where c.created_by is null and c.source_id is null;                           -- 1 (uber)

-- 4. Proofs are intact
select count(*) from public.company_domains where verified;                    -- 1
select count(*) from public.company_email_verifications;                       -- 2
select count(*) from public.company_members;                                   -- 0
select count(*) from public.designer_profiles where company_id is not null;    -- 0

-- 5. Nothing dangles
select count(*) from public.company_domains cd
 where not exists (select 1 from public.companies c where c.id = cd.company_id); -- 0
select count(*) from public.users;                                              -- unchanged
```

### Expected before / after (production)

| Object | Before | After the operation | After the follow-up | Note |
| --- | --- | --- | --- | --- |
| `companies` | 4,574 | **1** | **0** | 4,573 seed rows removed; `uber` kept, then deleted as test data (§5) |
| `company_domains` | 4,574 | **1** | **0** | one claim each |
| claims `verified` | 1 | **1** | **0** | never written or cleared by the operation; the test claim removed with its company |
| `company_email_verifications` | 2 | **2** | **0** | untouched by the operation; the test records removed with their company |
| `company_members` | 0 | **0** | **0** | — |
| `designer_profiles.company_id` | 0 | **0** | **0** | — |
| `users` | 8 | 8 | **8** | never touched |
| `company_directory_seed_retired` | — (created by the operation) | 4,574 | 4,574 | the record of the v1 seed |
| `company_directory_seed_retained` | — | 1 | **0** | `uber`, reason `member_verification` |

## 8. Why unrelated data cannot be deleted

1. **Two independent identification anchors**, both required: the seed's own slug
   list, and `created_by is null`.
2. **Every reference is a guard**, and the guard list is the complete foreign-key
   list — re-checked against the live catalog by the runner before it deletes, with
   an unexplained table stopping the run.
3. **The deletes name their tables** and report a row count each, so the log is the
   evidence.
4. **The `companies` delete repeats `created_by is null`** where it runs.
5. **A belt-and-braces check refuses the whole transition** (`seed_retirement_would_touch_member_data`)
   if a row the plan called disposable turns out to be referenced.
6. **A refusal, not a warning, when anything is retained** — the operation cannot
   quietly delete 4,573 rows while 1 stays, and cannot delete the 1 either.
7. **The runner verifies the result**: the verified-domain set before and after must
   be identical, and no claim may be orphaned. Both are hard failures.
8. **Static checks on the generated file** (in the node test suite): no `truncate`,
   no `drop table public.…`, no `cascade`, no `delete from` any table outside the
   seven named ones, `company_members` / `company_email_verifications` /
   `designer_profiles` / `users` never deleted, and `verified` never written.

## 9. What this does not settle

- **`uber`**: kept by design (§5). It needs a decision about whether the imported
  `Uber` entity adopts the row, or the proof is re-run against the imported one.
- **A second country-scale source** (Companies House, GLEIF) and the country-aware
  identity key: still the next phase, unchanged by this document.
- **The dataset itself**: nothing about the 500k import changes here, and no data
  was added to the repository — only a list of 4,574 rows that are being removed.
