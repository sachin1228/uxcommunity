"use client";

import { useState } from "react";
import { Spinner } from "@/components/ui/Spinner";

interface AccountSectionProps {
  email: string;
  /** Preformatted on the server ("October 2026"); null when unknown. */
  memberSince: string | null;
}

/**
 * Account — who the member is: the email they sign in with, when they joined,
 * and the one action this card can take: asking for a password reset link.
 *
 * Both identity rows are read-only on purpose (the email is the account's
 * anchor and changing it needs a verification flow that does not exist yet),
 * so they are rendered as text, not disabled inputs. The reset button writes
 * nothing itself — it asks the existing rate-limited reset route to send the
 * mail — and reports the server's own message inline.
 */
export function AccountSection({ email, memberSince }: AccountSectionProps) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendResetLink() {
    if (sending) return;
    setSending(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; message?: string; error?: string }
        | null;

      if (!res.ok || !body?.success) {
        setError(body?.message ?? "The reset link could not be sent. Please try again.");
      } else {
        setMessage(body.message ?? "If an account with that email exists, you'll receive a reset link shortly.");
      }
    } catch {
      setError("The reset link could not be sent. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section aria-labelledby="settings-account-heading" className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5">
      <h2 id="settings-account-heading" className="font-display text-[15px] font-semibold text-foreground">
        Account
      </h2>

      <div className="flex flex-col gap-4">
        <div className="min-w-0">
          <p className="font-body text-xs font-medium text-foreground">Email</p>
          <p className="mt-1 truncate font-body text-sm text-foreground" title={email}>
            {email}
          </p>
          <p className="mt-0.5 font-body text-xs text-foreground-muted">
            Used for sign-in and password resets.
          </p>
        </div>

        {memberSince && (
          <div className="min-w-0">
            <p className="font-body text-xs font-medium text-foreground">Member since</p>
            <p className="mt-1 font-body text-sm text-foreground">{memberSince}</p>
          </div>
        )}

        <div className="border-t border-border pt-4">
          <p className="font-body text-xs font-medium text-foreground">Password</p>
          <p className="mt-0.5 font-body text-xs text-foreground-muted">
            Send a reset link to your email.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void sendResetLink()}
              disabled={sending}
              className="modal-btn modal-btn-secondary"
            >
              {sending && <Spinner size={13} />}
              {sending ? "Sending…" : "Send reset link"}
            </button>
            {message && (
              <p className="font-body text-xs text-emerald-500" role="status">
                {message}
              </p>
            )}
            {error && (
              <p className="font-body text-xs text-red-400" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
