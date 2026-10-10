"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { showUndoToast } from "@/lib/undo-toast";
import { applicationStatusLabel, type ApplicationStatus } from "./types";

/** The minimum a row must carry to be decided on — both surfaces pass more. */
interface DecidableApplicant {
  id: string;
  name: string;
  /** The standing the decision is leaving; the undo returns to it. */
  status: ApplicationStatus;
}

/**
 * The poster's triage write, shared by the board's decision cluster and the
 * design view's sidebar: one POST per decision, one undo offer per write
 * (running the opposite write), and the pending/error state a surface needs
 * while it lands.
 *
 * `onApplied` receives the status the database acknowledged — the design
 * view renders from it instantly; the board leaves it out and relies on
 * `router.refresh()`. Callers pass no status of their own into the display:
 * the server's answer is the only value that ever gets shown.
 */
export function useApplicantDecision(jobId: string) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  const decide = useCallback(
    async function decide(
      applicant: DecidableApplicant,
      status: ApplicationStatus,
      onApplied?: (status: ApplicationStatus) => void
    ): Promise<void> {
      setError(null);
      setPendingId(applicant.id);
      try {
        const response = await fetch(`/api/jobs/${jobId}/applications/${applicant.id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(body?.message ?? "The applicant could not be updated.");
        }

        const body = (await response.json().catch(() => null)) as {
          status?: ApplicationStatus;
        } | null;
        const settled = body?.status ?? status;

        showUndoToast({
          message: `“${applicant.name}” moved to ${applicationStatusLabel(settled)}.`,
          actionLabel: "Undo",
          // The undo is the opposite write: the standing to restore is the
          // one this decision left, and the value it flip-flops from is what
          // the database settled on.
          onAction: () => decide({ ...applicant, status: settled }, applicant.status, onApplied),
        });
        onApplied?.(settled);
        router.refresh();
      } catch (cause) {
        setError({
          id: applicant.id,
          message:
            cause instanceof Error ? cause.message : "The applicant could not be updated.",
        });
      } finally {
        setPendingId(null);
      }
    },
    [jobId, router]
  );

  return { decide, pendingId, error };
}
