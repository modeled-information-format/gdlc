---
id: 5c9e2a7d-1f4b-4e8a-9d3c-6b1f7a5e2c84
type: procedural
created: 2026-07-07T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-07T00:00:00Z
title: "How-to: decompose a written spec into an Epic + Stories + Tasks"
diataxis_type: how-to
---

You have a spec document — a design doc, an RFC, a feature write-up — and
need it turned into a real, trackable GitHub issue hierarchy: one Epic, a
Story per major piece of work the spec describes, and Tasks under each
Story for the concrete units of work. This goes one level deeper than
[the main tutorial](../tutorials/create-your-first-epic.md), which stops at
Epic + two Stories with no third level.

If you'd rather have this done for you from a single description instead
of following the steps below by hand, the **epic-decomposition** skill runs
this same pattern automatically. This guide is for when you want to do it
yourself — reviewing the spec section by section as you go, or adjusting
the hierarchy shape as you build it.

## Steps

1. **Read the spec and outline the hierarchy on paper (or in a scratch
   note) before creating anything.** Identify: the overall goal (becomes
   the Epic), the major independent pieces of work the spec breaks into
   (each becomes a Story), and, under each Story, the concrete tasks
   someone will actually pick up and close (each becomes a Task). Getting
   this shape right before you start creating issues saves you from
   reparenting things later — `add_sub_issue` attaches a child to one
   parent; moving a child to a *different* parent isn't a single
   operation.

2. **Create the Epic**, summarizing the spec's overall goal in the body —
   not the whole spec verbatim, just enough that someone opening the issue
   understands what it's for and can find the source spec:

   ```text
   create_issue {
     owner: "octo-org", repo: "widget-app",
     title: "Ship the offline-sync feature",
     body: "Implements offline-first sync per the spec: <link>.",
     mif: { id: "offline-sync", type: "Epic", namespace: "widget-app" }
   }
   ```

   Note the returned `number` — call it `201` for the rest of this guide.

3. **For each major piece the spec describes, create a Story and attach
   it to the Epic:**

   ```text
   create_issue {
     owner: "octo-org", repo: "widget-app",
     title: "Local write queue",
     body: "Persist writes locally when offline; flush on reconnect.",
     mif: {
       id: "offline-sync-write-queue", type: "Story", namespace: "widget-app"
     }
   }
   add_sub_issue {
     owner: "octo-org", repo: "widget-app", parentNumber: 201, childNumber: 202
   }
   ```

   Repeat for every Story the spec implies. `add_sub_issue` checks the
   100-sub-issue and 8-level nesting limits before calling GitHub — if you
   hit `limit_exceeded` on the Epic itself, that's a sign the spec needs a
   second-level Epic underneath it instead of every Story hanging directly
   off one parent.

4. **Under each Story, create its Tasks the same way — this time
   attaching to the Story, not the Epic:**

   ```text
   create_issue {
     owner: "octo-org", repo: "widget-app",
     title: "Implement the local write-queue schema",
     body: "Define the on-disk queue format.",
     mif: {
       id: "offline-sync-write-queue-schema", type: "Task",
       namespace: "widget-app"
     }
   }
   add_sub_issue {
     owner: "octo-org", repo: "widget-app", parentNumber: 202, childNumber: 203
   }
   ```

5. **If the spec implies a build order** (some Stories or Tasks must land
   before others), write that ordering into the Epic's body as prose —
   sub-issues themselves carry no ordering field in GitHub's model, so
   sequence has to live in text, not in the attachment itself.

6. **Check progress at any level with `list_sub_issues`** — call it on the
   Epic to see Story-level completion, or on a Story to see its own
   Task-level completion:

   ```text
   list_sub_issues { owner: "octo-org", repo: "widget-app", parentNumber: 202 }
   ```

## Every issue still gets its MIF body automatically

Whether you're creating the Epic, a Story, or a Task, `create_issue`
prepends the `<!-- mif-id -->` / `<!-- mif-type -->` / `<!-- mif-ns -->`
comment block for you from the `mif` object you pass — you never
hand-write that block, at any level of the hierarchy.
