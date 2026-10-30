/** Pure schedule validation shared by create/edit server routes. */
export type EventScheduleError = "end_before_start" | "start_in_past";

export function validateEventSchedule(input: {
  start: string | null | undefined;
  end: string | null | undefined;
  /** Only a newly chosen start must be in the future. */
  requireFutureStart?: boolean;
  now?: number;
}): EventScheduleError | null {
  const start = input.start ? Date.parse(input.start) : Number.NaN;
  const end = input.end ? Date.parse(input.end) : null;
  if (!Number.isFinite(start)) return null;
  if (end !== null && Number.isFinite(end) && end <= start) return "end_before_start";
  if (input.requireFutureStart && start < (input.now ?? Date.now()) - 60_000) {
    return "start_in_past";
  }
  return null;
}
