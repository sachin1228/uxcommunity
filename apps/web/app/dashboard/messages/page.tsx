import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { DirectMessagesView } from "@/components/direct-messages/DirectMessagesView";

export const metadata = { title: "Messages — uxcommunity" };

export default async function MessagesPage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const db = createServiceClient();
  const [{ data: user }, { data: profile }] = await Promise.all([
    db.from("users").select("name").eq("id", session.userId!).maybeSingle(),
    db.from("designer_profiles").select("avatar_url").eq("user_id", session.userId!).maybeSingle(),
  ]);

  return (
    <DirectMessagesView
      userId={session.userId!}
      currentUserName={(user as { name?: string } | null)?.name ?? session.email ?? "You"}
      currentUserAvatar={(profile as { avatar_url?: string | null } | null)?.avatar_url ?? null}
    />
  );
}
