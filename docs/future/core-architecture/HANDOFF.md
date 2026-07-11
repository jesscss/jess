> ⚠️ **The active cleanup queue is now [`CORE-CLEANUP.md`](./CORE-CLEANUP.md).** The
> per-focus trackers this doc references (SINGLE_FRAME_PLAN, NODE-REWRITE-TRACKER,
> PERFORMANCE-HANDOFF, BINDING-LOOKUP-REMAINING) were consolidated there; their history
> lives in git history. This doc is kept for its routing/guardrail context.

# Core Architecture Handoff

This is the stable router for Jess core architecture work. Keep it short: it
tells the next agent where to choose a focus, how to complete a pass, and where
progress is tracked. Do not rewrite this file just to switch focus; set the
chat/Guildhall goal from `archive/FOCII.md` instead.

## Focus Router

Choose exactly one active focus before editing. If the user names a focus,
follow that. If the request is ambiguous, infer from the branch and latest user
instruction, then record the chosen focus in the final response instead of
changing this router. Use `archive/FOCII.md` for the goal prompt, boundaries, stop rule,
and required docs.

- **Binding / lookup:** use `CORE-CLEANUP.md` for the active queue,
  remaining scope, progress notes, and completion gates. This stream owns registryless
  lookup, direct crawl/frame lookup, reference handles, live/current binding,
  fallback bridge deletion, and lookup profiles.
- **Serialization / `writeSyntax`:** use `CORE-CLEANUP.md` for the
  active node-family queue, historical row status, serialization contracts, and
  completion gates. This stream owns direct syntax/render emission, cold public
  string wrappers, render readback removal, and node-family row closure.
- **Performance evidence:** use `CORE-CLEANUP.md` for benchmark
  protocol, profile history, rejected experiments, and speed claims.
- **Patch-shape review:** use `AGGRESSIVE-CUTTING-REVIEW.md` before changing
  AST, eval/render, lookup, traversal, copying, inheritance, output writer,
  source/root metadata, or this router.

## Shared Direction

The fastest credible runtime path remains:

- one canonical source tree;
- direct eval/render-to-string for normal output;
- live lookup/binding/placement state instead of routine copied eval trees;
- cold materialization only for public APIs or real semantic ownership
  boundaries;
- fewer hot-path objects, arrays, recursive walks, helper calls, branch ladders,
  promise/generator states, and metadata mutations.

Less is the optimizing path. Preserve SCSS-enabling seams only when they are
concrete and cheap or isolated behind cold extension boundaries.

Do not preserve an unreleased or self-invented public-looking method for
compatibility alone. If repo usage does not need it and the user has not
approved it as API, delete or reshape it.

## Completion Rules

When the user says `continue`, `do all queue items`, `complete the queue`, or
`full queue pass`, run an autonomous focus pass:

1. Snapshot `git status --short --branch`.
2. Read this router, `archive/FOCII.md`, and the chosen focus tracker.
3. State one hypothesis before editing.
4. Work through the active queue as a swath, not one micro-edit.
5. Keep moving until the queue is drained, the next item has materially
   different semantics, the next step needs user/product judgment, evidence
   rejects the approach, or a failing test/debugging thread needs focused
   investigation.
6. Use focused tests while iterating; run full gates at the coherent batch
   boundary.
7. Update the chosen focus tracker with only facts that change the next
   worker's decisions.
8. Update `Aggressive Cutting Self-Prosecution` below for the latest pass.
9. Commit and push the batch with `--no-verify` when the pass is complete.

A queue item must be a whole task with its own proof surface. It may contain
several sub-tasks, helper deletions, rejected cuts, and tests. Do not create or
mark complete one-line queue items. If an active queue item remains unfinished
at wrap-up, record in the focus tracker and final response which item remains,
what blocked immediate continuation, and why stopping was necessary.

Each active focus tracker should keep at least 15 unchecked sizable tasks
available unless that focus is genuinely within 15 tasks of completion.
Reseeding the next queue is closeout work, not a queue item. Completed history
belongs in git or `CORE-CLEANUP.md`, not in this router.

Use sub-agents when available for disjoint evidence or implementation slices.
Good assignments include one node-family row, one lookup family, focused test
surface discovery, profile/call-stack audits, or review against the aggressive
cutting rules. Workers must not make overlapping edits, revert unrelated work,
commit independently, or change the selected focus. The main agent owns
integration, verification, docs, commit, push, and continuation.

## Gate Rules

Always run the smallest relevant test first. Before commit, run:

```sh
git diff --check
pnpm run verify:aggressive-cutting-review
```

Then run the chosen focus gates from `CORE-CLEANUP.md`. Use its benchmark
protocol before making any speed claim. Use
`pnpm run verify:baseline -- --changed` when the touched area needs a broader
fixture gate. The current hook path has previously looped, so commit and push
with `--no-verify` after the explicit gates pass.

## Current State — the single-eval-emit cutover

The core-architecture work is mid **single-eval-emit cutover**: collapse
eval→output-tree→visitor→serialize into one downward spine (`emit-walk.ts`),
folding each node shape off the eval path until the monolith can be deleted.

Live boards (kept current — read these first, not this router, for what's landed
and what's in flight):

- **`CUTOVER-STATUS.md`** — compact at-a-glance board: what's landed on the spine
  (extend modes, mixin surface-sink, `@layer`/`@scope`, conditional/scope-mutating
  decls, root-level calls, …), what's in flight, what's gated.
- **`CUTOVER-CHECKLIST.md`** — the executable phased plan (P0–P5) + the HARD RULES
  every cutover agent works under (drive to the target, no permanent eval fallback).
- **`UNIFIED-EVAL-EMIT-DESIGN.md`** — the settled architecture spec both boards
  point to (one pass, live-frame threading, extend PLAN/SOLVE/EMIT, flag-walk
  endgame). This is the SPEC; the current eval code is what's being torn out.

Other active docs in this dir:

- **`CORE-CLEANUP.md`** — the single live @jesscss/core cleanup queue (binding/lookup,
  serialization, node field budgets, perf evidence). Focus router above points here.
- **`AGGRESSIVE-CUTTING-REVIEW.md`** — the patch-shape refusal checklist; run before
  committing changes to AST/eval/render/lookup/traversal/copy/output/metadata.
- **`STRINGS-OVER-NODES.md`** — active reference (producer flips still pending).
- **`ASSIGNABLE-CONTROL-NODES-PLAN.md`** — queued future feature track.

## History

Landed design/plan/readout/audit docs and this router's former pass-by-pass
`Aggressive Cutting Self-Prosecution` log live in **`archive/`** (see
`archive/README.md` for the index). Full content is preserved — read one when you
need the *why/how* behind a shipped mechanism. Notably `archive/HANDOFF-history.md`
holds the self-prosecution log.
