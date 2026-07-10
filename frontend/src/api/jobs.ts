/**
 * Ingest job API (M5): submit an upload (async, 202 + jobId) and poll its status/events.
 */

import { API_BASE } from '../config';
import { apiGet, ApiError } from './client';

export interface JobEvent {
  event: string;
  stage?: string;
  message?: string;
  createdAt: string;
}

export interface IngestJob {
  jobId: string;
  filename: string | null;
  status: 'queued' | 'active' | 'completed' | 'failed' | 'cancelled';
  storyId: string | null;
  error: string | null;
}

export interface JobDetail {
  job: IngestJob;
  events: JobEvent[];
}

export interface IngestAccepted {
  jobId: string;
  status: string;
  deduplicated?: boolean;
}

/** Submit an ingest. Multipart, so it uses fetch directly (the JSON client can't encode FormData). */
export const submitIngest = async (file: File, seriesTitle?: string): Promise<IngestAccepted> => {
  const form = new FormData();
  form.append('file', file);
  if (seriesTitle) form.append('seriesTitle', seriesTitle);

  const res = await fetch(`${API_BASE}/api/admin/ingest`, { method: 'POST', body: form });
  const body = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) {
    const message = body?.error?.message ?? `Upload failed (${res.status})`;
    throw new ApiError(res.status, body?.error?.code ?? 'HTTP_ERROR', message);
  }
  return body as IngestAccepted;
};

export const getJob = (jobId: string, signal?: AbortSignal): Promise<JobDetail> =>
  apiGet<JobDetail>(`/api/jobs/${jobId}`, signal);

/** Terminal states — stop polling once reached. */
export const isTerminal = (status: IngestJob['status']): boolean =>
  status === 'completed' || status === 'failed' || status === 'cancelled';
