---
id: 7e366023-31c6-44bd-8933-1155be2cda10
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Get a repo's community profile
diataxis_type: how-to
---
# Get a repo's community profile

Read a repository's community-health percentage and which of GitHub's
standard community files it has.

## Steps

1. Call `get_community_profile` with the repository's owner and name:

   ```text
   get_community_profile { owner: "octocat", repo: "example" }
   ```

2. Read the health percentage and the file-presence flags off the response:

   ```json
   {
     "healthPercentage": 87,
     "description": "A repository doing repository things.",
     "hasReadme": true,
     "hasLicense": true,
     "hasContributing": true,
     "hasCodeOfConduct": false,
     "hasIssueTemplate": true,
     "hasPullRequestTemplate": true
   }
   ```

   Each `has*` field is `true` when GitHub reports that file as present for
   the repository (a plain boolean derived from GitHub's `files.*` entries,
   not the file's content). `description` is the repository description as
   GitHub's community-profile endpoint reports it, and may be `null`.

## If it fails

- **`missing_scope`**: no GitHub token was resolvable. Set `GITHUB_TOKEN` or
  run `gh auth login`.
- **`github_api_error`**: check the message for the underlying HTTP status —
  a nonexistent or inaccessible `owner`/`repo` surfaces as a 404 here.

## See also

- [reference/tools.md](../reference/tools.md#get_community_profile) for the
  exact response schema.
