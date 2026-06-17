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

- Latest pass: `Ampersand` append/template selector assembly in
  `packages/core/src/tree/ampersand.ts`.
- Verdict: accepted as a mechanical callback-array staging cut. No speed claim.
- New traversal: indexed loops now replace callback `map(...)` staging in
  selector-list item text capture, template replacements, selector-list append,
  complex component ownership, and compound part ownership. These loops use
  arrays already needed for constructor boundaries or public placement state;
  carrying them earlier would either retain stale placement arrays or broaden
  selector ownership state.
- New node/materialization: no new production node/materialization semantics.
  The `BasicSelector(...).inherit(...)` template fallback was existing
  structural replacement behavior moved out of a `map(...)` callback; the
  `new Array(...)` allocations are the required result arrays for selector-list
  text state or owned selector constructors. The `rules([])` and `throw new
  Error(...)` tokens are test-only proof scaffolding.
- Render path: no direct render behavior changed. This pass keeps Ampersand
  eval/placement semantics and removes callback helper allocation while leaving
  existing selector ownership and public string boundaries intact.
- Helper/API surface: none.
- Metadata mutations: none.
- Allocation changes: removed callback result staging from the touched
  selector-list/template/compound/complex append paths; constructor arrays
  remain where new owned selector surfaces are semantically required. The
  existing template-string `.join(...)` fallback remains for non-structural
  template replacement and was not expanded.
- Rejected/observed in this pass: broader raw string assembly and structural
  selector replacement remain open in the Ampersand row.
- Merge-carried binding review: merging `origin/dev` also brought the
  namespaced reference-import crawl deletion in `rules.ts` plus focused
  import/mixin tests. Its new loops walk existing scope-frame, prefix-match,
  and direct-child-entry state to prove covered namespace uncertainty; the
  `Parser` construction, `try/finally`, and small spy arrays are test-only
  proof scaffolding from `import-style.test.ts` / `mixin.test.ts`, not
  production render/string transport.
- Evidence: focused `ampersand.test.ts` passed, including a selector-list
  append case that makes `selectors.map` throw; targeted ESLint passed; core
  package build passed. Root-level less-parser/Jess fixture invocations are
  currently red before test collection because Vite cannot resolve
  `@jesscss/core`; raw `tsc --noEmit` is also broadly red on current `dev`
  test/type drift, so those are not used as proof for this Ampersand slice.
- Merge-carried binding review: `findRulesetNamespacePathFast(...)` now
  prepares the visible
  callable frame chain for the namespace segment and checks visible child
  entries to prove uncovered child/reference-import uncertainty is limited to
  the ruleset-prefix body already being descended into. This replaces broad
  `findMixinsFast(...)` scans for the targeted `#Namespace` / `.mixin`
  reference-import array-path cases, including selector-list imported
  namespaces.
  No exported helper/API was added; helper logic lives in private `Rules`
  methods. It does not change render/stringification, and its focused
  import-style/mixin evidence passed before the merge. No speed claim.
- Merge-carried binding review: callable namespace child-surface bridge
  narrowing reuses existing scope-frame lookup and
  `findMixinsFastForUncoveredCallable(...)` child-entry narrowing. It does not
  change render/stringification or add public API; focused import-style/mixin
  evidence passed on the incoming branch. The flagged `try` blocks,
  `directCrawlHits` spy array, and optional `MixinEntry[]` collection are
  binding proof/bridge state, not serialization transport. No speed claim.
