#!/usr/bin/env node

/**
 * Measure how long a real browser takes to open a community chat on staging.
 *
 * This is read-only: it navigates to one existing community and never sends a
 * message or changes membership. Each sample gets a fresh browser context so
 * the browser cache and React query cache do not make later samples look warm.
 *
 * Required: E2E_APP_URL, E2E_COMMUNITY_ID and either E2E_SESSION_COOKIE or
 * E2E_EMAIL + E2E_PASSWORD. Optional: E2E_SAMPLES (default 10),
 * E2E_CHAT_TIMING_OUT (JSON output path).
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const APP_URL = (process.env.E2E_APP_URL ?? "").replace(/\/+$/, "");
const COMMUNITY_ID = process.env.E2E_COMMUNITY_ID ?? "";
const SESSION_COOKIE = process.env.E2E_SESSION_COOKIE ?? "";
const EMAIL = process.env.E2E_EMAIL ?? "";
const PASSWORD = process.env.E2E_PASSWORD ?? "";
const SAMPLES = Math.max(1, Math.min(50, Number(process.env.E2E_SAMPLES ?? 10)));
const OUTPUT = process.env.E2E_CHAT_TIMING_OUT ?? "";
const COMPOSER = 'textarea[placeholder="Type a message…"], input[placeholder="Type a message…"]';
const MESSAGE_API = `/api/communities/${COMMUNITY_ID}/messages`;

assert(APP_URL, "E2E_APP_URL must point to the staging web app");
assert(COMMUNITY_ID, "E2E_COMMUNITY_ID must be a community the test member belongs to");
assert(SESSION_COOKIE || (EMAIL && PASSWORD), "Set E2E_SESSION_COOKIE or both E2E_EMAIL and E2E_PASSWORD");
assert.equal(new URL(APP_URL).protocol, "https:", "Refusing to benchmark a non-HTTPS target");
assert.match(new URL(APP_URL).hostname, /staging/i, "Refusing to benchmark a host without 'staging' in its name");

const browser = await chromium.launch({ headless: true });
const origin = new URL(APP_URL).origin;

async function getStorageState() {
  const context = await browser.newContext();
  const page = await context.newPage();

  if (SESSION_COOKIE) {
    await context.addCookies([{
      name: "uxcommunity_session",
      value: SESSION_COOKIE,
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    }]);
  } else {
    await page.goto(`${APP_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  }

  const state = await context.storageState();
  await context.close();
  return state;
}

const state = await getStorageState();
const samples = [];

try {
  for (let index = 0; index < SAMPLES; index += 1) {
    const context = await browser.newContext({ storageState: state });
    const page = await context.newPage();
    let messageApiAt = null;
    let messageApiStatus = null;
    const startedAt = performance.now();
    const messagesResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === origin && url.pathname === MESSAGE_API;
    }, { timeout: 60_000 });

    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin === origin && url.pathname === MESSAGE_API && !messageApiAt) {
        messageApiAt = performance.now();
        messageApiStatus = response.status();
      }
    });

    const navigation = await page.goto(`${APP_URL}/dashboard/communities/${COMMUNITY_ID}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    assert(navigation, `Sample ${index + 1}: navigation did not return a response`);
    assert.equal(navigation.status(), 200, `Sample ${index + 1}: chat page returned HTTP ${navigation.status()}`);

    const messagesResponse = await messagesResponsePromise;
    messageApiStatus = messagesResponse.status();
    assert.equal(messageApiStatus, 200, `Sample ${index + 1}: messages API returned HTTP ${messageApiStatus}`);
    await page.locator(COMPOSER).first().waitFor({ state: "visible", timeout: 60_000 });
    await page.getByRole("status", { name: "Loading messages" }).waitFor({ state: "hidden", timeout: 60_000 });

    const ready = await page.evaluate(() => ({
      domContentLoaded: performance.getEntriesByType("navigation")[0]?.domContentLoadedEventEnd ?? null,
    }));
    const chatReadyMs = Math.round(performance.now() - startedAt);
    samples.push({
      sample: index + 1,
      chatReadyMs,
      messageApiMs: messageApiAt === null ? null : Math.round(messageApiAt - startedAt),
      messageApiStatus,
      navigationTtfbMs: Math.round(navigation.timing().responseStart - navigation.timing().startTime),
      domContentLoadedMs: ready.domContentLoaded === null ? null : Math.round(ready.domContentLoaded),
    });
    await context.close();
    console.log(`sample ${index + 1}/${SAMPLES}: chat ready ${chatReadyMs} ms; messages API ${samples.at(-1).messageApiMs ?? "not observed"} ms`);
  }
} finally {
  await browser.close();
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

const readyTimes = samples.map(({ chatReadyMs }) => chatReadyMs);
const apiTimes = samples.map(({ messageApiMs }) => messageApiMs).filter(Number.isFinite);
const result = {
  target: origin,
  communityId: COMMUNITY_ID,
  samples: samples.length,
  metric: "fresh-context direct navigation to visible composer and settled initial message loading",
  chatReadyMs: {
    min: Math.min(...readyTimes),
    median: percentile(readyTimes, 50),
    p95: percentile(readyTimes, 95),
    max: Math.max(...readyTimes),
  },
  messageApiMs: apiTimes.length ? {
    samples: apiTimes.length,
    median: percentile(apiTimes, 50),
    p95: percentile(apiTimes, 95),
  } : null,
  runs: samples,
};

console.log(JSON.stringify(result, null, 2));
if (OUTPUT) {
  const absoluteOutput = path.resolve(OUTPUT);
  await mkdir(path.dirname(absoluteOutput), { recursive: true });
  await writeFile(absoluteOutput, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(`Saved report: ${absoluteOutput}`);
}
