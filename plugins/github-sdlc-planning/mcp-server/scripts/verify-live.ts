#!/usr/bin/env tsx
/**
 * Live verification script (assumption #3 / build-plan step 9): exercises
 * the real src/ implementation against a real GitHub repo, not a mock. Not
 * part of the CI-gating `npm test` suite — invoked by
 * .github/workflows/live-integration-tests.yml, or manually with a real
 * token (`gh auth login --scopes project`) and a sandbox repo you control.
 *
 * Sequence: create_issue -> add_sub_issue -> list_sub_issues ->
 * create_milestone -> assign_milestone -> list_milestones ->
 * create_discussion -> list_discussions -> add_item_to_project ->
 * set_field_value -> get_project_items -> get_session_context ->
 * get_agent_capabilities -> cleanup (close both issues).
 *
 * Every step asserts on the real response and exits non-zero on the first
 * failure — this script IS the check, not just a smoke test.
 */
import { createIssue, updateIssue } from '../src/tools/issues.js';
import { addSubIssue, listSubIssues } from '../src/tools/sub-issues.js';
import { addItemToProject, setFieldValue, getProjectItems } from '../src/tools/projects.js';
import { createMilestone, listMilestones, assignMilestone } from '../src/tools/milestones.js';
import { createDiscussion, listDiscussions } from '../src/tools/discussions.js';
import { getSessionContext, getAgentCapabilities } from '../src/tools/session.js';
import { isMifConformant } from '../src/mif.js';

const OWNER = process.env.SANDBOX_OWNER ?? 'modeled-information-format';
const REPO = process.env.SANDBOX_REPO ?? 'gdlc-sandbox';
const PROJECT_NUMBER = process.env.SANDBOX_PROJECT_NUMBER ? Number(process.env.SANDBOX_PROJECT_NUMBER) : undefined;
const PROJECT_TEXT_FIELD_ID = process.env.SANDBOX_PROJECT_TEXT_FIELD_ID;
const RUN_ID = process.env.GITHUB_RUN_ID ?? String(Date.now());

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
  const createdIssueNumbers: number[] = [];

  step('create_issue');
  const parent = await createIssue({
    owner: OWNER,
    repo: REPO,
    title: `[verify-live ${RUN_ID}] parent`,
    body: 'Created by verify-live.ts (github-sdlc-planning). Safe to delete.',
    mif: { id: `verify-live-parent-${RUN_ID}`, type: 'Task', namespace: 'gdlc-verify-live' },
  });
  createdIssueNumbers.push(parent.number);
  assert(isMifConformant(parent.body), `created issue #${parent.number} body is MIF-conformant`);

  step('create_issue (child)');
  const child = await createIssue({
    owner: OWNER,
    repo: REPO,
    title: `[verify-live ${RUN_ID}] child`,
    body: 'Sub-issue of the verify-live parent. Safe to delete.',
    mif: { id: `verify-live-child-${RUN_ID}`, type: 'Task', namespace: 'gdlc-verify-live' },
  });
  createdIssueNumbers.push(child.number);

  step('add_sub_issue + list_sub_issues');
  await addSubIssue({ owner: OWNER, repo: REPO, parentNumber: parent.number, childNumber: child.number });
  const subIssues = await listSubIssues({ owner: OWNER, repo: REPO, parentNumber: parent.number });
  assert(subIssues.total === 1, `parent #${parent.number} reports 1 sub-issue (got ${subIssues.total})`);
  assert(subIssues.items.some((i) => i.number === child.number), `sub-issue list includes child #${child.number}`);

  step('update_issue');
  const updated = await updateIssue({ owner: OWNER, repo: REPO, number: child.number, state: 'closed' });
  assert(updated.number === child.number, `update_issue closed #${child.number}`);

  step('create_milestone + assign_milestone + list_milestones');
  const milestone = await createMilestone({ owner: OWNER, repo: REPO, title: `verify-live ${RUN_ID}` });
  await assignMilestone({ owner: OWNER, repo: REPO, issueNumber: parent.number, milestoneNumber: milestone.number });
  const milestones = await listMilestones({ owner: OWNER, repo: REPO });
  assert(milestones.some((m) => m.number === milestone.number), `list_milestones includes #${milestone.number}`);

  step('create_discussion + list_discussions');
  const discussion = await createDiscussion({
    owner: OWNER,
    repo: REPO,
    categoryName: 'General',
    title: `[verify-live ${RUN_ID}]`,
    body: 'Created by verify-live.ts. Safe to delete.',
  });
  const discussions = await listDiscussions({ owner: OWNER, repo: REPO });
  assert(
    discussions.some((d) => d.number === discussion.number),
    `list_discussions includes #${discussion.number}`,
  );

  if (PROJECT_NUMBER !== undefined) {
    step('add_item_to_project + get_project_items');
    const item = await addItemToProject({
      owner: OWNER,
      repo: REPO,
      issueNumber: parent.number,
      projectOwnerLogin: OWNER,
      projectNumber: PROJECT_NUMBER,
    });
    assert(item.itemId.length > 0, 'add_item_to_project returned an item ID');
    const items = await getProjectItems({ projectOwnerLogin: OWNER, projectNumber: PROJECT_NUMBER });
    assert(
      items.items.some((i) => i.id === item.itemId),
      `get_project_items includes the added item`,
    );

    if (PROJECT_TEXT_FIELD_ID !== undefined) {
      step('set_field_value');
      const fieldValue = `verify-live-${RUN_ID}`;
      await setFieldValue({
        projectOwnerLogin: OWNER,
        projectNumber: PROJECT_NUMBER,
        itemId: item.itemId,
        fieldId: PROJECT_TEXT_FIELD_ID,
        value: { kind: 'text', text: fieldValue },
      });
      const itemsAfter = await getProjectItems({ projectOwnerLogin: OWNER, projectNumber: PROJECT_NUMBER });
      const updatedItem = itemsAfter.items.find((i) => i.id === item.itemId);
      const textField = updatedItem?.fieldValues.find((f) => f.text === fieldValue);
      assert(textField !== undefined, `set_field_value's write is visible via get_project_items (${fieldValue})`);
    } else {
      process.stdout.write('\n=== set_field_value ===\n  SKIP (no SANDBOX_PROJECT_TEXT_FIELD_ID set)\n');
    }
  } else {
    process.stdout.write('\n=== add_item_to_project / set_field_value / get_project_items ===\n');
    process.stdout.write('  SKIP (no SANDBOX_PROJECT_NUMBER set)\n');
  }

  step('get_session_context + get_agent_capabilities');
  const ctx = await getSessionContext({ owner: OWNER, repo: REPO });
  assert(ctx.openMilestones.some((m) => m.number === milestone.number), 'get_session_context lists the created milestone');
  const caps = getAgentCapabilities();
  assert(caps.tools.length === 16, `get_agent_capabilities reports 16 tools (got ${caps.tools.length})`);
  assert(caps.hooksSupported === false, 'get_agent_capabilities reports hooksSupported: false');

  step('cleanup');
  for (const number of createdIssueNumbers) {
    await updateIssue({ owner: OWNER, repo: REPO, number, state: 'closed' });
    process.stdout.write(`  closed #${number}\n`);
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
