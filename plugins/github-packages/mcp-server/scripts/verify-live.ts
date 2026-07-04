#!/usr/bin/env tsx
/**
 * Live verification script: exercises the real src/ implementation against
 * a real GitHub org, not a mock. Not part of the CI-gating `npm test` suite
 * — invoked manually. Full coverage needs a token with `read:packages`
 * scope; without it, list_org_packages reports a SKIP rather than crashing
 * the whole script.
 *
 * READ-ONLY BY DESIGN: none of the four write tools (delete_package,
 * delete_package_version, restore_package, restore_package_version) are
 * exercised here — deleting/restoring a real published package as part of
 * an automated smoke test is exactly the kind of action this plugin's own
 * confirm-echo guards exist to slow down. Write-path coverage lives
 * entirely in the mocked unit suite.
 */
import { listOrgPackages, getOrgPackage, listPackageVersions, getPackageVersion, type PackageType } from '../src/tools/packages.js';
import { isPackagesError } from '../src/errors.js';

const ORG = process.env.TARGET_ORG ?? 'modeled-information-format';

/** package_type is required by the real endpoint (verified live: omitting
 * it returns a 422) -- there is no single call that lists every type, so
 * this script loops over every known type and aggregates whatever comes
 * back. */
const PACKAGE_TYPES: PackageType[] = ['npm', 'maven', 'rubygems', 'docker', 'container', 'nuget', 'generic'];

let failed = false;
function assert(condition: boolean, message: string): void {
  if (condition) {
    process.stdout.write(`  OK   ${message}\n`);
  } else {
    failed = true;
    process.stdout.write(`  FAIL ${message}\n`);
  }
}
function step(name: string): void {
  process.stdout.write(`\n=== ${name} ===\n`);
}

/** True only for the specific, expected "token lacks read:packages scope"
 * 403 -- every other error (network failure, 5xx, an unexpected 4xx, a real
 * regression in listOrgPackages) must fail the script, not be waved through
 * as an optimistic scope guess. */
function isMissingPackagesScope(err: unknown): boolean {
  return isPackagesError(err) && err.code === 'github_api_error' && err.details.status === 403 && /read:packages/i.test(err.message);
}

async function main(): Promise<void> {
  step(`list_org_packages (${ORG}, all known types)`);
  const found: Array<{ packageType: PackageType; name: string }> = [];
  for (const packageType of PACKAGE_TYPES) {
    try {
      const packages = await listOrgPackages({ org: ORG, packageType });
      assert(Array.isArray(packages), `list_org_packages(${packageType}) returned an array (${packages.length} package(s))`);
      for (const p of packages) found.push({ packageType, name: p.name });
    } catch (err) {
      if (isMissingPackagesScope(err)) {
        process.stdout.write(`  SKIP list_org_packages(${packageType}) (token lacks read:packages scope): ${err instanceof Error ? err.message : String(err)}\n`);
        break; // every other type would fail identically -- no point repeating 403s
      }
      failed = true;
      process.stdout.write(`  FAIL list_org_packages(${packageType}): ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  const first = found[0];
  if (first === undefined) {
    process.stdout.write('\n=== get_org_package / list_package_versions / get_package_version ===\n  SKIP (org has no packages of any known type to inspect)\n');
  } else {
    const packageType = first.packageType;

    step(`get_org_package (${first.name})`);
    const pkg = await getOrgPackage({ org: ORG, packageType, packageName: first.name });
    assert(pkg.name === first.name, `get_org_package returned the same package (${pkg.name})`);

    step(`list_package_versions (${first.name})`);
    const versions = await listPackageVersions({ org: ORG, packageType, packageName: first.name });
    assert(Array.isArray(versions), `list_package_versions returned an array (${versions.length} version(s))`);

    const firstVersion = versions[0];
    if (firstVersion === undefined) {
      process.stdout.write('\n=== get_package_version ===\n  SKIP (package has no versions)\n');
    } else {
      step(`get_package_version (${first.name}@${firstVersion.id})`);
      const version = await getPackageVersion({ org: ORG, packageType, packageName: first.name, versionId: firstVersion.id });
      assert(version.id === firstVersion.id, `get_package_version returned the same version (${version.id})`);
    }
  }

  if (failed) {
    process.stdout.write('\nverify-live: FAILED\n');
    process.exit(1);
  }
  process.stdout.write('\nverify-live: PASSED\n');
}

main().catch((err: unknown) => {
  process.stderr.write(`verify-live crashed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
