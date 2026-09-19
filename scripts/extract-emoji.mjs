#!/usr/bin/env node
/**
 * Extracts the vendored emoji asset tarball into apps/web/public/emoji.
 *
 * The 1,700+ emoji files (svg/ + lottie/, ~75MB) are NOT committed to git —
 * they ship as a single tarball (apps/web/public/emoji-assets.tar.gz,
 * ~13MB gzipped, see scripts/update-emoji.mjs) and are extracted by this
 * script, which runs automatically on `npm install` (root postinstall) and
 * before every `next build`. Idempotent: skips work when the extracted
 * files already match the tarball's checksum, so installs stay fast.
 *
 * If the tarball is missing entirely, extraction is skipped with a warning
 * pointing at scripts/update-emoji.mjs (dev machines can regenerate it;
 * CI/deploy must commit the tarball).
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(ROOT, "..");
const EMOJI_DIR = path.join(REPO_ROOT, "apps", "web", "public", "emoji");
// Lives outside public/ on purpose: Vercel copies ALL of public/ into the
// deployment, and the extracted assets are already there — shipping the
// 13MB tarball alongside them would double the static payload.
const TARBALL = path.join(REPO_ROOT, "apps", "web", "emoji-assets.tar.gz");
const STAMP = path.join(EMOJI_DIR, ".extracted-sha");

function sha256File(file) {
  // 13MB tarball — hashing it whole from a buffer is instant and avoids
  // stream bookkeeping.
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function main() {
  if (!existsSync(TARBALL)) {
    console.warn(
      "[emoji] No emoji-assets.tar.gz found — skipping extraction. " +
        "Run `node scripts/update-emoji.mjs` to vendor emoji assets."
    );
    process.exit(0);
  }

  const tarSha = sha256File(TARBALL);

  // Fast path: already extracted from this exact tarball.
  try {
    if (
      readFileSync(STAMP, "utf8").trim() === tarSha &&
      existsSync(path.join(EMOJI_DIR, "svg"))
    ) {
      process.exit(0);
    }
  } catch {
    // no stamp yet — extract below
  }

  console.log("[emoji] Extracting emoji assets…");
  const tmp = `${EMOJI_DIR}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  execFileSync("tar", ["-xzf", TARBALL, "-C", tmp], { stdio: "ignore" });

  // Swap in the fully-extracted tree so a half-extracted state never ships.
  rmSync(EMOJI_DIR, { recursive: true, force: true });
  execFileSync("cp", ["-R", `${tmp}/.`, EMOJI_DIR], { stdio: "ignore" });
  rmSync(tmp, { recursive: true, force: true });

  mkdirSync(EMOJI_DIR, { recursive: true });
  writeFileSync(STAMP, tarSha);
  console.log(`[emoji] Extracted (tarball sha256 ${tarSha.slice(0, 12)}…).`);
}

main();
