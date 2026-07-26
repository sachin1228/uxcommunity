import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { CommunityPageShell } from "@/components/communities/CommunityPageShell";

interface Props {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

/**
 * Wraps every page under /dashboard/communities/[id]/events/...
 * in the same community chrome (header + tabs + info sidebar) that the
 * main community chat page has.
 */
export default async function EventsLayout({ children, params }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { id } = await params;
  const userId = (session as { userId: string }).userId;

  return (
    <CommunityPageShell communityId={id} activeTab="events" currentUserId={userId}>
      {children}
    </CommunityPageShell>
  );
}
