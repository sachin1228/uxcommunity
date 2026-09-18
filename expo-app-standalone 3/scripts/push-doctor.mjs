#!/usr/bin/env node
/**
 * Push setup doctor.
 *
 * Everything that has to line up for an Android chat notification to reach a
 * device, checked against the files on disk. It cannot see Google's console or
 * the Expo project's credentials, so the two things it cannot verify are
 * printed as instructions rather than silently assumed — those are the hops
 * that fail most often, and they fail invisibly.
 *
 * Run it from the app folder:  npm run doctor:push
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appRoot, "..");

let failures = 0;
let warnings = 0;

function pass(message, detail) {
  console.log(`  \x1b[32m✓\x1b[0m ${message}${detail ? `  \x1b[90m${detail}\x1b[0m` : ""}`);
}

function fail(message, detail) {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${message}${detail ? `  \x1b[90m${detail}\x1b[0m` : ""}`);
}

function warn(message, detail) {
  warnings += 1;
  console.log(`  \x1b[33m!\x1b[0m ${message}${detail ? `  \x1b[90m${detail}\x1b[0m` : ""}`);
}

function note(message) {
  console.log(`    \x1b[90m${message}\x1b[0m`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

console.log("\nuxcommunity push doctor\n");

// ---------------------------------------------------------------------------
console.log("App config");

const appJsonPath = join(appRoot, "app.json");
const appJson = readJson(appJsonPath);
const android = appJson?.expo?.android ?? {};
const packageName = android.package;

if (!appJson) {
  fail("app.json could not be read or parsed");
} else {
  pass("app.json parses");
}

if (packageName) {
  pass("Android package name", packageName);
} else {
  fail("app.json is missing expo.android.package");
}

const plugins = appJson?.expo?.plugins ?? [];
const hasNotificationsPlugin = plugins.some(
  (entry) => entry === "expo-notifications" || (Array.isArray(entry) && entry[0] === "expo-notifications"),
);
if (hasNotificationsPlugin) {
  pass("expo-notifications config plugin is registered");
} else {
  fail("expo-notifications is not in app.json plugins — prebuild will not wire the native side");
}

const projectId = appJson?.expo?.extra?.eas?.projectId;
if (projectId) {
  pass("EAS project id", projectId);
} else {
  fail("no expo.extra.eas.projectId — Expo cannot mint a push token without it");
}

// ---------------------------------------------------------------------------
console.log("\nFirebase / FCM (Android)");

if (!android.googleServicesFile) {
  fail("expo.android.googleServicesFile is not set in app.json");
} else {
  const declared = join(appRoot, android.googleServicesFile);
  if (existsSync(declared)) {
    pass("google-services.json found", android.googleServicesFile);

    const googleServices = readJson(declared);
    if (!googleServices) {
      fail("google-services.json is not valid JSON");
    } else {
      const projectNumber = googleServices.project_info?.project_id;
      if (projectNumber) {
        pass("Firebase project", projectNumber);
      } else {
        fail("google-services.json has no project_info.project_id");
      }

      const clientPackages = (googleServices.client ?? [])
        .map((client) => client.client_info?.android_client_info?.package_name)
        .filter(Boolean);

      if (clientPackages.length === 0) {
        fail(
          "google-services.json contains no Android client",
          "add an Android app to the Firebase project",
        );
      } else if (!packageName || clientPackages.includes(packageName)) {
        pass("Registered package matches app.json", clientPackages.join(", "));
      } else {
        fail(
          "package mismatch — Google will refuse to issue a token",
          `app.json has ${packageName}, google-services.json has ${clientPackages.join(", ")}`,
        );
      }

      const apiKey = (googleServices.client ?? []).find(
        (client) => client.api_key?.current_key,
      )?.api_key?.current_key;
      if (apiKey) {
        pass("Client API key present");
      } else {
        fail("google-services.json has no client api_key");
      }
    }
  } else {
    fail(
      "google-services.json is missing",
      `expected at ${android.googleServicesFile}`,
    );
    note("Firebase console → Project settings → Your apps → Android → download");
    note("The build will fail until this file exists, because app.json points at it.");
  }
}

// ---------------------------------------------------------------------------
console.log("\nGenerated Android project");

const androidDir = join(appRoot, "android");
if (existsSync(androidDir)) {
  pass("android/ exists", "local prebuild output (gitignored)");

  const copied = join(androidDir, "app", "google-services.json");
  if (existsSync(copied)) {
    pass("android/app/google-services.json is in place");
  } else {
    fail(
      "android/app/google-services.json missing",
      "run: npx expo prebuild -p android",
    );
    note("prebuild both copies the file and applies the google-services Gradle plugin.");
  }

  const appGradle = join(androidDir, "app", "build.gradle");
  const gradleApplied =
    existsSync(appGradle) && /com\.google\.gms\.google-services/.test(readFileSync(appGradle, "utf8"));
  if (gradleApplied) {
    pass("google-services Gradle plugin is applied");
  } else {
    fail("google-services Gradle plugin is NOT applied", "run: npx expo prebuild -p android");
  }

  // A previous build leaves the merged manifest behind; it is the best local
  // proof that the app was actually built with Firebase config baked in.
  const manifestCandidates = [];
  const walk = (dir, depth) => {
    if (depth > 6 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) walk(full, depth + 1);
      else if (entry === "AndroidManifest.xml" && full.includes("merged")) manifestCandidates.push(full);
    }
  };
  walk(join(androidDir, "app", "build"), 0);

  if (manifestCandidates.length === 0) {
    warn("no merged manifest found", "nothing has been built yet in android/");
  } else {
    const merged = readFileSync(manifestCandidates[0], "utf8");
    if (merged.includes("google_app_id")) {
      pass("last build has Firebase config baked in", "google_app_id present");
    } else {
      fail(
        "last build has NO Firebase config",
        "it will throw 'Default FirebaseApp is not initialized'",
      );
      note("Rebuild after google-services.json is in place.");
    }
  }
} else {
  warn("android/ does not exist", "EAS builds generate it during prebuild");
}

// ---------------------------------------------------------------------------
console.log("\nServer side");

const migrationsDir = join(repoRoot, "supabase", "migrations");
const migrations = existsSync(migrationsDir) ? readdirSync(migrationsDir) : [];

for (const [name, fragment] of [
  ["push_tokens", "push_tokens"],
  ["notification_preferences", "notification_preferences"],
]) {
  const found = migrations.find((file) => file.includes(fragment));
  if (found) {
    pass(`${name} migration exists in the repo`, found);
  } else {
    fail(`${name} migration is missing from supabase/migrations`);
  }
}

note("These must be APPLIED to the database, which this script cannot check:");
note("  npx supabase db push   (or paste the SQL into the Supabase SQL editor)");

const envPath = join(appRoot, ".env");
let apiUrl = process.env.EXPO_PUBLIC_API_URL ?? null;
if (existsSync(envPath)) {
  const match = /EXPO_PUBLIC_API_URL\s*=\s*(.+)/.exec(readFileSync(envPath, "utf8"));
  if (match) apiUrl = match[1].trim();
}
if (apiUrl) {
  pass("API base URL", apiUrl);
  note("The deployed server must include the push sender. Until it is deployed,");
  note("nothing is sent no matter how correct the app is.");
} else {
  warn("EXPO_PUBLIC_API_URL not found in .env", "check eas.json build profiles");
}

// ---------------------------------------------------------------------------
console.log("\nWhat only you can do (this script cannot see these)");

for (const step of [
  "Expo project → Credentials → Android → Push Notifications: upload the FCM v1",
  "  service-account key (Firebase → Project settings → Service accounts).",
  "  Without it Expo answers InvalidCredentials and no device ever buzzes.",
  "Deploy the updated apps/web (the sender lives in the message route).",
  "Apply the two migrations to the database.",
  "Rebuild and reinstall: npx expo run:android  (or eas build --profile development).",
  "Sign in on the phone AFTER installing the push-capable build, so the device",
  "  token gets registered.",
  "Open the bell → notifications screen and check the rows, then press both test",
  "  buttons: the local one proves the phone, the server one proves the pipeline.",
]) {
  note(step);
}

console.log(
  `\n${failures === 0 ? "\x1b[32mAll local checks passed\x1b[0m" : `\x1b[31m${failures} check(s) failed\x1b[0m`}${
    warnings > 0 ? `, \x1b[33m${warnings} warning(s)\x1b[0m` : ""
  }\n`,
);

process.exit(failures === 0 ? 0 : 1);
