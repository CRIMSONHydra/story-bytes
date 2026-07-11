/**
 * Fan-theory submission API (M19): paste → async classify (spoiler-scoped) → poll.
 */

import { apiGet, apiPost } from './client';

export interface TheorySubmission {
  submissionId: string;
  status: 'queued' | 'active' | 'completed' | 'failed';
  chunksKept: number | null;
  error: string | null;
  createdAt: string;
}

export const submitTheory = (storyId: string, text: string, sourceUrl?: string): Promise<{ submissionId: string; status: string }> =>
  apiPost(`/api/stories/${storyId}/theories`, sourceUrl ? { text, sourceUrl } : { text });

export const getSubmission = (submissionId: string): Promise<TheorySubmission> =>
  apiGet(`/api/theories/${submissionId}`);

export const isTerminal = (status: TheorySubmission['status']): boolean =>
  status === 'completed' || status === 'failed';
