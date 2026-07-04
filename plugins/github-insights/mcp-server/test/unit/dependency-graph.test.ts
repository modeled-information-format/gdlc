import { describe, it, expect } from 'vitest';
import { mockRest } from '../helpers.js';
import { getDependencyGraphSbom } from '../../src/tools/dependency-graph.js';

describe('getDependencyGraphSbom', () => {
  it('maps spdxVersion and package count', async () => {
    mockRest('get', '/repos/acme/widgets/dependency-graph/sbom', {
      sbom: { spdxVersion: 'SPDX-2.3', packages: [{ name: 'left-pad' }, { name: 'is-odd' }] },
    });
    const result = await getDependencyGraphSbom({ owner: 'acme', repo: 'widgets' });
    expect(result).toEqual({ spdxVersion: 'SPDX-2.3', packageCount: 2 });
  });

  it('reports a zero package count for an empty SBOM', async () => {
    mockRest('get', '/repos/acme/widgets/dependency-graph/sbom', { sbom: { spdxVersion: 'SPDX-2.3', packages: [] } });
    const result = await getDependencyGraphSbom({ owner: 'acme', repo: 'widgets' });
    expect(result).toEqual({ spdxVersion: 'SPDX-2.3', packageCount: 0 });
  });
});
