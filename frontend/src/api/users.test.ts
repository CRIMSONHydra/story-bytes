/**
 * Users API helper tests (M4): correct paths/verbs through the shared client.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchUsers, createUser } from './users';

const stub = (body: unknown) => {
  const fn = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  vi.stubGlobal('fetch', fn);
  return fn;
};

describe('users API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('fetchUsers GETs /api/users', async () => {
    const fn = stub({ users: [] });
    const res = await fetchUsers();
    expect(res).toEqual({ users: [] });
    expect(fn.mock.calls[0][0]).toContain('/api/users');
    expect(fn.mock.calls[0][1].method).toBe('GET');
  });

  it('createUser POSTs the display name', async () => {
    const fn = stub({ userId: 'u1', displayName: 'Bob' });
    const user = await createUser('Bob');
    expect(user).toMatchObject({ userId: 'u1', displayName: 'Bob' });
    const init = fn.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ displayName: 'Bob' }));
  });
});
