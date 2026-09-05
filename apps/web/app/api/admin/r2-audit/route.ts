import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteR2Keys, getR2PublicBase, listR2ObjectKeys, normalizeR2DeleteKeys } from "@/lib/r2";

interface TrackedReference {
  key: string;
  table: string;
  column: string;
  entityType: string;
  entityId: string | null;
  url: string | null;
}

function normalizeObjectKey(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return value.startsWith("http://") || value.startsWith("https://") ? null : value;
}

function coerceHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return value.startsWith("http://") || value.startsWith("https://") ? value : null;
}

async function collectTrackedReferences(db: ReturnType<typeof createServiceClient>): Promise<TrackedReference[]> {
  const references: TrackedReference[] = [];

  const queries = [
    { table: "designer_profiles", column: "avatar_url", entityType: "profile" },
    { table: "communities", column: "image_url", entityType: "community" },
    { table: "communities", column: "lottie_url", entityType: "community" },
    { table: "community_messages", column: "image_url", entityType: "message" },
    { table: "community_events", column: "cover_image_url", entityType: "event" },
    { table: "community_showcase_posts", column: "image_url", entityType: "showcase" },
  ];

  for (const query of queries) {
    const { data, error } = await db.from(query.table).select(`id, ${query.column}`).not(query.column, "is", null);
    if (error) {
      console.error("[r2-audit] reference query failed", { query, error });
      continue;
    }

    for (const row of data ?? []) {
      const url = coerceHttpUrl(row?.[query.column]);
      if (!url) continue;
      const key = url.includes("r2") || url.includes("cloudflarestorage") ? new URL(url).pathname.replace(/^\//, "") : null;
      if (!key) continue;
      references.push({
        key,
        table: query.table,
        column: query.column,
        entityType: query.entityType,
        entityId: typeof row?.id === "string" ? row.id : null,
        url,
      });
    }
  }

  const { data: threads, error: threadError } = await db.from("community_threads").select("id, attachments").not("attachments", "is", null);
  if (!threadError) {
    for (const row of threads ?? []) {
      const attachments = Array.isArray(row?.attachments) ? row.attachments : [];
      for (const attachment of attachments) {
        if (!attachment || typeof attachment !== "object") continue;
        const url = coerceHttpUrl((attachment as { url?: unknown }).url);
        if (!url) continue;
        const key = url.includes("r2") || url.includes("cloudflarestorage") ? new URL(url).pathname.replace(/^\//, "") : null;
        if (!key) continue;
        references.push({
          key,
          table: "community_threads",
          column: "attachments",
          entityType: "thread",
          entityId: typeof row?.id === "string" ? row.id : null,
          url,
        });
      }
    }
  }

  return references;
}

export async function GET() {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const db = createServiceClient();
  const tracked = await collectTrackedReferences(db);
  const seen = new Map<string, TrackedReference>();
  for (const item of tracked) {
    if (!seen.has(item.key)) seen.set(item.key, item);
  }

  let continuationToken: string | undefined;
  const r2Objects: Array<{ key: string; size: number }> = [];
  let totalStorageBytes = 0;

  do {
    const result = await listR2ObjectKeys(undefined, continuationToken);
    for (const key of result.keys) {
      const size = 0;
      r2Objects.push({ key, size });
    }
    if (result.isTruncated && result.nextContinuationToken) {
      continuationToken = result.nextContinuationToken;
    } else {
      continuationToken = undefined;
    }
  } while (continuationToken);

  const keySet = new Set(r2Objects.map((entry) => entry.key));
  const trackedKeys = new Set(Array.from(seen.keys()));

  const orphanKeys = [...keySet].filter((key) => !trackedKeys.has(key));
  const brokenReferences = [...seen.values()].filter((entry) => !keySet.has(entry.key));
  const validCount = [...trackedKeys].filter((key) => keySet.has(key)).length;

  const publicBase = getR2PublicBase();

  return NextResponse.json({
    totalObjects: r2Objects.length,
    trackedObjects: tracked.length,
    validTrackedObjects: validCount,
    potentialOrphans: orphanKeys.length,
    brokenReferences: brokenReferences.length,
    orphans: orphanKeys.slice(0, 200).map((key) => ({
      key,
      size: 0,
      status: "orphan",
      previewUrl: `${publicBase}/${key}`,
    })),
    brokenReferenceDetails: brokenReferences.slice(0, 200).map((entry) => ({
      key: entry.key,
      table: entry.table,
      column: entry.column,
      entityType: entry.entityType,
      entityId: entry.entityId,
      url: entry.url,
      status: "missing_r2_object",
    })),
    totalStorageBytes,
    orphanStorageBytes: 0,
    generatedAt: new Date().toISOString(),
  });
}

export async function POST(request: Request) {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  try {
    const payload = await request.json();
    if (payload?.action === "scan") {
      return GET();
    }

    if (payload?.action === "delete-orphans") {
      const keys = Array.isArray(payload?.keys) ? payload.keys : [];
      const normalized = normalizeR2DeleteKeys(keys);
      if (normalized.length === 0) {
        return NextResponse.json({ error: "No valid orphan object keys were provided for deletion." }, { status: 400 });
      }

      const result = await deleteR2Keys(normalized);
      return NextResponse.json({
        deleted: result.deleted,
        failed: result.failed,
        total: normalized.length,
        deletedCount: result.deleted.length,
        failedCount: result.failed.length,
      });
    }

    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
}
