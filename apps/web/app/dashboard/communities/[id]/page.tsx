import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { fetchCommunitySSRData } from "@/lib/communities/server";
import { CommunityChat } from "@/components/communities/CommunityChat";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CommunityPage({ params }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { id } = await params;
  const userId = (session as { userId: string }).userId;

  /**
   * Detect whether this is a hard browser refresh (or direct URL / new-tab
   * navigation) vs a client-side navigation driven by Next.js.
   *
   * We use the standardised `Sec-Fetch-Mode` header (W3C Fetch Metadata spec)
   * instead of the internal `Next-Router-State-Tree` header:
   *
   *   • Sec-Fetch-Mode === "navigate"
   *       → Full browser page load (hard refresh, direct URL, new tab).
   *         The browser sets this; JavaScript's fetch() can never produce it.
   *         We fetch SSR data server-side and pass it as props so the client
   *         cache is seeded instantly on hydration (zero API calls after JS
   *         loads).
   *
   *   • Sec-Fetch-Mode !== "navigate"  ("same-origin", "cors", "no-cors" …)
   *       → Client-side navigation: Next.js fetched the RSC payload via
   *         fetch(), browser back/forward, or a <Link> prefetch.
   *         The module-level cache already holds the data; skip the DB fetch.
   *
   * Why not `Next-Router-State-Tree`? It is an internal Next.js header that
   * could be renamed or removed in any release.  `Sec-Fetch-Mode` is a W3C
   * browser standard and will not change.
   */
  const headerStore = await headers();
  // "navigate" is only sent on full browser page loads — never by JS fetch().
  const isClientNav = headerStore.get("Sec-Fetch-Mode") !== "navigate";

  const ssrData = isClientNav
    ? null
    : await fetchCommunitySSRData(id, userId).catch(() => null);

  return (
    <CommunityChat
      communityId={id}
      currentUserId={userId}
      initialMeta={ssrData?.meta}
      initialMessages={ssrData?.messages}
    />
  );
}
