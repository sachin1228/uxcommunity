/**
 * Uploads the pinned ffmpeg core (scripts/ffmpeg-core/) to R2 so the video
 * pipeline's FFmpeg worker loads it from a FIRST-PARTY, edge-cached origin
 * instead of a third-party CDN.
 *
 * Why R2 and not the Worker's static assets: Cloudflare caps Worker static
 * assets at 25 MiB per file; ffmpeg-core.wasm is ~31 MiB, so the deploy
 * fails (see scripts/fetch-ffmpeg-core.sh). R2 objects have no such limit.
 *
 * Run from the repo root (matches scripts/upload-city-images.mjs):
 *   node scripts/upload-ffmpeg-core.mjs
 *
 * Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 * (and optionally R2_PUBLIC_URL to print the exact base URL for
 * NEXT_PUBLIC_FFMPEG_CORE_BASE_URL).
 *
 * Objects: ffmpeg-core/ffmpeg-core.js  (application/javascript, immutable)
 *          ffmpeg-core/ffmpeg-core.wasm (application/wasm, immutable)
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const CORE_DIR = resolve("scripts/ffmpeg-core");

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME;
if (!BUCKET) {
  console.error("Missing env: R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME");
  process.exit(2);
}

const FILES = [
  { name: "ffmpeg-core.js", contentType: "application/javascript" },
  { name: "ffmpeg-core.wasm", contentType: "application/wasm" },
];

for (const file of FILES) {
  const body = readFileSync(join(CORE_DIR, file.name));
  const key = `ffmpeg-core/${file.name}`;
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: file.contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  console.log(`✓ uploaded ${key} (${(body.length / 1024 / 1024).toFixed(1)} MiB)`);
}

const publicBase = (process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, "");
if (publicBase) {
  console.log(`\nSet in the web app env:\n  NEXT_PUBLIC_FFMPEG_CORE_BASE_URL=${publicBase}/ffmpeg-core`);
}