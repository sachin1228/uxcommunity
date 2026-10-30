import test from "node:test";
import assert from "node:assert/strict";

import {
  DESTRUCTIVE_MODERATION_ACTIONS,
  MAX_SUSPENSION_DAYS,
  MODERATION_ACTION_LABELS,
  SUSPENSION_DAY_OPTIONS,
  actionNeedsSubject,
  allowedModerationActions,
} from "./action-catalog";
import { INTERACTION_REPORT_TYPES } from "../communities/report-reasons";

test("comments and chat messages can be removed and account-actioned", () => {
  for (const type of ["thread_comment", "showcase_comment", "resource_comment", "event_comment", "community_message"] as const) {
    const actions = allowedModerationActions(type);
    assert.deepEqual(actions, [
      "remove",
      "warn_user",
      "suspend_user",
      "ban_user",
      "dismiss",
    ], type);
  }
});

test("profiles are never deleted from the queue", () => {
  assert.deepEqual(allowedModerationActions("profile"), [
    "warn_user",
    "suspend_user",
    "ban_user",
    "dismiss",
  ]);
});

test("communities are hidden, jobs deactivated — never deleted", () => {
  assert.deepEqual(allowedModerationActions("community"), [
    "hide_community",
    "warn_user",
    "suspend_user",
    "ban_user",
    "dismiss",
  ]);
  assert.deepEqual(allowedModerationActions("job"), [
    "deactivate_job",
    "warn_user",
    "suspend_user",
    "ban_user",
    "dismiss",
  ]);
});

test("every target type has a complete, labelled action list", () => {
  for (const type of INTERACTION_REPORT_TYPES) {
    const actions = allowedModerationActions(type);
    assert.equal(new Set(actions).size, actions.length, `${type} has duplicate actions`);
    assert.equal(actions.at(-1), "dismiss", `${type} should end with dismiss`);
    for (const action of actions) {
      assert.ok(MODERATION_ACTION_LABELS[action], `${action} is missing a label`);
    }
  }
});

test("only account actions need a subject", () => {
  assert.equal(actionNeedsSubject("warn_user"), true);
  assert.equal(actionNeedsSubject("suspend_user"), true);
  assert.equal(actionNeedsSubject("ban_user"), true);
  assert.equal(actionNeedsSubject("remove"), false);
  assert.equal(actionNeedsSubject("hide_community"), false);
  assert.equal(actionNeedsSubject("deactivate_job"), false);
  assert.equal(actionNeedsSubject("dismiss"), false);
});

test("destructive actions and suspension bounds are explicit", () => {
  assert.equal(DESTRUCTIVE_MODERATION_ACTIONS.has("remove"), true);
  assert.equal(DESTRUCTIVE_MODERATION_ACTIONS.has("ban_user"), true);
  assert.equal(DESTRUCTIVE_MODERATION_ACTIONS.has("dismiss"), false);
  assert.equal(MAX_SUSPENSION_DAYS, 30);
  assert.deepEqual([...SUSPENSION_DAY_OPTIONS], [1, 3, 7, 14, 30]);
});
