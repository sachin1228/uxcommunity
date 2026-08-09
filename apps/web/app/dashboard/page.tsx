import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { DashboardHome } from "./DashboardHome";

export const metadata = { title: "Home — uxcommunity" };

export default async function DashboardPage() {
  const session = await getSession();
  const userId = session?.userId ?? "";

  const { name, avatarUrl } = await (async () => {
    if (!session?.userId) return { name: null, avatarUrl: null };
    const db = createServiceClient();
    const [{ data: user }, { data: profile }] = await Promise.all([
      db.from("users").select("name").eq("id", session.userId).maybeSingle(),
      db.from("designer_profiles").select("avatar_url").eq("user_id", session.userId).maybeSingle(),
    ]);
    return { name: user?.name ?? null, avatarUrl: profile?.avatar_url ?? null };
  })();

  return <DashboardHome name={name} avatarUrl={avatarUrl} userId={userId} />;
}
