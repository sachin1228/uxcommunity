# Company domain resolution

How the pipeline turns "this organisation" into a set of domains it is allowed
to own, and how it decides which kind each one is. This is the layer that keeps
`company → website` from being mistaken for `company → employee email domain`.

Companion documents:
[company-email-domain-resolution.md](company-email-domain-resolution.md) covers
the evidence ladder for *email* domains specifically;
[company-data-quality.md](company-data-quality.md) covers the gates and the
regression tests.

## 1. Two questions, asked separately

| Question | Answered by | Wrong answer costs |
| --- | --- | --- |
| Which domains does this company own? | discovery + validation (§2–§4) | a domain offered to the wrong company, or a real company unfindable by domain |
| Which of those do employees receive mail on? | evidence (§5) | an employee's own proof attaches to the wrong company |

A company can own a domain and have no mail on it (`abc.xyz`), and can have mail
on a domain that is not its main site (`fb.com` for Meta). The model therefore
never derives the second answer from the first.

## 2. Normalisation

Every input goes through the same function, which mirrors
`normalizeDomain` in [domains.ts](../apps/web/lib/companies/domains.ts) so a
value the pipeline accepts is a value the app accepts:

| Input | Result | Rule |
| --- | --- | --- |
| `  WWW.Figma.com/ ` | `figma.com` | trim, lowercase, strip scheme, path, query, fragment, `www.`, trailing dot |
| `sachin@figma.com` | `figma.com` | keep the domain part of an address |
| `https://user:pw@figma.com:8443/x` | `figma.com` | drop credentials and port |
| `figma.com.` | `figma.com` | a trailing root dot is the same domain |
| `not a domain` | `null` | must match `^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`, the same shape the database CHECK enforces |
| an IDN | `null` | never stored in a second spelling |

Reduction to the **registrable domain** is the step that decides what a row can
mean:

```
mail.acme.co.uk    → acme.co.uk      (subdomain: not ownable, reported)
hsbc.com.hk        → hsbc.com.hk     (`com.hk` is a suffix, not a label)
aws.amazon.com     → amazon.com      (subdomain of a domain Amazon owns)
acme.com           → acme.com
example.de         → example.de      (a bare ccTLD domain is registrable)
```

Known limitation: the suffix set is a curated approximation
(`co, com, net, org, ac, gov, edu, …` + two-letter TLD), not the public suffix
list. It is right for `co.uk`, `com.au`, `com.hk`, `com.cn`, `ac.in`, `co.in`
and wrong for exotic suffixes (some `*.id`, `*.jp` prefectural and `*.ck`
cases). The v1 generator's version of this rule rejected every bare
`name.ccTLD`, which is why 47 rows of the committed seed are hand-checked
exceptions and the Wikidata layer contributes none; adopting a real PSL-derived
suffix table is the correct fix and belongs in the pipeline, not in the
database.

## 3. Validation ladder

Each rung is a recorded fact about the domain, and only some of them are
grounds for rejection.

| Rung | Check | On failure | Why |
| --- | --- | --- | --- |
| 1 | syntax | reject | the database CHECK would refuse it |
| 2 | free/personal provider (the app's own list) | reject | a consumer mailbox can never verify a company |
| 3 | non-company TLD (`gov`, `mil`, `edu`, `int`, `arpa`) | reject, **reported** | policy, not physics: a university is a real employer (see the open decision in the architecture doc) |
| 4 | platform domain in a *website* field | reject unless the name matches the domain | a social page is not a company site; the platform's own domain is |
| 5 | subdomain | reduce to registrable, report `subdomain_not_ownable` | ownership is a registrable-domain question |
| 6 | MX present | record as **supporting evidence only** | proves mail is hosted, not that employees use the domain |
| 7 | HTTP/HTTPS reachable | record | a dead domain is a stale directory row |
| 8 | redirect destination | record, and **refuse as evidence** | pointing at a company is not a mailbox |
| 9 | parked / for-sale page | flag for review | a parked domain is often a name a squatter holds |
| 10 | registrar / hosting platform | flag for review | "example.webflow.io" is not a company's domain |

Rungs 6–10 need network access and are deliberately **not** run by the
generator: the prototype's output is committed data, and a generator that
depends on live DNS is not reproducible. They belong in the re-check job that
populates `last_checked_at` and in the pre-promotion validation of a hint.

## 4. Classification: which kind of domain is it?

| `domain_type` | Means | Can enter `employee_email_domains` |
| --- | --- | --- |
| `primary_website` | the company's site; no mail claim | no |
| `corporate_email` | the company's mail domain, evidence-backed | yes |
| `subsidiary_email` | a subsidiary's mail domain | yes |
| `regional` | a country/region domain; it may be the local mail domain | only at medium confidence or better |
| `brand` | a brand's domain | no |
| `subsidiary` | a subsidiary's site | no |
| `historical` | a former name's domain; still resolves | no |
| `alias` | a redirect/alternate spelling of a domain above | no |

Confidence is derived, never typed:

| Tier | Rule | Weight |
| --- | --- | --- |
| `high` | ≥ 4 points with at least one first-party kind | first-party role address / legal page / security.txt / published document = 2; careers contact / published format / third-party reputable = 1 |
| `medium` | ≥ 2 points, or any first-party kind | |
| `low` | 1 point, or supporting evidence only (`mx_record`, `ct_certificate`) | |
| `unknown` | no evidence | |
| **cap** | `evidence_checked = false` caps the row at `low` | |
| **refusal** | `redirect_from_website`, `website_domain_match`, `mx_only` are refused as evidence | |

## 5. Claims, stewardship and conflicts

Ownership is **resolved, not constrained**. A domain may carry several claims
at once, because an unverified claim is evidence: we do not know who is right
until somebody proves a mailbox on it, and deleting the claim we find less
convincing loses the thing a reviewer needs to see.

What the resolver (`resolveDomainClaims`) produces per domain:

| Output | Meaning |
| --- | --- |
| `status: verified` | a member has proved the domain; the verifier is the steward |
| `status: resolved` | one claim is strictly strongest; it is the steward, and any disagreement is reported at severity `review` |
| `status: contested` | two claims tie at medium or above: **no steward is chosen**, severity `blocking` |
| `claimants[]` | every claim, with its type, confidence, evidence count and a derived `superseded` flag |

Rules:

1. Sort by confidence tier, then evidence count, then company id (so the order is
   total and reproducible).
2. A verified claim outranks every opinion, including a stronger-looking one.
3. A tie at medium or above leaves the domain **without a steward**. Nothing is
   decided by insertion order.
4. Weaker claims are kept as rows and reported; a claim on a domain somebody
   else has verified is marked `superseded` **by derivation**, never by deletion.
5. Conflicting evidence does not fail a build. `--check` fails on evidence that
   proves nothing, on a layer citing a source it may not use, and on a claim
   from a company that does not exist.
6. Only **verification** is unique:
   `company_domains_verified_domain_idx` still allows one verified claim per
   domain, because a mailbox has to resolve to one company.

An earlier draft proposed a partial unique index on *unverified* rows (one hint
per domain). It is withdrawn: it would turn a data opinion into a schema
constraint, freeze a bad seed in place, and make a contested domain
unrepresentable. See §5 of
[company-directory-architecture.md](company-directory-architecture.md).

Stewardship is also the only thing that decides which entity a proof belongs to.
When a parent and a subsidiary are both involved, the domain keeps its steward
and a **reviewed delegation** decides whether the subsidiary's staff may verify
at all (case F in the decision table).

### Retirement: how a claim stops competing without being deleted

A claim is never deleted for disagreeing. Two things can take one out of the race
for the steward, and both are *derived*:

- **a proof elsewhere** — an unverified claim on a domain somebody has proved is
  reported `superseded` by `company_domain_claims`, and the resolver stops
  considering it for the steward;
- **an operator reassignment** — `reassign_company_domain` un-verifies the old
  owner's claim and records an `operator_reassignment_retired` evidence row for
  it. Without that row the two claims would tie at the same confidence and the
  domain would read as *contested*, which is the opposite of what a reassignment
  means. The row is history: it stays, and `company_domain_claims` reports
  `retired = true`.

A retired claim is the weakest tier in the resolver, so it only surfaces as the
steward when it is the only claim left — and it says so.

## 6. Worked cases

| Case | Input | Output |
| --- | --- | --- |
| Holding company whose site is not its mail domain | Alphabet: `abc.xyz` (P856), `google.com` (curator, evidence) | `abc.xyz` = `primary_website`; `google.com` = `corporate_email` on **Google**, not Alphabet |
| Brand with no domain of its own | AWS: `aws.amazon.com` | `website_domain` recorded; **no ownable domain** (`subdomain_not_ownable`), so `@amazon.com` resolves to Amazon |
| Conglomerate | Volkswagen Group / Audi / Porsche | three companies, three domains, two `subsidiary` relationships |
| Bank with country domains | HSBC: `hsbc.com`, `hsbc.co.uk`, `hsbc.com.hk` | all owned; `hsbc.com` is the email domain, the country domains are `regional` at `low` until evidence exists |
| Regional mail domain | a company whose UK staff use `company.co.uk` | `regional` with first-party evidence = `medium` → counts as an email domain |
| Former name still routing | `facebook.com`, whose former legal owner is Meta | a **separate Facebook entity** claims it as a `brand`; Meta's `former_names` are search-only, so the brand is never merged into the parent |
| Parent and subsidiary both named | Meta Platforms and WhatsApp | separate entities; `meta.com` stays with Meta, `whatsapp.com` with WhatsApp, and neither inherits the other's domain |
| Lookalike | `Acme Technologies` → `acmetech.io` | `primary_website`, confidence `unknown`; similarity is a review signal only |
| University | IIT Bombay → `iitb.ac.in` | owned and typed `corporate_email`, but policy currently excludes non-company TLDs — kept as the explicit open decision |
| Platform operated by the entity | `linkedin.com` for LinkedIn | accepted: the name matches the domain, so the platform rule does not fire. For any other entity, refused |

## 7. What the pipeline refuses to do

- It does not infer a mail domain from a website, a redirect, or an MX record.
- It does not accept a subdomain as an ownable domain.
- It does not decide a contested domain by row order, and it does not delete the
  claim it decided against.
- It does not let a relationship (parent/subsidiary/brand) transfer a domain, or
  a delegation create a second claim on one.
- It does not silently drop anything: every refusal appears in the coverage
  report with a reason code (`free_email_provider`, `non_company_tld`,
  `subdomain_not_ownable`, `platform_not_a_company_site`, `not_a_domain`,
  `forbidden_evidence:*`).

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
| a weak claim cannot reserve a domain, a medium-or-better one can | `start_company_verification` (case H, the create path) |
| a member who explicitly selects a company and proves a mailbox on its registered domain IS verified, whatever the claim's confidence | `confirm_company_verification` (no `evidence_confidence` gate) |
| a proof is the only thing that sets `verified` | both RPCs; the import refuses an export that claims it |
| a domain whose owner changed | `public.reassign_company_domain(...)` |

Assertions: `supabase/tests/company_domain_stewardship.test.sql` (127),
`supabase/tests/company_verified_domains.test.sql` (111).
