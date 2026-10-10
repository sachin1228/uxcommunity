import { CompetitionBoard } from "@/components/competition/CompetitionBoard";
import { requestInstant } from "@/components/competition/week";

export const metadata = { title: "Competition — uxcommunity" };

/**
 * One challenge per week. The board computes the week's phase (submissions →
 * voting → winner) from the clock: the server passes its own instant in at
 * request time, so the first paint already shows the right window, and the
 * client keeps the countdown live afterwards. Session and membership are
 * handled by the dashboard layout.
 */
export default function CompetitionPage() {
  return <CompetitionBoard serverNow={requestInstant()} />;
}
