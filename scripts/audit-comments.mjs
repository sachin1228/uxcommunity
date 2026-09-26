#!/usr/bin/env node
/**
 * Comment audit.
 *
 * This repository documents itself in its comments, and that documentation
 * drifts the moment code moves underneath it: a file is deleted, a function is
 * renamed, a component's doc block ends up stranded above a private helper, a
 * paragraph keeps describing a fallback that no longer exists. Nothing
 * type-checks or lints a comment, so the rot is invisible until someone reads
 * the wrong line and believes it.
 *
 * This script treats comments as a checked artefact. Every rule here reports
 * drift it can *prove* against the working tree — a referenced file that does
 * not exist, a line reference past the end of its file, a backticked symbol
 * that appears nowhere in the code, a component doc attached to a helper — so a
 * failure is always real and never a matter of taste. Rules that would need
 * judgement (is this prose accurate?) are deliberately absent.
 *
 * Usage:
 *   npm run audit:comments
 *   node scripts/audit-comments.mjs --json
 *   node scripts/audit-comments.mjs --rule=dead-symbol,stale-path
 *
 * Exemptions live in scripts/comment-audit.allow.json and every entry must
 * carry a reason — an unexplained exemption is how an allowlist rots. An
 * exemption that stops matching anything is reported as a warning so it can be
 * deleted rather than accumulating.
 *
 * Exit code is 1 when anything is found, 0 otherwise, so CI can block on it.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_RELATIVE = "scripts/comment-audit.allow.json";
const CONFIG_PATH = path.join(ROOT, CONFIG_RELATIVE);

/* -------------------------------------------------------------------------
 * Options
 * ---------------------------------------------------------------------- */

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(
    [
      "Audit comments for drift against the working tree.",
      "",
      "  --json            machine-readable output",
      "  --rule=<a,b>      restrict to some rules (see RULES below)",
      "  --warn-only       report findings but exit 0",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const asJson = argv.includes("--json");
const warnOnly = argv.includes("--warn-only");
const ruleFilter = argv
  .filter((arg) => arg.startsWith("--rule="))
  .flatMap((arg) => arg.slice("--rule=".length).split(","))
  .map((name) => name.trim())
  .filter(Boolean);

const RULES = {
  "stale-path": "a file path named in a comment does not exist",
  "stale-line-ref": "a `file.ts:123` reference is past the end of its file",
  "module-path": "a module path named in a comment does not resolve",
  "dead-symbol": "a backticked symbol name appears nowhere in the code",
  "unknown-env": "an UPPER_SNAKE env name in a comment is never used in code",
  "banned-phrase": "a phrase describes behaviour the app no longer has",
  "misattached-doc": "a component's doc block is attached to a helper",
};

for (const name of ruleFilter) {
  if (!(name in RULES)) {
    process.stderr.write(
      `Unknown rule "${name}". Known rules: ${Object.keys(RULES).join(", ")}\n`,
    );
    process.exit(2);
  }
}

/* -------------------------------------------------------------------------
 * What we read, and how comments are extracted from it
 * ---------------------------------------------------------------------- */

// How a file's comments are spelled. `md` has no comment syntax, so its prose
// plays the role of a comment and code fences are skipped.
const FAMILIES = {
  ts: "clike",
  tsx: "clike",
  js: "clike",
  jsx: "clike",
  mjs: "clike",
  cjs: "clike",
  sql: "sql",
  sh: "hash",
  yml: "hash",
  yaml: "hash",
  toml: "hash",
  css: "css",
  md: "md",
};

// Extensions whose identifiers join the "does this symbol exist anywhere"
// corpus. Wider than FAMILIES: a symbol might only be declared in a generated
// types file or a Prisma schema, and that still counts as existing.
const CORPUS_EXTENSIONS = new Set([
  ...Object.keys(FAMILIES),
  "json",
  "prisma",
  "html",
  "conf",
  "example",
  "nvmrc",
  "npmrc",
]);

const PATH_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "sql", "sh", "yml", "yaml", "toml", "css",
  "md", "json", "prisma", "html",
]);

// Extensions specific enough to name a repository file on their own. `.js` and
// `.json` are how the world writes framework names and payload shapes
// (`Next.js`, `Node.js`, `res.json`), so those only count as a file reference
// when written as a path.
const SELF_EVIDENT_EXTENSIONS = new Set([
  "ts", "tsx", "mjs", "cjs", "sql", "sh", "yml", "yaml", "toml", "prisma",
]);

// Never tracked, so naming them cannot be drift: build output, dependency
// trees, and the native projects `expo prebuild` generates.
const UNTRACKED_SEGMENTS = [
  "node_modules/", ".next/", ".open-next/", ".wrangler/", "android/", "ios/",
];

// Comments that configure a linter, not prose about the code.
const LINT_DIRECTIVE = /eslint-(?:disable|enable)/;

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "svg", "woff", "woff2", "ttf",
  "otf", "gz", "zip", "mp3", "mp4", "pdf", "lock",
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Split a source file into comment text and everything that is not a comment.
 *
 * This is a hand-rolled scanner rather than a parser on purpose: it only has to
 * be right about where comments begin and end. Getting that wrong in the
 * permissive direction (treating code as a comment) is what would produce false
 * findings, so strings, regex literals and heredoc-ish delimiters are all
 * skipped over before comment detection is applied.
 *
 * Returns `{ ranges, masked }` where `ranges` are absolute comment spans and
 * `masked` is the source with comment characters replaced by spaces — newlines
 * preserved, so line numbers survive.
 */
function scanComments(source, family) {
  const ranges = [];
  const masked = source.split("");
  const length = source.length;

  const lineComments = family === "hash" ? ["#"] : family === "sql" ? ["--"] : ["//"];
  const blockComments = family !== "hash";
  const strings = family === "css" ? ['"', "'"] : ['"', "'", "`"];

  let i = 0;
  while (i < length) {
    const ch = source[i];
    const next = source[i + 1];

    // --- strings: skipped, never masked (their text is part of the corpus)
    if (strings.includes(ch)) {
      i = skipString(source, i, ch, family);
      continue;
    }

    // --- `$tag$ ... $tag$` in Postgres function bodies
    if (family === "sql" && ch === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(source.slice(i, i + 32));
      if (tag) {
        const close = source.indexOf(tag[0], i + tag[0].length);
        i = close === -1 ? length : close + tag[0].length;
        continue;
      }
    }

    // --- line comments
    const lineMarker = lineComments.find((marker) => source.startsWith(marker, i));
    if (lineMarker && lineCommentStartsHere(source, i, lineMarker)) {
      let end = source.indexOf("\n", i);
      if (end === -1) end = length;
      ranges.push({ start: i, end, block: false });
      blank(masked, i, end);
      i = end;
      continue;
    }

    // --- block comments
    if (blockComments && ch === "/" && next === "*") {
      let end = source.indexOf("*/", i + 2);
      end = end === -1 ? length : end + 2;
      ranges.push({ start: i, end, block: true });
      blank(masked, i, end);
      i = end;
      continue;
    }

    // --- regex literals, so `//` inside `/https?:\/\//` is not read as a comment
    if (family === "clike" && ch === "/" && startsRegex(masked, i)) {
      i = skipRegex(source, i);
      continue;
    }

    i += 1;
  }

  return { ranges, masked: masked.join("") };
}

/** `#` only opens a comment at line start or after whitespace (YAML, TOML, sh). */
function lineCommentStartsHere(source, index, marker) {
  if (marker === "//") return true;
  if (index === 0) return true;
  if (/\s/.test(source[index - 1])) return true;
  // `--comment` is a comment; `total--1` is not.
  return marker === "--" && /\s/.test(source[index + marker.length] ?? " ");
}

function skipString(source, start, quote, family) {
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    // Postgres escapes a quote by doubling it.
    if (family === "sql" && ch === quote && source[i + 1] === quote) {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    // A newline ends a non-template string; backticks may span lines.
    if (ch === "\n" && quote !== "`") return i;
    i += 1;
  }
  return i;
}

function skipRegex(source, start) {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) return i + 1;
    else if (ch === "\n") return start + 1; // not a regex after all
    i += 1;
  }
  return i;
}

/** A `/` opens a regex when the previous meaningful token cannot end an expression. */
function startsRegex(chars, index) {
  let k = index - 1;
  while (k >= 0 && /\s/.test(chars[k])) k -= 1;
  if (k < 0) return true;
  return "([{=,:;!&|?+-*%~^<>".includes(chars[k]);
}

function blank(chars, from, to) {
  for (let k = from; k < to; k += 1) {
    if (chars[k] !== "\n") chars[k] = " ";
  }
}

/** Markdown: everything outside a fenced code block reads as comment text. */
function markdownComments(source) {
  const ranges = [];
  let offset = 0;
  let fenced = false;

  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    const isFence = trimmed.startsWith("```") || trimmed.startsWith("~~~");
    if (isFence) {
      fenced = !fenced;
    } else if (!fenced && trimmed) {
      ranges.push({ start: offset, end: offset + line.length, block: false });
    }
    offset += line.length + 1;
  }

  return ranges;
}

/* -------------------------------------------------------------------------
 * Repository index — everything the rules resolve against
 * ---------------------------------------------------------------------- */

const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: ROOT,
  maxBuffer: 64 * 1024 * 1024,
})
  .toString()
  .split("\0")
  .filter(Boolean);

const trackedSet = new Set(tracked);

/** Third-party package names, so prose that opens with one is not read as a path. */
const dependencyNames = new Set();
for (const file of tracked.filter((name) => path.basename(name) === "package.json")) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        dependencyNames.add(name);
        if (name.startsWith("@")) dependencyNames.add(name.split("/")[1]);
      }
    }
  } catch {
    // A malformed package.json is not this script's problem.
  }
}

const lineStartsCache = new Map();

function lineStartsOf(source) {
  let starts = lineStartsCache.get(source);
  if (!starts) {
    starts = [0];
    for (let i = 0; i < source.length; i += 1) {
      if (source[i] === "\n") starts.push(i + 1);
    }
    lineStartsCache.set(source, starts);
  }
  return starts;
}

function lineAt(source, offset) {
  const starts = lineStartsOf(source);
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/** Does `candidate` name a tracked file — relative to the file it is written
 *  in, relative to the repo root, or as the tail of a deeper path? Comments
 *  rarely write a full path, so a segment-boundary suffix counts. */
function fileExists(candidate, fromDir, commentText, matchIndex) {
  for (const variant of fileVariants(candidate, commentText, matchIndex)) {
    if (trackedSet.has(path.posix.join(fromDir, variant))) return true;
    if (trackedSet.has(variant)) return true;
    // `github/workflows/ci.yml` names `.github/workflows/ci.yml`: a comment may
    // drop a leading dot-directory. The `.` form must still sit on a boundary,
    // so a lookalike file name cannot masquerade as the real one.
    if (tracked.some((file) => file.endsWith(`/${variant}`) || file === variant)) return true;
    if (variant.startsWith(".")) continue;
    if (tracked.some((file) => file.endsWith(`.${variant}`))) return true;
  }
  return false;
}

/** The candidate itself, plus the same candidate with the preceding word
 *  attached — repository directory names contain spaces here
 *  (`expo-app-standalone 3/lib/api.ts`). */
function fileVariants(candidate, commentText, matchIndex) {
  const variants = [candidate.startsWith("./") ? candidate.slice(2) : candidate];
  if (commentText === null || matchIndex === null) return variants;

  const before = commentText.slice(0, matchIndex).replace(/\s+$/, "");
  // Trailing word only: prose wraps the path in punctuation and backticks.
  const previousWord = (/[A-Za-z0-9._-]+$/.exec(before) ?? [""])[0];
  if (previousWord) variants.push(`${previousWord} ${candidate}`);

  return variants;
}

const directories = new Set();
for (const file of tracked) {
  const parts = file.split("/");
  for (let depth = 1; depth < parts.length; depth += 1) {
    directories.add(parts.slice(0, depth).join("/"));
  }
}

function directoryExists(candidate) {
  if (directories.has(candidate)) return true;
  return [...directories].some(
    (dir) => dir.endsWith(`/${candidate}`) || dir.endsWith(`.${candidate}`),
  );
}

/** Same idea for a module path written without an extension: either a directory,
 *  or a file whose extension the comment left implied. */
const moduleExists = new Map();
function modulePathExists(candidate) {
  if (!candidate) return true;
  if (moduleExists.has(candidate)) return moduleExists.get(candidate);

  const variants = [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    `${candidate}.js`,
    `${candidate}.jsx`,
    `${candidate}.mjs`,
    `${candidate}/index.ts`,
    `${candidate}/index.tsx`,
    `${candidate}/page.tsx`,
    `${candidate}/layout.tsx`,
    `${candidate}/route.ts`,
  ];
  const found =
    variants.some((variant) => fileExists(variant, "", null, null)) ||
    directoryExists(candidate);

  moduleExists.set(candidate, found);
  return found;
}

/* -------------------------------------------------------------------------
 * Readings — one per file, shared by every rule
 * ---------------------------------------------------------------------- */

function readFiles() {
  const readings = [];
  const corpus = new Set();

  for (const file of tracked) {
    const extension = path.extname(file).slice(1).toLowerCase();
    if (BINARY_EXTENSIONS.has(extension)) continue;

    const absolute = path.join(ROOT, file);
    let stat;
    try {
      stat = fs.statSync(absolute);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;

    let source;
    try {
      source = fs.readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    if (source.includes("\0")) continue;

    // The exemption list is metadata *about* comments. Reading it into the
    // corpus would let every exempted symbol vouch for itself, which is exactly
    // the finding the exemption exists to document.
    const exemptsSymbols = file === CONFIG_RELATIVE;

    const family = FAMILIES[extension];
    if (!family) {
      if (CORPUS_EXTENSIONS.has(extension) && !exemptsSymbols) addIdentifiers(corpus, source);
      continue;
    }

    const { ranges, masked } =
      family === "md"
        ? { ranges: markdownComments(source), masked: source }
        : scanComments(source, family);

    const comments = ranges.map((range) => ({
      line: lineAt(source, range.start),
      endLine: lineAt(source, Math.max(range.start, range.end - 1)),
      text: source.slice(range.start, range.end),
      block: range.block,
      jsdoc: source.startsWith("/**", range.start) && range.block,
    }));

    const code = family === "md" ? "" : masked;
    if (!exemptsSymbols) {
      if (family === "md") addIdentifiers(corpus, source);
      addIdentifiers(corpus, code);
    }

    readings.push({
      file,
      dir: path.posix.dirname(file),
      extension,
      family,
      code,
      comments,
      declarationLines: family === "md" ? null : findDeclarations(masked),
    });
  }

  return { readings, corpus };
}

function addIdentifiers(corpus, text) {
  for (const match of text.matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) corpus.add(match[0]);
}

/** Declaration sites in code position, for the misattached-doc rule. */
function findDeclarations(masked) {
  const declarations = new Map();
  const pattern =
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;

  masked.split("\n").forEach((line, index) => {
    const match = pattern.exec(line);
    if (match) declarations.set(index + 1, { kind: match[1], name: match[2] });
  });

  return declarations;
}

/* -------------------------------------------------------------------------
 * Rules
 * ---------------------------------------------------------------------- */

const findings = [];
const suppressed = new Map();

function report(rule, file, line, message, target) {
  findings.push({ rule, file, line, message, target: target ?? message });
}

/**
 * Visit every comment in a file, together with a way to turn an offset inside
 * that comment back into a line number — a finding in a 40-line block comment
 * is useless if it only names the line the block opens on.
 */
function eachComment(reading, rule, visit) {
  if (ruleFilter.length && !ruleFilter.includes(rule)) return;
  for (const comment of reading.comments) {
    visit(comment, (index) => comment.line + countNewlines(comment.text.slice(0, index)));
  }
}

function countNewlines(text) {
  let total = 0;
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") total += 1;
  return total;
}

function lastExtension(token) {
  return (token.match(/\.([A-Za-z0-9]{1,8})$/) ?? [])[1]?.toLowerCase();
}

/** Is this token written on a line that is already talking about a URL? */
function inUrlContext(text, index) {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  return /https?:\/\/|:\/\//.test(text.slice(lineStart, index));
}

// Path-ish run ending in an extension. The charsets carry `+ ( ) [ ]` because
// Next.js route segments spell paths that way (`app/+not-found.tsx`,
// `app/api/communities/[id]/route.ts`), and the lookbehind keeps a match from
// starting mid-token — `*.test.ts` must not read as a file called `test.ts`.
const PATH_TOKEN =
  /(?<![A-Za-z0-9_@.+()[\]/-])[A-Za-z0-9_@][A-Za-z0-9_@.+()[\]/-]*\.[A-Za-z0-9]{1,8}/g;

//
// Braces are deliberately left out of the charset: prose that enumerates
// alternatives at one path segment is an example, not a filename.
//

/** A token whose first segment is a DNS name is an upstream URL written without
 *  its scheme, not a path in this repository. */
function startsWithHostname(token) {
  if (!token.includes("/")) return false;
  const [head] = token.split("/");
  return /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+){2,}$/.test(head);
}

function ruleStalePath(reading) {
  eachComment(reading, "stale-path", (comment, lineOf) => {
    for (const match of comment.text.matchAll(PATH_TOKEN)) {
      const raw = match[0];
      const extension = lastExtension(raw);
      if (!extension || !PATH_EXTENSIONS.has(extension)) continue;

      const token = raw.replace(/[.,;:()]+$/, "");
      if (token.includes("://") || token.startsWith("node:")) continue;
      if (/[*<>|]/.test(token)) continue; // glob or placeholder
      if (token.includes("../")) continue; // illustrative, normalised at runtime
      if (startsWithHostname(token)) continue;
      if (UNTRACKED_SEGMENTS.some((segment) => token.includes(segment))) continue;
      if (dependencyNames.has(token.split("/")[0])) continue;
      if (inUrlContext(comment.text, match.index)) continue;
      // A bare `Next.js` is a product; a bare `pool.ts` is a claim about a file.
      if (!token.includes("/") && !SELF_EVIDENT_EXTENSIONS.has(extension)) continue;
      if (token.startsWith("@") && !token.startsWith("@/")) continue;
      if (fileExists(token, reading.dir, comment.text, match.index)) continue;

      report("stale-path", reading.file, lineOf(match.index), `\`${token}\` does not exist`, token);
    }
  });
}

function ruleStaleLineRef(reading) {
  eachComment(reading, "stale-line-ref", (comment, lineOf) => {
    for (const match of comment.text.matchAll(
      /([A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8}):(\d+)(?:-(\d+))?/g,
    )) {
      const [, token, first, last] = match;
      if (token.includes("://")) continue;
      const resolved = resolveTracked(token, reading.dir);
      if (!resolved) continue; // stale-path already reports a missing file
      const total = countLines(resolved);
      if ((last ? Number(last) : Number(first)) <= total) continue;
      report(
        "stale-line-ref",
        reading.file,
        lineOf(match.index),
        `\`${match[0]}\` points past the end of ${token} (${total} lines)`,
        `${token}:${first}${last ? `-${last}` : ""}`,
      );
    }
  });
}

const MODULE_PATH =
  /(?<![A-Za-z0-9_@.+()[\]{}/-])(?:@\/)?(?:apps\/(?:web|realtime)\/)?(?:lib|components|app|packages|hooks)\/[A-Za-z0-9_@.[\]{}/-]*[A-Za-z0-9_\]]/g;

function ruleModulePath(reading) {
  if (reading.family !== "clike" && reading.family !== "md") return;
  eachComment(reading, "module-path", (comment, lineOf) => {
    if (LINT_DIRECTIVE.test(comment.text)) return;
    for (const match of comment.text.matchAll(MODULE_PATH)) {
      const token = match[0].replace(/[.,;:()]+$/, "");
      if (PATH_EXTENSIONS.has(lastExtension(token))) continue; // covered by stale-path
      if (/[[\]<>*{}|]/.test(token)) continue; // parameterised example
      if (modulePathExists(token.replace(/^@\//, ""))) continue;
      report("module-path", reading.file, lineOf(match.index), `\`${token}\` does not resolve`, token);
    }
  });
}

function ruleDeadSymbol(reading, corpus) {
  eachComment(reading, "dead-symbol", (comment, lineOf) => {
    if (LINT_DIRECTIVE.test(comment.text)) return;
    for (const match of comment.text.matchAll(/`([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)(?:\(\))?`/g)) {
      const symbol = match[1].split(".").pop();
      if (symbol.length < 5) continue;
      if (!/^(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z]+[A-Za-z0-9]*|[a-z]+(?:_[a-z0-9]+)+|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)$/.test(symbol)) {
        continue;
      }
      if (corpus.has(symbol)) continue;
      report("dead-symbol", reading.file, lineOf(match.index), `\`${symbol}\` appears nowhere in the code`, symbol);
    }
  });
}

function ruleUnknownEnv(reading, corpus, config) {
  eachComment(reading, "unknown-env", (comment, lineOf) => {
    if (LINT_DIRECTIVE.test(comment.text)) return;
    for (const match of comment.text.matchAll(/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/g)) {
      const name = match[0];
      // `NEXT_PUBLIC_*` and `EXPO_PUBLIC_*` name a namespace, not one variable.
      const following = comment.text[match.index + name.length];
      if (following === "_" || following === "*") continue;
      if (name.length < 5 || config.envAllow.includes(name)) continue;
      if (corpus.has(name)) continue;
      report("unknown-env", reading.file, lineOf(match.index), `\`${name}\` is never read in code`, name);
    }
  });
}

function ruleBannedPhrase(reading, config) {
  eachComment(reading, "banned-phrase", (comment, lineOf) => {
    for (const entry of config.bannedPhrases) {
      const index = comment.text.toLowerCase().indexOf(entry.phrase.toLowerCase());
      if (index === -1) continue;
      // `except` names the files allowed to carry the phrase: the ones narrating
      // its removal, and the history that predates it.
      if (entry.exceptRe?.some((re) => re.test(reading.file))) continue;
      report("banned-phrase", reading.file, lineOf(index), entry.reason, entry.phrase);
    }
  });
}

// Deliberately narrow. These are openings that only make sense for a component;
// broader wording (`The card`, `The section`, `The row`) also opens honest docs
// for loaders and helpers, and a gate that cries wolf gets switched off.
const COMPONENT_SHAPE = /\b(?:Shown|Rendered by|Rendered inside|This component)\b/;

function ruleMisattachedDoc(reading) {
  // A component doc can only be misplaced where components live.
  if (reading.extension !== "tsx") return;
  if (!reading.declarationLines || reading.declarationLines.size === 0) return;

  const looksLikeComponent = (declaration) =>
    declaration &&
    (declaration.kind === "function" || declaration.kind === "const") &&
    /^[A-Z]/.test(declaration.name);

  // Only meaningful in a file that exports a component in the first place.
  if (![...reading.declarationLines.values()].some(looksLikeComponent)) return;

  eachComment(reading, "misattached-doc", (comment) => {
    if (!comment.jsdoc) return;
    if (comment.text.split("\n").length < 3) return;
    if (!COMPONENT_SHAPE.test(comment.text)) return;

    const attached = [1, 2, 3]
      .map((offset) => reading.declarationLines.get(comment.endLine + offset))
      .find(Boolean);
    if (!attached) return;
    if (looksLikeComponent(attached)) return;

    report(
      "misattached-doc",
      reading.file,
      comment.line,
      `doc reads like a component but is attached to ${attached.kind} \`${attached.name}\``,
      `${attached.kind} ${attached.name}`,
    );
  });
}

const resolvedFiles = new Map();

function resolveTracked(token, fromDir) {
  if (resolvedFiles.has(token)) return resolvedFiles.get(token);
  const candidates = [
    path.posix.join(fromDir, token),
    token,
    ...tracked.filter((file) => file === token || file.endsWith(`/${token}`)),
  ];
  const found = candidates.find((candidate) => trackedSet.has(candidate)) ?? null;
  resolvedFiles.set(token, found);
  return found;
}

const lineCounts = new Map();

function countLines(file) {
  if (!lineCounts.has(file)) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    lineCounts.set(file, source.split("\n").length);
  }
  return lineCounts.get(file);
}

/* -------------------------------------------------------------------------
 * Exemptions
 * ---------------------------------------------------------------------- */

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { files: [], allow: [], bannedPhrases: [], envAllow: [] };
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  for (const key of ["files", "allow", "bannedPhrases", "envAllow"]) {
    if (config[key] !== undefined && !Array.isArray(config[key])) {
      process.stderr.write(`${CONFIG_PATH}: \`${key}\` must be an array\n`);
      process.exit(2);
    }
  }

  for (const entry of config.allow ?? []) {
    if (!entry.reason) {
      process.stderr.write(
        `${CONFIG_PATH}: every \`allow\` entry needs a reason (${JSON.stringify(entry)})\n`,
      );
      process.exit(2);
    }
  }

  for (const entry of config.bannedPhrases ?? []) {
    if (!entry.phrase || !entry.reason) {
      process.stderr.write(
        `${CONFIG_PATH}: every \`bannedPhrases\` entry needs a phrase and a reason\n`,
      );
      process.exit(2);
    }
  }

  return {
    files: config.files ?? [],
    allow: config.allow ?? [],
    // Compiled up front so the rule itself stays a plain list scan.
    bannedPhrases: (config.bannedPhrases ?? []).map((entry) => ({
      ...entry,
      exceptRe: (entry.except ?? []).map(globToRegExp),
    })),
    envAllow: config.envAllow ?? [],
  };
}

/** Minimal glob: `**` crosses directories, `*` does not. */
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped
    .replace(/\*\*\//g, "(?:.*/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${pattern}$`);
}

const loadedConfig = loadConfig();
const skipMatchers = loadedConfig.files.map((glob) => ({ glob, re: globToRegExp(glob) }));
const allowMatchers = loadedConfig.allow.map((entry) => ({
  entry,
  fileRe: entry.file ? globToRegExp(entry.file) : null,
}));

function isSkipped(file) {
  return skipMatchers.some(({ re }) => re.test(file));
}

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

const { readings, corpus } = readFiles();

for (const reading of readings) {
  if (isSkipped(reading.file)) continue;
  ruleStalePath(reading);
  ruleStaleLineRef(reading);
  ruleModulePath(reading);
  ruleDeadSymbol(reading, corpus);
  ruleUnknownEnv(reading, corpus, loadedConfig);
  ruleBannedPhrase(reading, loadedConfig);
  ruleMisattachedDoc(reading);
}

const kept = findings.filter((finding) => !suppressAllowed(finding));
kept.sort((a, b) =>
  a.file === b.file ? a.line - b.line || a.rule.localeCompare(b.rule) : a.file.localeCompare(b.file),
);

const unusedAllow = allowMatchers
  .filter(({ entry }) => !suppressed.has(JSON.stringify(entry)))
  .map(({ entry }) => entry);

const unusedSkip = skipMatchers
  .filter(({ glob }) => !readings.some((reading) => globToRegExp(glob).test(reading.file)))
  .map(({ glob }) => glob);

if (asJson) {
  process.stdout.write(
    `${JSON.stringify(
      {
        findings: kept,
        scanned: readings.length,
        unusedExemptions: { allow: unusedAllow, files: unusedSkip },
      },
      null,
      2,
    )}\n`,
  );
} else {
  const filesTouched = new Set(kept.map((finding) => finding.file));
  for (const finding of kept) {
    process.stdout.write(
      `${finding.file}:${finding.line}  ${finding.rule}  ${finding.message}\n`,
    );
  }

  if (kept.length === 0) {
    process.stdout.write(
      `Comment audit clean: ${readings.length} files with comments, ${Object.keys(RULES).length} rules.\n`,
    );
  } else {
    const perRule = new Map();
    for (const finding of kept) perRule.set(finding.rule, (perRule.get(finding.rule) ?? 0) + 1);
    process.stdout.write(
      `\n${kept.length} finding(s) in ${filesTouched.size} file(s): ` +
        `${[...perRule].map(([rule, count]) => `${rule} ${count}`).join(", ")}\n`,
    );
    process.stdout.write(
      "Fix the comment (preferred) or add a reasoned exemption to scripts/comment-audit.allow.json.\n",
    );
  }

  // Only meaningful on a clean run: where there are findings, an exemption may
  // simply not have been reached yet.
  if (kept.length === 0 && (unusedAllow.length || unusedSkip.length)) {
    process.stdout.write("\nStale exemptions, safe to delete:\n");
    for (const entry of unusedAllow) {
      process.stdout.write(`  allow  ${entry.rule}: ${entry.match} (${entry.reason})\n`);
    }
    for (const glob of unusedSkip) process.stdout.write(`  files  ${glob}\n`);
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
