/**
 * What counts as a *completed* signup.
 *
 * Completeness is defined by the 1:1 `designer_profiles` row — NOT by an
 * uploaded profile picture.
 *
 * Two independent changes made the picture a non-signal:
 *  1. The final signup step is skippable ("Select a picture to continue — or use
 *     Skip to finish without one"), so a member can finish with no picture.
 *  2. `20260826010000_remove_generated_avatars.sql` deliberately set every
 *     generated avatar to `NULL`, so even accounts that never uploaded anything
 *     suddenly had `avatar_url = null`.
 *
 * The account row and its profile are written together by `complete_signup` in
 * one transaction, so today a `users` row without a profile can only be a
 * legacy leftover from the pre-atomic signup flow. Profile existence is
 * therefore the right completeness signal; the picture is presentational.
 */
export type SignupProfileSnapshot = {
  id: string;
  /** Kept in the shape so callers/tests can assert a null picture is still complete. */
  avatar_url?: string | null;
};

export function isSignupIncomplete(
  profile: SignupProfileSnapshot | null | undefined
): boolean {
  return !profile;
}
