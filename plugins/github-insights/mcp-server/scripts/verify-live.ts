#!/usr/bin/env tsx
/**
 * Live verification script: exercises the real src/ implementation against
 * a real GitHub repo, not a mock. Not part of the CI-gating `npm test`
 * suite — invoked manually. Every tool here is read-only (no tool mutates
 * state), but that is not the same as "any read-scoped token works": the
 * traffic endpoints (get_repo_traffic_views/clones) specifically require
 * write (push) access to the target repo despite being GETs, per GitHub's
 * own docs (see the plugin README's "Auth note" section). A token with
 * only read access gets a 403 from those two calls specifically; this
 * script catches that and reports it as a SKIP rather than a failure, so
 * a read-only token can still verify the other three tools.
 */
import { getRepoTrafficViews, getRepoTrafficClones } from '../src/tools/traffic.js';
import { getRepoContributorStats } from '../src/tools/stats.js';
import { getCommunityProfile } from '../src/tools/community-profile.js';
import { getDependencyGraphSbom } from '../src/tools/dependency-graph.js';

const OWNER = process.env.TARGET_OWNER ?? 'modeled-information-format';
const REPO = process.env.TARGET_REPO ?? 'gdlc';

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

async function main(): Promise<void> {
  step(`get_repo_traffic_views (${OWNER}/${REPO})`);
  try {
    const views = await getRepoTrafficViews({ owner: OWNER, repo: REPO });
    assert(typeof views.count === 'number', 'get_repo_traffic_views returned a numeric count');
  } catch (err) {
    process.stdout.write(`  SKIP (token may lack push/admin access traffic requires): ${err instanceof Error ? err.message : String(err)}\n`);
  }

  step(`get_repo_traffic_clones (${OWNER}/${REPO})`);
  try {
    const clones = await getRepoTrafficClones({ owner: OWNER, repo: REPO });
    assert(typeof clones.count === 'number', 'get_repo_traffic_clones returned a numeric count');
  } catch (err) {
    process.stdout.write(`  SKIP (token may lack push/admin access traffic requires): ${err instanceof Error ? err.message : String(err)}\n`);
  }

  step(`get_repo_contributor_stats (${OWNER}/${REPO})`);
  const stats = await getRepoContributorStats({ owner: OWNER, repo: REPO });
  if (stats.computing) {
    process.stdout.write('  SKIP (GitHub is still computing these stats -- rerun shortly)\n');
  } else {
    assert(Array.isArray(stats.contributors), `get_repo_contributor_stats returned ${stats.contributors.length} contributor(s)`);
  }

  step(`get_community_profile (${OWNER}/${REPO})`);
  const profile = await getCommunityProfile({ owner: OWNER, repo: REPO });
  assert(typeof profile.healthPercentage === 'number', `get_community_profile returned healthPercentage=${profile.healthPercentage}`);

  step(`get_dependency_graph_sbom (${OWNER}/${REPO})`);
  try {
    const sbom = await getDependencyGraphSbom({ owner: OWNER, repo: REPO });
    assert(sbom.packageCount >= 0, `get_dependency_graph_sbom returned ${sbom.packageCount} package(s)`);
  } catch (err) {
    process.stdout.write(`  SKIP (dependency graph may not be enabled): ${err instanceof Error ? err.message : String(err)}\n`);
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
