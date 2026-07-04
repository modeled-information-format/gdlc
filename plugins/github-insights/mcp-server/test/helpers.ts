import { http, HttpResponse } from 'msw';
import { server } from './setup.js';

export function mockRest(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body: unknown, status = 200): void {
  const handler = http[method](`https://api.github.com${path}`, () => HttpResponse.json(body, { status }));
  server.use(handler);
}
