#!/usr/bin/env node
/**
 * Infrastructure cost model for UX Community.
 *
 * Computes the monthly bill at 1K / 10K / 100K / 1M registered users from the
 * traffic model the audit documents. Every price is a published list price,
 * transcribed from the vendor's own pricing page (all fetched for the audit —
 * see docs/infrastructure-cost-audit.md §"Pricing sources").
 *
 * This is a MODEL, not a measurement: the *prices* are facts, the *usage
 * inputs* are assumptions with sources noted inline. Run with `--sensitivity`
 * to see how the two most uncertain inputs move the answer.
 *
 *   node scripts/cost-model.mjs
 *   node scripts/cost-model.mjs --sensitivity
 */

// ─────────────────────────────────────────────────────────────────────────────
// Published prices (USD), transcribed from vendor pricing pages.
// ─────────────────────────────────────────────────────────────────────────────

const PRICES = {
  // developers.cloudflare.com/workers/platform/pricing
  workers: {
    base: 5,
    includedRequests: 10_000_000,
    perMillionRequests: 0.3,
    includedCpuMs: 30_000_000,
    perMillionCpuMs: 0.02,
  },
  // developers.cloudflare.com/durable-objects/platform/pricing
  durableObjects: {
    includedRequests: 1_000_000,
    perMillionRequests: 0.15,
    includedGbSeconds: 400_000,
    perMillionGbSeconds: 12.5,
    // SQLite-backed DO storage
    includedRowReads: 25_000_000_000,
    perMillionRowReads: 0.001,
    includedRowWrites: 50_000_000,
    perMillionRowWrites: 1,
    includedStorageGb: 5,
    perGbMonth: 0.2,
    /** 20 inbound WebSocket messages are billed as one DO request. */
    inboundMessagesPerRequest: 20,
  },
  // developers.cloudflare.com/r2/pricing  (egress is free, all classes)
  r2: {
    perGbMonth: 0.015,
    perMillionClassA: 4.5,
    perMillionClassB: 0.36,
    freeStorageGb: 10,
    freeClassA: 1_000_000,
    freeClassB: 10_000_000,
  },
  // developers.cloudflare.com/images/pricing
  images: {
    freeUniqueTransformations: 5_000,
    perThousandTransformations: 0.5,
  },
  // supabase.com/pricing + docs/guides/platform/compute-and-disk
  supabase: {
    proMonthly: 25,
    computeCredit: 10, // Pro: $10/mo of compute credit
    compute: {
      micro: { price: 10, recommendedMaxDbGb: 10 },
      small: { price: 15, recommendedMaxDbGb: 50 },
      medium: { price: 60, recommendedMaxDbGb: 100 },
      large: { price: 110, recommendedMaxDbGb: 200 },
      xl: { price: 210, recommendedMaxDbGb: 500 },
      "2xl": { price: 410, recommendedMaxDbGb: 1000 },
      "4xl": { price: 960, recommendedMaxDbGb: 2000 },
    },
    includedDiskGb: 8,
    perGbDiskMonth: 0.125,
    includedEgressGb: 250,
    perGbEgress: 0.09,
    // Supabase Auth MAU pricing does NOT apply: the app runs custom JWT auth
    // and never calls supabase.auth.*.
    authMauPrice: 0,
  },
  // upstash.com/pricing/redis
  upstash: {
    freeCommandsPerMonth: 500_000,
    perHundredThousandCommands: 0.2,
    /** @upstash/ratelimit sliding window: 4–5 commands per limit() call. */
    commandsPerCheck: 4.5,
    fixedPlans: [
      { name: "Fixed 250MB", price: 10, commandsPerSec: 10_000 },
      { name: "Fixed 1GB", price: 20, commandsPerSec: 10_000 },
      { name: "Fixed 5GB", price: 100, commandsPerSec: 10_000 },
      { name: "Fixed 50GB", price: 400, commandsPerSec: 10_000 },
    ],
  },
  // resend.com/pricing
  resend: {
    freeEmailsPerMonth: 3_000,
    proMonthly: 20,
    proIncludedEmails: 50_000,
    perThousandOverage: 0.9,
  },
  // github.com/pricing + docs.github.com/billing
  githubActions: {
    freePrivateMinutes: 2_000,
    perMinutePrivateLinux: 0.006,
  },
  // expo.dev/pricing
  expo: { pushIsFree: true, freeBuildsPerPlatformPerMonth: 15, starterMonthly: 19 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Usage assumptions for the app as it is built today.
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = {
  /** Share of registered users active in a month. */
  monthlyActiveRatio: 0.7,
  /** Share of monthly actives active on a given day. */
  dailyActiveRatioOfMau: 0.3,
  /** HTTP requests per daily active user (page, RSC, API, static). */
  requestsPerDau: 100,
  /** Share of those that invoke the Worker for compute (rest are free static assets). */
  dynamicRequestShare: 0.7,
  /** Database round trips per HTTP request (2 queries per request, per the perf audit). */
  dbQueriesPerRequest: 2,
  /** Average bytes returned by the database per query. */
  bytesPerDbQuery: 2 * 1024,
  /** Realtime events received per daily active user. */
  realtimeEventsPerDau: 100,
  /** Distinct sockets a peak-concurrency user holds (sidebar cap is 15). */
  socketsPerActiveUser: 5,
  /** Peak concurrency as a share of DAU. */
  peakConcurrencyShare: 0.1,
  /** Durable Object requests per DAU per day (socket opens + publishes + inbound/20). */
  doRequestsPerDau: 15,
  /**
   * Durable Object *active* seconds per room per day. WebSocket hibernation
   * means an idle room costs nothing; this is the only input that decides the
   * DO duration line, so it is modelled as a scenario.
   */
  roomActiveSecondsPerDay: { light: 60, steady: 3_600, busy: 8 * 3_600 },
  /** Rooms awake per 1,000 registered users on a given day. */
  awakeRoomsPerThousandUsers: 20,
  /** Media stored per registered user in year one. */
  mediaBytesPerUser: 20 * 1024 * 1024,
  /** Postgres growth per registered user per year (messages, rows, interactions). */
  dbBytesPerUserYear: 1.5 * 1024 * 1024,
  /** Transactional emails per registered user per year. */
  emailsPerUserYear: 6,
  /** R2 Class A operations per DAU per day (upload PUTs + admin list/audit calls). */
  r2ClassAPerDau: 1.2,
  /** R2 Class B operations per DAU per day (edge cache misses on media). */
  r2ClassBPerDau: 2,
  /** Next.js incremental-cache reads per dynamic request (R2 Class B). */
  incCacheReadsPerDynamicRequest: 0.5,
  /** Incremental-cache writes as a share of its reads (R2 Class A). */
  incCacheWriteShare: 0.01,
  /** Incremental-cache bucket size (grows every deploy; nothing prunes it). */
  incCacheBucketGb: 2,
  /** next/image transformations. Zero today: no `next/image` import exists. */
  imageTransformations: 0,
  /** Upstash checks per dynamic request: 1 global (middleware) + ~0.15 per-route. */
  upstashChecksPerDynamicRequest: 1.15,
  /**\n   * Peak requests/second across the whole app, as a share of registered users.\n   * Source: docs/performance-audit.md concurrency model (1K→50 rps, 10K→500,\n   * 100K→5,000), which is linear in users.\n   */
  peakRpsPerRegisteredUser: 0.05,
  /** Placeholder: CI cost is modelled separately (see report §CI/CD). */
  githubActionsMinutesPerMonth: 0,
};

const DAYS_PER_MONTH = 30.4;
const USERS = [1_000, 10_000, 100_000, 1_000_000];

const degrees = (n) => `$${n.toFixed(2)}`;
const overage = (used, included, perMillion, unit = "M") =>
  used <= included ? 0 : ((used - included) / (unit === "M" ? 1e6 : 1)) * perMillion;

function pickCompute(dbGb) {
  for (const [name, spec] of Object.entries(PRICES.supabase.compute)) {
    if (dbGb <= spec.recommendedMaxDbGb) return { name, ...spec };
  }
  return { name: "16XL+", price: 6_000, recommendedMaxDbGb: Infinity };
}

/** Traffic + storage model for a user count. Pure: no I/O, no randomness. */
function model(registeredUsers, opts = {}) {
  const m = { ...MODEL, ...opts };
  const mau = registeredUsers * m.monthlyActiveRatio;
  const dau = mau * m.dailyActiveRatioOfMau;

  const httpPerDay = dau * m.requestsPerDau;
  const dynamicPerDay = httpPerDay * m.dynamicRequestShare;
  const httpPerMonth = httpPerDay * DAYS_PER_MONTH;
  const dynamicPerMonth = dynamicPerDay * DAYS_PER_MONTH;

  const dbQueriesPerMonth = httpPerMonth * m.dbQueriesPerRequest;
  const dbEgressGb = (dbQueriesPerMonth * m.bytesPerDbQuery) / 1024 ** 3;

  const dbGb = (registeredUsers * m.dbBytesPerUserYear) / 1024 ** 3;
  const mediaGb = (registeredUsers * m.mediaBytesPerUser) / 1024 ** 3;

  const peaks = {
    concurrentUsers: dau * m.peakConcurrencyShare,
    concurrentSockets: dau * m.peakConcurrencyShare * m.socketsPerActiveUser,
  };

  const doRequestsPerMonth = dau * m.doRequestsPerDau * DAYS_PER_MONTH;

  const rooms = (registeredUsers / 1_000) * m.awakeRoomsPerThousandUsers;
  const doGbSecondsPerMonth = (activeSeconds) =>
    (rooms * activeSeconds * 0.125 * DAYS_PER_MONTH) / 1; // 128 MB per DO

  const r2ClassA =
    dau * m.r2ClassAPerDau * DAYS_PER_MONTH +
    dynamicPerMonth * m.incCacheReadsPerDynamicRequest * m.incCacheWriteShare;
  const r2ClassB =
    dau * m.r2ClassBPerDau * DAYS_PER_MONTH +
    dynamicPerMonth * m.incCacheReadsPerDynamicRequest;

  const emailsPerMonth = (registeredUsers * m.emailsPerUserYear) / 12;
  const upstashCommandsPerMonth =
    dynamicPerMonth * m.upstashChecksPerDynamicRequest * PRICES.upstash.commandsPerCheck;
  const peakRps = registeredUsers * m.peakRpsPerRegisteredUser;
  const upstashPeakCommandsPerSec =
    peakRps * m.upstashChecksPerDynamicRequest * PRICES.upstash.commandsPerCheck;

  return {
    registeredUsers, mau, dau, httpPerMonth, dynamicPerMonth, dbQueriesPerMonth,
    dbEgressGb, dbGb, mediaGb, peaks, doRequestsPerMonth, rooms,
    doGbSecondsPerMonth, r2ClassA, r2ClassB, emailsPerMonth, upstashCommandsPerMonth,
    peakRps, upstashPeakCommandsPerSec,
    incCacheBucketGb: m.incCacheBucketGb,
  };
}

/** Monthly USD per service for a user count. */
function bill(registeredUsers, opts = {}) {
  const u = model(registeredUsers, opts);
  const P = PRICES;

  const workers =
    P.workers.base +
    overage(u.dynamicPerMonth, P.workers.includedRequests, P.workers.perMillionRequests);

  const cpuMs = u.dynamicPerMonth * (opts.cpuMsPerRequest ?? 20);
  const workersCpu = overage(cpuMs, P.workers.includedCpuMs, P.workers.perMillionCpuMs);

  const doRequests = overage(
    u.doRequestsPerMonth, P.durableObjects.includedRequests, P.durableObjects.perMillionRequests,
  );
  const doDuration =
    (u.doGbSecondsPerMonth(opts.roomActiveSeconds ?? MODEL.roomActiveSecondsPerDay.steady) -
      P.durableObjects.includedGbSeconds) /
      1e6 *
    P.durableObjects.perMillionGbSeconds;
  const doDurationClamped = Math.max(0, doDuration);

  const r2Ops =
    (Math.max(0, u.r2ClassA - P.r2.freeClassA) / 1e6) * P.r2.perMillionClassA +
    (Math.max(0, u.r2ClassB - P.r2.freeClassB) / 1e6) * P.r2.perMillionClassB;
  const r2Storage =
    Math.max(0, u.mediaGb + u.incCacheBucketGb - P.r2.freeStorageGb) * P.r2.perGbMonth;

  // Zero by construction: the app has no `next/image` import, so the
  // `[images] IMAGES` binding never transforms anything (see report §5.5).
  const images =
    (Math.max(0, MODEL.imageTransformations - P.images.freeUniqueTransformations) / 1_000) *
    P.images.perThousandTransformations;

  const compute = pickCompute(u.dbGb);
  const supabase =
    P.supabase.proMonthly +
    Math.max(0, compute.price - P.supabase.computeCredit) +
    Math.max(0, u.dbGb - P.supabase.includedDiskGb) * P.supabase.perGbDiskMonth +
    Math.max(0, u.dbEgressGb - P.supabase.includedEgressGb) * P.supabase.perGbEgress;

  const upstashPayg = Math.max(0, u.upstashCommandsPerMonth - P.upstash.freeCommandsPerMonth) /
    100_000 * P.upstash.perHundredThousandCommands;
  // Fixed plans bill flat with NO command cap, but cap throughput at 10K
  // commands/sec — so the cheapest fixed plan is only a real escape hatch while
  // the app's peak command rate stays under that ceiling.
  const fixedCandidates = P.upstash.fixedPlans.filter(
    (p) => p.price < upstashPayg && u.upstashPeakCommandsPerSec <= p.commandsPerSec,
  );
  const upstashFixed = fixedCandidates.length
    ? fixedCandidates.reduce((a, b) => (a.price <= b.price ? a : b))
    : null;
  const upstash = upstashFixed ? upstashFixed.price : upstashPayg;

  const resend =
    u.emailsPerMonth <= P.resend.freeEmailsPerMonth
      ? 0
      : P.resend.proMonthly +
        Math.max(0, u.emailsPerMonth - P.resend.proIncludedEmails) *
          (P.resend.perThousandOverage / 1_000);

  const githubActions =
    Math.max(0, (opts.privateRepoMinutes ?? 0) - P.githubActions.freePrivateMinutes) *
    P.githubActions.perMinutePrivateLinux;

  const items = {
    "Cloudflare Workers — requests": workers,
    "Cloudflare Workers — CPU time": workersCpu,
    "Cloudflare Durable Objects — requests": doRequests,
    "Cloudflare Durable Objects — duration": doDurationClamped,
    "Cloudflare R2 — storage": r2Storage,
    "Cloudflare R2 — operations": r2Ops,
    "Cloudflare Images — transformations": images,
    "Supabase — plan + compute": supabase,
    "Upstash Redis — rate limiting": upstash,
    Resend: resend,
    "GitHub Actions": githubActions,
    "Expo Push / EAS Build": 0,
    "GIPHY": 0,
  };
  const total = Object.values(items).reduce((a, b) => a + b, 0);
  return { u, items, total, compute, upstashPayg, upstashFixed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reporting
// ─────────────────────────────────────────────────────────────────────────────

function trafficTable(opts) {
  const rows = USERS.map((r) => model(r, opts));
  console.log("\n### Traffic + storage model\n");
  console.log("| Users | MAU | DAU | Worker req/mo | DB queries/mo | DB egress GB/mo | DB size GB | Media GB | DO req/mo | Peak sockets | Peak rps | Peak Upstash cmd/s |");
  console.log("|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const u of rows) {
    console.log(
      `| ${label(u.registeredUsers)} | ${Math.round(u.mau).toLocaleString()} | ` +
        `${Math.round(u.dau).toLocaleString()} | ${(u.dynamicPerMonth / 1e6).toFixed(1)}M | ` +
        `${(u.dbQueriesPerMonth / 1e6).toFixed(1)}M | ${u.dbEgressGb.toFixed(1)} | ` +
        `${u.dbGb.toFixed(1)} | ${u.mediaGb.toFixed(1)} | ${(u.doRequestsPerMonth / 1e6).toFixed(2)}M | ` +
        `${Math.round(u.peaks.concurrentSockets).toLocaleString()} | ` +
        `${Math.round(u.peakRps).toLocaleString()} | ` +
        `${Math.round(u.upstashPeakCommandsPerSec).toLocaleString()} |`,
    );
  }
}

const label = (n) => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1_000}K`);

function billTable(title, opts) {
  const results = USERS.map((r) => ({ r, ...bill(r, opts) }));
  const keys = Object.keys(results[0].items);
  console.log(`\n### ${title}\n`);
  console.log("| Line item | " + USERS.map((u) => `${label(u)} users`).join(" | ") + " |");
  console.log("|---|" + USERS.map(() => "---:").join("|") + "|");
  for (const k of keys) {
    const cells = results.map((x) => {
      const v = x.items[k];
      return v === 0 ? "—" : degrees(v);
    });
    console.log(`| ${k} | ${cells.join(" | ")} |`);
  }
  console.log(
    "| **Total** | " + results.map((x) => `**${degrees(x.total)}**`).join(" | ") + " |",
  );
  console.log("\nDerived:");
  for (const x of results) {
    const cheapFixed = PRICES.upstash.fixedPlans.find(
      (p) => p.price < x.upstashPayg && x.u.upstashPeakCommandsPerSec <= p.commandsPerSec,
    );
    const fixed = x.upstashFixed
      ? ` → switch to ${x.upstashFixed.name} at ${degrees(x.upstashFixed.price)}`
      : x.upstashPayg === 0
        ? " → free tier is enough"
        : x.upstashPayg < PRICES.upstash.fixedPlans[0].price
          ? ` → pay-as-you-go is cheaper than the ${degrees(PRICES.upstash.fixedPlans[0].price)} fixed-plan floor`
          : cheapFixed
            ? ` → fixed plan available`
            : ` → peak ${Math.round(x.u.upstashPeakCommandsPerSec).toLocaleString()} cmd/s exceeds every fixed plan's 10K/s ceiling`;
    console.log(
      `- ${label(x.r)} users → Supabase compute **${x.compute.name}** · ` +
        `Upstash PAYG ${degrees(x.upstashPayg)}${fixed}`,
    );
  }
}

console.log("# UX Community — infrastructure cost model");
console.log(`\nGenerated by scripts/cost-model.mjs. Prices: vendor list prices.`);
console.log(`Usage: app traffic model in docs/infrastructure-cost-audit.md §3.`);

trafficTable();
billTable("Baseline bill (steady room activity, 20 ms CPU/request)");
billTable("Sensitivity — busy rooms (8 h active per room per day)", {
  roomActiveSeconds: MODEL.roomActiveSecondsPerDay.busy,
});
billTable("Sensitivity — idle rooms (60 s active per room per day)", {
  roomActiveSeconds: MODEL.roomActiveSecondsPerDay.light,
});
billTable("Sensitivity — CPU-heavy rendering (50 ms CPU per request)", { cpuMsPerRequest: 50 });
billTable("Sensitivity — CPU-light rendering (5 ms CPU per request)", { cpuMsPerRequest: 5 });
billTable("Sensitivity — heavy DB rows (10 KB per query, list APIs unbounded)", {
  bytesPerDbQuery: 10 * 1024,
});

console.log("\n### Unit economics\n");
console.log("| Users | Total $/month | $ per registered user | $ per DAU |");
console.log("|---:|---:|---:|---:|");
for (const r of USERS) {
  const b = bill(r);
  console.log(
    `| ${label(r)} | ${degrees(b.total)} | $${(b.total / r).toFixed(4)} | ` +
      `$${(b.total / b.u.dau).toFixed(2)} |`,
  );
}

console.log("\n### Controllable-cost lever: the global rate limiter\n");
for (const r of USERS) {
  const b = bill(r);
  const withoutLimiter = bill(r, { upstashChecksPerDynamicRequest: 0 });
  console.log(
    `- ${label(r)} users: Upstash ${degrees(b.items["Upstash Redis — rate limiting"])}` +
      ` of a ${degrees(b.total)} bill (${((b.items["Upstash Redis — rate limiting"] / b.total) * 100).toFixed(0)}%). ` +
      `Removing the per-request check entirely leaves ${degrees(withoutLimiter.total)}.`,
  );
}
