import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { CommunityPageShell } from "@/components/communities/CommunityPageShell";

interface Props {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

/**
 * Wraps every page under /dashboard/communities/[id]/resources/...
 * in the same community chrome (header + tabs) that threads and events use.
 */
export default async function ResourcesLayout({ children, params }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { id } = await params;
  const userId = (session as { userId: string }).userId;

  return (
    <CommunityPageShell communityId={id} activeTab="resources" currentUserId={userId}>
      {children}
    </CommunityPageShell>
  );
}
