import { githubRest, type GithubClientDeps } from '../github-client.js';
import { PackagesError } from '../errors.js';

/** GitHub's package_type path segment. `docker` and `container` are
 * distinct, non-interchangeable values (caught in review): `docker`
 * finds packages on the legacy docker.pkg.github.com registry, while
 * `container` is what the actual GitHub Container Registry (ghcr.io)
 * uses today -- the one most repos actually publish to now. */
export type PackageType = 'npm' | 'maven' | 'rubygems' | 'docker' | 'container' | 'nuget' | 'generic';

export interface ListOrgPackagesInput {
  org: string;
  packageType?: PackageType;
}

export interface PackageSummary {
  id: number;
  name: string;
  packageType: string;
  visibility: string;
  versionCount: number;
}

interface RestPackage {
  id: number;
  name: string;
  package_type: string;
  visibility: string;
  version_count: number;
}

export async function listOrgPackages(input: ListOrgPackagesInput, deps: GithubClientDeps = {}): Promise<PackageSummary[]> {
  const query = input.packageType ? `?package_type=${input.packageType}` : '';
  const data = (await githubRest(`/orgs/${input.org}/packages${query}`, {}, deps)) as RestPackage[];
  return data.map((p) => ({ id: p.id, name: p.name, packageType: p.package_type, visibility: p.visibility, versionCount: p.version_count }));
}

export interface PackageRef {
  org: string;
  packageType: PackageType;
  packageName: string;
}

export async function getOrgPackage(input: PackageRef, deps: GithubClientDeps = {}): Promise<PackageSummary> {
  const data = (await githubRest(
    `/orgs/${input.org}/packages/${input.packageType}/${encodeURIComponent(input.packageName)}`,
    {},
    deps,
  )) as RestPackage;
  return { id: data.id, name: data.name, packageType: data.package_type, visibility: data.visibility, versionCount: data.version_count };
}

export interface PackageVersion {
  id: number;
  name: string;
  createdAt: string;
}

interface RestPackageVersion {
  id: number;
  name: string;
  created_at: string;
}

export async function listPackageVersions(input: PackageRef, deps: GithubClientDeps = {}): Promise<PackageVersion[]> {
  const data = (await githubRest(
    `/orgs/${input.org}/packages/${input.packageType}/${encodeURIComponent(input.packageName)}/versions`,
    {},
    deps,
  )) as RestPackageVersion[];
  return data.map((v) => ({ id: v.id, name: v.name, createdAt: v.created_at }));
}

export interface PackageVersionRef extends PackageRef {
  versionId: number;
}

export async function getPackageVersion(input: PackageVersionRef, deps: GithubClientDeps = {}): Promise<PackageVersion> {
  const data = (await githubRest(
    `/orgs/${input.org}/packages/${input.packageType}/${encodeURIComponent(input.packageName)}/versions/${input.versionId}`,
    {},
    deps,
  )) as RestPackageVersion;
  return { id: data.id, name: data.name, createdAt: data.created_at };
}

/** Every write tool below requires the target name/id twice, under two
 * different field names -- deleting a package or a version is
 * destructive (restorable only within GitHub's ~30-day window, and only
 * if nothing else has since published under the same name/version), a
 * different risk class than this marketplace's read tools. A mismatch
 * is refused before any API call. */
function assertConfirmed(actual: string | number, confirmed: string | number, label: string): void {
  if (actual !== confirmed) {
    throw new PackagesError('confirmation_mismatch', `${label} (${actual}) and its confirm field (${confirmed}) must match to confirm this delete.`, {
      actual,
      confirmed,
    });
  }
}

export interface DeletePackageInput extends PackageRef {
  confirmPackageName: string;
}

export interface DeletePackageResult {
  org: string;
  packageType: PackageType;
  packageName: string;
}

export async function deletePackage(input: DeletePackageInput, deps: GithubClientDeps = {}): Promise<DeletePackageResult> {
  assertConfirmed(input.packageName, input.confirmPackageName, 'packageName');
  await githubRest(
    `/orgs/${input.org}/packages/${input.packageType}/${encodeURIComponent(input.packageName)}`,
    { method: 'DELETE' },
    deps,
  );
  return { org: input.org, packageType: input.packageType, packageName: input.packageName };
}

export interface DeletePackageVersionInput extends PackageVersionRef {
  confirmVersionId: number;
}

export interface DeletePackageVersionResult {
  org: string;
  packageType: PackageType;
  packageName: string;
  versionId: number;
}

export async function deletePackageVersion(input: DeletePackageVersionInput, deps: GithubClientDeps = {}): Promise<DeletePackageVersionResult> {
  assertConfirmed(input.versionId, input.confirmVersionId, 'versionId');
  await githubRest(
    `/orgs/${input.org}/packages/${input.packageType}/${encodeURIComponent(input.packageName)}/versions/${input.versionId}`,
    { method: 'DELETE' },
    deps,
  );
  return { org: input.org, packageType: input.packageType, packageName: input.packageName, versionId: input.versionId };
}

/** Restore is the inverse of delete -- putting something back, not
 * removing it -- so it doesn't carry the same confirm-echo guard.
 * GitHub only allows it within ~30 days of deletion and only if nothing
 * has since republished under the same name/version; a request outside
 * that window surfaces as a plain github_api_error. */
export async function restorePackage(input: PackageRef, deps: GithubClientDeps = {}): Promise<DeletePackageResult> {
  await githubRest(
    `/orgs/${input.org}/packages/${input.packageType}/${encodeURIComponent(input.packageName)}/restore`,
    { method: 'POST' },
    deps,
  );
  return { org: input.org, packageType: input.packageType, packageName: input.packageName };
}

export async function restorePackageVersion(input: PackageVersionRef, deps: GithubClientDeps = {}): Promise<DeletePackageVersionResult> {
  await githubRest(
    `/orgs/${input.org}/packages/${input.packageType}/${encodeURIComponent(input.packageName)}/versions/${input.versionId}/restore`,
    { method: 'POST' },
    deps,
  );
  return { org: input.org, packageType: input.packageType, packageName: input.packageName, versionId: input.versionId };
}
