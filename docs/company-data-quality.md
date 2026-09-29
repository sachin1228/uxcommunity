# Company data quality

The rules that decide whether a directory row is allowed in, what happens to the
ones that are not, and how each is tested. Written against the prototype in
[generate-company-directory-v2.mjs](../scripts/generate-company-directory-v2.mjs)
and its tests, which are the executable form of everything below.

## 1. Gates and signals are different things

| | Gate (refuses a row) | Signal (raises a review flag) |
| --- | --- | --- |
| Definition | the row cannot mean what it claims | the row might be wrong |
| Examples | domain syntax, free-mail provider, subdomain of somebody else's domain, forbidden evidence, two companies tied on one domain | name/domain do not look related, low sitelink count, unknown entity status, planted-looking hint on a high-profile brand |
| Effect | row is excluded and reported with a reason code | row is kept, and the coverage report counts it |
| Risk of getting it wrong | a real company is missing | a wrong row survives to be reviewed |

The v1 generator used a **signal** (`LOW_TRUST_SITELINKS` name/domain
similarity) as a **gate**, and it was right to: it caught `DLF Limited →
godrejokhla.co.in` and `ADIA → damanmarkets.com`. But it also deleted Google,
LinkedIn, TikTok, Pinterest, X (their domains are on the platform list) and
every company whose domain is a bare `name.ccTLD` (47 rows in the seed, 100% of
them from the hand-checked core, 0% from Wikidata). A signal that silently
removes rows is indistinguishable from a bug. In v2 the same checks are used
where they belong:

- platform domains are refused **only** when the entity's name has nothing to do
  with the domain — `Facebook` with `facebook.com` is the operator, `Acme
  Retail` with `facebook.com` is a shop whose only web presence somebody else
  owns;
- bare ccTLD domains are **not** refused at all (the v1 "truncated URL" rule is
  gone; `example.de` is a normal registrable domain);
- name/domain similarity never decides ownership, only whether a platform-domain
  claim survives — and a curated, evidenced claim is exempt from it entirely.

## 2. `verified` is not a quality tier

Every row a data file produces is `verified = false`, whatever its confidence.
Confidence describes the *evidence*; `verified` describes a *proof* made by a
member with a mailbox. The two must never be merged: a "high confidence" row is
still a hint, and the picker, the routing lookup (`company_domain_owner`) and the
OTP flow all keep treating it as one. A 500k dataset cannot verify anything.

## 3. Nothing is dropped silently

Every exclusion lands in the coverage report with a reason code:

| Reason code | Meaning |
| --- | --- |
| `not_a_domain` | failed normalisation/syntax |
| `free_email_provider` | a consumer mailbox provider |
| `non_company_tld` | `gov`/`mil`/`edu`/`int`/`arpa` (policy, recorded as such) |
| `subdomain_not_ownable` | reduces to a registrable domain the company does not own |
| `platform_not_a_company_site` | a platform domain in a website field with an unrelated name |
| `forbidden_evidence:*` | `redirect_from_website`, `website_domain_match`, `mx_only` |
| `unknown_domain_type` | a layer used a type outside the schema (a layer bug, not a data one) |
| `unknown_source` / `source_not_adopted` | a layer cites a source the registry does not allow |

The report also counts, per build: input rows, companies after merging
duplicates, unique companies and domains, companies with a website, with one or
more email domains, with more than one email domain, rows per confidence tier,
relationships, merged duplicates, conflicts, and the per-reason rejection
totals. `--check` exits non-zero on a blocking conflict, on forbidden evidence
or on a layer issue, so it can gate a pipeline run.

## 3b. Identity: a number, not a name

Two companies can share a name; one company can change its name. Neither is
expressible if the identity is the name, so it is not:

- **registry identity**: `source` + `source_id`, with a partial unique index
  (`companies_source_identity_idx`). Two rows with the same identity are the same
  entity whatever they are called; two different identities are never merged by a
  name match.
- **name key**: only ever inside one jurisdiction. `Nordic Holdings Ltd` in GB and
  in DE are two companies; the same name in the same jurisdiction twice is one row
  (and is counted as ambiguity worth reviewing, not silently merged).
- **the slug is a handle, not an identity**: an import never rewrites it.

Tested in three places: the SQL suite (two same-named companies coexist; the same
identity twice is refused with `23505`), the pipeline suite (jurisdiction-scoped
merging, a renamed company recognised by its number), and the importer, which
**fails the run** when a staged company resolves to zero or to two live rows
instead of guessing.

## 4. Duplicate and ambiguous entities

| Situation | Policy |
| --- | --- |
| Same id from two layers | one row; the curated record survives, the other's domains are kept as hints; counted as a merge |
| Names differing only by legal suffix (`Alphabet Inc.` / `Alphabet` / `Alphabet Inc`) | merged via `matchKey` (trailing `inc/ltd/llc/corp/gmbh/…` dropped) |
| An alias matches another entity's name (`Meta` / `Meta Platforms`) | merged; the alias list is preserved and searched |
| Two companies genuinely named alike in different countries (`ABC Bank` US / `ABC Bank` JP) | **not** merged automatically: the pipeline merges on name, so country must be part of the identity before registries are imported — recorded as a precondition for stage 5 of the migration plan |
| One domain claimed twice | ownership resolution, never a coin flip (§5 of the architecture doc) |
| A brand and its parent | kept apart, related by `company_relationships` |

Measured on the current inputs: 4,594 rows in, 18 merges, 4,576 companies out,
0 duplicate normalised names left, 0 conflicts.

## 4b. What a backfill may never do

The 4,574 seeded rows are attributed by a generated migration (151000), and it is
written to be safe to re-run forever:

- **no `delete`, no `drop`, no `truncate`** anywhere in the file (asserted, so a
  future statement cannot slip one in);
- it never writes `verified`, and never clears `verified_at` (asserted);
- it only touches rows with `source is null` and `verified = false`, so a proved
  claim or an attributed row is skipped;
- it only touches companies with `created_by is null`, so a member's own company
  is never reattributed.

The SQL suite runs the same statement three times and snapshots every proved row
first, then asserts that **not one of them was downgraded** by the third run.

## 5. Domain ownership invariants

These are the invariants a bad seed must never be able to break, and where each
is enforced:

| Invariant | Enforced by |
| --- | --- |
| A claim can never verify anything | the OTP flow: `confirm_company_verification` is the only promotion path |
| A claim never routes a mailbox | `company_domain_owner` prefers verified rows; `search_companies`'s domain arm requires `verified` |
| One **verified** claim per domain | `company_domains_verified_domain_idx` (partial unique) |
| Several unverified claims on one domain are allowed | deliberately **no** unique index on hints: evidence may disagree, and the schema must be able to record it |
| A contested domain has no steward | the resolver refuses to choose on a tie at medium or above, and reports it |
| A wrong claim cannot be promoted under a different company | `confirm_company_verification` only promotes a claim **of the company the member chose** |
| A bad claim cannot steal a domain from a real owner | verified rows win in `company_domain_owner`; a competing promotion collides via `unique_violation` and yields `domain_already_verified` |
| A member's proof cannot be rolled back by a conflict | promotions catch `unique_violation` instead of raising, so the challenge survives |
| A relationship never transfers a domain | the resolver ignores `company_relationships`; only claims (and a reviewed delegation, for acceptability) decide |
| A delegation cannot create a second claim | delegations live in `company_domain_delegations`, outside `company_domains` |
| A weak, unrelated claim cannot block a real company forever | the create path only defers to a claim at medium+ or one with the same company name; anything weaker is superseded by the proof |
| A name cannot be re-created to impersonate | `company_name_taken` + `companyNameMatchesDomain` on the create path |
| A former name cannot collapse entities | `former_names` are search-only; identity keys come from the name and true aliases |

## 6. Ranking, honestly

`directory_rank` is deterministic and says what decided it:

1. has at least one email-bearing domain (evidence-bearing companies first),
2. the best confidence tier,
3. total evidence count,
4. Wikidata sitelinks, capped at 1000 — a **notability** proxy, explicitly not a
   size proxy,
5. then normalised name and id, so the order is total and stable.

Each row also carries `rank_basis` (`email_evidence` / `wikidata_sitelinks` /
`name_only`), so a reader is never misled into reading rank as company size.
Employee count, revenue, active status and public-listing status are the inputs
that would make ranking meaningful; they arrive with the registry layers, and
until then the rank is labelled provisional in the report.

## 7. Special cases and where they are tested

Every case below has an assertion in
[generate-company-directory-v2.test.mjs](../scripts/generate-company-directory-v2.test.mjs)
(40 tests, run with `npm run test:companies-v2`), including one test per row of
the verification decision table (A–I) and 12 company×domain combinations across
the Meta family.

| Case | Assertion |
| --- | --- |
| Parent company | Meta/WhatsApp/Instagram: three entities, two `subsidiary` relationships, no shared domain |
| Subsidiary | AWS owns no domain because `aws.amazon.com` reduces to `amazon.com` |
| Brand | a `brand` row never enters `employee_email_domains` |
| Conglomerate | Volkswagen Group/Audi/Porsche exist as separate companies |
| Acquired company | represented by a relationship; no domain is moved (see the maintenance table) |
| Regional company | `acme.de` as `regional` counts as an email domain only at medium+ |
| Country-specific domains | `co.uk`, `com.hk`, `com.au`, `com.cn`, `ac.in` keep three labels |
| Multiple legitimate domains | five domains → five rows on ONE company |
| Holding company | Alphabet and Google are separate, `abc.xyz` is not an email domain |
| Website ≠ email domain | Meta: `meta.com` website, `fb.com` email |
| Website redirects to a parent | redirect evidence is refused outright |
| Employees and customers on different domains | a `primary_website` row is never an email domain without evidence |
| University / business hybrid | IIT Bombay parsed and typed; the policy exclusion is reported, not silent |
| Government-owned, banks, airlines, hospitals, nonprofits | no class-specific rules; the same gates apply, and any refusal is reported with a reason |
| One company, many domains | covered above |
| Two companies, one domain | tied claims leave the domain contested (no steward) and raise a blocking conflict; a stronger claim is the steward at severity `review`; a proof marks the rest `superseded` without deleting them |
| Parent + subsidiary, one domain | four entities, four domains; the subsidiary is refused the parent's domain unless a **reviewed** delegation exists, and the steward stays the parent |
| Weak claim in the way of the real company | a low/unknown unrelated claim does not block creation; a medium+ claim or a same-name claim sends the member to join instead |
| Acquisition / reassignment | the verified claim stays with its owner until an operator reassigns it; the new entity re-proves; memberships and history are untouched |
| Free-mail domain | `hotmail.com` is refused with `free_email_provider` |
| Platform domain | refused for an unrelated name, accepted for the operator |
| Company dissolved / domain abandoned / domain moved / company split | maintenance workflow in §8 of the architecture doc; the schema columns exist to record it (`entity_status`, `last_checked_at`, `historical`) |

## 8. Determinism and review

- The generator is deterministic: same inputs → byte-identical CSVs (asserted in
  the tests). That is what makes a 500k-row diff reviewable at all.
- The **layer files are the input of record**; the SQL is generated. Nobody
  hand-edits a 500k-line migration.
- The committed v1 seed is not reproducible from the committed v1 generator (53
  rows would be refused today). The v2 export reads the migration instead of
  re-querying Wikidata, precisely so the prototype is reproducible, and the
  general fix is the v2 layout: data file in, generator out, diff reviewed.
- Regeneration never touches a verified row: the seed inserts hints with
  `on conflict do nothing`, so a member's proof and a member-created company
  survive every rebuild.

## 9. What is still missing

| Gap | Impact | Where it lands |
| --- | --- | --- |
| Member-facing "this mapping is wrong" report | the main quality signal at scale does not exist | unresolved item, architecture doc §12 |
| An operator **screen** over the review queue | the promotion mechanism shipped, but nobody can see the queue yet without running SQL | next PR, architecture doc §12 |
| Real re-check job (DNS/MX/HTTP/parked) | stale rows persist silently | populates `last_checked_at`; validation ladder rungs 6–10 |
| Public suffix list in the pipeline | exotic suffixes reduce wrongly | §2 of domain resolution |
| A registry identifier on real rows | `(source, source_id)` is enforced but no layer supplies one yet, so "no registry" and "registry not loaded" look alike | the Companies House adapter |
| Employee count / active status | ranking cannot be meaningful | arrives with GLEIF and Companies House |
| Measured yield at 10k/50k/100k | no coverage claim is available above 1k | staged plan, architecture doc §10 |
| Streaming generator output | 500k rows cost ~530 MB of node heap | storage strategy, architecture doc §9 |
| **Done, no longer a gap** — deterministic company ids | re-imports update in place (UUIDv5 of the slug) | shipped, architecture doc §9 |

---

## Enforced where

The rules in this document are not advice: each one is a constraint, a function
or an assertion in the shipped migrations
`supabase/migrations/20260929150000_company_domain_stewardship.sql` and
`supabase/migrations/20260929152000_company_domain_review.sql`.

| Rule | Enforced by |
| --- | --- |
| domains are stored normalised, lowercase, one row per (company, domain) | `company_domains` check + `company_domains_company_domain_key` |
| a domain has one verified owner, and several unverified claims | `company_domains_verified_domain_idx` (partial on verified); deliberately NO unique index on hints |
| who owns a domain, and whether the answer is a decision or a tie | `public.company_domain_steward(domain)` → `resolution`, `contested` |
| the full claim set, with superseded claims kept | `public.company_domain_claims(domain)` |
| another company's domain is usable only through a reviewed delegation with checked, non-supporting evidence, granted by a claimant | `public.company_domain_delegation_allowed(company_id, domain)` |
| the steward keeps the domain even when a delegation is used | `company_domains` is not written by the delegation path at all |
| a weak claim cannot reserve a domain, a medium-or-better one can | `start_company_verification` (case H) and `confirm_company_verification` |
| a proof is the only thing that sets `verified` | both RPCs; the import refuses an export that claims it; `review_company_domain` writes no such column |
| a domain whose owner changed | `public.reassign_company_domain(...)` |
| a weak claim that a member proved control of is reviewable, attributable and reversible | `public.company_domain_review_queue(...)`, `public.review_company_domain(...)`, `public.company_domain_evidence_supports_promotion(...)` |
| the OTP observation that queued an item can never be the evidence that promotes it | `company_domain_evidence_supports_promotion` excludes `member_domain_control` and unchecked rows |
| a rejection never deletes evidence, and a rejected item returns only on new evidence | the queue's filter over `company_domain_reviews` |

Assertions: `supabase/tests/company_domain_stewardship.test.sql` (161),
`supabase/tests/company_verified_domains.test.sql` (118),
`supabase/tests/company_domain_review.test.sql` (40).
