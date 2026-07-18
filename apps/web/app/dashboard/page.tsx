import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { APP_NAME } from "@draft/shared";

export const metadata = { title: "Dashboard — Drafthub" };

async function getUser(userId: string) {
  const db = createServiceClient();
  const { data } = await db
    .from("users")
    .select("name, email")
    .eq("id", userId)
    .maybeSingle();
  return data;
}

export default async function DashboardPage() {
  const session = await getSession();
  const user = session?.userId ? await getUser(session.userId) : null;

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-foreground mb-1">
        Welcome back{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
      </h1>
      <p className="font-body text-sm text-foreground-muted">
        You're in. More coming soon.
      </p>
    </div>
  );
}
