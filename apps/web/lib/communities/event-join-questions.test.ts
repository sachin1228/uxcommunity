import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EVENT_JOIN_QUESTIONS,
  EVENT_JOIN_ANSWER_LIMITS,
  joinAnswersComplete,
  joinAnswersPayload,
  missingJoinAnswers,
  trimJoinAnswer,
} from "./event-join-questions";

// The host asks four questions, and the member sees exactly those four — the
// form, the routes and the members tab must never disagree about the list.
test("the question list is the host's four compulsory questions", () => {
  assert.deepEqual(
    EVENT_JOIN_QUESTIONS.map((q) => q.label),
    [
      "Company name",
      "Years of work experience",
      "Why do you want to attend this meetup?",
      "What are you expecting from this meetup?",
    ],
  );
  assert.deepEqual(
    EVENT_JOIN_QUESTIONS.map((q) => q.key),
    ["company_name", "work_experience", "why_attend", "expectations"],
  );
});

test("whitespace-only answers count as missing", () => {
  assert.equal(trimJoinAnswer("   "), "");
  assert.deepEqual(
    missingJoinAnswers({
      company_name: "  ",
      work_experience: "3",
      why_attend: "To meet people",
      expectations: "Talks",
    }),
    ["company_name"],
  );
  assert.equal(
    joinAnswersComplete({
      company_name: "   ",
      work_experience: "3",
      why_attend: "To meet people",
      expectations: "Talks",
    }),
    false,
  );
});

test("every question is compulsory — nothing is optional", () => {
  assert.deepEqual(missingJoinAnswers({}), [
    "company_name",
    "work_experience",
    "why_attend",
    "expectations",
  ]);
  assert.equal(
    joinAnswersComplete({
      company_name: "Acme",
      work_experience: "3 years",
      why_attend: "To meet people",
      expectations: "Talks",
    }),
    true,
  );
});

test("an answer longer than its bound is invalid, not truncated", () => {
  const answers = {
    company_name: "A".repeat(EVENT_JOIN_ANSWER_LIMITS.company_name + 1),
    work_experience: "3 years",
    why_attend: "To meet people",
    expectations: "Talks",
  };
  assert.deepEqual(missingJoinAnswers(answers), ["company_name"]);
  assert.equal(joinAnswersComplete(answers), false);
  // Exactly at the bound is fine.
  assert.equal(
    joinAnswersComplete({
      ...answers,
      company_name: "A".repeat(EVENT_JOIN_ANSWER_LIMITS.company_name),
    }),
    true,
  );
});

test("non-string answers are treated as missing, never as crashes", () => {
  assert.deepEqual(
    missingJoinAnswers({
      company_name: 42 as unknown as string,
      work_experience: null,
      why_attend: undefined,
      expectations: "Talks",
    }),
    ["company_name", "work_experience", "why_attend"],
  );
});

// The payload builder is what the join buttons send: answers must be complete
// (or the payload is null and the request must not fire) and trimmed.
test("the payload is null until all four answers are complete", () => {
  assert.equal(
    joinAnswersPayload({ company_name: "Acme", work_experience: "3" }),
    null,
  );
  const payload = joinAnswersPayload({
    company_name: "  Acme  ",
    work_experience: " 3 years ",
    why_attend: " To meet people ",
    expectations: " Talks ",
  });
  assert.deepEqual(payload, {
    company_name: "Acme",
    work_experience: "3 years",
    why_attend: "To meet people",
    expectations: "Talks",
  });
});
