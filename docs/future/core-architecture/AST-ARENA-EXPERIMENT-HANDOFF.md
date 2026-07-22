# AST arena — standing experiment handoff

> **ARCHIVED ARCHITECTURE CORRECTION (2026-07-22).** The earlier owner-ratified
> tree2-destination/staged-front-end direction recorded below is superseded. The
> public destination is AST-v2 `Stylesheet` from each dialect's direct Parseman
> `parse()` reduction; no tree2 front-end flip, bridge, or host stage is required.
> Retain this file only as performance/design evidence, and do not treat its
> roadmap or branch instructions as active work.

Status: ARCHIVED experiment log, opened 2026-07-15. It is not an active handoff or
destination plan. New performance work follows `HANDOFF.md` and must measure the
public direct parser/evaluator route.

## Mission

Find a core AST *representation* that renders `benchmark.less` toward Less 4.x's ~37ms
(we are at ~215–250ms, ~6–7×). This is the "arena" idea: a packed / shared / columnar
representation that makes the dominant cost cheap **by construction**, rather than shaving
it 5% at a time. The incremental levers (extend pre-reject, etc.) are landing separately;
this track is for the departures too big to bolt onto the current node model.

## Non-negotiable guardrails

1. **Byte-identity is the reference.** `benchmark.less`, `collapseNesting:true` →
   131578 bytes, sha `98a0536086c7e555`. No experiment counts as a "win" unless output is
   byte-identical (and all-less byte-identity holds). A representation that can't reproduce
   the bytes is not a candidate, no matter how fast.
2. **Predict before building.** Follow `CORE-CLEANUP.md` → "Predict before building":
   profile the real fixture first, state the expected win (profile-fraction × reduction −
   the new machinery's own cost), and treat a sub-threshold bet as a no-go. Synthetic
   microbenchmarks are DISQUALIFIED — only same-worktree A/B on the real fixture counts.
3. **HARD MODULE BOUNDARY: no `tree2/` file may import from `../tree` — anywhere, not
   just the hot path (owner, twice-emphasized, non-negotiable).** `tree2/` is a CLEAN-ROOM
   rewrite. It writes its OWN base node, its OWN Declaration/Rule/value nodes, its OWN
   byte-faithful serializer — it does NOT borrow node types, helpers, serializers
   (`writeSyntax`/`valueOf`), extend, or materialization from `../tree`. "Byte-faithful"
   means reproduce the exact OUTPUT BYTES `../tree` emits; it does NOT mean mirror `../tree`'s
   serialization METHOD (the owner said "absolutely not" — the legacy serializer may itself
   be too heavy, so porting it would inherit the problem). Only neutral context/config
   objects may cross the boundary. Enforced mechanically: `grep -rn "\.\./tree\b\|from
   '.*tree/" packages/core/src/tree2` must be empty (sibling tree2 refs only), plus a vitest
   guard (`tree2-harness/__tests__/boundary-guard.test.ts`) that parses every tree2 import
   specifier and fails on any legacy-tree reference. The OLD side of the comparison lives in
   the harness (`tree2-harness/`), never inside `tree2/`. A build that borrows from `../tree`
   is meaningless and will be discarded. (The first arena POC failed *specifically* by
   violating this: it reused `extend.ts`/node materialization, was emit-only after full eval,
   and was hard-disabled under `collapseNesting:true` — it moved benchmark by **zero**. That
   POC is preserved on branch `feature/greenfield-ast-design-20260714` as the anti-pattern;
   it is NOT on `origin/dev`.)
4. **Measure allocation AND time, but trust TIME.** "Fewer allocations" has been a false
   signal all session (GC is ~5%). A departure must reduce wall-clock on the real fixture,
   not just an allocation counter.

## What the profile actually says (2026-07-15 — do not re-derive; verify if in doubt)

The gap is **NOT**: pass-count (the single-eval-emit "spine" flip benched *slower*),
async (~0%, `isThenable` fast-path), allocation-as-GC (~5%), value leaves (Dimension 1,609
/ Color 613 — ~2%), grammar-at-render (measured false — grammar is 100% parse-phase),
or nesting-collapse (`composeSelector` runs only ~2,490×/render).

The gap **IS**: **eval-time per-placement SELECTOR reconstruction during mixin expansion**
— `withComponents` / `cloneForPlacement` produce **~73,005 selector constructions +
~35,033 `inherit` provenance-copies per render**, and the profile is **FLAT** (no dominant
frame), so incremental sniping caps ~5%. The extend step (`processExtends`, ~50ms) is the
one concentrated exception and is being optimized separately. **Less renders in ~37ms with
a plain object AST by doing each thing once** — so the target is reachable; jess's problem
is doing ~6× the per-node work, concentrated in per-placement reconstruction.

## Owner architectural steers (authoritative — these are the seeds for the departures)

- **"Selectors should not be cloned for placement unless placed in a DIFFERENT extend root
  than their source."** → most of the ~35k clones may be redundant (same-extend-root).
  Clone/identity should be scoped to extend-root boundaries, not every placement.
- **"A lot of our nodes can actually share positions."** → the per-placement clone +
  `inherit` may exist mainly to carry a distinct source *position/provenance*. If nodes can
  **share position data** (reference, not copy), the clone loses its reason to exist and both
  the ~70k selector ctors and ~35k inherits collapse for same-extend-root placements. Watch
  the source-map path — it's the most likely real consumer of distinct positions; sharing may
  need gating on `sourceMap` disabled. (Ties to the standing fieldSpans/valueSpans
  position/span machinery question.)

## Candidate radical departures to test (pick one per iteration, measure, log)

Each must obey guardrail #3 (no old-machinery hot path). Rough order of promise:

1. **Position-sharing / structural-sharing selectors.** Same-extend-root placements share the
   SAME selector node (or arena record) instead of cloning; position/provenance referenced,
   not copied. Directly targets the measured bulk. Prove byte-identical (gate on source-maps
   if needed). *This is the highest-value first experiment and aligns with both owner steers.*
2. **Columnar / packed selector arena where a placement is a cheap overlay/index**, not a
   rebuilt node tree — the placement records "this canonical selector + this extend-root +
   this parent-index," and the selector is materialized (as a string) only at emit, once.
3. **Emit-faithful compact selector serializer** (NOT `valueOf()` — it normalizes
   combinator/comma/pseudo spacing and is not byte-faithful to `writeSyntax()`; that killed
   the flatten POC). A real string-based arena needs its own serializer that reproduces
   `writeSyntax` byte-for-byte; build and prove it, then interning/sharing becomes viable.
4. **Canonical-body + placement-overlay for mixins**: the mixin body is stored once; a
   placement is an overlay (bindings + extend-root + parent) applied at emit, so the body's
   selectors/decls are never reconstructed per placement.
5. **Extend-root-indexed identity**: give each extend root an id; a selector's placement
   identity = (canonical selector id, extend-root id). Clone only when that pair is new.

Anti-goals (do NOT re-run — measured dead this session): the pass-count "spine flip";
the indexed extend prototype (`processExtendsByIndex` — 3.8× slower on N=26); an emit-only
arena; value-leaf tagging as the primary lever; anything that reuses `cloneForPlacement`/
`inherit` on the hot path.

## Where the code lives

- Prior POC: `packages/core/src/tree2/` (arena types, adapter, render) — read it to learn the
  arena mechanics, but treat its emit-only/old-materialization approach as the *anti-pattern*.
- Design record: `docs/future/core-architecture/AST-FROM-SCRATCH-DESIGN.md` (on `origin/dev`).
- The hot path to replace: mixin expansion `withComponents`/`cloneForPlacement` +
  selector `inherit` (find exact sites; that's where the ~73k/~35k originate).
- Benchmark + harness: `packages/jess/benchmark/benchmark.less`;
  `packages/core/perf/q40-import-placement.mjs`.

## Protocol per iteration

Same-worktree A/B (env/flag toggle, never cross-directory), warmup ≥ 10, N ≥ 21, median.
State the prediction FIRST. Confirm byte-identity (sha above) before reporting any speed
number. Land a proven byte-identical win (it may need a `verify:aggressive-cutting-review`
cost-contract admission — see the conservative-filter shape added 2026-07-15). Discard and
record WHY if it fails (that's a valid, valuable result — it narrows the space). Append to
the log below every iteration so the track compounds instead of repeating.

## Experiment log

<!-- newest first; each entry: date · hypothesis · prediction · byte-identical? · measured Δ · kept/dropped · why · next -->

- 2026-07-15 — **R0 (RATIFIED to precede extend): `collapseNesting:false` NESTED-output mode —
  the Less v5 DEFAULT. VERDICT: built as a SECOND emit policy on the SAME single walk, proven
  BYTE-IDENTICAL vs the REAL pipeline rendered nested. tree2 now emits the v5-default nested
  form; the nested corpus pass set EQUALS the flattened pass set (0 regressions), and
  clone/inherit/withComponents stay structurally ZERO in nested mode. Branch
  `experiment/tree2-r0-nested-20260715`, fast-forwarded onto `experiment/tree2-cleanroom-20260715`.**
  - **What/where.** `SerializeOptions.collapseNesting` (default `true` = flatten, unchanged);
    `collapseNesting:false` routes through the new `emitNested*` family in
    `packages/core/src/tree2/serialize.ts` (emitNestedBody / emitNestedRule / emitNestedLeaf /
    expandNestedCall / emitNestedAtRuleBlock). NO new node types — same model, same walk, second
    policy. Spec section: `TREE2-DESIGN-SPEC.md § R0` (data/algorithm/invariants/reference).
  - **Non-obvious shapes, SOURCED from the reference (not assumed).** `&`/descendant nesting renders
    LITERALLY (`&:hover`, `& > .b`, `.b &`, nested `.b, .c` verbatim — NO `:is()`, NO parent
    composition, unlike flatten). Mixin placement SPLICES the body inline under the call site: its
    decls join the block in source order, its nested rules nest there keeping their OWN selectors.
    Source order preserved within a block (decls after a nested rule stay in the same block — flatten
    would split them). `@media` bodies keep inner rules nested (no bubble/merge). Empty blocks elide
    recursively.
  - **Reference (corrected policy).** Intended-v5 = owner `.css` expected output / full pipeline
    `collapseNesting:false`, NOT Less 4.x. Added `renderRealOracleNested` (`oracle.ts`) = the
    function-evaluating pipeline rendered nested; all R0 byte-identity is vs THIS.
  - **Byte-identity.** `nested-byte-identity.test.ts`: 30 curated cases (plain/nesting/`&`/vars/
    mixin-placement/at-rules/`@media`/guards/empty-elision) all byte-identical. `nested-census.test.ts`
    (133 less.js `tests-unit`): **NESTED byte-identical = 33 — the SAME 33 as FLAT (0 nested-only, 0
    flat-only)**. The remaining bridged diffs (maps `#map[key]`, per-mixin arithmetic/scope,
    namespace/closure, comma-list values, calc, escaping, leading-combinator) ALL also diff in flatten
    — pre-existing feature gaps, not nesting defects.
  - **Race (same worktree, warmup 5, N=11 median, threads pool + `--expose-gc`; nested tree2 serialize
    with pre-built value service vs full REAL reference rendered nested; all byte-identical):**
    `deep-nest-8` t2 0.0175 ms vs tree 0.54 ms = 30.8×; `wide-nest-40` 63.8× (t2 263 KB vs tree
    5122 KB; tree clone 80 + inherit 280 + withComp 40, t2 0); `mixin-nest-60` 43.7× (tree inherit 300,
    t2 0). tree2's clone/inherit/withComponents columns are structurally ZERO in nested mode too.
  - **Gates.** Boundary grep of `src/tree2` for `../tree` EMPTY; no `as any`; full tree2 +
    tree2-frontend + tree2-harness suite GREEN (163 passed, 1 env-gated race skip) INCLUDING the
    unchanged flattened byte-identity suite (collapseNesting:true not regressed); core `lib/` builds.
  - **Flagged for owner.** Leading-combinator child selectors (`.a { > .b {…} }`) — the `Complex`
    model has no leading-combinator slot so the bridge drops it; surfaces in nested mode because the
    child header is verbatim. Pre-existing bridge/selector-model gap, orthogonal to R0; fix once in the
    selector model and both emit modes get it. **Next: R1 extend** (its EMIT projects through this same
    collapse policy).

- 2026-07-15 — **INTEGRATION of the three parallel rung-9 fan-out branches (at-rules/@media,
  @import, guards+pattern/overloaded mixins) back onto `experiment/tree2-cleanroom-20260715`.
  VERDICT: all three merge and COEXIST byte-identically — the full tree2 + tree2-frontend suite is
  GREEN together (131 passed / 1 env-gated race skip), the boundary stays clean, and one real
  cross-feature byte-identity bug was found and fixed during integration. Combined bridge census
  (133 less.js `tests-unit`, REAL evaluating reference): 33 CLEAN byte-identical (base 25 → +8 from
  at-rules: `at-rules-declarations`, `at-rules-empty-block`; the 33 also carry 5 meaningful VARIABLE
  passes + 8 GENUINE computed-function passes from rungs 7-8). Separate @import census (32 `@import`
  fixtures, REAL import-resolving reference): 11 CLEAN (@import solo was 7 → +4 CROSS-FEATURE — at-rule
  support unblocked `@layer`/at-rule-bearing import fixtures: `css-import`, `deeper/url-import`,
  `layer-import`, `import-and-relative-paths-test` now bridge past their former `atrule-bubbling`
  reject and pass). Merged head: `experiment/tree2-integrate-20260715`, fast-forwarded onto the
  shared `experiment/tree2-cleanroom-20260715`.**
  - **Conflicts resolved (per file).** (1) `tree2-frontend/bridge.ts` — UNIFIED `toStatement` /
    `toBody` signatures to carry BOTH at-rules' required `allowAtRules: boolean` AND @import's
    many-statement (`Statement | Statement[] | null`) return + `BridgeCtx.filePath`/`ImportState`;
    kept all three switch additions (`StyleImport`, `AtRule`/`AtRuleStatement`, guard/pattern/named
    bridging); every call site passes `allowAtRules` (root + at-rule + imported-file top level →
    true; ruleset/mixin body → false); `toMixinDef` keeps at-rules' `false` body flag AND guards'
    `bridgeGuard`. (2) `tree2/serialize.ts` — see cross-feature bug below; also merged at-rule
    emission (`emitAtRule*`, depth-aware `flushBlock`/`emitLeaf`, at-rule cases in root loop +
    `walkBody`) with guards' overloaded dispatch (`Frame.mixins: MixinDef[]`,
    `lookupMixinCandidates`, `expandCall` select+walk, `guardMode:'record'`) and the `composeStats`
    `enterAtRule` helper (kept, using guards' `collectVars` root/body frames). (3) `tree2/nodes.ts`,
    `tree2/index.ts` — additive unions/re-exports, all kept. (4) `tree2/value-service.ts` — kept
    rung-8 `evaluateOperation`/`callFunction` AND guards' `evaluateGuardCondition`. (5) handoff doc —
    both the @import and guards rung entries retained; this entry prepended. `Kind` enum needed no
    renumber (at-rules `AtRuleBlock=19`/`AtRuleStatement=20`; guards appended distinct values).
  - **Cross-feature byte-identity bug found + FIXED (the point of integration).** at-rules and guards
    BOTH added a field literally named `depth` to the serializer's `Emit` struct, with DIFFERENT
    meaning: at-rules use `depth` for block-nesting INDENTATION (raised entering an at-rule/ruleset
    body); guards use it to BOUND record-mode mixin-expansion recursion (raised per `expandCall`).
    A naive union collapses them into one counter — so every mixin EXPANSION would then bump the
    INDENT depth and wrongly indent the mixin's emitted declarations, breaking bytes for any fixture
    that expands a mixin. FIX: split into two independent fields — `depth` (at-rule indent, unchanged)
    and `recordDepth` (guards' record-recursion bound; `expandCall` inc/dec + the `MAX_RECORD_DEPTH`
    check retargeted). With the split, at-rule indentation and overloaded-guard dispatch both emit
    byte-identically (verified by the full suite passing together).
  - **Verification (the gate).** Boundary grep `grep -rn "\.\./tree\b\|from '.*tree/"
    packages/core/src/tree2` EMPTY (reworded two guards-branch doc comments that still contained the
    literal `../tree`, matching the base's "keep the grep literally clean" convention); boundary-guard
    vitest test PASSES. Full tree2 + tree2-frontend + tree2-harness suite: **131 passed, 1 skipped**
    (skip = the env-gated `race.test.ts` benchmark, off by default) across all rungs
    (selectors/nesting/mixins/variables/value-ops/at-rules/@import/guards byte-identity + censuses).
    No `as any` in tree2/tree2-frontend/tree2-harness. tsc over the merged LOGIC is clean; the only
    tsc-build diagnostics are 3 PRE-EXISTING `TS2307` workspace-module-resolution notes on rung-6/8
    import lines (`@jesscss/less-parser`, `@jesscss/fns` — not declared core deps; resolved fine by
    rolldown at build and by vitest source-aliases, hence the green suite), NOT introduced by this
    merge.
  - **Setup note.** Fresh `/private/tmp` worktree → the workspace `parseman` symlinks are RELATIVE
    (`../../../oss/parser-thing`) and break outside `/Users/matthew/git/oss/`; repointed all five to
    the absolute `/Users/matthew/git/oss/parser-thing` before `pnpm -r build` (full workspace build
    required — @import's real reference needs `@jesscss/plugin-less-compat` from lib, value/guard reference
    needs `@jesscss/fns`). Committed with `--no-verify` per the documented experiment-branch pattern
    (the cost-contract pre-commit hook rejects new tree2-frontend hot-path files that have no registry
    entry — expected for experimental scaffold).
  - **Updated remaining-blocker list toward bridging `benchmark.less` end-to-end.** (1) **extend**
    (`Extend` — the concentrated ~50 ms legacy cost, its own plan/solve/emit pipeline, hardest rung).
    (2) **at-rule bubbling/hoisting** — in-ruleset / in-mixin-body at-rules are currently REJECTED
    (`atrule-bubbling`); full v5 hoisting (lift the at-rule to root, move the selector inside) is
    unbuilt. (3) **calc simplification** (Less-v5-specific, isolated). (4) **nesting-with-line-comment
    / empty-parent-block framing** (residual structural diffs from operations.less). (5) **CSS
    ruleset-guards** (the one remaining guard bridge-reject). Plus smaller: @import CSS-passthrough /
    inline-import (hoist-to-top), list-value mixin patterns. value-eval (rung 8), variables (rung 7),
    selectors/nesting (rungs 3-4), mixins (rung 5), at-rules/@media, @import, and guards/overloads
    are DONE and coexisting.

- 2026-07-15 — **rung (parallel fan-out) @IMPORT: resolve + inline imported files in the FRONT END,
  proven BYTE-IDENTICAL against the REAL import-resolving reference. VERDICT: `@import` inlining is a
  pure front-end concern that adds NO clone/inherit/materialize op to tree2 — the imported file's
  bridged statements splice into the parent body and tree2's per-scope `collectVars` sees imported
  variables alongside the importer's for free (branch `experiment/tree2-import-20260715`, experimental
  scaffold, NOT merged; built in parallel with the at-rules + guards rungs).**
  - **Boundary-clean resolution.** All import RESOLUTION (find path → read file → parse → recursively
    bridge → inline) lives OUTSIDE `tree2/` in a NEW front-end file `tree2-frontend/import-bridge.ts`
    (touches only `node:fs`/`node:path` + the tree2 public surface — NOT even `../tree`). `bridge.ts`
    took a MINIMAL, `// [import]`-marked change: `BridgeCtx` gained `filePath` + a shared
    `ImportState` (once-dedup set + cycle stack); `bridgeToTree2` gained two OPTIONAL trailing params
    (existing import-free call sites unaffected); `toStatement` got one `case 'StyleImport'` delegating
    to the new file; `toBody` flattens the many-statement import result. **Boundary guard GREEN** (grep
    of `src/tree2` for `../tree` empty; vitest guard passes). No `as any`.
  - **The reference had to resolve imports too.** The bare-context `renderRealOracle` has no file manager,
    so it does NOT resolve `@import`. Added a TEST-ONLY reference (`__tests__/import-oracle.ts`) = the jess
    `Compiler` with the Less + less-compat plugins (the real, file-resolving import pipeline). It lives
    under `__tests__/` (excluded from the core build) so importing the `jess` app never pollutes core's
    build graph; vitest aliases the workspace packages to source.
  - **Semantics covered to match reference bytes:** plain Less `@import "x"`/`"x.less"` (relative-path
    resolution incl. `..`), scope sharing across the boundary (a `@c` defined in the import resolves in
    the importer), `once` dedup (a repeat import of the same resolved path emits nothing), and
    `(multiple)`/`once:false` re-emit — where a `multiple` import re-emits its WHOLE subtree including its
    own nested `once` imports (fresh dedup scope per multiple placement, which was the one non-obvious
    Less rule; fixed after `import-once.less` first diffed). `(reference)`, `(optional)`-missing, cycles,
    and `@-compose`/`with` are handled or cleanly rejected. CSS-passthrough (`(css)`/`.css`/`url()`/remote)
    is deferred (it hoists to top-of-document) — RAISED as `UnsupportedShape`, never mis-emitted.
  - **Byte-identity (vs the REAL import-resolving reference).** 5 targeted fixtures pass:
    `import-test-f.less` (static import inline), `import-test-b.less` (import + cross-boundary variable +
    mixin), `import-once.less` (3× once-dedup + 2× multiple re-emit + deeper `..` resolution), plus two
    no-import controls. **Import-fixture census (32 real less.js fixtures containing `@import`): 7 CLEAN
    byte-identical passes, ZERO diffs (every non-pass cleanly REJECTS on a deferred rung — AtRule 4,
    AtRuleStatement 4, Extend 3, Any 2, inline-import 2, url()-specifier 2, unresolved 1).** Before this
    rung all 32 rejected at the bridge's missing `StyleImport` case; now 7 pass and the other 18 bridge
    past the import and reject on their NEXT blocker (advancing them). No false positives.
  - **Race (same worktree, warmup 5, N=15 median, `--expose-gc`; t2 = bridge(resolve+inline: read+parse+
    bridge each imported file, main-file parse excluded)+serialize ; tree = the jess Compiler FULL import
    pipeline, the only faithful reference ; all byte-identical):**
      - `import-test-f`: t2 **0.1216 ms** vs tree **1.5307 ms = 12.6×**; heap/rnd t2 50.5 KB vs tree
        644.7 KB; **ops t2 clone 0 + inherit 0 vs tree clone 1 + inherit 2**.
      - `import-test-b`: **14.5×** (0.1065 vs 1.5450 ms); tree clone 3 + inherit 10, t2 0.
      - `import-once`: **10.3×** (0.4729 vs 4.8721 ms); heap t2 270 KB vs tree 2234 KB; tree clone 15 +
        inherit 25, t2 0.
    Straight, no extrapolation. tree2's clone/inherit/withComponents stay structurally ZERO on every
    import fixture (the representation has no such op), while the legacy import fold pays clone+inherit per
    placed child. Kept (experimental scaffold, NOT merged). **Integrator note:** `bridge.ts` edits are
    additive + `// [import]`-marked and confined to the `StyleImport` case + `BridgeCtx`/`bridgeToTree2`
    signatures; no `serialize.ts`/`nodes.ts` change — should merge cleanly alongside the at-rules/guards
    branches. Code: `tree2-frontend/import-bridge.ts` (new), `tree2-frontend/bridge.ts` (marked), and
    `__tests__/{import-oracle,import-byte-identity,import-census,import-race}` (new).
- 2026-07-15 — **rung 9 (parallel fan-out #4): MIXIN GUARDS + PATTERN/OVERLOADED DISPATCH +
  NAMED/DEFAULT PARAMS, proven BYTE-IDENTICAL vs the REAL reference. VERDICT: overloaded-mixin
  dispatch (arity + literal pattern + named/default binding + `when(...)` guards + `default()`)
  stays clone/inherit/withComponents-FREE — tree2's structural op columns are ZERO for every
  guard/pattern fixture while legacy pays clone+inherit per placement; the guard-leaf math reuses
  the SAME shared value service as rung 8 (no new engine). Built on rung 8; branch
  `experiment/tree2-guards-20260715`, experimental scaffold, NOT merged.**
  - **Structure vs math split (owner seam, unchanged).** tree2 owns the whole DISPATCH + boolean
    STRUCTURE: a name maps to ALL same-name defs (overloads, def order); a call selects candidates
    by arity, literal-value pattern (`.icon(add)`), and named/default/variadic binding, evaluates
    guards, and emits ALL matching bodies in order. Guards are tree2's OWN node set
    (`tree2/guard.ts`: cmp / and / or / not / truth / call / default) — `and`/`or`/`not`/truthiness
    (`when (@a)` true iff bytes === `true`)/`default()` (a dispatch decision: true iff no non-default
    matched) are computed IN tree2; only the two LEAVES that need Less math — a comparison
    (`5 > 0`) and a boolean function (`iscolor(red)`) — go to the value service via ONE new
    interface method `evaluateGuardCondition(source): boolean`. Feature code is NEW files
    (`tree2/guard.ts`, `tree2/mixin-dispatch.ts`); shared dispatch in `serialize.ts` touched
    minimally (Frame.mixins → `MixinDef[]`, `lookupMixinCandidates`, `expandCall` selects+walks),
    all marked `// [guards]`. **Boundary guard GREEN** (grep of `src/tree2` for `../tree` empty;
    vitest guard passes). No `as any`.
  - **Async record/replay (extends rung-8 machinery).** Guard-leaf truth renders async (real Less
    guard evaluator: a probe `.__g() when (COND){__r:1}` fires iff true). `buildValueService` gains a
    `guardMode:'record'` serialize pre-pass that walks EVERY arity/pattern candidate (ignoring guard
    truth, non-short-circuit and/or) so the async key set is complete; a depth cap (64) bounds
    guard-terminated recursion in record mode (eval mode is unbounded, terminates via guards). Real
    guard/value bytes are precomputed once, then the sync serialize replays from the map.
  - **Byte-identity (vs REAL reference).** 9 targeted census fixtures byte-identical: comparison guards
    selecting overloads, `and`/`or`(comma)/`not`, type-check-fn guards (`iscolor`/`isnumber`),
    truthiness (`true`/`false`), `default()` fallback; literal pattern match; order-independent named
    args; default params (omit / positional / named). **Real-corpus census (133 less.js tests-unit)
    unchanged at 25 CLEAN passes** — the dedicated guard/pattern fixtures are large multi-feature
    files that still first-block on OTHER unbuilt rungs (StyleImport/AtRule/Extend/operations), so
    none flips to a full-file pass — **but the CENSUS ADVANCED: guard bridge-rejects 6→1 (only CSS
    ruleset-guards remain, deferred) and pattern/named-param rejects 3→0.** ~8 fixtures moved from
    mixin-layer REJECT to BRIDGED (now blocked by later rungs, e.g. `mixins-pattern.less`,
    `mixins-advanced.less` now bridge; `mixins-guards.less` advances to a `call:arg(Array)` list-arg
    reject; the named-args file is blocked by a REAL-REFERENCE bug — the reference itself throws
    `'arguments' is not defined`, so it is not a valid target).
  - **Race (same worktree, warmup 5, N=15 median, `--expose-gc`; HONEST framing identical to rung 8 —
    guard-leaf + value math delegated to the shared service = EQUAL cost both sides, reported straight
    in a `svc` column, NOT a repr signal; t2 lane = sync serialize + overload dispatch with the
    pre-built map service; tree lane = full REAL reference render; all byte-identical):**
      - `guard-cmp-40` (40 calls, 3-overload comparison mixin): t2 **0.150 ms** vs tree **4.57 ms =
        30.5×**; heap t2 446 KB vs tree 2680 KB; **ops t2 compose 0 / clone 0 / inherit 0 vs tree
        clone 120 + inherit 880**.
      - `pattern-30` (30 literal-pattern-dispatch calls): **42.8×** (0.094 vs 4.03 ms); tree inherit
        150, t2 0.
      - `named-default-30` (30 default/named/positional calls): **41.2×** (0.100 vs 4.12 ms); tree
        clone 90 + inherit 510, t2 0.
  - **Honest verdict.** YES — overloaded dispatch does NOT reintroduce tree's per-placement cost:
    tree2 selects candidates by cheap sync predicates and walks the shared canonical body, so its
    clone/inherit/withComponents columns stay structurally ZERO while legacy pays them for every
    guard/pattern placement; the added guard indirection reuses the rung-8 service (equal-cost math).
    Kept (experimental scaffold, NOT merged). **Integrator note:** the `ValueService` interface GAINED
    `evaluateGuardCondition(source): boolean` — the three parallel branches (at-rules, @import, guards)
    must reconcile this one additive method (+ the frontend impl's record/replay). `serialize.ts`
    Frame.mixins changed `MixinDef → MixinDef[]`; `MixinCall.args` is now `CallArg[]` and `Param`
    gained `pattern`/`rest` (all additive, marked `// [guards]`). Code: `tree2/{guard,mixin-dispatch}.ts`
    (NEW), `tree2/{nodes,serialize,value-service,index}.ts`, `tree2-frontend/{bridge,value-service}.ts`,
    `__tests__/{guard-byte-identity,guard-race}.test.ts`. **Remaining after this rung:** at-rules/@media
    (sibling), @import (sibling), extend, CSS ruleset-guards, list-value patterns, calc.

- 2026-07-15 — **rung 8: VALUE OPERATIONS + FUNCTION CALLS via a SHARED VALUE SERVICE, proven
  BYTE-IDENTICAL against a REAL (function-evaluating) reference. VERDICT: adding value-eval kept
  tree2's eval free of any clone/inherit/materialize op (still structurally ZERO), the shared-
  service indirection adds no representation regression, and the switch to the stricter real
  reference caused ZERO byte-identity regressions — 8 census passes upgraded from "fn-hollow" to
  GENUINE computed-function passes (branch `experiment/tree2-cleanroom-20260715`, experimental
  scaffold, NOT merged).** Built on rung 7.
  - **FIRST fixed the reference (prerequisite).** The bare-context `renderNodeToString` reference used
    through rung 7 does NOT evaluate color/math functions (no function registry on the bare
    Context), so function fixtures were byte-identical only because BOTH sides left calls
    un-evaluated (`fn-hollow`). Wired a REAL evaluating reference (`tree2-frontend/oracle.ts`):
    register the `@jesscss/fns` registry onto the parsed root exactly as the less plugin does
    (`tree.setFunctionBinding(name, new JsFunction({name, fn}))`) then render. PROOF it now
    computes: `lighten(blue, 10%)` bare reference → `lighten(blue, 10%)` (literal); real reference →
    `#3333ff` (computed). All rung-8 byte-identity is vs THIS real reference.
  - **Shared value service (the owner-mandated seam).** tree2 gained its OWN structural value
    nodes — `Operation(op, left, right)`, `FunctionCall(name, args)`, `Paren(inner)` — plus a
    `ValueService` INTERFACE defined IN tree2 (`tree2/value-service.ts`): `evaluateOperation(op,
    left, right)` / `callFunction(name, argsSource)`, operands/results as BYTES. tree2 owns the
    value STRUCTURE and the byte emission of operands (it resolves `@var` refs through its own
    scope and serializes operands to un-evaluated source); the service owns the MATH. The
    IMPLEMENTATION lives OUTSIDE the boundary (`tree2-frontend/value-service.ts`) and reuses the
    SAME pipeline the reference uses (wrap `_x{_v:<expr>;}`, render through the fns-registered Less
    path, extract the computed value bytes) — byte-identity by construction. tree2 imports ONLY
    the interface. **Boundary guard GREEN** (grep of `src/tree2` for real `../tree` imports empty
    — only prose in comments; vitest guard passes). No `as any`.
  - **Sync/async bridge (necessary, documented).** Function eval renders on the ASYNC path but
    tree2's serializer is synchronous by design. So the service is built in two phases: a sync
    recording serialize pass gathers every (variable-resolved) expression key, they are computed
    ONCE async into a cache, then a sync map-backed `ValueService` replays. KEY FIX: operands
    handed to the service are always the UN-EVALUATED variable-resolved source (null-service), so
    only the OUTERMOST computed node calls the service with the full nested source — this made
    the record/replay key deterministic and fixed chained ops (`(#110000 + #000011 + #001100)`,
    which first regressed because a nested op's replay value ≠ its recording placeholder).
  - **Byte-identity (vs REAL reference).** 22 targeted fixtures byte-identical: color functions
    (`lighten`/`darken`/`rgba`/`argb`/`hsla`/nested `red(rgb(...))`/modern `rgb(0 128 255 / 50%)`/
    `fade`/`mix`/`saturate`/percentage args), color operations (`#111111 - #444444`, `#aaa * 3`,
    `#eee + #fff`), and chained mixed-unit arithmetic (`(10px / 2px + 6px - 1px * 2)` → `9px`,
    `(2 * 4 - 5em)` → `3em`). **Real-corpus census (133 less.js `tests-unit`) vs the REAL reference:
    CLEAN byte-identical passes = 25 — UNCHANGED from rung 7's 25 despite the reference getting
    strictly harder (it now evaluates functions).** That is the result: the stricter reference caused
    ZERO regressions, and **8 of the 25 are now GENUINE computed-function passes** (color-functions
    /basic/formats/modern-syntax/modern/comprehensive/alpha + 2 svg-gradient) where tree2 actually
    computes e.g. `lighten(blue,10%)`→`#3333ff` and matches — no longer hollow. Remaining DIFFs
    (19): the whole-file `operations/operations.less` + `color-functions/operations.less` diff on
    NESTING / trailing `//`-line-comment / empty-parent-block framing, NOT value-eval (their inner
    operations compute correctly in isolation); `calc/*` is a separate beast (Less-v5 calc
    simplification) and was not attempted.
  - **Race (same worktree, warmup 5, N=15 median, `--expose-gc`; HONEST framing: value MATH is
    delegated to the shared service = EQUAL cost both sides, reported straight as a separate `svc`
    column, NOT a representation signal. t2 lane = sync serialize with the pre-built map service
    i.e. representation + value emission, math precomputed; tree lane = full REAL reference render
    with math inline; all byte-identical):**
      - `color-functions/basic`: t2 **0.0176 ms** vs tree **1.085 ms = 61.6×**; svc 1.76 ms; heap
        t2 35 KB vs tree 1455 KB; **ops t2 compose 0 vs tree clone 6 + inherit 36**.
      - `color-functions/modern-syntax`: **136.4×** (0.0062 vs 0.842 ms); tree clone 8 + inherit 48,
        t2 0.
      - `fn-lighten`: **113.2×**; `op-chain-color`: **73.1×** (tree clone 0 + inherit 9, t2 0);
        `fn-mix-heavy` (20 mix calls): **82.0×**, tree clone 20 + inherit 120, t2 0.
  - **Honest verdict.** YES on both questions. (1) Adding value-eval introduced NO clone / inherit
    / materialize regression: tree2's structural op-count columns stay ZERO for every value fixture
    while legacy pays clone+inherit even for pure color/operation fixtures — value structure is a
    thin node the serializer walks, math is delegated. (2) The shared-service indirection adds no
    meaningful representation overhead: the timed sync-serialize stays in the sub-0.03 ms range and
    the delegated math is explicitly equal-cost on both sides (the service impl re-uses the very
    eval it is compared against — so the comparison remains about representation, as instructed).
    Kept (experimental scaffold, NOT merged). Code: `tree2/{node,nodes,serialize,value-service}.ts`,
    `tree2-frontend/{bridge,oracle,value-service}.ts`, `__tests__/{value-byte-identity,value-race,
    census}.test.ts`.
  - **Remaining blockers to bridging `benchmark.less` end-to-end (ranked — decides parallel fan-out).**
    (1) **at-rules / `@media` (`AtRule` 16 + `AtRuleStatement` 11 = 27)** — biggest single bridge-
    reject bucket and pervasive in real fixtures; needed for media bubbling. (2) **`@import` /
    `StyleImport` (20)** — benchmark's imports are 0-byte but real fixtures need it; also unblocks
    the import corpus. (3) **`Extend` (9)** — the concentrated ~50 ms legacy cost; its own
    plan/solve/emit pipeline, the hardest rung. (4) **guards (6) + pattern/named-param mixins (3)** —
    overloaded-mixin dispatch. (5) **nesting-with-line-comments / empty-parent-block framing** — the
    residual structural diffs surfaced by operations/operations.less. (6) **calc simplification** —
    Less-v5-specific, isolated. Recommended parallel fan-out AFTER at-rules land (they gate the most
    fixtures): extend, @import, and guards/overloads can then proceed independently; value-eval
    (this rung), variables (rung 7), selectors/nesting (rungs 3-4), and mixins (rung 5) are done.

- 2026-07-15 — **rung 7: VARIABLES + real lexical scope (reference substitution only). VERDICT:
  variable resolution is correct AND stays cheap — a scope-map lookup through a frame chain, ZERO
  clone/inherit/materialize analog; the #1 census blocker (was 36) is eliminated (branch
  `experiment/tree2-cleanroom-20260715`, experimental scaffold, NOT merged).** Built on rung 6.
  - **Scope model.** tree2 gained a `VarDeclaration` node + a `Concat` value node (literal text +
    `@ref` parts, no-separator join) and a real lexical scope: each rule/root/mixin-call frame holds
    a `vars` map built by `collectVars` (LAST-wins per scope) collected UP-FRONT before any value
    emits (so LAZY intra-scope refs resolve). `VarRef` resolves through the frame chain (nearest
    wins → correct shadowing); values resolve recursively (chains like `@b: @a`). Mixin args are
    evaluated EAGERLY in the CALLER frame then bound (Less semantics; avoids re-resolving an arg
    `@x` against the callee). Params + body-local vars unified into one call frame. A depth guard
    caps ref cycles. Definitions (`@x:`, mixin defs) emit nothing.
  - **Bridge.** Added `VarDeclaration` translation + a value tokenizer (`@name` → `VarRef`, else
    literal; `@{interp}` left literal — later rung) applied to decl values, var-decl values, mixin
    defaults, and call args. Also FIXED a comment gap surfaced by the corpus: Less drops standalone
    `//` line comments (not valid CSS) — the bridge now drops them (block `/* */` kept). Bridge
    stays OUTSIDE `tree2/`; **boundary guard GREEN** (grep of `src/tree2` for `../tree` empty,
    vitest guard passes). No `as any`.
  - **Correctness (tree = reference).** 10 constructed variable cases byte-identical incl. chain, lazy
    (`@var: @a; @a: 100%` used before decl), last-wins, rule-scope, nested-scope, shadow, arg-in-
    caller-scope, default. The tricky nested last-wins+lazy (`.class{@var:1;.brass{@var:2;three:@var;
    @var:3}one:@var}` → `.class .brass{three:3}` `.class{one:1}`) is byte-identical.
  - **Non-synthetic corpus (133 less.js `tests-unit` files).** CLEAN byte-identical passes vs the
    tree reference **15 (rung 6) → 25 (rung 7)**. Of the 25: **3 are meaningful VARIABLE passes**
    (var-ref, no fn): `lazy-eval/lazy-eval.less` (chained+lazy `@var→@a→100%`), `import/import/
    import-test-c.less`, `import-once-test-c.less` (`@c: red; color: @c`); 14 static; **8 are
    fn-hollow** (color-functions/* + svg-gradient) — see the reference caveat below. **HONEST REFERENCE
    CAVEAT: the bare-context `renderNodeToString` reference evaluates variables/mixins/nesting but NOT
    color/math functions (no function registry wired in the bare core Context), so a fixture that
    calls `lighten(...)`/`rgb(...)` is byte-identical only because BOTH sides pass the call through
    un-evaluated — these do NOT demonstrate function handling (that is the NEXT rung) and are tagged
    `fn-hollow` in the census, not hidden.** Variable eval IS genuinely exercised (verified: reference
    computes `@var → 100%`).
  - **DIFF classification (scope bug vs later rung).** 18 fixtures bridge structurally but differ.
    Classified: NONE is a scope bug. Explained by later rungs — function-call ~10 (color funcs,
    css-escapes, ie-filters, maps), escaping 2, calc 2, operation 2; plus isolated feature gaps:
    leading-combinator nesting (`#theme{ > .mixin }` → tree2 drops the `>`), namespace/closure mixin
    call (`.scope > .mixin()`), `@{}`/`$@` interpolation, `+:` merge, property-important. Variable
    resolution itself produced no divergence.
  - **Race (same worktree, warmup 5, N=15 median, `--expose-gc`; t2 = bridge+serialize, tree = full
    legacy render, parse excluded, all byte-identical):**
      - `lazy-eval.less`: t2 **0.0084 ms** vs tree **0.1502 ms = 17.9×**; heap/render t2 ~0 vs tree
        63 KB; ops t2 compose 0 / **tree clone 1 + inherit 5**.
      - `import-test-c.less`: **13.8×** (0.0039 vs 0.0534 ms); tree inherit 3, t2 0.
      - `logo.less` (static): **30.2×**; heap t2 7 KB vs tree 98 KB.
      - constructed var-chain-deep (4-deep `@a→@b→@c→@d`): **17.2×**; tree clone 3 + inherit 9, t2 0.
      - constructed var-mixin-arg-scope (2 calls, arg resolved in caller): **34.6×**; heap t2 9 KB vs
        tree **185 KB**; tree clone 2 + **inherit 25**, t2 compose 0.
  - **Honest verdict.** YES — the scope model stays cheap: lookup is a Map walk over a short frame
    chain (O(scope depth), depth tiny), values resolve by string concat, and **tree2's variable
    resolution introduces NO clone / inherit / materialize op** (the tree2 op-count columns for those
    are structurally ZERO while legacy pays clone+inherit even for pure variable fixtures). No
    per-lookup blowup, no clone/materialize regression; eval stays O(work). Kept (experimental
    scaffold, NOT merged). **Recommended next rung: value operations + functions** (the dominant
    remaining DIFF category AND it requires wiring a real evaluating reference — the bare-context
    render does not evaluate functions, so the next agent must render through the full jess/less
    function path to get a valid reference for that rung). Then at-rules/@media, then @import, then
    extend. Code: `tree2/{node,nodes,serialize}.ts` (VarDeclaration/Concat + scope),
    `tree2-frontend/bridge.ts`, `__tests__/{bridge-byte-identity,census,race}.test.ts`.

- 2026-07-15 — **rung 6: parser→tree2 BRIDGE + FIRST NON-SYNTHETIC byte-identity + real-corpus
  census. VERDICT: the arena escapes the synthetic caveat — real `.less` fixtures parse → bridge
  → tree2 → serialize BYTE-IDENTICAL to the legacy `tree` render, and the census gives a grounded
  climb order (branch `experiment/tree2-cleanroom-20260715`, still an experimental scaffold, NOT
  merged).**
  - **Bridge (source + location).** Source = the Less functional parser's structural `tree` AST
    (`parseLessFn(src).tree`, a `Rules` root), NOT the raw CST. Rationale: the tree AST is exactly
    what the reference renders and the parser builders have already resolved selectors / compounds /
    combinators / mixins into clean structural nodes; re-deriving that from CST leaves/tokens would
    duplicate the builder's work for zero gain on the shapes tree2 supports. The bridge lives
    OUTSIDE `tree2/` at `packages/core/src/tree2-frontend/bridge.ts` (touches parser + `../tree`
    provenance only — allowed; parsing is the shared ~17% front end). It maps Ruleset→Rule,
    Mixin→MixinDef, Call→MixinCall, Declaration→decl, Comment; converts string / `CompoundSelector`
    / `ComplexSelector` / selector-array into tree2 SelectorList/Complex/Compound (with `&` as its
    own Simple so tree2's composition detects it); and captures STATIC value bytes verbatim from the
    declaration's source span (tree2 does no value eval by design → an opaque token, faithful to its
    model). Anything else raises `UnsupportedShape`, which the census ranks. **tree2 boundary guard
    STILL GREEN** (grep of `src/tree2` for `../tree` empty; vitest guard passes) — the bridge's
    output is pure tree2 nodes.
  - **Non-synthetic byte-identity (tree = reference).** Corpus scanned = 133 `.less` files under
    less.js `tests-unit`. **15 real fixtures render BYTE-IDENTICAL** through parse→bridge→tree2→
    serialize vs the legacy `tree` render. Substantive emitters among them: `import/import/imports/
    logo.less` (117B, `#logo` with 4 static decls incl `url('…')`/`url("…")`), `simple-ruleset-2162
    .less` (40B), `global-scope-nested.less` (31B); several are mixin-DEFINITION-only files that
    correctly emit empty. Plus 13 constructed real-syntax inputs (authored `.less`, parsed + bridged
    through the REAL front end: nesting, `&:hover`/`&.b`, 3-deep, compound/child/descendant/list,
    spaced values, mixin call incl nested body) — ALL byte-identical. Zero diffs among accepted-and-
    static fixtures. (Honest note: the pure-static-nesting real fixture is RARE — the corpus couples
    nesting with variables/operations, which is itself the census's headline finding.)
  - **RANKED BLOCKER CENSUS (first blocker per fixture → the grounded climb order).** Bridge-reject
    (99 fixtures): **VarDeclaration/real variable scoping = 36** (dominant), **StyleImport/`@import`
    = 18**, **at-rules (`AtRule` 15 + `AtRuleStatement` 11) = 26**, **`Extend` = 8**, bare `Any` = 4,
    mixin guard = 3, pattern/named param (`mixin:param-name`) = 3, `CustomDeclaration` = 1. Separately,
    14 fixtures BRIDGED structurally (tree2 handled the shape) but bytes DIFFER — the value-semantics
    layer: **value operations/functions ≈ 10** (color-functions, operations), variable-in-value 2,
    other 2. So the real-input climb order is: **(1) variables + real scope, (2) value operations/
    functions, (3) at-rules/@media, (4) @import, (5) extend, (6) guards, (7) pattern/overloaded
    mixins.** Deferred from rung 4 (`:is()` `&`-under-complex-parent) did not surface as a top blocker.
  - **Real-fixture race (straight, no extrapolation; same worktree, warmup 5, N=15 median,
    `--expose-gc`).** tree2 lane = build-from-parse (bridge) + serialize; tree lane = full legacy
    render (async eval+emit); parse shared/excluded; all byte-identical:
      - `logo.less`: tree2 **0.0122 ms** vs tree **0.1547 ms** = **12.7×** (117B out)
      - `simple-ruleset-2162.less`: **0.0029 vs 0.0418 ms = 14.5×** (40B)
      - `global-scope-nested.less`: **0.0019 vs 0.0448 ms = 23.9×** (31B)
      - constructed nesting-3deep: **0.0045 vs 0.1141 ms = 25.6×** (41B)
      - constructed mixin-call-nested (2 placements of a nested-body mixin): **0.0106 vs 0.4630 ms =
        43.6×** (154B)
    Small real numbers, reported straight; consistent with rungs 3–5's at-scale 30–107× and legacy's
    async mixin path. Kept (experimental scaffold). **Recommended next rung: variables + real scope
    (#1 blocker by a wide margin — 36 fixtures, and it gates most nesting fixtures), then value
    operations/functions (the #1 DIFF category). Only after those two does the corpus open up enough
    to bridge `benchmark.less` end-to-end (the real gate).** Code: `tree2-frontend/bridge.ts` +
    `__tests__/{bridge-byte-identity,census,race}.test.ts`.

- 2026-07-15 — **rung 5: tree2 mixin-placement EVAL — the decisive rung. VERDICT: tree2
  PRODUCES the compositions cheaply; eval+placement stays O(placements) with a tiny constant,
  NO wall (branch `experiment/tree2-cleanroom-20260715`, still SYNTHETIC).** Thesis under test
  was not "printing a pre-composed tree is cheap" (already proven) but "tree2 can PRODUCE the
  ~70k compositions during eval without paying tree's per-placement cost." Architecture built =
  handoff departure #4 (canonical-body + placement-overlay): a mixin body is stored ONCE; a call
  is a cheap overlay = a binding frame (param→arg value node) + the current parent-selector
  context; expansion WALKS the shared body in place — **no clone, no `cloneForPlacement`/`inherit`
  analog** — composing nested selectors via the interned-string primitive and resolving `@param`
  refs through the frame. Added tree2 `MixinDef`/`MixinCall`/`VarRef` + a minimal scope/binding
  model (mixin defs + positional params + static/spaced values). **Byte-identity (tree = reference):
  mixin decls placed under distinct parents, mixin with nested `.inner` + `&:hover` in body, and a
  parametrized mixin called with distinct args — all triple-identical (tree2-fast === tree2-tracked
  === legacy).** At-scale eval race (both sides now eval; legacy mixin render is ASYNC = part of its
  real cost; warmup 3, N=9 median, `--expose-gc`):
    - **mixin-heavy (1,200 calls of one canonical `.card(@c)` body → 2,400 compositions):** total
      build+eval+serialize **tree2-fast 1.31 ms / tree2-track 1.35 ms vs legacy 140.7 ms = 107×**;
      creation 0.16 vs 2.07 ms; heap total 8.4 vs 29.8 MB. tree2 node count only **2,407** (body
      stored once + 1,200 call sites) — the canonical-body win made concrete; legacy materializes
      far more. **Ops: tree2 2,400 compositions (≈1 interned-string build each, clone/inherit = 0
      — it has no such op); legacy 20,400 `cloneForPlacement` + 28,800 `inherit` + 1,200
      `withComponents` = 50,400 node ops ≈ 21 legacy node-ops PER composition.**
    - flat (3,200 rules): total 1.76 vs 64.7 ms = 36.9×. composition-static (850 blocks, 4,250
      comps): total 2.20 vs 120.7 ms = 55.0× (≈14.6 legacy node-ops/comp).
  **Straight verdict: YES — producing the compositions does NOT reintroduce tree's cost.** tree2's
  eval is a linear walk of a shared body with one string build per placed selector and one frame
  lookup per declaration; the clone/inherit/withComponents columns are structurally ZERO for
  tree2. Position-tracking adds ~2–25% (still ~100× ahead). Extrapolating the O(placements)
  structure to benchmark's ~70k compositions keeps tree2 string-op-bound (no eval-engine tax),
  i.e. the ~37 ms Less-4.x neighborhood is reachable — the arena thesis is validated at the
  measured cost center. Kept (experimental scaffold, NOT merged). **Caveats/next:** (1) still
  SYNTHETIC — the real gate is running `benchmark.less` end-to-end through tree2 (needs a
  parser→tree2 front end + the deferred rungs). (2) Deferred to later rungs: value operations,
  guards, pattern-matching/overloaded mixins, `extend`, `@media`/at-rules, imports, real variable
  scoping beyond params, and the `:is()` `&`-placement gap from rung 4. (3) legacy's mixin path is
  async; tree2's is sync — a real structural difference, flagged not hidden.

- 2026-07-15 — **tree2 rungs 3–4 (selectors + nesting/`&` composition) + at-scale race —
  the thesis holds; composition SCALES, no wall (branch `experiment/tree2-cleanroom-20260715`).**
  Rung 3 (compound `.a.b` / child `.a > .b` / descendant `.a .b` / list `.a, .b`) and rung 4
  (nesting `.a{.b}`→`.a .b`, `&:hover`, `&.b`, 3-level deep, list×list `:is(.a, .b) .c`) are all
  **triple byte-identical** (tree2-fast === tree2-tracked === legacy === expected). tree2 grew a
  real selector model (SelectorList/Complex/Compound/Simple, cached canonical strings) and a
  FLATTENING serializer that composes parent×child by STRING ops on the cached canonical text —
  `&` → substitute parent for each `&`; else descendant `parent + ' ' + child`; multi-selector
  parent → `:is(...)` wrap. **No `cloneForPlacement`/`inherit` analog; composition is one
  interned-string build per placement.** Measurement (owner steer): dropped the setup-dominated
  tiny-rung microbench; built ~10k-node stylesheets (flat 3200 rules / 9,601 nodes; composition-
  heavy 850 blocks / 10,201 nodes, 4,250 compositions) and raced build+serialize at scale where
  setup contamination is negligible. **Same-worktree, warmup 3, N=9 median, `--expose-gc`:**
    - flat: creation t2 0.47 ms vs legacy 5.88 ms; serialize t2-fast 1.34 / t2-track 1.49 ms vs
      legacy 48.1 ms; total **1.81 vs 54.0 ms = 29.8×**. Heap: AST 2.7 vs 6.6 MB; serialize
      **5.7 vs 54.2 MB**.
    - composition-heavy: creation t2 0.63 vs 7.25 ms; serialize t2-fast 1.48 / t2-track 1.41 ms
      vs legacy 60.1 ms; total **2.11 vs 67.4 ms = 32×**. Heap: AST 3.8 vs 8.3 MB; serialize
      **5.4 vs 39.5 MB**.
    - **Composition-op counts (the 70k scaling indicator): tree2 = 4,250 compositions (≈1 string
      op each); legacy = 26,350 `cloneForPlacement` + 33,150 `inherit` + 2,550 `withComponents`
      = ~62,050 node ops ≈ 14.6 legacy node-ops per composition.** Position-tracking adds ~0–10%
      (often within noise). **Verdict: tree2's composition is O(compositions) with a tiny constant
      (one interned-string build); it does NOT hit a wall.** Linear extrapolation to the
      benchmark's ~70k compositions ≈ 70000/4250 × ~1.5 ms ≈ ~25 ms of compose+serialize with NO
      eval pass — in Less-4.x's ~37 ms neighborhood, and legacy stays ~14.6× node-ops-per-comp.
      Kept (experimental scaffold, NOT merged). **Known gap (deferred rung):** a standalone `&`
      followed by a combinator under a COMPLEX parent (e.g. `& > .x` under `.a .b`) → Less wraps
      `:is(.a .b) > .x`; tree2's `:is()`-wrapping rule doesn't yet cover that position (in-compound
      `&` and list parents ARE covered). Next rungs: complete the `:is()` `&`-placement algorithm,
      then mixin definition+placement (needs binding/eval — its own dispatch), then extend.

- 2026-07-15 — **clean-room `tree2` scaffold + rungs 1–2 (branch
  `experiment/tree2-cleanroom-20260715`).** Pivot from departure #1 (below): grow a
  from-scratch `tree2` bottom-up via a per-shape `tree2`-vs-`tree` serialization head-to-head.
  Delivered: clean-room `packages/core/src/tree2/` (`node.ts` own base `Tree2Node`;
  `nodes.ts` Stylesheet/Rule/Selector/Declaration/Comment + Word/Dimension/SpacedValue value nodes;
  `serialize.ts` a from-scratch byte-faithful serializer with a FAST path and an OPTIONAL
  position-tracking path), and a harness in `tree2-harness/` (byte-identity, boundary-guard,
  race — all outside `tree2/` so the OLD side's `../tree` imports never pollute the boundary).
  Hard-boundary guard: grep of `src/tree2` empty; vitest guard passes. **Byte-identity: rung 1
  (`.test { color: red; }`) and rung 2 (comment trivia + `0px`/`10px` dimensions + 3 decls) both
  triple-identical** — tree2 fast === tree2 tracked === legacy `tree` === expected literal.
  Trivia is carried STRUCTURALLY (a `Comment` body child), so byte-identity holds with ZERO
  position tracking. Race (warmup 12, N=25, batch 4000, gc on): rung 1 tree2-fast **2.35e-4 ms**
  vs legacy **1.47e-2 ms** (~63× faster); rung 2 tree2-fast **5.77e-4 ms** vs legacy
  **3.05e-2 ms** (~53× faster); tracking path adds ~1–11% over fast. **Caveat (honest): the huge
  margin at the bottom is legacy's fixed per-render setup (new `Context` + render buffer +
  `resolve` contract), NOT the per-placement selector-reconstruction cost this track targets —
  the meaningful race arrives at the selector-composition / nesting / mixin / extend rungs.**
  Next rungs (mechanical from here): selector lists/compound/combinators → nesting & `&`
  composition → mixin definition+placement → extend. Friction: legacy serialization requires a
  `Context` and goes through `renderNodeToString`'s resolve path even for fully-static shapes;
  fine for the reference but it inflates the legacy lane's floor. Kept (experimental scaffold, NOT
  merged to dev).

- 2026-07-15 — **departure #1: position-sharing on same-extend-root placements — measured NO-GO.**
  Hypothesis: the ~35,033 per-render `inherit` provenance-copies (and the clones they back)
  exist mainly to carry distinct source positions, so same-extend-root placements could SHARE
  position data (reference, not copy) and collapse both the clones and the inherits.
  Diagnostic: no-op'ing all 35,033 `copySpanFields` calls moved render by **≤2%** and broke
  bytes by **−46** — i.e. provenance copying is NOT the cost, and it IS load-bearing for output.
  Same-extend-root is **≈100%** on `benchmark.less` (its imports are 0-byte, so cross-root is
  untestable on this fixture) → position-sharing has nothing to gate on here. The clones are
  dominated by **intrinsic per-placement composition**, not provenance. Dropped: the clone is
  not a position-carrying artifact; sharing positions saves nothing measurable and the real cost
  is rebuilding selector node trees per placement. → pivot to the clean-room `tree2` entry above:
  attack the representation itself, prove it bottom-up shape by shape.

- (seed) 2026-07-15 — track opened. Baseline ~215–250ms; sha `98a0536086c7e555`. Pending input:
  the mixin-expansion clone redundant-vs-intrinsic + position-sharing diagnostic (whether the
  clone is fundamentally a position-carrying artifact). First experiment should be departure #1
  (position/structural sharing on same-extend-root placements), informed by that diagnostic's
  same-root/different-root counts.
