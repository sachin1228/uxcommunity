"use client";

import { FormEvent, useState } from "react";

/**
 * Public deletion-only form for members who cannot sign in (blocked,
 * suspended, or otherwise without a live session). It posts to the credential
 * endpoint and never creates a session.
 */
export default function DeleteAccountPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/account/delete/credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, confirmation }),
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: string; success?: boolean }
        | null;
      if (!response.ok || !data?.success) {
        setError(data?.error ?? "Your account could not be deleted.");
        return;
      }
      setMessage("Your account has been deleted. You can close this page.");
      setEmail("");
      setPassword("");
      setConfirmation("");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-12">
      <h1 className="font-display text-2xl font-semibold text-foreground">
        Delete your account
      </h1>
      <p className="mt-3 text-sm leading-6 text-foreground-muted">
        Use this form if you cannot sign in, including a blocked or suspended
        account. It requires the email and password on the account and the word
        DELETE. Deletion is immediate and cannot be undone; moderation evidence
        is retained as described in the Privacy Policy.
      </p>
      <p className="mt-3 text-sm leading-6 text-foreground-muted">
        You can also email{" "}
        <a className="underline" href="mailto:hello@uxcommunity.in">
          hello@uxcommunity.in
        </a>{" "}
        from the account address if you no longer have the password.
      </p>

      <form className="mt-8 space-y-4" onSubmit={submit}>
        <label className="block text-sm font-medium text-foreground">
          Email
          <input
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="block text-sm font-medium text-foreground">
          Password
          <input
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <label className="block text-sm font-medium text-foreground">
          Type DELETE to confirm
          <input
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            type="text"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />
        </label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {message ? <p className="text-sm text-foreground">{message}</p> : null}
        <button
          className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground disabled:opacity-60"
          type="submit"
          disabled={pending}
        >
          {pending ? "Deleting…" : "Delete my account"}
        </button>
      </form>
    </main>
  );
}
