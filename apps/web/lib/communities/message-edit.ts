export const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

export function canEditMessage(createdAt: string, now = Date.now()): boolean {
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) return false;

  const elapsed = now - createdAtMs;
  return elapsed >= 0 && elapsed <= MESSAGE_EDIT_WINDOW_MS;
}
