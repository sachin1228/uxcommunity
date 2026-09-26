/**
 * The questions an event asks before someone joins its group chat, and the
 * rules around answering them.
 *
 * These are compulsory: neither the "I'm Going" RSVP nor the room's own
 * "Join event chat" confirmation sends anything until all four are answered.
 * The host reads the recorded answers per member in the room's Members tab.
 *
 * Pure on purpose (no React, no fetch) so the client modal, the API routes and
 * the unit tests all agree on one definition of "answered".
 */

/** The questions, in the order the join form asks them. */
export const EVENT_JOIN_QUESTIONS = [
  {
    /** Payload key — also the storage column's JSON field in API payloads. */
    key: "company_name",
    label: "Company name",
    placeholder: "Where do you work?",
    multiline: false,
  },
  {
    key: "work_experience",
    label: "Years of work experience",
    placeholder: "e.g. 3 years",
    multiline: false,
  },
  {
    key: "why_attend",
    label: "Why do you want to attend this meetup?",
    placeholder: "Tell the host why this meetup is for you…",
    multiline: true,
  },
  {
    key: "expectations",
    label: "What are you expecting from this meetup?",
    placeholder: "What would make it worth your while?",
    multiline: true,
  },
] as const;

export type EventJoinQuestionKey = (typeof EVENT_JOIN_QUESTIONS)[number]["key"];

/** One member's recorded answers, keyed exactly like the questions above. */
export interface EventJoinAnswers {
  company_name: string;
  work_experience: string;
  why_attend: string;
  expectations: string;
}

/** Bounds mirrored by the storage table's checks (see the join-questions migration). */
export const EVENT_JOIN_ANSWER_LIMITS = {
  company_name: 200,
  work_experience: 100,
  why_attend: 2000,
  expectations: 2000,
} as const satisfies Record<EventJoinQuestionKey, number>;

/** Trimmed answer for a key — the shape both the form and the API trade in. */
export function trimJoinAnswer(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Which questions still need an answer. Every one of them is compulsory, so
 * an empty-after-trim answer is always missing — and an answer longer than its
 * bound is invalid rather than silently truncated.
 */
export function missingJoinAnswers(
  answers: Partial<Record<EventJoinQuestionKey, unknown>>,
): EventJoinQuestionKey[] {
  return EVENT_JOIN_QUESTIONS.filter(({ key }) => {
    const value = trimJoinAnswer(answers[key]);
    return value.length === 0 || value.length > EVENT_JOIN_ANSWER_LIMITS[key];
  }).map(({ key }) => key);
}

/** True when the form may be submitted — all four answers present and in bounds. */
export function joinAnswersComplete(
  answers: Partial<Record<EventJoinQuestionKey, unknown>>,
): answers is EventJoinAnswers {
  return missingJoinAnswers(answers).length === 0;
}

/** The payload the join routes accept: trimmed answers, or null while incomplete. */
export function joinAnswersPayload(
  answers: Partial<Record<EventJoinQuestionKey, unknown>>,
): EventJoinAnswers | null {
  if (!joinAnswersComplete(answers)) return null;
  return {
    company_name: trimJoinAnswer(answers.company_name),
    work_experience: trimJoinAnswer(answers.work_experience),
    why_attend: trimJoinAnswer(answers.why_attend),
    expectations: trimJoinAnswer(answers.expectations),
  };
}
