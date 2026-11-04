import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Exercise the real bootstrap/cache and API wrapper. Only the native credential
// boundary is replaced: Node cannot parse React Native's Flow entry point.
const temporary = await mkdtemp(join(tmpdir(), 'mobile-bootstrap-'));
try {
  const output = join(temporary, 'bootstrap.test.mjs');
  await build({
    entryPoints: ['expo-app-standalone 3/lib/communityBootstrap.test.ts'],
    outfile: output, bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'native-session-boundary', setup(builder) {
      builder.onResolve({ filter: /^\.\/sessionStorage$/ }, () => ({ path: 'session-storage', namespace: 'native-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'native-test' }, () => ({ contents: `
        export const readStoredSessionToken = async () => null;
        export const writeStoredSessionToken = async () => {};
        export const clearStoredSessionToken = async () => {};` }));
    } }],
  });
  const result = spawnSync(process.execPath, ['--test', output], {
    stdio: 'inherit', env: { ...process.env, EXPO_PUBLIC_APP_ENV: 'development',
      EXPO_PUBLIC_API_URL: 'http://localhost:3000', EXPO_PUBLIC_REALTIME_URL: 'ws://localhost:8787' },
  });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
