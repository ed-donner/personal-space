// Vitest setup. Pulls in jest-dom matchers and makes sure the testing-library
// DOM is wiped between tests so renders don't pile up.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
