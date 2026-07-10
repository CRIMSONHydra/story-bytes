/**
 * Chapter-management API (M13): list / rename / front-matter toggle / delete / reorder / paste-append
 * + cost estimate, via the shared client.
 */

import { apiGet, apiPost, apiDelete, apiRequest } from './client';

export interface AdminChapter {
  chapterId: string;
  order: number;
  title: string | null;
  isFrontMatter: boolean;
  blockCount: number;
}

export interface AppendEstimate {
  chunks: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
}

export const listChapters = (storyId: string): Promise<{ chapters: AdminChapter[] }> =>
  apiGet(`/api/stories/${storyId}/chapters/manage`);

export const estimateAppend = (storyId: string, text: string): Promise<AppendEstimate> =>
  apiPost(`/api/stories/${storyId}/chapters/estimate`, { text });

export const appendChapter = (
  storyId: string,
  body: { title: string; text: string; isFrontMatter?: boolean },
): Promise<{ chapterId: string; order: number; blocks: number }> =>
  apiPost(`/api/stories/${storyId}/chapters`, body);

export const updateChapter = (
  chapterId: string,
  fields: { title?: string; isFrontMatter?: boolean },
): Promise<AdminChapter> => apiRequest(`/api/chapters/${chapterId}`, { method: 'PATCH', body: fields });

export const deleteChapter = (chapterId: string): Promise<{ deleted: boolean; annotationCount: number }> =>
  apiDelete(`/api/chapters/${chapterId}`);

export const reorderChapters = (storyId: string, order: string[]): Promise<{ reordered: number }> =>
  apiPost(`/api/stories/${storyId}/chapters/reorder`, { order });
