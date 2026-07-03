import { beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { resetAuthCacheForTests } from '../src/github-client.js';

export const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  process.env.GITHUB_TOKEN = 'test-token';
  resetAuthCacheForTests();
});
