import { nameInitials } from "@/lib/avatar";

/**
 * One row of a community's management audit trail (`community_admin_activity`),
 * as both the platform admin dashboard and the in-community owner Activity tab
 * receive it. Actor/target names are snapshotted at write time, so the feed
 * renders without joins.
 */
export interface CommunityActivityEntry {
  id: string;
  community_id: string;
  actor_id: string | null;
  actor_role: "owner" | "admin" | "moderator" | "platform";
  actor_name: string | null;
  /** Attached by each API from designer_profiles — the audit row only snapshots the name. */
  actor_avatar_url?: string | null;
  action: string;
  target_user_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

/** Human-readable copy for each recorded management action. */
export function describeActivity(entry: CommunityActivityEntry): string {
  const d = entry.details ?? {};
  const target = (v: unknown) => (typeof v === "string" ? v : null);

  switch (entry.action) {
    case "admin_promoted":
      return `made ${target(d.admin_name) ?? "a member"} an admin`;
    case "admin_demoted":
      return `removed ${target(d.admin_name) ?? "an admin"}'s admin rights`;
    case "admin_permissions_updated":
      return `changed ${target(d.admin_name) ?? "an admin"}'s permissions`;
    case "moderator_promoted":
      return `made ${target(d.member_name) ?? "a member"} a moderator`;
    case "moderator_dismissed":
      return `removed ${target(d.member_name) ?? "a moderator"}'s moderator role`;
    case "moderator_permissions_updated":
      return `changed ${target(d.member_name) ?? "a moderator"}'s moderator permissions`;
    case "member_removed":
      return `removed ${target(d.member_name) ?? "a member"} from the community`;
    case "join_request_accepted":
      return `accepted ${target(d.member_name) ?? "a member"}'s join request`;
    case "join_request_declined":
      return `declined ${target(d.member_name) ?? "a member"}'s join request`;
    case "community_settings_updated": {
      const changed = Array.isArray(d.changed) ? (d.changed as string[]) : [];
      if (changed.length > 0) {
        const pretty = changed.map((key) => key.replace(/_/g, " ")).join(", ");
        return `updated community settings (${pretty})`;
      }
      return "updated community settings";
    }
    case "invite_link_regenerated":
      return "regenerated the invite link";
    case "message_deleted":
      return "deleted a member's chat message";
    case "thread_deleted":
      return "deleted a member's thread";
    case "showcase_deleted":
      return "deleted a member's showcase post";
    case "resource_deleted":
      return "deleted a member's resource";
    case "event_deleted":
      return "deleted a member's event";
    default:
      return entry.action.replace(/_/g, " ");
  }
}

export function actorLabel(entry: CommunityActivityEntry): string {
  if (entry.actor_role === "platform") return "Platform";
  return entry.actor_name ?? "Unknown";
}

export function actorInitials(name: string): string {
  return nameInitials(name);
}

export function fmtActivityTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
