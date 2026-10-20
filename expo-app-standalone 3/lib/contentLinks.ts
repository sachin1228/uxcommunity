import { API_BASE_URL } from './api';

/**
 * The web URL a card's Share row posts. Event cards are the only cards with
 * Share (web parity), and their canonical page lives under the community.
 * `EXPO_PUBLIC_API_URL` is the same origin the app talks to, so this matches
 * the link the web's own share sheet copies.
 */
export function eventShareUrl(communityId: string, eventId: string): string {
  return `${API_BASE_URL}/dashboard/communities/${communityId}/events/${eventId}`;
}
