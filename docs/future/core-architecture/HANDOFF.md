# Core Architecture Handoff

This is the active runbook for Jess core architecture work. Keep it short and
operational.

Use the four-doc split:

1. `HANDOFF.md`: how to perform the next pass, the active work, gates, focus
   spec, and completion steps.
2. `AGGRESSIVE-CUTTING-REVIEW.md`: hardline patch-shape rules.
3. `PERFORMANCE-HANDOFF.md`: benchmark/profile protocol, evidence history,
   target queues, and rejected experiments.
4. `NODE-REWRITE-TRACKER.md`: node-by-node rewrite table and completion
   status.

## How To Work

1. Read this handoff first.
2. Read `AGGRESSIVE-CUTTING-REVIEW.md` before changing AST, eval/render,
   lookup, traversal, copying, inheritance, output writer, source/root metadata,
   or this handoff.
3. Read `PERFORMANCE-HANDOFF.md` before making or accepting any speed claim, or
   before touching a measured hot path.
4. Start each non-correctness pass from the benchmark leash below.
5. State one hypothesis before editing.
6. Make the smallest behavior-preserving cut that removes measured work or
   clearly wrong machinery.
7. Run focused tests first, then the required gates.
8. Keep, reshape, or revert based on the benchmark evidence and the aggressive
   cutting self-prosecution.
9. Commit and push the completed pass.

## Focus Spec

Active mode: **benchmark-leashed aggressive cutting**.

The goal is the fastest credible path from parsed Less to CSS output:

- one canonical source tree;
- live lookup/binding/placement state instead of routine copied eval trees;
- direct eval/render-to-string for normal output;
- cold materialization only for public APIs or real semantic ownership
  boundaries;
- fewer hot-path objects, arrays, traversals, helper calls, branch ladders,
  promise/generator states, and metadata mutations.

Less is the optimizing path. Preserve SCSS-enabling seams only when they are
concrete and cheap or isolated behind cold extension boundaries.

Work shape: go node by node and method by method. For each target, prove the
current output with focused tests, rewrite the method toward structural facts
and straight-line boring JavaScript, then rerun the same output tests. Reject
text inspection, callback-array helpers, nested hot closures, defensive generic
probes, and helper wrappers unless the method cannot preserve behavior without
them. Track each completed node in `NODE-REWRITE-TRACKER.md`.

## Active Work

Correctness queue: no active correctness blockers. If a `.less` fixture fails
to parse/evaluate, add a focused repro before changing expected output. If CSS
differs, review semantics manually before changing tests.

Benchmark leash:

1. Record a post-selector/callable-cut stable hot-path snapshot.
2. Profile broad `benchmark.less`.
3. Choose the next deep cut from measured evidence, not smell alone.
4. Rerun the same benchmark/profile after the patch.
5. Keep the patch only if it improves real runtime cost, removes measured
   object/memory pressure without slowing runtime, or fixes correctness.

Immediate benchmark commands are defined in `PERFORMANCE-HANDOFF.md`.

Next deep-cut queue:

0. [x] Move callable `default()` guard classification out of
   `prepareCallableEvalCandidates(...)`. Parsed Less now passes explicit
   `hasDefault: true | false` for guarded mixins/rulesets, and the hot
   candidate loop trusts carried metadata instead of recursively scanning
   guards.
1. [x] Return static non-rules-like reference values directly. `Reference`
   no longer copies static source-backed lists/sequences merely because they
   have children, and the old source-free container child scans are gone.
2. [x] Replace generated `PseudoSelector.renderPseudoSyntax(...)` comma
   inspection with a structural selector-list item-count decision. Output is
   still rendered, but render text no longer decides whether to unwrap.
3. [x] Complete the first node rewrite pass: `PseudoSelector`. Removed the
   generated render-state helper/object allocation, removed the render-text
   comma predicate, skipped wrapper capture when structurally unwrapping, and
   deleted a dead commented keys experiment.
4. [x] Start the `Reference` node rewrite pass with the class render/eval
   surface. Deleted two alias predicate wrappers, removed the useless Promise
   identity wrapper in `evalNode(...)`, and flattened `render(...)` so the
   synchronous direct static-reference path no longer allocates local render
   closures before doing the raw lookup. Also deleted the option-fragment spread
   helpers and the scope-array recursive walker from rules lookup.
5. [x] Continue `Reference` pass 2. Deleted lookup/result classification
   wrappers, fallback predicate wrappers, materialization dispatch wrappers, the
   `resolveInitialReferenceTarget(...)` runtime-key IIFE, and small
   `findVarDeclarationFast(...)` result/IIFE object allocations.
6. [ ] Continue `Reference` before moving to the next node. Audit and cut the
   remaining copy/materialization pressure: `createRulesLikeReferenceSurface`,
   `evaluateReferenceValueNode(...)`, declaration finalization, merged assign
   normalization, and the remaining `.inherit(...)`/`copyWithReusableLeaves(...)`
   ownership boundaries.
7. [ ] Sweep `Ampersand` template placement next. Replace
   `toTrimmedString().includes(',')` and string splitting with selector-list
   structure and placement state; only final CSS output may stringify.
8. [ ] Sweep selector matching/extend equality. Replace hot `valueOf()` equality
   predicates with structural/keyset checks where possible, keeping
   `valueOf()` only as a measured, cached fast-path when it wins.
9. [ ] Split `Node.evalStatic(...)` into immediate eval/render and cold public
   materialization so routine eval replacement does not imply `.inherit(...)`.
10. [ ] Replace `StyleImport` first-use placement copies with placement state
   that points at canonical source children and preserves import visibility.
11. [ ] Collapse `StyleImport.deriveRulesSurface(...)` wrappers whose only job
   is source/visibility/placement bookkeeping.
12. [ ] Replace remaining `Rules` merge output copies with direct merge
   placement/render state or a narrow owned-item copier proven by merge tests.
13. [ ] Convert registration-prep expected misses away from routine `try/catch`
   only after adding tests for unresolved declaration/identity behavior.
14. [ ] Continue selector/extend factory cuts separately; do not hide selector
   placement copies inside another generic copy helper.
15. [ ] Replace callable binding copies for static containers with explicit
   binding/placement state. Static containers should not be copied merely
   because they contain child nodes; `F_HAS_NODE_CHILD` is only a cheap current
   ownership boundary, not a final architecture.
16. [ ] Attack the measured copy stack next: `copyChild`,
   `copyWithReusableLeaves`, `copyCallableRulesValue`, `constructCopy`, and
   `.inherit(...)`. CPU evidence says these are mostly registration derivation,
   selector header rendering, JS function argument ownership, reference value
   eval, and binding clone debt; do not justify them as render output copying.
17. [ ] Audit repeated callable/mixin evaluation from the profile before making
   more local helper cuts. If a mixin candidate or output body is evaluated
   more than the semantic call count requires, carry placement/binding state or
   cache the cold public materialization boundary instead of copying/evaluating
   again.

## Gates

Before editing:

- Build or inspect the relevant code path.
- Capture or identify the benchmark/profile target when touching hot paths.
- State the hypothesis in this handoff or in the working notes for the pass.

Required before commit:

```sh
pnpm run verify:aggressive-cutting-review
git diff --check
```

Also run the smallest focused tests for touched behavior.

For performance work, use the exact before/after benchmark/profile lane from
`PERFORMANCE-HANDOFF.md`. Do not report profiler elapsed time as app runtime;
label evidence as real benchmark, instrumented profiler, or CPU profile.

Use `pnpm run verify:baseline -- --changed` when the touched area needs the
broader gate. If Vitest workers stall, report it as inconclusive; do not mark
the gate passed.

## When Done

1. Update the queue item status.
2. Update the self-prosecution block below with exact files/functions and a
   clear verdict.
3. If the pass produced benchmark/profile evidence, add the evidence summary to
   `PERFORMANCE-HANDOFF.md`.
4. If the pass changes the cutting doctrine, update
   `AGGRESSIVE-CUTTING-REVIEW.md`.
5. Run gates.
6. Stage only related files.
7. Commit and push.
8. Report:
   - commit hash;
   - machinery deleted, rejected, or deferred;
   - focused tests and gates;
   - benchmark/profile result or why it was inconclusive;
   - intentionally dirty unrelated files.

## Aggressive Cutting Self-Prosecution

- New traversal: none added. Pass 2 removed a per-scope IIFE/object in
  `findVarDeclarationFast(...)` but kept the existing lookup walks unchanged.
  No parent/source walk, side-map lookup, recursive scan, `map`, `filter`,
  `sort`, generator, or new object/array scan was added.
- New node/materialization: none. No new `Node`, copy, wrapper `Rules`,
  `.inherit(...)`, `.adopt(...)`, `copyWithReusableLeaves(...)`, `frozen`, or
  parent/source metadata mutation was added. Remaining existing
  `.inherit(...)`, `copyWithReusableLeaves(...)`, `new Any`, `new Nil`,
  `new List`, `new Reference`, `new MixinCollection`, and shallow rules-like
  surface construction paths are not solved by this pass and stay queued as
  ownership/materialization debt.
- Render path: unchanged by pass 2. The previous direct raw static-reference
  render cut remains; this pass only removes helper/object scaffolding around
  lookup, fallback, target materialization, and result finalization.
- Helper/API surface: deleted `ReferenceLookupResultKind`,
  `classifyReferenceLookupResult(...)`, `copyReferenceResultNode(...)`,
  `canRenderFallbackContainerDirectly(...)`,
  `canUseDynamicFallbackScalarDirectly(...)`, `canReuseFallbackValue(...)`,
  `createRulesLookupAdapter(...)`, `createCallableLookupAdapter(...)`,
  `materializeMixinCollectionTarget(...)`,
  `materializeJsFunctionTarget(...)`, and
  `materializeRulesLikeTarget(...)`. No public API was added.
- Metadata mutations: none. No parent restoration, `frozen`, inherited
  location/source metadata, lazy options/context creation, `Reflect.*`, or
  `Object.hasOwn(...)` was added. The `scope.parent` / `scope.sourceNode`
  structural read inside `findVarDeclarationFast(...)` already existed; it only
  moved because the surrounding IIFE/object allocation was removed.
- Evidence: focused Reference-family output tests passed after the rewrite:
  `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/reference.test.ts src/tree/__tests__/mixin.test.ts
  src/tree/__tests__/declaration.test.ts src/tree/__tests__/ruleset.test.ts
  src/tree/__tests__/list.test.ts src/tree/__tests__/sequence.test.ts
  src/tree/__tests__/condition.test.ts src/tree/__tests__/operation.test.ts
  --run` (`410` tests). `pnpm --filter @jesscss/core build` and
  `pnpm exec eslint packages/core/src/tree/reference.ts` also passed. This is
  accepted as method-level machinery deletion, not as a speed claim.
  `pnpm run measure:less:hotpath -- --stable` was run as a leash sanity check:
  `functions` median `12.70ms`, `import-reference` `18.21ms`,
  `mixins-guards` `17.01ms`, `extend-chaining` `5.13ms`, and `media`
  `6.33ms`; all signals were usable. Because this pass did not capture a clean
  before/after pair, that benchmark is status only.
- Verdict: accepted as `Reference` pass 2 only. Do not mark `Reference`
  complete until the remaining lookup/finalization/copy helpers are audited and
  either cut or explicitly isolated as cold/public materialization.
