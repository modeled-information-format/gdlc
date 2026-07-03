import { http, HttpResponse } from 'msw';
import { server } from './setup.js';

export interface GraphQLRequestBody {
  query: string;
  variables: Record<string, unknown>;
}

export function mockGraphQL(resolver: (body: GraphQLRequestBody) => unknown | { __errors: Array<{ message: string }> }): void {
  server.use(
    http.post('https://api.github.com/graphql', async ({ request }) => {
      const body = (await request.json()) as GraphQLRequestBody;
      const result = resolver(body);
      if (result !== null && typeof result === 'object' && '__errors' in result) {
        return HttpResponse.json({ errors: (result as { __errors: Array<{ message: string }> }).__errors });
      }
      return HttpResponse.json({ data: result });
    }),
  );
}

export function mockRest(method: 'get' | 'post' | 'patch' | 'delete', path: string, body: unknown, status = 200): void {
  const handler = http[method](`https://api.github.com${path}`, () => HttpResponse.json(body, { status }));
  server.use(handler);
}
