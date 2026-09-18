#!/usr/bin/env node
/**
 * Apply the google-services Gradle plugin to the generated android/ folder.
 *
 * `npx expo prebuild -p android` does this automatically, but prebuild rewrites
 * android/ from the template, so this script is the surgical alternative: it
 * makes exactly the three changes the `google-services.json` config plugin
 * (@expo/config-plugins/android/GoogleServices.js) makes, and nothing else.
 *
 *   1. android/build.gradle      -> classpath 'com.google.gms:google-services:4.4.1'
 *   2. android/app/build.gradle  -> apply plugin: 'com.google.gms.google-services'
 *   3. google-services.json      -> copied to android/app/google-services.json
 *
 * Idempotent: every step is skipped when it is already in place. Run it after
 * dropping a fresh google-services.json in the project root.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const classPathEntry = "classpath 'com.google.gms:google-services:4.4.1'";
const pluginRef = 'com.google.gms.google-services';
const log = (s) => console.log(s);

let failed = false;

// 1. root build.gradle: add the classpath to buildscript { dependencies { ... } }
{
  const file = path.join(root, 'android/build.gradle');
  if (!fs.existsSync(file)) {
    log('! android/build.gradle not found — run `npx expo prebuild -p android` first');
    failed = true;
  } else {
    const gradle = fs.readFileSync(file, 'utf8');
    if (gradle.includes('com.google.gms:google-services')) {
      log('= android/build.gradle already declares the classpath');
    } else {
      fs.writeFileSync(file, gradle.replace(/dependencies\s?\{/, `dependencies {\n    ${classPathEntry}`));
      log('+ android/build.gradle: declared ' + classPathEntry);
    }
  }
}

// 2. app build.gradle: apply the plugin (appended at end of file, same as the plugin)
{
  const file = path.join(root, 'android/app/build.gradle');
  if (!fs.existsSync(file)) {
    log('! android/app/build.gradle not found — run `npx expo prebuild -p android` first');
    failed = true;
  } else {
    const gradle = fs.readFileSync(file, 'utf8');
    if (new RegExp(`apply\\s+plugin:\\s+['"]${pluginRef}['"]`).test(gradle)) {
      log('= android/app/build.gradle already applies the plugin');
    } else {
      fs.writeFileSync(file, `${gradle}\napply plugin: '${pluginRef}'\n`);
      log(`+ android/app/build.gradle: applied ${pluginRef}`);
    }
  }
}

// 3. copy the client config next to the app module
{
  const src = path.join(root, 'google-services.json');
  const dest = path.join(root, 'android/app/google-services.json');
  if (!fs.existsSync(src)) {
    log('! google-services.json missing at the project root');
    log('  Download it from Firebase → Project settings → Your apps → Android (package in.uxcommunity.app)');
    failed = true;
  } else {
    const src_ = JSON.parse(fs.readFileSync(src, 'utf8'));
    const pkg = src_.client?.[0]?.client_info?.android_client_info?.package_name;
    const projectId = src_.project_info?.project_id;
    if (fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') === fs.readFileSync(src, 'utf8')) {
      log('= android/app/google-services.json already up to date');
    } else {
      fs.copyFileSync(src, dest);
      log('+ android/app/google-services.json copied');
    }
    log(`  firebase project: ${projectId ?? '???'}   android package: ${pkg ?? '???'}`);
    if (pkg !== 'in.uxcommunity.app') {
      log('  ! package name does not match app.json — Firebase will refuse to issue a token');
      failed = true;
    }
  }
}

// Informational: release signing still uses the debug keystore unless you changed it.
{
  const file = path.join(root, 'android/app/build.gradle');
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('signingConfig signingConfigs.debug')) {
    log('i  release builds are signed with the debug keystore (fine for push: it is the package name that matters)');
  }
}

if (failed) {
  log('\nSomething is still missing — see the ! lines above.');
  process.exitCode = 1;
} else {
  log('\nLocal Android side is ready. Rebuild, install, then sign in so the device token registers.');
}
