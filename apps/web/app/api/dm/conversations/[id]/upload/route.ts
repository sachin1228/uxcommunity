import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadDmConversationForUser } from "@/lib/direct-messages/server";
import { detectImageMime, extensionForMime } from "@/lib/image-utils";
import { deleteR2AssetIfUnreferenced } from "@/lib/r2";
import { deletePrivateDmKeys } from "@/lib/private-storage-cleanup";
import {
  isPrivateStorageConfigured,
  dmAssetPath,
  dmKeyFromImageUrl,
  isSafeFileSegment,
  legacyPrivateKeyFromUrl,
  privateDmKey,
  uploadPrivateToR2,
} from "@/lib/r2-private";
import { createServerTimer } from "@/lib/server-timing";

const MAX_INPUT_BYTES = 20 * 1024 * 1024; // 20 MB raw upload limit

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/**
 * POST /api/dm/conversations/[id]/upload
 *
 * Stores a DM image in the PRIVATE bucket, namespaced `dm/<conversationId>/…`.
 * The response's `url` is the stable, authorization-gated
 * `/api/private/dm/<conversation>/<file>` path — never a public object URL —
 * and `key` lets a caller release the upload without re-parsing the path.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const timer = createServerTimer("POST /api/dm/conversations/[id]/upload");
  const finish = (response: Response) => {
    timer.finish({ status: response.status });
    return response;
  };

  let session;
  try {
    session = await timer.measure("auth", () => requireSession("user"));
  } catch (e) {
    return finish(e as Response);
  }
  if (!isPrivateStorageConfigured()) {
    return finish(NextResponse.json({ error: "Message images are not available right now." }, { status: 503 }));
  }
  const userId = session.userId!;
  const { id: conversationId } = await params;
  const db = createServiceClient();

  const access = await timer.measure("conversation_query", () =>
    loadDmConversationForUser(db, conversationId, userId),
  );
  if (!access.ok) {
    return finish(NextResponse.json({ error: access.error }, { status: access.status }));
  }

  let formData: FormData;
  try {
    formData = await timer.measure("form_parse", () => request.formData());
  } catch {
    return finish(NextResponse.json({ error: "Invalid form data." }, { status: 400 }));
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return finish(NextResponse.json({ error: "No file provided." }, { status: 400 }));
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return finish(NextResponse.json({ error: "Only JPEG, PNG and WebP images are allowed." }, { status: 422 }));
  }
  if (file.size > MAX_INPUT_BYTES) {
    return finish(NextResponse.json({ error: "Image must be under 20 MB." }, { status: 422 }));
  }
  timer.record("input_bytes", file.size);

  let source: Buffer;
  try {
    source = await timer.measure("file_decode", async () => Buffer.from(await file.arrayBuffer()));
  } catch {
    return finish(NextResponse.json({ error: "Failed to read image." }, { status: 422 }));
  }

  const storedMime = detectImageMime(source);
  if (!storedMime) {
    return finish(NextResponse.json({ error: "That file is not a valid JPEG, PNG or WebP image." }, { status: 422 }));
  }
  timer.record("output_bytes", source.byteLength);

  const key = privateDmKey(conversationId, extensionForMime(storedMime));

  try {
    await timer.measure("r2_upload", () => uploadPrivateToR2(key, source, storedMime));
    const url = dmAssetPath(conversationId, key.split("/").pop()!);
    return finish(
      NextResponse.json(
        { key, url },
        {
          status: 200,
          headers: {
            "Cache-Control": "no-store",
            "X-Image-Url": url,
          },
        },
      ),
    );
  } catch (err) {
    console.error("[dm-image-upload] private R2 error:", err);
    return finish(NextResponse.json({ error: "Upload failed." }, { status: 500 }));
  }
}

/**
 * DELETE /api/dm/conversations/[id]/upload  { key? , url? }
 *
 * Remove an upload whose send was abandoned. Only assets under THIS
 * conversation's private prefix qualify. A racing successful send keeps its
 * image: the object is retained while any dm_messages row references the key
 * (or a report snapshot keeps the path).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }
  const userId = session.userId!;
  const { id: conversationId } = await params;

  const db = createServiceClient();
  const access = await loadDmConversationForUser(db, conversationId, userId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let key = "";
  let url = "";
  try {
    const body = (await request.json()) as { key?: unknown; url?: unknown };
    key = typeof body.key === "string" ? body.key.trim() : "";
    url = typeof body.url === "string" ? body.url.trim() : "";
  } catch {
    // Fall through to the 400 below.
  }

  // A legacy public URL still points at the old bucket. It is reclaimed with
  // the bucket-wide reference check; private keys go through the private
  // cleanup (which also respects report evidence).
  if (!key && url) {
    const legacyKey = legacyPrivateKeyFromUrl(url);
    if (legacyKey && legacyKey.startsWith(`dm/${conversationId}/`)) {
      const result = await deleteR2AssetIfUnreferenced(db, url, [
        { table: "dm_messages", column: "image_url" },
      ]);
      return NextResponse.json({ ok: true, status: result.status });
    }
    key = dmKeyFromImageUrl(url) ?? "";
  }

  const file = key.startsWith(`dm/${conversationId}/`)
    ? key.slice(`dm/${conversationId}/`.length)
    : "";
  if (!key || !file || !isSafeFileSegment(file) || file.includes("/")) {
    return NextResponse.json(
      { error: "Not an upload of this conversation." },
      { status: 422 },
    );
  }

  if (!isPrivateStorageConfigured()) {
    return NextResponse.json({ error: "Message images are not available right now." }, { status: 503 });
  }

  const result = await deletePrivateDmKeys(db, [key]);
  return NextResponse.json({ ok: true, status: result.deleted.length ? "deleted" : "kept" });
}
