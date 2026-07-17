export const meta = {
  name: 'query-pipeline',
  description: 'Fan out over a GitHub issues/PR query: develop each issue to a PR, settle every PR (code review with fixes, one Copilot round, CI green), optionally squash-merge',
  phases: [
    { title: 'Discover', detail: 'run the search query, classify and cap the items' },
    { title: 'Develop', detail: 'one agent per issue: isolated worktree, implement, open PR' },
    { title: 'Review', detail: 'code-review --fix per PR on the review model' },
    { title: 'Settle', detail: 'one Copilot round, every thread resolved, checks green' },
    { title: 'Merge', detail: 'squash-merge when automerge, otherwise hand off' },
  ],
}

// args: { query, automerge, maxItems, defaultRepo, reviewModel }
// The launching skill (SKILL.md Phase 0) resolves every one of these before
// this script runs — nothing here can ask the user anything.
// Some Workflow-tool invocations deliver args as an unparsed JSON string
// rather than the parsed object (observed 2026-07-17, gdlc#300's sibling
// finding) — tolerate that shape defensively rather than failing outright.
const resolvedArgs = typeof args === 'string'
  ? (() => {
      try { return JSON.parse(args) } catch (e) { throw new Error(`query-pipeline received args as an unparsed string and it is not valid JSON: ${e.message}`) }
    })()
  : args
if (typeof resolvedArgs === 'undefined' || !resolvedArgs || typeof resolvedArgs.query !== 'string' || resolvedArgs.query.trim() === '') {
  throw new Error('query-pipeline requires args.query — the launching skill must resolve the search query before starting the workflow')
}
const query = resolvedArgs.query.trim()
const automerge = resolvedArgs.automerge === true
const maxItems = Number.isInteger(resolvedArgs.maxItems) && resolvedArgs.maxItems > 0 ? resolvedArgs.maxItems : 10
const defaultRepo = typeof resolvedArgs.defaultRepo === 'string' && resolvedArgs.defaultRepo.includes('/') ? resolvedArgs.defaultRepo : null
const reviewModel = typeof resolvedArgs.reviewModel === 'string' && resolvedArgs.reviewModel ? resolvedArgs.reviewModel : 'opus'

const ITEMS_SCHEMA = {
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['repo', 'number', 'kind', 'title', 'url'],
        properties: {
          repo: { type: 'string', description: 'owner/repo' },
          number: { type: 'integer' },
          kind: { type: 'string', enum: ['issue', 'pr'] },
          title: { type: 'string' },
          url: { type: 'string' },
        },
      },
    },
  },
}

const DEVELOP_SCHEMA = {
  type: 'object',
  required: ['ok', 'prNumber', 'prUrl', 'notes'],
  properties: {
    ok: { type: 'boolean' },
    prNumber: { type: ['integer', 'null'] },
    prUrl: { type: ['string', 'null'] },
    branch: { type: ['string', 'null'] },
    notes: { type: 'string', description: 'what happened, or why it failed and what board state the issue was left in' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['ok', 'findingsFixed', 'notes'],
  properties: {
    ok: { type: 'boolean' },
    findingsFixed: { type: 'integer' },
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
    notes: { type: 'string', description: 'the final check_pr_readiness verdict, or why it never settled' },
  },
}

const MERGE_SCHEMA = {
  type: 'object',
  required: ['merged', 'notes'],
  properties: {
    merged: { type: 'boolean' },
    notes: { type: 'string' },
  },
}

// gdlc#307: a per-item guard, checked before the heavy Develop agent is ever
// dispatched for an issue. Safe for a one-shot run either way, but without
// it a recurring/scheduled invocation of the identical query can re-match an
// issue a PRIOR run already moved to In Progress (its board Status is the
// only signal a re-run has — GitHub search has no qualifier for a custom
// Projects v2 field value, so this can't be pushed into the query string).
const GUARD_SCHEMA = {
  type: 'object',
  required: ['alreadyInProgress', 'status'],
  properties: {
    alreadyInProgress: { type: 'boolean' },
    status: { type: ['string', 'null'], description: 'the board Status value found, or null if unset/not on the board' },
    notes: { type: 'string' },
  },
}

const SHARED_RULES = `
Ground rules (non-negotiable, they override any habit):
- Compose the github-sdlc-plugins MCP tools (load via ToolSearch:
  create_pull_request, classify_pull_request, add_pull_request_to_project,
  get_linked_issues, check_pr_readiness, request_review,
  list_review_requests, set_field_value, sync_linked_issues_project_field,
  update_issue, get_project_status_profile, get_project_items). Hand-rolled
  gh api graphql is acceptable ONLY where no plugin tool covers the
  operation (e.g. the resolveReviewThread mutation).
- Never gh pr create / curl for PR creation; use create_pull_request.
- Move an issue's board Status forward WITH a comment at each transition,
  and read the current Status before writing — native Projects v2
  automations may already have moved it.
- Never add an AI-attribution trailer to any commit, PR, issue, or comment.
- Never force-push. Never merge, delete a branch, or skip hooks/CI unless
  this prompt explicitly says to.
- Your final text is data for an orchestrator, not a human message.`

// ---------------------------------------------------------------- Discover
phase('Discover')
log(`query: ${query}${defaultRepo ? ` (scope: ${defaultRepo})` : ''} | automerge: ${automerge} | cap: ${maxItems}`)

const discovered = await agent(
  `Run this GitHub search and return every result as structured items.

Search query: ${query}
${defaultRepo ? `If the query has no repo:/org: qualifier, scope it to ${defaultRepo}.` : ''}

Run the query EXACTLY as given, verbatim, with every one of its qualifiers
intact — do not substitute a different search mechanism that reinterprets
or drops any of them, and do not apply any implicit filtering of your own
(e.g. do not silently exclude closed/merged items — if the query wants
that, the query says so with is:open / is:closed).

Concretely: tokenize the query into its qualifiers, preserving any quoted
multi-word term (e.g. label:"good first issue" or a quoted exact-phrase
search) as ONE argument, and pass each qualifier as its own SEPARATE
argument to "gh search issues" / "gh search prs" — e.g. for
'org:X is:issue is:open label:"good first issue"' run:
  gh search issues org:X is:issue is:open 'label:"good first issue"' --json repository,number,title,url,state
Do NOT wrap the WHOLE query in one quoted string ("gh search issues
\"org:X is:issue is:open\""): the gh CLI mis-parses that form whenever
"org:" is not the very first token, silently absorbing every trailing
qualifier into the org value (producing an "Invalid search query" error or
a bogus empty result with no visible signal). Do NOT flatten every
qualifier to a bare unquoted word either — a qualifier whose value is
itself multiple words (quoted) must stay one argument or its quoting is
lost the same way. Do NOT substitute "gh api search/issues -f q=..." (the
raw REST endpoint) as a "safer" alternative either — some qualifiers (e.g.
has:project) are enforced client-side by the gh CLI's own search command
and are silently IGNORED by the raw REST endpoint, which will over-match
and return items the query never asked for. The multi-argument
"gh search issues"/"gh search prs" form (each qualifier its own argument,
quoted multi-word values kept intact) is the one form that reproduces the
query's real semantics end-to-end — use it, and nothing else. With --json
so you read real fields, not scraped text. If the query does not restrict
type, run both issue and PR searches but keep them disjoint: qualify with
is:issue for the issue search and let the PR search own the PR side; then
de-duplicate by repo+number before returning. For each result report repo
as owner/repo, the number, kind ("issue" or "pr"), title, and url. Return
only what the search actually returned — do not invent, drop, or add items
beyond exactly what the query specifies.`,
  { label: 'discover', phase: 'Discover', schema: ITEMS_SCHEMA },
)

const seenKeys = new Set()
const allItems = ((discovered && discovered.items) || []).filter((i) => {
  const key = `${i.repo}#${i.number}`
  if (seenKeys.has(key)) return false
  seenKeys.add(key)
  return true
})
const items = allItems.slice(0, maxItems)
const dropped = allItems.slice(maxItems)
if (dropped.length > 0) {
  log(`cap ${maxItems} reached — dropped ${dropped.length}: ${dropped.map((d) => `${d.repo}#${d.number}`).join(', ')}`)
}
log(`processing ${items.length} item(s): ${items.map((i) => `${i.repo}#${i.number}(${i.kind})`).join(', ') || 'none'}`)

if (items.length === 0) {
  return {
    query,
    automerge,
    processed: [],
    dropped: dropped.map((d) => `${d.repo}#${d.number}`),
    settledCount: 0,
    mergedCount: 0,
    summary: 'query returned no open items',
  }
}

// ------------------------------------------------- Per-item pipeline stages

// gdlc#307: read-only re-dispatch guard for issue-kind items. Runs on every
// invocation, one-shot or recurring — for a one-shot run alreadyInProgress
// is always false (nothing could have moved the issue yet) and this simply
// costs one cheap extra agent call; for a recurring/scheduled sweep of the
// same query it is what keeps a still-in-flight issue from being handed to
// a second, independent Develop agent (duplicate worktrees/branches/PRs).
const guardStage = (item) => agent(
  `Before any implementation work, determine whether GitHub issue ${item.repo}#${item.number} ("${item.title}") is already mid-flight from an earlier run of this same query-pipeline sweep.

This is a READ-ONLY check: do not comment on the issue, do not change its
Status, do not open a pull request, do not clone or touch the repo.

1. Call get_project_status_profile (github-sdlc-planning) for the board
   this issue lives on, to learn its REAL Status options and which of them
   count as "not started" (Backlog/Todo/Ready/an equivalent unset state) —
   never assume a fixed pipeline shape; boards differ.
2. Call get_project_items (github-sdlc-planning) and find this issue's
   item; read its current Status field value.
3. If the issue is not on the board at all, or its Status is unset or
   matches one of the board's real "not started" options, report
   alreadyInProgress=false.
4. Otherwise — Status is anything further along the board's real pipeline
   than "not started" (In Progress, In Review, Blocked, Done, or whatever
   that board actually calls it) — report alreadyInProgress=true. Board
   Status is the only signal used here; do not also search for an existing
   linked PR — if none exists despite an in-progress Status, that is
   exactly the unsafe re-dispatch case this guard exists to catch.

Return alreadyInProgress, status (the real Status value found, or null),
and notes (which option matched and why).`,
  { label: `guard:${item.repo}#${item.number}`, phase: 'Develop', schema: GUARD_SCHEMA },
)

const developStage = (item) => {
  if (item.kind === 'pr') {
    // Existing PRs enter the pipeline at Review.
    return { ok: true, prNumber: item.number, prUrl: item.url, branch: null, notes: 'existing PR — entered at review stage' }
  }
  return guardStage(item).then((guard) => {
    if (guard && guard.alreadyInProgress) {
      // guard.status is nullable per GUARD_SCHEMA (unset/off-board can still
      // pair with alreadyInProgress=true from a malformed/partial guard
      // response) — display a real label instead of the literal string
      // "null" in logs/notes, which reads as a bogus Status value.
      const statusLabel = guard.status || 'an unspecified in-progress status'
      log(`skip ${item.repo}#${item.number}: already "${statusLabel}" on the board with no PR yet — re-dispatch guard (gdlc#307)`)
      return {
        ok: true,
        prNumber: null,
        prUrl: null,
        branch: null,
        notes: `skipped — already "${statusLabel}" on the board with no linked PR yet; a previous run appears to still be mid-flight on this issue (re-dispatch guard, gdlc#307)${guard.notes ? `: ${guard.notes}` : ''}`,
      }
    }
    return agent(
      `Develop GitHub issue ${item.repo}#${item.number} ("${item.title}", ${item.url}) into an open pull request.
${SHARED_RULES}

Steps:
1. Read the issue in full (gh issue view --json title,body,labels,comments).
   If its acceptance criteria are genuinely unimplementable as written,
   stop: comment on the issue explaining precisely what is missing, leave
   its board Status where it is, and return ok=false with that reason.
2. Locate or clone ${item.repo} locally. NEVER work in a checkout that has
   uncommitted changes — create an isolated temporary git worktree on a new
   branch off a FRESHLY FETCHED origin default branch (git fetch origin
   first; verify the ref exists with git ls-remote --heads).
3. Read the repo's own CLAUDE.md/CONTRIBUTING and match its conventions.
   Implement the issue. Add or extend tests so the change is covered — a
   fix without a test that fails before and passes after is not done.
4. Run the repo's real local gates (build, lint, test — whatever its docs
   and CI define). Fix failures before going further.
5. Comment on the issue that work started and move its board Status to the
   board's in-progress option (read Status first; the comment and the
   Status write happen together).
6. Commit (conventional style matching the repo's history), push the
   branch, open ONE PR via create_pull_request with "Closes #${item.number}"
   in the body. Then classify_pull_request, add_pull_request_to_project,
   and move the issue's Status to the board's in-review option with a
   comment. Confirm linkage with get_linked_issues.
7. Remove the temporary worktree (the branch lives on the remote now).

Return ok, prNumber, prUrl, branch, and notes.`,
      { label: `develop:${item.repo}#${item.number}`, phase: 'Develop', schema: DEVELOP_SCHEMA },
    )
  })
}

const reviewStage = (dev, item) => {
  if (!dev || !dev.ok || !dev.prNumber) return dev
  return agent(
    `Run an impartial code review with fixes on PR ${item.repo}#${dev.prNumber} (${dev.prUrl}).
${SHARED_RULES}

Invoke the code-review skill (Skill tool: code-review:code-review) against
this PR with --fix and --no-comments: findings are fixed in the working
tree and pushed to the PR branch, NEVER posted as a PR comment. Check out
the PR branch in an isolated temporary worktree first (gh pr checkout
inside it), apply the review fixes there, re-run the repo's local gates on
anything the fixes touched, push, then remove the worktree.

If the review finds nothing, push nothing and say so. Return ok,
findingsFixed (count actually applied), and notes.`,
    { label: `review:${item.repo}#${dev.prNumber}`, phase: 'Review', schema: REVIEW_SCHEMA, model: reviewModel },
  ).then((rev) => ({ ...dev, review: rev }))
}

const settleStage = (dev, item) => {
  if (!dev || !dev.ok || !dev.prNumber) return dev
  return agent(
    `Settle PR ${item.repo}#${dev.prNumber} (${dev.prUrl}): one Copilot review round, every thread resolved, all checks green.
${SHARED_RULES}

HARD CAP: exactly ONE Copilot review request for this PR, ever. If one was
already requested or completed (check the PR's timeline and existing
reviews first), do not request another — go straight to addressing it.

1. Request a Copilot review via github-pull-requests' request_review
   (reviewers: ["Copilot"]). Verify it registered with
   list_review_requests; that tool call can silently no-op. If it did
   no-op, retry the request once; if it still doesn't register, note it
   and continue — the cap means no further attempts.
2. Wait for the review to land AGAINST THE PR'S CURRENT HEAD SHA: poll
   check_pr_readiness (github-pull-requests) on a bounded backoff — start
   at 60s between polls, give up after ~20 minutes of no review while
   checks are otherwise done. "A review was requested" is not "a review
   exists"; "a review exists" is not "the review is resolved".
3. Fix every finding Copilot leaves: apply the change in an isolated
   temporary worktree on the PR branch, re-run affected local gates, push.
   Then resolve EVERY review thread via the resolveReviewThread GraphQL
   mutation (no plugin tool covers it) — a pushed fix does not resolve a
   thread by itself. If a finding is genuinely wrong, reply tersely with
   the concrete reason and resolve the thread; never ignore one.
4. Keep polling check_pr_readiness until it reports settled: true (its
   verdict combines checks, review state, thread resolution, and
   code-scanning alerts). Never declare settled from CI status alone.
5. Do NOT merge. Do NOT re-request Copilot after pushing fixes.

Return settled, copilotReviewed (a real review landed), threadsResolved,
and notes (the final readiness verdict, or exactly why it never settled).`,
    { label: `settle:${item.repo}#${dev.prNumber}`, phase: 'Settle', schema: SETTLE_SCHEMA },
  ).then((settle) => ({ ...dev, settle }))
}

const mergeStage = (dev, item) => {
  if (!dev || !dev.ok || !dev.prNumber) return dev
  if (!automerge) {
    return { ...dev, merge: { merged: false, notes: 'automerge off — settled PR left for human review/merge' } }
  }
  if (!dev.settle || dev.settle.settled !== true) {
    return { ...dev, merge: { merged: false, notes: 'not settled — automerge skipped' } }
  }
  return agent(
    `Squash-merge the settled PR ${item.repo}#${dev.prNumber} (${dev.prUrl}) and close the loop.
${SHARED_RULES}

The user explicitly enabled automerge for this run, and the PR's readiness
verdict is settled — that is your merge authorization for THIS PR only.

That authorization explicitly COVERS one specific --admin retry and no
other: if the plain merge in step 2 is rejected and the rejection reason is
SPECIFICALLY that branch protection requires an approving review (Copilot's
own review does not count as an approval, and the PR author cannot
self-approve), retrying with --admin is already-granted automerge
authorization for this PR — do not stop, do not treat it as needing
separate sign-off, do not file a bug about it. Any OTHER blocking reason
(failing or pending checks, merge conflicts, an unresolved review thread,
anything not literally the required-approval rejection) is NOT covered by
this authorization: do not retry with --admin for those — stop and return
merged=false with the real reason instead.

1. Re-verify freshly (state can change between stages): the PR is still
   open and check_pr_readiness still reports settled: true. If not, stop
   and return merged=false with the current verdict.
2. gh pr merge ${dev.prNumber} --repo ${item.repo} --squash --delete-branch
3. If step 2 fails, read the actual rejection reason before doing anything
   else:
   - Required-approval-only rejection (e.g. "at least 1 approving review is
     required"): retry once — gh pr merge ${dev.prNumber} --repo ${item.repo}
     --squash --delete-branch --admin — covered by the authorization above.
   - Any other rejection reason: do NOT retry with --admin. Stop and return
     merged=false with the real reason.
4. Confirm the merge landed (gh pr view --json state,mergedAt shows MERGED
   with a real timestamp — never infer from the command exiting 0).
5. sync_linked_issues_project_field for the post-merge board field, and
   confirm via get_linked_issues which linked issues actually closed;
   report any skippedCrossRepo entries. Native board automation moves
   Status to Done on close — read before writing; only write Done where
   automation demonstrably did not.
6. Comment on the source issue${item.kind === 'issue' ? ` (#${item.number})` : ''} only if closure did not happen automatically.

Return merged and notes.`,
    { label: `merge:${item.repo}#${dev.prNumber}`, phase: 'Merge', schema: MERGE_SCHEMA },
  ).then((merge) => ({ ...dev, merge }))
}

// pipeline(): each item flows develop -> review -> settle -> merge
// independently — no barriers, a slow develop never blocks a sibling's
// settle. Stage callbacks receive (prevResult, originalItem, index).
const results = await pipeline(items, developStage, reviewStage, settleStage, mergeStage)

const processed = items.map((item, i) => {
  const r = results[i]
  return {
    source: `${item.repo}#${item.number}`,
    kind: item.kind,
    title: item.title,
    ok: !!(r && r.ok),
    prUrl: (r && r.prUrl) || null,
    findingsFixed: (r && r.review && r.review.findingsFixed) || 0,
    settled: !!(r && r.settle && r.settle.settled),
    merged: !!(r && r.merge && r.merge.merged),
    notes: [r && r.notes, r && r.review && r.review.notes, r && r.settle && r.settle.notes, r && r.merge && r.merge.notes]
      .filter(Boolean)
      .join(' | ') || 'agent returned no result (skipped or failed)',
  }
})

const settledCount = processed.filter((p) => p.settled).length
const mergedCount = processed.filter((p) => p.merged).length
log(`done: ${processed.length} processed, ${settledCount} settled, ${mergedCount} merged, ${dropped.length} dropped over cap`)

return {
  query,
  automerge,
  processed,
  dropped: dropped.map((d) => `${d.repo}#${d.number}`),
  settledCount,
  mergedCount,
  summary: `${processed.length} processed, ${settledCount} settled, ${mergedCount} merged, ${dropped.length} dropped over cap`,
}
