/**
 * ProfilePicker (M4): pick or create the active reading profile. The selection persists to
 * localStorage (via the user store) and flows to the backend as the `x-user-id` header on every API
 * call, so reading progress and chat scope follow the chosen profile. No auth — a local switcher.
 */

import { useEffect, useState } from 'react';
import { fetchUsers, createUser } from '../api/users';
import { getCurrentUserId, setCurrentUserId, DEFAULT_USER_ID } from '../api/user';
import type { User } from '../api/types';
import './ProfilePicker.css';

interface ProfilePickerProps {
  /** Called after the active profile changes (switch or create) so the app can refetch scoped data. */
  onChange?: (userId: string) => void;
}

export function ProfilePicker({ onChange }: ProfilePickerProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [current, setCurrent] = useState<string>(() => getCurrentUserId() ?? DEFAULT_USER_ID);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchUsers()
      .then((data) => {
        if (!active) return;
        setUsers(data.users);
        // Auto-select the seeded default the first time (no stored selection yet).
        if (!getCurrentUserId() && data.users.length > 0) {
          const def = data.users.find((u) => u.userId === DEFAULT_USER_ID) ?? data.users[0];
          setCurrentUserId(def.userId);
          setCurrent(def.userId);
        }
      })
      .catch(() => active && setError('Could not load profiles'));
    return () => {
      active = false;
    };
  }, []);

  const select = (userId: string) => {
    setCurrentUserId(userId);
    setCurrent(userId);
    onChange?.(userId);
  };

  const submitNew = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const user = await createUser(name);
      setUsers((prev) => [...prev, user]);
      setNewName('');
      setCreating(false);
      setError(null);
      select(user.userId);
    } catch {
      setError('Could not create profile');
    }
  };

  return (
    <div className="profile-picker">
      <label className="profile-picker__label" htmlFor="profile-select">
        Profile
      </label>
      <select
        id="profile-select"
        aria-label="Active reading profile"
        className="profile-picker__select"
        value={current}
        onChange={(e) => select(e.target.value)}
      >
        {users.map((u) => (
          <option key={u.userId} value={u.userId}>
            {u.displayName}
          </option>
        ))}
      </select>

      {creating ? (
        <span className="profile-picker__new">
          <input
            aria-label="New profile name"
            className="profile-picker__input"
            value={newName}
            placeholder="Name"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submitNew()}
          />
          <button type="button" onClick={() => void submitNew()}>
            Add
          </button>
          <button type="button" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button type="button" className="profile-picker__add" onClick={() => setCreating(true)}>
          + New profile
        </button>
      )}

      {error && <span className="profile-picker__error" role="alert">{error}</span>}
    </div>
  );
}
