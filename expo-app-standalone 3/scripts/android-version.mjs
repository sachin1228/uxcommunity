#!/usr/bin/env node
/**
 * Android version management.
 *
 * app.json is the single source of truth for both the local Gradle build and
 * EAS (eas.json uses `appVersionSource: "local"`). The generated
 * android/app/build.gradle takes versionCode/versionName from it during
 * `expo prebuild`, so no version number is edited by hand.
 *
 *   npm run version:check                 validate the current values
 *   npm run version:bump                  increment versionCode only
 *   npm run version:bump -- --version 1.1.0
 *                                         increment versionCode and set
 *                                         versionName
 *
 * versionCode must increase for every release. versionName follows semver.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APP_JSON = path.join(root, 'app.json');
const SEMVER = /^\d+\.\d+\.\d+$/;

export function checkVersion(config) {
  const version = config?.expo?.version;
  const versionCode = config?.expo?.android?.versionCode;
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    throw new Error(`expo.version must be a semantic version (got ${JSON.stringify(version)})`);
  }
  if (!Number.isInteger(versionCode) || versionCode < 1) {
    throw new Error(`expo.android.versionCode must be a positive integer (got ${JSON.stringify(versionCode)})`);
  }
  return { version, versionCode };
}

export function bumpVersion(config, { version } = {}) {
  const current = checkVersion(config);
  const nextVersion = version ?? current.version;
  if (!SEMVER.test(nextVersion)) {
    throw new Error(`--version must be a semantic version (got ${JSON.stringify(nextVersion)})`);
  }
  const nextCode = current.versionCode + 1;
  return {
    ...config,
    expo: {
      ...config.expo,
      version: nextVersion,
      android: {
        ...config.expo.android,
        versionCode: nextCode,
      },
    },
  };
}

function main() {
  const command = process.argv[2] ?? 'check';
  const config = JSON.parse(fs.readFileSync(APP_JSON, 'utf8'));

  if (command === 'check') {
    const { version, versionCode } = checkVersion(config);
    console.log(`android versionName ${version}, versionCode ${versionCode}`);
    return;
  }

  if (command === 'bump') {
    const index = process.argv.indexOf('--version');
    const version = index === -1 ? undefined : process.argv[index + 1];
    if (index !== -1 && !version) throw new Error('--version needs a value');
    const before = checkVersion(config);
    const next = bumpVersion(config, { version });
    fs.writeFileSync(APP_JSON, `${JSON.stringify(next, null, 2)}\n`);
    console.log(
      `android versionCode ${before.versionCode} -> ${next.expo.android.versionCode}; ` +
      `versionName ${before.version} -> ${next.expo.version}`,
    );
    return;
  }

  throw new Error(`Unknown command ${JSON.stringify(command)}; use check or bump`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`android-version: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
