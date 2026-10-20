import type { CommunityActivityEntry } from '@/lib/communities';

/**
 * Human-readable copy for the management audit trail — the same sentences the
 * web ActivityView renders, ported verbatim so both clients describe an action
 * identically.
 */
export function describeActivity(entry: CommunityActivityEntry): string {
  const d = entry.details ?? {};
  const target = (v: unknown) => (typeof v === 'string' ? v : null);
  const actedOn = target(d.member_name) ?? entry.target_user_name ?? 'a member';

  switch (entry.action) {
    case 'admin_promoted':
      return `made ${target(d.admin_name) ?? 'a member'} an admin`;
    case 'admin_demoted':
      return `removed ${target(d.admin_name) ?? 'an admin'}'s admin rights`;
    case 'admin_permissions_updated':
      return `changed ${target(d.admin_name) ?? 'an admin'}'s permissions`;
    case 'moderator_promoted':
      return `made ${target(d.member_name) ?? 'a member'} a moderator`;
    case 'moderator_dismissed':
      return `removed ${target(d.member_name) ?? 'a moderator'}'s moderator role`;
    case 'moderator_permissions_updated':
      return `changed ${target(d.member_name) ?? 'a moderator'}'s moderator permissions`;
    case 'member_removed':
      return `removed ${target(d.member_name) ?? 'a member'} from the community`;
    case 'join_request_accepted':
      return `accepted ${target(d.member_name) ?? 'a member'}'s join request`;
    case 'join_request_declined':
      return `declined ${target(d.member_name) ?? 'a member'}'s join request`;
    case 'community_settings_updated': {
      const changed = Array.isArray(d.changed) ? (d.changed as string[]) : [];
      if (changed.length > 0) {
        const pretty = changed.map((key) => key.replace(/_/g, ' ')).join(', ');
        return `updated community settings (${pretty})`;
      }
      return 'updated community settings';
    }
    case 'invite_link_regenerated':
      return 'regenerated the invite link';
    case 'message_deleted':
      return `deleted ${actedOn}'s chat message`;
    case 'thread_deleted':
      return `deleted ${actedOn}'s thread`;
    case 'showcase_deleted':
      return `deleted ${actedOn}'s showcase post`;
    case 'resource_deleted':
      return `deleted ${actedOn}'s resource`;
    case 'event_deleted':
      return `deleted ${actedOn}'s event`;
    default:
      return entry.action.replace(/_/g, ' ');
  }
}

export function actorLabel(entry: CommunityActivityEntry): string {
  if (entry.actor_role === 'platform') return 'Platform';
  return entry.actor_name ?? 'Unknown';
}

/** Stable key for the actor filter chips (platform rows have no id). */
export function entryActorId(entry: CommunityActivityEntry): string {
  return entry.actor_id ?? `u-${entry.actor_name ?? ''}`;
}

/** "20 Oct, 04:22 pm" — the same en-IN shape the web feed renders. */
export function fmtActivityTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "just now" / "5h ago" / "3d ago" — the pending-request timestamp. */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
