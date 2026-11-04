import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  // Registry-backed on purpose: a signature-only check would bounce a revoked
  // token between /login and /dashboard forever (see middleware.ts).
  const session = await getSession();
  if (session) {
    redirect(session.role === "admin" ? "/admin" : "/dashboard");
  }

  return <LoginForm />;
}
