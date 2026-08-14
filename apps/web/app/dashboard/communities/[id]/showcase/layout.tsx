import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { CommunityPageShell } from "@/components/communities/CommunityPageShell";
import { loadCommunityReadModel } from "@/lib/communities/read-models";
import type { CachedMeta } from "@/lib/communities/cache";

interface Props {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

/** Wraps showcase detail pages in the standard community header and tabs. */
export default async function ShowcaseLayout({ children, params }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { id } = await params;
  const userId = (session as { userId: string }).userId;
  const meta = await loadCommunityReadModel(id, userId);
  if (!meta.ok) redirect("/dashboard");

  return (
    <CommunityPageShell
      communityId={id}
      activeTab="showcase"
      currentUserId={userId}
      initialMeta={meta.data as unknown as Pick<CachedMeta, "community" | "members">}
    >
      {children}
    </CommunityPageShell>
  );
}
