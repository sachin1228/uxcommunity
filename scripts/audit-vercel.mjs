#!/usr/bin/env node
/**
 * Vercel drift audit.
 *
 * The app deploys only to Cloudflare Workers (via OpenNext) and consumes no
 * Vercel platform at runtime: there is no Vercel package, no VERCEL_* env read,
 * no Vercel CLI step in CI, and no Vercel deployment config. That is a property
 * worth holding, because a stray vercel.json, a @vercel/* dependency or a
 * hard-coded vercel.app URL quietly reintroduces a second deployment target
 * that no workflow maintains.
 *
 * This script fails on Vercel *infrastructure* signals and deliberately ignores
 * the word as prose: the design tokens are described as "Vercel-style", and the
 * font notes document a Next.js internal module that ships inside `next` rather
 * than as a declared dependency. Neither couples the app to Vercel, so neither
 * is flagged.
 *
 * Usage:
 *   npm run audit:vercel
 *   node scripts/audit-vercel.mjs --json
 *   node scripts/audit-vercel.mjs --warn-only
 *
 * Exemptions live in scripts/vercel-audit.allow.json and every entry must carry
 * a reason — an unexplained exemption is how an allowlist rots. An exemption
 * that stops matching anything is reported as stale so it can be deleted.
 *
 * Exit code is 1 when anything is found, 0 otherwise, so CI can block on it.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_RELATIVE = "scripts/vercel-audit.allow.json";
const CONFIG_PATH = path.join(ROOT, CONFIG_RELATIVE);
// The guard spells out the very patterns it bans, so it and its allowlist are
// never scanned by themselves.
const SELF_FILES = new Set(["scripts/audit-vercel.mjs", CONFIG_RELATIVE]);

/* -------------------------------------------------------------------------
 * Options
 * ---------------------------------------------------------------------- */

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(
    [
      "Audit the tracked tree for Vercel deployment drift.",
      "",
      "  --json        machine-readable output",
      "  --warn-only   report findings but exit 0",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const asJson = argv.includes("--json");
const warnOnly = argv.includes("--warn-only");

const RULES = {
  "vercel-config": "a tracked Vercel deployment configuration file",
  "vercel-dependency": "a package.json declaring a Vercel platform package",
  "vercel-cli": "a package.json script invoking the Vercel CLI",
  "vercel-env": "code reading a VERCEL_* environment variable",
  "vercel-url": "a *.vercel.app URL written into a tracked file",
};

/* -------------------------------------------------------------------------
 * What we read
 * ---------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------
 * Findings
 * ---------------------------------------------------------------------- */

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

function readSource(file) {
  const extension = path.extname(file).slice(1).toLowerCase();
  if (BINARY_EXTENSIONS.has(extension)) return null;

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
  if (source.includes("\0")) return null; // binary masquerading as text
  return source;
}

/* -------------------------------------------------------------------------
 * Rules
 * ---------------------------------------------------------------------- */

function isVercelConfigPath(file) {
  const base = path.basename(file).toLowerCase();
  return base === "vercel.json" || file === ".vercel" || file.startsWith(".vercel/");
}

// A standalone `vercel` token (the CLI), not `@vercel/pkg` and not a hyphenated
// package name. Case-insensitive, since `Vercel` is the CLI's own spelling.
const VERCEL_CLI = /(?<![@\w/.-])vercel(?![-\w])/i;

function rulePackage(file) {
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

function ruleEnv(file, source) {
  for (const match of source.matchAll(VERCEL_ENV)) {
    report("vercel-env", file, lineAt(source, match.index), `reads ${match[1]}`, match[1]);
  }
}

// Any host under the vercel.app subdomain — an infrastructure URL wherever it
// appears, so docs are scanned too. A reference that must stay gets a reasoned
// allowlist entry rather than a weaker rule.
const VERCEL_URL = /\.vercel\.app\b/g;

function ruleUrl(file, source) {
  for (const match of source.matchAll(VERCEL_URL)) {
    report("vercel-url", file, lineAt(source, match.index), `${match[0]} is a Vercel URL`, match[0]);
  }
}

/* -------------------------------------------------------------------------
 * Exemptions
 * ---------------------------------------------------------------------- */

/** Minimal glob: `**` crosses directories, `*` does not. */
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped
    .replace(/\*\*\//g, "(?:.*/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${pattern}$`);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { allow: [] };

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  if (config.allow !== undefined && !Array.isArray(config.allow)) {
    process.stderr.write(`${CONFIG_RELATIVE}: \`allow\` must be an array\n`);
    process.exit(2);
  }

  for (const entry of config.allow ?? []) {
    if (!entry.rule || !entry.match || !entry.reason) {
      process.stderr.write(
        `${CONFIG_RELATIVE}: every \`allow\` entry needs rule, match and reason (${JSON.stringify(entry)})\n`,
      );
      process.exit(2);
    }
    if (!(entry.rule in RULES)) {
      process.stderr.write(`${CONFIG_RELATIVE}: unknown rule "${entry.rule}"\n`);
      process.exit(2);
    }
  }

  return { allow: config.allow ?? [] };
}

const loadedConfig = loadConfig();
const allowMatchers = loadedConfig.allow.map((entry) => ({
  entry,
  fileRe: entry.file ? globToRegExp(entry.file) : null,
}));
const suppressed = new Map();

function suppressAllowed(finding) {
  const matcher = allowMatchers.find(({ entry, fileRe }) => {
    if (entry.rule !== finding.rule) return false;
    if (fileRe && !fileRe.test(finding.file)) return false;
    return finding.target.includes(entry.match) || finding.message.includes(entry.match);
  });
  if (!matcher) return false;
  const key = JSON.stringify(matcher.entry);
  suppressed.set(key, (suppressed.get(key) ?? 0) + 1);
  return true;
}

/* -------------------------------------------------------------------------
 * Run
 * ---------------------------------------------------------------------- */

for (const file of tracked) {
  if (SELF_FILES.has(file)) continue;

  if (isVercelConfigPath(file)) {
    report("vercel-config", file, 1, "Vercel deployment configuration is not allowed");
  }

  if (path.basename(file) === "package.json") rulePackage(file);

  const source = readSource(file);
  if (source === null) continue;

  const extension = path.extname(file).slice(1).toLowerCase();
  if (SOURCE_EXTENSIONS.has(extension)) ruleEnv(file, source);
  ruleUrl(file, source);
}

const kept = findings.filter((finding) => !suppressAllowed(finding));
kept.sort((a, b) =>
  a.file === b.file ? a.line - b.line || a.rule.localeCompare(b.rule) : a.file.localeCompare(b.file),
);

const unusedAllow = allowMatchers
  .filter(({ entry }) => !suppressed.has(JSON.stringify(entry)))
  .map(({ entry }) => entry);

if (asJson) {
  process.stdout.write(
    `${JSON.stringify({ findings: kept, scanned: tracked.length, unusedExemptions: { allow: unusedAllow } }, null, 2)}\n`,
  );
} else {
  for (const finding of kept) {
    process.stdout.write(`${finding.file}:${finding.line}  ${finding.rule}  ${finding.message}\n`);
  }

  if (kept.length === 0) {
    process.stdout.write(
      `Vercel drift audit clean: ${tracked.length} tracked files, ${Object.keys(RULES).length} rules.\n`,
    );
  } else {
    process.stdout.write(
      `\n${kept.length} finding(s). Remove the Vercel reference (preferred) or add a reasoned exemption to ${CONFIG_RELATIVE}.\n`,
    );
  }

  if (kept.length === 0 && unusedAllow.length) {
    process.stdout.write("\nStale exemptions, safe to delete:\n");
    for (const entry of unusedAllow) {
      process.stdout.write(`  ${entry.rule}: ${entry.match} (${entry.reason})\n`);
    }
  }

  // Inline annotations on the pull request's diff.
  if (process.env.GITHUB_ACTIONS === "true") {
    for (const finding of kept) {
      process.stdout.write(
        `::error file=${finding.file},line=${finding.line}::${finding.rule}: ${finding.message}\n`,
      );
    }
  }
}

process.exit(kept.length > 0 && !warnOnly ? 1 : 0);
