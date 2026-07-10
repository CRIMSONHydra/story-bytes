/**
 * Users/profiles service (M4). Thin data layer over the `users` table; the app is multi-profile
 * (local switcher) rather than authenticated, so there is no password/session concept here.
 */

import { pool } from '../db/pool';

export interface User {
  userId: string;
  displayName: string;
  avatarColor: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UserRow {
  user_id: string;
  display_name: string;
  avatar_color: string | null;
  created_at: Date;
  updated_at: Date;
}

const mapUser = (r: UserRow): User => ({
  userId: r.user_id,
  displayName: r.display_name,
  avatarColor: r.avatar_color,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const SELECT = 'SELECT user_id, display_name, avatar_color, created_at, updated_at FROM users';

export const listUsers = async (): Promise<User[]> => {
  const { rows } = await pool.query<UserRow>(`${SELECT} ORDER BY created_at`);
  return rows.map(mapUser);
};

export const getUser = async (userId: string): Promise<User | null> => {
  const { rows } = await pool.query<UserRow>(`${SELECT} WHERE user_id = $1`, [userId]);
  return rows[0] ? mapUser(rows[0]) : null;
};

/** Fast existence check for the identity middleware (avoids materializing the row). */
export const userExists = async (userId: string): Promise<boolean> => {
  const { rowCount } = await pool.query('SELECT 1 FROM users WHERE user_id = $1', [userId]);
  return (rowCount ?? 0) > 0;
};

export const createUser = async (displayName: string, avatarColor?: string): Promise<User> => {
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (display_name, avatar_color) VALUES ($1, $2)
     RETURNING user_id, display_name, avatar_color, created_at, updated_at`,
    [displayName, avatarColor ?? null],
  );
  return mapUser(rows[0]);
};

export const updateUser = async (
  userId: string,
  fields: { displayName?: string; avatarColor?: string },
): Promise<User | null> => {
  const { rows } = await pool.query<UserRow>(
    `UPDATE users
     SET display_name = COALESCE($2, display_name),
         avatar_color = COALESCE($3, avatar_color),
         updated_at = NOW()
     WHERE user_id = $1
     RETURNING user_id, display_name, avatar_color, created_at, updated_at`,
    [userId, fields.displayName ?? null, fields.avatarColor ?? null],
  );
  return rows[0] ? mapUser(rows[0]) : null;
};

export const deleteUser = async (userId: string): Promise<boolean> => {
  const { rowCount } = await pool.query('DELETE FROM users WHERE user_id = $1', [userId]);
  return (rowCount ?? 0) > 0;
};
