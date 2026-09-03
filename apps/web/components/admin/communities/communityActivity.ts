import type { CommunityActivityEntry } from "./communityTypes";

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
    default:
      return entry.action.replace(/_/g, " ");
  }
}

export function actorLabel(entry: CommunityActivityEntry): string {
  if (entry.actor_role === "platform") return "Platform";
  return entry.actor_name ?? "Unknown";
}

export function actorInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

export function fmtActivityTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
