import type { NotificationEntityType } from "@/lib/notifications";
import type { InteractionReportType } from "@/lib/communities/report-reasons";

/**
 * The small mappings the interaction report queue needs in two places: which
 * notification entity a reporter thank-you is scoped to, what the target is
 * called in copy, and whether the queue may delete it.
 *
 * Profiles are never deleted from a report — the reviewer opens the member
 * page and uses block/delete there. Communities are hidden (their membership
 * and content stay intact) and job listings are closed (their applications
 * stay intact), so neither is "removable" in the destructive sense.
 */

export function interactionEntityType(
  targetType: InteractionReportType,
): NotificationEntityType {
  switch (targetType) {
    case "thread_comment":
      return "thread";
    case "showcase_comment":
      return "showcase";
    case "resource_comment":
      return "resource";
    case "event_comment":
      return "event";
    case "community_message":
      return "message";
    case "profile":
      return "profile";
    case "community":
      return "community";
    case "job":
      return "job";
  }
}

export function interactionTargetLabel(targetType: InteractionReportType): string {
  switch (targetType) {
    case "community_message":
      return "message";
    case "profile":
      return "profile";
    case "community":
      return "community";
    case "job":
      return "job listing";
    default:
      return "comment";
  }
}

/** Only comments and chat messages are deleted outright from this queue. */
export function isRemovableInteraction(targetType: InteractionReportType): boolean {
  return (
    targetType !== "profile" &&
    targetType !== "community" &&
    targetType !== "job"
  );
}
