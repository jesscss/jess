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

- Latest pass: binding/lookup setDefined helper collapse, public-wrapper
  guard hardening, and namespaced reference-import bridge proof.
- Verdict: accepted as a helper-surface deletion plus executable proof. No
  speed claim.
- New traversal: no production traversal added. A focused import-style test
  now spies on `findMixin(...)` / `findMixinsFast(...)` to distinguish authored
  array-path replay from generated fallback arrays for the namespaced
  reference-import fixture. The verifier adds grep/array checks over source
  text only; they are not runtime lookup traversal.
- New node/materialization: none. `DirectDeclarationLookupResult` is a
  type-only alias for the pre-existing setDefined readonly fallback object; it
  remains limited to the cold setDefined fallback path, not hot ordinary reads.
- Render path: no committed render/stringification path change.
- Helper/API surface: deleted the two family-specific readonly occurrence
  helper exports and replaced them with one setDefined-only helper. The binding
  hot-path verifier now guards the direct declaration lookup export surface and
  rejects production runtime calls to public `Rules.find*` declaration
  wrappers. The verifier's `try` / `catch` blocks are script-only negative
  grep control flow.
- Metadata mutations: none.
- Allocation changes: ordinary occurrence reads cannot allocate the
  `{ occurrence, readonly }` wrapper through an option branch; wrapper
  allocation remains limited to the single setDefined readonly helper.
  `VarDeclaration.copy` appears only in a focused test name proving the
  assignment path avoids that copy machinery.
- Evidence: `pnpm run verify:binding-lookup-hot-paths`, `pnpm --filter
  @jesscss/core exec vitest
  src/tree/__tests__/rules.test.ts --run --testNamePattern "fails to set if
  existing variable is readonly|derives setDefined declarations without calling
  VarDeclaration.copy|updates static setDefined variables without deriving
  placement declarations|updates modeled setDefined live binding cells without
  direct occurrence crawl|does not build a scope frame just to try setDefined
  live binding writes" --reporter=dot`,
  `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/import-style.test.ts --run --testNamePattern "namespaced
  reference-imported ruleset array-path lookups" --reporter=dot`,
  `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/reference.test.ts --run --testNamePattern "setDefined
  variable assignment uses occurrence lookup without Rules.findVariable|
  setDefined current-cell probes do not use historical declaration buckets|real
  Less merge-chain property refs avoid public lookup bridges" --reporter=dot`,
  `pnpm --filter @jesscss/core exec vitest src/tree/__tests__/mixin.test.ts
  --run --testNamePattern "namespace fast path: mixin-ruleset path unions
  plain namespace rulesets with callable namespace mixins|routes mixin
  setDefined writes through the resolved caller binding|evaluates mixin
  setDefined writes from live parameter bindings" --reporter=dot`,
  `pnpm --filter @jesscss/core exec vitest src/tree/__tests__/control.test.ts
  --run --testNamePattern "setDefined writes" --reporter=dot`, `pnpm exec
  eslint scripts/verify-binding-lookup-hot-paths.mjs
  packages/core/src/tree/util/direct-rules-lookup.ts
  packages/core/src/tree/rules.ts
  packages/core/src/tree/__tests__/import-style.test.ts
  packages/scss-parser/test/baseline.test.ts`, `pnpm run
  verify:aggressive-cutting-review`, `pnpm --filter @jesscss/core build`, and
  `pnpm --filter @jesscss/scss-parser build` passed. No speed claim.
