import { NextRequest, NextResponse } from "next/server";
import { getSession, clearSessionCookie } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimit } from "@/lib/auth/rate-limit";
import { getRequestClientIp } from "@/lib/global-request-rate-limit";

export async function GET(request: NextRequest) {
  // L-7: Rate-limit /me to prevent aggressive polling from hammering the DB
  const ip = getRequestClientIp(request);
  const rl = await rateLimit(`me:ip:${ip}`, 60, 60); // 60 per minute per IP
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  if (session.role === "admin") {
    return NextResponse.json({ user: { role: "admin", email: session.email } });
  }

  const db = createServiceClient();
  const { data: user } = await db
    .from("users")
    .select(
      "id, name, email, verification_status, verification_reapply_at, verification_rejection_reason, email_verified_at",
    )
    .eq("id", session.userId!)
    .maybeSingle();

  if (!user) {
    // M-5: User row was deleted — clear the stale cookie so the client
    // doesn't stay stuck in a logged-in-but-no-user state.
    const response = NextResponse.json({ user: null });
    clearSessionCookie(response, request.nextUrl.hostname);
    return response;
  }

  const { data: profile } = await db
    .from("designer_profiles")
    .select("id, avatar_url")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    user: {
      ...user,
      role: "user",
      profileComplete: !!profile,
      avatar_url: (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null,
      verificationStatus: (user as { verification_status?: string }).verification_status ?? "unverified",
      verificationReapplyAt:
        (user as { verification_reapply_at?: string | null }).verification_reapply_at ?? null,
      verificationRejectionReason:
        (user as { verification_rejection_reason?: string | null }).verification_rejection_reason ?? null,
      emailVerifiedAt: (user as { email_verified_at?: string | null }).email_verified_at ?? null,
    },
  });
}
