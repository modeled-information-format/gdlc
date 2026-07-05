import { http, HttpResponse } from 'msw';
import { server } from './setup.js';

export function mockRest(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body: unknown, status = 200): void {
  const handler = http[method](`https://api.github.com${path}`, () => HttpResponse.json(body, { status }));
  server.use(handler);
}

export interface GraphQLRequestBody {
  query: string;
  variables: Record<string, unknown>;
}

/** Registers a single GraphQL POST handler for the current test. The
 * supplied resolver inspects the query text / variables of each call (a test
 * may trigger several GraphQL round-trips) and returns the `data` payload,
 * or a `{ __errors }` marker to simulate a GraphQL error array. */
export function mockGraphQL(
  resolver: (body: GraphQLRequestBody) => unknown | { __errors: Array<{ message: string }> },
): void {
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
