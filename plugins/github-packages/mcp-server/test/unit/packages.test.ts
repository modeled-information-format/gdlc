import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../setup.js';
import { mockRest } from '../helpers.js';
import {
  listOrgPackages,
  getOrgPackage,
  listPackageVersions,
  getPackageVersion,
  deletePackage,
  deletePackageVersion,
  restorePackage,
  restorePackageVersion,
} from '../../src/tools/packages.js';

describe('listOrgPackages', () => {
  it('maps package summaries', async () => {
    mockRest('get', '/orgs/acme/packages', [{ id: 1, name: 'left-pad', package_type: 'npm', visibility: 'public', version_count: 3 }]);
    const result = await listOrgPackages({ org: 'acme', packageType: 'npm' });
    expect(result).toEqual([{ id: 1, name: 'left-pad', packageType: 'npm', visibility: 'public', versionCount: 3 }]);
  });

  it('sends package_type as a required query param', async () => {
    // msw v2 strips query strings before matching a handler's registered
    // path, so a plain mockRest('get', '/orgs/acme/packages?package_type=docker', ...)
    // would "pass" even if listOrgPackages sent no query string at all --
    // it gives false assurance (caught in review). Reading request.url's
    // real searchParams inside the handler is what actually proves the
    // query string was sent. package_type is required by the real
    // endpoint (verified live: omitting it returns a 422), not an
    // optional filter, so every call must send it.
    let observedPackageType: string | null = null;
    server.use(
      http.get('https://api.github.com/orgs/acme/packages', ({ request }) => {
        observedPackageType = new URL(request.url).searchParams.get('package_type');
        return HttpResponse.json([{ id: 2, name: 'api', package_type: 'docker', visibility: 'private', version_count: 5 }]);
      }),
    );
    const result = await listOrgPackages({ org: 'acme', packageType: 'docker' });
    expect(observedPackageType).toBe('docker');
    expect(result).toEqual([{ id: 2, name: 'api', packageType: 'docker', visibility: 'private', versionCount: 5 }]);
  });
});

describe('getOrgPackage', () => {
  it('maps a single package', async () => {
    mockRest('get', '/orgs/acme/packages/npm/left-pad', { id: 1, name: 'left-pad', package_type: 'npm', visibility: 'public', version_count: 3 });
    const result = await getOrgPackage({ org: 'acme', packageType: 'npm', packageName: 'left-pad' });
    expect(result).toEqual({ id: 1, name: 'left-pad', packageType: 'npm', visibility: 'public', versionCount: 3 });
  });

  it('URL-encodes a scoped package name instead of corrupting the request path', async () => {
    let observedPathname = '';
    server.use(
      http.get('https://api.github.com/orgs/acme/*', ({ request }) => {
        observedPathname = new URL(request.url).pathname;
        return HttpResponse.json({ id: 2, name: '@scope/name', package_type: 'npm', visibility: 'private', version_count: 1 });
      }),
    );
    const result = await getOrgPackage({ org: 'acme', packageType: 'npm', packageName: '@scope/name' });
    expect(observedPathname).toBe('/orgs/acme/packages/npm/%40scope%2Fname');
    expect(result).toEqual({ id: 2, name: '@scope/name', packageType: 'npm', visibility: 'private', versionCount: 1 });
  });
});

describe('listPackageVersions', () => {
  it('maps package versions', async () => {
    mockRest('get', '/orgs/acme/packages/npm/left-pad/versions', [{ id: 10, name: '1.0.0', created_at: '2026-07-01T00:00:00Z' }]);
    const result = await listPackageVersions({ org: 'acme', packageType: 'npm', packageName: 'left-pad' });
    expect(result).toEqual([{ id: 10, name: '1.0.0', createdAt: '2026-07-01T00:00:00Z' }]);
  });

  it('URL-encodes a scoped package name instead of corrupting the request path', async () => {
    let observedPathname = '';
    server.use(
      http.get('https://api.github.com/orgs/acme/*', ({ request }) => {
        observedPathname = new URL(request.url).pathname;
        return HttpResponse.json([]);
      }),
    );
    await listPackageVersions({ org: 'acme', packageType: 'npm', packageName: '@scope/name' });
    expect(observedPathname).toBe('/orgs/acme/packages/npm/%40scope%2Fname/versions');
  });
});

describe('getPackageVersion', () => {
  it('maps a single version', async () => {
    mockRest('get', '/orgs/acme/packages/npm/left-pad/versions/10', { id: 10, name: '1.0.0', created_at: '2026-07-01T00:00:00Z' });
    const result = await getPackageVersion({ org: 'acme', packageType: 'npm', packageName: 'left-pad', versionId: 10 });
    expect(result).toEqual({ id: 10, name: '1.0.0', createdAt: '2026-07-01T00:00:00Z' });
  });

  it('URL-encodes a scoped package name instead of corrupting the request path', async () => {
    let observedPathname = '';
    server.use(
      http.get('https://api.github.com/orgs/acme/*', ({ request }) => {
        observedPathname = new URL(request.url).pathname;
        return HttpResponse.json({ id: 10, name: '1.0.0', created_at: '2026-07-01T00:00:00Z' });
      }),
    );
    await getPackageVersion({ org: 'acme', packageType: 'npm', packageName: '@scope/name', versionId: 10 });
    expect(observedPathname).toBe('/orgs/acme/packages/npm/%40scope%2Fname/versions/10');
  });
});

describe('deletePackage', () => {
  it('deletes when packageName and confirmPackageName match', async () => {
    mockRest('delete', '/orgs/acme/packages/npm/left-pad', {}, 204);
    const result = await deletePackage({ org: 'acme', packageType: 'npm', packageName: 'left-pad', confirmPackageName: 'left-pad' });
    expect(result).toEqual({ org: 'acme', packageType: 'npm', packageName: 'left-pad' });
  });

  it('throws confirmation_mismatch before calling the API when they differ', async () => {
    await expect(
      deletePackage({ org: 'acme', packageType: 'npm', packageName: 'left-pad', confirmPackageName: 'is-odd' }),
    ).rejects.toMatchObject({ code: 'confirmation_mismatch', details: { actual: 'left-pad', confirmed: 'is-odd' } });
  });

  it('URL-encodes a scoped package name instead of corrupting the request path', async () => {
    let observedPathname = '';
    server.use(
      http.delete('https://api.github.com/orgs/acme/*', ({ request }) => {
        observedPathname = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await deletePackage({ org: 'acme', packageType: 'npm', packageName: '@scope/name', confirmPackageName: '@scope/name' });
    expect(observedPathname).toBe('/orgs/acme/packages/npm/%40scope%2Fname');
  });
});

describe('deletePackageVersion', () => {
  it('deletes when versionId and confirmVersionId match', async () => {
    mockRest('delete', '/orgs/acme/packages/npm/left-pad/versions/10', {}, 204);
    const result = await deletePackageVersion({ org: 'acme', packageType: 'npm', packageName: 'left-pad', versionId: 10, confirmVersionId: 10 });
    expect(result).toEqual({ org: 'acme', packageType: 'npm', packageName: 'left-pad', versionId: 10 });
  });

  it('throws confirmation_mismatch before calling the API when they differ', async () => {
    await expect(
      deletePackageVersion({ org: 'acme', packageType: 'npm', packageName: 'left-pad', versionId: 10, confirmVersionId: 11 }),
    ).rejects.toMatchObject({ code: 'confirmation_mismatch', details: { actual: 10, confirmed: 11 } });
  });

  it('URL-encodes a scoped package name instead of corrupting the request path', async () => {
    let observedPathname = '';
    server.use(
      http.delete('https://api.github.com/orgs/acme/*', ({ request }) => {
        observedPathname = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await deletePackageVersion({ org: 'acme', packageType: 'npm', packageName: '@scope/name', versionId: 10, confirmVersionId: 10 });
    expect(observedPathname).toBe('/orgs/acme/packages/npm/%40scope%2Fname/versions/10');
  });
});

describe('restorePackage', () => {
  it('restores without requiring a confirm-echo', async () => {
    mockRest('post', '/orgs/acme/packages/npm/left-pad/restore', {}, 204);
    const result = await restorePackage({ org: 'acme', packageType: 'npm', packageName: 'left-pad' });
    expect(result).toEqual({ org: 'acme', packageType: 'npm', packageName: 'left-pad' });
  });

  it('URL-encodes a scoped package name instead of corrupting the request path', async () => {
    let observedPathname = '';
    server.use(
      http.post('https://api.github.com/orgs/acme/*', ({ request }) => {
        observedPathname = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await restorePackage({ org: 'acme', packageType: 'npm', packageName: '@scope/name' });
    expect(observedPathname).toBe('/orgs/acme/packages/npm/%40scope%2Fname/restore');
  });
});

describe('restorePackageVersion', () => {
  it('restores a version without requiring a confirm-echo', async () => {
    mockRest('post', '/orgs/acme/packages/npm/left-pad/versions/10/restore', {}, 204);
    const result = await restorePackageVersion({ org: 'acme', packageType: 'npm', packageName: 'left-pad', versionId: 10 });
    expect(result).toEqual({ org: 'acme', packageType: 'npm', packageName: 'left-pad', versionId: 10 });
  });

  it('URL-encodes a scoped package name instead of corrupting the request path', async () => {
    let observedPathname = '';
    server.use(
      http.post('https://api.github.com/orgs/acme/*', ({ request }) => {
        observedPathname = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await restorePackageVersion({ org: 'acme', packageType: 'npm', packageName: '@scope/name', versionId: 10 });
    expect(observedPathname).toBe('/orgs/acme/packages/npm/%40scope%2Fname/versions/10/restore');
  });
});
