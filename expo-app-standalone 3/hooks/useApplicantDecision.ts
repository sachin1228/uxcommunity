import { useCallback, useState } from 'react';
import {
  jobErrorMessage,
  setApplicationStatus,
  type ApplicationStatus,
  type JobApplicant,
} from '@/lib/jobs';

/**
 * The poster's triage write, shared by the applicants board and the
 * application viewer: one request per decision, the pending/error state a
 * surface needs while it lands, and the server's acknowledged status as the
 * only value callers display.
 */
export function useApplicantDecision(jobId: string) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  const decide = useCallback(
    async function decide(
      applicant: Pick<JobApplicant, 'id' | 'name'>,
      status: ApplicationStatus,
      onApplied?: (status: ApplicationStatus) => void,
    ): Promise<boolean> {
      setError(null);
      setPendingId(applicant.id);
      try {
        const settled = await setApplicationStatus(jobId, applicant.id, status);
        onApplied?.(settled);
        return true;
      } catch (cause) {
        setError({
          id: applicant.id,
          message: jobErrorMessage(cause, 'The applicant could not be updated.'),
        });
        return false;
      } finally {
        setPendingId(null);
      }
    },
    [jobId],
  );

  return { decide, pendingId, error };
}
