# Retiring the seeded company directory

The 4,574 companies in `20260929140000_company_directory.sql` were a **bootstrap
set**: real names so the "Where do you work?" picker was not an empty box on day
one, each with one unproven website domain. They are not the production
directory. The production directory is a ~500,000-company dataset loaded from a
generated CSV export by `scripts/import-company-directory.mjs`, with registry
identity and provenance the bootstrap list never had.

This document is the audit of what those rows are, the exact transition that
removes them, and the evidence that it cannot take anything else with it.

- Migration: `supabase/migrations/20260929153000_company_directory_seed_retirement.sql`
- Generator: `scripts/generate-company-directory-removal.mjs` (`npm run companies:retire`)
- Tests: `supabase/tests/company_directory_seed_retirement.test.sql` (42 assertions)
  and `scripts/generate-company-directory-removal.test.mjs` (12).

---

## 1. The audit: how the 4,574 rows were created

| Step | Migration | What it wrote |
| --- | --- | --- |
| 1 | `20260929120000_company_verified_domains.sql` | Created `companies`, `company_domains`, `company_members`, `company_email_verifications`, `company_slugify()`. **No rows.** |
| 2 | `20260929130000_company_directory_hints.sql` | Taught the RPCs what an unverified hint means. **No rows.** |
| 3 | `20260929140000_company_directory.sql` | The seed: one `companies` row per Wikidata entity (`insert into public.companies (name, slug)`, no `created_by`) and one `company_domains` row per domain (`verified = false`). 4,574 + 4,574 rows. |
| 4 | `20260929150000_company_domain_stewardship.sql` | Added the columns (`source`, `source_id`, `domain_type`, `evidence_confidence`, …). **No rows.** |
| 5 | `20260929151000_company_directory_backfill.sql` | Attributed exactly the seeded domains: `company_domains.source = 'wikidata-p856'`, `domain_type = 'primary_website'`, `evidence_confidence = 'unknown'`, and the same provenance on the companies. |

### The markers, and whether they are reliable

| Marker | Set by | Reliable? |
| --- | --- | --- |
| `companies.created_by is null` | only the seed leaves it null; **every** member-created company sets it (`insert into public.companies (name, slug, created_by)` in `confirm_company_verification`) | yes, and it is the guard that matters |
| `companies.slug = company_slugify(name)` | the seed computed the slug with that same immutable function | yes, but not sufficient on its own (a member's company can share the slug — the seed inserts `on conflict (slug) do nothing`, so the member's row wins and the seed's is skipped) |
| `companies.source = 'wikidata-p856'`, `source_confidence = 'unknown'` | the backfill | yes, but nothing else may set it: the check is `source is null or source = 'wikidata-p856'` |
| `companies.source_id is null`, `jurisdiction is null` | never set for a seed row | yes; a registry import sets both |
| `company_domains.source = 'wikidata-p856'`, `domain_type = 'primary_website'`, `evidence_confidence = 'unknown'`, `verified = false` | the backfill | yes, and the `verified = false` part is a guard: a proved domain keeps its company |
| `domain_evidence`, `company_aliases`, `company_relationships`, `company_domain_delegations`, `company_domain_reviews` | nothing — the seed wrote none | yes: **any** row in these tables means somebody else touched the company |

**Measured on a database built from this branch's migrations** (every row of the
real seed, after the backfill):

```sql
select
  (select count(*) from public.companies)                                       as companies,       -- 4,574
  (select count(*) from public.companies where created_by is null)               as unattributed,    -- 4,574
  (select count(*) from public.companies c
     join seed on seed.slug = c.slug)                                           as matched_by_slug, -- 4,574
  (select count(*) from public.companies c
    where c.created_by is null
      and not exists (select 1 from seed where seed.slug = c.slug))              as outside_the_seed,-- 0
  (select count(*) from public.company_domains where source = 'wikidata-p856')   as claims,          -- 4,574
  (select count(*) from public.company_domains where verified)                   as verified,        -- 0
  (select count(*) from public.domain_evidence)                                  as observations,    -- 0
  (select count(*) from public.company_members)                                  as memberships,     -- 0
  (select count(*) from public.company_email_verifications)                      as verifications,   -- 0
  (select count(*) from public.designer_profiles where company_id is not null)   as pointers;        -- 0
```

Every seeded company is matched, no unattributed company falls outside the seed,
and nothing in the database references one. So the rows **are** distinguishable,
and the answer to "can they be identified?" is yes — on two independent anchors
(the seed's own slug list, and "nobody created it").

## 2. The cleanup strategy

A company is removed when **all** of these hold:

1. its slug is in the seed's own list (`company_directory_seed_retired.slug`);
2. `created_by is null` — no member created it;
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
| it carries a claim the seed did not write, a registry identity, or another layer's provenance | `company_domains.source`, `companies.source`, `companies.source_id` | it is no longer only seed data |

Those eight guards are exactly the twelve foreign keys that point at
`companies`. Everything else — the company row and its one unverified website
claim — is bootstrap data and goes.

**What is never done**: no `truncate`, no `drop table`, no `delete` that is not
scoped to the retirement plan, no reliance on `ON DELETE CASCADE`, no row
deleted for disagreeing with another, no `verified` ever written or cleared, and
no user, profile, membership or verification record touched.

### The rows that are kept are reported, not swallowed

`public.company_directory_seed_retained` lists every seeded company a guard
stopped, with the reason (`member_joined`, `member_verification`,
`member_profile_points_at_it`, `owns_a_verified_domain`, `carries_observations`,
`operator_reviewed`, `delegation_names_it`, `claim_the_seed_did_not_write`,
`another_layer_owns_it`, `has_a_registry_identity`). Expected to be empty. When
it is not, each row is an operator decision — typically reconcile it with the
imported entity of the same name — and never a silent deletion.

## 3. The SQL, exactly

`20260929153000_company_directory_seed_retirement.sql` (generated, ~192 KB):

1. `create table public.company_directory_seed_retired (name, domain, slug, retired_at)`
   — the seed's own (name, domain) list with `slug` computed by the database's
   `company_slugify`, RLS on, `revoke all from anon, authenticated`. This is the
   durable record of what was retired and the identification for everything else.
2. `company_directory_seed_retirement_plan()` — **the dry run**, read-only,
   per company: `disposable` plus the reason and the counts behind it.
3. `company_directory_seed_retained` — a view over that function, filtered to the
   rows that are kept.
4. `retire_company_directory_seed(p_dry_run boolean default false)` — the
   removal. `true` returns counts without deleting. The `false` path deletes, in
   order and with a row count each: `company_domains`, `domain_evidence`,
   `company_aliases`, `company_relationships`, `company_domain_delegations`,
   `company_domain_reviews`, then `companies` (scoped to the plan **and**
   `created_by is null`).
5. A `do` block that calls it once and raises a notice with the counts, plus a
   warning when `company_directory_seed_retained` is not empty.

One thing to know about the migrations as they stand, and a decision to confirm:
`20260929140000` is **not** edited or reverted. Migrations are immutable here,
and an environment that already applied the seed is unaffected by editing it
while a fresh environment would silently lose history. Instead the retirement
runs after it, so **the migration history converges**: a database that applies
the seed and then this file ends in the same state as one built after the seed is
gone. The retired table is what tells the two apart afterwards.

## 4. Execution order

```
1.  review           select * from public.company_directory_seed_retirement_plan();      -- read-only
                     select * from public.company_directory_seed_retained;               -- expected: 0 rows
2.  back up          pg_dump the companies tables (or rely on §5: nothing referenced is removed)
3.  deploy           apply migrations in filename order: …150000 → 151000 → 152000 → 153000
4.  verify           the notice: "company directory seed retired: 4,574 companies, 4,574 claims, 0 dependent rows removed"
                     the queries in §6
5.  import (separate) npm run companies:import:dry   … then the real load
```

Steps 1 and 4 are the same read-only queries, so the operator sees the same
numbers before and after. Step 5 is a **separate operation** (§8): between step 3
and step 5 the directory is legitimately empty, which is why the two belong in
the same maintenance window.

## 5. Rollback and recovery

The retired rows are recoverable **from the repository**, not from a backup:

```
psql "$DATABASE_URL" -f supabase/migrations/20260929140000_company_directory.sql
psql "$DATABASE_URL" -f supabase/migrations/20260929151000_company_directory_backfill.sql
```

This is lossless **for exactly the rows the retirement removes**, because
"nothing references it" is the condition for removing it: there is no membership,
profile pointer, verification, review, delegation or observation to re-link. The
re-created companies get new `id`s and the same slugs and domains, which is what
the picker searches on.

What is *not* recoverable by re-running the seed is a row the retirement
**kept** — but it was not deleted, so nothing is lost there either.

The `do` block is one transaction: a failure at any statement rolls the whole
transition back, and re-running is safe because every delete is scoped to a plan
that is empty the second time. A dry run (`retire_company_directory_seed(true)`)
is available at any point, including after the transition.

## 6. Validation queries

```sql
-- Nothing from the seed survives as a live directory row.
select count(*) as live_seed_companies
from public.companies as c
join public.company_directory_seed_retired as r on r.slug = c.slug
where c.created_by is null;                                        -- expect 0

-- Nor does its provenance, as a claim.
select count(*) as seeded_claims from public.company_domains
where source = 'wikidata-p856';                                    -- expect 0

-- The record of what was retired is complete and untouched by reruns.
select count(*) as recorded from public.company_directory_seed_retired;   -- expect 4574

-- Nothing is kept because nobody could decide; each row here is a decision.
select * from public.company_directory_seed_retained;               -- expect 0 rows

-- Application data is intact (compare against the pre-deploy counts).
select
  (select count(*) from public.users)                            as users,
  (select count(*) from public.designer_profiles)                as profiles,
  (select count(*) from public.company_members)                  as memberships,
  (select count(*) from public.company_email_verifications)      as verifications,
  (select count(*) from public.company_domains where verified)   as verified_domains;

-- No claim or observation is left pointing at a deleted company.
select count(*) as orphan_claims
from public.company_domains as cd
left join public.companies as c on c.id = cd.company_id
where c.id is null;                                                -- expect 0

select count(*) as orphan_observations
from public.domain_evidence as e
left join public.companies as c on c.id = e.company_id
where c.id is null;                                                -- expect 0
```

## 7. Expected before/after counts

Measured on a scratch database built from this branch's real migration history —
schema, every migration in order, seed included — by applying the retirement and
reading the counts it reports, then querying the tables:

| | Before | After | Note |
| --- | --- | --- | --- |
| `companies` | 4,574 | **0** | every one of them was seed |
| `company_domains` | 4,574 | **0** | one unverified website claim each |
| `domain_evidence` | 0 | 0 | the seed wrote none |
| `company_members` | 0 | 0 | no member had joined a seeded company |
| `company_email_verifications` | 0 | 0 | none |
| `designer_profiles.company_id` | 0 | 0 | none |
| `company_domain_reviews` / `company_domain_delegations` | 0 | 0 | none |
| `company_directory_seed_retired` | — | 4,574 | the record |
| `company_directory_seed_retained` | — | **0** | nothing was referenced |
| notice | — | `retired: 4574 companies, 4574 claims, 0 dependent rows removed; 0 seeded companies remain` | |

On a **production** database the numbers can differ in one direction only: if a
member has used a seeded company, that company is retained (and reported) and its
claim survives with it. `select count(*) from public.company_directory_seed_retained`
before deploying is the number that says how many — and it must be understood
before step 3, not after.

## 8. Why unrelated production data cannot be deleted

1. **The identification is two independent anchors**, not a heuristic: the seed's
   own slug list (generated from the seed migration, so the two files cannot
   disagree) and `created_by is null`.
2. **Every possible reference is a guard**, and the list is exhaustive: it is the
   twelve foreign keys that point at `public.companies`
   (`designer_profiles`, `company_domains`, `company_members`,
   `company_email_verifications` ×2, `domain_evidence`, `company_aliases`,
   `company_relationships` ×2, `company_domain_delegations` ×2,
   `company_domain_reviews`). Six of them are the tables of this very
   architecture; the other three hold application data and stop the removal.
3. **The deletes name their tables** instead of leaving it to `ON DELETE
   CASCADE`, and the `companies` delete repeats `created_by is null` where it
   runs.
4. **The function refuses the whole transition** (`seed_retirement_would_touch_member_data`)
   if a row the plan called disposable turns out to be referenced between the
   plan and the delete.
5. **Nothing else is touched**: no `truncate`, no `drop`, no write to `verified`,
   no update to any other table.
6. The generator's test asserts the delete list is exactly those seven tables and
   that `company_members`, `company_email_verifications`, `designer_profiles` and
   `users` never appear in a `delete`.

## 9. Why the 500k import remains a separate operation

Nothing in this transition loads data. The import is
`scripts/import-company-directory.mjs`, run by hand against a connection string,
and it is deliberately not a migration: a 500,000-row migration costs ~1.8 GB of
server memory, cannot be partially applied, and rolls back entirely on one bad
row (`docs/company-directory-architecture.md` §9).

What the importer does before it commits anything — and the reason it can be
reviewed at all — is the **dry run**, which stages the export, validates it, and
rolls back:

```bash
npm run companies:import:dry                       # CSV → staging → validation → rollback
PGHOST=… PGDATABASE=… node scripts/import-company-directory.mjs --dry-run <dir>
```

It reports, per export: **input rows** (per file and total), **unique
companies**, **duplicate companies**, **unique domains**, **duplicate domains**
(a domain two companies claim) and duplicate rows, **companies without a domain**,
**claims with no evidence behind them** (`domains_without_sufficient_evidence`),
**rejected rows** by reason, and **ambiguous or unresolved identity matches** —
plus which optional feeds were supplied, and the counts before and after the
staged merge. A rejected row, an unresolved company or an ambiguous identity
match fails the run (`exit 1`) rather than loading quietly.

The load itself: CSV → unlogged staging → one set-based merge, deterministic
UUIDv5 ids, idempotent, refusing any row that claims `verified = true` and
skipping anything a member proved or created. It reports `verified_after` so a
run that accidentally verified something is visible immediately; it must be 0.
`company_aliases.csv` and `company_relationships.csv` are optional feeds — the
generator does not emit them yet — and when supplied they are loaded with the
same guards (typed, rejected if either end is missing, never attached to a
company a member created).

Measured on the 1,000-company prototype export against a scratch database:

```
staged:  1000 companies, 1009 domains, 38 evidence, 0 rejected
dataset: 1000 unique companies, 0 duplicates, 1009 unique domains, 0 duplicate domains,
         1 company without a domain, 983 claims with no evidence behind them
after:   1000 companies, 1009 claims, verified_after 0
```

Those 983 are the honest number: this is a website layer, and a proof at one of
those domains establishes domain control only (see the promotion threshold in
`docs/company-directory-architecture.md` §6).
