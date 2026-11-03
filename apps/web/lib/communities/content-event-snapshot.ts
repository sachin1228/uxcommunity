/** A delayed history snapshot must not undo live inserts, reactions or deletes. */
export function mergeContentEventSnapshot<T extends { id: string; created_at: string }>(
  history: T[], current: T[], deleted: ReadonlySet<string>,
): T[] {
  const byId = new Map(history.map((event) => [event.id, event]));
  for (const event of current) byId.set(event.id, event);
  for (const id of deleted) byId.delete(id);
  return [...byId.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}
