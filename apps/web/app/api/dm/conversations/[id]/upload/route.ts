import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadDmConversationForUser } from "@/lib/direct-messages/server";
import { detectImageMime, extensionForMime } from "@/lib/image-utils";
import { deleteR2AssetIfUnreferenced, parseR2Key, uploadToR2 } from "@/lib/r2";
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
 * Stores a DM image, namespaced `dm/${conversationId}/…` so a conversation's
 * assets can be swept as a unit. Mirrors the community chat upload (same
 * limits, MIME sniffing, R2 write) — the only difference is the participant
 * check and the key prefix.
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

  // The client compresses the image to WebP before upload; sniffing the file
  // signature is the only remaining server-side step before the R2 write.
  const storedMime = detectImageMime(source);
  if (!storedMime) {
    return finish(NextResponse.json({ error: "That file is not a valid JPEG, PNG or WebP image." }, { status: 422 }));
  }
  timer.record("output_bytes", source.byteLength);

  const key = `dm/${conversationId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extensionForMime(storedMime)}`;

  try {
    const url = await timer.measure("r2_upload", () =>
      uploadToR2(key, source, storedMime),
    );

    if (typeof url !== "string" || !url.trim()) {
      throw new Error("R2 upload completed without a public URL.");
    }

    const imageUrl = url.trim();
    return finish(NextResponse.json(
      { url: imageUrl },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "X-Image-Url": imageUrl,
        },
      },
    ));
  } catch (err) {
    console.error("[dm-image-upload] R2 error:", err);
    return finish(NextResponse.json({ error: "Upload failed." }, { status: 500 }));
  }
}

/**
 * DELETE /api/dm/conversations/[id]/upload  { url }
 *
 * Remove an upload whose send was abandoned (cancelled before the message
 * row could exist). Only assets under THIS conversation's prefix qualify —
 * the URL is client input, so the same DM-asset rule as a send applies. The
 * delete is skipped while any dm_messages row still references the URL, so a
 * racing successful send can never lose its image; a repeat call for an
 * already-gone object is a harmless no-op.
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

  let url = "";
  try {
    const body = (await request.json()) as { url?: unknown };
    url = typeof body.url === "string" ? body.url.trim() : "";
  } catch {
    // Fall through to the 400 below.
  }

  const key = url ? parseR2Key(url) : null;
  if (!url || !key || !key.startsWith(`dm/${conversationId}/`)) {
    return NextResponse.json(
      { error: "Not an upload of this conversation." },
      { status: 422 },
    );
  }

  const result = await deleteR2AssetIfUnreferenced(db, url, [
    { table: "dm_messages", column: "image_url" },
  ]);
  return NextResponse.json({ ok: true, status: result.status });
}
