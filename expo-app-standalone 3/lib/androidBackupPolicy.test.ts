import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const appConfig = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8')) as {
  expo: {
    android?: { allowBackup?: boolean };
    plugins?: unknown[];
  };
};
const pluginSource = readFileSync(
  resolve(root, 'plugins/withAndroidBackupPolicy.js'),
  'utf8',
);

test('Android backup is disabled in the Expo source of truth', () => {
  assert.equal(appConfig.expo.android?.allowBackup, false);
  assert.ok(
    appConfig.expo.plugins?.some(
      (plugin) => plugin === './plugins/withAndroidBackupPolicy',
    ),
    'the backup policy must run on every prebuild',
  );
});

test('the prebuild plugin enforces both legacy and Android 12+ rules', () => {
  assert.match(pluginSource, /android:allowBackup.*false/);
  assert.match(pluginSource, /android:fullBackupContent/);
  assert.match(pluginSource, /android:dataExtractionRules/);
  assert.match(pluginSource, /backup_rules\.xml/);
  assert.match(pluginSource, /data_extraction_rules\.xml/);
  // Every app-data domain is excluded rather than only selected caches.
  assert.equal((pluginSource.match(/domain="sharedpref"/g) ?? []).length >= 3, true);
});
