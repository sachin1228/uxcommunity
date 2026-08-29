import { apiFetch } from './api';

export interface ExploreCommunity {
  id: string;
  name: string;
  type: 'city' | 'sector' | 'interest' | 'experience_level' | 'general' | 'user';
  image_url: string | null;
  description: string | null;
  is_private: boolean;
  member_count: number;
  joined: boolean;
  can_join: boolean;
}

export interface ExploreCommunitiesResponse {
  communities: ExploreCommunity[];
}

export async function getExploreCommunities(): Promise<ExploreCommunity[]> {
  const { data } = await apiFetch<ExploreCommunitiesResponse>('/api/communities/all');
  return data.communities;
}

export async function joinCommunity(communityId: string): Promise<void> {
  await apiFetch(`/api/communities/${communityId}/join`, { method: 'POST' });
}
