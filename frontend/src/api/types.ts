/**
 * Shared API types (M4). Central home for cross-component response shapes so per-file duplicates can
 * be replaced by these. Mirrors the backend's error envelope and the users/profiles resources.
 */

/** Backend error envelope: `{ error: { code, message, details?, requestId } }`. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface User {
  userId: string;
  displayName: string;
  avatarColor: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserList {
  users: User[];
}
