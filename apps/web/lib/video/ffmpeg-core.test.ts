import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { test } from "node:test";

/**
 * Pins the SELF-HOSTED ffmpeg core (scripts/ffmpeg-core — the artifact
 * uploaded to R2, see scripts/fetch-ffmpeg-core.sh + upload-ffmpeg-core.mjs).
 * If the committed wasm/js diverge from these hashes, the pipeline would
 * serve a tampered or stale core — this test fails instead.
 */

// Relative to this test file (apps/web/lib/video) — independent of cwd.
const CORE_DIR = resolve(fileURLToPath(new URL("../../../../scripts/ffmpeg-core", import.meta.url)));

const PINNED = {
  "ffmpeg-core.js": "b266ab5b952555881dd6310663986994a182acb2b7ff25cf10a25f7a37ac2b21",
  "ffmpeg-core.wasm": "9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7",
} as const;

function sha256(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolvePromise(hash.digest("hex")));
    stream.on("error", reject);
  });
}

for (const [file, expected] of Object.entries(PINNED)) {
  test(`self-hosted ffmpeg core ${file} matches the pinned checksum`, async () => {
    const path = resolve(CORE_DIR, file);
    assert.ok(existsSync(path), `missing ${path} — run scripts/fetch-ffmpeg-core.sh`);
    const actual = await sha256(path);
    assert.equal(actual, expected, `${file} checksum mismatch — re-run scripts/fetch-ffmpeg-core.sh`);
  });
}