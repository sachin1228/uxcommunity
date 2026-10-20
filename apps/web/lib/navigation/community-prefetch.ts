/**
 * What a sidebar hover is allowed to prefetch.
 *
 * Hovering a community row used to also call
 * `fetchAndHydrateCommunityBootstrap`, which is the heaviest API route in the
 * app. A sweep down a 15-row sidebar could request 15 full bootstraps even
 * though none of those communities was opened. The only prefetch with a
 * defensible cost/benefit on hover is Next's RSC route prefetch: it is what
 * makes the click instant, and it is deduplicated by the router.
 */
export function prefetchCommunityRoute(
  prefetch: (href: string) => void,
  communityId: string,
): void {
  prefetch(`/dashboard/communities/${communityId}`);
}
