# Company directory architecture

Architecture review, final data model and verification semantics for the
verified-company system, revised so that scaling the data cannot break the
entity model.

Status: **the schema, the verification semantics, the search rewrite and the
import path are SHIPPED** in `supabase/migrations/20260929150000_company_domain_stewardship.sql`
and `…20260929152000_company_domain_review.sql`, with the behaviour pinned
by `supabase/tests/company_domain_stewardship.test.sql` (161 assertions, cases
A–I). The v1 seed's migrations are gone from the repository — the directory is
built from `data/company-directory/seeds/` instead of being seeded by a
migration, and a database that already applied the old seed is reset by one
explicit operation ([company-directory-reset.md](company-directory-reset.md)).
What is still a proposal is the data: no bulk tier has been imported, no licensed
source is wired up, and the prototype still writes only to
`data/company-directory/prototype/`. Every number in §8 and §9 is measured on
the real schema by `scripts/bench-company-directory.sh`.

Related: [company-data-sources.md](company-data-sources.md) (sources and the
licensing matrix), [company-domain-resolution.md](company-domain-resolution.md),
[company-email-domain-resolution.md](company-email-domain-resolution.md),
[company-data-quality.md](company-data-quality.md).

Reproduce everything:

```bash
npm run test:companies-db        # the SQL tests: schema, cases A–I, search, the reset
npm run test:companies-v2        # 47 assertions, incl. the decision table
npm run companies:v2 -- --sample 1000 --sql          # the prototype build
npm run companies:v2 -- --measure                    # the nine staged metrics
npm run companies:reset:sql      # regenerate the reset operation from the seed layer
npm run companies:reset:plan     # the reset's dry run against a real database
npm run bench:companies-directory                    # search + import at 1k…500k rows
node scripts/bench-company-directory-import.mjs --n 500000   # the three storage shapes
```

---

## 1. Two independent pipelines

The single most important structural point: **finding companies and finding
their domains are different jobs with different sources and different failure
modes.** Merging them is what produced the current seed's assumption that a
company's website domain is the domain its employees use.

```
PIPELINE A - company / entity discovery                PIPELINE B - domain evidence
────────────────────────────────────────               ────────────────────────────────
registry + discovery sources                           domain candidates
  Wikidata classes, Companies House,                     from A's website domain, the curator,
  GLEIF LEI, ROR, (SEC for listed issuers)               CT logs, an operator's own records
        │                                                      │
        ▼                                                      ▼
normalise: legal-name handling, country,                 normalise + validate (§3 of
status (active/dissolved/acquired), industry             company-domain-resolution.md)
        │                                                      │
        ▼                                                      ▼
deduplicate (identity keys, merges reported)             classify evidence
        │                                                (first-party / third-party / MX)
        ▼                                                      │
        ▼                                                      ▼
parent/subsidiary/brand graph                            confidence tier per claim
(company_relationships)                                        │
        │                                                      │
        └───────────────► join ◄───────────────────────────────┘
                     domain claims + stewardship resolver
                                 │
                                 ▼
                 company_domains (claims) + domain_evidence (observations)
                                 │
                                 ▼
                     canonical steward per domain, conflict status
                                 │
                                 ▼
            verification (member OTP) - the only thing that changes `verified`
```

Pipeline A never asserts an email domain. Pipeline B never invents a company.
The join is a decision procedure, not a merge: §6.

## 2. The ownership model: stewardship, not "one domain one company"

The earlier draft made "one email domain = one company entity" an architectural
assumption. That is correct only as a statement about **verification**, not
about **ownership**:

| Concept | What it means | Cardinality |
| --- | --- | --- |
| **Claim** | "this domain relates to this company", with a type and evidence. Several companies may hold one. | domain → 0..n claims |
| **Steward (canonical owner)** | the company that answers "whose mailbox is this?" for a domain | domain → 0..1 steward |
| **Verified claim** | a member proved a mailbox on the domain and the claim became true | domain → 0..1 verified claim |
| **Delegation** | an explicit, reviewed statement that company X accepts mailboxes on a domain stewarded by company Y | (company, domain) → 0..n |
| **Relationship** | parent/subsidiary/brand/division | company ↔ company |

A relationship is **structure**. A delegation is **policy about acceptable
mailboxes**. Neither transfers ownership, and neither is ever inferred from the
other. That is what stops "Meta is the parent of WhatsApp" from becoming
"meta.com belongs to WhatsApp", and it is the model the brief asks for: four
entities, four domains, one graph.

### The two questions, answered

**`user@meta.com`, selected company = WhatsApp** → **refused as WhatsApp.**

- whatsapp.com is WhatsApp's; meta.com is Meta's. WhatsApp has no claim on
  meta.com, and a parent/subsidiary relationship does not create one.
- The member is told the domain belongs to Meta Platforms — the steward — and is
  offered to continue with Meta. Doing so creates a **Meta** membership: the
  mailbox is on Meta's domain, so Meta is the company the proof supports.
- It succeeds as WhatsApp in exactly one case: an explicit, **reviewed**
  delegation row exists saying WhatsApp accepts mailboxes on meta.com. Then the
  membership is created **for WhatsApp** while the steward stays Meta
  (the verification records `domain_owner_company_id = meta`), so reports,
  routing and any later dispute still resolve the domain to one entity.
- It never succeeds because the strings are similar, because of MX records, or
  because a relationship exists.

**`user@whatsapp.com`, selected company = WhatsApp** → **normal verification.**
WhatsApp stewards whatsapp.com, the code is sent, and on confirmation the claim
becomes the verified claim: WhatsApp is still the steward, now with a proof.

This is implemented as a pure function in the prototype
(`resolveVerification`) and asserted for every case in §6 and §7.

---

## 3. Audit of the current implementation

Unchanged by this revision; the findings are what motivate the model above.
Measured against the committed seed.

### A. Current company/entity model

`public.companies(name, slug, logo_url, is_active, created_by)`. No country,
industry, status, alias or parent. Identity is name+slug only, so `Alphabet
Inc.` and `Alphabet` are two companies; nothing ranks or traces a row to its
source.

### B. Current domain model

`company_domains(company_id, domain, verified, verified_at, created_at)` with
`unique (company_id, domain)` and a **partial** unique index on `domain where
verified`. So 1→many already works — the schema is not the limitation. What is
missing is what *kind* of domain a row is, and any provenance.

### C. What "verified" means

One thing: a member received a code at a mailbox on that domain and typed it
back. The partial unique index makes that the race boundary, and membership
grants no privilege. Preserved everywhere below.

### D. What a "directory hint" means

After the hints migration, `verified = false` conflates a known-but-unproved
domain, a failed pre-migration claim, and an operator's row. Operationally a
hint only decides which company a proof attaches to. The gap: no provenance and
no strength — a hand-checked domain and a Wikidata P856 value are the same row.

### E. Where a website is treated as an email domain

| Where | Assumption |
| --- | --- |
| v1 generator `buildDirectory` | `domain: domains[0]` — the website's registrable domain is *the* domain |
| v1 generator `reduceDomain` | the canonical site is the mail domain |
| seed migration | exactly one `company_domains` row per company, from the website |
| `search_companies` | the company's "domain" is one value, whatever kind it is |

Measured damage:

- **E1** `DENY_DOMAINS` contains `google.com`, `linkedin.com`, `tiktok.com`,
  `pinterest.com`, `x.com`, `facebook.com`, `instagram.com`, `medium.com`,
  `whatsapp.com`, `wix.com`. Entities whose only P856 domain is denied are
  dropped; five survive only because `REVIEWED` bypasses every gate (Google,
  LinkedIn, TikTok, Pinterest, X), and Facebook, Instagram, Medium and WhatsApp
  are absent. **53 of 4,574 committed rows would be refused by the committed
  generator today: the seed is not reproducible.**
- **E2** bare country-code domains are structurally excluded (`example.de`,
  `example.in`, `example.io`). **47 rows are a bare `name.ccTLD`, all 47 from
  the hand-checked core, zero from the Wikidata layer.**
- **E3** a website is not where mail lives (Alphabet: `abc.xyz`;
  AWS: `aws.amazon.com`; Volkswagen Group: `volkswagen-group.com`).

### F. Can one company have several domains?

Yes, and the prototype uses it: one company, five domain rows, tested. Also
reachable today through `get_company_page`, which already aggregates domains.

### G. Does search/routing handle multiple domains?

Partly: domain search matches verified rows only (correct for routing);
`search_companies` returns one domain chosen by `verified desc, created_at asc`
(arbitrary once hints exist); `company_domain_owner` returns the earliest hint
when nothing is verified (arbitrary at scale); and there is no alias search, so
"Facebook" cannot find Meta and "TCS" cannot find Tata Consultancy Services.

### H. Security implications of many unverified hints

The risk is misdirection, not forgery: a wrong hint makes a real employee's
proof bless the wrong company, because the member selects the company and the
code only proves the mailbox. Controls today: `domain_already_verified` with a
reason, the anti-impersonation name check, and the partial unique index. Gaps:
no member-facing "this mapping is wrong" report; `start_company_verification`
can open a challenge for a domain another company has already verified (failing
later at confirm); competing hints are unbounded; nothing re-checks a domain
after acquisition or resale.

### I. Data quality risks

Name/domain string matching used as a gate (`LOW_TRUST_SITELINKS`) caught real
Wikidata errors but also deleted Google and every bare-ccTLD company; 18 rows
collapse as duplicates; non-employers are present (Wikidata `business` includes
museums and associations); no country/industry/status/rank; 76 rows carry no
region at all.

### J. Migration and backfill

The 4,574 rows are usable as hints; the 53 gate failures are evidence that the
rules and the data have drifted; the model change is additive; and **types and
evidence cannot be backfilled** — nothing recorded where a row came from, so the
honest default is `domain_type = 'primary_website'`,
`source = 'wikidata-p856'`, `source_confidence = 'unknown'`.

---

## 4. Measured state of the prototype

`npm run companies:v2 -- --sample 1000 --sql`:

| Metric | 1,000-company sample | All rows (4,594 in → 4,577 companies) |
| --- | --- | --- |
| Companies | 1,000 | 4,577 |
| Unique domains | 1,009 | 4,587 |
| Website-only domains | 989 | 4,567 |
| high / medium / low email domains | 1 / 4 / 15 | 1 / 4 / 15 |
| Domains with conflicting evidence | 0 | 0 |
| Companies with no email domain of their own | 985 | 4,562 |
| Duplicate entities merged | 18 | 18 |

## 5. Final data model

**Shipped** in `supabase/migrations/20260929150000_company_domain_stewardship.sql`,
applied by the test suite to a database built from this branch's real migration
history. Two deltas against the DDL below, both deliberate:

* **no `entity_key`** on `companies`. §10 lists "country in the entity identity"
  as unresolved, and an identity column nothing reads would be exactly the
  "sounds useful" field this section argues against. `company_slugify` and the
  slug stay the identity until a registry import needs more.
* **three columns on `company_email_verifications`** that the DDL below does not
  show, because it only covers the company tables: `domain_owner_company_id`
  (the steward recorded when the code was sent), `via_delegation` and
  `contested`. They are the audit trail of what the member was told and what the
  domain looked like when the proof was issued; confirm re-validates all three
  rather than trusting them.

Six tables. Each column is here because something reads or writes it; the
justifications are the point of this section. The first five ship in
`20260929150000`; the sixth, `company_domain_reviews`, is the operator's decision
record and ships in `20260929152000` (§6a).

```
companies ──┬─< company_domains >── domain_evidence
            ├─< company_aliases
            ├─< company_relationships >── companies
            ├─< company_domain_delegations >── companies
            └─< company_domain_reviews >── domain_evidence
```

```sql
-- ─── companies ────────────────────────────────────────────────────────────
-- Existing table. Additions only, all nullable except the two enums, because a
-- backfill cannot invent a country or a status and must not fail on a row that
-- has neither.
alter table public.companies
  add column if not exists country_code      text,          -- display + ranking
  add column if not exists industry          text,          -- display + ranking
  add column if not exists entity_status     text not null default 'unknown',
  add column if not exists source            text,          -- which layer made it
  add column if not exists source_confidence text,
  add column if not exists directory_rank    integer,       -- derived, see §8
  add column if not exists last_checked_at   timestamptz;   -- re-check job

-- ─── company_domains: the CLAIM ───────────────────────────────────────────
-- One row per (company, domain). Several companies may claim one domain: an
-- unverified claim is evidence, and a bad seed must not be able to block a
-- legitimate entity or be deleted for disagreeing. Ownership is resolved, not
-- constrained (see the resolver), while VERIFICATION stays unique.
alter table public.company_domains
  add column if not exists domain_type       text not null default 'primary_website',
  add column if not exists evidence_confidence text not null default 'unknown',
  add column if not exists source            text,
  add column if not exists first_seen_at     timestamptz not null default now(),
  add column if not exists last_checked_at   timestamptz;

-- Constraints are replaced rather than added blindly, so this block can be
-- applied on top of a database that already ran an earlier draft of it.
alter table public.company_domains
  drop constraint if exists company_domains_domain_type_check,
  drop constraint if exists company_domains_confidence_check,
  add constraint company_domains_domain_type_check check (domain_type in (
    'primary_website', 'corporate_email', 'subsidiary_email',
    'brand', 'subsidiary', 'regional', 'historical', 'alias'
  )),
  add constraint company_domains_confidence_check check (evidence_confidence in (
    'high', 'medium', 'low', 'unknown'
  ));

-- Exact lookups on hints too, not only on verified rows. Today the only index
-- on `domain` is partial on verified, so `company_domain_owner` sequential-scans
-- (11 ms at 500k rows; 0.04 ms with this).
create index if not exists company_domains_domain_idx
  on public.company_domains (domain);

-- NOTE: the earlier draft proposed a PARTIAL UNIQUE INDEX on unverified rows
-- (`where not verified`) so that only one company could hold a hint per domain.
-- That is withdrawn: it turns a data opinion into a schema constraint, freezes
-- a bad seed in place, and cannot represent the contested claims this model
-- exists to record. Conflicts are data; the resolver names the steward.

-- ─── domain_evidence: the OBSERVATIONS ────────────────────────────────────
-- Why not `company_domains.evidence_count` + `source_url`: a claim's confidence
-- is a function of MANY observations, each with its own URL, kind and time. A
-- count cannot be re-checked, cannot be audited, and drifts the moment one of
-- its rows is retired. This is the table a re-check job writes to, the one a
-- correction points at, and the reason the claim row does not need to store
-- what it was derived from.
create table if not exists public.domain_evidence (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,               -- the claim this supports
  domain        text not null,
  evidence_type text not null,               -- ranked in company-email-domain-resolution.md
  source_url    text,                        -- where it was seen (first-party wherever possible)
  source        text,                        -- the layer/source id it came from
  checked       boolean not null default false,  -- has anyone actually opened it
  observed_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint domain_evidence_domain_key unique (company_id, domain, evidence_type, source_url)
);
create index if not exists domain_evidence_domain_idx on public.domain_evidence (domain);
create index if not exists domain_evidence_company_idx on public.domain_evidence (company_id);

-- ─── company_aliases: search names ────────────────────────────────────────
create table if not exists public.company_aliases (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  alias      text not null check (char_length(btrim(alias)) between 1 and 120),
  alias_type text not null default 'alias' check (alias_type in (
    'alias', 'former_name', 'brand', 'abbreviation', 'transliteration'
  )),
  source     text,
  created_at timestamptz not null default now(),
  constraint company_aliases_company_alias_key unique (company_id, alias)
);

-- ─── company_relationships: structure ─────────────────────────────────────
create table if not exists public.company_relationships (
  id                uuid primary key default gen_random_uuid(),
  parent_company_id uuid not null references public.companies (id) on delete cascade,
  child_company_id  uuid not null references public.companies (id) on delete cascade,
  relationship_type text not null check (relationship_type in (
    'parent', 'subsidiary', 'brand', 'division', 'acquired_company', 'former_name'
  )),
  source            text,
  source_url        text,
  created_at        timestamptz not null default now(),
  constraint company_relationships_unique unique (parent_company_id, child_company_id, relationship_type),
  constraint company_relationships_not_self check (parent_company_id <> child_company_id)
);
-- (Tables are `create table if not exists`, so re-applying this block is safe:
-- the tables are skipped and only the columns/indexes below are re-asserted.)

-- ─── company_domain_delegations: acceptable mailboxes ─────────────────────
-- The one mechanism that lets a subsidiary's staff verify on a parent's
-- domain, and it is deliberately NOT a company_domains row: a delegation must
-- never be able to create a second verified claim on a domain, so it lives
-- outside the claim table entirely.
create table if not exists public.company_domain_delegations (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade, -- who may verify
  domain             text not null,                        -- on whose domain
  granted_by         uuid not null references public.companies (id) on delete cascade, -- the steward
  evidence           jsonb not null default '[]'::jsonb,
  review_status      text not null default 'unreviewed' check (review_status in (
    'unreviewed', 'reviewed', 'rejected'
  )),
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  constraint company_domain_delegations_unique unique (company_id, domain),
  constraint company_domain_delegations_not_self check (company_id <> granted_by)
);
```

### Fields deliberately *not* added

| Field | Why not |
| --- | --- |
| `company_domains.evidence_count` | derivable from `domain_evidence`, and a derived count in a mutable table drifts silently |
| `company_domains.source_url` | the same: evidence rows carry URLs, one per observation |
| `company_domains.verified_by` | verification is a member action recorded on the membership and the challenge; a second actor column invents a reviewer role the product does not have |
| `company_domains.conflict_status` | a property of the set of claims on a domain, not of one row — two copies would disagree |
| `company_domains.superseded_at` | derivable: an unverified claim on a domain with a verified claim *is* superseded |
| `companies.parent_company_id` | a column cannot express a company that is both a parent and a subsidiary, nor a relationship that ends; the relationships table can |
| `companies.email_domains` (array) | duplicates the claim table and removes the per-domain columns the resolver needs |
| a separate `email_domains` table | `company_domains` with `domain_type` already IS that table; a second one would duplicate the unique indexes that make ownership enforceable |
| `retire_competing_hints()` (previous draft) | withdrawn with the hint unique index: there is nothing to retire, and `superseded` is derived by the resolver rather than stored |

`company_domains` ends up with: `company_id`, `domain`, `domain_type`,
`verified`, `verified_at`, `evidence_confidence`, `source`, `first_seen_at`,
`last_checked_at` (plus the existing `id`/`created_at`). Every one of them is
read by the picker, the resolver, the re-check job or the report.

### Applied, tested, and what the tests pin

The DDL above is a migration now. It applies cleanly to a database built from
this branch's real migration history, and
`supabase/tests/company_domain_stewardship.test.sql` (127 assertions) holds it to
the model: several claims on one domain coexist; the only partial unique index
is the one on verified rows; two equally strong claims resolve as `contested`
rather than picking a winner; the resolver's steward is a proof, then the
strongest claim, then a contest; a proof supersedes a rival claim without
deleting it; a verified claim cannot be duplicated; a relationship creates no
claim; the refusal reasons are the ones the route speaks; and the backfill's
guards (idempotent, never verifies, never touches a proved claim) hold on real
rows.

---

### Entity identity: a registry number, not a name

A company's identity is the registry's own identifier where one exists:

```
source       the registry           (companies_house, gleif, wikidata, …)
source_id    that registry's id     (company_number, LEI, QID, …)
jurisdiction where the id applies   (GB, US-DE, …)
```

`(source, source_id)` carries a **partial unique index**, so the same legal entity
cannot be inserted twice under two names — and a company that is *renamed* updates
in place instead of appearing twice. There is deliberately **no unique index on a
name**: names are shared, and two same-named companies in two jurisdictions are
two companies.

That rule is enforced in three places, not one:

| Where | Rule |
| --- | --- |
| the database (`20260929150000`) | partial unique index on `(source, source_id) where source_id is not null`; no unique index on `(name)` |
| the pipeline (`mergeDuplicates`) | registry identity first; then a **jurisdiction-scoped** name key. Two rows whose names match but whose known jurisdictions differ are never merged, and a name match never overrides two *different* registry identities |
| the importer | matched by `(source, source_id)` first and by slug second; it reports `companies_matched_by_registry_identity`, `unresolved_companies` and `ambiguous_company_matches`, and **fails the run** if a staged company resolves to zero or to two live rows |

The slug stays a public handle: an import never rewrites an existing row's slug,
so a rename does not silently change a company's URL.

## 6. Verification semantics (the decision table)

The executable form of this table is `resolveVerification` in the prototype and
the assertions in `supabase/tests/company_domain_stewardship.test.sql` (161
assertions) and `supabase/tests/company_verified_domains.test.sql` (118). Every
row states the outcome, the status code the route should return, and what has to
change in SQL.

**The promotion threshold comes first.** A proof promotes an existing claim only
when that claim's own evidence is `high` or `medium`
(`public.company_confidence_meets_threshold`). Against a `low` or `unknown` claim
— every one of the 4,574 seeded rows — a correct code returns
**`domain_control_only`**: the observation is recorded as `domain_evidence`
(`source = 'member_domain_control'`, deliberately excluded from the resolver's
weighting), the challenge is consumed, and **no claim becomes verified and no
membership is created**.

Why that is the right line: a mailbox proves *control of the domain*. It cannot
prove that the directory mapped that domain to the right company, and if it
could, then whichever wrong seed row exists would become verified company
ownership for the first person to sign up at that domain. The failure mode this
prevents is exactly:

```
directory says   Company A  ←  abc.com     (confidence: unknown)
reality          Company B  ←  abc.com
someone selects Company A, holds user@abc.com, enters the code
  → domain control recorded, Company A NOT verified   (the mapping is unproven)
```

The route between a guess and a verified company is a **review**, not a code:
a person (or the evidence resolver) checks the mapping and lifts the claim's
evidence to `medium`, and from then on the mailbox proof promotes it. The
`member_domain_control` rows are the queue for that review, and the queue, the
decision and its audit trail are **shipped** in `20260929152000` — §6a. What is
still missing is the operator *screen* over it, not the mechanism.

| # | Situation | Outcome | Status / behaviour | SQL change needed |
| --- | --- | --- | --- | --- |
| **A** | Selected company's domain is **verified** by it | verify as selected | OTP; membership for that company | none |
| **B** | Selected company's domain is its own **unverified claim** with `high`/`medium` evidence | verify as selected | OTP; on success the claim becomes verified, this company becomes steward | none |
| **B′** | Selected company's domain is its own **weak claim** (`low`/`unknown`) — the shape of all 4,574 seeded rows | **domain control only** | OTP; `domain_control_only`; the observation is recorded, nothing is verified, no membership | **yes**: the threshold check in `confirm_company_verification` |
| **C** | Domain is **verified by another company** | refuse, offer the owner | `domain_already_verified` with the owner in `detail` | **yes**: `start_company_verification` must check a verified owner first. Today it can open a challenge that only fails at confirm with `domain_not_verified` |
| **D** | Domain has **conflicting unverified claims** (no proof) | the strongest claim wins the steward; a proof from that claimant verifies, a proof from a weaker one is domain control only | OTP; conflicting claims stay as evidence and are reported `superseded` | **yes**: record the contest in the challenge detail; never delete a competing claim |
| **E** | Domain belongs to the **parent**, member is at the parent | verify as selected | normal path | none |
| **F** | Domain belongs to the **parent**, member selected the **subsidiary** | refuse unless a **reviewed delegation** exists; with one, verify as the subsidiary and record the steward | `domain_unclaimed_by_selected` (`reason: not_a_company_domain`) or `verify_via_delegation` | **yes**: the delegations table plus checks in `start`/`confirm`; the verification records `domain_owner_company_id` |
| **G** | Domain is **not in the directory** | create path | name must relate to the domain; then A/B apply | **yes** (with H) |
| **H** | Member **creates a new company** | create + verify | `company_name_taken` if the name exists; `domain_already_verified`/join if a **medium+** claim or a **same-name** claim exists; a **weak, unrelated** claim does not block, and is superseded by the proof | **yes**: today *any* hint reserves the domain (`reason: reserved`), which at 500k hints would block real companies |
| **I** | Domain was verified, then the **relationship changed** (acquisition, split, resale) | the verified claim stays with its owner until an operator reassigns it; after reassignment the new entity re-proves and memberships are untouched | operator workflow | **yes**: `entity_status` + `reassign_company_domain`, which un-verifies the old claim, retires it (`operator_reassignment_retired` evidence, so it stops competing for the steward) and records why |

Invariants that hold across every row:

1. Only a proof changes `verified`. No dataset, delegation or relationship does.
2. A domain has at most one **verified claim** (`company_domains_verified_domain_idx`),
   hence one steward once proved.
3. A **delegation never creates a claim**: it changes which entity the member's
   membership belongs to, while the domain keeps its steward.
4. A **relationship never transfers a domain**.
5. Claims are never deleted for disagreeing; the resolver reports a steward or
   marks the domain contested. Retirement is a *derived* state (a proof elsewhere,
   or an operator's reassignment), never a delete.
6. Only a claim whose evidence is `high` or `medium` can be promoted by a proof.
   `low` and `unknown` claims are searchable and selectable, and they establish
   domain control only.

### What an import may touch on a row that is somebody's

The importer guards its merge with two different columns, and the difference is
not an oversight:

| Table | Guard on an existing row | Why that column |
| --- | --- | --- |
| `companies` | `created_by is null` | the row is the member's company; an import owns directory rows, not people's companies |
| `company_aliases` | `created_by is null` (on the company) | an alias changes what a company is CALLED in search — structure the member did not ask for |
| `company_relationships` | `created_by is null` (on both ends) | a relationship asserts who owns whom, which is a claim about the member's company, not about a domain |
| `company_domains` | `verified = false` | a claim is directory DATA about a domain; the member's protection here is the proof, which is strictly stronger |
| `domain_evidence` | nothing to guard | an observation is only ever ADDED, or has `checked`/`observed_at` refreshed; it is the provenance of a claim, so it follows that claim |

**A domain claim and its evidence MAY land on a company a member created.**
That is what "adopt the member's row instead of duplicating it" requires
([company-directory-reset.md](company-directory-reset.md) §6): the importer
recognises a company by registry number or by slug, and when the slug is one a
member already created, attaching the directory's claims to that row is the only
alternative to creating a second company or dropping the fact. It is safe because
of three properties, each of which is load-bearing:

1. **A claim never verifies.** The statement hard-codes `verified = false`, and a
   CSV row that claims otherwise is refused outright.
2. **The member's own claim is always verified.** Every claim a member path
   creates sets `verified = true, verified_at = now()` at the moment of proof
   (`member_verification`), so it is already out of an import's reach — there is
   no member-authored unverified claim for an import to overwrite.
3. **A proof always outranks a directory claim.** If a directory claim competes
   with a proof — on the same company or on a different one — the proof stays the
   steward and the rival claim is recorded `superseded`, never deleted
   (invariant 5).

An alias or a relationship, by contrast, has no equivalent proof to defer to: it
would silently rename a member's company in search results, or state that their
company is owned by someone. Those are refused, and the import's own report counts
them (`skipped_member_companies`, `skipped_member_relationships`).

## 6a. The promotion policy, and the review queue that implements it

**Shipped** in `supabase/migrations/20260929152000_company_domain_review.sql`,
held to its own rules by `supabase/tests/company_domain_review.test.sql` (40
assertions).

### The policy (this is the whole of it — there is no scoring formula)

| Claim evidence | What it means | What a correct OTP at that domain does | How the claim becomes eligible |
| --- | --- | --- | --- |
| `high` | first-party evidence a person or the resolver checked | **promotes** the claim: `verified` + membership | already eligible |
| `medium` | reviewed external/registry evidence, checked | **promotes** | already eligible |
| `low` | one observation, or supporting-only evidence (MX, CT) | `domain_control_only`: observation recorded, nothing verified, no membership | operator review + evidence that meets the gate |
| `unknown` | nothing observed — **every one of the 4,574 seeded rows** | `domain_control_only` | operator review + evidence that meets the gate |

Two rules produce that table, and neither is a threshold anyone tuned:

1. **Only evidence about the mapping may raise a claim's strength.**
   `member_domain_control` — the proved-mailbox observation — is excluded from
the resolver's weighting *and* from the promotion gate. It is a true statement
about a mailbox that is equally true of the right company and the wrong one, so
it can never be the reason a claim becomes eligible.
2. **Only a proved mailbox ever writes `verified`.** Not a reviewer, not an
importer, not a relationship, not an MX record (`company_domains.verified` has
exactly one writer in the codebase, and a test asserts the review path never
sets it).

### The state machine

```
member proves a mailbox on a domain
        │
        ├── the claim's evidence is high/medium ────────────► VERIFIED
        │                                                     (company_domains.verified,
        │                                                      membership created)
        │
        └── the claim's evidence is low/unknown
                   │
                   │ domain_evidence(work_email_otp,
                   │                 source = 'member_domain_control', checked)
                   ▼
            domain_control_only ──► operator review queue
                                        │
                  ┌─────────────────────┼───────────────────────┐
              promote                 reject            needs_more_evidence
                  │                     │                       │
     evidence_confidence →            nothing changes:        nothing changes;
     high (or medium) — no            claim and evidence      the item stays
     verified, no membership          exactly as they were     queued
                  │
      a later proved mailbox ──────────────────────────────► VERIFIED
```

### What the queue shows, and what it deliberately refuses

`company_domain_review_queue(limit)` returns the domains a member has proved a
mailbox on whose claim is still too weak to act on, with the claim's confidence,
the observation count and window, and the last decision. Three exclusions make it
a worklist rather than a landfill:

* a **verified** claim is not a candidate;
* a domain **somebody else has already proved** is not a promotion — it is the
  `reassign_company_domain` path (§6, case I), and offering it here would only
  produce a claim that can never be verified;
* a **rejected** item returns only when *new* evidence has arrived after the
  rejection, and `needs_more_evidence` stays queued. A rejection is an answer to
the evidence that existed, not a verdict on the future.

### The decision

`review_company_domain(domain, company_id, reviewer_id, decision, reason,
confidence, evidence_id)`. One call, one row, one effect:

| Decision | Effect |
| --- | --- |
| `promote` | the claim's `evidence_confidence` becomes `high` (or `medium`), and the review itself is recorded as a checked `operator_review` observation. `verified` stays false and no membership is created |
| `reject` | one row is written; the claim, its confidence and every observation are untouched |
| `needs_more_evidence` | one row is written; the item stays queued |

Refusals are **returned as a status**, not raised, so the operator sees the
reason instead of a stack trace: `no_claim`, `domain_verified_elsewhere`,
`needs_evidence` (no checked non-OTP observation exists), `already_promoted`,
`already_verified`.
Six conditions are raised as exceptions because they are caller bugs rather than
review outcomes: `reviewer_required`, `unknown_reviewer`, `reason_required`,
`invalid_decision`, `invalid_confidence`, `invalid_domain`.

### Why a review cannot become a second, softer verification

| Guarantee | Enforced by | Asserted |
| --- | --- | --- |
| `promote` never writes `verified` | the function's only claim write is `evidence_confidence` + `last_checked_at` | yes |
| one domain still has at most one verified owner | `company_domains_verified_domain_idx` is not touched by the review path | yes |
| the OTP observation can never promote the claim it created | `company_domain_evidence_supports_promotion` refuses `source = 'member_domain_control'` and refuses unchecked rows | yes — promoting a queued item with no other evidence returns `needs_evidence` and changes nothing |
| no evidence is ever deleted | reject/`needs_more_evidence` write exactly one row; the observation count is unchanged afterwards | yes |
| a promotion on a domain another company proved is refused | `domain_verified_elsewhere`; moving a domain is the operator reassignment, with its own audit trail | yes |
| a reviewer cannot edit a claim a proof has already finished | `already_verified`, returned before any write: a finished claim's confidence and observations are the proof's outcome, not the reviewer's to revise | yes (a second review adds no `operator_review` observation to a proved claim) |
| delegation rules are not bypassed | the review path writes no delegation and creates no claim on another company's domain | yes (the delegation suite) |
| company identity is not changed | nothing in `20260929152000` writes `companies` | by construction |
| every decision is attributable | `reviewer_id` **not null** → `users`, `reason` 3–1000 chars, `created_at`, and `before`/`after_confidence` so the audit is not reconstructed from logs | yes |
| no client role can review | `revoke all … from public, anon, authenticated` + `grant execute … to service_role` on the function, the queue and the table; RLS on with no policy | yes (`has_function_privilege`, `has_table_privilege`) |

**Service-role only, on purpose.** There is no reviewer role, no permission
model and no admin UI in this PR: the queue and the decision are callable by the
service role, which in this stack means an operator-run script or the Supabase
dashboard — never a client session. Promotion is therefore an accountable
operator action, and `company_domain_reviews` is where it is accounted for.

**What it does not do.** No bulk promotion, no auto-promotion from an evidence
count, no ranking of queue items by anything but recency, and no "trust score".
The evidence resolver (§12.3) may *add* `first_party_*` observations; a person
still decides whether a claim is eligible, and their reason is stored.

## 7. Meta / Facebook / Instagram / WhatsApp, domain by domain

The prototype's curated layer carries four entities and four domains:

| company | id | website | own claim rows | relationship |
| --- | --- | --- | --- | --- |
| Meta Platforms | `meta-platforms` | meta.com | meta.com, fb.com | parent of the three below |
| Facebook | `facebook` | facebook.com | facebook.com | `brand` of Meta Platforms |
| Instagram | `instagram` | instagram.com | instagram.com | `subsidiary` of Meta Platforms |
| WhatsApp | `whatsapp` | whatsapp.com | whatsapp.com | `subsidiary` of Meta Platforms |

Asserted by the test suite ("Meta, Facebook, Instagram and WhatsApp are four
entities and four domains"), which checks all 12 company×domain combinations:

| domain | may verify as | and every other of the four gets |
| --- | --- | --- |
| meta.com | Meta Platforms | `domain_unclaimed_by_selected` naming Meta as steward |
| facebook.com | Facebook | the same, naming Facebook |
| instagram.com | Instagram | the same, naming Instagram |
| whatsapp.com | WhatsApp | the same, naming WhatsApp |

Plus: WhatsApp does not carry meta.com, Meta does not carry any subsidiary
domain, and the shipped delegation list is **empty** — no arrangement here has
been evidenced, and inventing one is the inference the model forbids. A
delegation is exercised in the tests with a fixture, and it is only effective
when `review_status = 'reviewed'` and evidence exists.

Note the alias rule that makes this safe: Meta's `former_names`
("Facebook Inc.") are **search-only**, so they cannot merge the Facebook brand
entity into Meta Platforms. Identity keys come from the name and true aliases;
former names and brands are search names.

## 8. Search and ranking

**Shipped** in `20260929150000_company_domain_stewardship.sql`:
`public.search_companies` is a `UNION ALL` of four arms — name, slug, alias,
verified domain — instead of one `OR` across all of them, plus the `(is_active,
name)` browse ordering index, trigram indexes on `companies.name`,
`companies.slug` and `company_aliases.alias`, a `text_pattern_ops` index for
short prefixes over `lower(name)`, and a plain btree on `company_domains.domain`
for exact lookups (the only index before was the partial one on verified rows).

Measured on the real schema, the real function and the real importer, median of
five, `shared_buffers = 128MB` (`npm run bench:companies-directory`, which prints
the whole table and the plans):

| Query | 1,000 | 10,000 | 100,000 | 500,000 |
| --- | --- | --- | --- | --- |
| Browse (empty query) | 0.29 ms | 0.26 ms | 0.27 ms | **0.33 ms** |
| Exact domain lookup | 0.32 ms | 0.36 ms | 0.35 ms | **0.35 ms** |
| Two-character prefix `lu` | 0.58 ms | 0.58 ms | 0.64 ms | **0.55 ms** |
| Name substring `lumen` | 0.99 ms | 3.70 ms | 28.0 ms | **68.8 ms** |
| Broad substring `ent` | 0.68 ms | 6.06 ms | 17.4 ms | **116.5 ms** |

(Re-measured for this revision; the broad-substring case moves by a few percent
run to run at 500,000 rows.)

(The earlier numbers in this document's history were measured against an empty
table — the import never committed, see §9 — so they were fiction. These are
measured with the tier's rows in the table, and `live_rows` is asserted per tier
so that it cannot silently happen again.)

**How the substring arms hold their shape.** Two changes did most of the work,
and both come from the same trap:

- Every arm is bounded (`limit v_max`) and ordered **inside itself**. A branch of
  a `UNION ALL` with no limit of its own has to produce every match before the
  outer `LIMIT` can discard anything, so a 5%-common term made the whole search
  cost 5% of the directory: 64 ms for `lumen` and 153 ms for `ent` at 100,000.
- The substring arms are ordered by **where the match is** — `strpos(lower(name),
  term)`, then name — rather than by name. Ordering by name forces the plan to
  walk the name index and throw rows away until it finds its 25; measured at
  500,000 rows that path costs 185 ms for a term whose matches sit late
  alphabetically, against 82 ms for the bitmap the trigram index can serve.
  `strpos` is deterministic (so the 25 that survive do not depend on the plan)
  and ranks a name *starting* with the term above one that merely contains it,
  which is the better answer anyway.

All six arms plan with no unbounded sequential scan at any tier; the plans are
printed by the benchmark, including whether a `Seq Scan` is under a `Limit`
(bounded, and often the cheaper plan for a common term) or not.

**What this does not fix, stated plainly.** A term like `ent` still matches a
large share of the directory, and a search that must look inside every name pays
for the matches it finds: 115 ms at 500,000 rows. The picker's interactive path
is protected by the ≤2-character prefix rule and the client's debounce, so the
common case (typing a company's name) is 0.5–3 ms and a *selective* substring is
tens of milliseconds. Closing that last gap needs a different data structure —
a lexeme/word index (full-text search, or a `word_start` trigram arm) — and it is
listed in §12 as next-phase work rather than claimed here. The synthetic name
pool is 20×20×10 words, so `lumen` and `ent` are deliberately pathological:
"matches 5%/25% of the directory".

A term shorter than three characters is treated as a **prefix**, never a
substring: a two-letter trigram matches everything, so `%ab%` cannot be
index-backed and would read the whole directory on every keystroke. Prefix
matching over `lower(name)` can be, and is.

`directory_rank` is written by the import path, not computed here: evidence-
bearing companies first, then confidence, then notability, with `rank_basis` so
nobody reads a rank as a company size. The inputs that would make ranking mean
something (employee count, entity status from a registry) arrive with the
registry layers.

## 9. Storage strategy at 500,000 rows

Two measurements, because they answer different questions: which **shape** to
use (the bench below), and how the shape that was chosen actually **performs**
(the real importer).

**These are synthetic performance benchmarks.** The rows are invented; they
answer "does the schema, the query and the loader scale", and they say nothing
about the coverage, accuracy or email-domain evidence of a real 500,000-company
dataset. The real-dataset figures come from the generator over the layer files
(`npm run companies:v2 -- --measure`), which at the time of writing covers 4,586
entities and is honest about how few of them have mail-domain evidence.

**A bug this measurement caught, worth recording.** Until this revision the
import path reported success and committed nothing: the statement list ended
`…))
commit;` with no semicolon, so PostgreSQL read `commit` as a *column alias*
for the preceding `select json_build_object(…)`, executed the select, and left the
transaction open — psql exits 0, the connection closes, the transaction rolls
back. Every "8.7 ms browse at 4,574 rows" and "46.5 s for 500,000" number this
document previously carried was measured against a table that the load never
filled. Two things now stop it: the `;`, and an assertion in the benchmark that
the rows the load reported are visible from a second connection before anything
is timed (`live_rows`, printed per tier).

The shapes, at 500,000 companies + 500,000 claims + 100,000 evidence rows
(`node scripts/bench-company-directory-import.mjs --n 500000`, scratch schema
dropped after):

| Strategy | Generation | Load | Index build | Output size | Client peak RSS | Server memory during load |
| --- | --- | --- | --- | --- | --- | --- |
| **A** giant SQL migration (one `INSERT ... VALUES` per table) | 1.2 s | **24.1 s** | 3.8 s | **170 MB** | 264 MB | **+1,759 MB** (peak 1,930 MB) |
| **B** CSV + `\copy`, ids allocated by the generator | 0.4 s | **13.6 s** | 3.9 s | 122 MB | 7 MB | not isolated (streams) |
| **C** CSV → UNLOGGED staging → one set-based merge | 0.4 s | 15.6 s | 3.6 s | **71 MB** | 7 MB | **+234 MB** (peak 248 MB) |

**Chosen: C, with B's deterministic ids**, and it is shipped as
`scripts/import-company-directory.mjs` (company ids are UUIDv5 of the slug under
a frozen namespace, so re-importing updates rows instead of duplicating them).
Measured end to end on the real schema, including the script's own validation
and `psql` start-up (`npm run bench:companies-directory`):

| Tier | Companies | Claims | Evidence | Import | Idempotent re-run | Verified afterwards |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 1,000 | 1,000 | 200 | **96 ms** | 299 ms | **0** |
| 10,000 | 10,000 | 10,000 | 2,000 | **0.78 s** | 1.34 s | **0** |
| 100,000 | 100,000 | 100,000 | 20,000 | **8.1 s** | 11.9 s | **0** |
| 500,000 | 500,000 | 500,000 | 100,000 | **66.2 s** | 156.9 s | **0** |

Read the 500,000-row pair as "tens of seconds, not minutes", not as exact: the
same code measured **53.0 s / 186.5 s** on an earlier run and **66.2 s /
156.9 s** on this one, a spread of about ±25% on a shared machine. What is not
noisy is the shape — a first load and a re-run both stay in the tens of seconds,
and `verified` is 0 at every tier.

The re-run cost is the price of company identity: every staged row is matched by
`(source, source_id)` first and by slug second, and every claim goes through a
guarded upsert. It is a batch job that runs to a schedule, not a request path,
and it is the property that makes a retry safe.

The re-run is slower than the first load because every row goes through a
guarded upsert; it is also the proof that a second run changes nothing (the
bench asserts the counts are identical). Zero verified rows at every tier is the
point: the importer **refuses** a row whose export says `verified = true`, never
writes `verified` itself, never updates a claim a member has proved, and never
touches a company a member created.

Why not a migration: a single 170 MB statement costs ~1.8 GB of server memory
and 24 s of CPU, cannot be partially applied, cannot be resumed, and one syntax
error at row 499,999 rolls back everything. And the repository no longer carries
a seed migration at all: the 4,574-row bootstrap set is data (the seed layer),
and the operation that removes it from a database that already has it is
deliberately outside `supabase/migrations/` so a push cannot run it
([company-directory-reset.md](company-directory-reset.md)).

At 500k, **71 MB does not belong in git either.** The repository carries the
pipeline, the reviewed core (thousands of rows) and the id/alias files; a bulk
tier is published as a versioned artifact alongside its licensing record (§11).
Generator memory is the other number in view: building 500k rows in memory used
**530 MB of node heap**, so the generator should stream rows to disk above ~100k.

## 10. Staged measurement plan (1k → 10k → 50k → 100k)

No coverage is projected from the 1,000-company prototype. Every stage is
measured with `npm run companies:v2 -- --sample N --measure`, which prints the
nine figures below, and only measured stages are quoted.

| Stage | Unlocked by | Status |
| --- | --- | --- |
| **1,000** | today's layers (Wikidata website layer + curator) | **measured** |
| **10,000** | a discovery layer beyond Wikidata — UK Companies House (OGL, 5.5M registrations) or GLEIF (2.5M entities) behind the website resolver | not yet measured |
| **50,000** | two or more registries + the first-party evidence resolver for email domains | not yet measured |
| **100,000** | as above at full fetch budget, plus the re-check job | not yet measured |

The nine metrics, per stage: companies · unique domains · website-only domains ·
high-confidence email domains · medium-confidence email domains ·
low-confidence email domains · domains with conflicting evidence · unresolved
companies · duplicate entities merged. Measured at 1,000 (and at the full
current input):

| Metric | 1,000 sample | all 4,594 input rows |
| --- | --- | --- |
| companies | 1,000 | 4,577 |
| unique domains | 1,009 | 4,587 |
| website-only domains | 989 | 4,567 |
| high-confidence email domains | 1 | 1 |
| medium-confidence email domains | 4 | 4 |
| low-confidence email domains | 15 | 15 |
| domains with conflicting evidence | 0 | 0 |
| unresolved companies (no email domain of their own) | 985 | 4,562 |
| duplicate entities merged | 18 | 18 |

Read honestly, that says: today's supply is one website layer plus 20 curated
entities, and **no percentage of email-domain coverage can be claimed from it**.
The previous draft's "10–25%" extrapolation is withdrawn; the yield of the
evidence resolver is an open question until stage 10k is measured.

### Every figure the sample report needs, and which half supplies it

The figures split in two, and mixing them would be how a stage report starts
lying. The **layer half** is a property of the input files and is printed by
`npm run companies:v2 -- --sample N --measure` (plus the full
[coverage report](../data/company-directory/prototype/coverage-report.md)). The
**runtime half** only exists once real members use the product, so it comes from
[company-directory-metrics.sql](../scripts/company-directory-metrics.sql), which
is read-only and safe to run against production:

```bash
npm run companies:v2 -- --sample 10000 --measure     # layer half
psql "$DATABASE_URL" -f scripts/company-directory-metrics.sql   # runtime half
```

| Figure | Half | Where |
| --- | --- | --- |
| total companies | layer | `stagedMetrics` |
| unique domains | layer | `stagedMetrics` |
| companies with a website domain | layer | coverage report |
| companies with ≥ 1 candidate email domain | layer | coverage report (`Companies with at least one email domain`) |
| high-confidence email domains | layer | `stagedMetrics` |
| medium-confidence email domains | layer | `stagedMetrics` |
| low-confidence email domains | layer | `stagedMetrics` |
| unknown-confidence claims | layer | coverage report (per-confidence rows) |
| domains with conflicting evidence | layer | `stagedMetrics` (`domains with conflicting evidence`) |
| companies with multiple email domains | layer | coverage report (`Companies with more than one email domain`) |
| duplicate entities merged | layer | `stagedMetrics` |
| parent/subsidiary relationships | layer | coverage report (`Parent/subsidiary/brand relationships`) |
| brand relationships | layer | coverage report, filtered by `relationship_type` |
| domains requiring operator review | runtime | `domains_pending_operator_review` |
| domains verified by actual users | runtime | `domains_verified_by_members` |
| `domain_control_only` events | runtime | `domain_control_only_events` |
| verification failures | runtime | `verification_failures_expired` (+ `challenges_open`) |
| review decisions (promote / reject / defer) | runtime | `review_promotions` / `review_rejections` / `review_needs_more_evidence` |

Measured against a scratch database that had the 4,574-row seed applied, right
after the attribution migration that has since been removed from the repository
— an application of the stewardship schema to a populated directory, which is
also the production-safety assertion that nothing was promoted by it (33 figures,
then the queue). Those numbers were reproduced for the reset with production's
own state: see [company-directory-reset.md](company-directory-reset.md) §2–3.

| Metric | Value | Why it is the expected one |
| --- | --- | --- |
| `companies_total` | 4,574 | the seed, unchanged |
| `companies_with_registry_identity` | 0 | no registry layer is wired up yet (§12) |
| `domain_claims_primary_website` | 4,574 | the backfill typed every seeded row as a website claim |
| `domain_claims_unknown` | 4,574 | and left every one of them at confidence `unknown` |
| `domain_claims_verified` / `domains_verified` | 0 / 0 | **the backfill cannot verify: nothing was promoted** |
| `domains_with_multiple_verified_owners` | 0 | the invariant held through a real 4,574-row apply |
| `verified_memberships` | 0 | no member data exists in a scratch database |
| `domains_pending_operator_review` | 0 | nothing has been proved yet, so the queue is correctly empty |

## 11. Licensing

Full matrix in [company-data-sources.md](company-data-sources.md), rendered from
`data/company-directory/sources.json` and
`data/company-directory/licensing.json`. The answer that matters for a public
repository:

| Source | Committable here |
| --- | --- |
| Wikidata (CC0) | yes |
| ROR (CC0) | yes |
| Companies House (OGL v3.0) | yes, with attribution, company-level facts only (no officer personal data) |
| SEC EDGAR (US government work) | yes for extracted facts, not whole filings |
| Common Crawl / DNS / CT logs | yes for **domain** facts, never addresses, people or page text |
| GLEIF LEI | conditional: re-read the live terms before a tier ships |
| Tranco | yes with citation; Cisco Umbrella list under Cisco's terms |
| OpenCorporates (ODbL share-alike) | **no** |
| Crunchbase / ZoomInfo / data brokers | **no** |
| Email-intelligence APIs, people-search and breach corpora | **no**, and never used |

## 12. What is already correct, what must change, what is unresolved, and the next PR

### Already correct — keep it

- The OTP trust model: a proof is the only thing that verifies a domain, and
  membership grants no privilege.
- `company_domains` being 1→many, with the partial unique index on verified rows
  as the race boundary.
- The separation of *hint* from *proof*, and that domain search never matches
  hints.
- Domain normalisation living in one place shared by server and client.
- The reviewed-core idea (a small hand-checked set that beats bulk data), and the
  generator/committed-data workflow — it is what makes review possible at all.

### Shipped in this PR — the production foundation

1. **Schema** (§5): typed claims, `domain_evidence`, aliases with `alias_type`,
   relationships, delegations, `country_code`/`industry`/`entity_status`/
   `source`/`source_confidence`/`directory_rank`/`last_checked_at` on companies,
   the full index on `domain`, the prefix index, and **no** unique index on
   hints. Migration 150000.
2. **The v1 seed's migrations are gone.** Migrations `20260929140000` (the
   4,574-row seed) and `20260929151000` (the attribution pass) were deleted from
   the repository, together with the two generators that produced them, so a
   database built from this repository starts with `companies` 0 and
   `company_domains` 0. The seed's own (name, domain) list survives as the seed
   layer (`data/company-directory/seeds/wikidata-p856.json`), which is what the
directory build reads and what the reset is generated from. The shape the
attribution migration had is reproduced inline in the stewardship suite, because
its invariant — an attribution pass may never walk a proof backwards — outlives
the migration.
3. **Verification semantics** (§6) A–I, including the start-path owner check
   (C), contested claims (D), delegations with the review/evidence/grantor rules
   (F), the weak-claim rules that keep a bad seed from reserving a domain (H),
   and `reassign_company_domain` for a domain whose owner changed (I) — which now
   also *retires* the old claim as evidence instead of leaving two equal claims
   tying for the steward.
4. **The promotion threshold** (§6, B′): `confirm_company_verification` promotes a
   claim only when its evidence is `high`/`medium`. Against `low`/`unknown` — all
   4,574 seeded rows — a correct code answers `domain_control_only`, records the
   observation as `member_domain_control` evidence and grants nothing. Covered by
   nine assertions in the stewardship suite and three in the verified-domains
   suite, including the "wrong claimant cannot take a domain a better claim
   holds" case.
5. **Entity identity** (§5): `source_id` + `jurisdiction` on `companies`, the
   partial unique index on `(source, source_id)`, jurisdiction-scoped duplicate
   merging in the pipeline, and an importer that resolves and reports identity
   instead of guessing by name.
6. **Search**: the index set and the `UNION`-shaped `search_companies` with the
   alias arm, the ≤2-character prefix rule, per-arm `limit v_max`, `strpos`
   ordering inside the substring arms, and an `evidence_confidence` column.
   Re-measured at 1k/10k/100k/500k **against populated tables** (§8).
7. **Import path** (§9): `scripts/import-company-directory.mjs` — CSV → unlogged
   staging → set-based merge, deterministic UUIDv5 ids, idempotent, refusing any
   row that claims to be verified and skipping anything a member proved or
   created. It **actually commits** (see §9) and the benchmark asserts the loaded
   rows are visible before timing anything. `scripts/bench-company-directory.sh`
   measures it at every tier.
8. **The operator review queue** (§6a): `company_domain_reviews`,
   `company_domain_review_queue`, `company_domain_evidence_supports_promotion`
   and `review_company_domain` — the state transition from
   `domain_control_only` to a promoted or rejected claim, with the reviewer,
the reason, the timestamp and the confidence before/after recorded, service-role
only, and unable to write `verified`. Migration 152000, 40 assertions. This is
what makes the promotion threshold a route rather than a dead end.
9. **The reset of the bootstrap directory**, as an explicit operation rather
   than a migration: `supabase/reset/company_directory_seed_reset.sql` (generated
   by `scripts/generate-company-directory-reset.mjs`) plus the runner
   `scripts/reset-company-directory-seed.mjs`. It removes the 4,574 seeded
   companies from a database that already has them — guarded, idempotent,
   dry-runnable, refusing to run while any seed row is referenced by application
   data, and reporting every row it keeps. It is service-role only, it is not read
   by `db push` or `db reset`, and 52 SQL assertions plus 15 node assertions pin
   it. [company-directory-reset.md](company-directory-reset.md) is the audit, the
   strategy, the execution order, the rollback and the validation queries.
10. **The runtime half of the report**: `scripts/company-directory-metrics.sql` —
   read-only, safe against production, and the only way to answer "how many
   domains are waiting on a person, how many members have actually verified, how
   many attempts failed" (§10).

Deliberately NOT in this PR: the 500k import, any licensed source adapter, a
reviewer role or admin UI, bulk or automatic promotion, and anything that
changes what `verified` means.

### The export contract: one canonical place per fact

The generator emits five files and the importer reads all five by header name.
No fact appears in two of them, so there is no column the importer ignores and
nothing keeps honest — which is exactly how `companies.csv` used to carry a
`website_domain`, an `employee_email_domains`, a `parent_company_id` and a
`;`-joined `aliases` column that the import never read.

| File | Canonical for | Notable absences |
| --- | --- | --- |
| `companies.csv` | the entity: `company_id`, name, country, industry, registry identity, rank | no domains, no aliases, no parent column |
| `company_domains.csv` | **every** domain claim — official website and employee email alike, separated by `domain_type`, with `evidence_confidence` and `source` | the importer never derives one type from another |
| `domain_evidence.csv` | the observations behind a claim, with their URL | — |
| `company_aliases.csv` | `alias` / `former_name` / `brand` search names, typed | the canonical name is not repeated |
| `company_relationships.csv` | parent / subsidiary / brand / division structure | — |

The split mirrors the schema: `company_domains`, `domain_evidence`,
`company_aliases` and `company_relationships` are tables, so each gets a file,
and `companies` gets the entity. An employee email domain is never inferred from
a website domain. A duplicated edge or alias is collapsed; a relationship whose
endpoint is missing, that points at itself, or whose type is outside the
database's vocabulary fails the generator (and `--check`) instead of arriving as
a rejected row.

### Unresolved (no decision made here)

- **Universities, hospitals and public bodies as employers.** The current gates
  exclude academic and government TLDs; IIT Bombay is kept in `curated.json` as
  a deliberate counter-example. ROR would settle it, but it is a product call.
- **Whether `low`-confidence claims may pre-select a company** in the picker.
  The prototype says no; only name search surfaces them.
- **The operator *screen* over the review queue.** The mechanism is shipped
  (§6a) and the queue is readable, but no UI reads it yet, so a legitimate
  employee at a weakly-claimed domain is still told "not yet" until somebody
  runs the query and decides. Until that screen exists, the promotion threshold
  is fair only as fast as an operator is willing to look — which is the strongest
  argument for building it first in the next phase.
- **Whether a promotion should require a second reviewer** above some blast
  radius (e.g. promoting a claim is fine, but promoting a domain that many
  members have already proved control of is not a one-person decision). Nothing
  in the schema prevents adding a second signature later; the decision table
  already records one reviewer per row.
- **Substring search over a very common term** is 115 ms at 500,000 rows (§8).
  Fixing it means a different index shape (lexeme/word-start), not a tuning
  parameter.
- **The evidence resolver's real yield** (§10) — the number that decides how far
  the directory can go before it is mostly names.
- **Member-facing "this mapping is wrong" reporting** — the main quality signal
  at scale, and it does not exist yet.
- **A real re-check job** (DNS/MX/HTTP/parked/reachable) and what it retires.
- **Whether `source_id`/`jurisdiction` should also be mandatory** for a company a
  member creates. Today a member-created company has neither, which is correct
  (there is no registry), but it means "no registry identity" and "registry not
  yet loaded" look the same in the data.
- **Whether fb.com-style multi-domain cases are worth curator effort** before
  the resolver exists, or whether the resolver should produce them.

### Next: the 10,000-company data phase

The foundation is in place; the next phase adds COMPANIES, not schema. How the
first 10,000 are assembled — one pipeline, in this order:

```
Companies House (bulk, OGL v3.0, GB)
    ↓  discovery only: names, company numbers, status, addresses
companies with a registry identity
    ↓  source = 'companies_house', source_id = company_number, jurisdiction = 'GB'
normalisation (company_slugify, country_code, industry, entity_status)
    ↓
deduplication  ── registry identity first, then a jurisdiction-scoped name key
    ↓
official website discovery  ── P856 / curated / funding-page layer   →  primary_website claim, confidence `unknown`
    ↓
email-domain EVIDENCE discovery  ── the resolver reads the company's OWN pages
    ↓                                (contact/legal/imprint/security.txt/careers)
domain claims  ── claim per (company, domain), typed, never verified here
    ↓
confidence resolver  ── evidence weights → high/medium/low/unknown; conflicts reported, never resolved by deleting
    ↓
review queue  ── the weak claims a member actually challenged
    ↓
measurement  ── the layer half + the runtime half (§10), then and only then a projection
```

The steps, with what each one is allowed to conclude:

1. **First registry, as a DISCOVERY layer only.** UK Companies House is the
   cheapest honest tier: 5.5M registrations, committable with attribution, and
   company-level facts only. It never asserts an email domain. Its rows enter as
   `primary_website` claims at confidence `unknown` until a website resolver finds
   a domain, so the phase-1 directory is *names and websites*, which is exactly
   what it should be.
2. **Registry identity through the whole path.** The schema, pipeline and
   importer already carry `(source, source_id, jurisdiction)`, but no layer file
   supplies a `source_id` yet — the identity path is exercised only by tests and
   by the synthetic benchmark. The Companies House adapter is what makes it real,
   and it is the reason this step precedes any second country.
3. **The first-party evidence resolver** (its rules:
   [company-email-domain-resolution.md](company-email-domain-resolution.md#3-sources-in-the-order-they-should-be-tried)).
   It reads a company's *own* contact/legal/imprint/careers pages and its
   `security.txt`, and writes one `domain_evidence` row per sighting. It is the
   only thing that can lift a claim above `unknown`, it may not use MX as a
   finding, and it writes no `verified` and no promotions. Target the 1,000
   largest companies first and measure the yield before widening (§10).
4. **A real re-check job** (`companies.last_checked_at`,
   `company_domains.last_checked_at`): DNS, MX (supporting-only), HTTP, parked
   detection, and what it retires.
5. **The operator screen** over the review queue that §6a already implements,
   plus member-facing "this mapping is wrong". Together these are the quality
   signal at scale.
6. Then, and only then, measure the staged tiers (1k → 10k → 50k → 100k) with
   `npm run companies:v2 -- --sample N --measure` and
   `scripts/company-directory-metrics.sql`, and re-run
   `npm run bench:companies-directory` at the new sizes.

**Exact scope of the next PR** (one phase, reviewable, no schema surprises): the
Companies House discovery adapter behind the existing layer interface + the
review *screen* (read the queue, call `review_company_domain`, show history) +
the first-party evidence resolver for the 1,000 largest companies + the 10k
measurement written into §10 as a new column. It ships **no** dataset rows to
production: the 10k import is a separate, explicit step once the adapter's output
has been reviewed.

Still out of scope until then: the 500k import, commercial sources, email
intelligence APIs, and anything that changes what `verified` means.
