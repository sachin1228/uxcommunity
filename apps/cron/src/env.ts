export interface Env {
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  R2_PUBLIC_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Shared secret required by the manual trigger endpoint. */
  CRON_SECRET?: string;
  /** Set to "true" to delete eligible orphans; anything else = dry run. */
  R2_ORPHAN_SWEEP_DELETE?: string;
  /** Default 7. Only objects older than this are eligible for deletion. */
  R2_ORPHAN_SWEEP_GRACE_DAYS?: string;
}