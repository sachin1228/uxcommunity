import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { fetchCommunitySSRData } from "@/lib/communities/server";
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
    tab === "showcase" || tab === "threads" || tab === "events" || tab === "resources" || tab === "members" ? tab : "chat";
  const userId = (session as { userId: string }).userId;

  // Always provide one consistent server snapshot. Header-based hard/soft
  // navigation detection made the same route render different data trees and
  // forced an extra client bootstrap fetch after Link navigation.
  const ssrData = await fetchCommunitySSRData(id, userId).catch(() => null);

  return (
    <CommunityChat
      communityId={id}
      currentUserId={userId}
      initialMeta={ssrData?.meta}
      initialMessages={ssrData?.messages}
      initialLastReadAt={ssrData?.lastReadAt}
      initialSections={ssrData?.sections}
      initialTab={initialTab}
    />
  );
}
