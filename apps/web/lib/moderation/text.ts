import { createTextModerationProvider } from "./ai-provider";
import { moderateWithLocalTextRules } from "./text-rules";
import type { ModerationDecision, TextModerationInput } from "./types";

function combineDecisions(local: ModerationDecision, provider: Omit<ModerationDecision, "duration_ms"> | null): ModerationDecision {
  if (!provider) return local;

  const status =
    local.status === "rejected" || provider.status === "rejected"
      ? "rejected"
      : local.status === "review" || provider.status === "review"
        ? "review"
        : "approved";

  return {
    status,
    allowed: status === "approved",
    reason: [local.reason, provider.reason].filter(Boolean).join(", "),
    provider: `${local.provider}+${provider.provider}`,
    confidence: Math.max(local.confidence, provider.confidence),
    triggered_rules: [...local.triggered_rules, ...provider.triggered_rules],
    scores: { ...local.scores, ...provider.scores },
    duration_ms: local.duration_ms,
  };
}

export async function moderateText(input: TextModerationInput): Promise<ModerationDecision> {
  const start = Date.now();
  const local = moderateWithLocalTextRules(input);
  const provider = createTextModerationProvider();

  let providerDecision: Omit<ModerationDecision, "duration_ms"> | null = null;
  try {
    providerDecision = await provider.moderate(input);
  } catch (error) {
    console.error("[moderation:text-provider]", error);
  }

  const combined = combineDecisions(local, providerDecision);
  return { ...combined, duration_ms: Date.now() - start };
}
