import test from "node:test";
import assert from "node:assert/strict";

import { INTERACTION_REPORT_TYPES, type InteractionReportType } from "../communities/report-reasons";
import {
  interactionEntityType,
  interactionTargetLabel,
  isRemovableInteraction,
} from "./interaction-targets";

const ENTITY_BY_TYPE: Record<InteractionReportType, string> = {
  thread_comment: "thread",
  showcase_comment: "showcase",
  resource_comment: "resource",
  event_comment: "event",
  community_message: "message",
  profile: "profile",
};

test("every interaction kind maps to a notification entity", () => {
  for (const type of INTERACTION_REPORT_TYPES) {
    assert.equal(interactionEntityType(type), ENTITY_BY_TYPE[type], type);
  }
});

test("copy names the three target families", () => {
  for (const type of INTERACTION_REPORT_TYPES) {
    const label = interactionTargetLabel(type);
    assert.ok(["comment", "message", "profile"].includes(label), `${type} → ${label}`);
  }
  assert.equal(interactionTargetLabel("thread_comment"), "comment");
  assert.equal(interactionTargetLabel("community_message"), "message");
  assert.equal(interactionTargetLabel("profile"), "profile");
});

test("profiles are the only non-removable interaction target", () => {
  for (const type of INTERACTION_REPORT_TYPES) {
    assert.equal(isRemovableInteraction(type), type !== "profile", type);
  }
});
