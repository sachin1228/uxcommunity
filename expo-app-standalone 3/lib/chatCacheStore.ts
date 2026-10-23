/**
 * The app's chat cache, bound to AsyncStorage — the persistent half of
 * lib/chatCache.ts (kept separate so the cache rules stay testable under
 * plain Node).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createChatCache } from './chatCache';

export const chatCache = createChatCache({
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
  getAllKeys: () => AsyncStorage.getAllKeys(),
  multiRemove: (keys) => AsyncStorage.multiRemove([...keys]),
});

// Writes are suspended until auth adopts an identity (`activateUser`), so no
// screen can read or persist another account's data during a launch,
// sign-out or account switch.
chatCache.activateUser(null);
