#!/usr/bin/env node
/**
 * Import operator-owned city catalog rows through the admin API.
 *
 * Cities are master data, not schema: this command is the repeatable path for
 * adding them to an existing installation (never a migration). It signs in as
 * an environment admin, skips names that already exist, and is safe to re-run.
 *
 * Usage:
 *   npm run cities:import                         (defaults to the committed list)
 *   npm run cities:import -- --dry-run            (sign in and report only)
 *   npm run cities:import -- --file <path> --base-url <url>
 *
 * Credentials come from ADMIN_EMAIL + ADMIN_PASSWORD when both are set;
 * otherwise the command prompts, and the password is read with echo off.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import readline from "node:readline";

const DEFAULT_FILE = "data/cities/global-design-hubs.json";
const DEFAULT_BASE_URL = "https://app.uxcommunity.in";
const MAX_NAME_CHARS = 100;
const WRITE_PAUSE_MS = 150;

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function parseArgs(argv) {
  const options = { file: DEFAULT_FILE, baseUrl: DEFAULT_BASE_URL, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--file") options.file = argv[++index] ?? "";
    else if (arg === "--base-url") options.baseUrl = argv[++index] ?? "";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.file) throw new Error("--file needs a path");
  if (!/^https?:\/\//.test(options.baseUrl)) throw new Error("--base-url must be http(s)");
  options.baseUrl = options.baseUrl.replace(/\/+$/, "");
  return options;
}

async function loadCities(path) {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(parsed.cities)) throw new Error(`${path}: expected a "cities" array`);

  const seen = new Set();
  return parsed.cities.map((name, index) => {
    if (typeof name !== "string") throw new Error(`${path}: city #${index + 1} is not a string`);
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > MAX_NAME_CHARS) {
      throw new Error(`${path}: city #${index + 1} must be 1-${MAX_NAME_CHARS} characters`);
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) throw new Error(`${path}: duplicate city "${trimmed}"`);
    seen.add(key);
    return trimmed;
  });
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolveAsk) => rl.question(question, (answer) => {
    rl.close();
    resolveAsk(answer.trim());
  }));
}

function askHidden(question) {
  return new Promise((resolveAsk) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const finish = (result) => {
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      resolveAsk(result);
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish(value);
        if (char === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else {
          value += char;
          process.stdout.write("*");
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function signIn(baseUrl, email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Sign-in failed (${response.status}): ${body.error ?? "unknown error"}`);
  }
  const cookie = (response.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("Sign-in succeeded but returned no session cookie");
  return cookie;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const file = resolve(options.file);
  const cities = await loadCities(file);

  console.log(`File:   ${file} (${cities.length} cities)`);
  console.log(`Target: ${options.baseUrl}${options.dryRun ? "  (dry run)" : ""}\n`);

  const email = process.env.ADMIN_EMAIL?.trim() || (await ask("Admin email: ")).toLowerCase();
  const password = process.env.ADMIN_PASSWORD || (await askHidden("Admin password: "));
  const cookie = await signIn(options.baseUrl, email, password);

  const catalogResponse = await fetch(`${options.baseUrl}/api/admin/cities?all=true`, {
    headers: { Cookie: cookie },
  });
  if (!catalogResponse.ok) {
    throw new Error(
      `This account cannot use the admin API (${catalogResponse.status}). Sign in with an admin account.`
    );
  }
  const existing = new Set(
    ((await catalogResponse.json().catch(() => ({}))).cities ?? []).map((city) =>
      String(city.name).toLowerCase()
    )
  );
  console.log(`Signed in. ${existing.size} cities already in the master list.\n`);

  const added = [];
  const skipped = [];
  const failed = [];

  for (const [index, name] of cities.entries()) {
    if (existing.has(name.toLowerCase())) {
      skipped.push(name);
      continue;
    }
    if (options.dryRun) {
      added.push(name);
      continue;
    }

    const response = await fetch(`${options.baseUrl}/api/admin/cities`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.status === 201) {
      added.push(name);
      existing.add(name.toLowerCase());
    } else if (response.status === 409) {
      skipped.push(name);
    } else if (response.status === 401 || response.status === 403) {
      console.error(`\nSession rejected (${response.status}) after ${added.length} adds. Stopping.`);
      console.error("Re-run the command; cities already added are skipped.");
      process.exit(1);
    } else {
      failed.push(`${name} (${response.status}${body.error ? `: ${body.error}` : ""})`);
    }

    if ((index + 1) % 10 === 0) console.log(`  ${index + 1}/${cities.length} processed…`);
    await sleep(WRITE_PAUSE_MS);
  }

  console.log(`\nAdded: ${added.length}`);
  if (skipped.length) console.log(`Already existed: ${skipped.length} (${skipped.join(", ")})`);
  if (failed.length) {
    console.error(`Failed: ${failed.length}`);
    for (const line of failed) console.error(`  - ${line}`);
  }
  console.log(
    options.dryRun
      ? "\nDry run — nothing was written."
      : "\nNext: Admin → Cities → Fetch images to attach photos."
  );
  process.exit(failed.length ? 2 : 0);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
