/** Pure presentation rules for a push received while the app is running. */
export interface PushPresentationInput {
  /** False after sign-out/revocation, even if the OS still delivered the push. */
  signedIn: boolean;
  muted: boolean;
  alreadyReading: boolean;
}

export function shouldPresentPush(input: PushPresentationInput): boolean {
  return input.signedIn && !input.muted && !input.alreadyReading;
}
