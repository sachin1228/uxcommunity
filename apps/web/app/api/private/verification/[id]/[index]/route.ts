import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { canViewVerificationSample } from "@/lib/private-access";
import {
  isPrivateObjectKey,
  isPrivateStorageConfigured,
  legacyPrivateKeyFromUrl,
  signPrivateGet,
} from "@/lib/r2-private";
import {
  verificationSampleKey,
  verificationSampleLegacyUrl,
} from "@/lib/verification/samples";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_TTL_SECONDS = 5 * 60;

function notFound(): NextResponse {
  return NextResponse.json(
    { error: "Not found." },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * GET /api/private/verification/[id]/[index]
 *
 * The only way a verification work sample is displayed. The owner or an
 * explicit admin session may request it; everyone else gets 404. Key-backed
 * samples redirect to a 5-minute signed GET (so a page reload after expiry
 * gets a fresh signature). Legacy rows are streamed through the server instead
 * of returning their public URL to the API client.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; index: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { id, index: rawIndex } = await params;
  if (!UUID_RE.test(id) || !/^\d+$/.test(rawIndex)) return notFound();
  const index = Number(rawIndex);
  if (!Number.isSafeInteger(index) || index > 2) return notFound();

  const db = createServiceClient();
  const { data } = (await (db as unknown as SupabaseClient)
    .from("account_verification_requests")
    .select("id, user_id, work_sample_keys, work_sample_urls")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      user_id: string;
      work_sample_keys: string[] | null;
      work_sample_urls: string[] | null;
    } | null;
  };

  if (!data) return notFound();
  const allowed = canViewVerificationSample({
    viewerId: session.userId ?? "",
    ownerId: data.user_id,
    isAdmin: session.role === "admin",
  });
  if (!allowed) return notFound();

  const key = verificationSampleKey(data, index);
  if (key) {
    if (!isPrivateStorageConfigured()) {
      return NextResponse.json(
        { error: "Private storage is not configured." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!isPrivateObjectKey(key)) return notFound();
    try {
      const signed = await signPrivateGet(key, { expiresInSeconds: SIGNED_TTL_SECONDS });
      return new NextResponse(null, {
        status: 302,
        headers: {
          Location: signed,
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      console.error("[private/verification] signing failed:", error);
      return NextResponse.json(
        { error: "Sample unavailable." },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const legacyUrl = verificationSampleLegacyUrl(data, index);
  if (!legacyUrl) return notFound();
  const legacyKey = legacyPrivateKeyFromUrl(legacyUrl);
  if (!legacyKey || !legacyKey.startsWith("verification/")) return notFound();

  try {
    const upstream = await fetch(legacyUrl, { cache: "no-store", redirect: "follow" });
    if (!upstream.ok || !upstream.body) return notFound();
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[private/verification] legacy fetch failed:", error);
    return notFound();
  }
}
