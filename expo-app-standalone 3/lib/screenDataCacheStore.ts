/** AsyncStorage binding for the testable screen snapshot cache. */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ScreenDataCache,
  type ScreenCacheSnapshot,
  type ScreenCacheStorage,
} from './screenDataCache';

const storage: ScreenCacheStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

export const screenDataCache = new ScreenDataCache(storage);

/** Called with every auth identity/session change before the next screen paints. */
export function activateScreenDataSession(ownerId: string | null, epoch: number): void {
  screenDataCache.activateSession(ownerId, epoch);
}

export function peekScreenData<T>(
  ownerId: string | null,
  key: string,
  epoch: number,
  ttlMs: number,
): ScreenCacheSnapshot<T> | null {
  return screenDataCache.peek(ownerId, key, epoch, ttlMs);
}

export function readScreenData<T>(
  ownerId: string | null,
  key: string,
  epoch: number,
  ttlMs: number,
): Promise<ScreenCacheSnapshot<T> | null> {
  return screenDataCache.read(ownerId, key, epoch, ttlMs);
}

export function fetchScreenData<T>(
  ownerId: string | null,
  key: string,
  epoch: number,
  ttlMs: number,
  load: () => Promise<T>,
  cacheData?: (data: T) => unknown,
): Promise<{ data: T; accepted: boolean }> {
  return screenDataCache.fetch(ownerId, key, epoch, ttlMs, load, cacheData);
}

export function writeScreenData<T>(
  ownerId: string | null,
  key: string,
  epoch: number,
  data: T,
  ttlMs: number,
): Promise<boolean> {
  return screenDataCache.write(ownerId, key, epoch, data, ttlMs);
}

const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Coalesce rapid snapshot writes (a like, then a poll vote, then a save)
 * into one AsyncStorage round-trip per key. The in-memory snapshot is only
 * written when the timer fires; this cache is a first-paint hint, so losing a
 * sub-second-old write on a hard kill costs nothing the next fetch does not
 * restore. `writeScreenData` stays available for writes that must land now.
 */
export function writeScreenDataDebounced<T>(
  ownerId: string | null,
  key: string,
  epoch: number,
  data: T,
  ttlMs: number,
  delayMs = 600,
): void {
  const identity = `${ownerId ?? ''}\u0000${key}`;
  const existing = pendingWrites.get(identity);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingWrites.delete(identity);
    void screenDataCache.write(ownerId, key, epoch, data, ttlMs);
  }, delayMs);
  pendingWrites.set(identity, timer);
}

export function clearScreenDataForUser(ownerId: string | null): Promise<void> {
  return screenDataCache.clearOwner(ownerId);
}

export function invalidateScreenData(ownerId: string, key: string): Promise<void> {
  return screenDataCache.invalidate(ownerId, key);
}
