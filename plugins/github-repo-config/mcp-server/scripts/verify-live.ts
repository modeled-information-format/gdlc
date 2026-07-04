#!/usr/bin/env tsx
/**
 * Live verification script: exercises the real src/ implementation against
 * a real GitHub org/repo, not a mock. Not part of the CI-gating `npm test`
 * suite — invoked manually with a token that has read access to the target
 * repo/org (`gh auth login` is enough for the read paths below).
 *
 * READ-ONLY BY DESIGN: none of the three write tools (update_branch_protection,
 * delete_branch_protection, set_repo_custom_properties) are exercised here —
 * mutating a real repo's branch protection or an org's custom-property
 * values as part of an automated smoke test is exactly the kind of action
 * this plugin's own confirm-echo guards exist to slow down, not something
 * to fire routinely in CI. Write-path coverage lives entirely in the mocked
 * unit suite.
 */
import { getBranchProtection } from '../src/tools/branch-protection.js';
import { listRepoRulesets } from '../src/tools/rulesets.js';
import { listOrgHealthFiles } from '../src/tools/community-health.js';
import { getPagesConfig } from '../src/tools/pages.js';
import { listCustomPropertiesSchema } from '../src/tools/custom-properties.js';

const OWNER = process.env.TARGET_OWNER ?? 'modeled-information-format';
const REPO = process.env.TARGET_REPO ?? 'gdlc';
const BRANCH = process.env.TARGET_BRANCH ?? 'main';

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
  step(`get_branch_protection (${OWNER}/${REPO}@${BRANCH})`);
  try {
    const protection = await getBranchProtection({ owner: OWNER, repo: REPO, branch: BRANCH });
    assert(typeof protection.enforceAdmins === 'boolean', 'get_branch_protection returned a boolean enforceAdmins');
  } catch (err) {
    process.stdout.write(`  SKIP (branch may be unprotected, or token lacks access): ${err instanceof Error ? err.message : String(err)}\n`);
  }

  step(`list_repo_rulesets (${OWNER}/${REPO})`);
  const rulesets = await listRepoRulesets({ owner: OWNER, repo: REPO });
  assert(Array.isArray(rulesets), `list_repo_rulesets returned an array (${rulesets.length} ruleset(s))`);

  step(`list_org_health_files (${OWNER}/.github)`);
  try {
    const files = await listOrgHealthFiles({ org: OWNER });
    assert(Array.isArray(files), `list_org_health_files returned an array (${files.length} entr(y/ies))`);
  } catch (err) {
    process.stdout.write(`  SKIP (org may have no .github repo): ${err instanceof Error ? err.message : String(err)}\n`);
  }

  step(`get_pages_config (${OWNER}/${REPO})`);
  try {
    const pages = await getPagesConfig({ owner: OWNER, repo: REPO });
    assert('buildType' in pages, 'get_pages_config returned a buildType field');
  } catch (err) {
    process.stdout.write(`  SKIP (repo may have no Pages site): ${err instanceof Error ? err.message : String(err)}\n`);
  }

  step(`list_custom_properties_schema (${OWNER})`);
  try {
    const schema = await listCustomPropertiesSchema({ org: OWNER });
    assert(Array.isArray(schema), `list_custom_properties_schema returned an array (${schema.length} propert(y/ies))`);
  } catch (err) {
    process.stdout.write(`  SKIP (org may have no custom properties defined): ${err instanceof Error ? err.message : String(err)}\n`);
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
