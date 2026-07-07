---
id: 3e8b1c5a-6f2d-4a9e-8b3c-1d7f5a2e9c46
type: procedural
created: 2026-07-07T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-07T00:00:00Z
title: "How-to: wire bug capture into your development loop"
diataxis_type: how-to
---

You're heads-down coding and hit a real bug — not the one you're working
on, a different one you just noticed. The goal isn't a one-off tutorial
run; it's making "catch it, file it, triage it, don't lose track of it"
a habit you repeat every time this happens, without derailing what you
were actually working on.

[The main tutorial](../tutorials/capture-your-first-bug.md) walks all seven
tools once, on a fictional issue, to show you the shape of each call. This
guide is the same tools, framed as the repeatable four-step loop you
actually run mid-development.

## The loop

1. **Check for a duplicate before filing anything.** You might not be the
   first to hit this:

   ```text
   search_similar_issues {
     owner: "octo-org", repo: "widget-app",
     query: "crash filename slash save"
   }
   ```

   This is plain keyword search against GitHub's issue search, not
   semantic matching — word choice matters. If your first query comes back
   empty, try the error message itself or a shorter phrase before
   concluding there's no duplicate.

2. **If nothing matches, file it and keep moving.** Don't stop to write a
   perfect issue body — capture what you know right now (repro steps,
   what you were doing, the error text) and get back to work. You'll
   triage severity in the next step, separately:

   ```text
   create_issue {
     owner: "octo-org", repo: "widget-app",
     title: "Save button crashes when filename contains a slash",
     body: "Hit while working on #142. Repro: name a file with a `/`, click Save.",
     mif: {
       id: "save-crash-slash-filename", type: "Bug", namespace: "widget-app"
     }
   }
   ```

   (`create_issue` is `github-sdlc-planning`'s tool — bug-capture composes
   with it rather than duplicating issue creation itself; see
   [explanation/architecture.md](../explanation/architecture.md).)

3. **Set severity once you've had a moment to think about impact**, not
   necessarily in the same breath as filing:

   ```text
   set_severity {
     owner: "octo-org", repo: "widget-app", issueNumber: 219, severity: "High"
   }
   ```

   If this fails with `missing_field`, the board doesn't have a Severity
   field yet — run `ensure_severity_field` once (it's idempotent, safe to
   call again later) and retry.

4. **Advance its lifecycle state as you actually work it** — not just at
   the end, at each real transition:

   ```text
   set_lifecycle_state {
     owner: "octo-org", repo: "widget-app", issueNumber: 219, status: "In Progress"
   }
   ```

   And when you fix it, close it out in the same call rather than a
   separate manual close:

   ```text
   set_lifecycle_state {
     owner: "octo-org", repo: "widget-app", issueNumber: 219,
     status: "Done", closeIfDone: true
   }
   ```

## Making this a habit, not a chore

The reason this is worth doing in the moment rather than "I'll file it
later" is exactly what step 2 says: capture what you know while you still
know it. A bug noticed mid-task and filed immediately has an accurate
repro; the same bug remembered an hour later usually doesn't. The four-step
loop above is short enough to run without losing your place in the actual
work you were doing.
