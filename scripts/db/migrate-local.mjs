#!/usr/bin/env node
// Applies pending migration files to the running isolated local Supabase stack.
// Never touches a remote database: both the manifest and the DB URL must be
// loopback, and the stack must identify itself as development.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const work = resolve(root, ".local/development");
const manifest = resolve(work, "environment.json");
const startupLog = resolve(work, "startup.private.log");
const cliVersion = readFileSync(resolve(root, "supabase/cli-version"), "utf8").trim();
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function localDbUrl() {
  const status = spawnSync(
    "npx",
    ["--yes", `supabase@${cliVersion}`, "--workdir", work, "status", "--env", "--output-format", "json"],
    { cwd: root, encoding: "utf8" },
  );
  if (status.status === 0) {
    try {
      const parsed = JSON.parse(status.stdout);
      if (typeof parsed.DB_URL === "string") return parsed.DB_URL;
    } catch {
      // Fall through to the startup log written by the local bootstrap.
    }
  }

  if (!existsSync(startupLog)) return null;
  const matches = readFileSync(startupLog, "utf8").match(/postgresql:\/\/[^\s"'`]+/g);
  return matches?.at(-1) ?? null;
}

if (!existsSync(manifest)) {
  fail("Local environment is not set up. Run: npm run env:setup");
}

const environment = JSON.parse(readFileSync(manifest, "utf8"));
if (environment.APP_ENV !== "development") {
  fail("Refusing to migrate: .local/development/environment.json is not a development environment.");
}
if (!loopback.has(new URL(environment.NEXT_PUBLIC_SUPABASE_URL).hostname)) {
  fail("Refusing to migrate: the local Supabase API URL is not loopback.");
}

const dbUrl = localDbUrl();
if (!dbUrl) {
  fail("Could not find the running local database. Start it with: npm run env:setup");
}
let dbHost;
try {
  dbHost = new URL(dbUrl).hostname;
} catch {
  fail("The local database URL could not be parsed.");
}
if (!loopback.has(dbHost)) {
  fail("Refusing to migrate: the database URL is not loopback.");
}
// The loopback stack runs without TLS; a remote URL would be refused above.
const dbUrlNoTls = new URL(dbUrl);
dbUrlNoTls.searchParams.set("sslmode", "disable");

const source = resolve(root, "supabase/migrations");
const target = resolve(work, "supabase/migrations");
mkdirSync(target, { recursive: true });
for (const file of readdirSync(source).filter((name) => name.endsWith(".sql"))) {
  copyFileSync(resolve(source, file), resolve(target, file));
}

console.log("Applying pending migrations to the local database...");
const push = spawnSync(
  "npx",
  ["--yes", `supabase@${cliVersion}`, "db", "push", "--db-url", dbUrlNoTls.toString(), "--skip-vault", "--yes"],
  { cwd: root, stdio: "inherit" },
);
if (push.status !== 0) {
  fail("Local migration failed; nothing was forced. Fix the migration and re-run.");
}
console.log("Local database migrations are up to date.");
