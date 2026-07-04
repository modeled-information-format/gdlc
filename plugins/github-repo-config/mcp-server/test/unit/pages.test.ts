import { describe, it, expect } from 'vitest';
import { mockRest } from '../helpers.js';
import { getPagesConfig } from '../../src/tools/pages.js';

describe('getPagesConfig', () => {
  it('maps a live Pages config', async () => {
    mockRest('get', '/repos/acme/widgets/pages', {
      url: 'https://api.github.com/repos/acme/widgets/pages',
      status: 'built',
      build_type: 'workflow',
      html_url: 'https://acme.github.io/widgets/',
    });
    const result = await getPagesConfig({ owner: 'acme', repo: 'widgets' });
    expect(result).toEqual({
      url: 'https://api.github.com/repos/acme/widgets/pages',
      status: 'built',
      buildType: 'workflow',
      htmlUrl: 'https://acme.github.io/widgets/',
    });
  });

  it('maps a never-built Pages config with null fields', async () => {
    mockRest('get', '/repos/acme/widgets/pages', { url: null, status: null, build_type: 'workflow', html_url: null });
    const result = await getPagesConfig({ owner: 'acme', repo: 'widgets' });
    expect(result).toEqual({ url: null, status: null, buildType: 'workflow', htmlUrl: null });
  });
});
