#!/usr/bin/env node
/**
 * Regenerate `lib/supabase/database.types.ts` from the live Supabase project.
 *
 * Why this exists
 * ---------------
 * This project ships no generated Supabase types file, so supabase-js cannot
 * infer what a query returns and `tsc` collapses every `.select()` result to
 * `never` — which is why `next.config.js` still sets
 * `typescript.ignoreBuildErrors: true`. Regenerating the types (and passing
 * them to `createClient<Database>(...)`) is the fix; this script makes that a
 * one-liner so it can be re-run after every migration.
 *
 * Requires the Supabase CLI to be authenticated once:
 *
 *     npx supabase login
 *
 * Then:
 *
 *     npm run db:types
 *
 * The project ref is read from NEXT_PUBLIC_SUPABASE_URL (found in the
 * environment or in `.env.local`), so no ref is hardcoded here.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(webDir, "lib", "supabase", "database.types.ts");

/** Minimal dotenv reader — we only need one key, so no dependency. */
function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const fromFiles = {
  ...readEnvFile(path.join(webDir, ".env")),
  ...readEnvFile(path.join(webDir, ".env.local")),
};
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? fromFiles.NEXT_PUBLIC_SUPABASE_URL;

if (!supabaseUrl) {
  console.error(
    "Could not determine the Supabase project: NEXT_PUBLIC_SUPABASE_URL is not\n" +
      "set in the environment or in apps/web/.env.local."
  );
  process.exit(1);
}

const projectRef = /^https?:\/\/([a-z0-9-]+)\.supabase\.(co|in)/.exec(supabaseUrl)?.[1];
if (!projectRef) {
  console.error(
    `Could not parse a project ref out of NEXT_PUBLIC_SUPABASE_URL (${supabaseUrl}).`
  );
  process.exit(1);
}

// The CLI streams progress on stderr and the TypeScript source on stdout, so
// only stdout is redirected into the file.
process.stdout.write(
  `Generating types for project ${projectRef} → lib/supabase/database.types.ts\n`
);

const result = spawnSync(
  "npx",
  ["--yes", "supabase", "gen", "types", "typescript", "--schema", "public", "--project-id", projectRef],
  { cwd: webDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" }
);

if (result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0 || !result.stdout?.includes("export type Database")) {
  console.error(
    "\nFailed to generate types. The most common cause is not being logged in:\n" +
      "  npx supabase login\n"
  );
  process.exit(result.status || 1);
}

writeFileSync(OUTPUT, result.stdout, "utf8");
process.stdout.write(
  `\nWrote ${OUTPUT} (${result.stdout.length} bytes).\n` +
    "Next: pass it to the service client — createClient<Database>(url, key) —\n" +
    "then `npm run typecheck` and re-enable typescript.ignoreBuildErrors.\n"
);
