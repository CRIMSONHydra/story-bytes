/**
 * Vitest + React Testing Library setup (M4). Registers jest-dom matchers and clears the DOM +
 * localStorage between tests so suites don't leak state into each other.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
});
