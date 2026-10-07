# Employee email domain resolution

The one question this document answers: *for a given company, which domains do
its employees actually receive mail on?* Everything else in the directory is
allowed to be approximately right. This is not: a wrong answer here attaches a
real employee's proof to the wrong company, which is the single failure the
whole verification model exists to prevent.

## 0. What a proved mailbox does and does not buy

This is the rule the whole feature hangs on, and it is now enforced in SQL, not
just stated here:

| A claim's evidence | What a correct OTP at that domain does |
| --- | --- |
| `high` / `medium` | promotes the claim to **verified** and creates the membership |
| `low` / `unknown` | creates the membership through the mailbox alone (`verified_via = 'mailbox_only'`): the observation is recorded, the claim stays unverified |

An OTP proves the member controls that **mailbox**. It does not prove that the
directory's company → domain mapping is correct, and every seeded row in the
directory is a mapping nobody has checked. If a code could promote one, then
whichever seeded row is wrong becomes verified company ownership for the first
person who signs up at that domain — which is the reverse of the trust model the
OTP is supposed to enforce.

So the promotion threshold is part of the trust model, and it governs the
**domain**, not the membership:

```
evidence >= medium   → the mailbox proof settles the claim: verified + membership
evidence <  medium   → the mailbox proves CONTROL OF THE DOMAIN and grants the
                       membership (verified_via = 'mailbox_only'); the claim
                       stays unverified and the mapping is queued for review as
                       domain_evidence with source = 'member_domain_control'
```

Either way the member joins the company — they answered a code sent to its
mailbox, which is what "where do you work?" asked for. What a weak claim cannot
buy is authority over the domain itself.

That evidence type is deliberately **excluded** from the resolver's weighting
(`company_domain_steward`): it must not raise a claim's strength, because "somebody
has a mailbox here" is true for both the right company and the wrong one.

**And it is also excluded from the promotion gate.** The state after a
mailbox-only proof is not a dead end: the observation is the *queue* for an
operator review, and a promotion (which lifts the claim's evidence, not its
`verified` flag) is what lets a later proof settle it. That mechanism is shipped
— migration `20260929152000`, `company_domain_review_queue` and
`review_company_domain`, documented in
[company-directory-architecture.md §6a](company-directory-architecture.md#6a-the-promotion-policy-and-the-review-queue-that-implements-it)
and held to its rules by `supabase/tests/company_domain_review.test.sql`. The
short version, because it is easy to get wrong later:

* a promotion may only be backed by **checked, non-OTP** evidence, and the kinds
  it may use are exactly the resolver's first-party/registry kinds below;
* `promote` writes `evidence_confidence` and nothing else — `verified` still
  belongs to a proved mailbox alone;
* a rejection changes nothing except the record, so a later resolver finding can
  overturn it.

## 1. The rule that shapes everything

> A company's official website domain is **not** its employee email domain. It
> is one clue, and often the wrong one.

Wikidata `P856` is *official website*. It is the only domain field the current
seed has, and it is why the current directory cannot say which of a holding
company's, a brand's and a subsidiary's domains carry mail. The v2 pipeline
keeps P856 for what it is — a website hint at confidence `unknown` — and derives
email domains from evidence instead.

## 2. Evidence ladder

| # | Evidence kind | Weight | What it actually proves | Notes |
| --- | --- | --- | --- | --- |
| 1 | `first_party_role_address` — a role address (`info@`, `careers@`, `press@`) published on the company's own site | 2 | mail is delivered on that domain and the company publishes it | the strongest cheap signal; only the **domain** is stored, never the address |
| 2 | `first_party_legal_page` — contact/legal/imprint/terms page with an address on the domain | 2 | same, with a legal obligation behind it in many jurisdictions (e.g. German `Impressum`) | |
| 3 | `first_party_security_txt` — `/.well-known/security.txt` with a `Contact: mailto:` on the domain | 2 | the security team's own mailbox | |
| 4 | `first_party_document` — a filing, prospectus, press kit or PDF the company published | 2 | printed by the company about itself | SEC EDGAR exhibits are the cheapest large source |
| 5 | `first_party_careers_contact` — a recruiting page with an address on the domain | 1 | mail exists; used by HR rather than by everyone | |
| 6 | `published_email_format` — the company documents its own address format | 1 | mail exists | |
| 7 | `external_reputable` — a citable third party (registry record, standards body, government filing) | 1 | mail exists, weaker than the company saying so | |
| 8 | `mx_record` | 1 | **supporting only**: mail for the domain is hosted somewhere | Google Workspace and Mimecast MX records are shared by millions of unrelated domains |
| 9 | `ct_certificate` | 1 | supporting only: a hostname under the domain was controlled at issue time | |

Derived confidence (implemented in
[generate-company-directory-v2.mjs](../scripts/generate-company-directory-v2.mjs),
tested in its `.test.mjs`):

| Tier | Condition | Usable how |
| --- | --- | --- |
| `high` | ≥ 4 points **and** at least one first-party kind | may pre-select the company in the picker |
| `medium` | ≥ 2 points, or any first-party kind | may pre-select; shown as a suggestion |
| `low` | 1 point, or MX/CT only | searchable by name only, never inferred from a domain |
| `unknown` | no evidence | website hint only |

Two guards that matter more than the arithmetic:

- **`evidence_checked = false` caps a row at `low`.** A URL nobody opened is a
  lead, not a finding, however many of them are listed. The prototype applies
  this, which is why 15 of its 20 email-bearing rows are `low`.
- **Forbidden evidence is refused and reported**: `redirect_from_website`,
  `website_domain_match`, `mx_only`. A domain that redirects to a company's site
  proves the company pointed it there — a marketing or parking decision — not
  that anyone has a mailbox on it.

## 2b. The first-party evidence resolver: its contract

The resolver is the only component allowed to lift a claim above `unknown`, so
its boundary is stated before its sources. It may **add** `domain_evidence` rows
and nothing else:

| It may do | It may never do |
| --- | --- |
| fetch a company's own pages and record a sighting as one typed observation | write `company_domains.verified`, or any column of `companies` |
| record a registry/published-document finding as `registry_record` / `published_corporate_email` | promote a claim itself (that is `review_company_domain`, by a person) |
| record MX/SPF/DMARC as `supporting` context | treat MX as a finding: it proves mail infrastructure exists, not who uses it |
| record where a domain *redirects* as a note | treat a redirect to the company's site as evidence someone has mail there |
| widen a claim's `last_checked_at` and re-record what it found | delete, downgrade or rewrite an observation somebody else made |
| store the **domain** | store an individual address, a person, or a scraped message |

The kinds it writes are exactly the kinds the promotion gate accepts
(`company_domain_evidence_supports_promotion`): `first_party_contact_page`,
`first_party_legal_page`, `first_party_careers_page`,
`first_party_documentation`, `published_corporate_email`, `registry_record`.
Anything it cannot justify in one of those terms is not evidence and is not
stored — which is also why `redirect_from_website` is refused by a constraint on
the table rather than by a coding convention.

## 3. Sources, in the order they should be tried

| Order | Source | Cost | Expected hit rate | Legality |
| --- | --- | --- | --- | --- |
| 1 | the company's own `/contact`, `/about`, `/legal`, `/imprint`, `/impressum`, `/.well-known/security.txt` | one or two HTTP fetches per company, cached | 30–60% of companies with a live site publish a role address | public pages, honour robots.txt and rate limits |
| 2 | the company's own published documents (SEC EDGAR exhibits, annual reports, press kits) | medium (fetch + parse) | high for listed companies | public domain / issued documents |
| 3 | registry and standards records that carry a contact (`RDAP` registrant org is usually redacted; industry registries are better) | low | low | registry terms |
| 4 | Certificate Transparency logs for the company's own hostnames (`mail.`, `smtp.`, `owa.`) | low | discovers *additional* hostnames, not mailboxes | public log data |
| 5 | DNS: MX, SPF includes, DMARC | low | supporting evidence only | public resolution |
| 6 | Tranco/Umbrella popularity | low | parked-domain and platform detection, **never** a company-size claim | per-list terms |

**Never used**, whatever the apparent value: credential leaks, breach corpora,
password dumps, scraped private profiles or message data, purchased "work email"
fields with no provenance, and any inference purely from MX or a redirect. Only
domains are stored — never an individual address, never a person.

## 4. Resolution algorithm

```
for each company:
  1. website = the declared site                                   → primary_website, unknown
  2. candidates = the website's registrable domain
                ∪ domains the curator asserted (with evidence)
                ∪ domains discovered from CT/SAN on the company's own hostnames
  3. for each candidate:
       normalise → validate (free-mail, TLD, subdomain, platform)   → external rejects, reported
       fetch the company's own contact/legal/security pages         → evidence kinds
       fetch MX/SPF (supporting only)
       derive tier                                                  → with the checked cap
  4. claims across companies → ownership resolution (one owner, conflicts reported)
  5. emit: website domain, email domains (evidence ≥ low, typed), confidence, sources
```

Two deliberate constraints:

- **Step 3 is per-company, not crawl-wide.** Fetching a company's own pages is
  a handful of requests; scanning Common Crawl for domains would produce volume
  and no provenance.
- **Anything published by the company wins over anything about it.** A filing
  or a legal page beats an aggregator's opinion, and both beat an inference.

## 5. Parent, subsidiary and brand ambiguity

| Situation | Resolution |
| --- | --- |
| A subsidiary's mail runs on the parent's domain | the domain belongs to the **parent**; the subsidiary keeps a `subsidiary` relationship and no claim on that domain. A member at the subsidiary verifying that domain joins the parent, which is the truth |
| The parent uses a brand's domain for its own mail (or vice versa) | the claim goes to the entity whose own evidence supports it; if both have evidence, it is a `blocking` conflict and no automatic owner is assigned |
| A holding company whose mail domain differs from every operating company | the holding company is typed with its own domains; relationships record the rest |
| Two entities share one domain because of an acquisition in progress | both claims are kept and reported; only a human settles the direction |
| A company's domain changes (rebrand) | old domain becomes `historical`, new one `corporate_email`; both rows stay, `last_checked_at` shows the re-check |

## 6. Worked examples

| Company | Website | Email domains | Why |
| --- | --- | --- | --- |
| Meta Platforms | `meta.com` | `fb.com` | curator asserts `fb.com` with a first-party document + MX, checked → high; `meta.com` stays a website hint |
| Facebook | `facebook.com` | — | a separate brand entity; Meta's former names are search-only and never merge it into the parent |
| WhatsApp | `whatsapp.com` | — | nothing evidenced yet; **no** inheritance of `meta.com`, and the delegation list is empty on purpose |
| Alphabet Inc. | `abc.xyz` | — | `abc.xyz` is a website; the company is a SEPARATE entity from Google and owns no evidenced mail domain |
| Google | `google.com` | `google.com` | evidence + MX, and being on the platform deny list does not apply to a curated email domain |
| Amazon Web Services | `aws.amazon.com` | — | the subdomain reduces to `amazon.com`, which Amazon owns, so AWS claims nothing |
| Tata Consultancy Services | `tcs.com` | `tcs.com` | careers contact, checked; the name/domain relation is a *signal* (initials), and here it is corroborated by evidence |
| IIT Bombay | `iitb.ac.in` | `iitb.ac.in` | a role address on the institute's own contact page; the academic-TLD policy question is recorded, not silently applied |
| Acme Technologies (fixture) | `acmetech.io` | — | the name looks like the domain and no evidence exists → `unknown`, website hint only |

## 7. Evidence is not truth: conflicting claims are allowed

An evidence-backed claim is still a claim. Two companies may have evidence on
one domain, one may outweigh the other, and neither may be right until somebody
proves a mailbox there. So the pipeline stores both, marks one the **steward**
where the evidence supports one, marks the domain **contested** when it does
not, and reports the disagreement. It never deletes the claim it decided
against, and it never turns a confidence tier into a verification.

| Situation | Stored | Reported |
| --- | --- | --- |
| one claim | the claim | steward = that company |
| two claims, different strength | both; the stronger is the steward | conflict at severity `review` |
| two claims, equal strength at medium+ | both; **no steward** | conflict at severity `blocking` |
| one claim, later proved by another company | both; the proof wins, the other is `superseded` | conflict, with the superseded claim visible |

## 8. Yield: measure, do not project

No coverage percentage is claimed from the 1,000-company prototype. It measures
**1 high, 4 medium, 15 low, 985 website-only** companies, which says exactly one
thing: the current supply is a website layer plus 20 curated entities. An earlier
draft extrapolated 10–25% from it; that extrapolation is withdrawn.

The staged plan in
[company-directory-architecture.md](company-directory-architecture.md#10-staged-measurement-plan-1k--10k--50k--100k)
measures the nine required figures at 1,000 / 10,000 / 50,000 / 100,000 with
`npm run companies:v2 -- --measure`, and only a measured stage is quoted.
The resolver's real yield is the number that decides how far the directory can
go before it is mostly names; until it is measured, the answer is unknown.

What stays fixed regardless of the numbers: **the pipeline never invents an
email domain to fill a row.** A company with no evidence simply has no email
domain, and the picker falls back to name search plus the OTP.

## 9. What happens when the evidence is wrong

An employee whose company is mis-mapped (their domain hints at another company)
is told "that domain is already listed for X" and can either prove X — which
would be a lie — or be stuck. Two controls exist today, and one does not:

| Control | State |
| --- | --- |
| a weak claim cannot be proved into verified company ownership | **shipped** (the promotion threshold, §0) |
| a weak claim that somebody *did* prove control of is queued for an operator, who can promote or reject it with an audit trail | **shipped** (`20260929152000`, architecture §6a) |
| a member-facing "this mapping is wrong" report | **not built** — at 500k hints this is the highest-value quality signal available, and it is listed as an open decision in [company-directory-architecture.md](company-directory-architecture.md) |

Until the third exists, the feedback path runs through support, and the review
queue is where a person can act on it.

---

## Enforced where

The rules in this document are not advice: each one is a constraint, a function
or an assertion in the shipped migration
`supabase/migrations/20260929150000_company_domain_stewardship.sql`.

| Rule | Enforced by |
| --- | --- |
| domains are stored normalised, lowercase, one row per (company, domain) | `company_domains` check + `company_domains_company_domain_key` |
| a domain has one verified owner, and several unverified claims | `company_domains_verified_domain_idx` (partial on verified); deliberately NO unique index on hints |
| who owns a domain, and whether the answer is a decision or a tie | `public.company_domain_steward(domain)` → `resolution`, `contested` |
| the full claim set, with superseded claims kept | `public.company_domain_claims(domain)` |
| another company's domain is usable only through a reviewed delegation with checked, non-supporting evidence, granted by a claimant | `public.company_domain_delegation_allowed(company_id, domain)` |
| the steward keeps the domain even when a delegation is used | `company_domains` is not written by the delegation path at all |
| only checked, non-OTP evidence can lift a claim's strength | `public.company_domain_evidence_supports_promotion(company_id, domain)` — refuses `member_domain_control` and unchecked rows |
| a promotion can never write `verified` | `public.review_company_domain` updates `evidence_confidence` and `last_checked_at` only; asserted |
| every promotion/rejection is attributable | `company_domain_reviews.reviewer_id` (not null → `users`), `reason` 3–1000 chars, `before`/`after_confidence`; a reviewer-less call raises |
| no client role can review | `revoke all … from public, anon, authenticated` + `grant execute … to service_role` on the table and both functions |
| a weak claim cannot reserve a domain, a medium-or-better one can | `start_company_verification` (case H) and `confirm_company_verification` |
| a correct code always adds the workplace, while a weak claim still cannot be verified by one | `confirm_company_verification` (`20261007170000`): membership + profile pointer, `verified_via = 'mailbox_only'`, `company_domains.verified` untouched |
| a proof is the only thing that sets `verified` | both RPCs; the import refuses an export that claims it |
| a domain whose owner changed | `public.reassign_company_domain(...)` |

Assertions: `supabase/tests/company_domain_stewardship.test.sql` (161),
`supabase/tests/company_verified_domains.test.sql` (118).
