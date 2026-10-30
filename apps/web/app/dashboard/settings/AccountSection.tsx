"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/ui/Modal";

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
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function closeDeleteDialog() {
    if (deleting) return;
    setDeleteOpen(false);
    setDeletePassword("");
    setDeleteConfirmation("");
    setDeleteError(null);
  }

  async function deleteAccount() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: deletePassword,
          confirmation: deleteConfirmation,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;

      if (!res.ok || !body?.success) {
        setDeleteError(body?.error ?? "Your account could not be deleted. Please try again.");
        return;
      }

      router.replace("/login?account=deleted");
    } catch {
      setDeleteError("Your account could not be deleted. Check your connection and try again.");
    } finally {
      setDeleting(false);
    }
  }

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
        </div>

        {memberSince && (
          <div className="min-w-0">
            <p className="font-body text-xs font-medium text-foreground">Member since</p>
            <p className="mt-1 font-body text-sm text-foreground">{memberSince}</p>
          </div>
        )}

        <div className="border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-body text-xs font-medium text-foreground">Password</p>
              <p className="mt-0.5 font-body text-xs text-foreground-muted">
                Send a reset link to your email.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void sendResetLink()}
              disabled={sending}
              className="modal-btn modal-btn-secondary shrink-0"
            >
              {sending && <Spinner size={13} />}
              {sending ? "Sending…" : "Send reset link"}
            </button>
          </div>
          {message && (
            <p className="mt-2.5 font-body text-xs text-emerald-500" role="status">
              {message}
            </p>
          )}
          {error && (
            <p className="mt-2.5 font-body text-xs text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-body text-xs font-medium text-foreground">Delete account</p>
              <p className="mt-0.5 font-body text-xs text-foreground-muted">
                Permanently remove your account and content.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="modal-btn modal-btn-danger-soft shrink-0"
            >
              Delete account
            </button>
          </div>
        </div>
      </div>

      <Modal open={deleteOpen} onClose={closeDeleteDialog} title="Delete account">
        <div className="flex flex-col gap-4">
          <p className="font-body text-sm leading-relaxed text-foreground-muted">
            This permanently deletes your profile, posts, comments, community
            messages, direct messages (for both participants), applications and
            uploaded files. It cannot be undone.
          </p>

          <label className="flex flex-col gap-1.5">
            <span className="font-body text-xs font-medium text-foreground">
              Your password
            </span>
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              className="field w-full"
              autoComplete="current-password"
              disabled={deleting}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="font-body text-xs font-medium text-foreground">
              Type <span className="font-mono">DELETE</span> to confirm
            </span>
            <input
              type="text"
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              className="field w-full"
              autoComplete="off"
              spellCheck={false}
              disabled={deleting}
            />
          </label>

          {deleteError && (
            <p className="font-body text-xs text-red-400" role="alert">
              {deleteError}
            </p>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDeleteDialog}
              disabled={deleting}
              className="modal-btn modal-btn-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void deleteAccount()}
              disabled={
                deleting || deletePassword.length === 0 || deleteConfirmation !== "DELETE"
              }
              className="modal-btn modal-btn-danger"
            >
              {deleting && <Spinner size={13} />}
              {deleting ? "Deleting…" : "Delete account"}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
