import { mobileEnvironmentKey } from "./environment";
/**
 * Encrypted session-token storage.
 *
 * The JWT is a bearer credential for 7 days. AsyncStorage is plaintext and is
 * included in device backups, so the token now lives in Expo SecureStore
 * (Keychain on iOS, Keystore-encrypted SharedPreferences on Android).
 *
 * Existing installs keep working: the first read migrates the token from the
 * two AsyncStorage keys the app has used (`@auth/uxcommunity_session` and the
 * pre-rebrand `@auth/draft_session`) into SecureStore and removes the plaintext
 * copy. The fallback is only for the Expo web build, where SecureStore does not
 * exist; a native device without a usable Keychain/Keystore is treated as an
 * error rather than silently writing the bearer token in plaintext.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** SecureStore keys allow only alphanumerics, ".", "-" and "_". */
const SECURE_SESSION_KEY = mobileEnvironmentKey('uxcommunity_session');
const LEGACY_SESSION_STORAGE_KEY = mobileEnvironmentKey('@auth/uxcommunity_session');
const LEGACY_DRAFT_STORAGE_KEY = mobileEnvironmentKey('@auth/draft_session');

const isWeb = Platform.OS === 'web';
let availability: Promise<boolean> | null = null;

function secureStoreAvailable(): Promise<boolean> {
  if (isWeb) return Promise.resolve(false);
  if (!availability) {
    availability = SecureStore.isAvailableAsync().catch(() => false);
  }
  return availability;
}

async function readLegacyAsyncToken(): Promise<string | null> {
  try {
    const current = await AsyncStorage.getItem(LEGACY_SESSION_STORAGE_KEY);
    if (current) return current;
    return await AsyncStorage.getItem(LEGACY_DRAFT_STORAGE_KEY);
  } catch {
    // Storage unavailable — treat as no stored session.
  }
  return null;
}

/** Read the stored token, migrating a plaintext token into SecureStore once. */
export async function readStoredSessionToken(): Promise<string | null> {
  const available = await secureStoreAvailable();

  if (available) {
    try {
      const secure = await SecureStore.getItemAsync(SECURE_SESSION_KEY);
      if (secure) {
        // Best-effort: remove a plaintext copy left by a partial migration.
        void AsyncStorage.multiRemove([
          LEGACY_SESSION_STORAGE_KEY,
          LEGACY_DRAFT_STORAGE_KEY,
        ]).catch(() => undefined);
        return secure;
      }
    } catch {
      // Fall through to the legacy read. A broken keychain read must not make
      // every request send without a cookie.
    }
  }

  const legacy = await readLegacyAsyncToken();
  if (!legacy) return null;

  if (available) {
    try {
      await SecureStore.setItemAsync(SECURE_SESSION_KEY, legacy);
      // Only remove plaintext after the encrypted copy is confirmed written.
      void AsyncStorage.multiRemove([
        LEGACY_SESSION_STORAGE_KEY,
        LEGACY_DRAFT_STORAGE_KEY,
      ]).catch(() => undefined);
    } catch {
      // Keep using the legacy value for this launch; the next launch retries.
    }
  }
  return legacy;
}

/** Persist a rotated/new session token. */
export async function writeStoredSessionToken(token: string): Promise<void> {
  const available = await secureStoreAvailable();

  if (available) {
    // Native must never write the bearer token to plaintext storage. If the
    // keystore is unavailable the caller sees the failure instead of silently
    // downgrading the credential's protection.
    await SecureStore.setItemAsync(SECURE_SESSION_KEY, token);
    void AsyncStorage.multiRemove([
      LEGACY_SESSION_STORAGE_KEY,
      LEGACY_DRAFT_STORAGE_KEY,
    ]).catch(() => undefined);
    return;
  }

  // Only the web build keeps the old fallback. A native device without a
  // working Keystore/Keychain must fail the write rather than silently
  // downgrade a 7-day bearer token to plaintext AsyncStorage.
  if (!isWeb) {
    throw new Error('Secure storage is unavailable on this device.');
  }
  await AsyncStorage.setItem(LEGACY_SESSION_STORAGE_KEY, token);
}

/** Remove the token from both stores. */
export async function clearStoredSessionToken(): Promise<void> {
  const clearLegacy = AsyncStorage.multiRemove([
    LEGACY_SESSION_STORAGE_KEY,
    LEGACY_DRAFT_STORAGE_KEY,
  ]);
  const results = await Promise.allSettled([
    ...(isWeb ? [] : [SecureStore.deleteItemAsync(SECURE_SESSION_KEY)]),
    clearLegacy,
  ]);
  // Keep a thrown error visible to callers that care, but always attempt both
  // stores: a half-cleared credential is worse than a rejected delete.
  const rejected = results.find((result) => result.status === 'rejected');
  if (rejected && rejected.status === 'rejected') throw rejected.reason;
}
