#!/usr/bin/env node
/**
 * Re-vendors emoji assets into apps/web/public/emoji from upstream sources:
 *
 *   svg/           <- googlefonts/noto-emoji repo 2D/svg dir, via jsDelivr (Apache-2.0, see svg/LICENSE)
 *   catalog.json   <- googlefonts.github.io/noto-emoji-animation/data/api.json
 *   lottie/*.json  <- fonts.gstatic.com/s/e/notoemoji/latest/<cp>/lottie.json
 *
 * Only assets referenced by the catalog are downloaded (~8MB svg + ~70MB
 * lottie). Run `node scripts/update-emoji.mjs` to pick up new Unicode
 * releases upstream; the app runs entirely off the committed snapshot —
 * there is no third-party dependency at request time.
 *
 * Both asset hosts key some short codepoints by their zero-padded form
 * (e.g. "00a9" for ©) while the catalog uses the minimal form ("a9"); files
 * are always stored under the catalog's (unpadded) name.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "..", "apps", "web", "public", "emoji");
const SVG_OUT = path.join(OUT, "svg");
const LOTTIE_OUT = path.join(OUT, "lottie");

const CATALOG_URL =
  "https://googlefonts.github.io/noto-emoji-animation/data/api.json";
const SVG_BASE =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@main/2D/svg";
const GSTATIC_BASE = "https://fonts.gstatic.com/s/e/notoemoji/latest";
const LICENSE_URL =
  "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/2D/svg/LICENSE";

/** Strip fe0f parts from a "_"-joined codepoint key (matches lib/noto-emoji.ts). */
const stripVS16 = (cp) => cp.split("_").filter((p) => p !== "fe0f").join("_");

/** Zero-pad each part to 4 digits (upstream keys some short codepoints padded). */
const padCodepoint = (cp) =>
  cp.split("_").map((p) => p.padStart(4, "0")).join("_");

/** Fetch the first URL candidate that returns valid content. */
async function fetchFirst(urls, validate) {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (validate && !validate(buf)) continue;
      return buf;
    } catch {
      // network error — try the next candidate
    }
  }
  return null;
}

async function fetchCatalog() {
  console.log("Fetching catalog…");
  const res = await fetch(CATALOG_URL);
  if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`);
  const json = await res.json();
  const cps = [
    ...new Set(
      json.icons.filter((i) => i.codepoint).map((i) => stripVS16(i.codepoint))
    ),
  ];
  writeFileSync(path.join(OUT, "catalog.json"), JSON.stringify(json));
  console.log(`  ${json.icons.length} icons, ${cps.length} unique codepoints`);
  return cps;
}

async function downloadAll(cps, opts) {
  mkdirSync(opts.dir, { recursive: true });
  let ok = 0;
  const missing = [];
  // Modest concurrency pool — fast enough, friendly to the asset hosts.
  const CONCURRENCY = 8;
  const queue = [...cps];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let cp = queue.shift(); cp; cp = queue.shift()) {
        const out = path.join(opts.dir, opts.filename(cp));
        if (existsSync(out)) {
          ok++;
          continue;
        }
        const buf = await fetchFirst(opts.urls(cp), opts.validate);
        if (buf) {
          writeFileSync(out, buf);
          ok++;
        } else {
          missing.push(cp);
        }
      }
    })
  );
  console.log(
    `  ${path.basename(opts.dir)}: ${ok} present/fetched, ${missing.length} missing`
  );
  if (missing.length) console.log(`  missing: ${missing.join(", ")}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const cps = await fetchCatalog();

  console.log("Fetching SVGs…");
  const isSvg = (buf) => buf.subarray(0, 5).toString().includes("<");
  await downloadAll(cps, {
    dir: SVG_OUT,
    // Repo layout: 2D/svg/emoji_u<cp>.svg (no fe0f, not always zero-padded —
    // e.g. © is emoji_ua9.svg in the catalog but emoji_u00a9.svg upstream).
    filename: (cp) => `emoji_u${cp}.svg`,
    urls: (cp) => [
      `${SVG_BASE}/emoji_u${cp}.svg`,
      `${SVG_BASE}/emoji_u${padCodepoint(cp)}.svg`,
    ],
    validate: isSvg,
  });
  const license = await fetch(LICENSE_URL);
  if (license.ok) {
    writeFileSync(path.join(SVG_OUT, "LICENSE"), Buffer.from(await license.arrayBuffer()));
  } else {
    console.log("  warning: could not refresh svg/LICENSE (keeping existing)");
  }

  console.log("Fetching Lottie animations…");
  const isJson = (buf) => buf.subarray(0, 1).toString() === "{";
  await downloadAll(cps, {
    dir: LOTTIE_OUT,
    // gstatic layout: latest/<cp>/lottie.json (some short cps keyed padded).
    filename: (cp) => `${cp}.json`,
    urls: (cp) => [
      `${GSTATIC_BASE}/${cp}/lottie.json`,
      `${GSTATIC_BASE}/${padCodepoint(cp)}/lottie.json`,
    ],
    validate: isJson,
  });

  // Pack the single tarball that gets committed (the extracted svg/ +
  // lottie/ trees are gitignored — see .gitignore and
  // scripts/extract-emoji.mjs, which unpacks this at install/build time).
  console.log("Packing emoji-assets.tar.gz…");
  execFileSync(
    "tar",
    [
      "-czf",
      path.join(OUT, "..", "..", "emoji-assets.tar.gz"),
      "-C",
      OUT,
      "svg",
      "lottie",
      "catalog.json",
    ],
    { stdio: "ignore" }
  );
  console.log("Done. Commit apps/web/emoji-assets.tar.gz to persist the snapshot.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
