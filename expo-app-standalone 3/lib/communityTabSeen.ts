/**
 * The shared tab-seen store, bound to AsyncStorage — the mobile counterpart
 * of the web's localStorage-backed module (lib/communities/tab-seen.ts).
 *
 * One module-level instance so the chat header's tab dots observe the same
 * watermarks the tabs advance: opening a tab clears its dot immediately.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createTabSeenStore } from './tabSeen';

export const communityTabSeen = createTabSeenStore({
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
});
