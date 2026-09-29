#!/usr/bin/env node
/**
 * Vercel drift audit.
 *
 * The app deploys only to Cloudflare Workers (via OpenNext) and consumes no
 * Vercel platform at runtime: no Vercel package, no VERCEL_* env read, no
 * Vercel CLI step, no Vercel deployment config. That is worth holding, because
 * a stray vercel.json, a @vercel/* dependency or a hard-coded vercel.app URL
 * quietly reintroduces a second deployment target that no workflow maintains.
 *
 * It flags Vercel *infrastructure* signals only and deliberately ignores the
 * word as prose: the design tokens are described as "Vercel-style", and the
 * font notes document a Next.js internal module that ships inside `next` rather
 * than as a declared dependency. Neither couples the app to Vercel.
 *
 * Usage:
 *   npm run audit:vercel
 *
 * Exit code is 1 when anything is found, 0 otherwise, so CI can block on it.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The guard spells out the very patterns it bans, so it never scans itself.
const SELF_FILE = "scripts/audit-vercel.mjs";

// Reasoned exemptions. Add an entry only for a real, intentional reference —
// `rule` plus a substring of the reported token, and why it must stay:
//   { rule: "vercel-url", match: "old.vercel.app", reason: "..." }
// Empty is the correct state: nothing in the tree needs one.
const ALLOW = [];

const RULES = {
  "vercel-config": "a Vercel deployment configuration file",
  "vercel-dependency": "a package.json declaring a Vercel platform package",
  "vercel-cli": "a package.json script invoking the Vercel CLI",
  "vercel-env": "code reading a VERCEL_* environment variable",
  "vercel-url": "a *.vercel.app URL written into a tracked file",
};

// Never Vercel-bearing, and reading them as text would only add noise.
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "svg", "woff", "woff2", "ttf",
  "otf", "gz", "zip", "mp3", "mp4", "pdf", "lock",
]);

// Where an environment read can source a VERCEL_* value.
const SOURCE_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs"]);

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const MAX_FILE_BYTES = 2 * 1024 * 1024;

const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: ROOT,
  maxBuffer: 64 * 1024 * 1024,
})
  .toString()
  .split("\0")
  .filter(Boolean);

const findings = [];

function report(rule, file, line, message, target) {
  findings.push({ rule, file, line, message, target: target ?? message });
}

function lineAt(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

/** Tracked file text, or null for content that cannot carry a signal. */
function readSource(file) {
  if (BINARY_EXTENSIONS.has(path.extname(file).slice(1).toLowerCase())) return null;

  const absolute = path.join(ROOT, file);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;

  let source;
  try {
    source = fs.readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
  return source.includes("\0") ? null : source; // binary masquerading as text
}

/* -------------------------------------------------------------------------
 * Rules
 * ---------------------------------------------------------------------- */

function isVercelConfig(file) {
  const base = path.basename(file).toLowerCase();
  return base === "vercel.json" || file === ".vercel" || file.startsWith(".vercel/");
}

// A standalone `vercel` token (the CLI) — not @vercel/pkg, not a hyphenated
// name. Case-insensitive, since `Vercel` is the CLI's own spelling.
const VERCEL_CLI = /(?<![@\w/.-])vercel(?![-\w])/i;

function checkPackage(file) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
  } catch {
    return; // a malformed package.json is not this script's problem
  }

  for (const field of DEPENDENCY_FIELDS) {
    for (const name of Object.keys(pkg[field] ?? {})) {
      if (name === "vercel" || name.startsWith("@vercel/")) {
        report("vercel-dependency", file, 1, `${field} declares Vercel package ${name}`, name);
      }
    }
  }

  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    if (typeof command === "string" && VERCEL_CLI.test(command)) {
      report("vercel-cli", file, 1, `script "${name}" invokes the Vercel CLI`, name);
    }
  }
}

const VERCEL_ENV = /\b(?:process\.env|import\.meta\.env|env)\.(VERCEL_[A-Z0-9_]+)/g;

// Any host under vercel.app is an infrastructure URL wherever it appears, so
// docs are scanned too.
const VERCEL_URL = /\.vercel\.app\b/g;

function checkSource(file, source) {
  if (SOURCE_EXTENSIONS.has(path.extname(file).slice(1).toLowerCase())) {
    for (const match of source.matchAll(VERCEL_ENV)) {
      report("vercel-env", file, lineAt(source, match.index), `reads ${match[1]}`, match[1]);
    }
  }
  for (const match of source.matchAll(VERCEL_URL)) {
    report("vercel-url", file, lineAt(source, match.index), `${match[0]} is a Vercel URL`, match[0]);
  }
}

/* -------------------------------------------------------------------------
 * Run
 * ---------------------------------------------------------------------- */

for (const file of tracked) {
  if (file === SELF_FILE) continue;

  if (isVercelConfig(file)) {
    report("vercel-config", file, 1, "Vercel deployment configuration is not allowed");
  }
  if (path.basename(file) === "package.json") checkPackage(file);

  const source = readSource(file);
  if (source !== null) checkSource(file, source);
}

const isAllowed = (finding) =>
  ALLOW.some(
    (entry) =>
      entry.rule === finding.rule &&
      (finding.target.includes(entry.match) || finding.message.includes(entry.match)),
  );

const kept = findings.filter((finding) => !isAllowed(finding));
kept.sort((a, b) =>
  a.file === b.file ? a.line - b.line || a.rule.localeCompare(b.rule) : a.file.localeCompare(b.file),
);

for (const finding of kept) {
  process.stdout.write(`${finding.file}:${finding.line}  ${finding.rule}  ${finding.message}\n`);
}

if (kept.length === 0) {
  process.stdout.write(
    `Vercel drift audit clean: ${tracked.length} tracked files, ${Object.keys(RULES).length} rules.\n`,
  );
} else {
  process.stdout.write(
    `\n${kept.length} finding(s). Remove the Vercel reference, or add a reasoned entry to ALLOW in ${SELF_FILE}.\n`,
  );
  // Inline annotations on the pull request's diff.
  if (process.env.GITHUB_ACTIONS === "true") {
    for (const finding of kept) {
      process.stdout.write(
        `::error file=${finding.file},line=${finding.line}::${finding.rule}: ${finding.message}\n`,
      );
    }
  }
}

process.exit(kept.length > 0 ? 1 : 0);
