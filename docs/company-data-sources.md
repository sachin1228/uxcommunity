# Company data sources

Which datasets the company directory may be built from, under what licence,
and what each one is and is not good for. **Generated from
`data/company-directory/sources.json`** by
`node scripts/generate-company-directory-v2.mjs --write-docs` — edit the registry,
not this file.

Registry reviewed: 2026-09-29. A licence line here is a record of what
the source states, not legal advice, and every one of them should be re-checked
against the live terms before a tier is shipped.

| Source | Status | Domain data | Redistribution | Committable here |
| --- | --- | --- | --- | --- |
| [Wikidata](https://www.wikidata.org) | adopted | P856 official website only. | yes - CC0 1.0 is a public domain dedication with no conditions | yes |
| [GLEIF LEI (Global Legal Entity Identifier) golden copy](https://www.gleif.org/en/lei-data/gleif-goldencopy-lei2-golden-copy-files) | candidate | none. | yes, under the GLEIF LEI Data Terms of Use (no warranty, no implied endorsement) | only after re-reading the current terms page; the LEI data is intended to be freely usable, and the terms page is the authority, not this file |
| [UK Companies House](https://developer.company-information.service.gov.uk/) | candidate | none. | yes - Open Government Licence v3.0 permits commercial and non-commercial reuse | yes, with the attribution below; note that the register contains personal data (officer names, service addresses) that should NOT be committed, only company-level facts |
| [SEC EDGAR (US filings)](https://www.sec.gov/edgar/sec-api-documentation) | candidate | none directly, but filings are full-text searchable and routinely contain the issuer's email domain in exhibit letters, contact blocks and exhibits filed as documents. | yes - US government works are not subject to copyright | yes for extracted company/domain facts; do not commit whole filings |
| [OpenCorporates](https://opencorporates.com) | rejected | none. | the open tier is ODbL: redistribution of a DERIVED DATABASE must itself be ODbL, with attribution and share-alike. Several national registers inside it are not openly licensed at all. | no - share-alike on a committed derived database is a licence obligation this repository has not accepted |
| [Commercial company databases (Crunchbase, ZoomInfo, D&B, Apollo, Clearbit-style data brokers)](https://www.crunchbase.com) | rejected | website domain, and in some products 'work email domain' fields. | no - subscription terms forbid redistributing the dataset or a derived mapping | no |
| [Common Crawl](https://commoncrawl.org) | candidate | hostnames and page text - the raw material for extracting published email addresses and MX hostnames. | the crawl files are openly available; the crawled CONTENT stays the copyright of each site | yes for derived DOMAIN facts (a domain published a role address on its own site); never commit an individual address, a person, or page text |
| [Public DNS (MX, TXT/DMARC, SPF) and RDAP](https://www.rfc-editor.org/rfc/rfc7483) | candidate | MX hosts, SPF include/ip4 ranges, DMARC policy, nameservers - supporting evidence that mail infrastructure exists, and WHICH provider runs it. | DNS resolution results are facts about public infrastructure; RDAP responses carry per-registry terms | yes for derived facts (this domain has MX, this domain resolves); no registrant personal data |
| [Certificate Transparency logs (Google CT, and the search interface at https://crt.sh)](https://crt.sh) | candidate | certificate SANs - useful for discovering that `mail. | yes - CT logs are append-only public audit logs | yes for derived facts (this hostname had a certificate) |
| [ROR (Research Organization Registry)](https://ror.org) | candidate | website domain, and often several (per-country and per-institute). | yes - CC0 1.0 | yes |
| [Tranco list / Cisco Umbrella top-1M](https://tranco-list.eu) | candidate | domain popularity rank. | Tranco is free to use and redistribute with citation; the Cisco Umbrella list is under Cisco's own terms | yes with citation for Tranco; check Cisco's terms for the Umbrella list |

1 adopted, 8 candidates, 2 rejected.

## Licensing matrix (the question that blocks a public repository)

A source can be perfectly usable and still not committable: a share-alike licence on a
derived database, or a subscription that forbids redistribution, is what decides whether
rows built from it may live in this repository. Rendered from
`data/company-directory/licensing.json`.

| Source | Redistribution | Derived data committable | Attribution required | API restrictions | Rate limits |
| --- | --- | --- | --- | --- | --- |
| Wikidata | yes - CC0 1.0 is a public domain dedication with no conditions | **yes** | none required; crediting Wikidata is courtesy, and the seed migration already names it | etiquette, not licence: identify the client with a descriptive User-Agent, avoid parallel bulk queries against WDQS, prefer the dumps for full copies | no published quota; WDQS throttles and returns 429/504 bodies that are not JSON, which the generator treats as a retryable failure |
| GLEIF LEI (Global Legal Entity Identifier) golden copy | yes, under the GLEIF LEI Data Terms of Use (no warranty, no implied endorsement) | **only after re-reading the current terms page; the LEI data is intended to be freely usable, and the terms page is the authority, not this file** | credit GLEIF as the source of the LEI reference data | the search API is for lookups; bulk use is expected through the golden-copy files instead | golden copy is a file download, updated three times daily; no per-request quota on the files |
| UK Companies House | yes - Open Government Licence v3.0 permits commercial and non-commercial reuse | **yes, with the attribution below; note that the register contains personal data (officer names, service addresses) that should NOT be committed, only company-level facts** | must state that the data is from Companies House and is licensed under the OGL v3.0 | the REST API is for live lookups at a sane rate; bulk extraction is expected through the bulk products and the streaming API | 600 requests per 5 minutes per API key (published) |
| SEC EDGAR (US filings) | yes - US government works are not subject to copyright | **yes for extracted company/domain facts; do not commit whole filings** | none required | automated access must declare a descriptive User-Agent with contact details and stay within the published request rate | 10 requests per second (published) |
| OpenCorporates | the open tier is ODbL: redistribution of a DERIVED DATABASE must itself be ODbL, with attribution and share-alike. Several national registers inside it are not openly licensed at all. | **no - share-alike on a committed derived database is a licence obligation this repository has not accepted** | required by ODbL where it applies | the free API tier explicitly forbids bulk extraction and re-publication | tier-dependent; the free tier is small and throttled |
| Commercial company databases (Crunchbase, ZoomInfo, D&B, Apollo, Clearbit-style data brokers) | no - subscription terms forbid redistributing the dataset or a derived mapping | **no** | n/a | redistribution and bulk export are prohibited; some vendors forbid using the data to build a competing dataset | subscription-dependent |
| Common Crawl | the crawl files are openly available; the crawled CONTENT stays the copyright of each site | **yes for derived DOMAIN facts (a domain published a role address on its own site); never commit an individual address, a person, or page text** | none required by Common Crawl; the sites' own terms still apply to their content | respect robots.txt and each site's terms for any live fetching; the crawl archives themselves are free to download | S3/HTTP index downloads are unthrottled; live per-site fetching is what needs a self-imposed limit |
| Public DNS (MX, TXT/DMARC, SPF) and RDAP | DNS resolution results are facts about public infrastructure; RDAP responses carry per-registry terms | **yes for derived facts (this domain has MX, this domain resolves); no registrant personal data** | none for DNS; RDAP output is registry-specific | bulk RDAP harvesting is against several registries' terms; use RDAP for individual lookups | registry-specific; ICANN's RDAP profile expects polite use |
| Certificate Transparency logs (Google CT, and the search interface at https://crt.sh) | yes - CT logs are append-only public audit logs | **yes for derived facts (this hostname had a certificate)** | none required | bulk querying of the popular search interfaces is discouraged; the logs themselves can be consumed directly | interface-dependent; the logs have no query quota |
| ROR (Research Organization Registry) | yes - CC0 1.0 | **yes** | none required | the API is unmetered but asks for reasonable use; monthly bulk releases exist | none published |
| Tranco list / Cisco Umbrella top-1M | Tranco is free to use and redistribute with citation; the Cisco Umbrella list is under Cisco's own terms | **yes with citation for Tranco; check Cisco's terms for the Umbrella list** | cite the Tranco paper / Tranco list as the source of the ranking | the lists are snapshots; no query API to abuse | daily file downloads |

- **Domain and email-intelligence APIs (Hunter, Clearbit-style enrichment, similar)** - their terms almost universally forbid storing or re-publishing the returned data as a dataset, which is exactly what a seeded directory is. A lookup may be permitted for an internal check; the answer may not become a committed row, and several of them derive their answers from sources we would not accept anyway.

- **People-search, breach and credential corpora** - never used, whatever a licence says: the product needs the DOMAIN, not a person, and these sources are personal data obtained from a breach in most cases.

Sources whose commit decision is conditional (re-read the live terms before a tier ships):

- GLEIF LEI (Global Legal Entity Identifier) golden copy: only after re-reading the current terms page; the LEI data is intended to be freely usable, and the terms page is the authority, not this file
- Tranco list / Cisco Umbrella top-1M: yes with citation for Tranco; check Cisco's terms for the Umbrella list

## How a source is added

1. Add an entry to `data/company-directory/sources.json` with the licence, the
   coverage, the domain availability and the limitations above.
2. Prove it on one tier (1,000 companies) before it touches a larger one, and
   keep the licence decision visible in the diff.
3. Regenerate this document and the coverage report together, so the licence and
   the rows that came from it land in the same review.

A source that is `candidate` is not read by the pipeline: the generator refuses a
layer whose source is not `adopted`, so adding one is a deliberate two-step.

## Adopted

### Wikidata

- **Licence:** CC0 1.0 (public domain dedication)
- **Terms:** https://www.wikidata.org/wiki/Wikidata:Licensing
- **Commercial use:** yes
- **Attribution required:** no
- **Coverage:** worldwide; ~100k organisations with an official website (P856). Skewed to whatever has Wikipedia articles.
- **Country coverage:** global
- **Company types:** every notable organisation, mixed with defunct, fictional and non-company entities
- **Domain availability:** P856 official website only. No email domain, ever.
- **Update frequency:** continuous; query service is a live SPARQL endpoint
- **Access:** SPARQL over HTTPS (https://query.wikidata.org/sparql); bulk dumps for full copies
- **Layer:** A discovery + B website domain
- **Redistribution:** yes - CC0 1.0 is a public domain dedication with no conditions
- **Derived data committable to this repository:** yes
- **Attribution:** none required; crediting Wikidata is courtesy, and the seed migration already names it
- **API restrictions:** etiquette, not licence: identify the client with a descriptive User-Agent, avoid parallel bulk queries against WDQS, prefer the dumps for full copies
- **Rate limits:** no published quota; WDQS throttles and returns 429/504 bodies that are not JSON, which the generator treats as a retryable failure
- **Limitations:**
  - P856 is the official WEBSITE, not the employee email domain - it is a website signal only
  - notability-gated: a company needs Wikipedia sitelinks to be present, so most small and mid-size employers are missing
  - P856 is occasionally wrong (a successor's site, a landlord's page), which is why scripts/generate-company-directory.mjs refuses low-sitelink entities whose name and domain look unrelated
  - bulk queries are rate-limited and time out easily; the query service is not an SLA-backed API

Already the source of the committed 4,574-company seed. In v2 it stays the discovery layer, but every domain it supplies is classified `primary_website` with email confidence `unknown`.

## Candidates (evaluated, not yet wired up)

### GLEIF LEI (Global Legal Entity Identifier) golden copy

- **Licence:** GLEIF LEI Data Terms of Use - free to use and redistribute, no warranty; check the current terms before shipping a product on it
- **Terms:** https://www.gleif.org/en/meta/lei-data-terms-of-use/
- **Commercial use:** yes, under the terms page above
- **Attribution required:** no
- **Coverage:** ~2.5M legal entities that participate in financial transactions; strongest for regulated financial, listed and large private entities
- **Country coverage:** global, all jurisdictions issuing LEIs
- **Company types:** legal entities with an LEI: banks, funds, subsidiaries, SPVs, some public bodies
- **Domain availability:** none. LEI reference data carries names, addresses, registration identifiers and parent relationships - not websites and not email domains.
- **Update frequency:** three times daily (golden copy files)
- **Access:** free bulk download (concatenated + delta files), plus a search API
- **Layer:** A discovery + parent/subsidiary relationships
- **Redistribution:** yes, under the GLEIF LEI Data Terms of Use (no warranty, no implied endorsement)
- **Derived data committable to this repository:** only after re-reading the current terms page; the LEI data is intended to be freely usable, and the terms page is the authority, not this file
- **Attribution:** credit GLEIF as the source of the LEI reference data
- **API restrictions:** the search API is for lookups; bulk use is expected through the golden-copy files instead
- **Rate limits:** golden copy is a file download, updated three times daily; no per-request quota on the files
- **Limitations:**
  - no domain data at all: every LEI entity starts with an empty domain slot
  - financial-participation bias: a mid-size software company may have no LEI while an empty fund does
  - names are legal names ('ACME TECHNOLOGIES INTERNATIONAL HOLDINGS B.V.'), which need heavy normalisation before they can be searched
  - the relationship field carries a parent, but it is filer-declared and sometimes stale after an acquisition

The strongest available open parent/subsidiary source (12.8M relationship records), and the reason the pipeline separates company entities from the domains they use. Requires a normaliser step (legal suffix stripping, case folding) before names can be matched against Wikidata labels.

### UK Companies House

- **Licence:** Open Government Licence v3.0 for the data on the register; the API terms add rate limits
- **Terms:** https://www.gov.uk/government/publications/companies-house-data-products
- **Commercial use:** yes (OGL permits commercial reuse with attribution)
- **Attribution required:** yes
- **Coverage:** ~5.5M UK-registered companies, including dormant shells
- **Country coverage:** United Kingdom
- **Company types:** all UK registrations: ltd, plc, LLP, dormant, dissolved
- **Domain availability:** none. The register has names, addresses, SIC codes and officers.
- **Update frequency:** continuous; free streaming API pushes changes
- **Access:** REST API (free key) + bulk product downloads (CSV) + streaming API
- **Layer:** A discovery (UK only) + C quality signals (SIC industry, active/dissolved status)
- **Redistribution:** yes - Open Government Licence v3.0 permits commercial and non-commercial reuse
- **Derived data committable to this repository:** yes, with the attribution below; note that the register contains personal data (officer names, service addresses) that should NOT be committed, only company-level facts
- **Attribution:** must state that the data is from Companies House and is licensed under the OGL v3.0
- **API restrictions:** the REST API is for live lookups at a sane rate; bulk extraction is expected through the bulk products and the streaming API
- **Rate limits:** 600 requests per 5 minutes per API key (published)
- **Limitations:**
  - no domains: a UK discovery layer still needs a separate website-resolution step
  - millions of rows are dormant or dissolved; the pipeline must filter on status before it becomes a directory
  - contains non-company registrations (charities, LLPs, some public bodies) that a company picker should not offer
  - attribution and OGL conditions apply to redistributed derivatives

The template for every other national registry adapter: one adapter per jurisdiction, all normalised into the same entity shape.

### SEC EDGAR (US filings)

- **Licence:** US government work - public domain; EDGAR access requires a declared User-Agent and rate limits
- **Terms:** https://www.sec.gov/os/webmaster-faq
- **Commercial use:** yes
- **Attribution required:** no
- **Coverage:** all US-listed registrants and many foreign private issuers
- **Country coverage:** United States registrants, global issuers
- **Company types:** listed and reporting companies (10-K/20-F filers), funds
- **Domain availability:** none directly, but filings are full-text searchable and routinely contain the issuer's email domain in exhibit letters, contact blocks and exhibits filed as documents. Excluded exhibits (e.g. material contracts) are legitimate first-party documents.
- **Update frequency:** continuous (as filings arrive)
- **Access:** EDGAR full-text search API + submissions JSON + bulk archives
- **Layer:** B/D email-domain evidence (first-party documents)
- **Redistribution:** yes - US government works are not subject to copyright
- **Derived data committable to this repository:** yes for extracted company/domain facts; do not commit whole filings
- **Attribution:** none required
- **API restrictions:** automated access must declare a descriptive User-Agent with contact details and stay within the published request rate
- **Rate limits:** 10 requests per second (published)
- **Limitations:**
  - listed companies only: meaningless as a discovery layer for a 500k global directory
  - evidence extraction needs document parsing, not a field read
  - rate limits are enforced (10 requests/second, declared User-Agent)

A first-party document that prints an address on the issuer's own domain is HIGH-quality email-domain evidence. This is the cheapest legitimate way to raise confidence above 'website domain'.

### Common Crawl

- **Licence:** the crawl is openly available; the crawled CONTENT remains the copyright of each site and re-use must respect each site's terms and robots directives
- **Terms:** https://commoncrawl.org/terms-of-use
- **Commercial use:** yes for the data, subject to the crawled sites' own terms
- **Attribution required:** no
- **Coverage:** billions of pages; host-level index covers most reachable domains
- **Country coverage:** global
- **Company types:** not a company source: a page/host source
- **Domain availability:** hostnames and page text - the raw material for extracting published email addresses and MX hostnames
- **Update frequency:** monthly crawls
- **Access:** S3/HTTP index files and WARC/WAT/WET archives
- **Layer:** D email-domain evidence (published role addresses, contact/imprint pages)
- **Redistribution:** the crawl files are openly available; the crawled CONTENT stays the copyright of each site
- **Derived data committable to this repository:** yes for derived DOMAIN facts (a domain published a role address on its own site); never commit an individual address, a person, or page text
- **Attribution:** none required by Common Crawl; the sites' own terms still apply to their content
- **API restrictions:** respect robots.txt and each site's terms for any live fetching; the crawl archives themselves are free to download
- **Rate limits:** S3/HTTP index downloads are unthrottled; live per-site fetching is what needs a self-imposed limit
- **Limitations:**
  - extraction targets are individual addresses; only the DOMAIN may be stored, never the address or the person
  - page text is untrusted: a domain mentioned in an article is not the article author's employer
  - large volumes: a per-company fetch is far cheaper than a crawl-wide scan for a first pass
  - respect robots.txt and site terms for any live fetching

The realistic source for step 4 of email-domain discovery: fetch a company's own /contact, /legal, /impressum, /.well-known/security.txt pages and keep only the domains of published addresses.

### Public DNS (MX, TXT/DMARC, SPF) and RDAP

- **Licence:** DNS resolution is public infrastructure; RDAP responses carry registry terms and are rate-limited per registry; most registrant data is redacted
- **Terms:** https://www.icann.org/resources/pages/rdap-2018-05-23-en
- **Commercial use:** resolution yes; bulk RDAP harvesting is against several registries' terms
- **Attribution required:** no
- **Coverage:** every registered domain
- **Country coverage:** global
- **Company types:** n/a
- **Domain availability:** MX hosts, SPF include/ip4 ranges, DMARC policy, nameservers - supporting evidence that mail infrastructure exists, and WHICH provider runs it
- **Update frequency:** live
- **Access:** DNS queries from the resolver of your choice; RDAP over HTTPS
- **Layer:** D supporting evidence only
- **Redistribution:** DNS resolution results are facts about public infrastructure; RDAP responses carry per-registry terms
- **Derived data committable to this repository:** yes for derived facts (this domain has MX, this domain resolves); no registrant personal data
- **Attribution:** none for DNS; RDAP output is registry-specific
- **API restrictions:** bulk RDAP harvesting is against several registries' terms; use RDAP for individual lookups
- **Rate limits:** registry-specific; ICANN's RDAP profile expects polite use
- **Limitations:**
  - MX proves that mail for the domain is hosted somewhere - it does NOT prove employees use the domain
  - Google/Microsoft/Mimecast MX records are shared by millions of unrelated domains, so the MX host says nothing about the company
  - SPF include lists leak the ESP, not the employer
  - parked domains and registrar parking often still answer MX

Recorded in the evidence model as weight 1 and never sufficient alone; see docs/company-email-domain-resolution.md.

### Certificate Transparency logs (Google CT, and the search interface at https://crt.sh)

- **Licence:** public log data; the search interface at https://crt.sh has its own terms for bulk use
- **Terms:** https://groups.google.com/a/chromium.org/g/ct-policy
- **Commercial use:** yes
- **Attribution required:** no
- **Coverage:** every publicly trusted TLS certificate issued since 2013
- **Country coverage:** global
- **Company types:** n/a
- **Domain availability:** certificate SANs - useful for discovering that `mail.company.com` or `company.net` belongs to an organisation, and for proving two domains share an operator
- **Update frequency:** live
- **Access:** HTTP queries against https://crt.sh, Google's CT API, or the log endpoints directly
- **Layer:** D subdomain/domain discovery (supporting)
- **Redistribution:** yes - CT logs are append-only public audit logs
- **Derived data committable to this repository:** yes for derived facts (this hostname had a certificate)
- **Attribution:** none required
- **API restrictions:** bulk querying of the popular search interfaces is discouraged; the logs themselves can be consumed directly
- **Rate limits:** interface-dependent; the logs have no query quota
- **Limitations:**
  - a certificate proves control of a hostname at issue time, not employment
  - wildcard certificates hide hostnames; many organisations use one CDN certificate for thousands of domains
  - shares an operator is not the same as same legal entity (agencies, SaaS platforms, acquisitions in progress)

Best used to find a company's own additional hostnames, which is how a website domain is resolved down to the registrable email domain.

### ROR (Research Organization Registry)

- **Licence:** CC0 1.0
- **Terms:** https://ror.org/about/
- **Commercial use:** yes
- **Attribution required:** no
- **Coverage:** ~110k research organisations and universities worldwide
- **Country coverage:** global
- **Company types:** universities, institutes, hospitals with research mandates, government labs
- **Domain availability:** website domain, and often several (per-country and per-institute)
- **Update frequency:** monthly releases
- **Access:** free bulk JSON/CSV + REST API, no key
- **Layer:** A discovery (academic employers) + B website domain
- **Redistribution:** yes - CC0 1.0
- **Derived data committable to this repository:** yes
- **Attribution:** none required
- **API restrictions:** the API is unmetered but asks for reasonable use; monthly bulk releases exist
- **Rate limits:** none published
- **Limitations:**
  - academic employers only
  - no email-domain field; institutional addresses still need the evidence layer
  - the current pipeline deliberately EXCLUDES academic TLDs (see docs/company-data-quality.md) - adopting ROR means revisiting that policy, because a university is a real employer whose staff have real institutional addresses

Included to make the policy question explicit rather than silent.

### Tranco list / Cisco Umbrella top-1M

- **Licence:** Tranco is a research list, free to use with citation; Cisco Umbrella publishes its top-1M for download under Cisco's terms
- **Terms:** https://tranco-list.eu/about
- **Commercial use:** Tranco: yes with citation; Umbrella: yes under Cisco terms
- **Attribution required:** yes
- **Coverage:** top 1M domains by traffic
- **Country coverage:** global, traffic-weighted
- **Company types:** domains, not companies
- **Domain availability:** domain popularity rank
- **Update frequency:** daily
- **Access:** free bulk download
- **Layer:** C ranking signal + D parked-domain detection
- **Redistribution:** Tranco is free to use and redistribute with citation; the Cisco Umbrella list is under Cisco's own terms
- **Derived data committable to this repository:** yes with citation for Tranco; check Cisco's terms for the Umbrella list
- **Attribution:** cite the Tranco paper / Tranco list as the source of the ranking
- **API restrictions:** the lists are snapshots; no query API to abuse
- **Rate limits:** daily file downloads
- **Limitations:**
  - popularity is not company size, and a domain high in the list may be a CDN, an ISP portal or an ad network
  - absurdly skewed to consumer services and to English
  - cannot discover a company that has no website

Useful as one documented input to a traffic-independent ranking signal, and for spotting that a domain in the directory is actually a hosting platform.

## Rejected (with the reason)

### OpenCorporates

- **Licence:** Open Database License (ODbL) for the open tier, with share-alike and attribution duties; bulk and commercial use require a paid agreement; several national registers inside it are NOT openly licensed
- **Terms:** https://opencorporates.com/legal/terms-of-use
- **Commercial use:** only under a commercial licence; the free API tier forbids bulk extraction
- **Attribution required:** yes
- **Coverage:** claims ~200M company records across 140+ jurisdictions (register-dependent)
- **Country coverage:** global but uneven; some jurisdictions are stubs
- **Company types:** registered legal entities, including many that no picker should offer
- **Domain availability:** none
- **Update frequency:** register-dependent
- **Access:** REST API (key, rate-limited) + paid bulk data
- **Layer:** -
- **Redistribution:** the open tier is ODbL: redistribution of a DERIVED DATABASE must itself be ODbL, with attribution and share-alike. Several national registers inside it are not openly licensed at all.
- **Derived data committable to this repository:** no - share-alike on a committed derived database is a licence obligation this repository has not accepted
- **Attribution:** required by ODbL where it applies
- **API restrictions:** the free API tier explicitly forbids bulk extraction and re-publication
- **Rate limits:** tier-dependent; the free tier is small and throttled
- **Limitations:**
  - ODbL share-alike on a derivative database is a licence obligation this project has not accepted
  - the free tier's terms prohibit the bulk extraction a 500k build needs
  - no domain data, so it would still need the whole website/email resolution layer on top

Rejected on terms, not on quality. If the directory ever needs it, the path is a paid agreement, and the licence decision belongs to whoever owns the product's legal posture - not to a generator script.

### Commercial company databases (Crunchbase, ZoomInfo, D&B, Apollo, Clearbit-style data brokers)

- **Licence:** proprietary subscription terms; typically forbid redistribution of the dataset and of derived domain->company mappings
- **Terms:** https://www.crunchbase.com/terms-of-service
- **Commercial use:** yes, under a paid subscription that usually prohibits redistribution
- **Attribution required:** no
- **Coverage:** high, including domains and (for some vendors) verified business email patterns
- **Country coverage:** global, strongest for US/Europe
- **Company types:** funded startups, SMBs, enterprises
- **Domain availability:** website domain, and in some products 'work email domain' fields
- **Update frequency:** vendor-dependent
- **Access:** paid API / bulk export
- **Layer:** -
- **Redistribution:** no - subscription terms forbid redistributing the dataset or a derived mapping
- **Derived data committable to this repository:** no
- **Attribution:** n/a
- **API restrictions:** redistribution and bulk export are prohibited; some vendors forbid using the data to build a competing dataset
- **Rate limits:** subscription-dependent
- **Limitations:**
  - redistribution of the dataset - which is what a seeded directory is - is normally prohibited
  - vendor 'work email domain' fields carry no provenance and cannot be audited
  - cost scales with rows, which is the opposite of what a seed wants

Usable only as an internal verification aid under a licence that permits it, never as committed seed data.

## Not in the registry, by design

`data/company-directory/curated.json` is not a dataset: it is hand-checked
assertions with a per-row evidence URL, and the pipeline requires every cited
source to exist in the registry. Anything without a licence and a provenance URL
does not get a layer.
