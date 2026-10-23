/**
 * A deadline for a single awaited call.
 *
 * Push registration waits on OS and network calls that have no timeout of
 * their own. On an emulator without Play services, or on a network that
 * swallowed the request, such a call never settles — and the coordinator's
 * in-flight slot stays occupied, so every later attempt (a token rotation, a
 * foreground retry, a manual retry in settings) joins a promise that will
 * never resolve. The deadline is what turns that into a recorded failure.
 *
 * The underlying promise is not cancelled (neither RN nor Expo offers one
 * here); it is only stopped from blocking the caller.
 */

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** "timed out after 8s" — one phrasing for every deadline in push setup. */
export function timedOutMessage(timeoutMs: number): string {
  return `timed out after ${timeoutMs / 1000}s`;
}
