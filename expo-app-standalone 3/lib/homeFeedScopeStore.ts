/**
 * The Home feed's tab choice, bound to AsyncStorage — the mobile counterpart
 * of the web's localStorage-backed module (lib/feeds/home-feed-options.ts).
 *
 * The validation and storage plumbing live in ./homeFeedScope; this file is
 * only the AsyncStorage binding, which keeps the helpers testable on plain
 * Node (see homeFeedScope.test.ts).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  hydrateHomeFeedScope,
  persistHomeFeedScope,
  type HomeFeedScope,
} from './homeFeedScope';

/** The remembered tab, or null when none was stored (or storage failed). */
export function readStoredHomeFeedScope(): Promise<HomeFeedScope | null> {
  return hydrateHomeFeedScope(AsyncStorage);
}

/** Remembers the chosen tab across app launches. Never rejects. */
export function storeHomeFeedScope(scope: HomeFeedScope): Promise<void> {
  return persistHomeFeedScope(AsyncStorage, scope);
}
