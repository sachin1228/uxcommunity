#!/usr/bin/env node
/**
 * Dev runner: `next dev` plus a TypeScript watcher, side by side.
 *
 * Why this exists
 * ---------------
 * `next build` type-checks the project, but `next dev` does not — in Next 16
 * the checker is only wired into the build path (see
 * `next/dist/build/type-check.js`). And `next.config.js` sets
 * `typescript.ignoreBuildErrors: true` (kept until the Supabase generated
 * types land), so production builds skip the check too.
 *
 * The result was that a developer could run localhost:3000 all day and never
 * see that the project has type errors. This script restores that feedback:
 * it starts the normal dev server and a `tsc --watch` next to it, prefixing
 * compiler output with `[typecheck]` so it is distinguishable from server logs.
 *
 * Everything after the script name is forwarded to `next dev`, so
 * `npm run dev` keeps its usual `-p 3000 -H 0.0.0.0` behaviour.
 *
 * Set SKIP_TYPECHECK=1 to run the dev server alone (`npm run dev:no-typecheck`).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Find a package entry file in the nearest `node_modules`, walking up from the
 * script so it works when the dependency is hoisted to the monorepo root.
 * Falls back to the package's own require resolution, then to PATH.
 */
function findEntry(dir, packagePath) {
  let current = dir;
  while (true) {
    const candidate = path.join(current, "node_modules", packagePath);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  try {
    return require.resolve(packagePath, { paths: [dir] });
  } catch {
    return null;
  }
}

const children = [];
let exiting = false;

function stopAll() {
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
  }
}

function shutdown(code) {
  if (exiting) return;
  exiting = true;
  stopAll();
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

/** Spawn `node <resolved entry>` so the local install is used, not a global one. */
function spawnEntry(label, entryPath, args, { fallbackName, stdio }) {
  if (entryPath) {
    return { child: spawn(process.execPath, [entryPath, ...args], { stdio }), label };
  }
  // Last resort: rely on PATH (npm puts node_modules/.bin there for scripts).
  return { child: spawn(fallbackName, args, { stdio }), label };
}

const nextEntry = findEntry(scriptDir, path.join("next", "dist", "bin", "next"));
const dev = spawnEntry("next", nextEntry, ["dev", ...process.argv.slice(2)], {
  fallbackName: "next",
  stdio: "inherit",
}).child;

children.push(dev);

// Without this, a failed spawn throws an unhandled 'error' event.
dev.on("error", (error) => {
  process.stderr.write(
    `Could not start \`next dev\` (${error.message}). Run \`npm run dev\` from apps/web.\n`
  );
  shutdown(1);
});

dev.on("exit", (code) => shutdown(code ?? 0));

if (process.env.SKIP_TYPECHECK !== "1") {
  const tscEntry = findEntry(scriptDir, path.join("typescript", "bin", "tsc"));
  const typecheck = spawnEntry(
    "typecheck",
    tscEntry,
    ["--noEmit", "--watch", "--preserveWatchOutput"],
    { fallbackName: "tsc", stdio: ["ignore", "pipe", "pipe"] }
  ).child;

  children.push(typecheck);

  // tsc emits whole lines; buffer so a chunk split mid-line never produces
  // a half-prefixed line.
  const forward = (out) => {
    let buffer = "";
    return (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) out.write(`[typecheck] ${line}\n`);
      }
    };
  };

  typecheck.stdout.on("data", forward(process.stdout));
  typecheck.stderr.on("data", forward(process.stderr));

  typecheck.on("error", (error) => {
    process.stderr.write(
      `[typecheck] could not start tsc (${error.message}). ` +
        "Run it separately with `npm run typecheck:watch`.\n"
    );
  });

  typecheck.on("exit", (code, signal) => {
    if (exiting || code === 0) return;
    process.stderr.write(
      `[typecheck] watcher stopped (${signal ?? `exit ${code}`}) — ` +
        "type errors are no longer being reported. " +
        "Run `npm run typecheck:watch` in another terminal.\n"
    );
  });
}
