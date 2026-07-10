/**
 * Users/profiles API calls (M4), typed via the shared client.
 */

import { apiGet, apiPost } from './client';
import type { User, UserList } from './types';

export const fetchUsers = (signal?: AbortSignal): Promise<UserList> =>
  apiGet<UserList>('/api/users', signal);

export const createUser = (displayName: string, avatarColor?: string): Promise<User> =>
  apiPost<User>('/api/users', { displayName, avatarColor });
