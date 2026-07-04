import { describe, it, expect } from 'vitest';
import { mockRest } from '../helpers.js';
import { getRepoTrafficViews, getRepoTrafficClones } from '../../src/tools/traffic.js';

describe('getRepoTrafficViews', () => {
  it('maps the daily views array, defaulting a missing array to empty', async () => {
    mockRest('get', '/repos/acme/widgets/traffic/views', { count: 10, uniques: 5 });
    const result = await getRepoTrafficViews({ owner: 'acme', repo: 'widgets' });
    expect(result).toEqual({ count: 10, uniques: 5, daily: [] });
  });

  it('maps a present daily views array', async () => {
    mockRest('get', '/repos/acme/widgets/traffic/views', {
      count: 10,
      uniques: 5,
      views: [{ timestamp: '2026-07-01T00:00:00Z', count: 10, uniques: 5 }],
    });
    const result = await getRepoTrafficViews({ owner: 'acme', repo: 'widgets' });
    expect(result.daily).toEqual([{ timestamp: '2026-07-01T00:00:00Z', count: 10, uniques: 5 }]);
  });
});

describe('getRepoTrafficClones', () => {
  it('maps the daily clones array', async () => {
    mockRest('get', '/repos/acme/widgets/traffic/clones', {
      count: 3,
      uniques: 2,
      clones: [{ timestamp: '2026-07-01T00:00:00Z', count: 3, uniques: 2 }],
    });
    const result = await getRepoTrafficClones({ owner: 'acme', repo: 'widgets' });
    expect(result).toEqual({ count: 3, uniques: 2, daily: [{ timestamp: '2026-07-01T00:00:00Z', count: 3, uniques: 2 }] });
  });
});
