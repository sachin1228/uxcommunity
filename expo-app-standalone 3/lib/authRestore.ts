/**
 * The launch-time session decision table, kept pure so the security-relevant
 * branches (expired cookie, offline launch, account switch) are testable
 * without React or the network.
 *
 *   probe              cached user   decision
 *   ─────────────────  ───────────   ───────────────────────────────────────
 *   valid user         any           paint the server row, persist it
 *   no session / 401   any           signed out, clear member-scoped state
 *   network error      present       keep the cached shell offline
 *   network error      absent        signed out, keep caches for next try
 */

import type { User } from './auth';

export type SessionProbe =
  | { kind: 'user'; user: User }
  | { kind: 'no-session' }
  | { kind: 'unauthorized' }
  | { kind: 'offline' };

export interface SessionRestoreDecision {
  /** The identity to paint (null = signed out). */
  user: User | null;
  /** Drop the cookie, snapshot and every member-scoped cache. */
  clearMemberState: boolean;
  /** Write this server row over the snapshot. */
  persistUser: boolean;
}

export function resolveSessionRestore(
  cached: User | null,
  probe: SessionProbe,
): SessionRestoreDecision {
  switch (probe.kind) {
    case 'user':
      return { user: probe.user, clearMemberState: false, persistUser: true };
    case 'no-session':
    case 'unauthorized':
      return { user: null, clearMemberState: true, persistUser: false };
    case 'offline':
      return cached
        ? { user: cached, clearMemberState: false, persistUser: false }
        : { user: null, clearMemberState: false, persistUser: false };
  }
}
