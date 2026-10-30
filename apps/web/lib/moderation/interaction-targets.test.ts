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
  community: "community",
  job: "job",
};

const LABEL_BY_TYPE: Record<InteractionReportType, string> = {
  thread_comment: "comment",
  showcase_comment: "comment",
  resource_comment: "comment",
  event_comment: "comment",
  community_message: "message",
  profile: "profile",
  community: "community",
  job: "job listing",
};

test("every interaction kind maps to a notification entity", () => {
  for (const type of INTERACTION_REPORT_TYPES) {
    assert.equal(interactionEntityType(type), ENTITY_BY_TYPE[type], type);
  }
});

test("copy names each target family", () => {
  for (const type of INTERACTION_REPORT_TYPES) {
    assert.equal(interactionTargetLabel(type), LABEL_BY_TYPE[type], type);
  }
});

test("only comments and chat messages are deleted from the queue", () => {
  for (const type of INTERACTION_REPORT_TYPES) {
    const expected =
      type !== "profile" && type !== "community" && type !== "job";
    assert.equal(isRemovableInteraction(type), expected, type);
  }
});
