import { NextResponse } from "next/server";
import type { ModerationDecision } from "./types";

export function moderationFailureResponse(decision: ModerationDecision): NextResponse {
  const statusCode = 422;
  return NextResponse.json(
    {
      error: decision.status === "review" ? "Content requires moderator review." : "Content violates community guidelines.",
      moderation: {
        status: decision.status,
        allowed: false,
        reason: decision.reason,
        confidence: decision.confidence,
        provider: decision.provider,
      },
    },
    { status: statusCode },
  );
}
