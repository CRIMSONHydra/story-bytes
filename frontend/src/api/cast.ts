/**
 * Character cast / image API (M17).
 */

import { API_BASE } from '../config';
import { apiGet, apiPost } from './client';

export interface CastMember {
  entityId: string;
  name: string;
  entityType: string;
  hasImage: boolean;
  imageId: string | null;
}

export interface GenerateResult {
  status: 'ready' | 'blocked' | 'failed';
  imageId?: string;
  cached?: boolean;
  reason?: string;
}

export const listCast = (storyId: string, upToChapter: number, signal?: AbortSignal): Promise<{ cast: CastMember[] }> =>
  apiGet(`/api/stories/${storyId}/cast?upToChapter=${upToChapter}`, signal);

export const generateEntityImage = (storyId: string, entityId: string, upToChapter: number, force = false, signal?: AbortSignal): Promise<GenerateResult> =>
  apiPost(`/api/stories/${storyId}/entities/${entityId}/image?upToChapter=${upToChapter}${force ? '&force=1' : ''}`, undefined, signal);

export const generatedImageUrl = (imageId: string): string => `${API_BASE}/api/generated-images/${imageId}`;
