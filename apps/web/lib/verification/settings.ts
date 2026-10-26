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
 * The admin-configured grace window. Cached briefly because every write reads
 * it; a policy change still reaches other isolates within 30s.
 */
export async function getVerificationGraceDays(): Promise<number> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.days;

  try {
    const db = createServiceClient();
    const { data } = await db
      .from("verification_settings")
      .select("grace_days")
      .eq("id", true)
      .maybeSingle();
    const days = clampGraceDays((data as { grace_days?: number } | null)?.grace_days);
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
