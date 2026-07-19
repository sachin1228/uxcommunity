import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { CommunityChat } from "@/components/communities/CommunityChat";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CommunityPage({ params }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { id } = await params;

  return (
    <CommunityChat
      communityId={id}
      currentUserId={(session as { userId: string }).userId}
    />
  );
}
