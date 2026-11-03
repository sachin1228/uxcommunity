import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { observeCommunityChatReady } from './lib/chat-readiness.mjs';

test('readiness requires the correct visible timeline and enabled composer, without an API request', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div role="log" data-community-id="other" data-chat-ready="true">Message</div><textarea data-chat-input disabled></textarea>');
    await page.evaluate(observeCommunityChatReady, 'room');
    const count = () => page.evaluate(() => performance.getEntriesByName('community-chat-ready').length);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await count(), 0, 'a different room cannot satisfy readiness');
    await page.locator('[role=log]').evaluate(el => { el.dataset.communityId = 'room'; el.style.visibility = 'hidden'; });
    await page.locator('textarea').evaluate(el => { el.disabled = false; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await count(), 0, 'a positioned but hidden timeline cannot count');
    await page.locator('[role=log]').evaluate(el => { el.style.visibility = 'visible'; });
    await page.waitForFunction(() => performance.getEntriesByName('community-chat-ready').length === 1);
    assert.equal(await count(), 1);
  } finally { await browser.close(); }
});
