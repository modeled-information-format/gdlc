import { describe, it, expect } from 'vitest';
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
    const result = await listOrgPackages({ org: 'acme' });
    expect(result).toEqual([{ id: 1, name: 'left-pad', packageType: 'npm', visibility: 'public', versionCount: 3 }]);
  });

  it('filters by package type via query string', async () => {
    mockRest('get', '/orgs/acme/packages?package_type=docker', [{ id: 2, name: 'api', package_type: 'docker', visibility: 'private', version_count: 5 }]);
    const result = await listOrgPackages({ org: 'acme', packageType: 'docker' });
    expect(result).toEqual([{ id: 2, name: 'api', packageType: 'docker', visibility: 'private', versionCount: 5 }]);
  });
});

describe('getOrgPackage', () => {
  it('maps a single package', async () => {
    mockRest('get', '/orgs/acme/packages/npm/left-pad', { id: 1, name: 'left-pad', package_type: 'npm', visibility: 'public', version_count: 3 });
    const result = await getOrgPackage({ org: 'acme', packageType: 'npm', packageName: 'left-pad' });
    expect(result).toEqual({ id: 1, name: 'left-pad', packageType: 'npm', visibility: 'public', versionCount: 3 });
  });
});

describe('listPackageVersions', () => {
  it('maps package versions', async () => {
    mockRest('get', '/orgs/acme/packages/npm/left-pad/versions', [{ id: 10, name: '1.0.0', created_at: '2026-07-01T00:00:00Z' }]);
    const result = await listPackageVersions({ org: 'acme', packageType: 'npm', packageName: 'left-pad' });
    expect(result).toEqual([{ id: 10, name: '1.0.0', createdAt: '2026-07-01T00:00:00Z' }]);
  });
});

describe('getPackageVersion', () => {
  it('maps a single version', async () => {
    mockRest('get', '/orgs/acme/packages/npm/left-pad/versions/10', { id: 10, name: '1.0.0', created_at: '2026-07-01T00:00:00Z' });
    const result = await getPackageVersion({ org: 'acme', packageType: 'npm', packageName: 'left-pad', versionId: 10 });
    expect(result).toEqual({ id: 10, name: '1.0.0', createdAt: '2026-07-01T00:00:00Z' });
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
});

describe('restorePackage', () => {
  it('restores without requiring a confirm-echo', async () => {
    mockRest('post', '/orgs/acme/packages/npm/left-pad/restore', {}, 204);
    const result = await restorePackage({ org: 'acme', packageType: 'npm', packageName: 'left-pad' });
    expect(result).toEqual({ org: 'acme', packageType: 'npm', packageName: 'left-pad' });
  });
});

describe('restorePackageVersion', () => {
  it('restores a version without requiring a confirm-echo', async () => {
    mockRest('post', '/orgs/acme/packages/npm/left-pad/versions/10/restore', {}, 204);
    const result = await restorePackageVersion({ org: 'acme', packageType: 'npm', packageName: 'left-pad', versionId: 10 });
    expect(result).toEqual({ org: 'acme', packageType: 'npm', packageName: 'left-pad', versionId: 10 });
  });
});
