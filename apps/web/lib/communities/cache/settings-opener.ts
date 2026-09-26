/**
 * The room's settings modal lives with the room's chat view, but the request
 * for it comes from the info card beside the chat — a component in the
 * dashboard layout, outside the chat's tree (see EventRoomGoneSection). So the
 * mounted chat registers its opener here and the panel asks by community id:
 * no routing side effects, and the request either lands or is honestly
 * refused.
 */
const settingsOpeners = new Map<string, () => void>();

/** Called by the view that owns the settings modal for as long as it is up. */
export function registerCommunitySettingsOpener(
  communityId: string,
  open: () => void,
): () => void {
  settingsOpeners.set(communityId, open);
  return () => {
    // Only the opener that is still registered may withdraw: a remount
    // registers again before the old effect's cleanup runs, and that cleanup
    // must not unhook the new one.
    if (settingsOpeners.get(communityId) === open) settingsOpeners.delete(communityId);
  };
}

/**
 * Ask the mounted chat view to open this community's settings.
 *
 * Returns false when nothing took the request — the chat is not mounted at
 * this route, which is the caller's cue to go somewhere it is (see
 * EventRoomGoneSection).
 */
export function openCommunitySettings(communityId: string): boolean {
  const open = settingsOpeners.get(communityId);
  if (!open) return false;
  open();
  return true;
}
