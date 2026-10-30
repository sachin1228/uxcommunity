import type { NotificationEntityType } from "@/lib/notifications";
import type { InteractionReportType } from "@/lib/communities/report-reasons";

/**
 * The small mappings the interaction report queue needs in two places: which
 * notification entity a reporter thank-you is scoped to, what the target is
 * called in copy, and whether the queue may delete it.
 *
 * Profiles are never deleted from a report — the reviewer opens the member
 * page and uses block/delete there — so `isRemovableInteraction` is the one
 * gate the admin action and the UI must agree on.
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
  }
}

export function interactionTargetLabel(targetType: InteractionReportType): string {
  switch (targetType) {
    case "community_message":
      return "message";
    case "profile":
      return "profile";
    default:
      return "comment";
  }
}

export function isRemovableInteraction(targetType: InteractionReportType): boolean {
  return targetType !== "profile";
}
