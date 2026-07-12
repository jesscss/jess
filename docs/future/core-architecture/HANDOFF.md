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

## Aggressive Cutting Self-Prosecution

- Latest pass: bootstrap spine blockers — (a) LOOP-FOLD via the root / import-splice emitter (`Rules._emitSpineForFold`): a `$for`/`each` reaching `_emitRulesBody`'s `emitNode` (a root-direct loop, or one inside an imported body spliced via `_emitSpineImportFold`) now expands into per-iteration bound surfaces instead of falling to the `isChildRules` branch that emitted the body ONCE UNBOUND (`'color' is not defined` on a nested interpolated selector `.alert-@{color}`); (b) GUARD-EVAL print-state isolation (`serializeSpineFrameContainer`): a passing `when` guard whose operands render nested values (a function call, or a local var whose binding is a call) reset `context.printState` in place mid-descent and silently dropped the body — now isolated via `evalIsolatingSpinePrintState`.
- Architecture surface: the ROOT / import-splice emitter (`rules.ts` `Rules._emitRulesBody`'s `emitNode`) gains a `For`-route to a new sibling method `_emitSpineForFold` (mirrors the CONTAINER descent's existing `runSpineForExpansion` in `serialize-helper.ts` — same `spineIterationSurfaces` primitive, same `rulesContext = surface` frame thread as `processNode`). The guard-eval site in `serializeSpineFrameContainer` (`serialize-helper.ts`) is wrapped in the EXISTING `evalIsolatingSpinePrintState` isolation the value-leaf resolves already use. No Node class changed; no output tree retained.
- Separation/duplication: no new file. `_emitSpineForFold` is the emitter-side analogue of `runSpineForExpansion` — it REUSES `For.spineIterationSurfaces` and `evalIsolatingSpinePrintState` (newly EXPORTED from `serialize-helper.ts`, previously a private helper — a visibility change, not a new mechanism). It does not duplicate the container fold's dedup/merge re-plan (not needed for the root/import splice; a loop that needs cross-iteration merge stays a follow-on). The guard fix adds ZERO helpers — it wraps an existing call in an existing isolator.
- Cumulative node weight: no field added to any Node class. No node state. Net: one method (`_emitSpineForFold`) + one newly-exported existing helper.
- New traversal: [loop/traversal] the two new loops live in `_emitSpineForFold` — an OUTER loop over the loop's per-iteration surfaces and an INNER loop over each surface's already-materialized children, driving the SAME `emitNode` the container fold drives. This is the loop-expansion the eval path performs per iteration; it runs once per `For` node reached (not per leaf, not on a hot per-node path beyond the iteration it represents). No whole-tree scan added.
- New node/materialization: [materialized array/object] the `Rules[]` surfaces are produced by the EXISTING `For.spineIterationSurfaces` (unchanged) — the fold only ITERATES them; `_emitSpineForFold` allocates no array/object of its own (the `as unknown as {…}` is a type view, not an allocation). No output tree is built; each surface child emits through `emitNode` exactly as an authored child would.
- Render path: both fixes are byte-identical to eval. The loop-fold makes an import/root loop render its per-iteration bound bytes (was: throw or unbound-drop); the guard-isolation makes a passing guard's body survive (was: silently dropped into a swapped writer). Neither alters output where it already matched — the guard isolation only restores the live writer, and simple guards with no rendering operand pay a shallow snapshot.
- Helper/API surface: `evalIsolatingSpinePrintState` changes from module-private to EXPORTED (`serialize-helper.ts` → `rules.ts`), the same one-consumer export shape the file's other spine helpers use. `_emitSpineForFold` is a PRIVATE method (no public API). Net exported-symbol delta = +1 (an existing helper, now shared).
- Metadata mutations: none by the new code. `_emitSpineForFold` save/restores `context.rulesContext` around each child emit (the `processNode` frame-thread discipline — a transient live-frame pointer, not a node field write); it never assigns `.parent`/`sourceNode`/`sourceRoot`/`location`/`index`. The surfaces' own frame wiring is done by the unchanged `spineIterationSurfaces`.
- Review-flagged diff tokens: [loop/traversal] the two `for` loops are `_emitSpineForFold`'s surface + surface-child iteration — the loop-expansion the eval path already does per iteration, driving the existing `emitNode`, once per `For` reached; adds zero whole-tree/hot-leaf traversal (accounted above). [routine error control] the two `try`/`catch` are the frame-restore discipline required by the async splice — each restores `context.rulesContext` to its saved value on the throwing edge before rethrowing (mirrors `runSpineForExpansion`/`processNode`'s existing `restoreFrame` on-error path), so a failed child emit cannot leak the surface frame onto the shared context; they introduce zero fresh error TYPE and swallow nothing (every catch rethrows). [materialized array/object] the `Rules[]` view + `= {` object-literal matches are the type assertion `as unknown as { spineIterationSurfaces… }` (a compile-time view, no allocation) and the arrow-fn bodies; the only real array (`surfaces`) is produced by the unchanged `spineIterationSurfaces` and merely iterated — no output materialization (accounted above). [parent/source mutation] ZERO in the code — the `sourceNode`/`sourceRoot`/`.parent` matches are words in THIS prose (the Metadata line naming what is NOT written) and inside `spineIterationSurfaces`'s pre-existing surface build (unchanged by this pass); `_emitSpineForFold` and the guard-isolation wrap perform no `.parent`/`sourceNode`/`sourceRoot`/`location` assignment.
- Evidence: minimal repros byte-identical to eval + less@4 — (a) `each(@map,#(@value,@key){ .item-@{key}{ #mixin(@key) } })` inside an imported body folds per-iteration (was `'…' is not defined`); (b) `#fs(inherit)` two-level RFS-shape guarded mixin in a nested ruleset emits its `font-size` (was dropped). Bootstrap: was THROW `'color' is not defined`; now renders clean (no throw, no rejections) — remaining truncation is a SEPARATE full-bootstrap-only value/grid divergence (a `#border-radius` value `0.2rem` vs `0.25rem` + a grid `.row`/`make-grid-columns` drop that does NOT repro in the 6-import `code+grid` slice, which is now byte-identical) — documented for continuation, not this pass. Suites green: core 3300/0, all-less byte-identical 105/0, config-fixtures 29/0, jess `spine-production-ratchet` 130/0, 2 NEW locks (`spine-guarded-mixin-forfold.test.ts`). The 12 `emit-walk-ratchet` reds are PRE-EXISTING on clean `origin/dev` (verified by file revert) — not introduced here.
- Verdict: accepted — two byte-identical spine correctness fixes (import/root loop-fold coverage + guard-eval print-state isolation), no new Node field, no tree mutation, no output tree, one existing helper newly shared.

--- prior pass ---

- Latest pass: benchmark spine blockers — (a) APPEND×EXTEND gate PRECISION (replace whole-tree over-reject with a collision-only predicate); (b) REFERENCE-EXTEND unmapped-target FOLD (an absent import-reference target is inert, not an abort-to-eval).
- Architecture surface: the spine ELIGIBILITY/TOPOLOGY gates only — `isSpineEligibleRoot` (`emit-walk.ts`) and `isSpineExtendTopology` (`extend/spine-extend.ts`). These decide spine-vs-eval; they emit nothing and touch no output node. No change to the render path, the fold splice, or any Node.
- Separation/duplication: no new file. Added ONE predicate `treeHasExtendTargetableAppend` (`spine-extend.ts`) that REPLACES the deleted `treeHasAmpersandAppend` (`emit-walk.ts`, ~24 lines removed) — a swap, not an addition: the old gate rejected ANY append+extend tree; the new one rejects only when an extend target atom could equal an append-generated atom (`parent + suffix`). The reference relaxation REUSES the existing per-target `isInertNomatch` clause (adds a `reGateResolved` guard + an imported-subject inertness check), not a new mechanism.
- Cumulative node weight: no field added to any Node class. No node state. Net helper count unchanged (one predicate added, one deleted).
- New traversal: [loop/traversal] every new loop lives in `treeHasExtendTargetableAppend`, a SOURCE-TREE eligibility predicate that runs ONCE per ROOT render (not per node, never on the hot leaf/emit path). It is a traversal SWAP: the deleted `treeHasAmpersandAppend` already walked the whole ruleset/at-rule tree + each selector (via `selectorHasAmpersandAppend`); the new walk does the same single pass and additionally collects append suffixes/atoms + extend-target atoms in the same visit. The `node.walk(true)` inside `selectorAppendSuffixes` walks ONE selector's small node tree (identical cost to the deleted append-detector). The reference relaxation's `[...importedRootSubjects].some(...)` iterates the RESOLVED-imported-subject set (small) only in re-gate mode (import+extend trees) per unmapped target — bounded by imported-subject count, off entirely for the no-import common case.
- New node/materialization: [side map/set] + [materialized array/object] the 3 `Set`s (`suffixes`, `generatedAtoms`, `targetAtoms`) and the `string[]` returns of `selectorAtoms`/`selectorAppendSuffixes` are DECISION-TIME SCRATCH inside the predicate — allocated on entry, freed on return, sized O(appends + extends) for that one root, NEVER attached to a node, the render state, or an output tree. They exist because the collision decision needs the atom sets; they replace the old gate's boolean-only short-circuit. No output materialization (this path emits nothing).
- Render path: UNCHANGED. Both outcomes are byte-identical to eval — admit → spine fold (`deriveCalls===0`), reject → eval two-walk. The predicate cannot alter output; it only routes.
- Helper/API surface: `treeHasExtendTargetableAppend` is exported from `spine-extend.ts` and imported by `emit-walk.ts` (the same one-consumer shape the deleted `treeHasAmpersandAppend` had, just relocated to where the extend gather helpers live). Net exported-symbol delta ≈ 0.
- Metadata mutations: none. The predicate is pure over the source tree (`flatLocalSelector`/`valueOf` reads only); no `.parent`/`sourceNode`/`sourceRoot`/index/location write. The reference relaxation reads `importedRootSubjects` (already resolved by `wireSpineImports`) — no mutation.
- Review-flagged diff tokens: [loop/traversal] all new loops are the once-per-root eligibility predicate `treeHasExtendTargetableAppend` swapping in for the deleted whole-tree `treeHasAmpersandAppend` scan — same single source-tree pass, no hot-path/per-node traversal added (accounted above). [side map/set] the 3 `Set`s are per-call decision scratch, freed on return, never node/render state (accounted above). [materialized array/object] the `string[]` atom lists + the `walk` closure's `parentAtoms` array are decision-time scratch, no output materialization (accounted above). [parent/source mutation] ZERO — the only matches are the identifier names `parentText`/`parentAtoms` (the COMPOSED-PARENT selector TEXT threaded read-only through the walk to compute append-generated names) and this prose; the code performs no `.parent`/`sourceNode`/`sourceRoot` assignment — the predicate never writes any node field.
- Evidence: append+extend UNRELATED folds (`deriveCalls===0`), append-GENERATED-target extend STAYS on eval (byte-identical), reference-extend absent-target folds as a no-op (empty, = eval + less@4), reference-extend present-target still folds. Suites green: core 3300/0, jess `spine-production-ratchet` 130/0 (incl. 4 new locks), all-less 105/0, less-parser 508/0. Perf A/B (same-build spine-vs-eval toggle, warmup 8 + 15-trial median, byte-identical output): a 60-block append+extend workload folds 19.4ms vs eval 26.8ms (1.38×); a 60-extend reference workload folds 10.1ms vs eval 18.1ms (1.80×). NOTE: `benchmark.less` itself still does NOT fold spine-only — it is additionally blocked by mid-body `@charset` (design-excluded document framing) and the direct-merge-alongside-mixin-call deferred residual; those are separate items, not this pass.
- Verdict: accepted — deletes the whole-tree append+extend over-reject for a collision-only predicate and folds the inert reference-extend case, both pure routing decisions, no node state, no tree mutation, no render-path change, byte-identical both ways.

--- prior pass ---

- Latest pass: STRIPE nested-container recursion fold (distinct-per-level container surfaces) + gate lift.
- Architecture surface: the spine mixin-fold splice (`serialize-helper.ts` `runSpineMixinExpansion`), the recursion eligibility gate (`emit-walk.ts` `treeHasRecursiveMixinCall`, now DELETED), and the root-fold statement-validity guard (`check-valid-nodes.ts`). Ownership stays where it was: the fold splice owns per-placement projection; the gate owned deferral (now unneeded); the guard owns root value-drop detection.
- Separation/duplication: no new helper file. `distinctFoldChild` is a small local closure inside `runSpineMixinExpansion`, mirroring the loop fold's existing per-iteration `copyWithReusableLeaves` — it UNIFIES the two folds on the same projection primitive rather than adding a parallel mechanism. Deleted `treeHasRecursiveMixinCall` (~95 lines) + its call site; the recursion gate is gone, not relocated.
- Cumulative node weight: no field added to any Node class. The seen-tracker is a per-pass local `WeakSet`, not node state. Net: one gate function removed.
- New traversal: none added. `distinctFoldChild` does an O(1) type test + `WeakSet` membership per spliced child (no loop). The deleted gate removed a document-level `root.walk` cycle-detection pre-scan — a net traversal DELETION on the eligibility path.
- New node/materialization: `copyWithReusableLeaves(child)` fires ONLY on a container child's 2nd+ occurrence within one expansion pass (recursion re-entry / repeated call) — the exact placements that would otherwise COLLAPSE to one printed block. First occurrence stays SHARED (zero copy on the common single-call container mixin); scalar leaves never copied. This is the SAME reused-leaf placement copy the loop fold already pays per iteration — a projection giving each level its own printed-block identity, not a deep clone and not a tree mutation.
- Render path: unchanged shape — the copy is a serialize-time projection consumed immediately by the existing `processNode` descent; no output tree retained. `checkValidNodes` now skips `Call`/`Mixin` (statement-legal, expanded by the pass) so the spine root-fold can check a recursive body's RAW surface without false-flagging the unexpanded recursive call — a no-op on the eval path (which only ever sees post-expansion output).
- Helper/API surface: no exported API added; `copyWithReusableLeaves` is an existing import. One local closure added, one gate function + call deleted → net API surface reduced.
- Metadata mutations: `copy.index = child.index` carries the splice-order index onto the placement copy (output-invisible bookkeeping, ruling 1); no `.parent`/`sourceNode`/`sourceRoot`/location mutation. The shared canonical node is never mutated.
- Review-flagged diff tokens: [array helper] the single `surface.rules.map(...)` is the PRE-EXISTING fold-splice map, only its element expression changed (`child` → `distinctFoldChild(child)`) — same iteration, one wrapped call. [copy helper] `copyWithReusableLeaves` (1 call + 1 import + 3 comment mentions) is the loop fold's own reused-leaf projection primitive, applied only to 2nd+ container occurrences; justified as the distinct-per-level surface projection above, reusing the existing copy family. [parent/source mutation] the only matches are the words in THIS prose (the Metadata line naming what is NOT mutated); the code performs zero parent/source/location assignment — the placement copy is a fresh detached surface, the canonical node is never re-parented.
- Evidence: STRIPE self/mutual/≥3-level/root-scope/interpolated-selector recursion folds `deriveCalls===0`, distinct-per-level blocks, byte-identical to the eval toggle + less@4 (`lessc 4.6.3` diff clean on the recursion mechanism). Suites green: core 3300/0, jess `spine-production-ratchet` 126/0, all-less 105/0, error 92/0, less-parser 508/0. Perf A/B (same-worktree revert toggle, warmup + N median): STRIPE fixture folds faster than eval; benchmark neutral (stays on eval either way).
- Verdict: accepted — deletes the recursion gate + its pre-scan traversal, folds STRIPE via the loop fold's existing projection primitive, no new node state, no tree mutation.

## History

Landed design/plan/readout/audit docs and this router's former pass-by-pass
`Aggressive Cutting Self-Prosecution` log live in **`archive/`** (see
`archive/README.md` for the index). Full content is preserved — read one when you
need the *why/how* behind a shipped mechanism. Notably `archive/HANDOFF-history.md`
holds the self-prosecution log.
