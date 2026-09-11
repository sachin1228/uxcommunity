#!/usr/bin/env node
/**
 * One-off: verify the direct-to-R2 presigned PUT path works end to end.
 * (CORS itself must be set in the Cloudflare dashboard — the R2 API token
 * used by the app has no policy-management permission.)
 * Reads credentials from apps/web/.env. Safe to re-run.
 */
const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", "apps", "web", ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  console.error("Missing R2 credentials in apps/web/.env");
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});
const Bucket = R2_BUCKET_NAME;

(async () => {
  // Clean the probe object a previous interrupted run may have left.
  const prior = await s3.send(
    new ListObjectsV2Command({ Bucket, Prefix: "probe-cors-test", MaxKeys: 5 }),
  );
  for (const obj of prior.Contents ?? []) {
    await s3.send(new DeleteObjectCommand({ Bucket, Key: obj.Key }));
    console.log("removed leftover probe object:", obj.Key);
  }

  // Presign → PUT via fetch (browser-equivalent) → HEAD-verify → delete.
  const key = `media/videos/processed/_presign-probe-${Date.now()}.mp4`;
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket, Key: key, ContentType: "video/mp4" }),
    { expiresIn: 120 },
  );
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: Buffer.from("probe"),
  });
  console.log("presigned PUT status:", res.status, res.ok ? "✓" : "✗");
  if (!res.ok) {
    console.error("body:", await res.text());
    process.exit(1);
  }
  const head = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
  console.log("HEAD after PUT — size:", head.ContentLength, "type:", head.ContentType);
  await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
  console.log("probe object deleted. DIRECT UPLOAD PATH: OK");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
