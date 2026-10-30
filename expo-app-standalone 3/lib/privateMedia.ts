/**
 * Private media helpers for the mobile client.
 *
 * DM images now live behind `/api/private/dm/…`, which requires the session
 * cookie. React Native's image loader does not replay the app's cookie on its
 * own, so private sources carry an explicit `Cookie` header and the URI is
 * resolved against the configured API host. Private pixels stay in the memory
 * cache only — a shared device must not keep another member's DM images on
 * disk after the session ends.
 */

import { API_BASE_URL, peekSessionToken } from './api';

const PRIVATE_PREFIX = '/api/private/';
const SESSION_COOKIE = 'uxcommunity_session';

export function isPrivateMediaUri(uri: string): boolean {
  return uri.startsWith(PRIVATE_PREFIX);
}

/** Resolve an app-relative path against the API base; absolute URLs pass through. */
export function resolveMediaUri(uri: string): string {
  return uri.startsWith('/') ? `${API_BASE_URL}${uri}` : uri;
}

/** Cookie header for a private request, or undefined for public media. */
export function privateMediaHeaders(uri: string): Record<string, string> | undefined {
  if (!isPrivateMediaUri(uri)) return undefined;
  const token = peekSessionToken();
  return token ? { Cookie: `${SESSION_COOKIE}=${token}` } : undefined;
}

/** The expo-image source object for a chat/verification image. */
export function mediaSource(uri: string): {
  uri: string;
  headers?: Record<string, string>;
} {
  const headers = privateMediaHeaders(uri);
  return headers ? { uri: resolveMediaUri(uri), headers } : { uri: resolveMediaUri(uri) };
}

/** Private images never enter the disk cache; public media keeps its cache. */
export function mediaCachePolicy(uri: string): 'memory' | 'memory-disk' {
  return isPrivateMediaUri(uri) ? 'memory' : 'memory-disk';
}
