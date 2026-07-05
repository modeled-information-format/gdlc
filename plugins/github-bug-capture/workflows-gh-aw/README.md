# gh-aw pack — technical preview, disabled by default

[GitHub Agentic Workflows](https://github.com/github/gh-aw) (`gh-aw`) is a
**technical preview** from GitHub Next: use it at your own risk, per its own
project framing. The gh-aw pack (issue #42) ships this awareness explicitly —
it is opt-in, and the source here is a **template/example**, not a
production-critical workflow this repository runs.

## What is here

[`bug-triage-batch.md`](bug-triage-batch.md) — an agentic workflow source
(compiled by `gh aw compile` into a GitHub Actions `.lock.yml`) implementing
AI-driven batch triage over open `bug`-labeled issues: it lists them, flags
likely duplicates via plain keyword matching (mirroring the `dedup-check`
skill), suggests a severity per issue, and reports through the declared
`safe-outputs` (`add-labels`, `add-comment`) — nothing else.

## Why this lives outside `.github/workflows/`

Same convention this plugin already uses for its Actions IssueOps templates
([`../workflows/README.md`](../workflows/README.md)): a workflow living here
is **not** an active workflow of this repository. It is disabled/inert by
construction — nothing in `.github/workflows/` references or triggers it.
Enabling it is a deliberate, per-consumer choice, matching the `gh-aw` pack
toggle's semantics in [`../docs/pack-toggles.md`](../docs/pack-toggles.md):
`gh-aw: false` (the default) means this pack's workflows may not even be
installed; `true` means a consumer has chosen to install and compile them.

## Installing it in a consuming repository

```bash
cp bug-triage-batch.md <your-repo>/.github/workflows/
cd <your-repo>
gh aw compile bug-triage-batch      # generates bug-triage-batch.lock.yml
gh aw validate bug-triage-batch     # compiles + lints (actionlint, zizmor, poutine) with no lock file emitted
```

Adjust the `pre-steps` App-token minting block to your own org's GitHub App
(or drop it and rely on the workflow's default `GITHUB_TOKEN`, narrowing
`permissions` accordingly) — the committed source targets this org's
`issues` App as a worked example, not a hardcoded dependency.

## Why it does not call this plugin's own MCP server

`bug-triage-batch.md` uses only the built-in `github` tool's `context` and
`issues` toolsets, not the `github-bug-capture` MCP server's
`search_similar_issues` tool. `gh-aw`'s `mcp-servers` block runs a server
from a container image (see `.github/workflows/sprint-milestone-digest.md`
for the pattern, which uses a published `ghcr.io/modeled-information-format/gdlc-planning-mcp`
image); `github-bug-capture` has no published container image yet ([the
`github-sdlc-planning` plugin's `Dockerfile`](../../github-sdlc-planning/mcp-server/Dockerfile)
is this marketplace's only precedent so far). Rather than inventing an image
that does not exist, this template's dedup/severity logic is expressed
directly in the workflow's own instructions, mirroring the `dedup-check` and
`triage` skills' heuristics instead of calling their underlying tools.
