/** Cacheable profile projections; request-only or viewer relationship state is excluded. */

import type { OwnProfile } from './profile';

export interface OwnProfileSnapshot {
  userName: string | null;
  profile: OwnProfile['profile'];
  roleLabel: string | null;
  company: OwnProfile['company'];
}

export type OwnProfileView = Omit<OwnProfile, 'user'> & {
  user: { name: string | null } | null;
};

export function ownProfileCacheSnapshot(
  profile: Pick<OwnProfile, 'profile' | 'roleLabel' | 'company'> & {
    user: { name: string | null } | null;
  },
): OwnProfileSnapshot {
  return {
    userName: profile.user?.name ?? null,
    profile: profile.profile,
    roleLabel: profile.roleLabel,
    company: profile.company,
  };
}

export function ownProfileFromCache(snapshot: OwnProfileSnapshot): OwnProfileView {
  return {
    user: snapshot.userName === null ? null : { name: snapshot.userName },
    profile: snapshot.profile,
    roleLabel: snapshot.roleLabel,
    company: snapshot.company,
    pendingCompany: null,
  };
}

export function ownProfileFromServer(profile: OwnProfile): OwnProfileView {
  return {
    user: profile.user ? { name: profile.user.name } : null,
    profile: profile.profile,
    roleLabel: profile.roleLabel,
    company: profile.company,
    pendingCompany: profile.pendingCompany,
  };
}
