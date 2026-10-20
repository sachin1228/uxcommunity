/**
 * The feed's "posted in …" community preview's shared read model — the mobile
 * reading of the web app's `GET /api/communities/[id]/preview` and
 * `lib/communities/preview.ts`.
 *
 * The payload is the same read model the Explore row and the community page's
 * non-member banner use: the public facts plus the viewer's join eligibility.
 * A 404 means the community was deleted (posts from it stay in feeds), which
 * the sheet renders as a "deleted" state instead of a retry.
 *
 * The requests themselves live in `communityPreviewApi.ts`; this module stays
 * free of React Native imports so the join-outcome contract runs in the
 * plain-Node suite.
 */

export interface CommunityPreviewData {
  id: string;
  name: string;
  type: string;
  is_private: boolean;
  image_url: string | null;
  description: string | null;
  member_count: number;
  can_join: boolean;
  has_pending_request: boolean;
  /** True when the viewer already belongs to this community. */
  joined: boolean;
}

/** The two outcomes a join request can have. */
export type CommunityJoinOutcome = 'joined' | 'requested';

/**
 * The join endpoint answers `{ status: "requested" }` for a private
 * community's join request and anything else (an immediate membership) as a
 * plain success. Kept pure so the two branches are testable without a server.
 */
export function joinOutcomeFromStatus(status: unknown): CommunityJoinOutcome {
  return status === 'requested' ? 'requested' : 'joined';
}
