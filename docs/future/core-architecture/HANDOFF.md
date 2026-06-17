# Core Architecture Handoff

This is the stable router for Jess core architecture work. Keep it short: it
tells the next agent where to choose a focus, how to complete a pass, and where
progress is tracked. Do not rewrite this file just to switch focus; set the
chat/Guildhall goal from `FOCII.md` instead.

## Focus Router

Choose exactly one active focus before editing. If the user names a focus,
follow that. If the request is ambiguous, infer from the branch and latest user
instruction, then record the chosen focus in the final response instead of
changing this router. Use `FOCII.md` for the goal prompt, boundaries, stop rule,
and required docs.

- **Binding / lookup:** use `BINDING-LOOKUP-REMAINING.md` for the active queue,
  remaining scope, progress notes, and completion gates. Use
  `BINDING-INDEX-PROPOSAL.md` for design intent. This stream owns registryless
  lookup, direct crawl/frame lookup, reference handles, live/current binding,
  fallback bridge deletion, and lookup profiles.
- **Serialization / `writeSyntax`:** use `NODE-REWRITE-TRACKER.md` for the
  active node-family queue, historical row status, serialization contracts, and
  completion gates. This stream owns direct syntax/render emission, cold public
  string wrappers, render readback removal, and node-family row closure.
- **Performance evidence:** use `PERFORMANCE-HANDOFF.md` for benchmark
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
2. Read this router, `FOCII.md`, and the chosen focus tracker.
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
belongs in git, focused tracker rows, or `PERFORMANCE-HANDOFF.md`, not in this
router.

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

Then run the chosen focus gates from its tracker. Use
`PERFORMANCE-HANDOFF.md` before making any speed claim. Use
`pnpm run verify:baseline -- --changed` when the touched area needs a broader
fixture gate. The current hook path has previously looped, so commit and push
with `--no-verify` after the explicit gates pass.

## Aggressive Cutting Self-Prosecution

- Latest pass: source-static reference handle early read plus stale
  declaration-wrapper design cleanup.
- Verdict: accepted as a narrow binding/lookup hot-path preparation cut with
  behavior proof. No speed claim.
- New traversal: no new runtime traversal, recursion, sort, map/filter, parent
  walk, or child scan. The review-flagged `for (const read of reads)` loop is
  test-only coverage over four source-static reference families. The new helper
  reads the already-stored `_rulesLookupHandle` and delegates freshness to the
  existing handle reader.
- New node/materialization: no runtime node materialization. The review-flagged
  function constructor call is a test fixture for the function reference family;
  the focused test also builds ordinary variable/property/mixin fixtures only
  to prove the stored handle path. No render-only or eval-to-string nodes were
  added.
- Render path: no render/stringification path change. The new path returns the
  same handle values as the existing reader and falls through to normal lookup
  whenever the source-static shape is not trivial.
- Helper/API surface: added one private
  `tryReadSourceStaticRulesLookupHandle(...)` helper. It is deliberately
  narrower than a public plan/cache API: it accepts only existing handle state
  with `start === undefined`, `local === false`, no parent-start ignore, stable
  terminal-mixin bit, no target/filter/read mode/interpolation/leaky/search
  scope, and a string key equal to the normalized lookup key. It lets repeated
  source-static references skip `_lookupStrategy` rebuild and rules lookup
  shape preparation; it does not introduce a registry or exported facade.
- Metadata mutations: none beyond the existing `_lookupStrategy` test reset
  used to prove the helper does not rewrite it. No source/parent/frozen
  metadata changed.
- Allocation changes: the review-flagged `RulesLookupHandleShape` object is
  created only after an existing handle passes the source-static guards, so the
  normal first lookup path is unchanged. Declaration constraints are read only
  for declaration/property/variable handle families, then validated by the
  existing reader.
- Rejected/observed in this pass: moving the read before reference env prep was
  rejected because `inCall`, target/filter/read-mode/interpolation, leaky, and
  search-scope facts are part of the handle safety boundary. Stale design
  references to the deleted declaration facades were updated; remaining grep
  hits are occurrence helper names or explicit deletion notes.
- Evidence: focused `reference.test.ts` source-static handle test passed.
  Final gates are required before commit. No speed claim.
- Merge note: the branch also incorporates the latest serialization transport
  work from `origin/dev`; keep that progress tracked in
  `NODE-REWRITE-TRACKER.md` so this handoff remains the binding/lookup router.
- Merge-carried serialization review: aggressive-review danger tokens from
  `origin/dev` are serialization/node-row work, not new binding logic. The
  flagged loops are direct syntax/frame traversal in `ampersand.ts`,
  `at-rule.ts`, `reference.ts`, and `serialize-helper.ts`; the flagged
  `OutputWriter`, `BasicSelector(...).inherit(...)`, test `throw new Error`,
  `try/finally`, and spy arrays belong to that serialization merge. They are
  accepted as incoming dev state for this binding merge, with detailed
  ownership remaining in `NODE-REWRITE-TRACKER.md`. No speed claim.
