"use client";

import { useCallback } from "react";

export default function TooManyRequestsPage() {
  const retry = useCallback(() => {
    window.location.reload();
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 py-12">
      <section className="w-full max-w-lg rounded-2xl border border-border bg-surface p-8 text-center shadow-card">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft font-mono text-sm font-semibold text-accent">
          429
        </div>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Too many requests
        </h1>
        <p className="mt-3 font-body text-sm leading-6 text-foreground-muted">
          We received a burst of requests from this browser, so we paused it for
          a moment. Please wait a few seconds and try again.
        </p>
        <button
          type="button"
          onClick={retry}
          className="mt-7 inline-flex items-center justify-center rounded-md bg-accent px-5 py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
