---
id: 18855d7d-5e16-4739-828b-11312f128858
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Read a repo's GitHub Pages status
diataxis_type: how-to
---
# Read a repo's GitHub Pages status

Check a repository's current Pages configuration and build status.

## Call

```
get_pages_config { "owner": "<owner>", "repo": "<repo>" }
```

## Result

```json
{
  "url": "https://api.github.com/repos/<owner>/<repo>/pages",
  "status": "built",
  "buildType": "workflow",
  "htmlUrl": "https://<owner>.github.io/<repo>/"
}
```

`status` is `null` while a build is in progress or hasn't run yet;
`url`/`htmlUrl` are `null` if Pages isn't enabled at all.

## If Pages isn't enabled

Expect a `github_api_error` — GitHub's Pages endpoint 404s for a repo
with no Pages site configured, the same way branch-protection's
endpoint 404s for an unprotected branch.

## Notes

Read-only: this plugin does not enable, disable, or reconfigure Pages —
only reports its current state. That's deliberate; changing a repo's
live site is a risk this domain's scoping doesn't take on. To actually
enable or reconfigure Pages, use the GitHub web UI or the REST API's
write endpoints directly.
