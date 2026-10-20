/**
 * The community management capability catalogue — the mobile mirror of the
 * web app's `lib/communities/permissions.ts`. The server validates and
 * enforces these keys; the members tab renders the same labels and starts
 * from the same defaults, so both clients agree on what a moderator may do.
 */

export const COMMUNITY_PERMISSION_KEYS = [
  'can_edit_settings',
  'can_manage_members',
  'can_delete_messages',
  'can_moderate_threads',
  'can_moderate_showcase',
  'can_moderate_resources',
  'can_moderate_events',
] as const;

export type CommunityPermission = (typeof COMMUNITY_PERMISSION_KEYS)[number];

export type CommunityPermissions = Record<CommunityPermission, boolean>;

export type CommunityRole = 'owner' | 'admin' | 'moderator' | 'member';

export const NO_COMMUNITY_PERMISSIONS: CommunityPermissions = {
  can_edit_settings: false,
  can_manage_members: false,
  can_delete_messages: false,
  can_moderate_threads: false,
  can_moderate_showcase: false,
  can_moderate_resources: false,
  can_moderate_events: false,
};

/**
 * What a freshly promoted moderator starts with: content moderation on,
 * administration (members / settings) off.
 */
export const MODERATOR_DEFAULT_PERMISSIONS: CommunityPermissions = {
  can_edit_settings: false,
  can_manage_members: false,
  can_delete_messages: true,
  can_moderate_threads: true,
  can_moderate_showcase: true,
  can_moderate_resources: true,
  can_moderate_events: true,
};

export type CommunityPermissionGroup = 'Content moderation' | 'Administration';

export const MODERATOR_PERMISSION_OPTIONS: ReadonlyArray<{
  key: CommunityPermission;
  label: string;
  description: string;
  group: CommunityPermissionGroup;
}> = [
  {
    key: 'can_delete_messages',
    group: 'Content moderation',
    label: 'Delete chat messages',
    description: "Delete any member's messages in the community chat.",
  },
  {
    key: 'can_moderate_threads',
    group: 'Content moderation',
    label: 'Moderate threads',
    description: 'Delete any thread posted in the community.',
  },
  {
    key: 'can_moderate_showcase',
    group: 'Content moderation',
    label: 'Moderate showcase',
    description: 'Remove any showcase post shared in the community.',
  },
  {
    key: 'can_moderate_resources',
    group: 'Content moderation',
    label: 'Moderate resources',
    description: 'Remove any resource shared in the community.',
  },
  {
    key: 'can_moderate_events',
    group: 'Content moderation',
    label: 'Moderate events',
    description: 'Cancel any event posted in the community.',
  },
  {
    key: 'can_manage_members',
    group: 'Administration',
    label: 'Manage members',
    description: 'Remove members and accept or decline join requests.',
  },
  {
    key: 'can_edit_settings',
    group: 'Administration',
    label: 'Edit community settings',
    description: "Change the community's name, photo, description, rules and tabs.",
  },
];
