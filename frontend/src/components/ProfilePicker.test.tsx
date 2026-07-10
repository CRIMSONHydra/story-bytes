/**
 * ProfilePicker tests (M4): loads profiles, auto-selects the default, switches selection (persisting
 * + notifying), creates a new profile, and surfaces load errors.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/users', () => ({ fetchUsers: vi.fn(), createUser: vi.fn() }));

import { fetchUsers, createUser } from '../api/users';
import { ProfilePicker } from './ProfilePicker';
import { getCurrentUserId, DEFAULT_USER_ID } from '../api/user';
import type { User } from '../api/types';

const user = (id: string, name: string): User => ({
  userId: id, displayName: name, avatarColor: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
});

const mockFetchUsers = vi.mocked(fetchUsers);
const mockCreateUser = vi.mocked(createUser);

describe('ProfilePicker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('lists profiles and auto-selects the seeded default', async () => {
    mockFetchUsers.mockResolvedValue({ users: [user(DEFAULT_USER_ID, 'Default Reader'), user('u2', 'Bob')] });
    render(<ProfilePicker />);
    expect(await screen.findByRole('option', { name: 'Default Reader' })).toBeInTheDocument();
    await waitFor(() => expect(getCurrentUserId()).toBe(DEFAULT_USER_ID));
  });

  it('switching selection persists and notifies', async () => {
    mockFetchUsers.mockResolvedValue({ users: [user(DEFAULT_USER_ID, 'Default Reader'), user('u2', 'Bob')] });
    const onChange = vi.fn();
    render(<ProfilePicker onChange={onChange} />);
    await screen.findByRole('option', { name: 'Bob' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /profile/i }), 'u2');
    expect(getCurrentUserId()).toBe('u2');
    expect(onChange).toHaveBeenCalledWith('u2');
  });

  it('creates a new profile and selects it', async () => {
    mockFetchUsers.mockResolvedValue({ users: [user(DEFAULT_USER_ID, 'Default Reader')] });
    mockCreateUser.mockResolvedValue(user('u3', 'Cleo'));
    render(<ProfilePicker />);
    await screen.findByRole('option', { name: 'Default Reader' });
    await userEvent.click(screen.getByRole('button', { name: /new profile/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /new profile name/i }), 'Cleo');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    await waitFor(() => expect(mockCreateUser).toHaveBeenCalledWith('Cleo'));
    await waitFor(() => expect(getCurrentUserId()).toBe('u3'));
  });

  it('shows an error when profiles fail to load', async () => {
    mockFetchUsers.mockRejectedValue(new Error('boom'));
    render(<ProfilePicker />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load profiles/i);
  });
});
