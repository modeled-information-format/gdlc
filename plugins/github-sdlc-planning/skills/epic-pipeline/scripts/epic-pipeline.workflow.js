export const meta = {
  name: 'epic-pipeline',
  description: 'Epic pipeline orchestration: plan mode grounds a seed and decomposes it into an Epic/Story/Task hierarchy; execute mode implements Tasks sequentially on one shared branch, delivers one PR, and settles it with one Copilot round. Never merges.',
  phases: [
    { title: 'Ground', detail: 'read the seed, search existing coverage, read branch protection' },
    { title: 'Decompose', detail: 'Epic/Story/Task hierarchy, board placement, milestone, build order' },
    { title: 'Implement', detail: 'sequential per-Task agents on one shared branch' },
    { title: 'Deliver', detail: 'gates, one PR, classify, board, linkage, Copilot request' },
    { title: 'Settle', detail: 'findings fixed, threads resolved, readiness settled' },
  ],
}

// args (plan):    { mode: 'plan', owner, repo, seed }
// args (execute): { mode: 'execute', owner, repo, epicNumber,
//                   tasks: [{number, title, notes?}] in build order,
//                   requiredChecks: [], requestCopilot: bool }
// The launching skill (SKILL.md) resolves every value interactively BEFORE
// either launch — this script runs in the background and can ask nothing.
// Anything the old inline pipeline would have asked mid-flight comes back
// in plan mode's `deferred` list for the skill to surface.
if (typeof args === 'undefined' || !args || (args.mode !== 'plan' && args.mode !== 'execute')) {
  throw new Error("epic-pipeline requires args.mode of 'plan' or 'execute' — the launching skill resolves this before starting the workflow")
}
if (typeof args.owner !== 'string' || !args.owner || typeof args.repo !== 'string' || !args.repo) {
  throw new Error('epic-pipeline requires args.owner and args.repo — resolve the target repo in the skill, never inside the workflow')
}
const mode = args.mode
const owner = args.owner
const repo = args.repo
const repoFull = `${owner}/${repo}`

const SHARED_RULES = `
Ground rules (non-negotiable, they override any habit):
- Compose the github-sdlc-plugins MCP tools (load via ToolSearch:
  create_issue, update_issue, add_sub_issue, list_sub_issues,
  add_item_to_project, set_field_value, get_project_items, list_milestones,
  assign_milestone, create_pull_request, classify_pull_request,
  add_pull_request_to_project, get_linked_issues, check_pr_readiness,
  request_review, list_review_requests, get_branch_protection,
  search_similar_issues, set_lifecycle_state). Hand-rolled gh api graphql
  is acceptable ONLY where no plugin tool covers the operation (e.g. the
  resolveReviewThread mutation).
- Never gh pr create / curl for PR creation; use create_pull_request.
- PR-to-issue linkage is read with get_linked_issues (ADR-0002), never by
  hand-parsing "Closes #N" text.
- Move an issue's board Status forward WITH a comment at each transition,
  and read the current Status before writing — native Projects v2
  automations (ADR-0003) may already have moved it, and a blind overwrite
  races them. add_item_to_project is idempotent; call it unconditionally.
- Never add an AI-attribution trailer to any commit, PR, issue, or comment.
- Never force-push. Never merge, delete a branch, or skip hooks/CI —
  merging is ALWAYS outside this workflow, behind the user's own approval.
- Your final text is data for an orchestrator, not a human message.`

// ------------------------------------------------------------------ plan
if (mode === 'plan') {
  if (typeof args.seed !== 'string' || args.seed.trim() === '') {
    throw new Error('plan mode requires args.seed (issue number/URL, plan-doc summary, or free-text goal)')
  }
  const seed = args.seed.trim()

  const GROUND_SCHEMA = {
    type: 'object',
    required: ['summary', 'existingCoverage', 'requiredChecks', 'protectionNotes'],
    properties: {
      summary: { type: 'string', description: 'what is already true vs genuinely missing for this seed' },
      existingCoverage: {
        type: 'array',
        items: {
          type: 'object',
          required: ['number', 'title', 'relation'],
          properties: {
            number: { type: 'integer' },
            title: { type: 'string' },
            relation: { type: 'string', description: 'duplicate / partial-overlap / related-context' },
          },
        },
      },
      requiredChecks: { type: 'array', items: { type: 'string' } },
      protectionNotes: { type: 'string', description: 'enforceAdmins/review-count plus anything unusually permissive, for the user to judge' },
    },
  }

  const DECOMPOSE_SCHEMA = {
    type: 'object',
    required: ['ok', 'epic', 'children', 'buildOrder', 'milestone', 'deferred', 'notes'],
    properties: {
      ok: { type: 'boolean' },
      epic: {
        type: 'object',
        required: ['number', 'url', 'title', 'preexisting'],
        properties: {
          number: { type: 'integer' },
          url: { type: 'string' },
          title: { type: 'string' },
          preexisting: { type: 'boolean', description: 'true when the seed already was this Epic and it was extended, not created' },
        },
      },
      children: {
        type: 'array',
        items: {
          type: 'object',
          required: ['number', 'title', 'kind', 'status'],
          properties: {
            number: { type: 'integer' },
            title: { type: 'string' },
            kind: { type: 'string', enum: ['Story', 'Task'] },
            parent: { type: ['integer', 'null'], description: 'Story number a Task hangs under, null when directly under the Epic' },
            status: { type: 'string', description: 'the board Status the item ended at' },
          },
        },
      },
      buildOrder: { type: 'array', items: { type: 'integer' }, description: 'Task numbers in implementation order, as noted in the Epic body' },
      milestone: {
        type: 'object',
        required: ['assigned', 'reason'],
        properties: {
          assigned: { type: 'boolean' },
          number: { type: ['integer', 'null'] },
          reason: { type: 'string', description: 'which milestone and why, or why none fit — never silently blank' },
        },
      },
      deferred: {
        type: 'array',
        description: 'everything the inline pipeline would have asked the user mid-flight; the skill surfaces these after the run',
        items: {
          type: 'object',
          required: ['kind', 'detail'],
          properties: {
            kind: { type: 'string', description: 'e.g. no-milestone-fits, design-question-discussion-offer, scope-ambiguity' },
            detail: { type: 'string' },
          },
        },
      },
      notes: { type: 'string' },
    },
  }

  phase('Ground')
  log(`plan mode: grounding seed in ${repoFull}`)
  const grounding = await agent(
    `Ground an epic-pipeline plan for ${repoFull}. Seed: ${seed}
${SHARED_RULES}

1. Resolve the seed: an issue number/URL (read its full body, labels, type,
   comments, and list_sub_issues for any hierarchy already present), a
   plan/design-doc summary, or a free-text goal. Read the related code and
   docs in the repo far enough to know what is already true vs genuinely
   missing — never invent scope the seed doesn't support.
2. Search for existing coverage: gh issue list --search on the seed's key
   terms; search_similar_issues too when the goal reads like a defect
   rather than new work.
3. Read get_branch_protection for the repo's default branch. Report its
   required status checks verbatim (execute mode needs to know what
   "green" means before opening a PR) and note enforceAdmins/review-count
   plus anything unusually permissive.

Return summary, existingCoverage, requiredChecks, protectionNotes.`,
    { label: 'ground', phase: 'Ground', schema: GROUND_SCHEMA },
  )
  if (!grounding) {
    return { mode, ok: false, repo: repoFull, seed, grounding: null, hierarchy: null, requiredChecks: [], deferred: [], summary: 'grounding agent returned no result' }
  }

  phase('Decompose')
  const decomposed = await agent(
    `Decompose this seed into a native Epic/Story/Task hierarchy in ${repoFull}.
Seed: ${seed}
Grounding summary: ${grounding.summary}
Existing coverage to avoid duplicating: ${JSON.stringify(grounding.existingCoverage)}
${SHARED_RULES}

1. Use the epic-decomposition skill (Skill tool:
   github-sdlc-planning:epic-decomposition) for the actual issue tree: one
   Epic, Stories under it, Tasks under each Story, all via native
   add_sub_issue — never a hand-written checklist. If the seed already IS
   an Epic, extend it rather than creating a duplicate parent. Respect the
   100-children/8-levels limits; if hit, stop and report via deferred.
2. For every issue created: add_item_to_project (idempotent — call it
   unconditionally), then read the returned item's Status and set the
   board's backlog-equivalent ONLY if it's unset (native auto-add may have
   already set it). Always set the Kind/Type field — no native automation
   covers that one.
3. list_milestones; assign_milestone if the goal maps to one already open.
   If none fits, say so in milestone.reason AND add a no-milestone-fits
   entry to deferred — never guess or leave it silently blank.
4. If the seed carries a genuine open design question (not an
   implementation detail), do NOT create a Discussion — add a
   design-question-discussion-offer entry to deferred; a Discussion is for
   human deliberation the pipeline must not pre-empt.
5. Note the build order in the Epic's body as an ordered list of sub-issue
   references (sub-issues carry no ordering field).

Return ok, epic, children, buildOrder, milestone, deferred, notes.`,
    { label: 'decompose', phase: 'Decompose', schema: DECOMPOSE_SCHEMA },
  )
  if (!decomposed) {
    return { mode, ok: false, repo: repoFull, seed, grounding, hierarchy: null, requiredChecks: grounding.requiredChecks, deferred: [], summary: 'decompose agent returned no result' }
  }

  log(`hierarchy: Epic #${decomposed.epic.number} with ${decomposed.children.length} children, ${decomposed.deferred.length} deferred question(s)`)
  return {
    mode,
    ok: decomposed.ok,
    repo: repoFull,
    seed,
    grounding,
    hierarchy: { epic: decomposed.epic, children: decomposed.children, buildOrder: decomposed.buildOrder, milestone: decomposed.milestone },
    requiredChecks: grounding.requiredChecks,
    deferred: decomposed.deferred,
    summary: decomposed.notes,
  }
}

// --------------------------------------------------------------- execute
if (!Number.isInteger(args.epicNumber)) {
  throw new Error('execute mode requires args.epicNumber')
}
if (!Array.isArray(args.tasks) || args.tasks.length === 0) {
  throw new Error('execute mode requires args.tasks (build-order list of {number, title}) — pass the plan-mode hierarchy through')
}
for (const t of args.tasks) {
  if (!t || !Number.isInteger(t.number) || typeof t.title !== 'string' || t.title.trim() === '') {
    throw new Error('execute mode: every args.tasks entry needs an integer number and a non-empty string title')
  }
  if (t.notes !== undefined && typeof t.notes !== 'string') {
    throw new Error(`execute mode: args.tasks entry #${t.number} has a non-string notes field`)
  }
}
const epicNumber = args.epicNumber
const tasks = args.tasks
const requiredChecks = Array.isArray(args.requiredChecks) ? args.requiredChecks : []
const requestCopilot = args.requestCopilot === true

const PREPARE_SCHEMA = {
  type: 'object',
  required: ['ok', 'worktreePath', 'branch', 'notes'],
  properties: {
    ok: { type: 'boolean' },
    worktreePath: { type: ['string', 'null'] },
    branch: { type: ['string', 'null'] },
    notes: { type: 'string' },
  },
}

const TASK_SCHEMA = {
  type: 'object',
  required: ['ok', 'taskNumber', 'bugsFiled', 'unplannedIssues', 'notes'],
  properties: {
    ok: { type: 'boolean' },
    taskNumber: { type: 'integer' },
    bugsFiled: { type: 'array', items: { type: 'integer' } },
    unplannedIssues: { type: 'array', items: { type: 'integer' } },
    notes: { type: 'string', description: 'what landed, or exactly why the Task could not be completed and what board state it was left in' },
  },
}

const DELIVER_SCHEMA = {
  type: 'object',
  required: ['ok', 'prNumber', 'prUrl', 'labels', 'linked', 'skippedCrossRepo', 'copilotRequested', 'notes'],
  properties: {
    ok: { type: 'boolean' },
    prNumber: { type: ['integer', 'null'] },
    prUrl: { type: ['string', 'null'] },
    labels: { type: 'array', items: { type: 'string' } },
    linked: { type: 'array', items: { type: 'integer' } },
    skippedCrossRepo: { type: 'array', items: { type: 'string' } },
    copilotRequested: { type: 'boolean' },
    notes: { type: 'string' },
  },
}

const SETTLE_SCHEMA = {
  type: 'object',
  required: ['settled', 'copilotReviewed', 'threadsResolved', 'notes'],
  properties: {
    settled: { type: 'boolean' },
    copilotReviewed: { type: 'boolean' },
    threadsResolved: { type: 'boolean' },
    notes: { type: 'string', description: 'the final check_pr_readiness verdict, or exactly why it never settled' },
  },
}

phase('Implement')
log(`execute mode: Epic #${epicNumber} in ${repoFull}, ${tasks.length} Task(s) in build order, requestCopilot=${requestCopilot}`)

const prepared = await agent(
  `Prepare the ONE shared feature branch for Epic #${epicNumber} in ${repoFull}.
${SHARED_RULES}

Locate or clone ${repoFull} locally. NEVER work in a checkout that has
uncommitted changes — create an isolated temporary git worktree on a new
branch (name it after the Epic, e.g. feat/epic-${epicNumber}) off a FRESHLY
FETCHED origin default branch (git fetch origin first; verify the ref with
git ls-remote --heads). Every Task in this run lands on THIS branch — a
stacked or per-Task base only re-targets when its parent merges, and
merging a non-default base closes nothing.

Return ok, the absolute worktreePath, the branch name, and notes.`,
  { label: 'prepare-branch', phase: 'Implement', schema: PREPARE_SCHEMA },
)
if (!prepared || !prepared.ok || !prepared.worktreePath) {
  return { mode, ok: false, repo: repoFull, epicNumber, branch: null, tasksCompleted: [], tasksSkipped: tasks.map((t) => t.number), taskResults: [], bugsFiled: [], unplannedIssues: [], pr: null, settle: null, summary: `branch preparation failed: ${(prepared && prepared.notes) || 'prepare agent returned no result'}` }
}

// Sequential by design: Tasks execute in build order on one shared branch,
// each agent seeing its predecessors' commits. This is the deterministic
// control flow the old prose loop encoded — not a fan-out.
const taskResults = []
let implementationHalted = false
for (const task of tasks) {
  if (implementationHalted) break
  const result = await agent(
    `Implement Task #${task.number} ("${task.title}") of Epic #${epicNumber} in ${repoFull}.
Work in the EXISTING shared worktree at ${prepared.worktreePath} on branch
${prepared.branch} — never create another branch or worktree. Earlier Tasks
in this Epic have already committed here; build on their state.
${task.notes ? `Build-order notes: ${task.notes}` : ''}
${SHARED_RULES}

1. Read the Task issue in full. Comment that work is starting and move its
   board Status to the in-progress option (read Status first — the
   set-in-progress hook may already have flipped it on hosts where it is
   wired; comment either way, never a silent flip).
2. Implement the Task following the repo's own CLAUDE.md/conventions. Add
   or extend tests so the change is covered.
3. Run the repo's targeted local gates for what you touched; fix failures.
4. A defect discovered mid-implementation goes through the file-bug skill
   (github-bug-capture:file-bug), never a hand-rolled create_issue; if you
   also fix it before finishing, advance it with set_lifecycle_state.
   Necessary work the plan didn't cover gets its own create_issue
   (mif.type set appropriately) + add_item_to_project + Kind field,
   sub-issue- or relates-to-linked back — never only a commit comment.
5. Commit on the shared branch (conventional style matching the repo's
   history). Do NOT push and do NOT open a PR — a later stage delivers the
   whole branch at once.
6. If the Task genuinely cannot be completed (missing decision, broken
   precondition), stop: comment on the issue with exactly what is missing,
   leave its Status accurate, and return ok=false with that reason.

Return ok, taskNumber, bugsFiled, unplannedIssues, notes.`,
    { label: `task:#${task.number}`, phase: 'Implement', schema: TASK_SCHEMA },
  )
  taskResults.push(result || { ok: false, taskNumber: task.number, bugsFiled: [], unplannedIssues: [], notes: 'task agent returned no result' })
  if (!result || !result.ok) {
    // Later Tasks may depend on this one — halt the line rather than
    // building on a hole, and report the remainder as skipped.
    implementationHalted = true
    log(`Task #${task.number} did not complete — halting the build-order line`)
  } else {
    log(`Task #${task.number} done (${taskResults.length}/${tasks.length})`)
  }
}

const tasksCompleted = taskResults.filter((r) => r.ok).map((r) => r.taskNumber)
// Every Task not completed — whether never attempted (loop halted before it)
// or attempted-and-failed — belongs in the "not delivered" accounting, so
// completed + skipped always reconciles to the full task list. taskResults
// still preserves the attempted-vs-untried distinction for callers that want it.
const tasksSkipped = tasks.map((t) => t.number).filter((n) => !tasksCompleted.includes(n))
const bugsFiled = taskResults.flatMap((r) => r.bugsFiled || [])
const unplannedIssues = taskResults.flatMap((r) => r.unplannedIssues || [])

if (tasksCompleted.length === 0) {
  return { mode, ok: false, repo: repoFull, epicNumber, branch: prepared.branch, tasksCompleted, tasksSkipped, taskResults, bugsFiled, unplannedIssues, pr: null, settle: null, summary: 'no Task completed — nothing to deliver' }
}

phase('Deliver')
const delivered = await agent(
  `Deliver the shared branch ${prepared.branch} (worktree ${prepared.worktreePath}) for Epic #${epicNumber} in ${repoFull} as ONE pull request.
Completed Tasks to close: ${tasksCompleted.map((n) => `#${n}`).join(', ')}
${tasksSkipped.length > 0 ? `Tasks NOT completed (do not claim them): ${tasksSkipped.map((n) => `#${n}`).join(', ')}` : ''}
Required status checks on the default branch (what "green" means): ${JSON.stringify(requiredChecks)}
${SHARED_RULES}

1. Run the repo's FULL local gates in the worktree; cross-check against the
   required-checks list above so no CI check is a surprise. Fix failures.
2. Push the branch. Open ONE PR via create_pull_request (never
   gh pr create), body carrying "Closes #N" for every completed Task —
   only the completed ones. Do NOT open it as draft${requestCopilot ? ' (Copilot only fires on non-draft PRs)' : ''}.
3. classify_pull_request (type/size/risk labels) and
   add_pull_request_to_project.
4. get_linked_issues to confirm — not assume — which Tasks the PR's
   closingIssuesReferences actually resolved (it retries; linkage populates
   asynchronously). Report skippedCrossRepo entries verbatim.
5. Move every linked Task's/Story's Status to In Review with a comment,
   only where it isn't already there.
${requestCopilot ? `6. Request a Copilot review via request_review (reviewers: ["Copilot"]) and
   verify it registered with list_review_requests — the call can silently
   no-op; retry once if it did, then stop either way.` : '6. Do NOT request a Copilot review — the user declined one for this run.'}
7. Remove the temporary worktree (the branch lives on the remote now). Do
   NOT merge.

Return ok, prNumber, prUrl, labels, linked, skippedCrossRepo,
copilotRequested, notes.`,
  { label: 'deliver-pr', phase: 'Deliver', schema: DELIVER_SCHEMA },
)
if (!delivered || !delivered.ok || !delivered.prNumber) {
  return { mode, ok: false, repo: repoFull, epicNumber, branch: prepared.branch, tasksCompleted, tasksSkipped, taskResults, bugsFiled, unplannedIssues, pr: delivered || null, settle: null, summary: `delivery failed: ${(delivered && delivered.notes) || 'deliver agent returned no result'}` }
}
log(`PR #${delivered.prNumber} open (${delivered.prUrl})`)

phase('Settle')
const settle = await agent(
  `Settle PR ${repoFull}#${delivered.prNumber} (${delivered.prUrl}): ${requestCopilot ? 'one Copilot review round, ' : ''}every thread resolved, all checks green.
${SHARED_RULES}

${requestCopilot ? `HARD CAP: exactly ONE Copilot review round for this PR, ever. The request
was already made at delivery — do not request another, even after pushing
fixes.

1. Wait for the review to land AGAINST THE PR'S CURRENT HEAD SHA: poll
   check_pr_readiness on a bounded backoff — start at 60s between polls,
   give up after ~20 minutes of no review while checks are otherwise done.
   "Requested" is not "reviewed"; "reviewed" is not "resolved".
2. Fix every finding: apply the change in an isolated temporary worktree on
   the PR branch, re-run affected local gates, push. Then resolve EVERY
   review thread via the resolveReviewThread GraphQL mutation (no plugin
   tool covers it) — a pushed fix does not resolve a thread by itself. If a
   finding is genuinely wrong, reply tersely with the concrete reason and
   resolve the thread; never ignore one.
3. Keep polling check_pr_readiness until settled: true (its verdict
   combines checks, review state, thread resolution, and code-scanning
   alerts). Never declare settled from CI status alone.` : `1. Poll check_pr_readiness on a bounded backoff (start at 60s, give up
   after ~20 minutes of no movement) until settled: true, fixing any check
   failures on the PR branch as they surface (isolated temporary worktree,
   re-run affected gates, push).`}
4. Do NOT merge — merging is the user's own decision, outside this
   workflow entirely.

Return settled, copilotReviewed, threadsResolved, notes (the final
readiness verdict, or exactly why it never settled).`,
  { label: `settle:#${delivered.prNumber}`, phase: 'Settle', schema: SETTLE_SCHEMA },
)

const settleResult = settle || { settled: false, copilotReviewed: false, threadsResolved: false, notes: 'settle agent returned no result' }
log(`settled=${settleResult.settled} for PR #${delivered.prNumber}`)

return {
  mode,
  ok: settleResult.settled,
  repo: repoFull,
  epicNumber,
  branch: prepared.branch,
  tasksCompleted,
  tasksSkipped,
  taskResults,
  bugsFiled,
  unplannedIssues,
  pr: { number: delivered.prNumber, url: delivered.prUrl, labels: delivered.labels, linked: delivered.linked, skippedCrossRepo: delivered.skippedCrossRepo, copilotRequested: delivered.copilotRequested },
  settle: settleResult,
  summary: `${tasksCompleted.length}/${tasks.length} Task(s) delivered in PR #${delivered.prNumber}; settled=${settleResult.settled}${tasksSkipped.length > 0 ? `; skipped: ${tasksSkipped.join(', ')}` : ''}`,
}
