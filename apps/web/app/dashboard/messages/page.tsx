import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { findOrCreateDmConversation, loadDmPeer } from "@/lib/direct-messages/server";
import type { DmConversationSummary } from "@/lib/direct-messages/types";
import { DirectMessagesView } from "@/components/direct-messages/DirectMessagesView";

export const metadata = { title: "Messages — uxcommunity" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  searchParams: Promise<{ peer?: string }>;
}

export default async function MessagesPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const userId = session.userId!;
  const { peer } = await searchParams;

  const db = createServiceClient();
  const [{ data: user }, { data: profile }] = await Promise.all([
    db.from("users").select("name").eq("id", userId).maybeSingle(),
    db.from("designer_profiles").select("avatar_url").eq("user_id", userId).maybeSingle(),
  ]);

  // A profile's Message chip lands here with ?peer=. Get-or-create the
  // conversation server-side so the window opens on it immediately — even
  // before its first message, when the list itself won't carry it yet. A
  // malformed or unknown peer just falls back to the plain window.
  let initialConversation: DmConversationSummary | null = null;
  if (peer && peer !== userId && UUID_PATTERN.test(peer)) {
    const peerUser = await loadDmPeer(db, peer);
    if (peerUser) {
      const created = await findOrCreateDmConversation(userId, peer);
      if (created.ok) {
        initialConversation = {
          id: created.conversation.id,
          peer: peerUser,
          last_message: null,
          unread_count: 0,
          my_last_read_at: created.conversation.my_last_read_at,
          last_message_at: created.conversation.last_message_at,
        };
      }
    }
  }

  return (
    <DirectMessagesView
      userId={userId}
      currentUserName={(user as { name?: string } | null)?.name ?? session.email ?? "You"}
      currentUserAvatar={(profile as { avatar_url?: string | null } | null)?.avatar_url ?? null}
      initialConversation={initialConversation}
    />
  );
}
