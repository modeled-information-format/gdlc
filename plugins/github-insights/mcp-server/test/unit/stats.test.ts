import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../setup.js';
import { mockRest } from '../helpers.js';
import { getRepoContributorStats } from '../../src/tools/stats.js';

describe('getRepoContributorStats', () => {
  it('maps contributor totals when stats are already computed', async () => {
    mockRest('get', '/repos/acme/widgets/stats/contributors', [
      { author: { login: 'octocat' }, total: 42 },
      { author: null, total: 3 },
    ]);
    const result = await getRepoContributorStats({ owner: 'acme', repo: 'widgets' });
    expect(result).toEqual({
      computing: false,
      contributors: [
        { login: 'octocat', total: 42 },
        { login: null, total: 3 },
      ],
    });
  });

  it('reports computing: true on a 202 with an empty body, not zero contributors', async () => {
    server.use(http.get('https://api.github.com/repos/acme/widgets/stats/contributors', () => new HttpResponse(null, { status: 202 })));
    const result = await getRepoContributorStats({ owner: 'acme', repo: 'widgets' });
    expect(result).toEqual({ computing: true, contributors: [] });
  });
});
