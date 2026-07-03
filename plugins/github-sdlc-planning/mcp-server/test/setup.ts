import { beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { resetAuthCacheForTests } from '../src/github-client.js';

export const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  // ghp_-prefixed so assertProjectScope's classic-OAuth-scope path is
  // exercised by default; tests of the App-installation-token skip path set
  // a ghs_-prefixed token explicitly.
  process.env.GITHUB_TOKEN = 'ghp_test-token-1234567890';
  resetAuthCacheForTests();
});
