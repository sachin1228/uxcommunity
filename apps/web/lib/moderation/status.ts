/**
 * The moderation decision states stored in `moderation_events.status`.
 *
 * The column is a text column with a check constraint, so the generated row
 * type is `string`; keeping the allowed values here as a literal union lets
 * the admin routes narrow a request value into something the query builder —
 * and the constraint — actually accept.
 */
export const MODERATION_STATUSES = ["approved", "review", "rejected"] as const;

export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

const STATUS_SET: ReadonlySet<string> = new Set<string>(MODERATION_STATUSES);

export function isModerationStatus(value: string): value is ModerationStatus {
  return STATUS_SET.has(value);
}
