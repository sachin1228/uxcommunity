import assert from "node:assert/strict";
import test from "node:test";
import { bumpVersion, checkVersion } from "./android-version.mjs";

const base = {
  expo: {
    version: "1.0.0",
    android: { versionCode: 7, package: "in.uxcommunity.app" },
  },
};

test("the shipped version pair is valid", () => {
  assert.deepEqual(checkVersion(base), { version: "1.0.0", versionCode: 7 });
});

test("bump increments versionCode and leaves everything else alone", () => {
  const next = bumpVersion(base);
  assert.equal(next.expo.android.versionCode, 8);
  assert.equal(next.expo.version, "1.0.0");
  assert.equal(next.expo.android.package, "in.uxcommunity.app");
});

test("bump can set a new semantic versionName", () => {
  const next = bumpVersion(base, { version: "1.1.0" });
  assert.equal(next.expo.version, "1.1.0");
  assert.equal(next.expo.android.versionCode, 8);
});

test("invalid version names and codes are rejected", () => {
  assert.throws(() => checkVersion({ expo: { version: "1.0", android: { versionCode: 1 } } }));
  assert.throws(() => checkVersion({ expo: { version: "1.0.0", android: { versionCode: 0 } } }));
  assert.throws(() => checkVersion({ expo: { version: "1.0.0", android: { versionCode: 1.5 } } }));
  assert.throws(() => bumpVersion(base, { version: "next" }));
});
