"use client";

/**
 * Fetch status for the chat's first message page.
 *
 * `error` is set when the bootstrap/first-page hydration actually fails —
 * previously the failure was swallowed and the chat rendered the empty state
 * ("Be the first to say something"), which is indistinguishable from a healthy
 * but message-less community and offered no way to retry.
 */

import { useCallback, useEffect, useState } from "react";

export function useChatLoadError(communityId: string) {
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  // Reset on community change.
  useEffect(() => {
    setError(null);
  }, [communityId]);

  const reportError = useCallback((message: string) => {
    setError(message);
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setRetryToken((token) => token + 1);
  }, []);

  return { error, reportError, retry, retryToken };
}
