# Actions IssueOps workflow templates

Workflow **templates** for the agent-free automation substrate of the
bug-capture plugin's Layer 1 ([ADR-0001](../../../docs/decisions/adr-0001-bug-capture-layer1-core.md)).
They live here — *not* under this repo's `.github/workflows/` — precisely so
they are **not active workflows of this repository**. Consumers copy them into
their own repos.

## Installation

Copy the template(s) into the consuming repository:

```bash
cp workflows/bug-autolabel.yml            <your-repo>/.github/workflows/
cp workflows/bug-close-keyword-audit.yml  <your-repo>/.github/workflows/
```

Both run on the workflow's own `GITHUB_TOKEN` with an explicit least-privilege
`permissions` block (`issues: write`) — no extra secrets or app tokens to
provision. The only third-party surface is `actions/github-script`, SHA-pinned
to the same commit this repo's own workflows pin.

## Templates

### `bug-autolabel.yml` — on `issues: opened, edited`

Parses the issue body for a `Severity: <critical|high|medium|low>` line or a
checked severity checkbox (`- [x] High`) and applies the matching
`severity:*` label, removing any stale `severity:*` label so the
one-severity-label convention holds. Additionally applies the `bug` label when
the body's MIF L1 comment block declares `<!-- mif-type: Bug -->` (what
`bug_create` in [`scripts/gh-bug.sh`](../scripts/gh-bug.sh) and the MCP
server's filing tools emit).

### `bug-close-keyword-audit.yml` — on `issues: closed`

When an issue was closed by a merged pull request (a close keyword such as
`Fixes #N`), comments a one-line audit trail naming the closing PR number.
Issues closed manually get no comment. Close-keyword *reads* remain owned by
the `github-pull-requests` plugin
([ADR-0002](../../../docs/decisions/adr-0002-pr-issue-linkage-ownership.md));
this template only annotates the close event GitHub itself already resolved.

## Validation

Each template passes `actionlint` and parses as strict YAML
(`python3 -c "import yaml, sys; yaml.safe_load(open(sys.argv[1]))" <file>`).
