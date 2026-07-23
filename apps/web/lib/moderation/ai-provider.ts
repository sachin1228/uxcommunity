import type { ModerationDecision, TextModerationInput } from "./types";

export interface TextModerationProvider {
  readonly name: string;
  moderate(input: TextModerationInput): Promise<Omit<ModerationDecision, "duration_ms"> | null>;
}

export class NoopTextModerationProvider implements TextModerationProvider {
  readonly name = "local-only";

  async moderate(): Promise<null> {
    return null;
  }
}

export function createTextModerationProvider(): TextModerationProvider {
  return new NoopTextModerationProvider();
}
