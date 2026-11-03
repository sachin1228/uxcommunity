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
import { observeCommunityChatReady } from "./lib/chat-readiness.mjs";

const APP_URL = (process.env.E2E_APP_URL ?? "").replace(/\/+$/, "");
const COMMUNITY_ID = process.env.E2E_COMMUNITY_ID ?? "";
const SESSION_COOKIE = process.env.E2E_SESSION_COOKIE ?? "";
const EMAIL = process.env.E2E_EMAIL ?? "";
const PASSWORD = process.env.E2E_PASSWORD ?? "";
const SAMPLES = Math.max(1, Math.min(50, Number(process.env.E2E_SAMPLES ?? 10)));
const OUTPUT = process.env.E2E_CHAT_TIMING_OUT ?? "";
const API_BASE = `/api/communities/${COMMUNITY_ID}`;

assert(APP_URL, "E2E_APP_URL must point to the staging web app");
assert(COMMUNITY_ID, "E2E_COMMUNITY_ID must be a community the test member belongs to");
assert(SESSION_COOKIE || (EMAIL && PASSWORD), "Set E2E_SESSION_COOKIE or both E2E_EMAIL and E2E_PASSWORD");
assert.equal(new URL(APP_URL).protocol, "https:", "Refusing to benchmark a non-HTTPS target");
assert.match(new URL(APP_URL).hostname, /staging/i, "Refusing to benchmark a host without 'staging' in its name");

const browser = await chromium.launch({ headless: true });
const browserVersion = browser.version();
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
    const loginResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === origin && url.pathname === "/api/auth/login" && response.request().method() === "POST";
    }, { timeout: 30_000 });
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    const loginResponse = await loginResponsePromise;
    if (!loginResponse.ok()) {
      const body = await loginResponse.json().catch(() => ({}));
      throw new Error(`Staging fixture login failed (${loginResponse.status()}): ${body.error ?? "unknown login error"}`);
    }
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  }

  const state = await context.storageState();
  await context.close();
  return state;
}

const samples = [];

try {
  const state = await getStorageState();
  for (let index = 0; index < SAMPLES; index += 1) {
    const context = await browser.newContext({ storageState: state });
    const page = await context.newPage();
    await page.addInitScript(observeCommunityChatReady, COMMUNITY_ID);
    const requests = [];
    const recordings = [];
    page.on("requestfinished", (request) => {
      const url = new URL(request.url());
      if (url.origin !== origin || ![`${API_BASE}/bootstrap`, `${API_BASE}/messages`].includes(url.pathname)) return;
      const timing = request.timing();
      recordings.push((async () => {
        const response = await request.response();
        const headers = await response.allHeaders();
        requests.push({
          endpoint: url.pathname,
          section: url.searchParams.get("section"),
          catchUp: url.searchParams.has("after"),
          status: response.status(),
          startedAt: timing.startTime,
          durationMs: Math.round(timing.responseEnd),
          serverTiming: headers["server-timing"] ?? null,
        });
      })().catch(() => {}));
    });

    const navigation = await page.goto(`${APP_URL}/dashboard/communities/${COMMUNITY_ID}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    assert(navigation, `Sample ${index + 1}: navigation did not return a response`);
    assert.equal(navigation.status(), 200, `Sample ${index + 1}: chat page returned HTTP ${navigation.status()}`);

    await page.waitForFunction(() => performance.getEntriesByName("community-chat-ready").length > 0,
      undefined, { timeout: 60_000 });
    const ready = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      return {
        timeOrigin: performance.timeOrigin,
        chatReadyMs: performance.getEntriesByName("community-chat-ready")[0].startTime,
        navigationTtfbMs: navigation.responseStart,
        domContentLoadedMs: navigation.domContentLoadedEventEnd,
      };
    });
    // Only inspect requests already finished when chat painted; background
    // catch-up or secondary cards never extend the visible-readiness metric.
    await Promise.all(recordings.slice());
    const chatReadyMs = Math.round(ready.chatReadyMs);
    samples.push({
      sample: index + 1,
      chatReadyMs,
      navigationTtfbMs: Math.round(ready.navigationTtfbMs),
      domContentLoadedMs: Math.round(ready.domContentLoadedMs),
      requests: requests.map(({ startedAt, ...request }) => ({
        ...request, startedAfterNavigationMs: Math.round(startedAt - ready.timeOrigin),
      })),
    });
    await context.close();
    console.log(`sample ${index + 1}/${SAMPLES}: visible chat ready ${chatReadyMs} ms`);
  }
} finally {
  await browser.close();
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

const readyTimes = samples.map(({ chatReadyMs }) => chatReadyMs);

const result = {
  metricVersion: 2,
  targetRevision: process.env.E2E_TARGET_SHA ?? null,
  browserVersion,
  target: origin,
  communityId: COMMUNITY_ID,
  samples: samples.length,
  metric: "fresh-context navigation to painted, positioned message timeline (or confirmed empty state) and enabled composer",
  chatReadyMs: {
    min: Math.min(...readyTimes),
    median: percentile(readyTimes, 50),
    p95: percentile(readyTimes, 95),
    max: Math.max(...readyTimes),
  },
  runs: samples,
};

console.log(JSON.stringify(result, null, 2));
if (OUTPUT) {
  const absoluteOutput = path.resolve(OUTPUT);
  await mkdir(path.dirname(absoluteOutput), { recursive: true });
  await writeFile(absoluteOutput, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(`Saved report: ${absoluteOutput}`);
}
