import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { CommunityPageShell } from "@/components/communities/CommunityPageShell";
import { loadCommunityReadModel } from "@/lib/communities/read-models";
import type { CachedMeta } from "@/lib/communities/cache";

interface Props {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

/**
 * Wraps every page under /dashboard/communities/[id]/threads/...
 * in the same community chrome (header + tabs + info sidebar) that the
 * main community chat page has.
 */
export default async function ThreadsLayout({ children, params }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { id } = await params;
  const userId = (session as { userId: string }).userId;
  const meta = await loadCommunityReadModel(id, userId);
  if (!meta.ok) redirect("/dashboard");

  return (
    <CommunityPageShell
      communityId={id}
      activeTab="threads"
      currentUserId={userId}
      initialMeta={meta.data as unknown as Pick<CachedMeta, "community" | "members">}
    >
      {children}
    </CommunityPageShell>
  );
}
