/**
 * Profile store tests (M4): localStorage-backed current-profile id + default fallback.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_USER_ID,
  getCurrentUserId,
  setCurrentUserId,
  clearCurrentUser,
  getEffectiveUserId,
} from './user';

describe('profile store', () => {
  afterEach(() => localStorage.clear());

  it('returns null when nothing is stored', () => {
    expect(getCurrentUserId()).toBeNull();
  });

  it('persists and reads back the selected profile', () => {
    setCurrentUserId('abc');
    expect(getCurrentUserId()).toBe('abc');
  });

  it('clears the selection', () => {
    setCurrentUserId('abc');
    clearCurrentUser();
    expect(getCurrentUserId()).toBeNull();
  });

  it('getEffectiveUserId falls back to the default when unset', () => {
    expect(getEffectiveUserId()).toBe(DEFAULT_USER_ID);
    setCurrentUserId('xyz');
    expect(getEffectiveUserId()).toBe('xyz');
  });
});
