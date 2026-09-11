#!/usr/bin/env node
/**
 * One-off cleanup: delete every object under media/videos/ in R2.
 * Reads credentials from apps/web/.env. Safe to re-run (idempotent).
 */
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
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
  let scanned = 0;
  let deleted = 0;
  for (;;) {
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket, Prefix: "media/videos/", MaxKeys: 1000 })
    );
    const objs = (listed.Contents || []).map((o) => ({ Key: o.Key }));
    scanned += objs.length;
    if (objs.length) {
      const res = await s3.send(
        new DeleteObjectsCommand({ Bucket, Delete: { Objects: objs, Quiet: true } })
      );
      if (res.Errors && res.Errors.length) {
        console.error("Delete errors:", res.Errors.slice(0, 5));
        process.exit(1);
      }
      deleted += objs.length;
    }
    if (!listed.IsTruncated) break;
  }
  console.log(`scanned: ${scanned}, deleted: ${deleted}`);
  const after = await s3.send(
    new ListObjectsV2Command({ Bucket, Prefix: "media/videos/", MaxKeys: 5 })
  );
  console.log(`remaining under media/videos/: ${(after.Contents || []).length}`);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
