"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";

interface ForgotPasswordModalProps {
  open: boolean;
  onClose: () => void;
}

type Step = "form" | "sent";

export function ForgotPasswordModal({ open, onClose }: ForgotPasswordModalProps) {
  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    onClose();
    setTimeout(() => {
      setStep("form");
      setEmail("");
      setError(null);
    }, 300);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      setStep("sent");
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "rounded-md border border-overlay-elevated bg-overlay px-3.5 py-2.5 font-body text-sm text-overlay-foreground outline-none transition-colors placeholder:text-overlay-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 w-full";

  return (
    <Modal open={open} onClose={handleClose} title="Reset your password" maxWidth="max-w-sm">
      {step === "sent" ? (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
            <span className="text-2xl">✉️</span>
          </div>
          <div>
            <p className="font-body text-sm text-overlay-foreground font-medium mb-1">
              Check your inbox
            </p>
            <p className="font-body text-sm text-overlay-muted leading-relaxed">
              If <span className="text-overlay-foreground">{email}</span> is
              registered, a reset link is on its way. It expires in 1 hour.
            </p>
          </div>
          <button
            onClick={handleClose}
            className="mt-2 rounded-md bg-overlay-elevated px-6 py-2.5 font-body text-sm font-medium text-overlay-foreground transition-colors hover:bg-overlay-elevated/80"
          >
            Close
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="font-body text-sm text-overlay-muted -mt-2">
            Enter your email and we'll send you a link to set a new password.
          </p>

          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
              <p className="font-body text-sm text-red-400">{error}</p>
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="font-body text-xs font-medium text-overlay-foreground">
              Email address
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              placeholder="you@studio.com"
              className={inputClass}
              autoComplete="email"
              autoFocus
              required
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading && <Spinner className="h-4 w-4 text-white" />}
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </Modal>
  );
}
