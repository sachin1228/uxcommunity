import { apiFetch } from './api';
import {
  reportEndpointFor,
  type ReportReason,
  type ReportType,
} from './contentReports';

/**
 * File one report. Resolves when the report was accepted (or was already on
 * file — the API answers 409); rejects with the server's copy otherwise.
 *
 * The network half of `contentReports.ts`: kept apart so the reason/type
 * contract can be imported without React Native's storage layer.
 */
export async function reportContent({
  contentType,
  contentId,
  reason,
  details,
}: {
  contentType: ReportType;
  contentId: string;
  reason: ReportReason;
  details: string;
}): Promise<void> {
  const endpoint = reportEndpointFor(contentType);
  await apiFetch(endpoint, {
    method: 'POST',
    body: {
      content_type: contentType,
      content_id: contentId,
      reason,
      details: details.trim(),
    },
  });
}
