/**
 * Local profile store (M4). The active profile id is persisted in localStorage and sent as the
 * `x-user-id` header by the API client, so reading progress / chat scope follow the selected profile.
 * No auth — this is a local multi-profile switcher.
 */

const STORAGE_KEY = 'story-bytes.userId';

/** The seeded default profile (matches the backend DEFAULT_USER_ID). */
export const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

export const getCurrentUserId = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // localStorage can throw in privacy modes / non-browser contexts
  }
};

export const setCurrentUserId = (userId: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY, userId);
  } catch {
    /* best effort */
  }
};

export const clearCurrentUser = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* best effort */
  }
};

/** The active profile id, falling back to the seeded default when none is selected. */
export const getEffectiveUserId = (): string => getCurrentUserId() ?? DEFAULT_USER_ID;
