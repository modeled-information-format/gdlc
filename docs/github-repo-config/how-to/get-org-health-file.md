---
id: ea4f731a-9bab-4af0-ae0a-0b95a7569d8f
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Read a community health file's content
diataxis_type: how-to
---
# Read a community health file's content

Fetch the actual content of one org-wide default community health file.

## Before you call this

You need the file's `path` within the org's `.github` repo. Get it from
[list-org-health-files.md](list-org-health-files.md) first.

## Call

```
get_org_health_file { "org": "<org>", "path": "CONTRIBUTING.md" }
```

## Result

```json
{
  "path": "CONTRIBUTING.md",
  "content": "# Contributing\n\n..."
}
```

`content` is already decoded to a plain UTF-8 string — GitHub's contents
API returns base64, and this tool does that decoding for you before
returning.

## Notes

Reads only the org's public `.github` repo, never `.github-private`.
Requesting a directory path instead of a file returns something that
doesn't match this tool's expected shape — use
[list-org-health-files.md](list-org-health-files.md) for directories.
