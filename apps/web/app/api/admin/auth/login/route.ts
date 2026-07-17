import { NextRequest, NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const rl = rateLimit(`admin-login:${ip}`, 5, 900);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait and try again." },
      { status: 429 }
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    return NextResponse.json(
      { error: "Admin credentials not configured." },
      { status: 500 }
    );
  }

  if (
    body.email?.toLowerCase() !== adminEmail.toLowerCase() ||
    body.password !== adminPassword
  ) {
    return NextResponse.json(
      { error: "Invalid credentials." },
      { status: 401 }
    );
  }

  const token = await createSession({ email: adminEmail, role: "admin" });
  const response = NextResponse.json({ success: true });
  setSessionCookie(response, token);
  return response;
}
