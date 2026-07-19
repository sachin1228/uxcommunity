import { NextResponse } from "next/server";
import { getSession, clearSessionCookie } from "@/lib/auth/session";

export async function POST() {
  // M-6: Only clear the cookie when a valid session actually exists.
  // Prevents a CSRF-forced logout from silently succeeding with no session.
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ success: true });
  }

  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  return response;
}
