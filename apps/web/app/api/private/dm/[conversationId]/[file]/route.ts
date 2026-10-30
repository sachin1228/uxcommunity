import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { canViewDmAsset } from "@/lib/private-access";
import {
  dmKeyToAssetPath,
  dmPathToKey,
  isPrivateStorageConfigured,
  signPrivateGet,
} from "@/lib/r2-private";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_FOUND = () =>
  NextResponse.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * GET /api/private/dm/[conversationId]/[file]
 *
 * The stable image URL a DM bubble renders. Membership is re-checked on every
 * load, so a copied path is worthless outside the two participants. Admins are
 * allowed because the report queue renders the same evidence paths. The route
 * redirects to a 5-minute presigned GET; the object is stored with
 * `Cache-Control: private, no-store`.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ conversationId: string; file: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { conversationId, file } = await params;
  if (!UUID_RE.test(conversationId)) return NOT_FOUND();

  const key = dmPathToKey(conversationId, file);
  if (!key || !dmKeyToAssetPath(key)) return NOT_FOUND();

  const isAdmin = session.role === "admin";
  if (!isAdmin) {
    const db = createServiceClient();
    const { data: conversation } = await db
      .from("dm_conversations")
      .select("user_a, user_b")
      .eq("id", conversationId)
      .maybeSingle();

    if (!conversation) return NOT_FOUND();

    const allowed = canViewDmAsset({
      viewerId: session.userId ?? "",
      participants: [conversation.user_a, conversation.user_b],
    });
    if (!allowed) return NOT_FOUND();
  }

  if (!isPrivateStorageConfigured()) {
    return NextResponse.json(
      { error: "Private storage is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const signed = await signPrivateGet(key, { expiresInSeconds: 300 });
    return new NextResponse(null, {
      status: 302,
      headers: {
        Location: signed,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    console.error("[private/dm] signing failed:", error);
    return NextResponse.json({ error: "Image unavailable." }, { status: 500 });
  }
}
