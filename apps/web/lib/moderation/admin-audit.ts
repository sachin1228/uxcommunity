import type { SessionPayload } from "@/lib/auth/session";
import type { ServiceClient } from "@/lib/supabase/service";
import {
  recordModerationAction,
  type ModerationAuditAction,
} from "@/lib/moderation/audit";

/**
 * Shared actor context for an admin-session audit row. Admin sessions have no
 * users row, so the session id and the captured admin email are the durable
 * attribution; moderator_id stays null.
 */
export function adminAuditActor(session: SessionPayload) {
  return {
    moderatorId: session.userId ?? null,
    moderatorSid: session.sid,
    moderatorLabel: session.email,
  };
}

export async function recordAdminAudit(
  db: ServiceClient,
  session: SessionPayload,
  input: {
    action: ModerationAuditAction;
    targetType: string;
    targetId: string | null;
    reportId?: string | null;
    subjectUserId?: string | null;
    previousState?: Record<string, unknown>;
    newState?: Record<string, unknown>;
    reason?: string | null;
  },
): Promise<void> {
  await recordModerationAction(db, {
    ...adminAuditActor(session),
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    reportId: input.reportId ?? null,
    subjectUserId: input.subjectUserId ?? null,
    previousState: input.previousState,
    newState: input.newState,
    reason: input.reason ?? null,
  });
}
