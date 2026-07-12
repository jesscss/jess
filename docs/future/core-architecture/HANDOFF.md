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

- Latest pass: PERF BATCH INTEGRATION — three disjoint byte-identical perf wins applied together onto `origin/dev`. (1) LEAN `round`: new `tree/util/round.ts` replaces `lodash-es/round` in `dimension.ts`/`color.ts` — an inlined copy of lodash's exact exponential-shift algorithm (same `Math.round`, same `${n}e`.split('e') dance) minus the generic `toNumber`/`toInteger` coercion, plus an integer fast-path; every Dimension/Color serialize + color-channel clamp hits it. (2) DE-GENERATORIFY walk (`node-base.ts`, `declaration.ts`): the generator `walk`/`nodes`/`_walkFromValue` become a non-generator `_walkInto(out, deep, reverse)` that materializes children into ONE shared `Node[]` in the exact same pre-order; `walk`/`nodes` now return that array (still iterable, so `for…of`/spread consumers are unchanged). Kills per-`yield`/per-`yield*`-frame cost and the per-node sub-array a deep generator allocated. (3) CALLABLE-LOOKUP INDEX (`rules.ts`): `getCallableEntriesForKey` was re-scanning every rule per distinct lookup key; now `ensureCallableIndex` builds the full key→entries index in ONE pass over `rules` and memoizes it on `_lookup.callableFullIndex`, invalidated alongside `callableLookupCache` when the scope's callable set changes. All three are byte-identical individually AND combined (full gate below).
- Architecture surface: three non-overlapping files under `packages/core/src/tree`. (1) `dimension.ts`/`color.ts` swap one import; `util/round.ts` is a new leaf pure-number helper with no node/tree/context reach. (2) `node-base.ts`/`declaration.ts` change the child-walk MECHANISM (generator → array-fill) but not what it walks — `childKeysOf`/`readNodeField`/field order unchanged; `Declaration` keeps its bespoke name/value/important order via an overridden `_walkInto`. (3) `rules.ts` touches only the callable-lookup memo path (`RulesLookupState.callableFullIndex`, `ensureCallableIndex`, `getCallableEntriesForKey`, the `addCallable*`/`collectCallablesFor` signatures that now take an `index` Map instead of a per-key `bucket`, and the invalidation site). No Node class gains a field; no output tree is retained by any of the three.
- Separation/duplication: (1) `round.ts` is a single new file that DELETES a dependency edge (drops `lodash-es/round` from two hot files) — it replaces, not duplicates. (2) `_walkInto` UNIFIES the former `walk` + `_walkFromValue` + `nodes` generators onto one array-fill primitive (net: `_walkFromValue` deleted, one polymorphic `_walkInto` added + two thin `collectFieldInto`/`pushNodeInto` module helpers that inline the old array/plain-object branch logic verbatim). (3) `ensureCallableIndex` REPLACES the per-key `collectCallablesFor(this, lookupKey, bucket)` re-scan; `addCallableEntry`/`addCallableSelectors`/`collectCallablesFor` lose their `lookupKey`+`bucket` params for a shared `index` Map — same collection code, keyed once instead of filtered per call.
- Cumulative node weight: no field added to any Node CLASS. `callableFullIndex` is one nullable field on the per-scope `RulesLookupState` memo object (a lookup-cache sibling of the existing `callableLookupCache`/`varsByName`/`functionsByName`), not on a Node; it holds references already reachable from `rules`, is built lazily, and is nulled on callable-set change. Net node weight delta = 0.
- New traversal: [loop/traversal] the new `for` loops in `collectFieldInto`/`pushNodeInto` (`node-base.ts`) are the SAME array + plain-object child iteration the deleted `_walkFromValue` generator ran — one pass over each child field, byte-identical DFS order, now pushing into a shared array instead of yielding. No new whole-tree or per-leaf pass: total node-visit count is unchanged (strictly fewer frames). `ensureCallableIndex`'s single pass over `rules` REPLACES the previous per-distinct-key re-scan — it runs once per scope and is memoized, so repeated lookups now do a Map get instead of re-walking; net traversal is REDUCED, not added.
- New node/materialization: [materialized array/object] the `Node[]` in `walk`/`nodes`/`_walkInto` is the deliberate core of win (2): ONE array shared across a whole deep walk, replacing the generator's per-`yield*`-frame allocations — fewer allocations, not more, and freed by the caller as before. `round.ts` allocates only the two transient `${n}e`.split('e') string pairs lodash already allocated (integer fast-path skips even those). No output tree is materialized by any change.
- Render path: byte-identical on all three. (1) `round` reproduces lodash's algorithm exactly (verified: all-less 106/106 byte-identical, which exercises Dimension/Color number formatting heavily). (2) `_walkInto` preserves pre-order and reverse order exactly, so every emit/eval/extend consumer of `walk`/`nodes` sees the identical node sequence. (3) the callable index returns the SAME entries `collectCallablesFor` produced (same key/match tuples, same source-rules fallback when the local index misses), so mixin/namespace resolution is unchanged. Full suites green (below).
- Helper/API surface: (1) `round.ts` exports `round` (named + default) — one new internal helper, one fewer external dep. (2) `walk`/`nodes` change return type from `Generator<Node>` to `Node[]` (both iterable — no call-site churn); `_walkFromValue` (private) is deleted; `_walkInto` (+ module-private `collectFieldInto`/`pushNodeInto`) added; net public method count unchanged. (3) `ensureCallableIndex` is a new PRIVATE method; `addCallable*`/`collectCallablesFor` are private and drop a param each. Net exported-symbol delta on the package surface = 0 (all additions are internal).
- Metadata mutations: none. No `.parent`/`sourceNode`/`sourceRoot`/`location`/`index`-field assignment in any of the three. `round` is pure over numbers. `_walkInto` only `out.push`es references. `ensureCallableIndex` writes only the memo field `_lookup.callableFullIndex` (a lookup cache, not node metadata) and the invalidation site nulls it.
- Review-flagged diff tokens: [loop/traversal] all new `for` loops are `collectFieldInto`/`pushNodeInto`'s field-child iteration (the deleted generator's own loops, same order, now array-filling) + `ensureCallableIndex`'s single memoized `rules` pass (replaces per-key re-scan) — zero hot-path/per-leaf traversal added, total visits reduced (accounted above). [generator] the two `[generator]` matches are the WORDS "per-yield / per-`yield*`-frame cost" and "`for…of` / `yield*` consumers are unchanged" in the new JSDoc — this change DELETES every generator (`function*`/`yield`) from the walk path; no generator is added. [node construction] the one `[node construction]` match is `index = new Map()` in `ensureCallableIndex` — a memoized per-scope lookup Map (NOT a Node construction; `Map` merely matches the `new Uppercase(` pattern), built once and reused, invalidated with `callableLookupCache`. [side map/set] every `Map` match is that same callable-index memo — the `callableFullIndex: Map<…>` field declaration, the `index: Map<…>` params threaded through `addCallable*`/`collectCallablesFor`, the `ensureCallableIndex(): Map<…>` return type, and the one `new Map()`; it holds already-reachable references, is a scope-scoped cache (sibling of the pre-existing `callableLookupCache`), and is nulled on callable-set change — zero added long-lived side state, and it REPLACES a repeated O(rules) per-key re-scan. [materialized array/object] the `Node[]` matches (`out: Node[]`, `const out: Node[] = [this]`, `const out: Node[] = []`, the `walk(): Node[]`/`nodes(): Node[]` signatures) are the shared per-walk output array that REPLACES per-yield generator-frame allocation — a net allocation REDUCTION; the `= {`-adjacent matches are type views, not output materialization. [parent/source mutation] the only `sourceNode`/`sourceRoot`/`.parent` matches are the WORDS in this prose (the Metadata line naming what is NOT written); the code performs zero `.parent`/`sourceNode`/`sourceRoot`/`location`/`index`-field assignment — `round` is pure over numbers, `_walkInto` only `out.push`es references, and `ensureCallableIndex` writes only the memo field.
- Evidence: all-less byte-identical 106/106 (the primary byte-for-byte oracle — exercises Dimension/Color number formatting, mixin/namespace callable lookup, and the child-walk on every fixture); core 3300/0; less-parser 516/0; all-less-error 92/0; `spine-production-ratchet` 130/0; fns 522/4 (the 4 reds are the pre-existing SCSS `is-bracketed()` set, untouched by these files). Combined `benchmark.less` A/B (same-worktree `git stash` toggle of the three applied changes, warmup + N≥15 median, output verified byte-identical) reported below in the integration deliverable. All three verified byte-identical individually by their originating agents and re-verified combined here.
- Verdict: accepted — three internal perf wins (drop a dep for an inlined pure helper; generator→shared-array walk; memoized full callable index replacing per-key re-scan), no new Node field, no tree mutation, no output tree, byte-identical output across the full gate.

--- prior pass ---

- Latest pass: bootstrap FINAL blocker (`bootstrap-clean-repro` GREEN) — LOOP-GENERATED EXTEND THROUGH IMPORT. Two coupled fixes: (a) `engageExtendLayer` scans only the parsed entry root, so an import-only document (`bootstrap.less` = `@import`s, no direct `:extend`) never engaged the layer and DROPPED every imported extend — `wireExtends` now also engages when a RESOLVED imported body carries an extend (`treeHasExtend`); (b) `wireSpineExtends`'s gather now EXPANDS `$for`/`each` loops (via `spineIterationSurfaces`) so a per-iteration interpolated extender (`.container-@{bp}`) resolves concretely and its `:extend` merges into the (static, shared) target group — plus `isSpineEligibleFor` now threads `allowExtend`, so a loop body carrying an `:extend` no longer forces its imported body onto the eval fallback (which ignores spine extend headers). The loop-expansion is BEST-EFFORT: an un-expandable loop (iterable/body reads a binding absent in the static gather context — e.g. a mixin-scoped `@shadows`) is caught and SKIPPED with a subjects/instructions rollback, byte-identical to the pre-fold drop. Bootstrap `.container-lg` now merges; render 156k, all 4 assertions pass.
- Architecture surface: `spine-extend.ts` gather (`wireSpineExtends` — `descendChildren`/`gatherRuleset` now `MaybePromise`, new `gatherForExtends`) and `emit-walk.ts` (`wireExtends` import-body extend-engagement + `isSpineEligibleFor` extend threading). The gather stays a pure selector-graph pass; it becomes async ONLY when it expands a loop (the common no-loop case is untouched sync). No Node class changed; no output tree retained — the loop surfaces are throwaway gather scaffolding (extenders emit nothing; only the static target's header override surfaces at emit).
- Separation/duplication: no new file. `gatherForExtends` reuses the render fold's `spineIterationSurfaces` primitive (the SAME per-iteration surface build) — not a parallel expander. The import-body engagement reuses `collectImportedRootSubjects` (already walked for the re-gate) + `treeHasExtend` (existing predicate, now imported into emit-walk). `isSpineEligibleFor` gains two params it forwards.
- Cumulative node weight: no field added to any Node class. The loop surfaces are the fold's existing reused-leaf copies, discarded after gather. Net: one gather helper + async-threading of two existing gather fns.
- New traversal: [loop/traversal] the new loops are `gatherForExtends`'s surface + surface-child iteration and the sequential `step`/`stepBody`/`stepSurface` drivers that replace the former `for…of` bodies (same single gather walk, now promise-threadable). No whole-tree/per-leaf hot-path traversal added — the gather runs once per root render, and the loop expansion runs once per extend-bearing `For` reached.
- New node/materialization: [materialized array/object] the `Rules[]` surfaces come from the unchanged `spineIterationSurfaces`; `gatherForExtends` allocates none of its own (the `as unknown as {…}` is a type view). `subjectsMark`/`instructionsMark` are index snapshots (numbers) for rollback, not allocations.
- Render path: unchanged. Both fixes only enrich the extend GATHER (a header-override computation consumed by `effectiveHeaderSelector`); the descent/emit is untouched. Byte-identical where no imported/loop extend exists (the layer stays disengaged) and where a loop can't expand (rollback → same drop as before). Full suites green.
- Helper/API surface: `wireSpineExtends` return type widens to `MaybePromise<{headers,hoisted}>` (its one production caller threads it; the sync test caller's shapes have no loop → still returns the object synchronously). `treeHasExtend` newly imported into emit-walk. `gatherForExtends` is a local closure. Net exported-symbol delta = 0.
- Metadata mutations: none. `gatherForExtends` save/restores `context.rulesContext` around each surface's gather (a transient live-frame pointer for interpolation resolution, not a node field); it never assigns `.parent`/`sourceNode`/`sourceRoot`/`location`/`index`. The rollback truncates the local `subjects`/`instructions` arrays only.
- Review-flagged diff tokens: [loop/traversal] every new `for`/`while` is the gather's own sequential driver (`step`/`stepBody`/`stepSurface`) or the surface iteration — the same one-per-root selector-graph walk, now promise-threadable; adds zero hot-path traversal (accounted above). [routine error control] the `try`/`catch` in `gatherForExtends` (+ the promise rejection handlers) implement the BEST-EFFORT skip: a loop that can't expand at gather time is caught, rolled back (subjects/instructions truncated to the pre-loop marks, `rulesContext` restored), and skipped — byte-identical to the pre-fold drop; they swallow ONLY the un-expandable-loop case (a real defer, not a silenced bug) and the `gatherRuleset`/media-scope `catch`es re-throw. [materialized array/object] the `Rules[]`/`= {` matches are the `spineIterationSurfaces` result type view + the arrow-fn closures; no output materialization (accounted above). [parent/source mutation] ZERO in the code — the `sourceNode`/`sourceRoot`/`.parent` matches are words in THIS prose and inside the unchanged `spineIterationSurfaces`; the gather writes no node field. [side map/set] the `Map`/`Set` matches are TYPE ANNOTATIONS only — the `Map<Ruleset, Selector>`/`Set<Rules>` on the widened `wireSpineExtends` return type and the `applyWired` closure param — zero map/set is CONSTRUCTED here (the headers map is composed by the unchanged `composeSpineSubjectHeaders`); zero added runtime side-map/set state.
- Evidence: `bootstrap-clean-repro` GREEN (render 156,635 bytes; `.col-sm-`, `--breakpoint-sm:576px`, `.container-lg` all present; zero rejections). New lock (`spine-guarded-mixin-forfold.test.ts` → "spine loop-generated extend through import"). Suites at pre-existing baseline: core 3300/0, all-less byte-identical 105/0, config 29/0, `spine-production-ratchet` 130/0, less-parser 512/0, 4 locks. The 12 `emit-walk-ratchet` + 3 `spine-wire-selector-shapes` (dual-config artifact) + 1 `security-script-runtime` reds are ALL pre-existing on clean `origin/dev` (verified by file revert) — this pass introduces zero new failures.
- Verdict: accepted — imported + loop-generated extend gather (best-effort loop expansion, rollback-on-unexpandable), no new Node field, no tree mutation, no output tree, byte-identical off the new shape, takes `bootstrap-clean-repro` to GREEN.

--- prior pass ---

- Latest pass: bootstrap spine blockers cont'd — EVAL-FALLBACK print-state isolation at TWO more sites in the import/root emitter (`rules.ts`). A container child (`isRulesetOrAtRule` → `n.render`) and a non-spine-foldable IMPORT body (`_emitSpineImportFold`'s `evalFallback` → `importNode.render`) both route to the EVAL render (`evalForRender` → `prepareRenderPrintState`), which RESETS `context.printState` in place; un-isolated in the single-pass spine that swapped the live writer/frame-arrays and silently DROPPED every later sibling/import (bootstrap `_reboot`'s `a { #hover({…}) }` — a detached-ruleset-arg mixin deferred to eval — dropped the whole following `_grid`; ~4× output recovered, 37,990 → 156,472 bytes). Both wrapped in the EXISTING `evalIsolatingSpinePrintState`; each `render` returns its own string spliced into the live writer.
- Architecture surface: `rules.ts` only — the two eval-render call sites in `_emitRulesBody`'s `emitNode` (`isRulesetOrAtRule` branch) and `_emitSpineImportFold`'s `evalFallback`. Both gated to `options.spineMode` (the `serializeRulesContainerInline` / non-spine branches are untouched). Same isolation primitive the guard/value-leaf resolves use. No Node class changed; no output tree retained.
- Separation/duplication: ZERO new helpers — reuses the already-exported `evalIsolatingSpinePrintState`. Two existing calls wrapped.
- Cumulative node weight: no field added to any Node class. No node state.
- New traversal: none — the wrap adds a shallow `context.printState` snapshot/restore around calls that already ran.
- New node/materialization: none — the snapshot is a shallow object spread of the existing print-state, freed on return; the eval renders already allocated their own writers.
- Render path: byte-identical — restores the live writer/frames after each eval render so the spliced string lands and later siblings emit normally (was: later content lost). Full suites green.
- Helper/API surface: unchanged — no new export (`evalIsolatingSpinePrintState` was exported in the prior pass).
- Metadata mutations: none — snapshot/restore of `context.printState` (a transient render buffer, not node fields); no `.parent`/`sourceNode`/`sourceRoot`/`location`/`index` write.
- Review-flagged diff tokens: [routine error control] the eval-render calls are wrapped in `evalIsolatingSpinePrintState`, whose EXISTING `try`/`catch` restores print-state on the throwing edge (unchanged helper, prior pass); the two new call sites add zero `try`/`catch`/`Error` of their own. [materialized array/object] the `= {` matches are the arrow-fn closures passed to `evalIsolatingSpinePrintState` (`() => n.render(…)`); they allocate no array/object — the isolator's shallow snapshot is pre-existing. [parent/source mutation] ZERO — no `.parent`/`sourceNode`/`sourceRoot`/`location` assignment; the wrapped `render` calls are unchanged.
- Evidence: minimal lock (`spine-guarded-mixin-forfold.test.ts` → "spine import eval-fallback print-state isolation") — an imported `a { #hover({…}) }` no longer drops a following import. Bootstrap: 37,990 → 156,472 bytes; `bootstrap-clean-repro` now passes length + `.col-sm-` + `--breakpoint-sm:576px` (was failing all); REMAINING red = `.container-lg` only (a nested `:extend(.container-fluid all)` from an interpolated `.container-@{bp}` inside `each`+`#media-breakpoint-up` detached rulesets + a `\%responsive-container` placeholder — a distinct spine-extend coverage item, NOT this pass; documented for continuation). Suites green: core 3300/0, all-less byte-identical 105/0, config 29/0, `spine-production-ratchet` 130/0, less-parser 512/0, 3 locks. The 12 `emit-walk-ratchet` reds remain PRE-EXISTING on clean `origin/dev`.
- Verdict: accepted — two eval-render sites print-state-isolated with an existing primitive, no new Node field, no tree mutation, no output tree, byte-identical, recovers ~4× dropped bootstrap output.

--- prior pass ---

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
