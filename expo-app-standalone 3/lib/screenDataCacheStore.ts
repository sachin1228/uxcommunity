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

export function clearScreenDataForUser(ownerId: string | null): Promise<void> {
  return screenDataCache.clearOwner(ownerId);
}

export function invalidateScreenData(ownerId: string, key: string): Promise<void> {
  return screenDataCache.invalidate(ownerId, key);
}
