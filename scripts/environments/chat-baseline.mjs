import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Add only the DOM annotations used by the current readiness observer. */
export function instrumentChatTimeline(source) {
  const anchor = '      className="min-h-full flex flex-col justify-end py-4 space-y-1"\n';
  assert.equal(source.split(anchor).length, 2, 'Baseline timeline must match exactly once');
  return source.replace(anchor, anchor + [
    '      role="log"',
    '      aria-label="Community messages"',
    '      aria-live="off"',
    '      data-community-id={communityId}',
    '      data-chat-ready={initialPositionResolved && (mergedGroups.length > 0 || (threadsReady && contentEventsReady))}',
    '',
  ].join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.env.CI, 'true', 'Comparison preparation is CI-only');
  const ref = process.env.BENCHMARK_BASELINE_REF ?? '';
  assert.match(ref, /^[a-f0-9]{40}$/, 'An exact baseline commit SHA is required');
  const manifestPath = '.local/staging/environment.json';
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.APP_ENV, 'staging');
  const run = (args) => {
    const result = spawnSync('git', args, { stdio: 'inherit' });
    assert.equal(result.status, 0, 'Baseline Git operation failed');
  };
  run(['merge-base', '--is-ancestor', ref, 'HEAD']);
  const baseline = '.local/staging/chat-baseline';
  run(['worktree', 'add', '--detach', baseline, ref]);
  await mkdir(`${baseline}/.local/staging`, { recursive: true, mode: 0o700 });
  await copyFile(manifestPath, `${baseline}/${manifestPath}`);
  await chmod(`${baseline}/${manifestPath}`, 0o600);
  const timeline = `${baseline}/apps/web/components/communities/chat/MessageList.tsx`;
  await writeFile(timeline, instrumentChatTimeline(await readFile(timeline, 'utf8')));
  console.log(`Prepared baseline ${ref}; only readiness DOM annotations were added`);
}
