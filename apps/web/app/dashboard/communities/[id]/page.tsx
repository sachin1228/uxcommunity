import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { fetchCommunityMetaSSR } from "@/lib/communities/server";
import { CommunityChat } from "@/components/communities/CommunityChat";
import type { ChatTab } from "@/components/communities/chat/ChatHeader";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function CommunityPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { id } = await params;
  const { tab } = await searchParams;
  const initialTab: ChatTab =
    tab === "showcase" || tab === "threads" || tab === "events" || tab === "resources" || tab === "members" || tab === "about" || tab === "custom" ? tab : "chat";
  const userId = (session as { userId: string }).userId;

  // Lightweight server snapshot: community read model + top members only, so
  // the header and info panel paint immediately. Messages and tab sections
  // hydrate client-side (cached + realtime with the Lottie loader while the
  // first message page loads) — navigation never blocks on the full read model.
  const ssrData = await fetchCommunityMetaSSR(id, userId).catch(() => null);

  return (
    <CommunityChat
      communityId={id}
      currentUserId={userId}
      currentUserName={ssrData?.currentUserName ?? "Someone"}
      initialMeta={ssrData?.meta}
      initialLastReadAt={ssrData?.lastReadAt}
      initialTab={initialTab}
    />
  );
}
