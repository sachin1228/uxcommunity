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

// The host asks two questions, and the member sees exactly those two — the
// form, the routes and the members tab must never disagree about the list.
test("the question list is the host's two compulsory questions", () => {
  assert.deepEqual(
    EVENT_JOIN_QUESTIONS.map((q) => q.label),
    [
      "Why do you want to attend this meetup?",
      "What are you expecting from this meetup?",
    ],
  );
  assert.deepEqual(
    EVENT_JOIN_QUESTIONS.map((q) => q.key),
    ["why_attend", "expectations"],
  );
});

test("whitespace-only answers count as missing", () => {
  assert.equal(trimJoinAnswer("   "), "");
  assert.deepEqual(
    missingJoinAnswers({
      why_attend: "   ",
      expectations: "Talks",
    }),
    ["why_attend"],
  );
  assert.equal(
    joinAnswersComplete({
      why_attend: "   ",
      expectations: "Talks",
    }),
    false,
  );
});

test("every question is compulsory — nothing is optional", () => {
  assert.deepEqual(missingJoinAnswers({}), ["why_attend", "expectations"]);
  assert.equal(
    joinAnswersComplete({
      why_attend: "To meet people",
      expectations: "Talks",
    }),
    true,
  );
});

test("an answer longer than its bound is invalid, not truncated", () => {
  const answers = {
    why_attend: "A".repeat(EVENT_JOIN_ANSWER_LIMITS.why_attend + 1),
    expectations: "Talks",
  };
  assert.deepEqual(missingJoinAnswers(answers), ["why_attend"]);
  assert.equal(joinAnswersComplete(answers), false);
  // Exactly at the bound is fine.
  assert.equal(
    joinAnswersComplete({
      ...answers,
      why_attend: "A".repeat(EVENT_JOIN_ANSWER_LIMITS.why_attend),
    }),
    true,
  );
});

test("non-string answers are treated as missing, never as crashes", () => {
  assert.deepEqual(
    missingJoinAnswers({
      why_attend: 42 as unknown as string,
      expectations: null,
    }),
    ["why_attend", "expectations"],
  );
});

// The payload builder is what the join buttons send: answers must be complete
// (or the payload is null and the request must not fire) and trimmed.
test("the payload is null until both answers are complete", () => {
  assert.equal(joinAnswersPayload({ why_attend: "To meet people" }), null);
  const payload = joinAnswersPayload({
    why_attend: " To meet people ",
    expectations: " Talks ",
  });
  assert.deepEqual(payload, {
    why_attend: "To meet people",
    expectations: "Talks",
  });
});
