import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { SavedFeed } from "@/components/feeds/ProfileActivityFeed";
import { communityFeedLayout } from "@/components/communities/feed-layout";

export const metadata = { title: "Saved — uxcommunity" };

/**
 * The workspace Saved page: every thread, showcase post, resource and event the
 * member saved, across all communities. It is the profile's Saved scope as a
 * surface of its own — same RPC, same cards, same content bus — so both places
 * always agree.
 */
export default async function SavedPage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className={`${communityFeedLayout.content} px-4 pb-12`}>
        <div className={communityFeedLayout.pageHeader}>
          <h1 className="font-display text-xl font-semibold text-foreground">Saved</h1>
          <p className="mt-1 max-w-sm text-pretty font-body text-sm leading-5 text-foreground-muted">
            Threads, showcase posts, resources and events you save appear here.
          </p>
        </div>
        <SavedFeed currentUserId={session.userId!} />
      </div>
    </div>
  );
}
