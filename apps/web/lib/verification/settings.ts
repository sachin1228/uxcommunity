import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import {
  clampGraceDays,
  DEFAULT_VERIFICATION_GRACE_DAYS,
} from "./policy";

export {
  DEFAULT_VERIFICATION_GRACE_DAYS,
  MAX_VERIFICATION_GRACE_DAYS,
  isVerificationBannerVisible,
  isVerificationRestricted,
  verificationEligibleAt,
} from "./policy";

const CACHE_TTL_MS = 30_000;
let cached: { days: number; at: number } | null = null;

/**
 * Admin-set grace window for new signups. The write gate and banner both use
 * it via the pure policy helpers; cached briefly to avoid a query storm on
 * every write. Saving from the admin page invalidates this isolate's cache.
 */
export async function getNewAccountGraceDays(): Promise<number> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.days;

  try {
    const db = createServiceClient();
    const { data } = await db
      .from("verification_settings")
      .select("new_account_grace_days")
      .eq("id", true)
      .maybeSingle();
    const days = clampGraceDays(
      (data as { new_account_grace_days?: number } | null)?.new_account_grace_days,
    );
    cached = { days, at: Date.now() };
    return days;
  } catch (error) {
    console.error("[verification/settings] read failed:", error);
    cached = { days: DEFAULT_VERIFICATION_GRACE_DAYS, at: Date.now() };
    return DEFAULT_VERIFICATION_GRACE_DAYS;
  }
}

export function invalidateVerificationGraceCache(): void {
  cached = null;
}
