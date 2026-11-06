import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const appJson = JSON.parse(readFileSync(resolve(root, "app.json"), "utf8")) as {
  expo: {
    version: string;
    android?: {
      versionCode?: number;
      allowBackup?: boolean;
      blockedPermissions?: string[];
    };
    plugins?: unknown[];
  };
};
const easJson = JSON.parse(readFileSync(resolve(root, "eas.json"), "utf8")) as {
  cli: { appVersionSource?: string };
  build: { production: { autoIncrement?: boolean } };
};
const signingPlugin = readFileSync(
  resolve(root, "plugins/withAndroidReleaseSigning.js"),
  "utf8",
);
const permissionPlugin = readFileSync(
  resolve(root, "plugins/withAndroidPermissionScopes.js"),
  "utf8",
);
const backupPlugin = readFileSync(
  resolve(root, "plugins/withAndroidBackupPolicy.js"),
  "utf8",
);

function pluginNames(): string[] {
  return (appJson.expo.plugins ?? []).map((plugin) =>
    Array.isArray(plugin) ? String(plugin[0]) : String(plugin),
  );
}

function pluginOptions(name: string): Record<string, unknown> | undefined {
  const entry = (appJson.expo.plugins ?? []).find(
    (plugin) => Array.isArray(plugin) && plugin[0] === name,
  );
  return Array.isArray(entry) ? (entry[1] as Record<string, unknown>) : undefined;
}

test("app.json carries an explicit Android version pair", () => {
  assert.match(appJson.expo.version, /^\d+\.\d+\.\d+$/);
  assert.ok(Number.isInteger(appJson.expo.android?.versionCode));
  assert.ok((appJson.expo.android?.versionCode ?? 0) >= 1);
});

test("versioning has a single local source for Gradle and EAS", () => {
  assert.equal(easJson.cli.appVersionSource, "local");
  assert.notEqual(easJson.build.production.autoIncrement, true);
  assert.match(appJson.expo.version, /^\d+\.\d+\.\d+$/);
  assert.ok(Number.isInteger(appJson.expo.android?.versionCode));
});

test("release signing is fail-closed and debug stays on the debug key", () => {
  assert.match(signingPlugin, /UXCOMMUNITY_ANDROID_STORE_FILE/);
  assert.match(signingPlugin, /UXCOMMUNITY_ANDROID_STORE_PASSWORD/);
  assert.match(signingPlugin, /UXCOMMUNITY_ANDROID_KEY_ALIAS/);
  assert.match(signingPlugin, /UXCOMMUNITY_ANDROID_KEY_PASSWORD/);
  assert.match(signingPlugin, /keystore\.properties/);
  assert.match(signingPlugin, /GradleException/);
  assert.match(signingPlugin, /debug keystore/);
  assert.match(signingPlugin, /task\.name\.contains\("Release"\)/);
  // EAS injects its own credential configuration after Prebuild.
  assert.match(signingPlugin, /EAS_BUILD/);
});

test("permissions the product does not use are blocked", () => {
  const blocked = new Set(appJson.expo.android?.blockedPermissions ?? []);
  for (const permission of [
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.READ_MEDIA_AUDIO",
    "android.permission.SYSTEM_ALERT_WINDOW",
    "android.permission.USE_BIOMETRIC",
    "android.permission.USE_FINGERPRINT",
  ]) {
    assert.ok(blocked.has(permission), `${permission} must be blocked`);
  }
  assert.equal(pluginOptions("expo-image-picker")?.cameraPermission, false);
  assert.equal(pluginOptions("expo-image-picker")?.microphonePermission, false);
  assert.deepEqual(pluginOptions("expo-media-library")?.granularPermissions, ["photo", "video"]);
});

test("legacy storage is capped at the Android release that needs it", () => {
  assert.ok(pluginNames().includes("./plugins/withAndroidPermissionScopes"));
  assert.match(permissionPlugin, /WRITE_EXTERNAL_STORAGE/);
  assert.match(permissionPlugin, /maxSdkVersion/);
  assert.match(permissionPlugin, /"28"/);
});

test("backup exclusions cover device-protected storage on both paths", () => {
  assert.equal(appJson.expo.android?.allowBackup, false);
  assert.match(backupPlugin, /android:allowBackup/);
  assert.match(backupPlugin, /device_root/);
  assert.match(backupPlugin, /device_file/);
  assert.match(backupPlugin, /device_database/);
  assert.match(backupPlugin, /device_sharedpref/);
  assert.equal((backupPlugin.match(/domain="device_sharedpref"/g) ?? []).length, 3);
});
