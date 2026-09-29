/**
 * Generates the default company directory migration from Wikidata.
 *
 * WHY THIS EXISTS
 *   The "Where do you work?" picker is only useful if the company a member
 *   works at is already in it, and hand-writing that list does not scale: every
 *   entry needs a name AND the domain its work emails use, and a wrong domain
 *   sends a member's proof to the wrong company. Wikidata carries both, for
 *   hundreds of thousands of organisations, under an open licence (CC0).
 *
 * WHAT IT DOES
 *   1. Asks the Wikidata Query Service for every organisation with an official
 *      website (P856) whose class is one of CLASSES below and which is linked
 *      from at least --min-sitelinks Wikipedia language editions. Sitelinks are
 *      the notability proxy: it is what separates "a company" from "every
 *      company that has ever existed", and it keeps the directory to the ones
 *      members are likely to search for.
 *   2. Reduces each official website to the domain a work email would use
 *      (`https://www.example.co.uk/careers` → `example.co.uk`), keeping the one
 *      that looks most canonical when an organisation lists several.
 *   3. Drops anything that is not a usable work-email domain: consumer mailbox
 *      providers (the same list the app enforces, read from
 *      apps/web/lib/companies/domains.ts), social profiles and site builders
 *      used in place of a real site, government and academic TLDs, and
 *      punycode/non-ASCII hosts the database's CHECK constraint would reject.
 *   4. Merges REVIEWED, the hand-checked entries this file was seeded with,
 *      which win over Wikidata — they cover the companies this community
 *      actually works at (Indian startups, in particular) that a notability
 *      threshold misses.
 *   5. Writes one migration: a row per company, plus one UNVERIFIED domain hint
 *      per company. Nothing here verifies a domain — a hint becomes a claim
 *      only when a member receives a code at a mailbox on it. See the migration
 *      header for the full explanation.
 *
 * HOW TO RUN
 *   node scripts/generate-company-directory.mjs               # write the file
 *   node scripts/generate-company-directory.mjs --dry-run     # report only
 *   node scripts/generate-company-directory.mjs --min-sitelinks 40
 *
 * Needs network access to query.wikidata.org; no credentials, no database. The
 * output is committed, so the migration itself never depends on the network —
 * regenerate it deliberately and review the diff.
 */

import { readFileSync, writeFileSync } from "node:fs";

const WDQS = "https://query.wikidata.org/sparql";
// Wikidata asks for a descriptive User-Agent so runaway clients can be
// identified; requests here are a couple of dozen, spaced out.
const USER_AGENT = "uxcommunity-company-directory/1.0 (bulk seed generation)";
const DEFAULT_OUT = "supabase/migrations/20260929140000_company_directory.sql";
const DOMAINS_SOURCE = "apps/web/lib/companies/domains.ts";

/**
 * The classes we accept as "a company", as direct `instance of` (P31) values.
 * Direct values rather than a subclass path: `P31/P279*` over a class as broad
 * as business is a guaranteed WDQS timeout, while these lookups answer in
 * seconds. The trade-off is breadth, which the sitelinks floor narrows anyway.
 */
const CLASSES = [
  ["Q4830453", "business"],
  ["Q891723", "public company"],
  ["Q6881511", "enterprise"],
  ["Q46970", "airline"],
  ["Q18388277", "technology company"],
  ["Q22687", "bank"],
  ["Q783794", "company"],
  ["Q1589009", "privately held company"],
];

/**
 * Domains that are never a company's own domain in this directory. Small or
 * defunct organisations often record a social profile or a site-builder page as
 * their official website, and a platform that appears here by name would
 * otherwise lend its domain to somebody else's row.
 */
const DENY_DOMAINS = new Set([
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "linkedin.com",
  "tiktok.com",
  "weibo.com",
  "vk.com",
  "pinterest.com",
  "snapchat.com",
  "whatsapp.com",
  "tumblr.com",
  "medium.com",
  "substack.com",
  "patreon.com",
  "wikipedia.org",
  "wikidata.org",
  "wikimedia.org",
  "archive.org",
  "wordpress.com",
  "blogspot.com",
  "weebly.com",
  "wixsite.com",
  "wix.com",
  "squarespace.com",
  "carrd.co",
  "linktr.ee",
  "beacons.ai",
  "github.io",
  "google.com",
  "sites.google.com",
  "docs.google.com",
  "forms.gle",
  "googlepages.com",
  "altervista.org",
  "blogger.com",
  "tripod.com",
  "angelfire.com",
  "geocities.com",
]);

/**
 * Two-part public suffixes (`co.uk`, `com.au`, `co.in`, …). When the label
 * before the TLD is one of these and the TLD is a two-letter country code, the
 * registrable domain is three labels, not two.
 */
const SECOND_LEVEL_LABELS = new Set([
  "co",
  "com",
  "net",
  "org",
  "gov",
  "gob",
  "edu",
  "ac",
  "gen",
  "firm",
  "ind",
  "ltd",
  "plc",
  "mil",
  "sch",
  "res",
]);

/** TLDs that belong to governments, militaries and academia, never a company. */
const NON_COMPANY_TLDS = new Set(["gov", "mil", "edu", "int", "arpa"]);

/** Matches the CHECK constraint on `public.company_domains.domain`. */
const DOMAIN_PATTERN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const allowPartial = args.has("--allow-partial");
const minSitelinks = numericFlag("--min-sitelinks", 10);
const outPath = stringFlag("--out", DEFAULT_OUT);

function numericFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

function stringFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

/**
 * The free-mailbox policy lives in the app, so read it from there rather than
 * copying it: a provider added to the app must never need adding here too.
 */
function freeEmailDomains() {
  const source = readFileSync(new URL(`../${DOMAINS_SOURCE}`, import.meta.url), "utf8");
  const block = source.match(/FREE_EMAIL_DOMAINS[^=]*=\s*\[([\s\S]*?)\]/);
  if (!block) throw new Error(`Could not read FREE_EMAIL_DOMAINS from ${DOMAINS_SOURCE}`);
  return new Set([...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]));
}

/**
 * One query against the Query Service, retried patiently.
 *
 * WDQS answers a query it cannot finish within ITS 60-second budget with an
 * error document rather than JSON (and it embeds the whole query in the body,
 * which is why the body is read as text first). The public endpoint is shared,
 * so the same query that answered in three seconds can time out a minute
 * later — patience is the fix, not a smaller query.
 */
async function wdqs(query, { attempts = 5 } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(`${WDQS}?${new URLSearchParams({ query, format: "json" })}`, {
        headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(90_000),
      });
      const text = await res.text();

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!text.trimStart().startsWith("{")) {
        // A timeout or a query error, as prose.
        throw new Error(/timeout/i.test(text) ? "query timed out" : "non-JSON response");
      }

      const body = JSON.parse(text);
      if (!body.results?.bindings) throw new Error("no bindings in response");
      // Space out requests: the endpoint is public infrastructure.
      await new Promise((resolve) => setTimeout(resolve, 300));
      return body.results.bindings;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const wait = 2500 * attempt;
      console.warn(`  … ${error.message}; retry ${attempt}/${attempts - 1} in ${wait}ms`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  throw lastError;
}

function classQuery(qid) {
  return `SELECT ?company ?website ?sitelinks WHERE {
    ?company wdt:P31 wd:${qid} .
    ?company wdt:P856 ?website .
    ?company wikibase:sitelinks ?sitelinks .
    FILTER(?sitelinks >= ${minSitelinks})
    FILTER NOT EXISTS { ?company wdt:P576 ?dissolved }
  }`;
}

/**
 * Organisations with an official website, per accepted class.
 *
 * A class that cannot be answered is FATAL, not skipped. The broad ones carry
 * thousands of entries, so a partial fetch would quietly produce a directory
 * missing whole industries — exactly the failure that is hardest to notice in a
 * diff. Failing loudly means a transient Query Service timeout costs a re-run
 * instead of a silent gap. `--allow-partial` is there for when the only goal is
 * to preview the pipeline.
 */
async function fetchCandidates() {
  const byQid = new Map();
  const incomplete = [];

  const collect = (rows) => {
    let added = 0;
    for (const row of rows) {
      const qidValue = row.company.value.split("/").pop();
      const sitelinks = Number(row.sitelinks.value);
      const existing = byQid.get(qidValue);
      if (existing) {
        existing.websites.push(row.website.value);
        existing.sitelinks = Math.max(existing.sitelinks, sitelinks);
      } else {
        byQid.set(qidValue, { qid: qidValue, sitelinks, websites: [row.website.value] });
        added++;
      }
    }
    return added;
  };

  for (const [qid, label] of CLASSES) {
    let rows = [];
    try {
      rows = await wdqs(classQuery(qid));
    } catch (error) {
      incomplete.push(`${label}: ${error.message}`);
      console.warn(`  ${label}: FAILED after retries (${error.message})`);
    }

    console.log(`  ${label.padEnd(20)} ${String(rows.length).padStart(5)} rows, ${collect(rows)} new`);
  }

  if (incomplete.length > 0) {
    const detail = incomplete.join("; ");
    if (!allowPartial) {
      throw new Error(
        `The Query Service could not answer ${incomplete.length} class(es): ${detail}. ` +
          "Nothing was written. Re-run (WDQS timeouts are usually transient), or pass --allow-partial to write an incomplete directory."
      );
    }
    console.warn(`\nINCOMPLETE (--allow-partial): ${detail}\n`);
  }

  return [...byQid.values()];
}

/**
 * English label, and the country used to group the entry by region.
 *
 * `P17` (country) is the obvious source, but plenty of organisations do not
 * carry it; for those the headquarters location (`P159`) resolves to a country
 * instead, which is what fills in the entries that would otherwise be grouped
 * as unrecorded. Country, not continent, is what splits India out of Asia.
 */
async function fetchMetadata(qids) {
  const meta = new Map();
  const batchSize = 250;

  for (let index = 0; index < qids.length; index += batchSize) {
    const batch = qids.slice(index, index + batchSize);
    const values = batch.map((qid) => `wd:${qid}`).join(" ");
    const query = `SELECT ?company ?companyLabel ?country ?continent ?hqCountry ?hqContinent WHERE {
      VALUES ?company { ${values} }
      OPTIONAL { ?company wdt:P17 ?country . OPTIONAL { ?country wdt:P30 ?continent } }
      OPTIONAL {
        ?company wdt:P159 ?hq .
        ?hq wdt:P17 ?hqCountry .
        OPTIONAL { ?hqCountry wdt:P30 ?hqContinent }
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`;

    for (const row of await wdqs(query, { attempts: 3 })) {
      const qid = row.company.value.split("/").pop();
      const current = meta.get(qid) ?? { name: null, countryQid: null, continent: null };
      current.name = row.companyLabel?.value ?? current.name;

      // P17 wins; the headquarters country only fills a gap it left.
      const candidate = row.country
        ? { qid: row.country.value.split("/").pop(), continent: row.continent?.value.split("/").pop() ?? null }
        : row.hqCountry
          ? {
              qid: row.hqCountry.value.split("/").pop(),
              continent: row.hqContinent?.value.split("/").pop() ?? null,
            }
          : null;

      if (candidate && !current.countryQid) current.countryQid = candidate.qid;
      if (candidate && !current.continent) current.continent = candidate.continent;

      meta.set(qid, current);
    }
    process.stdout.write(`  metadata ${Math.min(index + batchSize, qids.length)}/${qids.length}\r`);
  }

  console.log();
  return meta;
}

/** `https://www.example.co.uk/careers` → `example.co.uk`, or null. */
function domainFrom(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || /^\d+(\.\d+){3}$/.test(host)) return null;

  return reduceDomain(host);
}

function reduceDomain(host) {
  const labels = host.split(".");
  if (labels.length < 2) return null;

  if (labels.length > 2) {
    const secondLevel = labels[labels.length - 2];
    const tld = labels[labels.length - 1];
    const keep = secondLevel.length === 2 && tld.length === 2 && SECOND_LEVEL_LABELS.has(secondLevel) ? 3 : 2;
    return labels.slice(-keep).join(".");
  }

  return host;
}

function isUsableDomain(domain, freeEmail, { strict = true } = {}) {
  if (!domain || !DOMAIN_PATTERN.test(domain)) return false;
  if (freeEmail.has(domain)) return false;
  if (DENY_DOMAINS.has(domain)) return false;

  const tld = domain.split(".").pop();
  if (NON_COMPANY_TLDS.has(tld)) return false;
  // `ac.uk`, `ac.in`, `edu.au`: universities, not employers.
  if (domain.split(".")[domain.split(".").length - 2] === "ac") return false;

  if (strict) {
    // A single label plus a country TLD (`example.co`) is almost always a
    // truncated URL rather than the domain people have mailboxes on.
    if (domain.split(".").length === 2 && domain.split(".")[1].length === 2) return false;
  }

  return true;
}

/** Mirrors `public.company_slugify` in the migration. */
function slugify(name) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "company";
}

function cleanName(name) {
  const cleaned = (name ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 120) return null;
  // Some entries carry a description instead of a name, or a bare QID.
  if (/^Q\d+$/.test(cleaned)) return null;
  return cleaned;
}

const CONTINENT_REGION = {
  Q46: "Europe",
  Q49: "North America",
  Q48: "Asia-Pacific",
  Q18: "South America",
  Q15: "Africa",
  Q55643: "Asia-Pacific",
  Q538: "Asia-Pacific", // Oceania
};

const INDIA = "Q668";
const FALLBACK_REGION = "Region not recorded";

/**
 * Words that describe a legal form rather than the organisation, dropped before
 * a name is compared with a domain (mirrors LEGAL_ENTITY_WORDS in
 * apps/web/lib/companies/domains.ts).
 */
const LEGAL_WORDS = new Set([
  "inc",
  "incorporated",
  "ltd",
  "limited",
  "llc",
  "corp",
  "corporation",
  "company",
  "gmbh",
  "pte",
  "plc",
  "sa",
  "ag",
  "bv",
  "nv",
  "srl",
]);

/**
 * Below this many Wikipedia language editions, an entry has to look like its
 * own domain before it is kept.
 *
 * Wikidata's official-website field is hand-curated and sometimes wrong in one
 * specific and harmful way: an obscure entity points at somebody ELSE's site —
 * a successor company, a landlord, a hosting page. A missing entry costs a
 * member a search; a wrong one attaches their proof to the wrong company, and
 * because only one company may hold a domain, it can also lock the real owner
 * out. DLF Limited → godrejokhla.co.in is the shape of it.
 *
 * A famous company is allowed an unrelated domain (Alphabet → abc.xyz), and the
 * reviewed core is exempt entirely, so this only ever filters the long tail.
 */
const LOW_TRUST_SITELINKS = 30;

/**
 * Does the name and the domain plausibly describe the same organisation?
 *
 * Deliberately generous, because legitimate pairs are often abbreviations:
 * that is why the initials of the significant words count (Tata Consultancy
 * Services → tcs.com, Bharat Heavy Electricals → bhel.com, Hindustan Unilever →
 * hul.co.in), and why a shared label is enough (amazon.in for Amazon India).
 */
function nameMatchesDomain(name, domain) {
  const significant = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !LEGAL_WORDS.has(word));
  if (significant.length === 0) return false;

  const labels = domain.split(".").slice(0, -1);
  const core = labels.join("");
  const compact = significant.join("");
  const initials = significant.map((word) => word[0]).join("");
  const related = (a, b) => a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a));

  return (
    related(core, compact) ||
    related(core, initials) ||
    labels.some((label) => label.length >= 3 && significant.includes(label))
  );
}

/**
 * The hand-checked entries this directory started from. They are kept even when
 * Wikidata's notability floor would miss them, and they win on a shared slug or
 * domain, so regenerating can never silently drop a company this community
 * already had.
 */
const REVIEWED = [
  // [region, name, domain] — reviewed by hand, kept verbatim.
  ["India", "Tata Consultancy Services", "tcs.com"],
  ["India", "Infosys", "infosys.com"],
  ["India", "Wipro", "wipro.com"],
  ["India", "HCLTech", "hcltech.com"],
  ["India", "Tech Mahindra", "techmahindra.com"],
  ["India", "LTIMindtree", "ltimindtree.com"],
  ["India", "Mphasis", "mphasis.com"],
  ["India", "Persistent Systems", "persistent.com"],
  ["India", "Coforge", "coforge.com"],
  ["India", "Zensar Technologies", "zensar.com"],
  ["India", "Birlasoft", "birlasoft.com"],
  ["India", "KPIT Technologies", "kpit.com"],
  ["India", "Cyient", "cyient.com"],
  ["India", "Tata Elxsi", "tataelxsi.com"],
  ["India", "L&T Technology Services", "ltts.com"],
  ["India", "Sonata Software", "sonata-software.com"],
  ["India", "Happiest Minds Technologies", "happiestminds.com"],
  ["India", "Newgen Software", "newgensoft.com"],
  ["India", "Ramco Systems", "ramco.com"],
  ["India", "Bharti Airtel", "airtel.in"],
  ["India", "Vodafone Idea", "myvi.in"],
  ["India", "Reliance Industries", "ril.com"],
  ["India", "Jio", "jio.com"],
  ["India", "Reliance Retail", "relianceretail.com"],
  ["India", "Adani Group", "adani.com"],
  ["India", "Adani Enterprises", "adanienterprises.com"],
  ["India", "Adani Ports and SEZ", "adaniports.com"],
  ["India", "Mahindra & Mahindra", "mahindra.com"],
  ["India", "Tata Sons", "tata.com"],
  ["India", "Tata Motors", "tatamotors.com"],
  ["India", "Tata Steel", "tatasteel.com"],
  ["India", "Tata Power", "tatapower.com"],
  ["India", "Tata Communications", "tatacommunications.com"],
  ["India", "Tata Consumer Products", "tataconsumer.com"],
  ["India", "Tata 1mg", "1mg.com"],
  ["India", "Titan Company", "titancompany.in"],
  ["India", "Voltas", "voltas.in"],
  ["India", "Larsen & Toubro", "larsentoubro.com"],
  ["India", "Godrej", "godrej.com"],
  ["India", "Godrej Consumer Products", "godrejcp.com"],
  ["India", "Godrej Properties", "godrejproperties.com"],
  ["India", "Maruti Suzuki India", "marutisuzuki.com"],
  ["India", "Ashok Leyland", "ashokleyland.com"],
  ["India", "Bajaj Auto", "bajajauto.com"],
  ["India", "Hero MotoCorp", "heromotocorp.com"],
  ["India", "TVS Motor Company", "tvsmotor.com"],
  ["India", "Eicher Motors", "eichermotors.com"],
  ["India", "Bharat Forge", "bharatforge.com"],
  ["India", "Asian Paints", "asianpaints.com"],
  ["India", "Berger Paints", "bergerpaints.com"],
  ["India", "Hindustan Unilever", "hul.co.in"],
  ["India", "ITC", "itcportal.com"],
  ["India", "Britannia Industries", "britannia.co.in"],
  ["India", "Dabur", "dabur.com"],
  ["India", "Marico", "marico.com"],
  ["India", "Emami", "emamiltd.in"],
  ["India", "Amul", "amul.com"],
  ["India", "Nestle India", "nestle.in"],
  ["India", "Havells India", "havells.com"],
  ["India", "Blue Star", "bluestarindia.com"],
  ["India", "Bajaj Electricals", "bajajelectricals.com"],
  ["India", "V-Guard Industries", "vguard.in"],
  ["India", "Nilkamal", "nilkamal.com"],
  ["India", "Apollo Tyres", "apollotyres.com"],
  ["India", "CEAT", "ceat.com"],
  ["India", "JK Tyre & Industries", "jktyre.com"],
  ["India", "Page Industries", "page-ind.com"],
  ["India", "Indian Oil Corporation", "iocl.com"],
  ["India", "Bharat Petroleum", "bharatpetroleum.in"],
  ["India", "Hindustan Petroleum", "hindustanpetroleum.com"],
  ["India", "GAIL (India)", "gailonline.com"],
  ["India", "Oil and Natural Gas Corporation", "ongcindia.com"],
  ["India", "NTPC", "ntpc.co.in"],
  ["India", "Power Grid Corporation of India", "powergrid.in"],
  ["India", "Coal India", "coalindia.in"],
  ["India", "Steel Authority of India", "sail.co.in"],
  ["India", "Bharat Heavy Electricals", "bhel.com"],
  ["India", "Bharat Electronics", "bel-india.in"],
  ["India", "Hindustan Aeronautics", "hal-india.co.in"],
  ["India", "Sterlite Technologies", "sterlitetech.com"],
  ["India", "HDFC Bank", "hdfcbank.com"],
  ["India", "ICICI Bank", "icicibank.com"],
  ["India", "State Bank of India", "sbi.co.in"],
  ["India", "Axis Bank", "axisbank.com"],
  ["India", "Kotak Mahindra Bank", "kotak.com"],
  ["India", "Yes Bank", "yesbank.in"],
  ["India", "IndusInd Bank", "indusind.com"],
  ["India", "Bank of Baroda", "bankofbaroda.in"],
  ["India", "Punjab National Bank", "pnbindia.in"],
  ["India", "IDFC FIRST Bank", "idfcfirstbank.com"],
  ["India", "Federal Bank", "federalbank.co.in"],
  ["India", "HDFC Life", "hdfclife.com"],
  ["India", "HDFC Securities", "hdfcsec.com"],
  ["India", "ICICI Lombard", "icicilombard.com"],
  ["India", "SBI Life Insurance", "sbilife.co.in"],
  ["India", "Life Insurance Corporation of India", "licindia.in"],
  ["India", "Bajaj Finserv", "bajajfinserv.in"],
  ["India", "Bajaj Allianz", "bajajallianz.com"],
  ["India", "Muthoot Finance", "muthootfinance.com"],
  ["India", "Motilal Oswal", "motilaloswal.com"],
  ["India", "Kotak Securities", "kotaksecurities.com"],
  ["India", "Policybazaar", "policybazaar.com"],
  ["India", "Paytm", "paytm.com"],
  ["India", "PhonePe", "phonepe.com"],
  ["India", "Razorpay", "razorpay.com"],
  ["India", "CRED", "cred.club"],
  ["India", "Zerodha", "zerodha.com"],
  ["India", "Groww", "groww.in"],
  ["India", "Angel One", "angelone.in"],
  ["India", "Upstox", "upstox.com"],
  ["India", "ClearTax", "cleartax.in"],
  ["India", "Cashfree Payments", "cashfree.com"],
  ["India", "Pine Labs", "pinelabs.com"],
  ["India", "BharatPe", "bharatpe.com"],
  ["India", "Juspay", "juspay.in"],
  ["India", "Lendingkart", "lendingkart.com"],
  ["India", "Rupeek", "rupeek.com"],
  ["India", "Flipkart", "flipkart.com"],
  ["India", "Myntra", "myntra.com"],
  ["India", "Meesho", "meesho.com"],
  ["India", "Nykaa", "nykaa.com"],
  ["India", "Snapdeal", "snapdeal.com"],
  ["India", "BigBasket", "bigbasket.com"],
  ["India", "Ajio", "ajio.com"],
  ["India", "Tata CLiQ", "tatacliq.com"],
  ["India", "Croma", "croma.com"],
  ["India", "Reliance Digital", "reliancedigital.in"],
  ["India", "JioMart", "jiomart.com"],
  ["India", "FirstCry", "firstcry.com"],
  ["India", "Lenskart", "lenskart.com"],
  ["India", "Pepperfry", "pepperfry.com"],
  ["India", "Wakefit", "wakefit.co"],
  ["India", "boAt", "boat-lifestyle.com"],
  ["India", "Mamaearth", "mamaearth.in"],
  ["India", "Purplle", "purplle.com"],
  ["India", "FabIndia", "fabindia.com"],
  ["India", "Zivame", "zivame.com"],
  ["India", "Bewakoof", "bewakoof.com"],
  ["India", "Urban Ladder", "urbanladder.com"],
  ["India", "Livspace", "livspace.com"],
  ["India", "HomeLane", "homelane.com"],
  ["India", "Swiggy", "swiggy.com"],
  ["India", "Zomato", "zomato.com"],
  ["India", "Blinkit", "blinkit.com"],
  ["India", "Zepto", "zeptonow.com"],
  ["India", "Licious", "licious.in"],
  ["India", "Country Delight", "countrydelight.in"],
  ["India", "Urban Company", "urbancompany.com"],
  ["India", "OYO", "oyorooms.com"],
  ["India", "MakeMyTrip", "makemytrip.com"],
  ["India", "Cleartrip", "cleartrip.com"],
  ["India", "ixigo", "ixigo.com"],
  ["India", "Yatra", "yatra.com"],
  ["India", "Goibibo", "goibibo.com"],
  ["India", "redBus", "redbus.in"],
  ["India", "IRCTC", "irctc.co.in"],
  ["India", "IndiGo", "goindigo.in"],
  ["India", "Air India", "airindia.com"],
  ["India", "SpiceJet", "spicejet.com"],
  ["India", "Akasa Air", "akasaair.com"],
  ["India", "Ola", "olacabs.com"],
  ["India", "Ola Electric", "olaelectric.com"],
  ["India", "Rapido", "rapido.bike"],
  ["India", "Delhivery", "delhivery.com"],
  ["India", "Blue Dart", "bluedart.com"],
  ["India", "Ecom Express", "ecomexpress.com"],
  ["India", "Porter", "porter.in"],
  ["India", "BlackBuck", "blackbuck.com"],
  ["India", "Zetwerk", "zetwerk.com"],
  ["India", "Udaan", "udaan.com"],
  ["India", "Ninjacart", "ninjacart.com"],
  ["India", "Shadowfax", "shadowfax.in"],
  ["India", "Dr. Reddy's Laboratories", "drreddys.com"],
  ["India", "Cipla", "cipla.com"],
  ["India", "Sun Pharmaceutical", "sunpharma.com"],
  ["India", "Lupin", "lupin.com"],
  ["India", "Torrent Pharmaceuticals", "torrentpharma.com"],
  ["India", "Zydus Lifesciences", "zyduslife.com"],
  ["India", "Glenmark Pharmaceuticals", "glenmarkpharma.com"],
  ["India", "Biocon", "biocon.com"],
  ["India", "Piramal Group", "piramal.com"],
  ["India", "Wockhardt", "wockhardt.com"],
  ["India", "Apollo Hospitals", "apollohospitals.com"],
  ["India", "Fortis Healthcare", "fortishealthcare.com"],
  ["India", "Max Healthcare", "maxhealthcare.in"],
  ["India", "Manipal Hospitals", "manipalhospitals.com"],
  ["India", "Practo", "practo.com"],
  ["India", "PharmEasy", "pharmeasy.in"],
  ["India", "MedPlus Health Services", "medplusindia.com"],
  ["India", "Thyrocare", "thyrocare.com"],
  ["India", "Metropolis Healthcare", "metropolisindia.com"],
  ["India", "BYJU'S", "byjus.com"],
  ["India", "Unacademy", "unacademy.com"],
  ["India", "upGrad", "upgrad.com"],
  ["India", "Eruditus", "eruditus.com"],
  ["India", "Vedantu", "vedantu.com"],
  ["India", "Physics Wallah", "pw.live"],
  ["India", "Aakash Educational Services", "aakash.ac.in"],
  ["India", "Simplilearn", "simplilearn.com"],
  ["India", "Great Learning", "mygreatlearning.com"],
  ["India", "Scaler", "scaler.com"],
  ["India", "Emeritus", "emeritus.org"],
  ["India", "Housing.com", "housing.com"],
  ["India", "MagicBricks", "magicbricks.com"],
  ["India", "99acres", "99acres.com"],
  ["India", "NoBroker", "nobroker.in"],
  ["India", "PropTiger", "proptiger.com"],
  ["India", "Square Yards", "squareyards.com"],
  ["India", "Anarock", "anarock.com"],
  ["India", "DLF", "dlf.in"],
  ["India", "Lodha Group", "lodhagroup.in"],
  ["India", "Oberoi Realty", "oberoirealty.com"],
  ["India", "Prestige Group", "prestigeconstructions.com"],
  ["India", "Freshworks", "freshworks.com"],
  ["India", "Postman", "postman.com"],
  ["India", "BrowserStack", "browserstack.com"],
  ["India", "Chargebee", "chargebee.com"],
  ["India", "Hasura", "hasura.io"],
  ["India", "CleverTap", "clevertap.com"],
  ["India", "MoEngage", "moengage.com"],
  ["India", "Darwinbox", "darwinbox.com"],
  ["India", "LeadSquared", "leadsquared.com"],
  ["India", "Kissflow", "kissflow.com"],
  ["India", "Wingify", "wingify.com"],
  ["India", "Uniphore", "uniphore.com"],
  ["India", "Gupshup", "gupshup.io"],
  ["India", "Innovaccer", "innovaccer.com"],
  ["India", "Fractal Analytics", "fractal.ai"],
  ["India", "Tredence", "tredence.com"],
  ["India", "Mu Sigma", "mu-sigma.com"],
  ["India", "Whatfix", "whatfix.com"],
  ["India", "Icertis", "icertis.com"],
  ["India", "Druva", "druva.com"],
  ["India", "Mindtickle", "mindtickle.com"],
  ["India", "Zenoti", "zenoti.com"],
  ["India", "Amagi", "amagi.com"],
  ["India", "InMobi", "inmobi.com"],
  ["India", "Games24x7", "games24x7.com"],
  ["India", "Dream11", "dream11.com"],
  ["India", "Nazara Technologies", "nazara.com"],
  ["India", "ShareChat", "sharechat.com"],
  ["India", "Dailyhunt", "dailyhunt.in"],
  ["India", "Tracxn", "tracxn.com"],
  ["India", "Bennett, Coleman & Co.", "timesofindia.com"],
  ["India", "The Hindu Group", "thehindu.com"],
  ["India", "NDTV", "ndtv.com"],
  ["India", "Zee Entertainment Enterprises", "zee.com"],
  ["India", "BookMyShow", "bookmyshow.com"],
  ["India", "Gaana", "gaana.com"],
  ["India", "JioSaavn", "saavn.com"],
  ["India", "JioHotstar", "hotstar.com"],
  ["India", "Nagarro", "nagarro.com"],
  ["North America", "Apple", "apple.com"],
  ["North America", "Microsoft", "microsoft.com"],
  ["North America", "Google", "google.com"],
  ["North America", "Amazon", "amazon.com"],
  ["North America", "Meta", "meta.com"],
  ["North America", "Netflix", "netflix.com"],
  ["North America", "NVIDIA", "nvidia.com"],
  ["North America", "Intel", "intel.com"],
  ["North America", "Advanced Micro Devices", "amd.com"],
  ["North America", "Qualcomm", "qualcomm.com"],
  ["North America", "Broadcom", "broadcom.com"],
  ["North America", "Micron Technology", "micron.com"],
  ["North America", "Texas Instruments", "ti.com"],
  ["North America", "IBM", "ibm.com"],
  ["North America", "Oracle", "oracle.com"],
  ["North America", "Salesforce", "salesforce.com"],
  ["North America", "Adobe", "adobe.com"],
  ["North America", "Cisco", "cisco.com"],
  ["North America", "Dell Technologies", "dell.com"],
  ["North America", "HP", "hp.com"],
  ["North America", "Hewlett Packard Enterprise", "hpe.com"],
  ["North America", "Western Digital", "westerndigital.com"],
  ["North America", "Seagate Technology", "seagate.com"],
  ["North America", "Xerox", "xerox.com"],
  ["North America", "Juniper Networks", "juniper.net"],
  ["North America", "Palo Alto Networks", "paloaltonetworks.com"],
  ["North America", "Fortinet", "fortinet.com"],
  ["North America", "CrowdStrike", "crowdstrike.com"],
  ["North America", "Zscaler", "zscaler.com"],
  ["North America", "Okta", "okta.com"],
  ["North America", "Splunk", "splunk.com"],
  ["North America", "Datadog", "datadoghq.com"],
  ["North America", "MongoDB", "mongodb.com"],
  ["North America", "Snowflake", "snowflake.com"],
  ["North America", "Databricks", "databricks.com"],
  ["North America", "Confluent", "confluent.io"],
  ["North America", "Elastic", "elastic.co"],
  ["North America", "HashiCorp", "hashicorp.com"],
  ["North America", "Cloudflare", "cloudflare.com"],
  ["North America", "Twilio", "twilio.com"],
  ["North America", "Stripe", "stripe.com"],
  ["North America", "Block", "block.xyz"],
  ["North America", "PayPal", "paypal.com"],
  ["North America", "Visa", "visa.com"],
  ["North America", "Mastercard", "mastercard.com"],
  ["North America", "American Express", "americanexpress.com"],
  ["North America", "JPMorganChase", "jpmorganchase.com"],
  ["North America", "Goldman Sachs", "goldmansachs.com"],
  ["North America", "Morgan Stanley", "morganstanley.com"],
  ["North America", "Bank of America", "bankofamerica.com"],
  ["North America", "Wells Fargo", "wellsfargo.com"],
  ["North America", "Citigroup", "citigroup.com"],
  ["North America", "Capital One", "capitalone.com"],
  ["North America", "Charles Schwab", "schwab.com"],
  ["North America", "Fidelity Investments", "fidelity.com"],
  ["North America", "BlackRock", "blackrock.com"],
  ["North America", "Vanguard", "vanguard.com"],
  ["North America", "State Street", "statestreet.com"],
  ["North America", "Berkshire Hathaway", "berkshirehathaway.com"],
  ["North America", "Blackstone", "blackstone.com"],
  ["North America", "KKR", "kkr.com"],
  ["North America", "Bain Capital", "baincapital.com"],
  ["North America", "McKinsey & Company", "mckinsey.com"],
  ["North America", "Boston Consulting Group", "bcg.com"],
  ["North America", "Bain & Company", "bain.com"],
  ["North America", "Deloitte", "deloitte.com"],
  ["North America", "PwC", "pwc.com"],
  ["North America", "EY", "ey.com"],
  ["North America", "KPMG", "kpmg.com"],
  ["North America", "Airbnb", "airbnb.com"],
  ["North America", "Uber", "uber.com"],
  ["North America", "Lyft", "lyft.com"],
  ["North America", "DoorDash", "doordash.com"],
  ["North America", "Instacart", "instacart.com"],
  ["North America", "eBay", "ebay.com"],
  ["North America", "Etsy", "etsy.com"],
  ["North America", "Walmart", "walmart.com"],
  ["North America", "Target", "target.com"],
  ["North America", "Costco Wholesale", "costco.com"],
  ["North America", "The Home Depot", "homedepot.com"],
  ["North America", "Lowe's", "lowes.com"],
  ["North America", "Best Buy", "bestbuy.com"],
  ["North America", "The Kroger Co.", "kroger.com"],
  ["North America", "Albertsons Companies", "albertsons.com"],
  ["North America", "Walgreens Boots Alliance", "walgreens.com"],
  ["North America", "CVS Health", "cvshealth.com"],
  ["North America", "Nike", "nike.com"],
  ["North America", "Starbucks", "starbucks.com"],
  ["North America", "McDonald's", "mcdonalds.com"],
  ["North America", "Chipotle Mexican Grill", "chipotle.com"],
  ["North America", "Domino's Pizza", "dominos.com"],
  ["North America", "Yum! Brands", "yum.com"],
  ["North America", "PepsiCo", "pepsico.com"],
  ["North America", "The Coca-Cola Company", "coca-cola.com"],
  ["North America", "Mondelez International", "mondelezinternational.com"],
  ["North America", "The Kraft Heinz Company", "kraftheinzcompany.com"],
  ["North America", "General Mills", "generalmills.com"],
  ["North America", "Kellanova", "kellanova.com"],
  ["North America", "Mars", "mars.com"],
  ["North America", "Procter & Gamble", "pg.com"],
  ["North America", "Colgate-Palmolive", "colgatepalmolive.com"],
  ["North America", "Kimberly-Clark", "kimberly-clark.com"],
  ["North America", "Johnson & Johnson", "jnj.com"],
  ["North America", "Pfizer", "pfizer.com"],
  ["North America", "Merck", "merck.com"],
  ["North America", "AbbVie", "abbvie.com"],
  ["North America", "Eli Lilly and Company", "lilly.com"],
  ["North America", "Bristol Myers Squibb", "bms.com"],
  ["North America", "Amgen", "amgen.com"],
  ["North America", "Gilead Sciences", "gilead.com"],
  ["North America", "Moderna", "modernatx.com"],
  ["North America", "Thermo Fisher Scientific", "thermofisher.com"],
  ["North America", "Medtronic", "medtronic.com"],
  ["North America", "Boston Scientific", "bostonscientific.com"],
  ["North America", "Abbott", "abbott.com"],
  ["North America", "UnitedHealth Group", "unitedhealthgroup.com"],
  ["North America", "Cigna", "cigna.com"],
  ["North America", "Elevance Health", "elevancehealth.com"],
  ["North America", "Kaiser Permanente", "kp.org"],
  ["North America", "HCA Healthcare", "hcahealthcare.com"],
  ["North America", "Boeing", "boeing.com"],
  ["North America", "Lockheed Martin", "lockheedmartin.com"],
  ["North America", "Northrop Grumman", "northropgrumman.com"],
  ["North America", "RTX", "rtx.com"],
  ["North America", "General Dynamics", "gd.com"],
  ["North America", "General Motors", "gm.com"],
  ["North America", "Ford Motor Company", "ford.com"],
  ["North America", "Tesla", "tesla.com"],
  ["North America", "Rivian", "rivian.com"],
  ["North America", "Lucid Motors", "lucidmotors.com"],
  ["North America", "Caterpillar", "cat.com"],
  ["North America", "Deere & Company", "deere.com"],
  ["North America", "Honeywell", "honeywell.com"],
  ["North America", "3M", "3m.com"],
  ["North America", "General Electric", "ge.com"],
  ["North America", "Emerson Electric", "emerson.com"],
  ["North America", "Rockwell Automation", "rockwellautomation.com"],
  ["North America", "Johnson Controls", "johnsoncontrols.com"],
  ["North America", "Carrier", "carrier.com"],
  ["North America", "Otis Worldwide", "otis.com"],
  ["North America", "Union Pacific", "up.com"],
  ["North America", "Delta Air Lines", "delta.com"],
  ["North America", "United Airlines", "united.com"],
  ["North America", "American Airlines", "aa.com"],
  ["North America", "Southwest Airlines", "southwest.com"],
  ["North America", "FedEx", "fedex.com"],
  ["North America", "UPS", "ups.com"],
  ["North America", "The Walt Disney Company", "disney.com"],
  ["North America", "Warner Bros. Discovery", "wbd.com"],
  ["North America", "Paramount", "paramount.com"],
  ["North America", "Comcast", "comcast.com"],
  ["North America", "Charter Communications", "charter.com"],
  ["North America", "Verizon", "verizon.com"],
  ["North America", "AT&T", "att.com"],
  ["North America", "T-Mobile US", "t-mobile.com"],
  ["North America", "Reddit", "reddit.com"],
  ["North America", "Snap", "snap.com"],
  ["North America", "Pinterest", "pinterest.com"],
  ["North America", "LinkedIn", "linkedin.com"],
  ["North America", "X", "x.com"],
  ["North America", "Zoom", "zoom.us"],
  ["North America", "DocuSign", "docusign.com"],
  ["North America", "Intuit", "intuit.com"],
  ["North America", "Workday", "workday.com"],
  ["North America", "ServiceNow", "servicenow.com"],
  ["North America", "HubSpot", "hubspot.com"],
  ["North America", "Zendesk", "zendesk.com"],
  ["North America", "Asana", "asana.com"],
  ["North America", "Airtable", "airtable.com"],
  ["North America", "Notion Labs", "notion.so"],
  ["North America", "Figma", "figma.com"],
  ["North America", "Dropbox", "dropbox.com"],
  ["North America", "Box", "box.com"],
  ["North America", "VMware", "vmware.com"],
  ["North America", "Red Hat", "redhat.com"],
  ["North America", "GitHub", "github.com"],
  ["North America", "GitLab", "gitlab.com"],
  ["North America", "Docker", "docker.com"],
  ["North America", "OpenAI", "openai.com"],
  ["North America", "Anthropic", "anthropic.com"],
  ["North America", "Scale AI", "scale.com"],
  ["North America", "Palantir Technologies", "palantir.com"],
  ["North America", "Anduril Industries", "anduril.com"],
  ["North America", "SpaceX", "spacex.com"],
  ["North America", "Blue Origin", "blueorigin.com"],
  ["North America", "Waymo", "waymo.com"],
  ["North America", "Coinbase", "coinbase.com"],
  ["North America", "Robinhood", "robinhood.com"],
  ["North America", "SoFi", "sofi.com"],
  ["North America", "Chime", "chime.com"],
  ["North America", "Affirm", "affirm.com"],
  ["North America", "Plaid", "plaid.com"],
  ["North America", "Ramp", "ramp.com"],
  ["North America", "Brex", "brex.com"],
  ["North America", "Gusto", "gusto.com"],
  ["North America", "Rippling", "rippling.com"],
  ["North America", "Deel", "deel.com"],
  ["North America", "Expensify", "expensify.com"],
  ["North America", "Zillow", "zillow.com"],
  ["North America", "Redfin", "redfin.com"],
  ["North America", "Compass", "compass.com"],
  ["North America", "Opendoor", "opendoor.com"],
  ["North America", "WeWork", "wework.com"],
  ["North America", "Shopify", "shopify.com"],
  ["North America", "Hootsuite", "hootsuite.com"],
  ["North America", "OpenText", "opentext.com"],
  ["North America", "Telus", "telus.com"],
  ["North America", "Rogers Communications", "rogers.com"],
  ["North America", "Canadian Tire", "canadiantire.ca"],
  ["North America", "Loblaw Companies", "loblaw.ca"],
  ["North America", "Bombardier", "bombardier.com"],
  ["North America", "Air Canada", "aircanada.com"],
  ["North America", "Tim Hortons", "timhortons.com"],
  ["North America", "Thomson Reuters", "thomsonreuters.com"],
  ["Europe", "SAP", "sap.com"],
  ["Europe", "Siemens", "siemens.com"],
  ["Europe", "Bosch", "bosch.com"],
  ["Europe", "BMW Group", "bmw.com"],
  ["Europe", "Mercedes-Benz Group", "mercedes-benz.com"],
  ["Europe", "Volkswagen Group", "volkswagen.com"],
  ["Europe", "Audi", "audi.com"],
  ["Europe", "Porsche", "porsche.com"],
  ["Europe", "Continental", "continental.com"],
  ["Europe", "ZF Friedrichshafen", "zf.com"],
  ["Europe", "BASF", "basf.com"],
  ["Europe", "Bayer", "bayer.com"],
  ["Europe", "Henkel", "henkel.com"],
  ["Europe", "Adidas", "adidas.com"],
  ["Europe", "Puma", "puma.com"],
  ["Europe", "Lufthansa", "lufthansa.com"],
  ["Europe", "Deutsche Bank", "db.com"],
  ["Europe", "Allianz", "allianz.com"],
  ["Europe", "Munich Re", "munichre.com"],
  ["Europe", "Deutsche Telekom", "telekom.com"],
  ["Europe", "Infineon Technologies", "infineon.com"],
  ["Europe", "ASML", "asml.com"],
  ["Europe", "Philips", "philips.com"],
  ["Europe", "ING", "ing.com"],
  ["Europe", "Ahold Delhaize", "aholddelhaize.com"],
  ["Europe", "Heineken", "heineken.com"],
  ["Europe", "Shell", "shell.com"],
  ["Europe", "Unilever", "unilever.com"],
  ["Europe", "BP", "bp.com"],
  ["Europe", "HSBC", "hsbc.com"],
  ["Europe", "Barclays", "barclays.com"],
  ["Europe", "Lloyds Banking Group", "lloydsbanking.com"],
  ["Europe", "NatWest Group", "natwest.com"],
  ["Europe", "Standard Chartered", "sc.com"],
  ["Europe", "Vodafone Group", "vodafone.com"],
  ["Europe", "BT Group", "bt.com"],
  ["Europe", "AstraZeneca", "astrazeneca.com"],
  ["Europe", "GSK", "gsk.com"],
  ["Europe", "Diageo", "diageo.com"],
  ["Europe", "Tesco", "tesco.com"],
  ["Europe", "Sainsbury's", "sainsburys.co.uk"],
  ["Europe", "Marks & Spencer", "marksandspencer.com"],
  ["Europe", "Burberry", "burberry.com"],
  ["Europe", "Rolls-Royce", "rolls-royce.com"],
  ["Europe", "BAE Systems", "baesystems.com"],
  ["Europe", "Arm", "arm.com"],
  ["Europe", "Ocado Group", "ocado.com"],
  ["Europe", "Deliveroo", "deliveroo.co.uk"],
  ["Europe", "Monzo", "monzo.com"],
  ["Europe", "Revolut", "revolut.com"],
  ["Europe", "Wise", "wise.com"],
  ["Europe", "Checkout.com", "checkout.com"],
  ["Europe", "Spotify", "spotify.com"],
  ["Europe", "Klarna", "klarna.com"],
  ["Europe", "Ericsson", "ericsson.com"],
  ["Europe", "Volvo Cars", "volvocars.com"],
  ["Europe", "IKEA", "ikea.com"],
  ["Europe", "H&M", "hm.com"],
  ["Europe", "Electrolux", "electrolux.com"],
  ["Europe", "Atlas Copco", "atlascopco.com"],
  ["Europe", "Sandvik", "sandvik.com"],
  ["Europe", "Nokia", "nokia.com"],
  ["Europe", "Novo Nordisk", "novonordisk.com"],
  ["Europe", "Maersk", "maersk.com"],
  ["Europe", "LEGO Group", "lego.com"],
  ["Europe", "Nestle", "nestle.com"],
  ["Europe", "Roche", "roche.com"],
  ["Europe", "Novartis", "novartis.com"],
  ["Europe", "UBS", "ubs.com"],
  ["Europe", "Zurich Insurance Group", "zurich.com"],
  ["Europe", "Logitech", "logitech.com"],
  ["Europe", "STMicroelectronics", "st.com"],
  ["Europe", "Schneider Electric", "se.com"],
  ["Europe", "L'Oreal", "loreal.com"],
  ["Europe", "LVMH", "lvmh.com"],
  ["Europe", "Kering", "kering.com"],
  ["Europe", "Airbus", "airbus.com"],
  ["Europe", "Safran", "safran-group.com"],
  ["Europe", "Thales Group", "thalesgroup.com"],
  ["Europe", "Dassault Systemes", "3ds.com"],
  ["Europe", "TotalEnergies", "totalenergies.com"],
  ["Europe", "Engie", "engie.com"],
  ["Europe", "Renault Group", "renaultgroup.com"],
  ["Europe", "Michelin", "michelin.com"],
  ["Europe", "Danone", "danone.com"],
  ["Europe", "Carrefour", "carrefour.com"],
  ["Europe", "BNP Paribas", "bnpparibas.com"],
  ["Europe", "Societe Generale", "societegenerale.com"],
  ["Europe", "AXA", "axa.com"],
  ["Europe", "Ubisoft", "ubisoft.com"],
  ["Europe", "Capgemini", "capgemini.com"],
  ["Europe", "Enel", "enel.com"],
  ["Europe", "Eni", "eni.com"],
  ["Europe", "Ferrari", "ferrari.com"],
  ["Europe", "Stellantis", "stellantis.com"],
  ["Europe", "Pirelli", "pirelli.com"],
  ["Europe", "Assicurazioni Generali", "generali.com"],
  ["Europe", "Intesa Sanpaolo", "intesasanpaolo.com"],
  ["Europe", "Barilla", "barilla.com"],
  ["Europe", "Ferrero", "ferrero.com"],
  ["Europe", "EssilorLuxottica", "luxottica.com"],
  ["Europe", "Prada", "prada.com"],
  ["Europe", "Inditex", "inditex.com"],
  ["Europe", "Zara", "zara.com"],
  ["Europe", "Banco Santander", "santander.com"],
  ["Europe", "BBVA", "bbva.com"],
  ["Europe", "Telefónica", "telefonica.com"],
  ["Europe", "Iberdrola", "iberdrola.com"],
  ["Europe", "Repsol", "repsol.com"],
  ["Europe", "Accenture", "accenture.com"],
  ["Europe", "Ryanair", "ryanair.com"],
  ["Europe", "Kerry Group", "kerry.com"],
  ["Europe", "Coca-Cola HBC", "coca-colahellenic.com"],
  ["Europe", "Wolt", "wolt.com"],
  ["Europe", "Supercell", "supercell.com"],
  ["Europe", "Rovio", "rovio.com"],
  ["Europe", "Vestas", "vestas.com"],
  ["Europe", "Orsted", "orsted.com"],
  ["Europe", "Bang & Olufsen", "bang-olufsen.com"],
  ["Europe", "Zalando", "zalando.com"],
  ["Europe", "Otto Group", "ottogroup.com"],
  ["Europe", "Delivery Hero", "deliveryhero.com"],
  ["Europe", "HelloFresh", "hellofresh.com"],
  ["Europe", "N26", "n26.com"],
  ["Europe", "Celonis", "celonis.com"],
  ["Europe", "Personio", "personio.com"],
  ["Europe", "Bolt", "bolt.eu"],
  ["Asia-Pacific", "Samsung Electronics", "samsung.com"],
  ["Asia-Pacific", "LG", "lg.com"],
  ["Asia-Pacific", "Hyundai Motor Company", "hyundai.com"],
  ["Asia-Pacific", "Kia", "kia.com"],
  ["Asia-Pacific", "SK Hynix", "skhynix.com"],
  ["Asia-Pacific", "Naver", "navercorp.com"],
  ["Asia-Pacific", "Kakao", "kakaocorp.com"],
  ["Asia-Pacific", "Coupang", "coupang.com"],
  ["Asia-Pacific", "Sony", "sony.com"],
  ["Asia-Pacific", "Toyota Motor Corporation", "toyota.com"],
  ["Asia-Pacific", "Honda", "honda.com"],
  ["Asia-Pacific", "Nissan Motor", "nissan-global.com"],
  ["Asia-Pacific", "Panasonic", "panasonic.com"],
  ["Asia-Pacific", "Hitachi", "hitachi.com"],
  ["Asia-Pacific", "Toshiba", "toshiba.com"],
  ["Asia-Pacific", "Fujitsu", "fujitsu.com"],
  ["Asia-Pacific", "NEC", "nec.com"],
  ["Asia-Pacific", "Canon", "canon.com"],
  ["Asia-Pacific", "Nikon", "nikon.com"],
  ["Asia-Pacific", "Fujifilm", "fujifilm.com"],
  ["Asia-Pacific", "Nintendo", "nintendo.com"],
  ["Asia-Pacific", "Rakuten", "rakuten.com"],
  ["Asia-Pacific", "SoftBank", "softbank.jp"],
  ["Asia-Pacific", "NTT", "ntt.com"],
  ["Asia-Pacific", "Fast Retailing", "fastretailing.com"],
  ["Asia-Pacific", "Uniqlo", "uniqlo.com"],
  ["Asia-Pacific", "Bridgestone", "bridgestone.com"],
  ["Asia-Pacific", "Denso", "denso.com"],
  ["Asia-Pacific", "Mitsubishi Electric", "mitsubishielectric.com"],
  ["Asia-Pacific", "Mitsui & Co.", "mitsui.com"],
  ["Asia-Pacific", "Mitsubishi UFJ Financial Group", "mufg.jp"],
  ["Asia-Pacific", "Alibaba Group", "alibaba.com"],
  ["Asia-Pacific", "Tencent", "tencent.com"],
  ["Asia-Pacific", "ByteDance", "bytedance.com"],
  ["Asia-Pacific", "TikTok", "tiktok.com"],
  ["Asia-Pacific", "JD.com", "jd.com"],
  ["Asia-Pacific", "Baidu", "baidu.com"],
  ["Asia-Pacific", "Xiaomi", "mi.com"],
  ["Asia-Pacific", "Huawei", "huawei.com"],
  ["Asia-Pacific", "Lenovo", "lenovo.com"],
  ["Asia-Pacific", "OPPO", "oppo.com"],
  ["Asia-Pacific", "vivo", "vivo.com"],
  ["Asia-Pacific", "Meituan", "meituan.com"],
  ["Asia-Pacific", "DiDi", "didiglobal.com"],
  ["Asia-Pacific", "PDD Holdings", "pinduoduo.com"],
  ["Asia-Pacific", "Contemporary Amperex Technology", "catl.com"],
  ["Asia-Pacific", "BYD", "byd.com"],
  ["Asia-Pacific", "Sinopec", "sinopec.com"],
  ["Asia-Pacific", "Industrial and Commercial Bank of China", "icbc.com.cn"],
  ["Asia-Pacific", "Ping An Insurance", "pingan.com"],
  ["Asia-Pacific", "Taiwan Semiconductor Manufacturing", "tsmc.com"],
  ["Asia-Pacific", "Foxconn", "foxconn.com"],
  ["Asia-Pacific", "MediaTek", "mediatek.com"],
  ["Asia-Pacific", "ASUS", "asus.com"],
  ["Asia-Pacific", "Acer", "acer.com"],
  ["Asia-Pacific", "HTC", "htc.com"],
  ["Asia-Pacific", "Grab", "grab.com"],
  ["Asia-Pacific", "Sea Limited", "sea.com"],
  ["Asia-Pacific", "GoTo Group", "gotocompany.com"],
  ["Asia-Pacific", "Traveloka", "traveloka.com"],
  ["Asia-Pacific", "Tokopedia", "tokopedia.com"],
  ["Asia-Pacific", "Shopee", "shopee.com"],
  ["Asia-Pacific", "DBS Bank", "dbs.com"],
  ["Asia-Pacific", "OCBC", "ocbc.com"],
  ["Asia-Pacific", "Singtel", "singtel.com"],
  ["Asia-Pacific", "Singapore Airlines", "singaporeair.com"],
  ["Asia-Pacific", "Petronas", "petronas.com"],
  ["Asia-Pacific", "Maybank", "maybank.com"],
  ["Asia-Pacific", "CIMB Group", "cimb.com"],
  ["Asia-Pacific", "Globe Telecom", "globe.com.ph"],
  ["Asia-Pacific", "Jollibee Foods Corporation", "jollibee.com.ph"],
  ["Asia-Pacific", "Canva", "canva.com"],
  ["Asia-Pacific", "Atlassian", "atlassian.com"],
  ["Asia-Pacific", "REA Group", "rea-group.com"],
  ["Asia-Pacific", "Telstra", "telstra.com.au"],
  ["Asia-Pacific", "BHP", "bhp.com"],
  ["Asia-Pacific", "Rio Tinto", "riotinto.com"],
  ["Asia-Pacific", "Woolworths Group", "woolworthsgroup.com.au"],
  ["Asia-Pacific", "Wesfarmers", "wesfarmers.com.au"],
  ["Asia-Pacific", "Qantas", "qantas.com"],
  ["Asia-Pacific", "ANZ", "anz.com.au"],
  ["Asia-Pacific", "Commonwealth Bank", "commbank.com.au"],
  ["Asia-Pacific", "Macquarie Group", "macquarie.com"],
  ["Asia-Pacific", "Xero", "xero.com"],
  ["Asia-Pacific", "Air New Zealand", "airnewzealand.co.nz"],
  ["Asia-Pacific", "Fonterra", "fonterra.com"],
  ["Latin America, the Middle East and Africa", "Mercado Libre", "mercadolibre.com"],
  ["Latin America, the Middle East and Africa", "Nubank", "nubank.com.br"],
  ["Latin America, the Middle East and Africa", "iFood", "ifood.com.br"],
  ["Latin America, the Middle East and Africa", "Rappi", "rappi.com"],
  ["Latin America, the Middle East and Africa", "dLocal", "dlocal.com"],
  ["Latin America, the Middle East and Africa", "Globant", "globant.com"],
  ["Latin America, the Middle East and Africa", "Vale", "vale.com"],
  ["Latin America, the Middle East and Africa", "Petrobras", "petrobras.com.br"],
  ["Latin America, the Middle East and Africa", "Embraer", "embraer.com"],
  ["Latin America, the Middle East and Africa", "Itaú Unibanco", "itau.com.br"],
  ["Latin America, the Middle East and Africa", "Banco Bradesco", "bradesco.com.br"],
  ["Latin America, the Middle East and Africa", "Banco do Brasil", "bb.com.br"],
  ["Latin America, the Middle East and Africa", "Magazine Luiza", "magazineluiza.com.br"],
  ["Latin America, the Middle East and Africa", "Cemex", "cemex.com"],
  ["Latin America, the Middle East and Africa", "FEMSA", "femsa.com"],
  ["Latin America, the Middle East and Africa", "América Móvil", "americamovil.com"],
  ["Latin America, the Middle East and Africa", "Grupo Televisa", "televisa.com"],
  ["Latin America, the Middle East and Africa", "Kavak", "kavak.com"],
  ["Latin America, the Middle East and Africa", "Despegar", "despegar.com"],
  ["Latin America, the Middle East and Africa", "Falabella", "falabella.com"],
  ["Latin America, the Middle East and Africa", "Aramco", "aramco.com"],
  ["Latin America, the Middle East and Africa", "Emirates Group", "emirates.com"],
  ["Latin America, the Middle East and Africa", "Emirates NBD", "emiratesnbd.com"],
  ["Latin America, the Middle East and Africa", "Careem", "careem.com"],
  ["Latin America, the Middle East and Africa", "Talabat", "talabat.com"],
  ["Latin America, the Middle East and Africa", "Noon", "noon.com"],
  ["Latin America, the Middle East and Africa", "Safaricom", "safaricom.co.ke"],
  ["Latin America, the Middle East and Africa", "MTN Group", "mtn.com"],
  ["Latin America, the Middle East and Africa", "Naspers", "naspers.com"],
  ["Latin America, the Middle East and Africa", "Prosus", "prosus.com"],
  ["Latin America, the Middle East and Africa", "Standard Bank", "standardbank.com"],
  ["Latin America, the Middle East and Africa", "First National Bank", "fnb.co.za"],
  ["Latin America, the Middle East and Africa", "Shoprite Holdings", "shoprite.co.za"],
  ["Latin America, the Middle East and Africa", "Takealot", "takealot.com"],
  ["Latin America, the Middle East and Africa", "Flutterwave", "flutterwave.com"],
  ["Latin America, the Middle East and Africa", "Paystack", "paystack.com"],
  ["Latin America, the Middle East and Africa", "Andela", "andela.com"],
  ["Latin America, the Middle East and Africa", "Jumia", "jumia.com"],
];

function buildDirectory(candidates, meta, freeEmail) {
  const entries = new Map(); // slug → entry
  const claimedDomains = new Set();
  const regionByDomain = new Map();

  // Pass 1: what Wikidata knows, best (most sitelinks) first, so the most
  // notable organisation keeps a contested domain.
  const sorted = [...candidates].sort((a, b) => b.sitelinks - a.sitelinks);
  const stats = { noName: 0, noDomain: 0, badDomain: 0, unrelatedDomain: 0, slugTaken: 0, domainTaken: 0 };

  for (const candidate of sorted) {
    const info = meta.get(candidate.qid);
    const region = regionFor(info);
    const name = cleanName(info?.name);
    if (!name) {
      stats.noName++;
      continue;
    }

    // The most canonical of the listed sites: fewest labels, then shortest.
    const domains = candidate.websites
      .map(domainFrom)
      .filter((domain) => domain && isUsableDomain(domain, freeEmail))
      .sort((a, b) => a.split(".").length - b.split(".").length || a.length - b.length || a.localeCompare(b));

    if (candidate.websites.every((url) => !domainFrom(url))) {
      stats.noDomain++;
      continue;
    }
    if (domains.length === 0) {
      stats.badDomain++;
      continue;
    }

    // Remember the region even for entities we drop: a reviewed entry with the
    // same domain inherits it below.
    regionByDomain.set(domains[0], region);

    if (candidate.sitelinks < LOW_TRUST_SITELINKS && !nameMatchesDomain(name, domains[0])) {
      stats.unrelatedDomain++;
      continue;
    }

    const slug = slugify(name);
    if (entries.has(slug)) {
      stats.slugTaken++;
      continue;
    }
    if (claimedDomains.has(domains[0])) {
      stats.domainTaken++;
      continue;
    }

    entries.set(slug, { slug, name, domain: domains[0], region, source: "wikidata" });
    claimedDomains.add(domains[0]);
  }

  // Pass 2: the reviewed core, which outranks everything.
  for (const [region, name, domain] of REVIEWED) {
    const slug = slugify(name);
    const resolved = regionByDomain.get(domain) ?? region ?? FALLBACK_REGION;
    entries.set(slug, { slug, name, domain, region: resolved, source: "reviewed" });
    claimedDomains.add(domain);
  }

  // A reviewed entry can share a slug with a Wikidata name it should replace —
  // `entries.set` above already handled that — but not a DOMAIN: two companies
  // must never point at one domain, or a member's proof would be ambiguous.
  const seenDomains = new Map();
  for (const [slug, entry] of entries) {
    const holder = seenDomains.get(entry.domain);
    if (holder && holder !== slug) {
      // Keep the reviewed/reviewed-most entry; drop the other.
      const other = entries.get(holder);
      if (entry.source === "reviewed" && other.source !== "reviewed") {
        entries.delete(holder);
        seenDomains.set(entry.domain, slug);
      } else {
        entries.delete(slug);
      }
      continue;
    }
    seenDomains.set(entry.domain, slug);
  }

  return { entries: [...entries.values()], stats };
}

function regionFor(info) {
  if (!info) return FALLBACK_REGION;
  if (info.countryQid === INDIA) return "India";
  return CONTINENT_REGION[info.continent] ?? FALLBACK_REGION;
}

const REGION_ORDER = [
  "India",
  "Asia-Pacific",
  "Europe",
  "North America",
  "South America",
  "Africa",
  "Latin America, the Middle East and Africa",
  FALLBACK_REGION,
];

function sqlString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function renderSql(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const region = groups.get(entry.region) ?? [];
    region.push(entry);
    groups.set(entry.region, region);
  }

  const orderedRegions = [
    ...REGION_ORDER.filter((region) => groups.has(region)),
    ...[...groups.keys()].filter((region) => !REGION_ORDER.includes(region)).sort(),
  ];

  const valueBlocks = orderedRegions
    .map((region) => {
      const rows = groups
        .get(region)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => `  (${sqlString(entry.name)}, ${sqlString(entry.domain)})`)
        .join(",\n");
      const heading = region === FALLBACK_REGION ? "No country recorded" : region;
      return `-- ─── ${heading} (${groups.get(region).length}) ──\n\ninsert into _company_directory (name, domain) values\n${rows};\n`;
    })
    .join("\n\n");

  const counts = orderedRegions
    .map((region) => `--   ${region}: ${groups.get(region).length}`)
    .join("\n");

  return `-- ============================================================
-- Migration: The default company directory
--
-- GENERATED FILE — do not edit by hand.
--   Regenerate with: node scripts/generate-company-directory.mjs
--   Source: Wikidata (CC0) organisations that have an official website (P856)
--   and a Wikipedia footprint, plus the reviewed entries listed in that script.
--
-- ENTRY COUNTS
${counts}
--
-- WHAT THIS IS
--   A starting set of companies and the domain each is known by, so the
--   "Where do you work?" picker has real names to find on day one instead of an
--   empty box and a "create yours" button.
--
-- WHY THE DOMAINS ARE UNVERIFIED (read this before changing the generator)
--   Every row this migration writes to \`company_domains\` is a HINT
--   (\`verified = false\`): a company and a domain that go together, asserted by
--   a data file, proved by nobody. Nothing here verifies a domain, and nothing
--   here can, because verification means "a member received a code at a mailbox
--   on this domain and typed it back". That is the whole trust model, and a
--   data file is not allowed to shortcut it.
--
--   What a hint buys is that the first member whose employer is listed has a
--   path that works: they find the company, give a work email on its domain,
--   and their confirmation promotes the hint to a verified claim. Without the
--   domains, listing the companies would actively block those members — see the
--   reasoning at the top of
--   supabase/migrations/20260929130000_company_directory_hints.sql.
--
--   It also gives every listed company a logo, because a logo is derived from
--   the domain (apps/web/lib/companies/logos.ts) rather than uploaded by
--   anyone.
--
-- HOW A ROW BECOMES REAL
--   A hint never grows a member on its own. It only decides WHICH COMPANY a
--   member's proven domain belongs to:
--
--     * \`search_companies\` shows the domain but reports \`verified = false\`,
--       and a hint never answers a domain search;
--     * \`company_domain_owner\` still prefers verified rows, so routing a work
--       email never follows a hint;
--     * the first member to prove the domain needs the emailed code, and that
--       confirmation is what flips the row to verified.
--
-- HOW TO CORRECT THIS FILE
--   A wrong domain is a naming bug, not a security hole — the mailbox is still
--   what does the proving — but it is still a bug, and generated data is wrong
--   sometimes:
--     * fix the entry in REVIEWED in the generator (it outranks Wikidata), or
--       deny the domain there, and regenerate;
--     * a company with no domain at all is fine (insert it with no
--       company_domains row) and behaves like a member-created one: the first
--       person to prove a domain names it;
--     * delete an entry rather than guessing a domain for it.
--
--   Rows are added with \`on conflict do nothing\`, so this file can be
--   re-applied and regenerated without disturbing companies members have
--   already created or domains anybody has already verified.
--
-- WHY A STAGING TABLE (NOT A TEMPORARY ONE)
--   Each entry produces two rows — the company, and its hint — and the second
--   needs the first's generated id. The list is written once, into a staging
--   table, and read twice; a plain \`values\` list could not be used by both
--   statements without being duplicated.
--
--   The staging table is deliberately NOT \`temporary\`: the Supabase SQL
--   editor runs statements across pooled sessions, so a session-scoped temp
--   table is gone by the time the inserts run (\`42P01\`). A regular table,
--   dropped at the start and again at the end, survives between statements
--   and leaves nothing behind.
-- ============================================================

drop table if exists _company_directory;

create table _company_directory (
  name   text not null,
  domain text not null
);


${valueBlocks}

-- ─── Turn the directory into companies + domain hints ───────

-- One company per slug. A company a member already created keeps its row (and
-- its name): \`on conflict (slug) do nothing\` means the directory only ever adds
-- what is missing, and the \`distinct on\` above it stops two directory names
-- that slugify the same way from colliding with each other.
insert into public.companies (name, slug)
select distinct on (public.company_slugify(name))
  name,
  public.company_slugify(name)
from _company_directory
where btrim(name) <> ''
order by public.company_slugify(name), name
on conflict (slug) do nothing;

-- The hints. \`created_by\` stays null on these companies, which is what marks a
-- row as coming from the directory rather than from a member.
--
-- Two guards, both about not making anything up twice:
--   * a domain that already has ANY row — a verified claim by a member, or a
--     hint from an earlier run of this file — is left alone, so this file cannot
--     take a domain away from whoever holds it;
--   * \`distinct on (domain)\` keeps one company per domain even if the
--     generated list ever grows a duplicate, since \`company_domains\` only
--     enforces uniqueness among VERIFIED rows.
insert into public.company_domains (company_id, domain)
select picked.company_id, picked.domain
from (
  select distinct on (seed.domain)
    company.id as company_id,
    seed.domain
  from _company_directory as seed
  join public.companies as company
    on company.slug = public.company_slugify(seed.name)
  where not exists (
    select 1 from public.company_domains as existing
    where existing.domain = seed.domain
  )
  order by seed.domain, company.slug
) as picked
on conflict (company_id, domain) do nothing;

drop table if exists _company_directory;
`;
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log(`Wikidata classes, sitelinks >= ${minSitelinks}:`);
const candidates = await fetchCandidates();
console.log(`  ${candidates.length} distinct organisations with an official website`);

const meta = await fetchMetadata(candidates.map((candidate) => candidate.qid));
const freeEmail = freeEmailDomains();
const { entries, stats } = buildDirectory(candidates, meta, freeEmail);

const bySource = entries.reduce((acc, entry) => ({ ...acc, [entry.source]: (acc[entry.source] ?? 0) + 1 }), {});
const byRegion = entries.reduce((acc, entry) => ({ ...acc, [entry.region]: (acc[entry.region] ?? 0) + 1 }), {});

console.log(`\nDropped: ${stats.noName} without a name, ${stats.noDomain} without a usable URL, ` +
  `${stats.badDomain} whose only site is not a work-email domain, ` +
  `${stats.unrelatedDomain} whose name and domain do not look related (below ${LOW_TRUST_SITELINKS} sitelinks), ` +
  `${stats.slugTaken} on a duplicate name, ${stats.domainTaken} on a domain another entry holds`);
console.log(`Kept ${entries.length} companies (${bySource.wikidata ?? 0} from Wikidata, ${bySource.reviewed ?? 0} reviewed)`);
for (const [region, count] of Object.entries(byRegion).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(5)}  ${region}`);
}

if (dryRun) {
  const sample = [...entries].sort((a, b) => b.name.length - a.name.length).slice(0, 8);
  console.log("\nLongest names (sanity check on label quality):");
  for (const entry of sample) console.log(`  ${entry.name} | ${entry.domain} | ${entry.region}`);
  console.log("\nDry run: no file written.");
} else {
  writeFileSync(outPath, renderSql(entries));
  console.log(`\nWrote ${entries.length} companies to ${outPath}`);
}
