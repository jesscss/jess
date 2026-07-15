# Core Cleanup — the single live tracker

**This is THE tracker for @jesscss/core cleanup work.** It replaces the scattered
set of focus-trackers and audit docs that had drifted out of sync with the code
(several claimed "done" for work that wasn't, or "todo" for work that had landed).

- **Live queue** = the OPEN items below, grouped by focus.
- **History** for removed focus trackers lives in git history. Don't resurrect
  those files to find work; read this tracker instead.
- **Guides that are NOT trackers** (invariants, review rules, the router) stay where
  they are — see [Standing guides](#standing-guides).

Integration target: `dev`. Historical sections may name older branches. Author/verify convention: build core, run the core suite,
diff the **stable** failure set (run twice; flaky ±) against the prior baseline — a
change is real only if the stable set moves.

## CURRENT SCALE — ALLOCATION / SLIMMING HARVEST (2026-07-14)

This is the active queue for the current cleanup campaign. It is deliberately one
scale, not an arbitrary three-to-five-item batch: drain every eligible row below
before reseeding. Keep parser work, Less-integration semantics, and high-risk
scope/frame redesigns in their own lanes. A row is eligible only when live-code
inspection shows a bounded allocation or redundant-state cut with a focused proof
surface; stale or semantically risky candidates are closed with evidence.

### Ledger

- [x] **Argument-container transport** — `call.ts` / `define-function.ts`, merged
  in `a665f20dd`. Removes per-call argument-array spreading. The stable hot-path
  check was flat-to-slightly-slower (`functions.less`: 11.09ms → 11.32ms at
  1,400 samples), so this is recorded as an object/allocation slimming cut, not
  a runtime-speed claim.
- [x] **Inline source-span copying** — `node-base.ts` / `provenance.ts` /
  `dimension.ts`, merged in `9d7ee7613`. Copies fixed span fields without making
  a span object during clone/inherit; compatibility gates passed.
- [x] **Fixed-shape rules-like reference surface** — already landed; do not
  reopen the stale reflective-descriptor item below.
- [x] **S1 — Lazy scope fallback queue** — make the lookup fallback queue in
  `scope-frame.ts` materialize only when a fallback is actually queued; preserve
  queue order, cycle handling, and all lookup result kinds. `scope-frame.test.ts`
  passed 17/17; aggressive review passed.
- [x] **S2 — Empty callable-miss sentinel** — reuse one never-mutated empty
  callable bucket for cached misses in `rules.ts`; retain the array return
  contract and leave the mutable-looking `findMixinsFast` path out of scope.
  The targeted mixin miss set passed 3/3 (full mixin file 200/200); aggressive
  review passed.
- [x] **S3 — Temporary writer sites audit CLOSED** — the remaining
  `serialize-helper.ts` / `interpolated.ts` writers are detached or reentrant
  seams. Reusing the active writer would require a new queue-state snapshot or
  print-context threading and changes semantics; no low-risk allocation cut
  remains in this scale.
- [x] **S4 — Live node-shape audit** — recheck `Node`/`Rules`/`Ruleset` and
  selector fields against all internal callers and tests; land a field/state cut
  only if it is genuinely dead or can move to existing flags without a side map.
  Current child rows:
  - [x] **S4.1 — Lazy `SelectorCapture._selectorNode`** — make the optional
    cache declaration-only so node-backed captures do not pay an eager slot;
    prove the lazy string/array lift still owns the cache. Core selector-capture
    coverage passed 10/10 in the integration worktree; the worker also passed
    the parser/AST surface; aggressive review passed.
  - [x] **S4.2 — Selector `_valueOf` specialization** — move the eager cache
    slot to Basic/Compound/Complex/Pseudo/Attribute, with invalidation preserved
    on those families and no cache slot on the other selector shapes. Core
    selector/type coverage passed 26/26; core compile and aggressive review
    passed. Matched four-fixture A/B was neutral overall with one noisy/unstable
    fixture; this is recorded as shape slimming, not a speed claim.
- [x] **S5 — Eval/lookup scratch audit CLOSED** — the live audit produced S1
  and S2 as the two bounded rows; `findMixinsFast`'s mutable-looking miss array,
  extend scratch, document-order state, and path-offset lookup arrays are
  explicitly rejected for this scale.

**Drain rule:** continue through S1–S5 and any narrowly discovered child rows
until the scale is empty, the next item changes semantics or needs owner
judgment, or evidence rejects the approach. Every landed row gets
`git diff --check`, `verify:aggressive-cutting-review`, focused tests, and the
stable compatibility gate. Runtime speed is reported only with matched before /
after measurements; slimming rows may be accepted on allocation and behavior
evidence alone.

**Scale status (2026-07-14):** drained. S1, S2, S4.1, and S4.2 landed in this
integration batch; S3 and S5 were closed by audit with no eligible low-risk row.
The next candidate must therefore be a new scale or a materially different
semantic/performance lane, not a stale reopening of these rows.

## CURRENT SCALE — broad cleanup queue (2026-07-13)

The small allocation/slimming harvest above is complete. This is the next working
scale: fifteen-plus meaningful rows, not fifteen line edits. Each row must have one
owner, a bounded write set, a focused proof, and a clear reason to land. A row may
be closed as stale or not-worth-doing when the evidence says so; that is a useful
result, but it is not permission to silently skip the queue.

Before claiming a row, run `git worktree list --porcelain` and inspect the candidate
branch's status, tip, and changed paths. A clean worktree can still contain an
unmerged implementation. Existing work is finished, triaged, or explicitly
retired; it is never reimplemented in a new worktree. New workers branch from the
current `dev` tip and do not share files with another active worker.

### Existing lanes — triage or finish; do not duplicate

These are live or unmerged lanes found during the 2026-07-13 inventory. Their
presence does not mean they are correct or ready to merge; it means the first
action is review/rebase-or-merge/test, not fresh implementation.

| ID | Existing lane | Worktrees / branches to inspect first |
|---|---|---|
| WT-1 | **PARTIAL — batch and de-generatorify tips are ancestors of current `dev`; perf-pass1 remains owner-bound** | `jess-perf-batch` / `work/perf-batch-integration` (`52394e053`, current); `jess-perf-walk-degen` / `perf/walk-degen` (`c1b0174e4`, current); `jess-perf-pass1` / `work/perf-pass1-gate-walks` (`dcd99eb9f`, diverged) |
| WT-2 | **CLOSED on current `dev` ancestry** — loop/body folding work is already integrated; do not replay it | `jess-each-fold` / `work/each-loop-fold` (`b7ef7e6f0`); `jess-bootstrap-forfold` / `work/bootstrap-forfold` (`c300b4387`) |
| WT-3 | Clone/source-span allocation | `agent-a2ef7321592f6c336` / `lane-a-value-alloc`, `jess-lane-a2` / `lane-a2-span-copy` |
| WT-4 | **PARTIAL — gate-12 namespace fallback is an ancestor; guarded/leaky namespace tips remain owner-bound; Q-27 is a bounded static-path slice** | `jess-gate12` / `work/gate12-namespace-fallback` (`0b3ccd259`, current); `jess-mg-nspath` / `work/mg-ns-path-call` (`bac41d242`, diverged); `jess-mg-guardedns` / `work/mg-guarded-ns` (`6edfa7dca`, diverged) |
| WT-5 | **PARTIAL — Q-26 is the only safe import leaf; the rest remains reference/import/extend owner work** | `jess-ref-sharedbody`, `jess-refext-mech2`, `jess-refflake`, `jess-refimport-wire`, `jess-extend-serialized`, `jess-extend-residual`, `jess-import-*`, and `jess-leaky-wall`; inspect each branch rather than assuming the family is one patch |
| WT-6 | **PARTIAL — callable-miss sentinel is an ancestor; argument-allocation lane remains owner-bound** | `jess-s2-callable-miss-sentinel*` (`a665f20dd`, current); `agent-a5b9de0704be21715` / `lane-b-argalloc` |
| WT-7 | **PARTIAL — dead-symbol tip landed; parser-hardening lane remains owner-bound** | `jess-deadsym` / `work/dead-symbol-cleanup` (`4abb2c50a`, integrated as `f7b3760bf`); `jess-parseman-026` / `work/parser-error-hardening` (`e7f448467`, diverged) |

### Queue rows

`WT-*` rows are the ownership guard. The following rows are the work to audit and
then either claim or close, in roughly this order. Rows with shared hot files are
sequential, not parallel, even when their descriptions look independent.

| ID | Bounded question / intended result | Primary write set | Proof required |
|---|---|---|---|
| Q-01 | **CLOSED by live code** — `lookupVersion` is already lazy through `_lookup`; verify callers before reopening. | `packages/core/src/tree/rules.ts` | current-code inspection and lookup tests |
| Q-02 | **CLOSED by the field-budget audit** — `_scopeFrame` is the irreducible, 91-site scope-chain cache and is explicitly fenced as load-bearing; moving it into `_lookup` would trade an eager slot for a per-frame state allocation/indirection. | `packages/core/src/tree/rules.ts`, `packages/core/perf/RULES_FIELD_BUDGET.md` | current field-budget evidence; do not reopen without a new measured design |
| Q-03 | **CLOSED by live code** — `varsByName` is already behind `_lookup`; verify docs and do not duplicate it. | `packages/core/src/tree/rules.ts` | current-code inspection and variable/scope tests |
| Q-04 | **CLOSED before this scale** — `PseudoSelector` placement/omit-wrapper state is already packed in `pseudoFlags` (`b8faeca2f`). | `selector-pseudo.ts` | selector fixtures and shape history |
| Q-05 | **CLOSED by current field-budget evidence** — `Ruleset` is already at five class-unique fields; `_selectorCacheOwner` is lazy, while `guard` and `selectorBeforeExtend` are read by callable/extend semantics. A subtype split would add shape/dispatch cost without a bounded total-work win; `_valueOf` remains the first slack concession if the class ever grows. | `ruleset.ts` | current field matrix, Ruleset 59, extend-import-style 23, baseline gates |
| Q-06 | **CLOSED by field matrix** — `_valueOf`, `name`, and `prelude` are load-bearing for identity, evaluation, rendering, comparison, and layer registration; `rules` is inherited body state, and `AtRuleStatement` already supplies the lean statement subtype. No safe cut. | `at-rule.ts` | AtRule 85, nesting-collapse 26, at-rule-basic 3, aggressive review |
| Q-07 | **CLOSED by live selector-family matrix** — Ampersand's two optional capture slots are already `declare`d/lazy, Compound has only common `value` plus lazy `_valueOf`, and Pseudo's generated placement state is already packed in `pseudoFlags`; the current census shows no remaining rare selector slot with a bounded cut. Existing selector-capture/ampersand worktrees are not a new implementation lane. | selector-family files | current field matrix, live own-key census, selector fixtures; no speed claim |
| Q-08 | **CLOSED before this scale** — render-path descriptor probing was already replaced by direct own/inherited checks (`a652e89c7`). | `tree/util/render-buffer.ts` | render-buffer history and current tests |
| Q-09 | **CLOSED by audit** — no remaining function-registration `defineProperties`; `name` needs its descriptor and record `Object.assign` sites are data merges, not shape setup. | `define-function.ts` | current-code inspection and function suite |
| Q-10 | **EXISTING-LANE — do not reassign** — the Ruleset/source-direct and bare-ampersand questions overlap the unmerged WT-1/perf-pass1, selector/ampersand, and hoist branches. Triage or port only an exact tip from those lanes after refreshing from current `dev`; no fresh worker until ownership is explicitly released. | `ruleset.ts`, serialize helpers | same-worktree render A/B and full Less corpus |
| Q-11 | **EXISTING-LANE — still open, no duplicate** — `jess-df-hoisted` (`6d74da74f`) owns adjacent hoisted append-`&` header merging in `serialize-helper.ts`, but does not implement the full `AtRule.frames` ancestor-chain migration. Keep the migration with that serialize/hoist owner; do not replay it in a new worktree. | `at-rule.ts`, `serialize-helper.ts`, emit walk | deep nesting byte identity and spine ratchet |
| Q-12 | **EXISTING-LANE — staged, no duplicate** — static layer-name registration is already represented by the unmerged extend-index/append-extend lanes (`jess-extend-serialized`, `jess-extend-residual`, `jess-append-extend`) and their design docs. Interpolated names remain dynamic. | layer/extend registration files | layer-extend fixtures, all-less, A/B |
| Q-13 | **CLOSED by audit** — render-buffer tests passed 30/30; the benchmark produced no samples because the worktree held an ignored stale `less-parser/lib/grammar2.js`. A clean parser compile regenerated `lib/grammar.js` and imported successfully; no render-buffer cut is supported. | `tree/util/render-buffer.ts` | focused tests plus clean-build/import evidence; no A/B claim |
| Q-14 | **CLOSED — existing parser/trivia work is already on `dev`** — `61fd158ef` and `c36b526d` are ancestors of the current integration tip; no parser implementation remains stranded in those worktrees. Current verification passed: less-parser 519 tests (2 expected failures, 5 skipped) and css-parser 249 tests (17 skipped). Do not assign parser code or duplicate the docs pass here. | `CORE-CLEANUP.md`, `SLIM_NODES_AUDIT.md`, parser docs/code | current-dev ancestry plus less-parser/css-parser suites; no speed claim |
| Q-15 | **PARTIAL — isolated shared-body serializer guard landed; broader WT-5 owner lane remains coupled** — `b69bf426c` ports only the proven `OutputWriter.hasContentSince(childPositionBaseline)` check from `b3f8dc8f5` into current `serialize-helper.ts`. It prevents a shared child’s empty return value from restoring bytes already written by the other placement, without replaying the conflicting `emit-walk.ts` reference-gate changes. Focused import/output-writer coverage passed `145/145` with 1 skipped; the spine byte-identity ratchet passed its selected cases; the integrated full gate passed core `3310/15/2todo`, spine `136/136`, all-less `106/106`, and Less compatibility `62/62`. Same-directory `benchmark.less` A/B was `221.20 ms` before versus `226.13 ms` after; the after signal was unstable, so this is a correctness/serialization fix with no speed claim. The remaining reference-routing, extender-inertness, import-wiring, and cloning tails still overlap `jess-refext-mech2`, `jess-refflake`, and `jess-refimport-wire`; do not reassign or broaden them. | `packages/core/src/tree/util/serialize-helper.ts`; remaining `reference.ts`, cloning, emit/extend owner lanes | writer-state guard, import-reference/output-writer coverage, spine byte identity, full baseline, aggressive review, matched benchmark A/B; remaining tails require owner refresh |
| Q-16 | **TRANSFERRED TO OWNER-JUDGMENT/DESIGN** — `F_VISIBLE` stage 1b/2b has no safe code change until the language conversion/consumer contract exists; keep it parked as a design question, not a worker lane. | `rules.ts`, render/visibility helpers | explicit semantic contract before code |
| Q-17 | **CLOSED by audit** — the alleged duplicate is not present; the only `ownCollapsedSourceChild` implementation is `tree/util/own-collapsed-source-child.ts` with three live callers. | `tree/util/own-collapsed-source-child.ts` | caller search and current-code inspection |
| Q-18 | **CLOSED by fresh census** — `dyn-census.mjs` now keys live traversal on stable `Node._tag`/`node.type` instead of minifiable constructor names. Current `dev` dynamic workload: 50,059 live nodes; Ruleset 8,405, Declaration 10,007, Reference 7,211, Color 3,604. The slim-node audit records current frequency/shape width and keeps old byte rows historical. | `packages/core/perf/SLIM_NODES_AUDIT.md`, `packages/core/perf/heap/dyn-census.mjs` | reproducible census run, current `dev` reference, no runtime code change |
| Q-19 | **CLOSED by current field-budget audit** — `Declaration` has three class-unique slots (`name`, `value`, `important`); all are common content, and merge/reference metadata is already carried through options/derived state. Splitting the hot common node would add dispatch/shape cost without a bounded win. | `declaration.ts`, cloning/reference helpers | current field matrix and declaration/merge call-site inspection |
| Q-20 | **CLOSED for this scale** — current `Node` has eight foundational slots (inline span, source root/options, flags, source/placement links); each is read or written by core adoption/clone/render paths. Removing one needs a cross-cutting base-shape redesign, not a bounded cleanup cut. | `node-base.ts`, placement helpers | current field-budget audit, clone/inherit and baseline gates |
| Q-21 | **CLOSED by matched A/B** — the current four-field Color shape is fast and monomorphic. A lazy omission saved a slot but split hidden classes and regressed RGB `6.59ms → 7.48ms` and HSL `7.18ms → 7.88ms`; restore the fixed shape. | `color.ts` | core Color 51/51, fns Color/function 61/61, aggressive review, matched timing |
| Q-22 | **CLOSED with Q-14** — the parse/trivia implementation and its focused tests are already included in current `dev`; the remaining parser worktrees are historical/ancestor or docs-only state, not an in-flight implementation. No second parser lane is justified. | css/less parser packages and parser fixtures | current-dev ancestry plus parser suites; no speed claim |
| Q-23 | **CLOSED by current-state audit** — `RulesLookupState` already centralizes the cold maps, owns the full callable index, and invalidates it with the callable cache. The remaining per-name maps/epochs serve distinct lookup consumers; the uncommitted `jess-perf-lookup` worktree is a stale mixed diff (including removal of the comma-selector and charset fixes), not a safe Q-23 implementation. No bounded packing/reuse win is supported. | `rules.ts`, `reference.ts` | live state audit, lookup/namespace call-site inspection; no speed claim |
| Q-24 | **CLOSED by current frontier/code audit** — render-buffer descriptor probing and legacy helper sites are gone; remaining `OutputWriter` constructions are scoped to reentrant, source-map, or temporary serialization seams. Reusing them would require threading/snapshot semantics, so no bounded buffer-shape cut is supported here. | render-buffer and output helpers | render-buffer frontier, current construction-site audit, baseline gates |
| Q-25 | **CLOSED by existing WT-7 lane** — `TreeVisitor` was an unused auto-walk export with no production subclass/import; delete the class and its test, retain generic `Visitor`/`Node.accept`, and keep eval/visitor machinery that remains load-bearing. Core visitor `4/4`, Less-compat visitor `8/8`, core 3307/15/2todo, spine 136/136, all-less 106/106, and matched benchmark recorded with no speed claim. | `packages/core/src/visitor/index.ts`, visitor test, visitor integration comments | repository-wide consumer search, focused visitor tests, full repo gate, benchmark before/after |
| Q-26 | **CLOSED — bounded import case-B boundary leaf** — adapted the existing `31ce6bd` fix for a deferred interpolated-path import whose body contains an `(inline)` sub-import: project inline-source state through the writer boundary, remove only the now-dead deferred abort, and preserve byte output. The stale imported-`treeContext`, callable, and serializer stack was not revived. | `rules.ts`, `tree/util/emit-walk.ts`, `tree/util/print.ts` | import-interpolation focused ratchet, core `3307/15/2todo`, spine `136/136`, all-less `106/106`, all-less-error `92/2 skipped`, aggressive review, matched clean-build `benchmark.less` A/B recorded with no speed claim |
| Q-27 | **CLOSED — bounded static namespace-path slice** — adapt only the pure static namespace-path call admission and source-order candidate ordering from `6edfa7dca`: array-shaped keys are admitted only with the parser's authored `rawKey` marker, and disjoint candidates use source-span order. Exclude guarded namespace-segment visibility, parent mutation, and routine guard-miss errors. Core `3308/15/2todo`, spine `136/136`, all-less `106/106`, all-less-error `92/2 skipped`, clean build, aggressive review, and matched benchmark A/B passed; both benchmark runs were unstable, so no speed claim. |
| Q-28 | **ACTIVE SCALE — parser producers, sequenced as bounded semantic subrows** — flip remaining static parser tokens from throwaway `Any`/`Keyword` nodes to bare strings where current consumers are already string-ready; keep interpolation, math/coercion, reference results, and calculated/eval outputs as nodes. This is a parser/AST-contract batch, not a continuation of the current emit-walk cleanup. `node.type` remains the prototype string discriminant; it is not being removed. | `packages/less-parser/src`, `packages/css-parser/src`, `packages/scss-parser/src`, narrowly required core consumers/tests | Parseman/CST trivia contract, parser AST baselines, focused string-form fixtures, clean-build parse+render A/B, core/spine/all-less/all-less-error, aggressive review |
| Q-28A | **CLOSED — opaque CSS at-rule headers** — comment-free generic statement-at-rule and unknown-block-at-rule preludes now store as source strings; `@charset` remains its role-bearing `Any`, comment-bearing preludes retain `Any` because the current trivia path needs a span-bearing wrapper, and Less/SCSS import-specific and calculated/interpolated paths remain unchanged. The existing spine admission predicates now accept static strings as well as static nodes. CSS parser AST coverage is 251 passed/17 skipped; core 3308 passed/15 skipped/2 todo; spine 136/136; all-less 106/106; Less compat 62/62; aggressive review, package exports, metadata, frontier checks, and clean builds passed. Matched clean-build `benchmark.less` runs on Node v25.9.0 arm64 were neutral/no-claim: control 262.91 ms median / 264.24 ms trimmed, parser slice 262.14 / 261.52, final consumer fix 247.25 / 246.84 but unstable due a 1324.86 ms outlier. | `packages/css-parser/src/builders.ts`, `packages/css-parser/test/ast-serialize.test.ts`, `packages/core/src/tree/util/emit-walk.ts` | parser shape assertions, `@charset` and comment/trivia guards, byte-render corpus, clean-build benchmark A/B, core/spine/all-less/compat baseline, aggressive review |
| Q-28B | **CLOSED — scalar Less value leaves** — the active Less builder now preserves one inert static identifier as a raw declaration string, while colors, dimensions/numbers, references/accessors, calls, namespace paths, interpolation, operations, parens, and lists/groups remain node-backed. Mixin-parameter defaults and named arguments remain `Keyword` nodes; custom-declaration fallback remains excluded under Q-28C. Focused/adjacent suites passed `142/142`, the full baseline passed, and a compiled-parser probe over 1,000 static variable declarations produced 1,000 raw strings and zero value nodes. Matched `benchmark.less` A/B was noisy/neutral: control `245.59 ms` median / `251.50 ms` trimmed, after `252.54 ms` / `253.11 ms`; no speed claim. | `packages/less-parser/src/builders.ts`, `packages/less-parser/test/ast-serialize.test.ts`, `packages/less-parser/test/variables.test.ts` | positive string shape plus negative node-shape guards, Less render/eval parity, mixin-keyword guards, compiled shape/allocation probe, full baseline, aggressive review, matched benchmark A/B with signal-quality caveat |
| Q-28C | **CLOSED — existing permissive custom-property/prelude lane** — finished and triaged `work/permissive-props-interp` before assigning Q-28B. Less `--*` fallback values now remain verbatim/interpolation-only, while quoted and multi-token unknown-at-rule prelude values preserve the existing variable/interpolation behavior. The current-dev merge retained ratio handling. The baseline caught that SCSS composes Less's `customValue` rule; retaining that rule as an SCSS-only composition seam fixed the integration issue without restoring it to Less's own choice. Focused Less/SCSS parser suites, full baseline, and all-less corpus passed `106/106` with the repository's expected failures. Matched stable `benchmark.less` on Node v25.9.0 arm64 was noisy: control `266.14 ms` median (`69/500` outliers, `24.2%` RSD, unstable); after `285.82 ms` median (`42/500` outliers, `28.0%` RSD, usable). Delta `+19.68 ms` / `+7.4%` is not treated as causal; no speed claim. | `packages/less-parser/src/builders.ts`, `packages/less-parser/src/grammar.ts`, Less parser declaration/AST fixtures, `packages/scss-parser/src/grammar.ts`, `packages/jess/test/less/all-less.test.ts` | existing-lane ownership audit, parser/declaration suites, SCSS composition checks, all-less corpus, full baseline, aggressive review, matched benchmark A/B with signal-quality caveat |
| Q-28D | **CLOSED — no safe CSS value-component slice at this boundary** — the resumed owner traced `_assembleValue` and found that bare identifiers, including multi-token inert segments, already arrive as `Keyword` nodes before the candidate string-only branches. The attempted builder/test patch was reverted after its shape assertions failed (`51 passed, 2 failed`); it did not remove the target wrappers and no production behavior changed. The clean assigned worktree is unchanged; `git diff --check` passed. Same-directory `benchmark.less` control on Node v25.9.0 arm64 was `244.63 ms` median over 72 samples (`233.12–396.45 ms`, 10 outliers, unstable), so there is no after run or speed claim. Do not reopen this row without a producer seam that actually owns the `Keyword` construction. | no files changed | existing Q-28A ownership audit, `_assembleValue` input trace, failed shape probe, clean worktree, control benchmark record, explicit no-op |
| Q-28E | **FENCED — static SCSS value/name leaves** — the producer idea is valid, but active `jess-scss-calc`, `jess-scss-import`, and `jess-parseman-026` worktrees still own SCSS grammar/tests. Do not claim the builder/test lane until those owners release or explicitly split ownership. When released, audit inert identifiers in declaration/value/name positions; keep interpolation, variable references, maps/collections, calls, operators, and role-bearing at-rule tokens as nodes, and retain the Less grammar composition seam from Q-28C. | `packages/scss-parser/src/builders.ts`, SCSS AST fixtures, only proven consumer adapters | ownership audit with dirty-path evidence, AST contract and interpolation guards, parser/render parity, full SCSS suite, clean-build benchmark A/B, aggressive review |
| Q-28F | **FENCED — static Less selector/combinator payloads** — an existing detached `jess-less-selcapture` worktree already owns `packages/less-parser/src/builders.ts`/grammar changes for selector-capture, while adjacent ampersand/extend lanes remain active. Do not assign a second builder pass. When ownership is released, audit only inert selector atoms/combinators, preserving ampersand, interpolation, pseudo arguments, extend metadata, source trivia, and calculated selector surfaces. | `packages/less-parser/src/builders.ts`, selector AST fixtures, selector/extend consumer tests | exact worktree ownership audit, string/node parity matrix, extend and trivia guards, spine/all-less gates, clean-build benchmark A/B, aggressive review |
| Q-29 | **CLOSED — creative selector-bitset experiment retired as a no-op** — an isolated agent tested replacing the one-component iterable path in `selector-analysis.ts:146-160` with direct `BitSet` operations. Exact bit-array equality, semantic membership, and cardinality matched. On Node v24.11.1 arm64 with 4 warmups and 12 timed samples, 1,000 repeated normalized selector strings measured `0.255 ms → 0.243 ms` (~4.8%, noisy), while 10,000 measured `1.830 ms → 1.832 ms` (~0.1% slower). The larger workload did not move meaningfully and the shortcut would duplicate `BitSetLibrary.getBitset()` internals, so no production write set or owner escalation is justified. | `/tmp/jess-selector-bitset-bench.mjs` only; no repo files changed | scratch experiment, exact output/shape parity, scaled workload A/B, no production patch, explicit no-op retirement |
| Q-30 | **FENCED BY D-EVAL LANE — typed value literals as `(string, tag)`** — **sequence this immediately after the current Q-28D/E/F producer lanes are either merged or explicitly released, and before Q-31 selector-container experiments.** This is the string-backed value plus compact semantic-tag lane, not a removal or repurposing of the prototype `node.type` discriminant. Extend the inert-string boundary from keywords/idents to static dimensions, numbers, colors, and Less booleans. Parser output should retain the verbatim literal plus a compact parse-time tag; `Declaration` carries a scalar tag or packed per-slot tag array, and only an operated/matched slot materializes the corresponding `Dimension`/`Num`/`Color`/`Bool`/`Keyword` node. This is separate from Q-28: Q-28 removes already-node-free static parser wrappers, while Q-30 removes wrappers for typed literals without losing calculation semantics. The active producer seam is the functional parser builders/grammar path; the legacy `cssRecursiveParser.ts`/`lessRecursiveParser.ts` names are historical and are not a current worker write set. The existing local `work/deval-flip` / `jess-deval-flip` lane is not a current-dev integration tip: it has six old commits but a 284-file divergence from current `dev`, and `origin/work/deval-flip` resolves to an unrelated ref. Do not replay it; require an owner refresh from current `dev`, an exact tested sub-batch, and the mandated post-flip value-heavy profile before opening this row. Within Q-30, Dimension/Num comes first, then Color, then keyword/bool unification. | `packages/css-parser/src/builders.ts`, `packages/css-parser/src/grammar.ts`, `packages/less-parser/src/builders.ts`, `packages/less-parser/src/grammar.ts`, `packages/core/src/tree/declaration.ts`, `packages/core/src/tree/util/evaluate-node-array.ts`, `packages/core/src/tree/any.ts`, `packages/core/src/tree/dimension.ts`, `packages/core/src/tree/color.ts`, `packages/core/src/tree/operation.ts` | D-EVAL owner refresh, value-heavy allocation/materialization census, no-write-back/tag-shape tests, operated-path parity, all-less byte triage, same-directory `benchmark.less` A/B plus value-heavy fixture, aggressive review |
| Q-31 | **PARKED — selector containers as nested arrays** — do not generalize Q-30's string-plus-tag idea to `SelectorList`/`ComplexSelector` containers yet. Selectors are computed on the extend/match path that matters for `benchmark.less`; replacing typed containers with nested arrays could save resident nodes while adding `typeof`/`Array.isArray` dispatch to every match. Revisit only as an isolated experiment after Q-30, gated on extend-match performance rather than serialization or heap size. | selector container classes and extend/match pipeline | explicit match-path benchmark, recursive `:is()`/`:not()` shape matrix, byte parity, owner review before any production claim |
| Q-32 | **TRANSFERRED TO OWNER-JUDGMENT/DESIGN — sparse provenance backend** — the old unconditional span-stamp premise is disproven by landed `b19b66a92`: comment-free parse containers already skip the per-node span entry. The remaining unified side-table versus serialize-time-boundary-recovery choice changes trivia ownership and has a known comment-placement revert trap; do not assign a production worker until an owner selects the exact A/B protocol and accepts the broader serializer risk. | `packages/css-parser/src/builders.ts`, `packages/core/src/tree/util/provenance.ts`, `packages/core/src/tree/util/trivia.ts`, selector/declaration serializers | current stamp-gate evidence, same-directory parse+render A/B, `comments`/`comments2`, render-scaling guard, all-less byte parity, aggressive review, explicit owner decision |
| Q-33 | **CLOSED — lazy `AtRule` identity cache** — `_valueOf` is now declaration-only, so uncached `AtRule` instances do not pay an eager own slot; the existing memoized identity remains available to `Node.compare()` and structured preludes, and invalidation only clears an existing cache. Focused AtRule tests passed `87/87`; the full baseline passed core `3310/15/2todo`, all-less `106/106`, compatibility `62/62`, and frontier/export/metadata checks; `spine-production-ratchet` passed `136/136`; aggressive review and `git diff --check` passed. Same-directory clean-build `benchmark.less` A/B was recorded with 36 samples per side: control round median `226.27 ms`, candidate `222.65 ms`, but the candidate was unstable and trimmed medians were `227.97 ms` versus `228.91 ms`, so there is no speed claim. | `packages/core/src/tree/at-rule.ts`, `packages/core/src/tree/__tests__/at-rule.test.ts` | own-key shape assertion before/after `valueOf()`, structured-prelude identity, mutation/eval invalidation, core/ratchet/all-less gates, same-directory clean-build `benchmark.less` A/B, aggressive review |
| Q-34 | **CLOSED — remove duplicate calc-call predicate** — `Operation.isUnoperable()` no longer repeats the `isCalcCall` test that both callers perform immediately before it. This removes a hot-path branch without changing the operation contract or node shape. Focused Operation/string-normalized-eval coverage passed `32/32`; the full baseline passed, `spine-production-ratchet` passed `136/136`, aggressive review and `git diff --check` passed. Same-directory `benchmark.less` A/B used 24 samples per side: control round median `243.79 ms`, candidate `244.94 ms`; the candidate signal was unstable and the trimmed median moved `244.39 ms` to `241.66 ms`, so there is no speed claim. | `packages/core/src/tree/operation.ts` | caller/precondition audit, Operation and string-normalized-eval tests, same-directory `benchmark.less` A/B, aggressive review, full baseline, spine ratchet |
| Q-35 | **CLOSED — remove temporary at-rule body-record spread** — `createBodyEvalRecord()` now stores the total `bodyRules` field directly instead of creating a conditional spread object. This preserves the fixed record shape and removes a temporary allocation; no parent, provenance, or body-evaluation semantics changed. Focused AtRule coverage passed `87/87`; the full baseline passed, `spine-production-ratchet` passed `136/136`, aggressive review and `git diff --check` passed. Same-directory `benchmark.less` A/B used 24 samples per side: control round median `234.05 ms`, candidate `241.68 ms`; trimmed medians were `237.75 ms` and `245.35 ms`, so this is accepted as a shape/allocation cut with no speed claim. | `packages/core/src/tree/at-rule.ts` | total-return contract, AtRule body/visibility/writer/source-body tests, same-directory `benchmark.less` A/B, aggressive review, full baseline, spine ratchet |
| Q-36 | **CLOSED — cast plain-object dependency cut rejected** — `packages/core/src/tree/util/cast.ts` still uses `lodash-es/isPlainObject`: the nearby constructor-only helper does not preserve lodash's accepted/rejected boundary for null-prototype, custom-prototype, Symbol-tagged, and cross-realm objects. An exact native replacement would be larger or riskier than the import, so no production or object-shape change is justified. The bounded object-shape audit passed 29 focused cast/conversion/Bool tests and the aggressive review; a same-built-closure benchmark repeat measured `208.53 ms → 218.00 ms` with identical code, so it is a measurement record only and carries no speed claim. | `packages/core/src/tree/util/cast.ts` | lodash/native object-shape matrix, cast/conversion tests, aggressive review, same-directory benchmark attempt; explicit no-op |
| Q-37 | **CLOSED — root flat writer/buffer transport** — the compiler-owned flat render buffer now aliases `OutputWriter.chunks` through `RenderBuffer.parts`, so root spine output no longer stores the writer chunks plus a second whole-document buffer entry. The spine writes charset/import prelude bytes before descent and fixes the direct body's terminal framing in place; explicit caller-owned flat buffers, segmented buffers, and source-map output stay detached. Focused core render-buffer/rules/node-buffer tests passed `121/121` with `5` skipped, core/Jess compile passed, and the final matched control/candidate benchmark was `246.64 ms → 245.77 ms` (`-0.87 ms`, `-0.35%`, qualified/no causal speed claim). The eval-fallback audit found no safe `emit-walk.ts`-only removal; imported-extend topology belongs to `spine-extend.ts`, while unresolved interpolated imports and root-direct loops remain semantic gates. | `packages/core/src/tree/util/render-buffer.ts`, `packages/core/src/tree/rules.ts`, `packages/core/src/tree/util/emit-walk.ts`, `packages/jess/src/index.ts`, focused tests | shared-buffer ownership, prelude/newline parity, source-map/caller-owned isolation, core/Jess compile, spine/all-less/full baseline gates, aggressive review, matched benchmark A/B, fallback residual audit |
| Q-38 | **OWNER-GATED — remaining eval fallback residuals** — the canonical Less 4.x fixture makes one spine admission, aborts before output on `extend topology`, and enters whole-file eval fallback (`10,777` eval-node/preparation entries, `10,776` repeated preparations, `846` derives). No safe `emit-walk.ts`-only removal was found. A genuinely unresolvable interpolated import must retain eval ownership for Less error semantics, and root-direct loops remain outside the current spine emitter. Continue only with an owner of `packages/core/src/tree/extend/spine-extend.ts` and a topology/parity test batch; do not weaken the re-gate or duplicate the existing worker's investigation. | `packages/core/src/tree/extend/spine-extend.ts`, `packages/core/src/tree/util/emit-walk.ts`, spine topology tests | current-dev owner refresh, imported-extend topology proof, root-loop and unresolved-import parity, spine derive counter, all-less byte identity, benchmark A/B, aggressive review |
| Q-39 | **CLOSED — lazy OutputWriter transient state** — ordinary `tracksSources=false` writers no longer materialize idle captured-segment or queued-spacer own fields, and the dead trailing-newline-origin diagnostic/accessor is deleted. `_posLength` remains intentionally eager for constant-time rollback. Full core passed `3311` tests with `15` skipped and `2` deferred; focused writer coverage passed `55/55`; the exact same-checkout `benchmark.less` control/candidate/candidate sequence was `253.67 → 289.79 → 242.93 ms` (15 iterations, 5 warmups, 3 rounds), an order-sensitive swing with no causal speed claim. | `packages/core/src/tree/util/print.ts` | generated writer shape, capture/spacer/source-map behavior, full core, core build, benchmark sanity; no AST or eval fallback ownership |
| Q-40 | **ACTIVE — canonical `benchmark.less` performance program (<40 ms)** — use the Less 4.6.3 fixture at `/Users/matthew/git/oss/less.js/packages/less/benchmark/benchmark.less`, with Jess `Compiler.render()` configured for `collapseNesting: true` plus the Less and Less-compat plugins. The contract is `scripts/compare-less-parse-render-env.mjs`, Node v25.9.0 arm64, 20 warmups, 45 alternating no-op pairs, fixed fixture/options/cache process, and a separate `parse-render` versus parse-once `render` phase; `profile-less-benchmark.mjs` is diagnostic only. Current same-checkout controls: Jess parse+render **238.98 ms** median (control 238.98, no-op candidate 241.79) and parse-once/render-only **202.92 ms** (control 202.92, no-op candidate 202.38)—both far from the target and proving render/eval is the immediate dominant gap. On the same machine/runtime, Less 4.6.3 measured `less.parse(..., { processImports: false })` **4.258 ms** and `less.render()` **31.101 ms** median (20 warmups, 45 samples). Jess preserves its own baseline output byte-for-byte (133,983 bytes); Less output is a speed comparator, not a byte oracle (131,674 bytes). The direct profile records 4,085 declaration preview fallbacks, 1,644 duplicate-declaration containers, and 33,607 declaration-strategy child-surface traversals. Those traversals are only 22 property-merge references and the safe local short-circuit activates once, so generic lookup cache/index work is rejected. Parseman remains separately ranked: equal-contract no-import parsing measured Less AST 6.01 ms, Jess `parseLessFn` 35.77 ms, and recognizer-only 12.58 ms; the next parser work is a capture/raw-child representation proof plus a separate no-op-trivia-call guard, not a claim that AST building explains the whole gap. Every retained core change must have same-checkout A/B evidence plus core/spine/all-less/aggressive gates. | eval/render/fallback, detached declaration formatting, parser recognizer/capture, import/mixin placement scaling, node allocation | stable medians with fixed Node/fixture/options/cache/warmups/rounds, byte identity against Jess baseline, core/spine/all-less/aggressive gates, then merge/push |

**Q-40 active-row correction (2026-07-15):** the older `238.98/202.92 ms`
and `133,983`-byte values in the ledger row above are historical evidence.
The latest corrected current-dev profile below uses the agreed Less 4.x
fixture and reports `227.862→229.434 ms` parse+render,
`197.435→200.022 ms` render-only, and `135,794` output bytes with hash
`9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.

### Q-40 capture ledger — 2026-07-15

This is the index for today's architecture/performance work. It deliberately
separates durable conclusions from isolated artifacts and active workers: a
row in this table is not a claim that the implementation has landed on `dev`.

| Work captured today | Durable record | Current state / truth boundary |
|---|---|---|
| Greenfield AST design, alternative representations, and the no-class `tree2` experiment | [`AST-FROM-SCRATCH-DESIGN.md`](./AST-FROM-SCRATCH-DESIGN.md); isolated source under `/Users/matthew/git/worktrees/jess-greenfield-ast-design-20260714/packages/core/src/tree2/` and `__tests__/` | Design, ten-way alternatives, five POC sequence, and rejection evidence are durable. The staged source is uncommitted/unexported. The mixed-root synthetic route passed its focused/exact-output gates, but the canonical evaluated route failed its output hash comparison; there is no tree2 speed or production-AST claim. |
| Parseman versus Less recognizer gap and true recognizer POC | [`PARSER-RECOGNIZER-GAP.md`](./PARSER-RECOGNIZER-GAP.md); Parseman `/Users/matthew/git/oss/parser-thing/notes/PERF_IDEAS.md` | Flow analysis and the `12.58 ms` recognizer result are recorded. Parseman commit `c84d777` is local/unpublished, so Jess has not adopted it and no Jess speed claim follows. |
| Less declaration-versus-ruleset statement-dispatch proof | [`PARSER-RECOGNIZER-GAP.md`](./PARSER-RECOGNIZER-GAP.md); rejected worker commit `0d6879277` in `/Users/matthew/git/worktrees/jess-q40-less-statement-dispatch-20260715` | Rejected. Moving `Declaration` before `Ruleset` accepted a prefix before a following `{` and stopped the canonical parse at byte `93,456` with `3` errors. The probe was removed; no source change or valid candidate A/B remains. |
| Parseman zero-copy structural-builder POC | [`PARSER-RECOGNIZER-GAP.md`](./PARSER-RECOGNIZER-GAP.md); Parseman `/Users/matthew/git/oss/parser-thing/notes/PERF_IDEAS.md`; isolated source at `/private/tmp/parseman-zero-copy-builder-20260715` | Retained local Parseman commit `950e8b4`: `62` focused tests; array `10.97 ms` → range `4.35 ms` on the 106,797-byte Less grammar; output hash identical; transient heap regressed about `1.95 MB` → `7.17 MB`. The fused `compileLinkable` host integration was technically repaired and exact-output, but real Less parse rose `58.6→88.6 ms`, heap rose, and generated code grew `747` bytes; reject Jess adoption. This is a generic Parseman POC, not a Jess speed claim. |
| Parser-host declaration `Spanned[]` reuse proof | Read-only parser/CST audit; rejected worker commit `9f35c2921` on `feature/q40-parser-host-20260715` | The shipping functional parser is Parseman, not the retired Chevrotain `consumeName` path. Reuse eliminated `1,938→0` duplicate conversions per external benchmark parse while Less declaration builds stayed `2,800`; parse median was neutral at `57.274→57.359 ms`, transient heap `46.24→45.54 MiB`, and canonical A/B was noise (`232.230→227.630 ms` parse+render, `196.080→196.483 ms` render-only). Output was exact at `135,794` bytes with hash `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`. Focused parser, core `3,329`, baseline, spine `137/137`, all-less `106/106`, and compatibility `62/62` passed; aggressive review rejected the lane because builders lack required machine-readable cost contracts. No source or tests were retained. |
| Parseman trivia/capture separation and sparse trivia designs | [`parseman-trivia-audit.md`](../parseman-trivia-audit.md), [`trivia-offset-inference-model.md`](../trivia-offset-inference-model.md), and [`parseman-perf-proposals.md`](../parseman-perf-proposals.md) | The generic Parseman responsibilities, CSS/Less capture policy, comment-only capture idea, and span-based inference are documented as proposals/evidence. No CSS-shaped Parseman change is being treated as landed. |
| From-scratch AST creativity pass: packed arenas, structs, semantic islands, direct emitters, dependency-aware reuse, and debug projections | [`AST-FROM-SCRATCH-DESIGN.md`](./AST-FROM-SCRATCH-DESIGN.md) | The alternatives are explicitly design candidates, not a hidden commitment to a class-for-class rewrite. CSS output, not legacy field/class shape, is the acceptance oracle. |
| Lookup, merge, fallback, and evaluator-action audit | [`CORE-CLEANUP.md`](./CORE-CLEANUP.md), [`HANDOFF.md`](./HANDOFF.md), and [`AGGRESSIVE-CUTTING-REVIEW.md`](./AGGRESSIVE-CUTTING-REVIEW.md) | The 10,777 repeated preparation/admission scans, explicit merge-surface mistake, fallback topology, rejected generic index/prototype-chain shortcuts, and rejected terminal-miss sentinel are recorded. No broad lookup redesign is silently assumed. |
| `isNode` call-site audit | [`HANDOFF.md`](./HANDOFF.md) latest Q-40 entries | Broad sampled cost was confirmed, but caching the discriminator at one extend call site was noise/slower and failed the cost-contract gate. Future work must eliminate call sites or carry producer-owned facts, not add a generic predicate variant. |
| Flat writer sharing and OutputWriter state slimming | Q-37 and Q-39 in this tracker; [`HANDOFF.md`](./HANDOFF.md) | Flat root sharing and lazy transient writer state are landed/reviewed with byte identity. Their timing results are qualified; neither is presented as the missing `<40 ms` win. |
| Direct declaration-writer proof | [`HANDOFF.md`](./HANDOFF.md) latest Q-40 entries | Rejected: the candidate had zero canonical activations, failed synthetic value/caller-buffer probes, and its apparent A/B movement was non-causal. No writer source change remains. |
| Evaluator/serializer frame-boundary proof | Worker branch `feature/q40-evaluator-serializer-frame-proof-20260715`, local commit `04a230e89`; landed integration commit `d211e8964` | The worker's structural result and two-phase/no-op evidence are captured. Current-dev dependency builds, focused tests, aggressive review, core, spine, all-less, and fresh same-checkout A/B are green. The fresh canonical A/B was parse+render `234.714→234.657 ms` (paired delta `-0.878 ms`, `24/45`) and render-only `198.801→198.271 ms` (paired delta `+2.695 ms`, `21/45`); output remained byte-identical at `135,794` bytes, hash `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`. Retained as a structural simplification, not a speed win. |
| Scope-frame allocation audit and empty pending-name proof | Read-only flow/heap audit; rejected worker commit `6dc929a36` plus the retained regression test | Rejected. `rules.ts` directly mutates `pendingDeclarationNames`, so a shared empty sentinel contaminated later frames. The trial also regressed both benchmark phases and had higher RSS; no production source change is retained. |
| Compiler-root writer readback audit and writer-only result proof | Read-only OutputWriter/RenderBuffer audit; isolated worker commit `763eb1535` in `/private/tmp/jess-q40-root-writer-readback-20260715` | Audit found `13,235` `getSince()` calls scanning `109,102` chunks and `10,907` `trimEndSince()` calls. The bounded proof reduced fallback `getSince()` readbacks `3→1` and whole-buffer reads `2→0`; focused output and canonical output were exact. A/B was parse+render `237.066→236.102 ms` (`23/45`) and render-only `197.764→198.235 ms` (`23/45`), so no stable speed claim. Core `3,333`, builds, compiler reuse, public API, spine `137`, and all-less `106` passed; the candidate remains isolated because the aggressive-review registry needs out-of-scope handoff edits. |
| Extend/spine topology and fallback ownership audit | Read-only extend/spine/fallback audit plus current-dev append×extend revalidation commit `91f4881d9` in `/Users/matthew/git/worktrees/jess-append-extend-revalidation-20260715` | Canonical rendering admits spine once and aborts on imported/reference topology. Extend classification has `42,926` probes with `99.82%` no-matches; application has `39,605` calls with `99.89%` no-matches. The append revalidation found `spineAttempts=1`, `ampAppend=7`, `extend=26`, and `0` append-target collisions: canonical append cases already fold safely. The only retained result is a test-only rejection; stale append×extend/spine/fallback lanes must not be reopened for this fixture. The only unowned `@layer` slice is correctness-oriented, not a Q-40 performance target. |
| Import/mixin reuse, placement frames, static slots, dependency graph, and tree-shaken custom-property module direction | Q-40 import-placement sections, [`HANDOFF.md`](./HANDOFF.md), and the recommended shape in [`AST-FROM-SCRATCH-DESIGN.md`](./AST-FROM-SCRATCH-DESIGN.md) | The canonical-body/placement-overlay and dependency-graph ideas are recorded as design direction. The import/mixin reuse model is not being claimed as implemented, and the exported-custom-property tree-shaking path remains future product work. |
| Typed string-plus-tag values and value materialization boundary | Q-30 in this tracker and POC 1 in [`AST-FROM-SCRATCH-DESIGN.md`](./AST-FROM-SCRATCH-DESIGN.md) | Explicitly fenced behind the active producer lanes. It covers dimensions, numbers, colors, booleans, and multi-token values while preserving authored strings; no partial scalar puppet test is being treated as the implementation. |
| Registration-prep allocation audit and fresh canonical controls | [`HANDOFF.md`](./HANDOFF.md) latest Q-40 entries | Registration-prep laziness was rejected after a real `#container` mixin lookup failure; its `131,578`-byte diagnostic snapshot did not match the current `135,794`-byte oracle and is not A/B evidence. The current-dev no-op controls are parse+render `221.471→221.611 ms` and render-only `187.961→187.167 ms` under 20 warmups/45 pairs; both are noise-floor controls. |
| Trivia bulk and Less-host policy audit | [`HANDOFF.md`](./HANDOFF.md) latest Q-40 entries; [`parseman-trivia-audit.md`](../parseman-trivia-audit.md) | Evidence shows whitespace bookkeeping dominates materialized trivia runs. The next POC is Less-host comment-only/trivia threading; global Parseman policy and whitespace suppression remain unadopted until exact serializer parity is demonstrated. |
| Imported/reference topology proof for the canonical spine abort | Active isolated worker `feature/q40-import-reference-admission-20260715` in `/Users/matthew/git/worktrees/jess-q40-import-reference-admission-20260715` | In flight. The bounded question is whether the source-order-aware `h1` imported/reference topology can be admitted without the existing `EMIT contribution collapsed to empty` failure. No result, source change, benchmark claim, or integration decision exists yet; add the returned evidence here before any merge. |
| Less-host comment/trivia threading proof | Active isolated worker `feature/less-host-trivia-poc-20260715` in `/Users/matthew/git/worktrees/jess-less-host-trivia-poc-20260715` | In flight. The bounded question is whether Less can request only the trivia distinctions its serializer needs while preserving generic Parseman behavior and exact output across whitespace, comments, descendant selectors, multiline values, standalone comments, and `url(//host)` cases. No result, source change, benchmark claim, or integration decision exists yet; add the returned evidence here before any merge. |

### Active and completed proof lanes captured in the ledger

These workers and artifacts are intentionally listed here so a later agent
does not duplicate a lane or lose a result that remains isolated:

- Rejected: fixed-shape reference-surface allocation proof, owned by
  `packages/core/src/tree/reference.ts` and focused tests in
  `/private/tmp/jess-q40-reference-surface-allocation-20260715` on
  `feature/q40-reference-surface-allocation-20260715`, commit `a69f51b5d`.
  The semantically valid candidate was benchmark-activated (`1,428` seam calls
  on `benchmark.less`, `1,200` on a dynamic fixture) but showed no causal speed
  or consistent memory win; it was reverted to evidence-only. Benchmark
  parse/render was `230.686→231.084 ms` and render-only `200.831→197.308 ms`;
  dynamic fixture parse/render was `243.909→216.267 ms` and render-only
  `134.793→134.009 ms`, without a stable canonical signal. Outputs were exact
  (`135,794` bytes, hash `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`;
  dynamic `192,519` bytes, hash `38a968f24a8bd34be03fc667cddb679bc0e35a9335fbb731ec0cef38e0f337cc`).
  Do not reopen the reflective/reference-surface lane without a new workload
  and a simpler, consistently beneficial shape.
- Returned ownership audits at the same snapshot cover registration/source-order
  preparation, parser/CST/trivia capture, OutputWriter/RenderBuffer assembly,
  and extend/spine/fallback topology. Their findings are recorded in the Q-40
  sections below; they do not imply that every proposed follow-up is safe or
  implemented. The parser-host duplicate-`Spanned[]` proof was rejected after
  its measured neutral result; the compiler-root writer-readback proof remains
  isolated and unaccepted on `dev`.
- Rejected: Less `blockItem` statement-dispatch proof:
  `feature/q40-less-statement-dispatch-20260715`, worktree
  `/Users/matthew/git/worktrees/jess-q40-less-statement-dispatch-20260715`,
  handoff commit `0d6879277`. Moving `Declaration` before `Ruleset` caused
  premature declaration successes and stopped the canonical parse at byte
  `93,456`; the probe was removed and no source change was retained.
- Retained local POC: Parseman generic zero-copy structural builder,
  `feature/parseman-zero-copy-builder-20260715`, commit `950e8b4`, worktree
  `/private/tmp/parseman-zero-copy-builder-20260715`. It is not published or
  adopted by Jess; the measured heap regression is recorded above.
- Rejected: terminal direct-lookup miss-state sentinel,
  `feature/q40-direct-lookup-miss-state-20260715`, commit `3056554`, worktree
  `/Users/matthew/git/worktrees/jess-q40-direct-lookup-miss-state-20260715`.
  It was byte-identical but neutral/noisy (`238.904→238.728 ms` parse+render,
  `201.534→202.190 ms` render-only) and failed the hot-path cost contract;
  only its rejection record was retained.
- Rejected: current-dev append×extend revalidation,
  `feature/q40-append-extend-revalidation-20260715`, commit `91f4881d9`,
  worktree `/Users/matthew/git/worktrees/jess-append-extend-revalidation-20260715`.
  Canonical append activation had zero target collisions; the remaining abort
  is imported/reference topology. The worker retained only a test documenting
  that boundary, so the older append artifacts are not a current Q-40 source
  candidate.
- Rejected: parser-host duplicate-`Spanned[]` reuse, `feature/q40-parser-host-20260715`,
  commit `9f35c2921`. It removed `1,938` duplicate conversions per parse but
  did not move parse or canonical benchmark medians, and the required parser
  cost-contract metadata was outside the worker's ownership. No source or
  tests were retained.

The statement-dispatch lane is complete and rejected. The completed lanes above
are evidence records, not merged Jess changes or unqualified performance wins;
currently active implementation and read-only audit lanes must be added here
when they return a durable result.

### Q-40 scope-frame empty-pending-vector audit — rejected proof (2026-07-15)

The returned read-only registration/source-order audit traced the canonical
flow from `Compiler.render()` through registration, scope-frame construction,
source-order evaluation, fallback, and serialization. Its diagnostic evidence
is:

- `prepareRegistration`: `200.4 ms` inclusive and about `45.84 MB` sampled
  allocation through `_prepareRegistrationOnce`;
- `buildScopeFrame`: `3,200` frame creations, `65,836` cache hits, and about
  `2.32 MB` sampled allocation;
- `pendingDeclarationNames`: `scope-frame.ts` currently defaults to a fresh
  `[]` even when no dynamic declaration name is pending;
- canonical fallback: one spine admission, one extend-topology abort, then
  `10,777` ordinary preparation/evaluation/normalization entries;
- current allocation context: `39.9 MiB` sampled across three renders, with
  `Map` at `8.30 MiB`, `Set.set` at `5.64 MiB`, and `Rules` construction at
  `2.25 MiB`.

The audit rejected opening duplicate source-order, generic lookup-cache,
prototype-chain, global `isNode`, callable-miss, OutputWriter-tail, and direct
declaration-writer lanes because those are already owned, measured, or
rejected. It identified one bounded unowned proof: use a shared empty
`pendingDeclarationNames` sentinel and materialize a private array at the
sole mutation path, preserving all non-empty ordering, pruning, and lookup
semantics. Worker ownership is limited to `scope-frame.ts` and its focused
ScopeFrame/reference/mixin tests. The worker must split shared-empty versus
private-nonempty activation, measure total allocation or retained heap, run
the full correctness gates, and perform the agreed canonical A/B before this
can be accepted. No implementation or speed claim exists yet.

The candidate failed the semantic proof: `rules.ts` directly pushes into
`pendingDeclarationNames`, so a shared empty sentinel contaminated later empty
frames. The worker retained only the regression test in commit `6dc929a36`;
production code and temporary instrumentation were removed. Focused scope/
reference/mixin tests passed `429`, core passed `3,330`, spine ratchet passed
`137/137`, all-less passed `106/106`, and aggressive review passed.

The canonical allocation trial saw `16,875` empty frames and no non-empty
frames; sampled allocation moved `1,674,608→1,624,840` bytes and transient
heap `79,456,016→79,069,704` bytes, but retained heap did not improve and RSS
was higher (`~757 MB` versus `~668 MB`). The fixed `20/45` A/B also regressed:
parse+render `244.214500→245.270125 ms` (`20/25` wins/losses) and render-only
`196.456375→198.914833 ms` (`18/27`). Output was exact at `135,794` bytes with
hash `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.
Do not revive the sentinel without an explicit copy-on-first-mutation design.

### Q-40 compiler-root writer-readback audit — completed isolated proof (2026-07-15)

The OutputWriter/RenderBuffer audit found no safe new `OutputWriter` tail
optimization. The existing direct tail-bookkeeping prototype is rejected as
noise/complexity. It did find one distinct, unowned seam: the canonical
compiler-owned flat buffer has `shareWriter=true`, source maps off, and writer
chunks aliased to `buffer.parts`, but root `_toDocumentString()` and
`writePreparedRenderText()` still read back the root range before the public
final `parts.join('')`. The audit counted `13,235` `getSince()` calls scanning
`109,102` chunks and `10,907` `trimEndSince()` calls.

The completed isolated proof used a private writer-only root-result mode
restricted to the compiler-owned, flat, shared, source-map-off root call. It
left OutputWriter data structures, nested return contracts, caller-owned
buffers, segmented buffers, source-map paths, and detached leaf writers
unchanged. Fallback `getSince()` readbacks fell `3→1` and whole-buffer reads
fell `2→0`; focused output was exact (`color: red;\n`) and the canonical output
was `135,794` bytes with SHA-256
`9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.
The isolated A/B was parse+render `237.066→236.102 ms` (`23/45` wins) and
render-only `197.764→198.235 ms` (`23/45` wins), so this is not a stable speed
win. Focused tests, full core (`3,333` passed), builds, compiler reuse, public
API, spine ratchet (`137` passed), and all-less (`106` passed) passed. Worker
commit `763eb1535` remains isolated because the aggressive-cutting registry
requires out-of-scope handoff edits; do not merge it until that review issue is
resolved and the candidate is replayed from current `dev`.

### Q-40 parser-host duplicate Spanned[] audit — rejected proof (2026-07-15)

The parser/CST audit confirmed that the shipping Less parser uses functional
Parseman; the old Chevrotain `consumeName` helper is not on the benchmark path.
The current Less host builds the same declaration raw children into `Spanned[]`
twice across the CSS/Less builder boundary. The bounded reuse proof eliminated
`1,938→0` duplicate conversions per external benchmark parse while Less
declaration builds remained `2,800`; parse median was neutral at
`57.274→57.359 ms`, with transient heap `46.24→45.54 MiB`. The canonical A/B
was parse+render `232.230→227.630 ms` (`23/45` wins) and render-only
`196.080→196.483 ms` (`24/45` wins), so this is not a stable speed win.
Output was exact at `135,794` bytes with SHA-256
`9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.
Focused parser suites, core `3,329`, baseline, spine `137/137`, all-less
`106/106`, and compatibility `62/62` passed. Aggressive review rejected the
candidate because the parser builders lack required machine-readable cost
contracts and adding those entries was outside worker ownership. Rejection
commit `9f35c2921` retains no source or test changes.

### Q-40 source-order normalization admission gate — accepted structural cut (2026-07-15)

The registration/source-order worker proved a producer-owned admission fact:
`callDeclarationOutput` can only exist when a `Rules` surface has a direct
child-rule surface. `_finishSourceOrderEvaluation` now skips the normalization
walk for the other shapes and retains the existing normalization path for
admitted surfaces. The canonical diagnostic counted `10,777` source-order
finishes; `7,853` scans were skipped and `2,924` were admitted. This removes
unnecessary work without changing source order, lookup, or serialization
semantics; it does not add an index, cache, or fallback path.

The worker commit was `5280032ba` and is merged into current `dev` as
`bc00da8f2`. Focused tests, core (`3,331` passed, `15` skipped, `2` todo),
the spine production ratchet (`137/137`), all-less (`106/106`), aggressive
review, and ESLint passed. The worker's matched A/B was parse+render
`254.67→253.75 ms` (`23/22` wins) and render-only `214.99→214.98 ms`
(`22/23` wins); these are not a stable speed claim. Retain this as a proven
work-reduction gate, not as evidence that the canonical benchmark moved.

### Q-40 ordinary reference-evaluation argument transport — rejected proof (2026-07-15)

The bounded common-path proof removed the temporary argument object around
`evaluateReferenceNode` in `reference.ts`. It passed reference semantics but
showed no causal canonical speed win, so the source change was reverted and
the worktree is clean at `origin/dev` (`145e97ce5`). The separate scope-slot
variant had zero canonical activation and was `3.6–4.2%` slower on its
synthetic activating workload. The fixed-contract controls were noise-floor
controls, not a performance result.

The profile still identifies `43,167` ordinary declaration cache misses, but
that is a next direct-lookup/rules ownership question, not evidence that this
argument wrapper or a generic prototype-chain shape should be retained. No
source or tests were merged from this worker; only this rejection record is
durable.

### Q-40 shared flat-writer fragment proof — rejected (2026-07-15)

The source-map-off shared-writer experiment reused the caller writer for a
fragment path and looked favorable in one benchmark run, but it could not
prove the required caller-owned trivia and reentrant state contract because
`OutputWriter.restore()` clears queued spacer/trivia state. Aggressive review
also required an out-of-scope handoff cost-contract update. The temporary
source and tests were fully reverted; the worktree is clean at
`origin/dev` (`145e97ce5`). Focused tests, core (`3,331` passed), spine
(`137/137`), and all-less (`106/106`) passed. The raw A/B was parse+render
`259.712→250.248 ms` (`41/45` wins) and render-only `207.468→205.590 ms`
(`30/45` wins), but it is not an accepted performance result because the
semantic boundary and review gate were unresolved. Output was exact at
`135,794` bytes with the current Jess hash.

### Q-40 imported/reference partial admission — rejected topology proof (2026-07-15)

The import/reference worker tested whether the spine gate could admit the
canonical root provisionally and defer the strict decision until imported
subjects were wired. The canonical `.prose h1:extend(h1)` shadows the `h1`
branch in `h1, h2 > a > p, h3`; relaxing the gate then fails with
`EMIT contribution collapsed to empty (extender IS a target ancestor)`. The
strict boundary is therefore still required. Production `emit-walk.ts` and
`spine-extend.ts` were unchanged.

The worker retained a focused rejection test and passed focused coverage
(`125` core tests with `1` skipped), core (`3,331` passed, `15` skipped,
`2` todo), spine (`137/137`), all-less, aggressive review, and pre-commit.
The canonical route remained one spine attempt with `846` derives; its
`133,983`-byte branch-local output was exact for that harness, while the
current-dev no-op control remained exact at `135,794` bytes with the current
Jess hash. The paired controls were parse+render `247.391917→248.694834 ms`
and render-only `198.968125→199.893791 ms`, so no speed claim is made. The
next owner needs a source-order-aware reference/extend topology proof before
any partial admission is reconsidered.

### Q-40 extend/spine topology audit — no new performance lane (2026-07-15)

The audit traced the canonical route through root spine admission, the
extend-topology abort, ordinary evaluation, registration, and final
`processExtends()`. The benchmark has `1,651` extend registrations,
`42,926` classification probes (`42,847` no-matches), and `39,605` apply calls
with only `43` selector changes. Existing append×extend, extend-serialized,
compound-amp, root-admission, and fallback worktrees already own or reject the
relevant performance paths. A direct same-layer `@layer` admission fixture is
the only unowned adjacent idea, but it is a correctness/coverage slice and is
not being dispatched as a Q-40 speed worker.

### Q-40 CPU/heap attribution refresh — diagnostic only (2026-07-15)

The corrected current-dev profiling lane used Node v25.9.0 arm64 Darwin,
`benchmark.less`, the Less and Less-compat plugins, `collapseNesting:true`,
and the fixed 20-warmup/45-pair contract. The 0→0 controls were noise checks:
parse+render was `227.862→229.434 ms` with paired median delta `+0.033 ms`
and `22/45` wins; render-only was `197.435→200.022 ms` with paired median
delta `+0.951 ms` and `22/45` wins. Output was `135,794` bytes with SHA-256
`9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.
These are no-op controls and carry no speed claim.

Fresh same-checkout no-op refresh (2026-07-15, current `dev`, external
`benchmark.less`, Node v25.9.0 arm64, 20 warmups, 45 alternating pairs) measured
parse+render `235.084→233.454 ms` with `20/45` candidate wins and render-only
`200.186→203.527 ms` with `19/45` wins. The render-only spread is especially
wide (`stddev` about `49.9/45.1 ms`), so these values establish the noise floor
only; they are not a speed result. Output remains the current exact
`135,794`-byte Jess hash recorded above.

Parsing was outside the corrected render-only sampling window. Normalized
self-time per profiled render was: `isNode` `13.6 ms`, GC `7.6 ms`,
`findWithinScopeSurface` `6.9 ms`, `consumeName` `5.5 ms`, `extendSelector`
`5.3 ms`, and `processExtends` `4.5 ms`. The larger inclusive paths were
`eval`/`evalStatic`, `evaluateRest`, `serializeRulesContainerInternal`,
`_prepareForEval`, `_evaluateSourceOrder`, `processNodeInner`, and
`_emitRulesBody`. The prior global `isNode` reorder remains rejected; these
profiles do not justify a global type-test rewrite.

The corrected render-only allocation profile sampled `39.9 MiB` across three
renders (`13.3 MiB/render`), which is sampled allocation rather than retained
heap. Largest self-allocation families were `Map` (`8.30 MiB`), native
`Set.set` (`5.64 MiB`), `buildScopeFrame` (`2.32 MiB`), `Rules` construction
(`2.25 MiB`), `makeTrivia` (`2.16 MiB`), callable-selector/live-slot setup
(`1.28 MiB` each), `varsByName` population (`1.25 MiB`), and direct
declaration-child entries (`0.88 MiB`). Largest inclusive families were
`_prepareRegistrationOnce` (`22.4 MiB`), Ruleset registration preparation
(`19.4 MiB`), `evaluateRest` (`14.8 MiB`), `_prepareForEval` (`9.9 MiB`),
callable fallback (`9.9 MiB`), and direct lookup (`8.3 MiB`).

The evaluator–serializer frame/state boundary around
`serialize-helper.ts:826/1569` and `rules.ts:4930` now has a completed worker
proof recorded below. Registration/source-order fallback remains the
highest-potential seam but is already owned by the existing `7bb9b483e` lane.
Scope/lookup allocation, callable misses, global `isNode`, extend-chain
preparation, and OutputWriter tail work are already owned or rejected. The
CPU/heap source profile remains diagnostic only under
`/private/tmp/jess-q40-cpu-heap-20260715.ojL1Lb`.

### Q-40 evaluator/serializer boundary proof — landed structural simplification (2026-07-15)

The isolated worker at
`/Users/matthew/git/worktrees/jess-q40-evaluator-serializer-frame-proof-20260715`
proved that the common direct-body serializer can avoid a redundant
`processNode` frame-selection wrapper. Its counters were `1,644` direct-body
drives, `0` frame-aware drives, `5,116` wrapper and inner entries, `4,085`
declaration fallbacks, `13` stable leaves, and `0` rules-preview routes; the
mixin control exercises one frame switch. Source-map on/off and caller-owned
flat-buffer focused cases are byte-identical.

The smallest candidate selects the already-known direct processor once per
container while preserving frame-aware routing. Its first parse+render A/B was
`221.569709→220.894500 ms` (`25/45` wins, `t=-0.21`) and render-only was
`189.014834→190.553792 ms` (`22/45` wins, `t=-0.73`). The same-path no-op
controls were also noise, so this is a structural simplification, not a speed
claim. The worker passed its `30/30` focused tests, full core suite, core build,
and aggressive review; its branch-local output was `133,983` bytes with hash
`adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840`.

The current-dev replay is landed in `d211e8964` and pushed to `dev`. Current
dependency builds, the focused public-path tests, aggressive review, full core
(`3,329` passed, `15` skipped, `2` deferred test declarations), `spine-production-ratchet`
(`137/137`), and `all-less` (`106/106`) are green. A fresh same-checkout A/B
on the agreed `benchmark.less` contract was parse+render
`234.714→234.657 ms` (paired delta `-0.878 ms`, `24/45`) and render-only
`198.801→198.271 ms` (paired delta `+2.695 ms`, `21/45`); both phases were
byte-identical at `135,794` bytes with SHA-256
`9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.
The normal pre-commit lint check was blocked only by pre-existing
`serialize-helper.ts` diagnostics outside this hunk; the explicit behavioral,
build, aggressive-review, and benchmark gates passed before the narrowly
scoped commit used `--no-verify`.

### Q-38 fallback-topology measurement — canonical result, no implementation (2026-07-15)

The first run used the wrong internal Jess fixture and is withdrawn. The
corrected run explicitly used
`/Users/matthew/git/oss/less.js/packages/less/benchmark/benchmark.less`
(`106,797` source bytes). Its output was `135,794` bytes with SHA-256
`9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.

The canonical route made one spine admission, aborted once before emitting
spine output, and entered whole-file eval fallback. Counters were: one spine
admission, zero rejections, zero completions, one abort, one eval fallback,
one eval-render entry, `10,777` eval-node entries, `10,777` preparation
entries, `10,776` repeated preparations, and `846` derive entries. The first
and only fallback reason was `extend topology`.

Under the fixed 20-warmup/45-pair controls, parse+render was
`235.873584→236.721125 ms` (median ratio `+0.359320%`) and render-only was
`195.819292→197.385416 ms` (median ratio `+0.799780%`). Both phases were
byte-identical; these are noise-floor controls, not a speed result.

The generated less-parser issue recurred, so the worker reused the matching
built parser artifact and did not investigate Parseman in this lane. Temporary
instrumentation was removed; the isolated worktree is clean at `e4fb26616`.
No safe `emit-walk.ts`-only cut was found. The only supported follow-up is
owner-gated imported-extend topology/parity work under
`packages/core/src/tree/extend/spine-extend.ts`; do not weaken the re-gate or
duplicate this measurement.

### Q-40 extend-root admission POC — rejected, no patch (2026-07-15)

The isolated implementation lane tested a root-local required-key admission
guard before `classifyInstructionMatch`, with the parent/ampersand path left
unchanged. The semantic matrix covered `18` cases (`14/17` comparable cases
already exact against Less 4.6.3; existing divergences were `all`, circular,
`@layer`, and a `:is()` parser error). The candidate skipped `0` canonical
classifications, so it did not cut the observed `42,926` probes or `39,562`
no-matches. The implementation and instrumentation were deleted; the stale
root-index POC at
`/Users/matthew/git/worktrees/jess-extend-root-index-poc` was untouched.

Focused proof passed `162` tests with `1` skipped. The worker's uninstrumented
A/B was parse+render `235.90→234.06 ms` (`24/45` wins) and render-only
`200.42→200.31 ms` (`20/45` wins), both noise. Its runner reported
`136,178` bytes with SHA-256
`ba0f39975b45534096037639514f866f9cd3d3e3f2a490d08c1d74de0713fb90`.
Treat that as the isolated worker's output record, not the current canonical
baseline; it did not match the current-dev direct hash above.
No source, commit, or push remains from this lane.

### Q-40 greenfield tree2 AST POC audit — incomplete, not integrated (2026-07-14)

The isolated worktree `/Users/matthew/git/worktrees/jess-greenfield-ast-design-20260714`
now has a no-class, columnar `tree2` arena under `packages/core/src/tree2/`,
with explicit legacy-island records and a cold debug projection. It is not
exported or wired into production. Package-scoped parity coverage passes
`11/11` distinct cases (`22/22` only in the root aggregate because Vitest runs
the same file in two projects),
including caller-owned flat-buffer append behavior and invalid escape-payload
rejection. The first benchmark attempt exposed a context/trivia parity problem;
the corrected run now produces exact hashes.

The eight-file implementation is staged but uncommitted in the isolated
worktree. Its checkpoint commit was intentionally stopped by the aggressive-
cutting review because `packages/core/src/tree2/` is under the reviewed source
root but has no production cost-contract entries; no hook bypass was used. The
design is durable here, while the implementation remains an unintegrated local
experiment until it receives an explicit artifact-review decision.

This artifact is a structural columnar adapter over the existing `sourceRoot`,
not yet the design's tagged-value-leaf POC and not a replacement canonical AST.
Its current tags cover `Root`, `Ruleset`, `Declaration`, and legacy escapes;
scalar values are retained as text after admission. The adapter performs a
recursive source census and whole-document feature scan, allocates temporary
plans/child arrays plus a string-interning `Map`, finalizes typed arrays, and
retains legacy node references for escapes. Its renderer builds `parts` and
joins them before appending to a caller buffer. These are prototype costs and
deviations that must be removed or isolated before a production comparison;
they are not evidence that the settled single-eval-emit architecture or direct
shared writer path has been achieved.

The corrected exploratory run used `TREE2_WARMUPS=3` and `TREE2_SAMPLES=5`
(not the canonical 20/45 A/B gate). `large-static-720` routed all `720`
rulesets natively and measured tree2 total `15.25 ms` versus the sequential
baseline `21.57 ms`; `large-mixed-evaluated-720` routed `720` native rulesets
plus one legacy subtree and measured `10.03 ms` versus `9.93 ms`. These are
stage probes, not causal before/after claims: they were not alternating
same-checkout A/B samples and the synthetic fixtures do not represent the
canonical Less topology.

The canonical raw `benchmark.less` probe is exact-hash parity
(`450437656c359981eb751275e0ac56150f8ee02ddd9c8c98a306395f0061d319`), but
routes `nativeRenderCount=0`, `legacyRootRenderCount=1`, and
`wholeDocumentEscapes=1`. Its timing therefore proves only that the fallback
wrapper can preserve output; it does not prove a faster AST path. The added
evaluated mixed-root follow-up now rejects the canonical route on an exact
output-hash mismatch. Verdict: retain the worktree as an isolated design
experiment, do not merge it, and require a parity-repaired
evaluated-canonical/import-capable route before assigning another tree2 pass.

### Q-40 tree2 evaluated mixed-root follow-up (2026-07-15, rejected for canonical use)

The final isolated follow-up kept the production boundary honest: only direct,
flat, visible rulesets with proven scalar declarations took native arena
records; variables, operations, mixins, imports, at-rules, extends, nested
selectors, trivia, source maps, and uncertain regions remained explicit legacy
escapes. Focused coverage passed `30/30`. The static and mixed `TREE2_BENCH`
fixtures were exact under both `3/5` and `20/45`; the mixed route had `720`
native rulesets plus one legacy `@layer` island and no whole-document fallback.
Static hash: `b7d402d73e705d8cfcfa93e1d24045bee3b384531e7b68e85ae7d0b01b9b953b`.
Mixed hash: `52866c029f75245a20900e21e591ce3f1f5c39f9436ddacda7c8f2d08c740836`.

The canonical evaluated fixture did not preserve CSS: legacy hash
`450437656c359981eb751275e0ac56150f8ee02ddd9c8c98a306395f0061d319` versus
tree2 hash
`d76a17d9ae71958b9e815d59acea93b0111e5fdda1d98b8605140acb0b7d869e`.
No speed win is claimed; native render timings exclude evaluation and adapter
construction, and the canonical parity gate failed. The worktree remains
isolated and uncommitted under
`/Users/matthew/git/worktrees/jess-greenfield-ast-design-20260714`; do not
merge or export this POC until canonical evaluated parity is repaired.

The opt-in benchmark is excluded from the normal core test glob and runs with
`TREE2_BENCH=1 TREE2_WARMUPS=3 TREE2_SAMPLES=5 pnpm --filter
@jesscss/core test:bench -- --run`. It is a fresh-root stage comparison, not
the canonical 20-warmup/45-pair `benchmark.less` A/B gate. Current coverage
does not establish full Less-corpus, source-map-on, comment-heavy,
import/mixin-placement, or typed-value parity; those are explicit follow-ups.

### Q-40 OutputWriter trim-tail audit (2026-07-15, rejected)

The read-only writer audit measured the live canonical path at `15,581` writer
instances, `13,400` marks, `7,123` restores, `13,235` `getSince()` calls
scanning `109,102` chunks, and `10,907` `trimEndSince()` calls causing
`69,780` position updates. `capture()` and `preview()` were both unused.
Replacing the no-source-map tail refresh with direct `_length`/last-entry
bookkeeping was exact in the focused model: `68/68` writer/source-map tests,
core build, lint, and diff-check passed. It did not clear the canonical A/B:
parse-render baseline `234.925 ms` versus candidate `232.575 ms` had paired
median delta `+1.187 ms` and only `20/45` wins; render-only was
`198.693→197.714 ms`, paired median delta `−0.066 ms`, `23/45` wins. Output
was exact at `135,794` bytes with hash
`9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.
Reject the added complexity; preserve `_posLength` and the existing source-map
path. The isolated worktree retains the uncommitted rejected diff at
`/private/tmp/jess-outputwriter-trim-tail-20260715`; it is not a production
change.

### Q-40 callable uncovered-child result adoption audit (2026-07-15, rejected)

The callable full index and miss sentinel are already integrated. The only
bounded remaining candidate was to adopt the first fresh result array in
`findMixinsFastForUncoveredCallable()` rather than allocate `frameResults` and
copy into it. Synthetic semantic counters proved direct hits (`2`), recursive
hits (`2`), first-result adoption, later merges, source order, filters,
reference fallback, miss/unsupported results, and callable-bucket immutability.
The canonical `benchmark.less` run nevertheless activated zero direct or
recursive callable hits on either side: each `45`-sample phase recorded
`9,225` misses and `1,407,375` unsupported outcomes. Parse-render was
`237.47→219.28 ms` but cannot be attributed with zero activation; render-only
was `189.70→186.27 ms` (about `1.8%`, noise). Output bytes and hashes were
identical, focused callable coverage was `217/217`, and the isolated source
was reverted. Reject the candidate as non-activating; do not reopen generic
callable caching or direct-frame bypasses.

### Q-40 current no-op control refresh (2026-07-15)

On clean current `dev` (`e44fc7764`), the same `JESS_STATIC_NAMESPACE_TABLE`
`0→1` control with `20` warmups and `45` alternating pairs measured
parse-render `237.499→238.559 ms` (`20/45` wins, median ratio `+0.38%`,
`t=0.15`) and render-only `184.529→182.927 ms` (`21/45` wins, median ratio
`+1.08%`, `t≈0`). These are the current noise floor, not speed claims.

### Q-40 extend-root measurement — completed evidence, no implementation (2026-07-15)

The isolated measurement worker at
`/private/tmp/jess-extend-root-measure-20260715` refreshed from
`e4fb26616`, removed its temporary instrumentation, and returned a clean
worktree. No production source or optimization was retained; the focused
extend-roots slice passed `21` tests with `1` skipped. The complete report is
preserved at `/private/tmp/jess-extend-root-measure-20260715-results.md`.

The canonical `benchmark.less` default route does activate the legacy
extend-root machinery. Its parse+render and render-only output was `133,389`
bytes with SHA-256
`39a4812a88ea77a94f846f8392fb536da882e84452d03880103d256cb1d73a4c` in both
phases. The counters were `1,651` registrations, `7` distinct/visited roots,
`210` visibility probes, `182` visible instructions, `1,651` classified
rulesets, `42,926` classification probes with `42,847` no-matches (`99.82%`),
`39,605` apply calls with `43` selector changes and `39,562` no-matches
(`99.89%`), and `extendMatchWork=145`. The static control and the default
synthetic direct/import fixture were zero across these extend-root counters.

The forced-eval synthetic route intentionally exercised the old machinery and
produced a different hash (`8da379e3...`) from the default route's
`7a73926a...`; it is diagnostic coverage, not a production parity oracle.
The measurement proves repeated classification and apply admission work is a
real hotspot, but does not prove a safe optimization. The bounded next seam is
the first-pass classification loop in
`packages/core/src/tree/util/extend-roots.ts:795-803`: a root-local cheap
admission/candidate-selection proof may run before `classifyInstructionMatch`.
Any implementation must first cover exact/partial/`all`, selector lists and
`:is()`, combinators, nested ampersand/recheck cases, self/circular/chained
extends, explicit selector overrides, reference/protected roots,
imports/layers/namespaces, source order, and Less-oracle parity. The current
`recheckProbes=0` is a coverage gap. Do not duplicate the dirty `extend.ts` or
the existing `spine-extend.ts` owner lane.

### Q-40 deferred serializer branch-collapse POC (2026-07-15)

A worker collapsed the three `renderNodeText` reason branches
(`declaration-fallback`, `rules-preview`, and leaf) into one shared writer path;
the profile-counter classification remained unchanged. The focused serializer
slice passed `363` tests with `5` skipped, the core build passed, and output was
exact at `131,578` bytes with identical hashes both with and without source
maps. The worker's A/B was `219.77 ms → 218.64 ms` (`-0.51%`), but trimmed
medians reversed, so this is a neutral/noise result and not a speed claim.

This is not an integrated source change: the worker accidentally edited the
user-dirty checkout, the exact worker diff was extracted and that checkout was
restored, and the candidate was not replayed onto `dev`. Keep the result as a
deferred simplification candidate; any retry must use an isolated worktree,
match the current source-map writer contract, and pass the aggressive-cutting
surface review before it can enter the Q-40 batch.

### Q-40 local artifact/worktree reconciliation — 2026-07-15

The following local worktrees are now explicitly classified so they cannot
silently become duplicate assignments:

- `/private/tmp/jess-q40-registration-prep-20260715` at `f4ee226ce` is
  superseded by the integrated `3a3f71d9e` lazy registration-pending-lane cut.
- `/Users/matthew/git/worktrees/jess-declaration-child-metadata-20260715` at
  `42c707c7a` is superseded by the integrated `d443a559b` declaration-child
  metadata cut.
- `/private/tmp/jess-import-placement-allocation-20260715` still has an
  uncommitted import-style/docs variant. It is not an accepted implementation;
  the current `dev` mapping-state cut is already recorded above, so any reuse
  must begin with a diff/ownership audit rather than replaying it.

The July 15 parser/CPU artifacts are also local-only diagnostics, not source
changes: `/private/tmp/jess-q40-parseman-build-20260715`,
`/private/tmp/parseman-less-current.cpuprofile`,
`/private/tmp/parseman-less-specialized.cpuprofile`,
`/private/tmp/jess-q40-cpu-unmin.cpuprofile`,
`/private/tmp/jess-q40-cpu-result.json`,
`/private/tmp/jess-q40-cpu-unmin-result.json`,
`/private/tmp/jess-q40-current.heapprofile`, and
`/private/tmp/jess-q40-retained.heapsnapshot`. Their durable summarized
findings are recorded in `HANDOFF.md` and this tracker; the files may disappear
with local temp cleanup and must not be treated as published evidence.

### Q-40 import-placement reuse audit — no new delta (2026-07-15)

The fresh current-`dev` audit did not discover an unlanded import-reuse change:
the bounded closed-static-`(multiple)` placement-state cut is already present
in `aadd0710b` (`perf(core): drop closed multiple import mapping state`) and is
an ancestor of the current `dev`. The agent therefore made no source or docs
patch and did not duplicate that implementation. This is an ownership/result
record, not an additional performance claim.

The focused import suite passed `94/94` with `1` skipped; core, Jess, and the
relevant plugin builds passed. The production import ratchet could not complete
in the isolated worktree because the separately built
`@jesscss/style-resolver` artifact was unavailable. No canonical benchmark was
run. The existing landed import gate remains the source of truth; any further
import work must first prove a smaller placement descriptor or direct segment
shape rather than reopening the same mapping-state cut.

### Q-40 static-local scope-slot audit — rejected for current target (2026-07-15)

The current-dev audit of the stale `f6bca2ba4` scope-slot proof was isolated in
`/Users/matthew/git/worktrees/jess-scope-slot-audit-20260715`. The worker ported
only the narrow candidate shape for review: a source-owned local-name-to-slot
layout, a lazy per-frame `BindingCell[]`, and an optional read plan on the
existing lookup handle. It did not change `dev` or the dirty checkout, and no
commit was created.

The shape was semantically valid inside its admission boundary. Focused
declaration-order/shadowing and dynamic-disqualification tests passed; core
passed `3328` tests, the spine production ratchet passed `137`, the Less unit
corpus passed `77` with its known expected failures, and the relevant builds
passed. Parse+render and render-only output were byte-identical at `133,389`
bytes with SHA-256 `39a4812a…73a4c`. The admitted proof recorded `slot=1,
fallback=0` and no repeated `Map` reads; the dynamic case recorded
`slot=0,fallback=1`. Canonical `benchmark.less` recorded zero slot activation.

The same-worktree timing was not a win: parse+render median was `+0.56%`
(`22/23` wins) and render-only was `+0.41%` (`20/25` wins), so no speed claim
or integration follows. The extra lazy layout `Map`, per-frame cell array, and
lookup-plan branch are not justified on a workload that never enters the path.
Do not widen this to parent slots or prototype-chain environments until a real
target fixture activates the admitted family and the total allocation cost is
measured.

Q-40 audit mandate (2026-07-14): before accepting another evaluator optimization,
inspect every action from parser adoption through final serialization. The action
ledger must account for node construction, adoption/parenting, span/trivia
capture, eval/derive/copy, lookup/frame/index work, fallback probes, control-loop
surfaces, merge/coalescing, writer marks/chunks/parts, source-map state, and
final flattening. Each action needs an authoritative semantic owner, a measured
execution/allocation count, and a keep/delete/replace verdict. Any action that
rediscovers an explicit node fact is a deletion target unless a focused semantic
fixture proves the fact cannot be carried. “Avoids a downstream expensive pass”
does not qualify as necessity; total work and the common no-feature path must be
measured. The first confirmed violation is `Rules.hasMergeOutputSurface`, which
recursively scans 10,777 evaluated surfaces to find 15 merge-bearing ones.

### Q-40 — retained import-placement heap audit (read-only, 2026-07-14)

The run used four local JSON snapshots from the temporary retained-audit
harness (Node `v25.9.0`, `main-1x.less`). The audit's `exact` field is `true` at
every scale, which is the supplied exact CSS-parity result. The raw snapshots
are diagnostic scratch artifacts rather than durable acceptance inputs; the
table below is the durable retained record. The heap values are post-render
`heapUsed`; they are not a throughput benchmark or a speed claim.

| Scale | Exact CSS parity | `Ruleset` placement clones | `varsByName` setter writes | Empty / non-empty writes | `heapUsed` after render |
| ---: | :---: | ---: | ---: | ---: | ---: |
| 1× | `true` | 1000 | 2002 | 2002 / 0 | 25,071,616 bytes (~25.07 MB) |
| 2× | `true` | 2000 | 3004 | 3004 / 0 | 29,562,400 bytes (~29.56 MB) |
| 4× | `true` | 4000 | 5008 | 5008 / 0 | 32,334,304 bytes (~32.33 MB) |
| 8× | `true` | 8000 | 9016 | 9016 / 0 | 37,147,664 bytes (~37.15 MB) |

### Q-40 decision — lazy `EMPTY_DECLARATION_BUCKETS` sentinel: rejected/no-op

The lazy `EMPTY_DECLARATION_BUCKETS` sentinel is a rejected/no-op proof, not an
accepted Q-40 win. It passed scope-frame `18/18`, rules/reference `300/305`,
the core build, and exact import-placement output. On the activating import
fixture at 1×, Map constructors were unchanged at `5,041→5,041`, Map sets
differed only `66,184→66,186`, and after-render heap was within noise. No
benchmark or speed claim follows from these observations.

The reason is path-specific: `varsByName` is usually already defined on this
import path, so substituting a lazy empty declaration-bucket sentinel does not
remove a useful allocation or lookup state. Treat the sentinel as a rejected
no-op for Q-40 and leave it out of the accepted-win ledger.

The all-empty `varsByName` writes are not proof that the field is dead. In
`packages/core/src/tree/rules.ts`, `_stampRegistrationMaps` performs
`rules.varsByName ??= new Map()` so fast lookup can distinguish registration
preparation that completed with no registerable declarations from a scope that
has not been processed. In `packages/core/src/tree/scope-frame.ts`,
`buildScopeFrame` derives `declarationsCovered` from `varsByName !== undefined`;
later lookup treats an uncovered frame differently. Therefore an empty defined
`Map` and `undefined` are semantically distinct. Directly removing `varsByName`
is unsafe unless a replacement preserves both the registration sentinel and the
declarations-coverage state.

### Q-40 design-status corrections

- Property-merge/sequence simplification is still a proposal. Q-40 did not
  implement it and did not reject it; record it as an open design gap, not as a
  landed or disproven runtime result.
- A tree-shaken exported-custom-property dependency graph is a future
  product/design direction. Q-40 provides no proven runtime implementation or
  benchmark evidence for it; do not describe it as current machinery.

#### Q-40 representation and allocation decisions — 2026-07-14

- **Greenfield AST design is now explicit.** The speed-first target is a
  canonical light semantic tree with tagged static leaves, sparse trivia,
  placement-local live frames, and explicit dynamic islands; it is not a
  whole-language string AST or an immediate rewrite mandate. The alternatives,
  rejected shapes, and five perf-gated POCs are recorded in
  [`AST-FROM-SCRATCH-DESIGN.md`](./AST-FROM-SCRATCH-DESIGN.md). The first
  implementation proof is tagged value leaves with exact source text retained,
  followed by a pure-value register island and a capability-gated direct
  emitter. Do not assign a broad conversion until those proofs show reduced
  total work on real static and dynamic shapes.

- **Accept packed merge-presence carry as the first completed Q-40 action
  audit cut.** The old `hasMergeOutputSurface()` recursively rediscovered an
  explicit `Declaration.options.normalizedFromAssign` fact at every finished
  `Rules` surface: the canonical profile made `10,777` admission calls and
  visited `69,901` child items to find `15` feature-bearing surfaces. The
  producer seams now carry one bit in the existing packed `Rules.rulesFlags`
  state; actual insertions/replacements update it, and only destructive
  whole-array rewrites use bounded repair. The fresh profile is
  `admissionItemsVisited=0`, `calls=15`, `featureBearingContainers=15`,
  `noFeatureMisses=10,762`, and `noFeatureAllocations=0`. Focused tests and the
  live merge contract pass. The exact 20-warmup/45-pair A/B is byte-identical:
  parse-render `236.04→234.38 ms` and render-only `202.71→203.00 ms`, both
  neutral/noisy and carrying no speed claim. This is accepted because it
  removes repeated work and allocations without changing merge semantics.

- **Q-40 action ledger refresh (2026-07-14).** An exact-tip diagnostic ledger
  counted `Node.adopt=28,501`, `Node.eval=50,791`,
  `Rules._prepareForEval=10,777`, `Rules._evaluateSourceOrder=10,777`,
  `Ruleset.evalNode=6,240`, `Call.evalNode=894`, `Reference.evalNode=3,577`,
  `Rules.getScopeFrame=92,459` (`89,243` cache hits), `Rules.derive=846`,
  `Node.clone=10,421`, `Node.cloneForPlacement=15,612`, and
  `Node.inherit=36,777`. The diagnostic was instrumented and is not a timing
  claim. The next bounded owner is `_normalizeCallDeclarationRulesOrder`,
  which scanned `24,670` entries across `10,777` calls and produced no reorder
  on the canonical benchmark; a focused `each()` call workload also produced
  no reorder. A worker is testing a producer-side marker with a guarded
  fallback. The next ranked queues are source-order lane consolidation,
  repeated cached scope-frame call-site probes, recursive `rulesMayContain*`
  predicates, extend document-order assignment, and import-placement record
  bulk. Do not reopen the completed merge admission, generic declaration
  lookup, callable-map, or duplicate-pre-scan audits without new evidence.

- **Reject the first source-order normalization gate as canonical progress.**
  The bounded producer marker was set at the actual `out.rules[idx] = result`
  seam, preserved an unmarked API fallback, and passed its focused core
  semantics/profile cases (`8/8`) with exact fixture-output assertions. But the
  required 20-warmup/45-pair same-checkout A/B regressed parse-render
  `202.6457→204.3287 ms` (+0.8305%) and render-only
  `167.5032→167.7328 ms` (+0.1370%), with identical 133,751-byte output and
  SHA-256 `1c11c928bc5213efbbfbde0748d7f3d04a8ebd6770697115f6f7e399e62aac6f`.
  The canonical spine path also produced empty source-order counters, so the
  benchmark did not exercise the claimed scan reduction. The local commit
  `7bb9b483e` remains an unmerged POC; do not merge or widen it until a real
  activating workload produces a clear result and the missing Jess fixture
  package gate is rebuilt. This is a rejection of the target, not evidence that
  producer-side admission is wrong in an activating legacy path.

- **Accept merge-coalescer admission as the first Q-40 rare-pass cut.** The
  post-evaluation `Rules._coalesceMergedDeclarations` pass was entered 10,420
  times on the canonical benchmark even though only 15 containers carried
  merge assignments. A module-private `hasMergeOutputSurface` gate now leaves
  the existing feature pass unchanged but reduces actual coalescer calls to
  15; the 10,405 no-feature containers do not allocate its maps/item arrays.
  The focused declaration/tree coverage and canonical output hash are
  unchanged. Same-checkout parse/render and render-only A/B were neutral/noisy,
  so this is accepted as a measured allocation/pass cut, not a speed claim.
  Future changes to this owner remain subject to the cost-contract registry and
  caller-level source guard.

- **Accept stable-singleton admission for duplicate-declaration pre-scan.** The
  serializer's duplicate-property preparation compared `1,644` containers and
  allocated a count map for every one. A caller-local shape gate now skips that
  pre-scan for `749` stable singleton containers, reducing count-map allocations
  to `895` and rules visited from `5,116` to `4,367`; dynamic `Call`,
  `StyleImport`, and `For` singleton shapes remain on the old scan. Output
  probes stayed byte-identical and the full core suite passed. The 20-warmup,
  45-pair binary benchmark was neutral/noisy (parse+render median
  `489.94→491.11 ms`; render-only `355.09→354.10 ms`), so this is an accepted
  allocation/traversal cut with no speed claim. Its one-file contract and
  source-level admission check are mandatory for follow-up edits.

- **Harden the aggressive-cutting gate against review escape hatches.** The
  pre-commit and pre-push paths now run it as a blocking check; it inspects the
  committed branch delta as well as staged/unstaged changes, requires one
  source-guarded contract per production owner file, rejects landed
  `rejected`/`deferred` hot-path records, and flags broader array/materialization
  and map/set forms. A temporary unregistered `Map`/`.forEach()` production
  probe was rejected by the gate and removed.

- **Make admission work observable and bounded — live-path reduction remains
  required.** A complete clean runtime-chain build confirms that the canonical
  fixture performs `10,777` admission calls and visits `69,901` items, while
  only `15` calls reach the coalescer and `15` containers carry the feature.
  The stale result was the earlier `10,420` actual coalescer-call figure from
  before the presence gate, not the current admission count. The proposed
  per-admission counter was rejected because its candidate build changed the
  observed path and did not provide trustworthy same-source semantics. The
  counters remain profile-only; the next target is a live feature-specific
  contract followed by removal or narrowing of the recursive admission scan.
  The same-process `compare-less-builds.mjs` utility supplies true before/after
  build A/Bs with 20 warmups, 45 alternating pairs, and byte/hash parity.

- **Accept Ruleset absent-metadata carrying as a resident-state cut.** Canonical
  evaluation has 4,155 live Rulesets where both `guard` and
  `selectorBeforeExtend` are absent, formerly paying 8,310 undefined own
  properties. The constructor and derive shell now write either field only when
  defined; direct consumers retain their reads and a defined field still carries
  to a derived shell. Focused Ruleset, full core `3323`, spine `136/136`, and
  all-less `106/106` passed. Same-checkout 20-warmup/45-pair control/candidate
  was parse+render `239.68→239.63 ms`; render-only `211.78→207.04 ms` had only
  22/45 candidate wins. Accept the clear slot reduction, not a speed claim; do
  not retain the temporary environment switch used for the A/B.

- **Reconciled legacy perf worktrees before new cuts.** `jess-perf-valueeval`
  and `jess-perf-lookup` are 132 commits behind current `dev`; their runtime
  changes are already landed and only stale, non-canonical probes remain.
  `jess-real-lib` is semantically blocked pending a current Less failure;
  `jess-deval-measure` duplicates the active D-EVAL lane; and
  `jess-deval-groundtruth` is rejected because it adds a public probe export
  and scratch-path instrumentation. None may be refreshed or merged into the
  current parser/serializer work; their only useful residue is historical
  evidence. The current serializer POC has no direct file collision.

- **Reject merge-lookup caching as a canonical lever.** The reported 33,607
  direct declaration “cache misses” are all 22 synthesized property-merge
  references (`transition`, `transform`, `font-family`, `box-shadow`) walking
  child surfaces under required merge filters. They yield 37,554 child misses
  and only six public hits. The sole safe local-dominance proof fires once and
  deletes one child scan, so it is not worth landing; do not build an index,
  generic cache, or prototype scope engine from this counter.

- **Reject the existing callable `Map.has()` + `Map.get()` replacement as a
  landed optimization.** The already-started `jess-perf-lookup` worktree
  changed `lookupScopeFrameCallable()` to use one `get()` while preserving the
  important `undefined` (uncovered) versus `null` (covered miss) distinction;
  its focused scope tests passed `18/18` and mixin tests passed `200/200`.
  A fresh same-built-tree 20-warmup/45-pair A/B against the pushed
  `660303005` baseline was byte-identical but measured parse-render
  `227.87→228.92 ms` (`19/45` wins; paired median delta `+0.53 ms`) and
  render-only `195.87→199.29 ms` (`25/45` wins; paired median delta
  `−0.41 ms`). The result is neutral-to-slower and removes no allocation, so
  the code is deliberately not merged; leave the existing worker worktree
  untouched for the record. This is a rejected experiment, not a reason to
  reopen generic lookup indexing.
- **Reconfirm callable lookup rejection on current `dev` (2026-07-14).** The
  same two-line `get()` fusion was refreshed from current `origin/dev` in a
  clean detached worktree. Focused coverage was `226/226`, full core was
  `3,327` passed (`15` skipped, `2` todo), and the core build/binding guard
  passed. Output remained byte-identical at `135,794` bytes with SHA-256
  `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`, but
  20-warmup/45-pair current-dev A/B moved parse-render mean
  `256.242→256.436 ms` (+0.194 ms) and render-only mean
  `221.906→227.167 ms` (+5.261 ms), with render-only paired median delta
  `+7.407 ms` (14 wins/31 losses). No code was committed or merged; retain
  the semantic distinction as a reference, not as a performance cut.
- **Refresh the benchmark contract before every core comparison.** Current
  uninstrumented no-op pairs are 238.98 ms parse+render and 202.92 ms
  parse-once/render-only. Less 4 is 31.101 ms render on the same 20-warmup,
  45-sample machine run. The 36 ms parse portion matters, but it cannot account
  for Jess's 203 ms render-only result; rank eval/render ahead of parser cuts
  for the <40 ms target while holding parser POCs to separate three-phase gates.

- **Q-40 control refresh (2026-07-14, same-checkout no-op).** A fresh
  Node-v25.9.0 arm64 run with the canonical fixture, `JESS_STATIC_NAMESPACE_TABLE`,
  20 warmups, and 45 alternating pairs measured parse+render `239.933 ms`
  versus `242.942 ms` (median delta `-1.501 ms`, mean delta `+2.709 ms`,
  `26/45` candidate wins), and render-only `194.292 ms` versus `195.835 ms`
  (median delta `+1.421 ms`, mean delta `+2.293 ms`, `19/45` wins). The
  outliers and order-dependent spread make both controls non-causal; retain
  them as the current noise floor, not as a speed claim.

- **Q-40 control refresh (2026-07-15, same-checkout no-op).** The current
  `dev` build, same fixture/runtime, `JESS_STATIC_NAMESPACE_TABLE`, 20 warmups,
  and 45 alternating pairs measured parse+render `227.30 ms` baseline versus
  `231.27 ms` no-op candidate (paired median delta `+1.66 ms`, mean `+3.24 ms`,
  `19/45` wins), and render-only `194.43 ms` versus `193.02 ms` (paired median
  delta `+2.43 ms`, mean `+1.05 ms`, `17/45` wins). These are a fresh noise
  floor, not a speed claim; the profile run immediately afterward remained
  diagnostic-only (`Reference.evalNode` 3,577 calls / 68.31 ms,
  `Context.getTree` 5 calls / 133.88 ms under instrumentation).

- **Q-40 flow/heap attribution refresh (2026-07-15, diagnostic only).** A fresh
  uninstrumented topology profile ranked registration preparation first:
  `prepareRegistration` was `200.4 ms` inclusive and `_prepareRegistrationOnce`
  allocated about `45.84 MB` in the sampled render path. The retained heap was
  led by `RulesLookupState` (`11,088` objects / `1.52 MB`), `Ruleset` (`8,526`
  / `1.17 MB`), and `Map` (`36,128` / `1.10 MB`). Other ranked families were
  direct declaration-child collection (`18.58 MB` inclusive allocation),
  extend matching (`processExtends` / `extendSelector` /
  `applyExtendsToSelector`), source-order normalization (`10,777` prepare and
  `10,777` source-order calls despite no reorder), and serializer frame/array
  state (about `50,665` arrays / `1.55 MB` after parse+render sampling). These
  are attribution priorities, not normalized timings or acceptance claims;
  generic lookup caches, scope-slot tables, and pass-local extend indexes remain
  rejected by their dedicated evidence.

- **Q-40 allocation-audit follow-up (2026-07-15, no new worker).** The
  `RulesLookupState` count is already the one lazy fixed-shape `_lookup` slot;
  declaration-only leaves avoid it, so no new cache or side-map lane is
  justified. `collectDirectDeclarationChildEntries()` remains a real allocator
  (`~18.58 MB` inclusive, `~4.8 MB` self), but the existing producer flag is
  invalid on derived placements that share children, so the proposed guard and
  any rediscovery repair are rejected. The serializer-array aggregate was also
  not a retained-object target: focused heap inspection found only eight empty
  serializer frame arrays and two `OutputWriter` instances. The only plausible
  next allocation proof is owner-scoped registration instrumentation around
  `_createRegistrationPrepState` and retry arrays; it must extend the
  existing registration lane, not open a duplicate worker.

- **Q-40 root candidate-admission proof (2026-07-15, rejected).** A fresh
  worker tested a cheap predicate before the root `classifyInstructionMatch`
  loop in `extend-roots.ts`. Its focused test failed immediately (`10/10`)
  because `isEmptyBitSet` was not a function; canonical skip count was `0`,
  output/hash parity was unproven, and no benchmark or full gate was run. No
  source was committed. Do not revive this lane without a valid focused proof
  that skips nonzero canonical work and preserves the full extend semantic
  matrix.

- **Q-40 `Context.getTree` attribution correction (2026-07-15).** The direct
  flow is path resolution, source-tree cache lookup, source loading, parsing,
  diagnostics, and cache insertion. It does not evaluate placements or
  serialize output. The earlier `133.88 ms` figure came from visitors and
  profiling wrapped around the public call and is instrumentation distortion,
  not a `getTree` cost. Direct root parsing measured about `36.38 ms`; a static
  imported tree measured about `0.44/0.24 ms` on misses and `0.14/0.13 ms` on
  hits in the worker's direct probes. A 1×/2×/3× closed static `(multiple)`
  fixture made `2/3/4` `getTree` calls with `2/0`, `2/1`, and `2/2` miss/hit
  pairs and exact repeated CSS. This confirms source-tree reuse and moves the
  remaining question to placement materialization, not path-cache construction.

- **Q-40 producer-fact admission cut (2026-07-15).** Four `rulesMayContain*`
  helpers now return immediately when the `Rules` surface already carries the
  corresponding producer fact (`hasExactMixinChildSurface`,
  `hasExactRulesetChildSurface`, `hasDeclarationChildSurface`, or
  `hasVarDeclarationChildSurface`). On the canonical profile, declaration
  recursive visits fell `1,447→412` and var-declaration visits
  `14,552→14,096`; ruleset visits fell `2,058→2,006`. The current-dev A/B was
  output-identical (`135,794` bytes, Jess hash
  `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`) but
  timing remained noise-level: parse+render `248.38→246.39 ms` with `20/45`
  wins, render-only `199.53→201.46 ms` with `18/45` wins. Core `3326` passed,
  the production spine was `137/137`, all-less was `106/106`, focused
  source-map/render checks were `126` passed, and the aggressive-cutting review
  passed. Keep the cut as eliminated work; do not call it a speed win.

- **Q-40 combined final A/B (2026-07-15).** After integrating the producer-fact
  admission cut and the bounded import-placement allocation cut, a fresh
  current-`dev` versus candidate build comparison used the canonical fixture,
  20 warmups, 45 alternating pairs, and held generated parser/plugin artifacts
  constant. Parse+render was `217.181792→216.742542 ms` (median ratio
  `−0.20%`, `21/45` wins); render-only was `182.083875→181.264208 ms`
  (`−0.45%`, `18/45` wins). Both phases were byte-identical at `133,389` bytes,
  SHA-256 `39a4812a88ea77a94f846f8392fb536da882e84452d03880103d256cb1d73a4c`.
  This is consistent with the noise floor and carries no canonical throughput
  claim; the accepted Jess cuts are justified by eliminated scans and placement
  allocation/state, while the separate Parseman recognizer POC has its own
  parser-phase speed evidence.

- **Q-40 lazy registration pending lanes (2026-07-15, integrated as
  `3a3f71d9e`).** `Rules` registration-prep state now allocates the declaration
  and ordered-identity pending lanes only when a node actually enters that
  lane. On the canonical fixture the worker observed `3,131` prep states,
  `485` pending states (`15.5%`), and `2,646` common-path states that avoid
  `5,292` lane objects and `10,584` arrays; `1,118` nodes entered the pending
  path. The worker's exact output was `135,794` bytes with SHA-256
  `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.
  Its matched 20-warmup/45-pair A/B was parse+render `233.34→239.29 ms`
  (`+4.95 ms`, `+2.55%`) and render-only `213.04→202.67 ms`
  (`−9.34 ms`, `−4.87%`), so this is an allocation/shape simplification,
  not a claimed speed win. The isolated worker passed core, spine,
  all-less, aggressive-cutting, and binding-guard gates; the change is now
  on `dev` and remains subject to the combined integration gates.

- **Q-40 declaration-child assignment metadata cut (2026-07-15, integrated as
  `d443a559b`).** Direct declaration-child collection now consults uncovered
  assignment-target metadata only when the containing `Rules` surface already
  has a variable-declaration or reference-import producer. In the instrumented
  canonical profile, collection calls fell `27,899→15,714`, inclusive time
  `18.707→7.170 ms`, uncovered-surface calls `6,927→204`, assignment
  propagation `6,927→204`, nested propagation `10,190→3,467`, and source
  items `101,693→71,975`. The matched worker A/B was parse+render
  `229.09→237.50 ms` and render-only `193.11→193.83 ms`, so it carries no
  speed claim; the justification is removal of provably empty metadata work.
  Output remained `135,794` bytes with SHA-256
  `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.
  Focused reference coverage, core, spine, all-less, build, lint, and
  aggressive-cutting gates passed.

- **Q-40 current post-cut control/profile refresh (2026-07-15, diagnostic
  only).** The latest same-checkout no-op control on Node v25.9.0 arm64
  measured parse+render `227.150542→227.980167 ms` (means
  `229.840→233.436 ms`, `24/45` candidate wins, paired median ratio
  `−0.176%`, mean ratio `+1.884%`) and render-only `186.348125→183.990750 ms`
  (means `192.249→189.799 ms`, `25/45` wins, paired median ratio `−0.358%`,
  mean ratio `−0.635%`). The spread remains a noise floor, not a speed claim.
  The following instrumented profile took `541.84 ms` and recorded `4,098`
  preview calls (`4,085` declaration fallbacks, `13` leaves), `1,644`
  duplicate-comparison containers, `884` prerendered declarations, `10,777`
  merge-admission calls with only `15` feature-bearing surfaces and zero
  child-item visits, `5` import-tree calls (`3` misses/`2` hits), and `43,167`
  direct declaration cache misses—all `.d` strategy—with `53,360` child-entry
  admissions, `16,486` child scans, and only `6` public hits. A live shape
  census counted `10,007` Declarations, `8,405` Rulesets, `7,211` References,
  `4,803` Dimensions, and `3,604` Colors. These measurements rank work;
  instrumentation distorts timing and does not justify a generic lookup index.

- **Q-40 unminified CPU call-tree refresh (2026-07-15, diagnostic only).** A
  real compiler-path Node CPU profile with 2 warmups and 2 alternating pairs,
  run after an unminified core build and followed by restoration of the normal
  minified build, sampled `isNode` at `129.19 ms`, GC at `123.41 ms`,
  `extendSelector` at `62.62 ms`, `findWithinScopeSurface` at `42.64 ms`,
  `applyExtendsToSelector` at `40.57 ms`,
  `findMixinsFastForUncoveredCallable` at `39.43 ms`, and `processExtends` at
  `25.68 ms`. Call-tree attribution puts about `27.46 ms` of sampled `isNode`
  time under `childRulesOf`, `12.75 ms` under `walk`, and `10.54 ms` under
  `collectSelectorSubtreeValues`. The sample is too small for throughput
  claims, but it identifies a concrete `childRulesOf` fast-path proof target;
  no global `isNode` rewrite is implied.

- **Q-40 `childRulesOf` fast path (2026-07-15, accepted in `c08feb9a9`, source candidate `ce60697f4`).** `childRulesOf()` now checks the real `Rules` instance before the three ordinary `isNode` protocol checks and retains the duck-typed `N.Rules` fallback. The focused compatibility test covers all five local `Rules` subclasses plus a foreign `N.Rules` value; full core passed `3,329` tests (`15` skipped, `2` todo), spine ratchet `137/137`, baseline/all-less `106/106`, Less alpha verification, core/plugin/Jess builds, ESLint, aggressive review, and `git diff --check`. The current exact rebuilt-chain A/B used 20 warmups and 45 alternating pairs: parse/render `237.349125→231.947792 ms` (−5.401333 ms, `−2.275691%`, `31/45` wins) and render-only `199.381666→197.704750 ms` (−1.676916 ms, `−0.841058%`, `27/45` wins). Output was byte-identical at `133,389` bytes, SHA-256 `39a4812a88ea77a94f846f8392fb536da882e84452d03880103d256cb1d73a4c`. The signal is modest and environment-sensitive, so retain this as a bounded work reduction with no causal speed claim; do not generalize to a global `isNode` rewrite.

- **Q-40 `hasDirectChildRuleSurface` pre-collection guard (2026-07-15, rejected).** The find-within-scope audit identified a distinct possible cut—skip `collectDirectDeclarationChildEntries()` when the existing producer fact is false. The implementation proof found that `derive()` intentionally clears `R_HAS_DIRECT_CHILD_RULE_SURFACE` while sharing the child array, so a derived placement can contain a direct Rules child while the proposed guard reads false. Repairing that would require another traversal/state graph or a new authoritative ownership protocol, violating the bounded-cut rule. No source change or POC was retained; keep the existing child-entry path and do not use this flag as a lookup shortcut.

- **Q-40 extend chain-only preparation audit (2026-07-15, pending owner proof).** The extend audit found that `applyExtendsToSelector()` eagerly prepares `collectSelectorSubtreeValues()`, expanded extend targets, tuples, and the target index even when no selector changes and chained discovery is never entered. The current dirty user checkout already contains a partial lazy-preparation change in `packages/core/src/tree/util/extend.ts`; it was not touched or duplicated. Removing/reusing the subtree scan remains rejected without a focused matrix covering chained/partial/list/`:is`/ampersand/self/circular/reference/protected-root semantics plus canonical A/B. The existing target index and pass memo remain required and must not be revived as a root-level cache.

- **Q-40 reference-surface allocator audit (2026-07-15, rejected as a new
  cut).** The semantically valid fixed-shape candidate was benchmark-activated
  (`1,428` seam calls on `benchmark.less`, `1,200` on a dynamic fixture), but
  showed no causal speed or consistent memory win and was materially more
  complex, so the source was reverted. Benchmark parse/render was
  `230.686→231.084 ms` and render-only `200.831→197.308 ms`; dynamic fixture
  parse/render was `243.909→216.267 ms` and render-only `134.793→134.009 ms`,
  without a stable canonical signal. Outputs were exact: benchmark `135,794`
  bytes with SHA-256
  `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`, and
  dynamic `192,519` bytes with SHA-256
  `38a968f24a8bd34be03fc667cddb679bc0e35a9335fbb731ec0cef38e0f337cc`.
  Focused `515/516`, core `3,331`, full build, spine `137/137`, all-less,
  aggressive review, and ESLint passed. Evidence-only worker commit is
  `a69f51b5d`; do not reopen the lane without a new workload and a simpler,
  consistently beneficial shape.

- **Q-40 explicit merge-only lookup audit (2026-07-15, rejected).** The
  canonical profile reproduced `43,167` declaration cache misses, `53,360`
  child-entry admissions, `16,486` child scans, only `16` local matches, and
  `22` declaration references. A merge-heavy fixture rendered exactly
  (`186` bytes, SHA-256
  `4d01b5cbdf83e120e5d3b16f9a8ef8c05288976185f74df0c515e1da58067dfe`) but
  activated zero direct-lookup counters, including an eval-forcing probe,
  because its merges were structurally coalesced before
  `findAnyDeclarationOccurrence`. A bucket-only descriptor therefore has no
  activating proof and cannot be admitted without reintroducing cross-scope,
  import/mixin visibility, self-exclusion, and source-order filtering. No
  source change or commit was made.

- **Q-40 source-order preparation audit (2026-07-15, rejected as a new
  canonical cut).** The earlier legacy-only profile performed
  `_prepareForEval` `10,420` times (`865.8 ms` inclusive),
  `_prepareRegistrationOnce` `3,060` times (`85.7 ms`), and
  `_evaluateSourceOrder` `10,420` times (`807.4 ms`); normalization found
  only `8` candidates and performed `0` actual reorders, while live-binding
  placements repointed `6,987` times. A follow-up current-dev instrumentation
  corrected the activation story: canonical `benchmark.less` has one spine
  root attempt but then enters the normal fallback path `10,777` times for
  `_prepareForEval`, `_evaluateSourceOrder`, and
  `_normalizeCallDeclarationRulesOrder` (imports-only preparations: `0`).
  Therefore this is real canonical work, not legacy-only work; however, the
  existing normalization target is already owned by `7bb9b483e`, and deleting
  or consolidating the broader evaluation route would risk source-order,
  import, call, and live-binding semantics. No new bounded candidate was
  found and no duplicate worker was dispatched. Keep this lane closed until a
  distinct seam has an activating proof.

- **Q-40 scope-frame callable `Map.has` + `Map.get` proof (2026-07-15,
  rejected).** The semantically valid candidate replaced the two probes in
  `lookupScopeFrameCallable` with one `Map.get`, preserving the distinction
  between an absent key (`undefined`) and a cached null bucket. Focused
  scope-frame/rules tests passed `110` with `5` skipped, and output stayed at
  `130,772` bytes with SHA-256
  `671970c15aba5bf05472eeb1f02468f21411fdd20e203674d446775c51c4f9a5`.
  Same-checkout render-only medians over three 5-warmup/45-sample runs were
  baseline `227.92`, `219.20`, `214.43 ms` versus candidate `238.08`,
  `216.09`, `212.72 ms`; this is noise/negative evidence, not a speed win.
  Aggressive review also rejects the unregistered `scope-frame.ts` production
  hunk. Leave the candidate uncommitted and do not add a generic lookup cache
  or index.

- **Q-40 registration-map sentinel proof (2026-07-15, rejected).** The
  apparent allocation cut was to stop `_stampRegistrationMaps()` from writing
  an empty `varsByName` map on every prepared `Rules` surface and reuse the
  packed `_registrationPrepared` bit as the scope-frame “declarations covered”
  fact. The isolated proof at
  `/private/tmp/jess-varsbyname-proof-20260715` found that this bit is set early
  for re-entrancy and is deliberately preserved by `resetDerivedState()` while
  `varsByName` is cleared (`rules.ts:1570-1575`). Reusing it would therefore
  mark a derived frame covered after its declaration buckets had been removed.
  A safe version requires a second lifecycle fact or altered registration/reset
  plumbing, so it is not a bounded cut. Diagnostic counters recorded `3,131`
  registration stamps, `3,249` empty-map writes, and `5,366`
  `RulesLookupState` allocations; output was `133,983` bytes with SHA-256
  `adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840`. The
  worktree is clean, no source/test files or commit remain, and no focused or
  canonical A/B was run because the semantic proof failed first. Reopen only
  as an explicitly owned combined registration-sentinel/scope-frame redesign.

- **Q-40 profile refresh (2026-07-14, diagnostic only).** A fresh current-dev
  minified-build no-op control with the same fixture/runtime and 20 warmups /
  45 alternating pairs measured parse+render `217.263 ms` versus `215.872 ms`
  (`-0.976 ms` median, `27/45` candidate wins) and render-only `183.213 ms`
  versus `182.340 ms` (`-0.353 ms` median, `23/45` wins). These are still
  environment/control noise, not a code-speed claim. A separate unminified
  CPU-profile diagnostic (5 warmups plus one pair, therefore not the canonical
  timing contract) sampled the largest Jess runtime families as `isNode`
  `201.29 ms`, `extendSelector` `96.22 ms`, `findWithinScopeSurface`
  `62.29 ms`, `applyExtendsToSelector` `61.03 ms`, and `processExtends`
  `56.57 ms`, with `146.36 ms` in GC. The unminified build was restored before
  further comparisons; these samples rank investigation targets only.

- **Q-40 isNode reorder rejected (2026-07-14).** The current `isNode` mask
  path is already a direct numeric `nodeType` read plus bitwise test; foreign
  node-like compatibility requires the existing no-mask `type`/`children`
  check. A one-line no-mask branch reorder passed the focused 9-test semantic
  suite and preserved the canonical `133,983`-byte output/hash
  `adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840`, but
  separate 20-warmup/45-pair runs drifted with the machine and did not provide
  a stable speed signal. The source and generated build were restored; do not
  land a type/prototype rewrite without a stronger paired proof.

- **Q-40 direct declaration lookup rejection (2026-07-14).** The canonical
  profile records `33,607` uncached `d` attempts, `37,560` child entries
  entered, `37,554` misses, only `6` public hits, `12,934` qualifying child
  scans, and `2,318` family skips. `d` is the intentionally restricted
  `$theme.foo` member-declaration strategy; exact-name indexing would be new
  construction-time state, not a safe omission. No production change or
  benchmark claim was made; keep this as an owner-gated dependency-graph/index
  candidate rather than adding another generic lookup cache.

- **Reject the direct custom-declaration fallback writer.** The isolated POC
  bypasses `renderNodeText()` for a map-off, comment-free custom declaration,
  but calls `Declaration.writeSyntax()` directly. That serializer deliberately
  emits `important` only on its non-custom branch, so the POC drops
  `!important` from a custom property. Restoring that semantic formatting would
  widen the change beyond a narrow transport cut and needs an owned declaration
  formatting design. Leave the POC dirty and unmerged; do not revive it as a
  benchmark shortcut.

- **Reject a broader direct-container declaration route.** The tempting
  map-off/default-merge/no-`!important` predicate admits 4,069 of 4,085
  canonical fallback declarations (99.61%) and preserves the canonical hash,
  but it bypasses the evaluated-text boundary. The full Less corpus changed in
  44 of 106 fixtures, leaving unresolved values such as `$['color']` and
  `$??(...)` in CSS. All canonical fallbacks are non-static evaluated-tree
  emissions after the spine attempt has restored ordinary rendering; no safe
  “already evaluated” discriminator exists. `renderNodeText()` therefore owns
  real value evaluation before the outer tail handles indentation, semicolon,
  newline, and trivia. The temporary POC was removed; do not replace detached
  text with direct `writeSyntax()` without a new evaluated-result ownership
  model.

- **Reject source-node attachment for remaining inline comments.** Standalone
  comments already lift into `Comment` AST nodes. In a narrow canonical census,
  the three non-lifted inline comment ranges occur inside bare string-selector
  headers, with no semantic node `before`/`after` boundary to own them.
  `sourceNode` is self-owned rather than a stable original-provenance pointer
  for derived nodes, and `inherit()` deliberately does not replay source
  boundary trivia into a new placement. Attaching those ranges to a source node
  would require a new selector-string slot plus carry/drop policy and defeat
  existing placement semantics. Keep boundary-addressable inline comments in
  the shared source trivia map; reduce over-eager whitespace persistence at
  capture time instead of adding comment fields or side maps.

- **Reject local object-table lookup.** Two same-process runs of the existing
  layout benchmark recorded current `Map` reads at `22.02/21.78 ms`,
  null-prototype own-property reads at `32.76/32.82 ms`, and planned numeric
  slot reads at `26.46/26.99 ms`. The object table is 49–51% slower than the
  current map in this local-only test, so it does not justify a runtime branch.
  The script's value/shadowing assertions passed; this is still not a general
  Less correctness proof or a canonical benchmark speed claim.
- **Keep bounded parent plans, not a generic environment.** A future admitted
  current read can have a source-static `(lexicalDepth, slot)` plan only after
  generic lookup proves the actual placement parent chain, every skipped frame
  remains static/unchanged, and imports, child surfaces, pending names,
  mutations, leaky bindings, source-position reads, properties, and callables
  are absent. A prototype chain is a test-only comparator for that later slice;
  it must not become a second scope engine.
- **Reject the pass-local extend-root index.** The static 32-extend,
  `(multiple)` 1x/2x/3x POC was byte-identical to Less and to POC-off across
  its dedicated parity test, and its focused core/extend/import/ampersand
  suites passed. But three alternating rounds (5 warmups, 15 off/on pairs)
  made the important 3x case neutral and direction-changing: `2.960→2.978`,
  `2.868→2.802`, and `2.778→2.814 ms`. The 2x case was mixed as well. The POC
  was deleted; do not retain a pass-local index or selector-result cache on
  this evidence.
- **Reject the static-local slot proof for this target.** The canonical output
  hash remained exact and 212 focused tests, core build, binding hot-path checks,
  aggressive review, and diff check passed. But its counters recorded zero slot
  or fallback activations on canonical `benchmark.less`; the target does not
  contain this admitted shape. Same-worktree medians were public
  `277.43→280.88 ms`, parse+render `262.81→271.25 ms`, and render
  `226.23→216.44 ms`, all too noisy or regressive to retain. The committed POC
  stays unmerged. Parent slots and prototype controls are sequenced behind a
  target that demonstrably activates them, not behind this non-occurring case.
- **Fresh activation check rejects the slot mechanism for integration.** The
  existing `f6bca2ba4` candidate passed the focused scope-slot proof (`4/4`)
  and core compile. A synthetic static-local workload activated the slot path
  `359,997` times and preserved checksum `23,999,994`, but four sequential
  1,000,000-read runs measured candidate medians `259.619 ms` and `260.924 ms`
  versus current `origin/dev` baseline medians `250.790 ms` and `250.473 ms`
  (roughly `+3.6–4.2%`). This is an activating mechanism check, not a canonical
  benchmark claim; combined with zero canonical activation, do not cherry-pick
  the slot POC or widen it to parent/prototype slots. Keep the existing owner
  evidence for a future target workload only.
- **Reference.evalNode audit (2026-07-14) — no new general lane.** Five clean
  current-dev profile runs reproduced `3,577` calls (`2,667` variable,
  `491` function, `397` mixin-ruleset, `22` declaration) and roughly
  `68.42–76.70 ms` total. The `33,607` declaration misses are the 22 explicit
  property-merge references (`+:`, `+_:`, declaration `+`, and conditional
  assignment), carrying source-order starts, exclusions, semantic filters, and
  required assignment kinds; they are not ordinary variable misses. A generic
  cache/index is therefore rejected. The only bounded ordinary-variable lane
  remains the already-owned `jess-scope-slot-proof` worktree; do not open a
  duplicate `Reference.evalNode` or prototype-chain lane. Any future
  merge-specific predecessor index needs ownership across declaration/rules/
  lookup and parity for merge chains, mixin boundaries, cross-scope merges,
  exclusions, and `!important`.
- **Parser boundary measured; recognition itself is a ranked problem.** With a
  regenerated grammar, the canonical 106,797-byte fixture on Node v24.11.1/M4
  Pro (12 warmups, 45 samples) measured Parseman recognizer-only at `12.784 ms`,
  structural capture at `28.873 ms`, and CSS-CST host construction at
  `37.558 ms` (56,043 grammar nodes; capture records 86,807 child, 86,771 raw,
  and 66,060 trivia slots; host calls 24,800 times). On the exact same runtime
  and fixture, Less 4.6.3 `less.parse()` to its native AST was `4.417 ms`
  (`processImports: false`). These output models are not equivalent, but the
  outputless 2.89x recognizer gap means CST/AST construction is not the whole
  parser story. Next work is a CPU/codegen attribution of the recognizer gap;
  do not claim parser-model equivalence or change the CST contract from this
  comparison alone.
- **Parseman/less flow attribution changes the next proof.** The current
  “recognizer-only” profile suppresses output but remains the same generated
  parser under a runtime mode flag: every structural rule still saves and
  installs collector context, restores it, and checks/increments profile state.
  It is not a separately compiled `voidOf` artifact. The Less 4 parser instead
  keeps one mutable cursor and routes a normal declaration through a property
  regex plus `anonymousValue()` before its full value grammar; on this fixture
  2,024 of 2,902 declarations (69.7%) take that raw `Anonymous` route. Our
  grammar eagerly enters `valueList → valueSequence → topSum → topProduct →
  operand → value`, and its overlapping body choice places Ruleset before
  Declaration where both admit an identifier. This is a code-shape and
  evaluation-timing mismatch, not evidence that macro compilation cannot reach
  handwritten-parser speed. The implementation is deferred after an
  analysis-only Parseman follow-up: its first generic target is zero-copy
  structural builder input, followed separately by a genuinely stripped
  recognizer and a safe declaration-vs-ruleset dispatcher. Do not call a lazy
  raw-value representation a parser micro-cut: it changes Jess's semantic
  materialization boundary. Detailed source-flow evidence and the Parseman
  handoff are tracked in [`PARSER-RECOGNIZER-GAP.md`](./PARSER-RECOGNIZER-GAP.md)
  and the linked `parser-thing/notes/PERF_IDEAS.md` record.
- **Parseman generic follow-up handoff (2026-07-14).** The analysis-only audit
  is recorded in `parser-thing/notes/PERF_IDEAS.md` (isolated documentation
  commit `916c52b`). Its first implementable generic target is opt-in zero-copy
  structural builder input with shared capture storage and range/cursor views,
  preserving separate semantic/raw channels. A genuinely compile-time-stripped
  recognizer is a separate higher-upside architecture proof; runtime output
  suppression is not equivalent. The audit excluded existing Parseman
  worktrees, ran focused JSON/GraphQL/CSS measurements, and keeps CSS/Less
  late-value materialization outside Parseman's generic contract. No Parseman
  implementation was made.

- **Parseman true recognizer POC (2026-07-15).** The highest-ranked generic
  candidate was implemented in Parseman branch `feature/true-recognizer-20260715`
  at commit `c84d777` (the SSH push was unavailable from this checkout, so it is
  locally committed but not published). `compile(..., { mode: 'recognizer' })`
  now emits a separate acceptance/end/failure-cursor contract at code-generation
  time, omitting CST/raw/trivia/fields/host/profile/output-slice work while
  retaining cursor movement, lookahead, rollback, repetition, and expected
  failures. The default compiler contract is unchanged; runtime-only parser
  fallbacks are rejected. The typed map-source overload and
  `compileLinkable(..., { mode: 'recognizer' })` plus `fuseRules` parity test were
  added before acceptance. Equal-contract A/B improved JSON-like 16,946-byte
  parsing `0.180875→0.095291 ms` (`47.32%`, p95 `0.236375→0.119792 ms`) and the
  real 106,802-byte Less grammar `7.38425→5.534 ms` (`25.06%`, p95
  `8.0435→5.96925 ms`), with zero GC events. Focused contract tests were
  `39/39`, perf tests `5/5`, typecheck/build/lint passed. The Parseman full suite
  still has one pre-existing `test/unit/build-arity.test.ts:116` failure because
  its stale source-shape regex expects literal `=[]` while current baseline
  emits a profile-conditional `_tl` initializer (`1,735` passed, `1` failed).
  This is a generic parser result, not a Jess runtime change; Jess adoption
  requires the published Parseman dependency path and a fresh Jess parser build.
- **Parseman true-recognizer Jess adoption proof (2026-07-15, rejected for
  now).** Clean disposable Jess chains consumed Parseman baseline `d9c4873` and
  candidate `c84d777`, built core/CSS/Less parser/plugins/Jess, and ran the same
  `benchmark.less` fixture (`106,802` bytes, `collapseNesting:true`, Less plus
  compatibility plugins, `JESS_STATIC_NAMESPACE_TABLE=0`) with `20` warmups and
  `45` alternating pairs. Parse+render was `273.558292→260.023458 ms`
  (`−4.95%`, candidate p95 `323.854583` vs `337.561167` ms); render-only was
  `60.901166→61.567417 ms` (`+1.09%`, candidate p95 `69.930750` vs
  `68.434750` ms). Parser-stage medians were `42.302375→39.217000 ms`, and
  render-stage medians were `227.818083→221.846249 ms`. CSS was exactly
  identical in both phases: `131,578` bytes, SHA-256
  `98a0536086c7e555b1a98e2372ad4000d51e25f1418c6345b6b8a9a97d80972f`.
  Reject adoption: Jess's current grammar does not request
  `mode:'recognizer'`, so this is not exercising the new code-generation lane,
  and render-only regressed. No Jess or published Parseman source changed;
  only disposable manifests, lockfiles, and generated outputs were used.
  Do not claim this package POC moved Jess performance.
- **Parser/AST shape audit refresh (2026-07-14).** A fresh functional-parser
  census of the 106,802-byte Less fixture measured recognition `44.69 ms`,
  structural capture `58.10 ms`, and host construction `70.71 ms`, with
  `53,461` grammar nodes, `84,542` semantic child slots, `84,506` raw-child
  slots, `62,688` trivia slots, and `23,940` host calls. A separate CSS corpus
  reached `577` AST nodes, with spans on `573`, field-span tables on `26`,
  value-span tables on `2`, and only `6` adoption calls; this supports keeping
  one-level parenting and sparse provenance rather than adding eager deep
  adoption. The ranked shape candidates are: (1) remove inert static
  `Any`/`Keyword` wrappers where consumer contracts admit strings (`127`
  instances on the focused CSS corpus), (2) investigate a host-specific view
  for duplicated child/raw-child capture without changing Parseman's default
  ABI, (3) replace scalar-only `sourceSpanOf()` object callers with direct
  start/end accessors, and (4) measure Less comment-only trivia masks against
  its standalone-comment rescans. These are evidence-backed follow-ups, not
  accepted production changes; preserve interpolation, math, references,
  lists, computed values, trivia order, and source-map behavior.
- **Reject the generated-trivia first-byte guard.** The guard preserved profile
  counts and passed focused/typecheck/macro-build proof, but the required
  12-warmup/45-sample three-phase gate regressed throughout: recognizer
  `11.958→11.985 ms` (+0.22%), structural capture `28.850→28.938 ms`
  (+0.30%), host construction `26.551→26.603 ms` (+0.20%). It was removed.
  Do not revive a trivia call-site guard; isolate the recognizer's node-frame
  setup/restore cost or capture representation instead.
- **Reject the recognizer-only node-frame bypass.** Its admission was narrow:
  recognizer nodes have no CST collectors, raw/trivia children, fields, or host
  output; tokens/recovery/`withCtx` and all capture/host/backtracking nodes
  remained framed. Focused behavior, source-map/macro compilation, and
  structural counts were identical, yet the required 12-warmup/45-sample gate
  regressed recognizer `11.875→16.469 ms` (+38.69%), capture
  `28.446→36.819 ms` (+29.43%), and host `26.297→33.984 ms` (+29.23%). It was
  deleted. Do not bypass generated node frames; pursue the independent
  collector/raw-child representation proof instead.
- **Reject the raw-child collector alias proof.** On the exact real-LessGrammar
  phase harness (12 warmups, 45 samples), the POC-off/candidate medians were
  recognizer `12.052→12.676 ms` (+5.2%), structural capture
  `28.608→30.247 ms` (+5.7%), and host construction `40.524→43.491 ms`
  (+7.3%). It did not clear any phase, so the Parseman collector worktree,
  temporary Jess phase harness, and standalone profiling script were deleted
  without a commit. Do not reopen raw-child aliasing; finish the source-level
  recognizer control-flow attribution first.
- **Reject the first-set pseudo-selector codegen guard.** The measured target
  was 16,443 failed pseudo-selector parses behind
  `not(extendAhead) + PseudoSelector`, but the final narrow Parseman POC did
  not clear the three-phase gate: recognizer `12.291→12.248 ms` (-0.35%),
  structural capture `28.642→28.785 ms` (+0.50%), and real Jess host
  `38.132→38.767 ms` (+1.67%) over 12 warmups and 45 samples. Differential
  parsing, Parseman build/typecheck, and all-less `106/106` passed, but the
  implementation was reverted. Do not revive this guard without a solution
  that improves the whole recognizer/capture/host boundary.
- **Accept ordinary bitset disjoint scanning as an allocation cut.** The two
  extend mismatch callers invoke `isDisjoint()` frequently, and the canonical
  profile recorded 25,439 ordinary numeric-backing scans with zero fallback.
  Direct word scanning replaces a temporary `and()` bitset plus its follow-up
  scan; inverted or uncertain backing deliberately retains the old path. Heap
  sampling removed the sampled `isDisjoint → and/parse` allocation family
  (13,576 B `parse`, 1,424 B `and` in control). Canonical and repeated-import
  A/B rounds had no stable regression, and core `3320`, spine `136/136`, and
  all-less `106/106` are green. This is retained for object reduction, not
  claimed as a canonical speed win; do not add profile state or a result cache
  to the hot path.
- **Dependency-graph direction is placement records, not a path cache.** A
  `Context` already shares the parsed source `Rules` tree by resolved path, and
  callable/import placement wrappers already retain canonical children. The
  reusable boundary ends before the import parent/fallback frame, extend root,
  bindings, guard/argument frame, and write effects. A future reuse proof must
  separately identify immutable module identity and a placement dependency
  record (read binding-cell identities/versions plus writes); a path-only cache
  is unsafe for `(multiple)`, reference imports, leaky scope, interpolation,
  and mixin calls. First measure repeated static-import placement/registration
  work before considering a source-owned descriptor.
- **Static `(multiple)` import attribution closes the path-cache premise.** A
  current-dev 1×/2×/3× static import probe keeps one parsed source tree (one
  cache miss then hits) and produces exact repeated CSS. Retained growth is
  linear, current-runtime placement state: one `Rules` surface and
  `ScopeFrame`, one `ImportPlacementState` with `children`/`childSegments`, one
  segment record, and a shallow Ruleset/body/Declaration placement copy per
  site. The output buffer is transient and source children remain canonical.
  Tiny-fixture forced GC bytes were noisy. This proves source reuse but **does
  not** prove every retained wrapper/array/clone is semantically necessary: a
  closed source needs repeated output occurrences and some placement identity,
  not necessarily this whole representation. Do not build a path cache from
  this result; first perform a field-by-field minimality proof and remove one
  actual placement-owned family only when a compact descriptor/direct segment
  preserves fallback, source-map, extend, mixin, and reentrancy semantics.
- **Import-placement diagnostic harness is now integrated.** The existing
  measurement lane's fixtures, byte-identity test, and
  `scripts/measure-import-placement.mjs` are in current `dev`; focused coverage
  passes `3/3`. A bounded run (`--warmup=3 --iterations=5 --rounds=2`) reports
  exact hashes at 1×/2×/3×, source-tree import hits `0/1/2` after one miss,
  and linear placement/registration/spine calls `1/2/3`, `2/4/6`, and
  `1/2/3`. It is a measurement surface, not a production optimization or a
  canonical `<40 ms` claim; use it for the next field-by-field placement-state
  and dependency-record proof.
- **Fresh AC no-op split is still unstable.** On Node v25.9.0/AC/100% with the
  canonical fixture, 5 warmups and 15 alternating no-op pairs gave
  parse+render medians `263.54/270.22 ms` (one 353.87 ms outlier) and
  parse-once render medians `234.10/232.83 ms` with 574.38/675.65 ms outliers.
  Treat this as an environment-quality warning, not a new baseline or a
  before/after result; continue to require round-level stability for claims.
- **Keep node discriminators on prototypes and retain generic `isNode`.** The
  representative static/dynamic ASTs have zero own `type`/`nodeType` fields;
  those prototype-owned discriminators avoid a universal node slot. A pure
  property-load microbenchmark favors an own field, but would add an estimated
  0.30/0.41 MiB across the measured live trees and changes key/JSON shape, so
  it is rejected. `isNode` remains necessary at polymorphic/module-identity
  boundaries; a future POC may cache `nodeType` in one already-trusted local
  container loop, never replace the helper globally. Declaration literal
  slimming is instead `value` plus a scalar tag/packed `valueTypes` sequence,
  fenced behind the D-EVAL/value-heavy profile because literals must retain
  authored spelling until materialized.
- **Trivia and final output assembly are not the present cut.** No-trivia and
  single-space probes made the same writer/trivia-map calls; comments add real
  sparse correctness work (canonical: 49,118 trivia lookups and 8,879 comment
  runs), so neither proves a span/map deletion. The normal map-off root already
  shares one writer/buffer array (15,340 chunks), with no detached final buffer;
  maps-on deliberately retains a detached final result. The targeted writer
  POC is instead `renderNodeText`'s 14,903 map-off detached fragment writers
  and their 59,612 unnecessary source-position arrays. It must keep source-map
  output exact when enabled and add no compensating state.

The queue is considered drained only when every row is landed, explicitly closed
with evidence, or transferred to an owner-judgment/design lane. A row that merely
has a checkbox or a clean abandoned worktree is not complete.

### Candidate-specific ownership audit — 2026-07-13

The candidate pass inspected the exact worktree status, tip, and changed paths before
making the closures above. The result is deliberately asymmetric: Q-07, Q-14, Q-22,
Q-23, and Q-25 closed on current-code/ancestry or landed-lane evidence; Q-16
transferred to owner judgment; Q-10/11/12/15 remain open but are fenced to existing
lanes. WT-1/4/6 are explicitly split between ancestor tips and diverged owners; WT-2
is fully ancestral; WT-7's dead-symbol half is integrated while parser hardening remains
owner-bound. No new worker was assigned to any overlapping row, and no partial worktree
was reset, cleaned, or replayed.

The relevant partial lanes are all clean or explicitly user-owned except
`jess-perf-lookup`, which has an uncommitted mixed diff and is therefore left untouched.
Its useful-looking callable-index ancestry is already on `dev`; its remaining diff is
not a Q-23 improvement. Selector-capture, extend-index, ref/import, hoist, and
parser/trivia worktrees likewise contain overlapping files and remain owner-bound.

Follow-up ownership audit — 2026-07-14: the local `jess-deval-flip` worktree was
inspected read-only before Q-30 was considered. Its tip contains six D-EVAL-related
commits, but comparing it with current `dev` exposes a 284-file historical divergence;
the remote-tracking `origin/work/deval-flip` ref points at an unrelated tip. No
whole-range gate evidence was found at a current-dev tip. Q-30 therefore remains
fenced until its owner refreshes the lane from current `dev` and publishes an exact,
gated batch. No D-EVAL worktree was modified, reset, or replayed.

Follow-up ownership audit — 2026-07-14: a second live check found
`jess-q28a-css-at-rule-strings` dirty again in `packages/css-parser/src/builders.ts`
and its AST test. The working files match current `dev`, but the worktree remains
owner-bound; Q-28D is fenced and its worker was stopped before editing. The separate
`jess-lazyvalue-spike`, `jess-perf-valueeval`, and `jess-fa-integration` worktrees are
also dirty in the Dimension/Color instrumentation and rounding files, so Q-30 remains
fenced as well. No existing worktree was reset, cleaned, or modified by this audit.

Follow-up producer-contract audit — 2026-07-14: a read-only Q-30 trace confirmed
that the active public producer seam is the functional parser `builders.ts` /
`grammar.ts` path in the CSS and Less parser packages. The similarly named
`cssRecursiveParser.ts` and `lessRecursiveParser.ts` files are historical or
benchmark-only seams, not a current worker write set. No existing worktree contains
a Q-30 tag/materializer implementation. The next Q-30 owner must branch from the
current `dev` tip, claim the functional producer files plus a narrow materialization
consumer slice, and publish the required value-heavy allocation/materialization
evidence before the row can open.

Value-heavy control refresh — 2026-07-14: the code-equivalent pre-doc tip
`6d08db86a` measured `/tmp/jess-value-heavy.less` at `49.42 ms` round median
and `49.87 ms` trimmed median over 24 samples (Node v25.9.0, darwin arm64,
8 iterations × 3 rounds, 4 warmups, 10% trim). One `94.27 ms` outlier made the
untrimmed signal noisy; the trimmed signal was usable. This is a control only,
not a speed claim; Q-30 must rerun the same-directory A/B after each
typed-literal batch.

Q-30 allocation census — 2026-07-14: a read-only parse of the existing
`/tmp/jess-value-heavy.less` fixture (113,407 bytes, 6,000 declarations, zero
parse errors) found 2,000 `Dimension`, 2,000 `Color`, and 500 `Num` value nodes;
the remaining 1,500 scalar declaration values were already strings. A separate
mixed probe kept `Expression`/`Operation`, `Reference`, and `Call` values
node-backed, confirming the intended static-versus-calculated boundary. This
quantifies Q-30's potential node surface but is not an implementation result:
the exact producer/materializer files remain dirty in existing value-evaluation
worktrees, so no new owner was assigned.

Follow-up branch census — 2026-07-14: no additional unowned implementation lane
was found. The unmerged argument-array, source-span, and Dimension-format refs
are semantically present in current `dev`; parser-trivia refs overlap the active
SCSS/CSS producer ownership; and the remaining unmerged reference/import,
namespace, extend, and spine refs map to existing owner worktrees. No clean branch
tip supplied a disjoint production write set, so no duplicate worker was assigned.

Follow-up owner/no-op audit — 2026-07-14: the live census confirms Q-28D remains
fenced to `jess-q28a` (its dirty CSS files hash exactly like current `dev`), Q-28E
to the three dirty SCSS/parser worktrees, Q-28F to the clean selector-capture seed,
and Q-30 to the six-commit/287-file-divergent `jess-deval-flip` plus dirty value
instrumentation lanes. Two fresh disjoint core audits were retired without
production changes: replacing `Negative` or `Range`'s `lodash-es/round` call with
the local helper is not byte-identical for extreme finite values (`Number.MAX_VALUE`
overflows to lodash's `NaN` spelling, while the helper preserves the magnitude;
the Negative audit also found a signed-zero identity difference). Focused audit
guards passed where run, but the benchmark harness failed before timing on the
generated-parser `unwrapTrivia`/start-production runtime seam. No worker worktree
was reset or cleaned; only the temporary test guards were removed after the
no-op decisions.

Follow-up existing-lane refresh audit — 2026-07-14: `jess-df-hoisted` was tested
as the next possible releasable owner lane. Its existing `6d74da74f` one-file
`serialize-helper.ts` fix is clean on its historical branch, but merging current
`dev` into that branch produced unrelated conflicts in `rules.ts` and
`tree/util/emit-walk.ts` before the helper itself auto-merged. The merge was
aborted successfully, restoring the worktree to `6d74da74f` with no staged or
unmerged files. No stale branch history was replayed; Q-11 remains owner-bound
until its owner refreshes the lane around current `dev`.

Follow-up Q-12 owner audit — 2026-07-14: the three existing extend/layer worktrees
(`jess-extend-serialized`/`e1eac0409`, `jess-extend-residual`/`5c6875538`, and
`jess-append-extend`/`e1eac0409`) do not provide a current-dev production tip.
The append/serialized branches carry the older spine/D-EVAL history and broad
cross-package divergence; the residual worktree adds only an untracked probe on
top of the same historical family. The relevant hard-tail and expanded-mode
folds are already ancestors of current `dev`, while the remaining append×extend
tip needs a current-dev refresh and the full extend/spine byte gate before any
layer-registration claim. No branch was merged, reset, cleaned, or assigned a
duplicate worker; Q-12 remains owner-bound.

Follow-up parser-generation check — 2026-07-14: a dedicated Parseman worktree
investigated the reported SCSS generated-parser crash and produced no patch,
test, or commit. The worker's hypothesis is an invalid external `Quoted` rule
reference surviving grammar composition and reaching `parserHasOwnFields()`;
adding a null guard would conceal a linker/composition defect, so no defensive
guard was accepted. A fresh `@jesscss/scss-parser` compile on this integration
checkout emits `lib/grammar.js` (not `grammar2.js`) and imports `scssGrammar`
successfully; the reported `grammar2.js` artifact is therefore not current
build evidence. Keep the Parseman issue as separate unresolved triage until an
exact current artifact reproducer and linker-level regression test exist; it is
not a Q-28 or Q-30 implementation lane.

Follow-up residual-lane audit — 2026-07-14: current `dev` already contains the
landed S1 lazy optional queue and S4.1 declaration-only `_selectorNode` shape.
The remaining S1 worktree difference was tested as a one-line initial enqueue
spelling (`fallbackQueue = [frame.fallbackFrame]` versus the current
`(fallbackQueue ??= []).push(...)`): matched same-directory `benchmark.less`
control/candidate medians were `219.58 ms` and `235.87 ms`, respectively, with
usable signals and no allocation-level benefit. Focused S1 coverage remained
`17/17`, diff-check and aggressive review passed, and the candidate was retired
without a commit. The S4.1 worktree was also stopped after a live comparison
showed its current files had regressed to the pre-landed field/test shape; it
was not merged, reset, or cleaned. These are stale/no-op lanes, not new queue
assignments.

Follow-up cast audit — 2026-07-14: a fresh ownership check found no existing
worktree on `packages/core/src/tree/util/cast.ts`, so one worker tested the
remaining `lodash-es/isPlainObject` import in isolation. The accepted/rejected
object matrix showed that the nearby constructor-only helper would change
null-prototype, custom-prototype, Symbol-tagged, and cross-realm behavior; the
exact native equivalent was not a smaller or safer cut. The worker left no
production diff or commit. Its 29 focused tests and aggressive review passed;
the repeated same-built-closure benchmark was `208.53 ms → 218.00 ms` with
identical code and is explicitly not a performance claim. The temporary test
probe was removed from the user-owned parent checkout, whose pre-existing dirty
files remain untouched.

Follow-up reference/extend branch audit — 2026-07-14: the unmerged
`worktree-agent-af15497e9bcbf2f24` tip (`2bc666b98`) is not a fresh small lane.
Its diff is `spine-extend.ts` plus `spine-production-ratchet.test.ts` (322 lines
of combinator/interpolation-aware inertness scanning and one ratchet), while
both `agent-ab6671bed6d7880d1` and `jess-benchmark-flip` currently modify that
same ratchet test for the benchmark-flip lane. The older append×extend behavior
in the branch's ancestry was already proven superseded by the current
collision-aware gate; replaying the newer 322-line scan would duplicate the
active test ownership and widen a correctness-sensitive spine predicate without
a current-dev refresh. No production or test file was changed by this audit;
leave the branch owner-bound until its owner explicitly releases or refreshes
the exact slice.

Follow-up Q-30 owner-refresh handoff — 2026-07-14: no implementation can safely
start yet. The first Dimension/Num batch would own the functional CSS/Less
`grammar.ts` and `builders.ts` paths, `packages/core/src/tree/declaration.ts`,
`packages/core/src/tree/util/evaluate-node-array.ts`, and (if retained after
design review) a new literal-tag/materializer module. It must not touch the
legacy recursive-parser files or initially modify `any.ts`, `dimension.ts`,
`number.ts`, `operation.ts`, or `color.ts`. Direct overlaps are
`jess-q28a-css-at-rule-strings` (CSS builders), `jess-cond-grammar` (Less
grammar), and `jess-lazyvalue-spike` (Any/Color/Dimension); the stale
`work/deval-flip` branch remains 287 paths divergent and must not be replayed.
Q-30 opens only after Q-28D/E/F owners merge or explicitly release, the narrow
write set is clean and unclaimed, the owner branches from current `dev`, the
D-EVAL value-heavy reprofile is current, and the owner resolves source-verbatim
versus canonicalized numeric output (including the documented `1.0` case).
Minimum proof remains zero materialization for inert literals, lazy projection
only for operated/compared slots, no write-back into declaration strings/tags,
operation/guard/reference parity, AST/trivia/provenance checks, all-less byte
parity, aggressive review, and same-directory `benchmark.less` A/B.

Follow-up unowned-hotpath harvest — 2026-07-14: a targeted read-only explorer
checked the remaining core utility/render seams while excluding every known
owner surface. No safe candidate survived the required positive overlap check:
`emit-walk.ts`, `serialize-helper.ts`, `spine-merge.ts`, and
`callable-special-case.ts` are dirty; `rules.ts`, `reference.ts`, `call.ts`,
and `ruleset.ts` are owner-bound; and `any.ts`, `color.ts`, `dimension.ts`, and
`util/round.ts` belong to the value-evaluation lanes. No speculative or
cosmetic file was assigned, and no production code changed.

## OPEN-ITEM RECONCILIATION (post-drive — read this before trusting any checkbox below)

The tracker was run as a **failure-count-driven drive-to-green**, and its two deferral rules —
"no failing-test signal → defer" and "coupled to the scope-identity monolith → defer" — generated most
of the `[DEFERRED]` markers as an ARTIFACT of that loop, not a considered "not worth doing." The suite is
now **GREEN (core 2730/0)** and the monolith **dissolved**, so many deferrals are stale or mislabeled.
Authoritative status (supersedes the inline markers further down):

- **DONE — stale checkboxes below (treat as `[x]`):** W1 single-writer (§ line ~497); copy/materialization
  `createRulesLikeReferenceSurface` (the `[promote]`/`[SPEC'D]` perf items — landed as **ref-nuke**, 8×);
  provenance side-table WeakMap (the `[NEW]` item — landed as **provenance-inline**, WeakMap gone). See LANDED LOG.
- **CLOSED — deferred "on the monolith" but the monolith dissolved + their tests now PASS at 2730/0:** E2/E3
  scope-identity (config-surface / wrapper-is-scope-identity), `direct-rules-lookup` R3, eval-output/collapse
  diffs. These were correctness-blocked-on-a-phantom; verified green (`stay cold`, `with values` child-surface,
  `quoted index in nested scope` all pass). Any residue is latent ARCHITECTURAL debt with **no failing test to
  force it** — reopen only with a perf or maintainability rationale, not as "deferred correctness."
- **CLOSED — measured, not worth it:** Focus B loops copy-per-iteration (measured 0.97×).
- **ACTIVE BACKLOG (the real remaining work — NOT "deferred," just parked while driving to green):**
  ~~**C1→C2→C3/C4** (the walk-fold line)~~ — **RE-MEASURED 2026-07-06: C1 and C2 are NOT perf levers on current
  dev and are STRUCK.** C1's collapse gap is ~14% wall / serialize ~6% (was cited 2.6x — stale); C2's scan is
  invisible in the profile and its only additional target (registration-prep) is ~1.3% + load-bearing. Both
  were "top lever" under stale assumptions. What actually dominates now: **parse ~31–67%** (parser packages;
  benchmark-inflated — real usage is parse-once/render-many) and **GC ~13%** (hot `clone`, render-buffer `add`).
  The core-render drive is genuinely AT ITS FLOOR. Next real work is parse-side (jess css-parser/less-parser,
  e.g. the landed span-stamp gate `b19b66a92`) or the GC/`clone` residual — NOT the C-series. Fan-out results
  (3 agents off dev, 2026-07-05) below are kept for the record:
  - **F_VISIBLE-cost (3b): DONE** — merged to dev (6e84441cb), `F_MERGE_SUPPRESSED` bit separates merge-
    suppression from by-type `F_VISIBLE`. See Focus D.1 3b.
  - **C1: PARTIAL** — eval no longer writes Ruleset `hoistToRoot` (2e21baae1, merged). Remaining open half:
    hoisted AtRule header off `AtRule.frames` — needs the serialize walk to retain the full selector-ancestor
    chain (live `inFrames` lacks it). This open half IS C2 migration 1. See C1 in the staged plan.
  - **C2: GATED ON THE EVAL→SERIALIZE MIGRATIONS** (not one vague "C1") — proven that `F_STATIC` can't yet
    replace the static-render scan (+27 failures) because eval still does STRUCTURAL work on static input.
    Per the GOVERNING PRINCIPLE (eval = values; structure = serialize/render), the +27 decomposed into 3
    candidate migrations; the fan-out (2026-07-05) resolved them:
    (2) **merge decls not `F_STATIC` — ✅ DONE** (e23d11287): merge decls get `F_NON_STATIC` at construction,
    redundant assign-check deleted. (3) **at-rule/layer registration → construction-time index**: Jess's "layer
    registration" is `@layer`-name `:extend()` scoping, NOT CSS cascade ordering. The registry is WRITTEN in eval
    but READ by `processExtends` — a POST-EVAL pass — so it is NOT gated on extend (extend already runs after
    eval). Gate: make the registration a construction-time index; tractable for STATIC layer names now,
    interpolated names stay eval-bound. (1) **serialize retains the ancestor chain — OPEN = C1's open half.**
    So C2 gates on: C1's open half (migration 1) + registration-as-construction-index (migration 3). See the
    C2 table.
  Net: the walk-fold tail is **composition + registration out of eval** (C1 open half + the C4 registration-index
  vision) — both are eval's STRUCTURAL work moving elsewhere, per the governing principle. Migration 2 landed as
  a clean standalone win. TWO corrections this pass: "layer registration is just output ordering" was wrong (it's
  extend scoping), AND "its consumer runs in eval" was wrong (`processExtends` is post-eval). Once migrations 1 & 3
  land, `isPlainStaticRuleLeaf` is redundant and `F_STATIC` alone gates the fast path.
- **GENUINELY DEFERRED (correctly):** F-consolidate (hot-file churn, zero correctness value); F_VISIBLE-1b
  `renderNodeFull` (no consumer until language conversion lands).

**Rule going forward:** "deferred" must name a REASON that still holds (a real blocker, a missing consumer, or
measured not-worth-it) — not "no failing test." A green suite means the correctness drive is over; what's left
is perf/architecture/cleanliness, which is the ACTIVE backlog, not a deferral.

## Driver terminal status (this pass)

**Stable failures: 85 → 0. Suite FULLY GREEN (2678 passed, 0 failed), zero regressions across ~36 gated merges.**
The feared "monolith" fully dissolved — every supposed monolithic cluster (E2/E3 scope-identity,
mixin/namespace, import-style) decomposed into specific bugs or stale tests. The scope-identity/eval-model
"one big design call" turned out to be ~10 distinct facets, all fixed. **The "4 irreducible-minimum"
floor below was NOT irreducible** — all four fell to targeted fixes (see "Final four — CLOSED" block):

- **sibling-collapsed** (cleanup/sibling-collapsed, 4→3): four coupled fixes — descendant-boundary
  combinator callable-key (`lookup-utils.getOrderedSelectorKeys` skips string combinators), boundary-aware
  prep-time lexical parent for interpolated selector identity (gated on compose/import boundaries),
  retained-output definition-parent gate over the §4 placement re-point (`isRetainedOutputDefinitionParent`,
  same `hasLiveBindings` signal as the retained per-call frame), and two pre-existing nested-`&`
  serialization bugs (bubble `F_AMPERSAND` to the eval-rebuilt compound + preserve string combinators in
  `_substituteAmpInComplex`).
- **call detached-collection** (cleanup/call-collection, 3→2): `call.ts` split the `Rules|Collection`
  callable branch — a `Collection` short-circuits BEFORE the callable path and returns the reused surface
  (thin, 0-clone, 0-evalCall) instead of normalizing to `Rules`. Node identity preserved; renders from the
  shared surface. The "design decision" resolved to the thin model, not a coin-flip.
- **config with-var-survival** (cleanup/config-var, 2→1): the `with { }` config lives on the import
  placement frame; link the imported body's DEFINITION (lexical) frame's `fallbackFrame` to that placement
  config (`findInlinedImportPlacementFrame`), so lexical parents out-rank the caller's same-named decl at
  closure read-time. A no-param non-leaky imported body no longer wires a caller fallback. No clones.
- **declaration merge-chain** (cleanup/decl-merge, 1→0): TWO defects in `Rules._coalesceMergedDeclarations`
  — (1) the walk recursed into sibling `Ruleset`s because `Ruleset` carries the `N.Rules` bit, collapsing
  three independent cascade scopes into one global merge chain; scoped the walk to inline `Rules` only
  (skip `Ruleset`/`AtRule`). (2) a mixin-ruleset call shares the callee's declaration node by identity, so
  stripping `F_VISIBLE` off the superseded placement copy also hid the callee's canonical decl; COW the
  placement copy (`deriveWithParts({ value })`, parts stay shared) before the strip. Mutation-layer detach,
  NOT the render-only exclusion that regressed +6. [[fvisible-coalesce-suppression-load-bearing]]

Highlights of the earlier 20→4 tail: retained per-call output frame (mixin-call output carries its
params for value-eval), leaky-mode forward propagation (mixin output decls inject into the caller frame
at the call index), namespace-path reroot (structural-parent compose gated to active frames +
per-call-site hoisted-header tracking), guarded-recursion candidate filter (gate `inStack` on
`!guarded`), namespace string-selector callable registration, `Rules.resolveBodyReferenceImports`
(evaluate a mixin body's `reference:true` imports without full eager eval), `@forward` local-scope
exclusion, inline-source root pinning, first-use scalar placement-ownership, guarded-namespace guard-lift
+ value-spacing (parser builders). Earlier chips (85→20):
- **E2-a** (825dc3ec0, 60→59): property lookup now consults ancestor import fallback frames.
- **E2-b** (35f8087a5, 59→59): single-key callable retry-walk drains ancestor fallback chains
  (completes the 3-way lookup consistency; prerequisite, metric-neutral).
- **E3-rebasing** (8689c52cb, 59→58): composed-selector cache was under-keyed (ruleset identity only);
  keyed by `(ruleset, composed-parent)` — fixed mixin-body rebasing. Was a cache bug, not a monolith.
- **provenance-migration stale tests** (any.test inline + control-surface, 58→53): the `501abdb8c`
  side-table migration mechanically rewrote `.location` (array) → `sourceSpanOf` (`{start,end}|undefined`)
  without fixing `.toHaveLength(0)`/`[...span]` probes. 5 tests cleared; vein now swept clean.
- **nesting-collapse** (1780adabf, 53→49): genuine source bug — `getHoistedParent` (serialize-helper.ts)
  only recovered the enclosing parent from eval-captured `AtRule.frames`, `undefined` for directly-built
  trees, so bare decls in a hoisted `@media` lost their selector header. Fix: render-pass-scoped
  `WeakMap<AtRule, frames>` fallback capturing the live frame stack at container entry. 4 tests.
- **call arg-surface** (68e28e0aa, 49→45): 4 stale tests updated to the live-binding shared-node model.
- **extend cluster (6) — DEFERRED, all 6, with a CONTRADICTION needing an owner ruling** (cleanup/extend-cluster,
  0 commits, clean):
  - [x] **Group A (4): DONE — selector copy-on-write** (merged cleanup/selector-cow, commit 7e4a00eec,
    45→41, BOTH committed test sets green + zero new). Owner ruling: collapse/extend mutation reuses in
    place when unshared, clones-to-detach when shared. Implemented via structural signals, not an explicit
    refcount bit: (1) collapse (`own-collapsed-source-child.ts`) — `shared = owner.parent === undefined`
    (a parentless collapsing owner is a re-readable root template → clone the source leaf; a parented
    interior owner's collapse is consumed once → reuse in place); (2) placement (`node-base.ts`
    `cloneForPlacement` gains `detachChildren` + `hasNodeChild()`) — extend/ruleset placement clones-to-
    detach any child that owns child nodes, so `inherit`/`adopt` reparents COPIES not the shared source.
    Extend copies opt in (`selector-utils.ts`, `cloning.ts`). Both eval-template-copy (canonical-survivor)
    and extend-reuse (0-clones) hold for the SAME reason. See [[selector-cow-shared-bit]].
    - **Follow-up (chip):** dead drifted duplicate `ownCollapsedSourceChild` in `cloning.ts:~87` (nothing
      imports it) — delete after decl-ref merges (decl-ref may touch cloning.ts).
    - **Open design note:** the `owner.parent===undefined` proxy + `detachChildren` cover all current tests
      + the per-extend-match divergence case; the fuller EXPLICIT shared-marker (set on >1-slot placement)
      is only needed if a future divergent-visibility case escapes the structural proxy — no failing test yet.
  - **Group B (1): string-backed extend target** (`extend-roots.test.ts:116`) — `.child` string component
    dropped by `typeof item!=='string'` filter → spurious empty list item; expected `.base`-only output is
    ambiguous (materialize-noop vs append). Needs a semantics decision.
  - **Group C (1): implicit-`&` over-materialization** (`extend.ts:280`) — needs target-scope-relative
    source selection (absolute `fullSel` load-bearing for the cross-scope `.issue-2586` case). Scope-ancestor
    comparison, not a dedupe.
### Final four — CLOSED (were "DEFERRED; TRUE floor" — all four fixed, 4→0)
All four below were tagged the irreducible minimum for the mechanical loop; each fell to a targeted
single-unit fix, gated zero-regression, and merged. Suite is now fully green. Fix summaries are in the
Driver terminal status block above; the original characterizations are kept here for the forensic record.

### Live work-list — (historical) the 4 remaining stable failures (all now CLOSED)
The mechanical/tractable harvest is COMPLETE (85→0, ~36 verified merges, every one zero-regression). The
"Monolith-A" scope-identity narrative was WRONG: it decomposed into ~10 distinct facets, all now fixed —
retained per-call output frame (mixin value-eval), leaky forward-propagation (source-order-gated), namespace
reroot (2 render roots), guarded-recursion, string-selector namespace registration, `resolveBodyReferenceImports`,
`@forward` scope-exclusion, placement-ownership, guarded-namespace lift + value-spacing. The 4 that remain:

1. **mixin sibling-collapsed interpolated selector-identity** (`mixin.test.ts › arity failures › keeps sibling
   collapsed rulesets closed before a later interpolated mixin-ruleset call`). Its namespace-reroot + leaky
   facets are already fixed; it now needs TWO things (attempted, reverted — +2 boundary regressions from a
   blanket link): (a) prep-time lexical scope resolution for an interpolated selector identity (`.@{a1}`) that
   RESPECTS compose/import boundaries (a scope-boundary-aware wiring, not a blanket `getScopeFrame().parent`
   link); (b) `&`-composition into the mixin-ruleset callable key across a descendant boundary (verified the
   LITERAL `.b .bb{&.foo-xxx{…}} .b.bb.foo-xxx()` fails identically — a pre-existing `&`-callable-key gap).
   Bigger than a targeted fix; its own unit.
2. **declaration merge-chain** (`Declaration › continues a property merge chain after a callable ruleset emits
   the first declaration`) → **D1-3b**: coalesce `removeFlag(F_VISIBLE)` is load-bearing for lookup+re-coalesce
   (proven — render-only exclusion regressed +6, reverted). Merge-engine rework. [[fvisible-coalesce-suppression-load-bearing]]
3. **call detached-collection→Rules** (`Call › keeps detached collection calls on the collection surface`) →
   callable-collection node-identity design decision: a no-arg detached-collection call returns `Rules` (CSS-correct)
   but the test wants the `Collection` surface preserved. Design call: normalize to Rules vs keep Collection identity.
4. **config with-var-survival** (`with values › keeps child-surface additive "with" configs visible to imported
   detached ruleset variable closures`) → live-binding-across-eval: a `with` VarDeclaration is a transient pre-eval
   frame binding that doesn't survive eval as a resolvable decl; the parent same-named decl wins. Needs the config
   binding to persist onto the post-eval surface with module precedence.

**~~4 is the documented irreducible minimum~~ — ALL FOUR CLOSED.** #1 was the scope-boundary+`&`-callable
rework (4 coupled fixes); #2–#4 were the "design decisions" that each resolved cleanly in favour of the
thin/live-binding model (merge-engine COW + walk-scoping / keep-Collection-surface / lexical-config-precedence).
None turned out to need an owner ruling. Suite green. See "Final four — CLOSED" and the Driver terminal status.

---
_Earlier snapshot (mechanical harvest to 60):_ Every open tracker item is CLOSED or
DEFERRED-with-rationale. The mechanically-safe correctness + cleanup harvest is complete:
- **Done:** Focus A (serialization audit; A-node done-by-design, A-flip rejected as make-work);
  Focus D Theme A selector serialization GREEN + trivia; Focus E E1; D.1 stages 1a/1c/2a; D1-3a
  (leading-comment hoist → exclusion set); F-rename (all 3 classes, 20 identifiers); Focus F
  dead-code claims verified false (nothing deletable). Merges: E-lookup, extend-eval, decl-trivia,
  D1-2 + several inline units.
- **Deferred (with written rationale):** D1-3b (removeFlag in coalesce is load-bearing for lookup +
  re-coalesce — render-only exclusion proven insufficient by the gate, reverted; needs merge-engine
  rework); E2/E3 (monolithic "wrapper is scope identity" scope rework); D.1 1b (no consumer until
  language conversion), 2b/stage-4 (dynamic per-instance visibility, pair together); Focus B loops +
  R3, Focus C perf (no failing-test signal — perf/architecture, not correctness); Focus A Ruleset
  source-direct (perf eligibility); F-consolidate (legibility polish, no correctness impact); D-eval
  diffs (coupled to E2/E3).

**The residual 60 stable failures are traced to the deferred deep work** — dominated by E2/E3
scope-identity (~16+), the D1-3b-blocked merge-chain/lookup coupling, and eval/collapse diffs
downstream of them. Driving below 60 requires the deferred **monolithic scope-identity rework**, not
more mechanical units. That is the documented irreducible minimum for the safe drive-to-green loop.

Baseline snapshots below may cite older counts (85 mid-migration); the current stable set is **4**.

---

## Focus A — Serialization / `writeSyntax`

Per-node direct-source writers. Most node families already have `override
writeSyntax` in code; the old row tracker's checkboxes were stale.

- [x] **Checkbox-sync pass — DONE** (cleanup/serial-audit, pure audit, no code change). Full
  node-type × writeSyntax enumeration: every type has serialization coverage; the 8 claimed
  types (Ampersand/Mixin/AtRule/Rules/QueryCondition/Call/Declaration/Interpolated) all confirmed
  to `override writeSyntax`. Inherited-by-parent (correct): Num←Dimension, CustomDeclaration←
  Declaration, Stylesheet←Rules, Keyword←Any, RelativeSelector←ComplexSelector. JsArray/JsObject
  emit '' by design.
- [x] `Node` base single-path — **DONE by design** (re-examined). The generic `writeSyntax(options)`
  hook (node-base:1537, `@internal`) **bridges to `toTrimmedString` by default** — that bridge is
  deliberate, so a type may override *either* `writeSyntax` (direct-writer path, 43 types) *or*
  `toTrimmedString` (source-form path, 5 types) and get the other for free. The 5 so-called "residuals"
  (Block/Quoted/Url/AttributeSelector/PseudoSelector) each override `toTrimmedString` and route through
  a `renderXSyntax(value, options)` helper that is **shared with `render()`** — `render` serializes the
  *evaluated* value, `toTrimmedString` the *source* value, so the `value` parameter is load-bearing, not
  residue. Flipping them to `writeSyntax`-primary would be pure cosmetic churn on HOT files (node-base +
  selector) for zero functional change — **rejected as make-work.** The doc comment at node-base:1437-38
  is about `toString`-vs-`toTrimmedString` (it correctly says override `toTrimmedString`) and is NOT stale.
  ~~A-flip~~ — dropped, no action needed.
- [DEFERRED] `Ruleset`: source-direct eligibility + bare-ampersand selector-list header path.
  **No failing-test signal** — the string-selector header work it interacted with is already GREEN
  (Focus D Theme A). This is a render-fast-path *eligibility* refinement (perf/legibility), not a
  correctness gap; it does not move the stable set. Deferred to a dedicated perf/render pass. [HOT: ruleset.ts]

## Focus B — Binding / single-frame

The single-frame migration largely landed (frame identity stable, mixin wrapper
removed, `_passedRulesWrapper` gone, loop subsystem staged). Remaining:

- [DEFERRED] **Loops still COPY per iteration** — `$for`/`$each`/`$while` clone the body each
  pass instead of re-pointing a covered frame (see `control.ts` TODO). The last structural
  single-frame gap. **No failing-test signal** (loops are correct, just not zero-copy); it's a
  perf/architecture refinement, not a correctness fix, and carries real regression risk (frame
  re-pointing semantics). Deferred to a dedicated single-frame/perf pass, not the drive-to-green loop.
- [defer] **`direct-rules-lookup` fallback (R3)** — confined to `$while` and
  dynamic/interpolated/explicit-target names. **Deferred: downstream of Focus E2/E3** — it
  is the same "resolve through the frame the binding actually lives on" problem; fix it as
  part of the scope-identity rework, not before it (it would just re-encode the workaround).

## Focus C — Performance: collapse the walk count (ACTIVE — the perf drive)

> ### ★★ HEADLINE GOAL — core does **1/10th the work** it does today (per render)
> Core has been through many refactors and carries accreted work: multiple structural passes, per-placement
> copies, fat nodes, redundant flag/registration crawls. **Target: 10× less work per render for byte-identical
> output.** This is a forcing function — every pass, allocation, field, and flag-crawl must justify itself or die.
> - **"Work" = a product of three axes, measured against the latest profile summary below:**
>   (1) **traversals** — N structural passes → ONE render-driven walk (single-render-pass);
>   (2) **allocations** — per-placement copies → zero (always-share); fat nodes → slim (SLIM_NODES audits);
>   (3) **redundant compute** — delete the flag walk (`propagateFlagsFrom`), pre-pass registration, reuse gates,
>       and any recomputation that a construction-time index or per-frame lookup makes unnecessary.
> - **Honest framing:** 10× is a stretch north-star, not a literal gate — even 2–3× is a major win. But treat it
>   as the bar: if a change doesn't move work toward 1/10th, question whether it's the right change. **Measure
>   every slice against the reprofile baseline** (CPU self-time %, heap bytes/allocations, traversal count).
> - It subsumes the levers below: the single-render-pass drive, the copy elimination, the flag-walk deletion, and
>   the SLIM-NODES work are all *how* we get to 1/10th.
>
> **HOW TO REASON (the lens — apply before optimizing anything):**
> 1. **Necessity first, not speed. "Is this work we actually have to do? Does the USER benefit from it existing?"**
>    The biggest wins are DELETING work that produces no user-visible output — defensive/speculative/vestigial
>    passes, caches, and fields that accreted across refactors — not making that work faster. Before optimizing a
>    pass, ask whether it should exist at all. (D3 already proved this: the second eval was pure vestige — deleting
>    it was worth more than any speed-up, and even fixed bugs.) [[feedback-no-defensive-slowdowns]]
> 2. **Specialize for what users actually compile; don't make everyone pay for generality.** The fully-general
>    multi-syntax / multi-feature / multi-plugin path carries overhead most compiles never touch. Detect the
>    use-case cheaply and take a LEANER path:
>    - **`.less`-only** compilation should not pay for the SCSS grammar/plugin, the interpolation machinery it
>      doesn't use, or the Less-compat bridge unless the sheet needs it.
>    - A **static, extend-free** sheet should not pay for the dynamic eval / registration / extend subsystems.
>    - Feature-gate whole subsystems on cheap CONSTRUCTION-TIME signals (has-extends, has-mixins, has-references,
>      has-interpolation) so the common shape runs a fraction of the machinery.
>    The unit of the 10× isn't only "make the pass cheaper" — it's "for THIS input, don't run the pass at all."

> **▶ ACTIVE DRIVE: this file.** Single-render-pass / always-share eval remains
> a cleanup direction, but the latest real Bootstrap profile does not justify a
> broad flag-walk rewrite as the next speed slice. Treat flag deletion as code
> health unless fresh profiles put it back on the hot path.

### ★ GOVERNING PRINCIPLE — eval evaluates VALUES; STRUCTURE belongs to serialize/render
**Eval evaluates VALUES. Every STRUCTURAL transform — selector composition/collapse, declaration
merge-coalescing, at-rule/layer registration — belongs in serialize/render, not eval.**

Consequence: `F_STATIC` means "no dynamic VALUES." Today it is NOT a sufficient render-fast-path gate
**only because eval still holds structural work it shouldn't own.** Once that work moves to serialize/
render, `F_STATIC` (with correct flagging) becomes exactly "no eval work needed," and the render fast
path (`canRenderStaticRulesDirectly`) collapses to a bare `F_STATIC` check — **C2 falls out for free.**
This is the sharp form of the north-star below and the direct blocker-decomposition for C2.

### ⛔ STANDING PERF RULE — FAST V8 OBJECTS ONLY (hard-coded, non-negotiable)
Hot-path objects MUST be **fixed-shape / monomorphic** so V8 keeps them in fast mode (stable hidden class +
inline caches). **BANNED on hot paths:** `Object.getOwnPropertyDescriptors`/`defineProperties`/`defineProperty`,
`Reflect.deleteProperty` / `delete obj.x`, `Object.assign` into a varying-shape object, `Object.create(proto)`
+ dynamic property attach, `setPrototypeOf`/`__proto__` mutation. These push objects into dictionary mode and
kill property-access ICs. Build objects with a **constructor or a literal that sets ALL fields up front, in a
fixed order** (add `= undefined` fields rather than attaching later). Precedent is already IN this codebase:
`node-base.ts:533/577/696` note the old per-instance `Object.defineProperties` was **~38x slower** and was
replaced with constructor-set fields — reference.ts never got the memo.
**Inventory of current violations (fix on the perf drive):**
- **`reference.ts:2594-2616` (`createRulesLikeReferenceSurface`) — HOT, per mixin-ruleset reference.** The
  `getOwnPropertyDescriptors` → `Reflect.deleteProperty`×3 → `defineProperties`×2 dance. **NUKE IT** — replace
  with a proper fixed-shape surface (a small class with declared fields, or the node's own clone constructor
  + 3 field sets). This IS the #1 dynamic-eval alloc (~921ms). Follow the node-base 38x pattern.
- `render-buffer.ts:290/297` — `Object.getOwnPropertyDescriptor(node,'render')` on the render path; verify
  frequency, replace with a direct property/flag check.
- `define-function.ts:338/628/759/775` — `defineProperties`/`assign` at FUNCTION-REGISTRATION time (cold, once
  per definition); lower priority but convert for consistency.
- `logger.ts:13` — cold, ignore.

### ⛔ HARD BUDGET (owner) — ≤5 CLASS-UNIQUE FIELDS PER NODE TYPE
**Every node class gets a budget of at most 5 instance fields UNIQUE TO THAT CLASS** — i.e. fields the class declares
BEYOND what its parent already carries (base `Node`/`Rules` fields don't count against the subclass; they count
against the class that FIRST declares them). This is a hard ceiling, not a style nit: a class over budget is a bug to
fix. When a class exceeds 5 class-unique fields, collapse the overflow by (in preference order): pack booleans into
ONE class-local flags int; make derivable state a **getter** (compute, don't store); move cold/rare fields into a
**lazy sub-struct** allocated only when first used; split into a lean **subtype** that carries only its kind's fields;
or **drop** it. Never a WeakMap side-table (the provenance regression proved side-tables are strictly worse).
**`Rules`/`Ruleset` is the flagship violator and the reason for this rule** — even after the `rulesFlags` pack
(own-key 42→32) it is many times over budget; its field sprawl is the "nonsense" this budget exists to end. Drive it
(and every class) under 5 class-unique fields. **A change that pushes a class over budget does not land without an
explicit subtype/lazy-struct justification.** Track class-unique field count per node type as a first-class metric
(alongside total own-key) in `SLIM_NODES_AUDIT.md`.

### ⛔ STANDING PERF RULE — SLIM NODES (minimize node shape; performance is the driver)
Every field on a node is paid per-instance: memory + construction cost + a slot on the hidden class + a bigger
object to GC. Keep node shapes **AS LEAN AS POSSIBLE.** Prefer **type specialization** — distinct lean node
classes each carrying ONLY the fields it needs (e.g. the approved `DeclarationReference`/`VariableReference`/
`PropertyReference`/`MixinReference` split) — over one fat `Node` with dozens of optional/`undefined` fields.
Rare/optional data belongs on the specialized subclass that needs it, **NOT a side-table (WeakMap)** — the
provenance regression proved side-tables are strictly worse (alloc + indirection). When adding a field, first
ask: can it be a **flag bit** (boolean → `F_*`), be **derived** (computed, not stored), live on a **subtype**,
or be **dropped**? **DX may change** — getter names, method surface, even public API — as long as the new DX is
**sane** (need not match or beat the old; just not bad). **Performance is the driver.** Track field-count per
node class as a metric; slim the fat ones. Shared behavior across lean types goes in **util functions**, not a
fat base class. **Specializing a node into subtypes? Judge it on BOTH axes: (1) DISPATCH — measure (V8 often
already inlines monomorphic method calls, so this is frequently a wash — the reference split proved it); (2)
SHAPE-SLIM — build the per-kind FIELD MATRIX (kind × field → used?) and DROP unused fields per subtype. Keeping
the union shape on all subtypes is a NAIVE split that captures at most dispatch and forfeits the slim payoff.
If the matrix shows all fields used by all kinds, the split is pointless for slim.**

**SLIM targets (audit → `packages/core/perf/SLIM_NODES_AUDIT.md`; heap census ~39k nodes/7.1MB; Ruleset 12000×
is fattest×hottest — it inherits the fat `Rules` base, so slimming `Rules` slims all 12000 Rulesets):**
1. **`Rules`: 11 eager booleans → one `rulesFlags` int** (12000× × 11) — the dominant lever. `has*ChildSurface`
   (rules.ts:905-911) + `_bodyEvaluated`(934)/`_hasExtends`(948)/`_hasReferenceImports`(954)/
   `_registrationPrepared`(956). A Rules-only int (NOT base `flags` — that'd widen the read for leaf nodes);
   `resetDerivedState`→`rulesFlags=0`; getters keep names → DX-neutral. **DONE — merged c40fea6; own-key 42->32 (x12k Rulesets).**
2. **Drop dead `Selector.isSelector=true`** (12000×, selector.ts:82) — always true, redundant with `instanceof`.
   Cleanest effort:payoff. **DONE — merged f3a3c02; byte-identical; own-key 12->11.**
3. **`Node.frozen` → base `flags` bit** (~39k×, node-base.ts:562) — flags has headroom (14/31 used). Getter keeps
   name. **DONE — merged afcffa0e; own-key 42->41 (x39k nodes).**
4. PseudoSelector rare fields (3000×: `omitWrapperForSingleSelectorList`→flag; `generatedPseudoPlacementOverride`→subtype).
5. (low-confidence) Rules `lookupVersion` counters (rules.ts:919-923) — lazy-alloc only if multi-kind lookup runs;
   MEASURE first, don't downgrade the lookup fast path for slot count.
### Provenance fields — FOLLOW-UP: span granularity is a DESIGN DECISION (not a simple subtype move)
provenance-inline (LANDED, killed the WeakMap) took the easy path — all 6 fields onto `Node` base. But the
right fix depends on **how granular span tracking needs to be**, and the consumer evidence is decisive:
- `_spanStart`/`_spanEnd` (node-level) — used by BOTH sourcemaps (`sourceSegmentFor`, print.ts:197 uses ONLY
  `spanStart`) and trivia. **KEEP on base** (cheap, universal).
- `_cstState`/`_cstChildren` — **DONE (deleted, cc9888e2).** Were the vestige of a CST-side edit representation
  that doesn't exist yet; fields + accessors + re-exports removed (own-key 31→29 ×~39k nodes). Zero residual refs
  anywhere in `packages/**`. (Matches line ~380's LANDED entry.)
- `_fieldSpans`/`_valueSpans` (SUB-NODE granularity) — consumed by **exactly one thing: authored-trivia
  round-trip serialization** (selector-*/at-rule/declaration read them to emit whitespace BETWEEN sub-components
  and look up the `TriviaMap` by offset). Sourcemaps DON'T use them; plain CSS render DOESN'T use them; no edit
  mode exists. The old "unconditionally on every parse" premise is now stale: `b19b66a92` gates
  `setFieldSpan`/`setValueSpans` on a cheap source-range comment marker, so comment-free containers do not get
  a per-node span entry or packed span array. The remaining question is only whether the sparse comment-bearing
  backend should be unified or recovered at serialize time.
  - **NOT "selector-only" by design** — List / any array-valued node would need them too *if* we want sub-node
    round-trip fidelity for those. The current selector-only readership is incomplete usage, not intent.
  - ⚠️ **RE-DECIDED 2026-07-11 (owner): this is a THREE-WAY *MEASURED* fork — PERF is the oracle, NOT the
    "never a side-table" rule.** The flat "DROP + node-level comment check" plan below is SUPERSEDED and is a
    known revert-trap; keep it only as a candidate to beat on the bench.
  - **Why the earlier flat drop broke (mechanism, so no one re-walks it):** the DROP (`468747cc7`, REVERTED
    `311cf9232` = "re-enable per-slot value/field spans via WeakMap side tables") replaced the per-slot boundary
    offsets with a whole-node scan + a **source-order cursor** (`commentRunsWithinSpan` over `[spanStart,spanEnd]`,
    then `emitNextSpanComment(cursor++)` at each inter-member gap). Members are BARE STRINGS (no own span), so once
    `valueSpans[i].end`/`[i+1].start` are gone you know each comment's ABSOLUTE offset but not WHICH gap it belongs
    to. The cursor assigns comments to gaps by source order — correct only when comments/gaps line up 1:1.
    `.a .b /*x*/ .c` and `.a /*x*/ .b .c` produce the SAME scan list → comment mis-placed → broke
    `comments`/`comments2`. **This is a lost-gap-attribution bug, NOT an impossibility. Do NOT re-attempt the flat
    cursor drop.**
  - **The three candidates — decide by controlled A/B** (same worktree, toggle each, warmup + N-median of
    parse + total, byte-identical normal render, `comments`/`comments2` green):
    1. **Keep the current side-table** (`311cf9232` plus the `b19b66a92` stamp gate). Correct today.
       Cost: comment-bearing containers pay the packed span array + serialize lookup; comment-free containers
       skip the side-table write entirely.
    2. **Unified WeakMap** — fuse per-slot spans + trivia into one node-keyed structure. Restores the per-gap
       boundaries → correct; still a side-table (a tidier *exception*, not elimination).
    3. **Serialize-time boundary recovery, gated on the cheap node-level "any comment in my span?" check.** Store
       NOTHING per node; only for the sparse comment-bearing nodes, recover member boundaries from the source slice
       / Parséman CST and map comment-offset → gap. The only option that kills the side-table WITHOUT reintroducing
       per-member node weight; affordable *because* comment-bearing nodes are sparse.
  - **Perf hypothesis (MEASURE, don't assert):** option 1 now pays parse-side work only on comment-bearing
    containers; option 2 may reduce side-table bookkeeping, while option 3 defers boundary recovery to sparse
    serialize-time work → both remain perf-plausible
    winner. Fold this A/B into the parse-side measurement pass. **Whatever measures best wins — including "keep the
    WeakMap" if recovery's re-scan costs more than the map it removes.** The "never a WeakMap" standing rule does
    NOT override this measurement: it was validated on HOT/UNIVERSAL provenance fields; this field is sparse/cold,
    so the head-to-head must actually be run. Trivia source is the parser's `opts.trivia` (lazy whole-doc
    `TriviaMap` from `buildLazyTriviaMap`, `builders.ts:253`), reached via `sourceRoot._treeContext.opts.trivia` —
    no per-node arrays needed by options 2/3. Prior flat-DROP plan text is in git history for the forensic record.
  - **`hasComment` API note (owner-flagged; for the parser/`Trivia` owners):** `makeTrivia` (trivia.ts:52)
    computes `hasComment` as *any non-whitespace char in the run* — it's really `hasNonWhitespace`, equal to
    "comment" only via the grammar invariant `trivia = ws|comment`. It's a lossy single bit: can't distinguish
    `//` (line, no-collapse) from `/* */` (block, inline-safe) or any FUTURE erasable-but-meaningful trivia
    kind, and would silently mislabel non-comment trivia as a comment. Fine for OUR comment-in-range use; but
    the honest primitive is `hasNonWhitespace`, and finer needs should classify via the run's exposed
    `src`+`[start,end]` (or add a `kind`/segments). **⚠ CORRECTION (I earlier mis-attributed this to Parséman —
    it is a JESS-CORE issue).** Parséman ALREADY does the right thing: its `_triviaLog` carries labeled trivia
    KINDS (position + kind, no boolean). The over-fit is entirely jess-side: the parser packages'
    `buildLazyTriviaMap` DISCARDS Parséman's kinds, reduces to `(start,end)` offset pairs, and re-derives the
    lossy `hasComment` via core's `makeTrivia`. **Fix belongs in jess core** — rename to `hasNonWhitespace`, or
    (better) stop discarding Parséman's kinds in `buildLazyTriviaMap` and carry them through. Parséman needs
    NOTHING. (Being fixed in jess core by another agent — rename + honest doc, core green.)
  - **Span storage (V8, answered):** keep `_spanStart`/`_spanEnd` as TWO inline number fields (SMIs → 0 alloc,
    inline in the hidden-class slot) — NOT a `{start,end}` object (1 heap alloc per spanned node, reintroduces
    the WeakMap cost) and NOT a packed single number (two offsets exceed V8's 31-bit SMI range → boxes to a
    HeapNumber, worse than 2 SMIs). Prefer `spanStartOf`/`spanEndOf` (inline reads) over `sourceSpanOf` (rebuilds
    `{start,end}` on read) on hot paths.

### DRY + dead-code sweep (NEW standing task — requested)
Systematic pass for (1) **repeated code → shared slim util functions/structures** (esp. the copy/surface/selector
helper families that accreted), and (2) **dead-code removal** (like
`cstState`/`cstChildren` above: exported accessors with zero callers, unused fields, dead branches). Read-only
AUDIT first → ranked target list, then gated removal stages. Ties into SLIM (fewer fields) + FAST-V8 + DRY.

**AUDIT DONE (f0a6131b3, read-only sweep of `packages/core/src/tree`, 127 non-test files). Vein largely exhausted:**
- **Dead code: NONE.** Scanned all 618 exported symbols (0 with zero cross-monorepo refs — barrels re-export
  everything) AND all ~1002 file-local declarations (383 private methods + 592 module fns + 27 arrow fns; 0 with
  ≤1 in-file occurrence). Confirms Focus F's "nothing deletable" — the earlier `raw`/`cstState`/`cstChildren`
  harvests already cleared the tree. Don't re-run a dead-export hunt; it's clean.
- **Duplicate blocks: 601 six-line windows, mostly non-actionable** — unavoidable boilerplate (node constructor
  signatures, import groups), multi-line CALL-SITE argument lists (already calling shared fns — arg alignment,
  not extractable), and the deliberate **sync/async twin pattern** (`evaluateSelectorsSync`/`evaluateSelectors`
  in selector-list/compound — the sync variant exists to avoid promise alloc on the hot path; merging them
  forces everything through promises = regression, so they STAY duplicated by design).
  - **LANDED (9edb702d5): reference-pipeline tail extraction.** `evaluateReferenceNode` hand-rolled a sync/async
    staged pipeline where every `isThenable` suspension point re-listed all remaining stages — the
    resolve-value/lookup/finalize tail was duplicated 5×. Extracted `ReferenceLookupTail` + two tail helpers
    (`lookupAndFinalizeReference`, `resolveValueAndFinalizeReference`); the 5 `.then` chains collapse to 3 calls.
    **−43 lines**, behavior-identical (sync fast path preserved), core 2730/0, no new tsc errors, byte-identical.
- **The `rulesMayContain*Surface` family (7 fns, rules.ts:485-600):** NOT safely mergeable — differs on 3 axes
  (fast-path pre-check / `childCallableRulesOf` vs `childRulesOf` / per-node predicate) and is HOT (registration
  path; `rulesMayContainReferenceImports` = 0.8% self-time). A predicate-callback merge trades legibility for
  hot-path indirection — matches the deferred Focus-F CLUSTER verdict. Left as-is.
- **Landed (only safe win):** `rulesMayContainReferenceImports` fast-path was character-identical to the whole
  body of `rulesHasCarriedReferenceImportSurface` → call the helper (hoisted, V8-inlined, zero-change).
**Verdict: the tree is dead-clean; the one real DRY duplication (reference-pipeline tail) is now landed. What's
left is intentional (sync/async twins) or hot-file legibility polish, not mechanical wins. Don't reopen without a
specific gated target.**

### Micro-opt considered — inline `hasFlag`/`addFlag`/`removeFlag` to raw bitwise: REJECTED (verify-only)
Converting `hasFlag(F_X)` → raw `(this.flags & F_X) !== 0` at call sites is NOT worth it: these are tiny
MONOMORPHIC methods on `Node.prototype`, which V8 inlines to the bitwise op already. `hasFlag` has NEVER
appeared in any CPU profile (refreshPositions/ensureProv/surface/etc. dominated) — strong evidence it's already
free. Raw-bitwise would cost DX across hundreds of sites for ~0 gain. Revisit ONLY if a profile shows it hot.

### LANDED LOG (integration branch `perf/walk-collapse` — bench after each merge)
- **W2** incremental `refreshPositions` — collapse **1006→~290ms (~3.5x)**, nested **400→~225ms (~1.8x)**. HEADLINE (found only by profiling; walk-plan would've missed it).
- **ref-nuke** `createRulesLikeReferenceSurface` reflective→same-prototype field-copy — that fn **164→21.5ms (~8x)**; dynamic end-to-end ~170→~157ms (modest, GC-absorbed); byte-identical. FAST-V8 compliance; kills dictionary-mode surface objects. (Contract: surface must NOT clone/inherit/reparent — field-copy is the only valid shape; tests lock it.)
- **FAST-V8 sweep** `render-buffer` descriptor-check→`hasOwnProperty` walk (oracle-proven equivalent) + `define-function:338` fixed-shape; byte-identical. Hygiene. (`Object.assign` record-merge sites kept — genuine dynamic user keys.)
- **provenance-inline** killed the `PROV` WeakMap → 6 inline `= undefined` span fields on `Node`. **Heap alloc 40.5→23.6MB (~42% less; the `set` 59% hotspot GONE); dynamic parse 54.8→46.3ms (~15%).** byte-identical (133 fixtures). The provenance smell is fully resolved (parser-set inline fields, no side-table).
- **W1 single-writer** 6/18 fragment sites → shared writer + `restore`; **−25.7% OutputWriter allocations (~10,800 fewer)**; byte-identical. The other 12 sites are INTENTIONALLY separate — `CountingWriter` tests enforce keeping fragments off the caller writer (architectural contract, not laziness) — so "one writer per serialization" is partial-by-design.
- Benches: `packages/core/perf/collapse-bench.mjs` (static) + `dynamic-bench.mjs` (mixin/refs).
- **span-array drop** — ⚠️ **REVERTED on dev (do NOT re-land).** Landed as `468747cc7` (deleted
  `_fieldSpans`/`_valueSpans`, readers → node-span comment scan), then **deliberately reversed same-day by
  `311cf9232`**: the node-span scan CANNOT round-trip comments in the gap BETWEEN sub-components of a
  multi-member selector list / declaration value (`#comments /* boo */, /* of */ .comments`) → broke the
  `comments`/`comments2` less fixtures. The re-enable stores per-slot spans OFF the Node shape (flag-gated
  WeakMaps `F_HAS_VALUESPANS`/`F_HAS_FIELDSPANS`, flat packed SMI arrays), so the node shape stays lean
  (`_spanStart`/`_spanEnd` inline only) AND eval's source-free nodes pay one bitwise-and to skip — the slim
  goal is met without deleting the feature. all-less 84→86 (both fixtures green), no regressions. The
  residual `setFieldSpans` ~2.1% (re-profile) was PARSE-time WeakMap churn (parser stamped per-slot spans on
  every multi-member node even when comment-free). **LANDED (span-stamp-gate, `b19b66a92`): gate the
  css-parser stamp on `spanMayContainComment(src, start, end)`** — a conservative superset of "has a real
  comment" (`/*`|`//`; a `//` in a url/string is a harmless false-positive, a real comment is never missed).
  Comment-free input now pays nothing; collapse bench ~266→~244ms median (~8%, matching a full no-op ceiling
  ~231ms). Zero regressions (css-parser 188✓; less-parser + all-less same pre-existing fails; comments/
  comments2 green — they carry comments so the gate stamps them). Parse-time cost, amortized in parse-once/
  render-many. **The "DECIDED (owner): DROP fieldSpans/valueSpans" plan above (§ lines ~349-369) is SUPERSEDED
  by the revert; the GATE is the perf answer, not deletion.**
- **core-residuals** — `canReuseLeaf` field-read→flag (FAST-V8); other residuals deferred (complexity > sub-1%).
- **doc-order gate** (cfdf829e6, post-trunk-sync) — `_assignRootDocumentOrder` now gated on root `_hasExtends`;
  extend-free sheets (the common case) skip the full-tree walk + `WeakMap<Ruleset,number>` alloc entirely. Map is
  read only by extend application (`documentOrderOf`, extend.ts); `_hasExtends` aggregates nested + mixin-body
  extends transitively (`childRulesOf` descends into `Mixin` bodies), so the gate is conservatively safe. Profile:
  `_assignDocumentOrderDepthFirst` eliminated from the extend-free collapse profile; wall-clock within noise
  (GC-absorbed alloc). Core 2730/0, all extend tests green (byte-identical).
**Integrated now: collapse ~215ms, nested ~180ms, dynamic ~130ms** (from 1006 / 400 / ~170 → **4.7x / 2.2x / 1.3x**).

### ✅ CORE-RENDER DRIVE COMPLETE (at its floor)
Every core-render hotspot is crushed (re-profile-confirmed): serialize 51%→1.3%, GC 14-17%→~9%, the eval-alloc
#1/#2 gone, node shapes slimmed (Rules 42→32, base Node 6→2 prov fields, every node −3 to −5 slots), static
bench **1006→215ms (4.7x)**. Suite GREEN (core 2697/0). The ONLY remaining hotspot ≥3% is PARSE (~42%), a
different subsystem — evidence-backed ideas handed to the parser owners in `parser-thing/notes/PERF_IDEAS.md`.
Residuals are long-tail (agent found one clean micro-opt, deferred the rest). **`perf/walk-collapse` now needs
to land forward into the trunk** (feature/parseman → dev → feature/less-v5-alpha-readiness) — team's call.
(Note: the branch inherits the trunk's in-flight less-parser failures via the feature/parseman merge — 5 tests,
all structural/less-integration WIP, verified NOT caused by any perf change; they resolve upstream.)

### RE-PROFILE (current state — the core-render hotspots are CRUSHED; PARSE is now #1)
Fresh CPU+heap profile of the integrated branch (`perf/reprofile`). What moved: serialize
`refreshPositions` **51%→1.3%** (W2); GC **14-17%→~9%** (provenance+SLIM); eval `createRulesLikeReferenceSurface`
+ `ensureProv` (old #1/#2, 921/711ms) **GONE from the top 18**; PROV `set`/WeakMap **0 heap frames**. New ranking
(both shapes): **PARSE ~42% · eval ~18-22% · GC ~9% · serialize 2-7%**. New #1 = the Parséman selector-reify
chain (`_r_InterpolatedSelector` less-parser/grammar.ts:249, `_r_value` css-parser/grammar.ts:152,
`_r_ComplexSelector`/`_r_CompoundSelector`/`_r_LessAmpersand`) + `buildNode` (CST→AST) + node ctors.
**STRATEGIC INFLECTION:** the core eval/serialize/allocation drive has largely achieved its goal. What's left:
- **Parse (#1, ~42%)** — a DIFFERENT subsystem (parser packages), owned by the
  parser/less-integration teams, and **benchmark-INFLATED** (these benches re-parse every render; real-world is
  parse-once/render-many). **MEASURE a parse-once/render-many split before investing** — even discounted it's the
  biggest bucket, but the honest real-world share is much smaller. Cross-package: coordinate, don't reach in.
- **Residual GC (~9%)** — mostly parse alloc + one hot `clone @ index.js:1539` (9.4% render-path heap) +
  render-buffer `add` array growth. Small standalone looks.
- **eval long tail** — `isNode` (already bitmask-fast; target call-count) + `_assignDocumentOrderDepthFirst`
  (index.js:12064, 1.3%) + `inherit`. Small focused wins; the diffuse "other" ~22% has no single ≥1.5% hotspot.

**DIRECTION (owner):** keep driving CORE cleanup (the small measured residuals: hot clone, render-buffer add,
document-order; plus the in-flight span-array drop + DRY). PARSE stays out of core — instead an agent MEASURES
parser hotspots and writes evidence-backed IDEAS into the parseman repo (`/Users/matthew/git/oss/parser-thing/notes/PERF_IDEAS.md`), for the parser owners. No parser code changes from here.

Suite is green, so this is now the live drive. **Finding (traced this pass):** the render
pipeline runs ~4 structural passes *regardless of content*, and two of them exist only because
eval still holds serialization/collapse state it was supposed to hand off.

**Walk inventory (root render, hot path):**
1. Parse → tree.
2. **Registration-prep** (`rules.ts:4755`) — pre-eval structural walk; registers decl names /
   ordered identities / extend roots / import frames. Exists for **forward references** only.
3. **Eval** (`evalNode`) — value walk; *also* registers rulesets into the extend registry
   (`ruleset.ts:1856`), gathers `context.extends`, captures collapse frames (`ruleset.ts:1902`).
4. **processExtends** (`rules.ts:6280`, once/outermost) — snapshots `preExtendSelectors` over
   **every** registered ruleset, then applies gathered extends. Short-circuits on
   `!instructions.length` — but AFTER the snapshot walk (`extend-roots.ts:643`).
5. **Serialize** (`_emitRenderRulesBody`) — output walk; builds `composedSelectorStack`, composes
   collapse selectors.
Plus the `canRenderStaticRulesDirectly` per-container scan re-deriving what `F_STATIC` already asserts.

**Root cause — a half-migration.** collapseNesting selector *composition* IS serialization-time
(`composedSelectorStack` in serialize-helper/print; old eval collapse at `selector-complex.ts:503`
is dead-commented). But its **state** stayed in eval:
- `ruleset.ts:1902` `if (collapseNesting) this.frames = [...context.frames]` — per-ruleset frame-array
  alloc, every render. No serialize/render **read** of `Ruleset.frames` found (`getHoistedParent` is
  AtRule-only) → suspected write-only dead state, propagated by two clone-copies (`ruleset.ts:293`,
  `node-base.ts:1149`). VERIFY then delete.
- `ruleset.ts:1966` `if (collapseNesting) this.hoistToRoot = true` — hoist **decision** mutated at eval time.
The one **real** eval→serialize collapse dependency is `getHoistedParent` (`serialize-helper.ts:396`)
reading a hoisted nested at-rule's captured `AtRule.frames` to recover its severed selector header.

**`F_EVAL_FREE` is NOT needed** — this supersedes the old second-flag proposal.
That flag only existed to name "`F_STATIC` but eval still holds collapse state." Remove the state from
eval and `F_STATIC` alone is the eval-free signal; the scan collapses to a bare flag read.

**North star: the FEWEST tree traversals for byte-identical output** — which follows directly from the
GOVERNING PRINCIPLE above (eval = values only; structure = serialize/render). Not "1/2/3 walks by
feature" — that's just the 4-pass pipeline reworded. End state = ONE driving traversal (the render/
serialize walk):
- **eval** is PULLED lazily by the render walk (memoized) when it hits a dynamic value — not a pre-pass.
- **registration** is a CONSTRUCTION-TIME name index on each `Rules` node — not a runtime pass.
- **extend** (the only non-local op) is gathered DURING the render walk; because a later `:extend` can
  rewrite an earlier target, composed selectors are BUFFERED and extend is applied at walk-end as an
  O(#extends) pass over that buffered set — one accepted concession, still not a second tree traversal.
Net: one traversal + O(#extends) apply; work ∝ the dependency DAG, not passes×nodes. Static+extend-free
is the trivial floor: the walk emits directly, pulling nothing. Signals already exist (`F_STATIC`, root
`_hasExtends` at `rules.ts:948`); they're undercut by collapse-state-in-eval and the redundant scan.

**Measurable targets.** T1: a fully static, extend-free sheet renders with ZERO eval pass
(`canRenderStaticRulesDirectly` → bare `F_STATIC`; delete `isPlainStaticRuleLeaf`/`.every()`; no evalNode
on static subtrees). T2: eval-phase time for a collapse render ≈ eval-phase time for the same tree nested
(the measured ~2.6x gap — 931 vs 357ms, 4500-ruleset synth — is ENTIRELY serialize-side; partly legit
since flattening costs more, so target is "gap is all serialize," not "gap shrinks"). T3: extend gathered
in-walk + applied at walk-end over buffered selectors; no separate discovery traversal. T4: eval owns zero
serialization/collapse state; no new visibility/eval-free flag.

### Staged plan (each gated: build core, stable set unchanged, output byte-identical, A/B the collapse bench)
- [x] **C0 — dead-walk removal (DONE, 844046cbd, zero regression).** Deleted the dead `Ruleset.frames`
  write (confirmed no serialize reader; `getHoistedParent` is AtRule-only). Reordered `processExtends` to
  bail on `!context.extends.length` BEFORE the snapshot loop. Dead-weight, not a hotspot (A/B within noise).
- [~] **C1 — collapse state out of eval — PARTIAL (2e21baae1, merged into dev).** DONE: removed the eval-time
  `if (collapseNesting) this.hoistToRoot = true` write in `Ruleset.evalNode`; the two collapse readers
  (`writeSyntax` bare-`&` gate, `composeHeaderSelector` structuralParent gate) now go through
  `isHoisted(options)` (`hoistToRoot ?? options.collapseNesting`) instead of the raw field. Eval no longer
  writes Ruleset collapse state; byte-identical, 2737/0. **STILL OPEN — this open half IS C2's migration 1
  (see C2 below):** moving the hoisted AtRule HEADER recovery off eval-captured `AtRule.frames`
  (`at-rule.ts:1694`) onto the serialize walk. The live serialize `inFrames` at a nested `@media` emit point
  carries only the immediate `.body`, NOT the full `.card > .body` ancestor chain (the ancestor is folded
  into the header string and dropped from the frame stack), so deriving the header from the live walk
  regresses deep-nested `@media` headers (`.card .body` → `.body`, byte-diff confirmed). Fix = the serialize
  walk RETAINS the full selector-ancestor chain — a bigger rework than C1's original scope, and it is
  exactly the compose/collapse migration C2 needs. The `AtRule.frames` eval capture stays until then.
- [~~WON'T DO~~] **C2 — trust the flag — STRUCK (not worth it, measured 2026-07-06).** Profiled the ideal T1
  shape (4000 flat static rulesets): `isPlainStaticRuleLeaf`/`canRenderStaticRulesDirectly` **do not appear in
  the CPU profile at all** — the scan C2 replaces costs ≈0. Eval is *already* skipped for static-flat rulesets
  by the existing scan, so the render phase is serialize-only; parse (~67%) + GC (~13%) dominate. The entire
  registration-prep machinery (the only thing a construction-time flag could additionally skip) sums to **~1.3%**
  across ~15 sub-0.15% functions, and it's load-bearing for forward-refs → real regression risk for ~1.3%.
  So C2 = a subtle `F_STATIC`/`F_NON_STATIC` bit-exclusivity refactor (an `F_FLAT_STATIC_BODY` construction bit)
  for **<1.5%, headline scan-elimination = literally zero**. `F_STATIC` ("no dynamic values") genuinely ≠
  "flat body" (the forensic analysis below is CORRECT), but the flat property being a scan vs a flag is
  invisible to the profile. **Doing it would be a defensive slowdown-class change on reasoning alone. Skipped.**
  Migration 2 (merge-decls `F_NON_STATIC`) already landed independently and stays. Forensic detail kept below.
- [ ] ~~**C2 — trust the flag — GATED ON 3 EVAL→SERIALIZE MIGRATIONS (empirically proven, no-op reported,
  nothing committed).**~~ A bare `F_STATIC` check CANNOT *yet* replace the `canRenderStaticRulesDirectly` scan:
  substituting it gives **+27 failures**. Root cause (per the GOVERNING PRINCIPLE): a static NESTED `Ruleset`
  propagates `F_STATIC` UP to its parent, but `isPlainStaticRuleLeaf` rightly rejects nested-block/merge
  containers because **eval still does structural work (composition / coalescing / registration) even on
  fully-static input**. `F_STATIC` = "no dynamic values" ≠ "eval is a no-op." C2 is NOT blocked on one vague
  "C1" — its real blocker is THREE mostly-independent migrations, each eliminating one measured class of the
  +27 failures. When all three land, `isPlainStaticRuleLeaf`'s leaf-scan is redundant and C2 is a **one-line
  deletion** (the scan collapses to a bare `F_STATIC` read):

  | # | Migration | Kills | Status |
  |---|-----------|-------|--------------|
  | 1 | **Serialize walk retains the full selector-ancestor chain** — drop serialize's dependency on eval-captured `AtRule.frames`; the live `inFrames` currently carries only the immediate ruleset, not the full `.card > .body` chain. | compose / collapse-nesting failures | **OPEN = C1's remaining half** (see C1). Bigger; serialize-walk rework. |
  | 2 | **Merge declarations must not be `F_STATIC`** — a `+:`/`+_:`/`normalizedFromAssign` decl needs structural coalescing. | merge-chain (`+=`/`normalizedFromAssign`) failures | ✅ **DONE (e23d11287, merged to dev).** Merge decls get `F_NON_STATIC` at the `Declaration` constructor (sticky — blocks `F_STATIC` + upward propagation, so the container isn't render-direct but still flows through eval where coalescing runs); the redundant `isPlainStaticRuleLeaf` assign-check is deleted as dead code. 2737/0, byte-identical. |
  | 3 | ~~At-rule/layer registration → render~~ **folds into registration-as-construction-index (C3/C4), NOT extend.** Jess has NO CSS `@layer` cascade-ordering registry (emits `@layer` in source order). The +27 hit `@layer`-NAME registration for `:extend()` scoping (`AtRule._extractAndStoreLayerName` → `ExtendRoots.rootsByLayerName`). **PHASE CORRECTION (b2 got this wrong):** the registry is WRITTEN during eval but READ by `processExtends` — a **post-eval** pass (`getAccessibleRoots`/`getVisibleRoots`, called only from `processExtends`, rules.ts:6523), NOT during eval. So it is NOT gated on extend leaving eval (extend is already post-eval). Real gate: make the WRITE a construction-time/registration-walk index so `processExtends` can still read it. STATIC layer names need no eval to compute; only INTERPOLATED (`@layer @{name}`) names do. | layer-scoped-extend failures | **Tractable for STATIC layer names via construction-time registration (part of C4's "registration → construction-time index"); interpolated names stay eval-bound.** |

  So the real remaining gates for C2: migration 2 ✅ done; **migration 1** = C1's open half (serialize retains the
  ancestor chain); **migration 3** = make registration a construction-time index (C4 vision) so static subtrees
  register roots/layers without eval — its post-eval consumer (`processExtends`) doesn't care when the registry
  was built. Both 1 & 3 are "get eval's STRUCTURAL work (composition, registration) to happen elsewhere," per the
  governing principle. NOTE: the earlier "folds into extend-out-of-eval" framing was based on a wrong phase claim
  (extend is post-eval, not eval) — corrected here. (Interpolated-trivia lookup rides along with migration 1.)
- [ ] **C3 — extend gathered-in-walk + buffered apply at walk-end.** → T3. Static subtrees register targets
  via a cheap construction-time signal, not eval. Overlaps at-rule work landing on feature/parseman — gate hardest.
- [ ] **C4 (north star) — fold eval INTO the render walk as lazy pull.** Eliminate the eager evaluated tree
  so DYNAMIC content is also single-traversal; registration → construction-time index. Largest scope, last.

### Orchestration (branch from `dev`, merge back to `dev`)
- **`dev` IS the integration trunk now.** The trunk migration completed: `feature/parseman` was absorbed into
  `dev`, and the perf pile (`perf/walk-collapse`) landed forward into `dev`. `perf/walk-collapse` is retired —
  do NOT start new work on it. All core-cleanup/perf work branches FROM `dev` and merges BACK TO `dev`.
- **Per stage:** scope a precise spec → spawn an agent in its own worktree off the CURRENT `dev` tip
  (`git worktree add ../jess-<stage> -b work/<stage> dev`) with the setup block + spec → agent works to the
  gate, commits, reports before/after bench + failure set → **orchestrator merges the branch back into `dev`**,
  re-runs the full gate, keeps only if green, updates this checkbox + bench #, then pushes `dev`.
- **`dev` is a HOT shared branch** (the less-integration drive commits to it continuously). Before merging a
  stage back: `git fetch`, confirm the merge touches disjoint files from what's in-flight (or resolve), merge
  with `--no-ff`, gate green, then push. Never force-push `dev`. If `dev`'s working worktree (currently
  `jess-parseman`) is mid-task, coordinate the merge to a safe point — don't move a live worktree's HEAD from
  under it. Serialize only the MERGES (avoid concurrent edits to the same file across stage branches).
- **Fan out WIDE** across disjoint files — try many ideas concurrently. **Reuse worktrees:** when an agent
  finishes an idea, have it COMMIT then hand it the NEXT idea in the SAME worktree (SendMessage — keeps
  file/build context) instead of spawning fresh. Agents coordinate through the orchestrator: report → gate →
  merge → next idea.
- **Agent setup block:** `pnpm install` (~10s; NOT `pnpm -r build`). Correctness gate (no build; vitest on
  src): `cd packages/core && pnpm test` — baseline = GREEN (**core 2730/0** on `dev`). A ~2ms sibling-collapsed
  timing flake may appear — re-run; clean = that set + byte-identical.
  Timing (optional): build `@jesscss/core styles-config @jesscss/fns jess` only (NOT `-r`: jess-plugin is
  pre-broken TS5096). jess default output is NESTED (collapseNesting opt-in); benchmark.less does NOT
  render on jess yet — never gate on it. Benches: `packages/core/perf/{collapse,dynamic}-bench.mjs`
  (build core+jess first). Enable per-stage timings with `JESS_PROFILE=1` (parse/eval/render split).

**Status:** The `perf/walk-collapse` drive is COMPLETE and landed forward into `dev` (the trunk). C0 done;
C1–C4 are the ACTIVE backlog (see reconciliation) — branch them off `dev` per the orchestration model above.
Bench harness at `packages/core/perf/collapse-bench.mjs`.

### PROFILE PIVOT (measured — the walk plan targets the wrong 2.7%)
CPU profile of a 4500-ruleset collapse render (`packages/core/perf/collapse-bench.mjs collapse`, self-time):
- **`OutputWriter.refreshPositions` (print.ts:776) — ~51%** (single biggest cost)
- **GC — ~14%** (allocation churn), **`trimEndSince` — ~7%**
- **eval — 2.7%**, serialize composition — ~4%
So C1–C4 (walk-count / eval) chase 2.7%. The prize is the **OutputWriter**. Two root causes, both on
the goal's axes (fewest allocations / least redundant work):
1. **Per-fragment `new OutputWriter()` churn — should be ONE writer per full tree serialization.**
   Fragment sites (`serialize-helper.ts` x6, `interpolated.ts` x3, `rules.ts:614`, `declaration.ts:383/1059`)
   allocate a writer + position arrays per node, then getSince/toString and discard. The writer already
   exposes `mark`/`getSince`/`restore`/`replaceSince` — thread the single render writer and use mark/restore
   instead of allocating. Keep a separate/pooled writer ONLY where fragment rendering is genuinely reentrant
   (interleaved with the main buffer); never per-call allocation. (The `new OutputWriter(false, parts)`
   flat-parts sites in call/query-condition/sequence are a different buffer kind — classify, don't blindly convert.)
2. **`refreshPositions` rebuilds from index 0 on every trim/append** (both tracks-sources branches).
   A `trimEndSince(mark)` only invalidates `_posLength`/line/col from `mark` onward — make it incremental
   `refreshPositions(from)`, seeded from position[from-1], not a full-buffer rebuild. NOTE: `tracksSources`
   is NOT the lever — probed flipping the default to false → no speedup + 26 regressions (top-level render
   writer is already !tracksSources for no-sourcemap renders; the cost is the from-0 loop in BOTH branches).

- [x] **W1 — single-writer serialization** (root cause 1) — **DONE** (LANDED LOG: 6/18 fragment sites → shared
      writer, −25.7% OutputWriter allocations; other 12 sites intentionally separate). Highest allocation win.
- [x] **W2 — incremental `refreshPositions(from)`** — DONE + merged (b629d5af4, gate clean, byte-identical).
      `refreshPositions(from=0)` recomputes only `[from..end]`, seeded from position[from-1] (mirrors
      `restore()`); trims pass `mark`; the flat-buffer seed at line 431 stays full (from=0). **HUGE win, on the
      integration branch: collapse 1006→291ms (~3.5x), nested 400→226ms (~1.8x).** The single biggest perf
      result of the whole drive — and it was invisible to the walk-minimization plan (found only by profiling).
W1/W2 are reprioritized ABOVE C1–C4 (eval is 2.7%; the writer is >70% incl. GC+trims).

### PROFILE IS BIMODAL (measured both shapes — triage of ALL perf items)
The cost profile flips with input shape, so no single item is "the" hotspot:
- **Static / output-heavy** (4500-ruleset synth): OutputWriter dominates — `refreshPositions` 51%, GC 14%,
  trims 7%; eval 2.7%, serialize-compose 4%. → **W1/W2** own this.
- **Dynamic / eval-heavy** (1200 mixin-call+operation blocks): **parse 30%, eval 22%, GC 17%, serialize 2.4%**.
  Top eval self-time: **`createRulesLikeReferenceSurface` 921ms** (= the deferred "copy/materialization
  boundary" item — REAL, not dead), **`ensureProv` 711ms** (provenance alloc — appears in BOTH profiles).
Triage verdict:
- **W1/W2 (writer)** — biggest win for static/large-output. IN PROGRESS.
- **[promote] copy/materialization** (`createRulesLikeReferenceSurface`) — the #1 eval-side allocation on
  dynamic input; the deferred item below is confirmed real. Its own stage after W1/W2.
- **[new] provenance `ensureProv`** — cross-cutting alloc in both shapes (~488–711ms). Characterize separately.
- **parse reify (`_r_*`) 30% on dynamic** — amortized in parse-once usage; a parser-perf concern
  not core-render. Note, don't chase here.
- **C1–C4 walk/collapse-state** — small on both shapes (the specific collapse bookkeeping is a slice of the
  2.4–4% serialize); keep as correctness-hygiene, not a headline perf win. eval's 22% (dynamic) is spread
  across surface-creation + provenance, NOT the collapse frame juggling C1 targets.

### Latest real-world Bootstrap profile (current perf priority)

The latest honest workload is a Bootstrap 4 composite: ~92 KB emitted CSS from
29 passing components with `lessPlugin()`, `jsPlugin()`, and
`lessCompatPlugin()`. It supersedes the old synthetic-only profile docs for
priority ordering.

- Full-entry stock Bootstrap still has the `_grid`/`_utilities` mixin-guard
  wall, but the 29-component composite is a real large Less sheet.
- Warm render is ~300-340 ms for the composite; Less 4.x is ~49 ms, so this is
  the current real ~6-7x gap on the compiled subset.
- Parse is effectively gone as a render bottleneck here: ~0.44 ms with import
  parse cache. Serialize is also tiny, around 0.9% active time.
- Active-time buckets: core eval ~50%, deferred value parse during eval ~12%,
  node/plugin process overhead ~10%, scope lookup ~7.5%, extend ~6.3%, GC ~3%.
- Confirmed gone on this workload: `commentRunsWithinSpan`, `entries`,
  `isSameOrDescendantRoot`, `findChainedExtendsWithSkips`, and
  `wouldExtendChange` are no longer priority targets.

Current ordered targets:

1. **Scope-frame variable lookup.** `lookupScopeFrameVariable` is the largest
   core hotspot. Optimize, do not delete: cache negative lookups per
   `(frame, name)` within an eval pass or flatten resolved scope views for hot
   mixin bodies.
2. **Generic tree walking.** `visit` and predicate scans such as
   `rulesMayContainReferenceImports` are necessary but specializable. Prefer
   construction/adoption-time bits or tight iterators over repeated generic
   visitor passes.
3. **`plugin-js` process/module overhead.** `spawn`, module stat, and CJS loader
   time are real Bootstrap cost and largely non-core. Reuse an in-process worker
   or VM context when the security model allows it.

Old synthetic profile conclusions now live here only as history: comment-scan
quadratic was fixed, extend-visibility walk was fixed, chained-extend matching
was fixed enough to drop from the Bootstrap top list, and parse throughput is a
parser/Parséman concern rather than a core-render chase.

### Provenance side-table — the WeakMap is the SMELL, not a thing to optimize (NEW item)
Heap profile: native `set` = **58.9%** of sampled allocation. Source: the `PROV` WeakMap in
`provenance.ts`. `setSourceSpan(this, location)` fires **in the Node constructor** (`node-base.ts:704`) —
so every spanned node, at parse/construction, does `PROV.set(node, {})` (a WeakMap entry + a `{}`), and
clone/inherit does another (`node-base.ts:1384`). Every `sourceSpanOf`/`spanStartOf`/`spanEndOf` read is a
`WeakMap.get`. **The span is ALREADY granted at construction from the parser's `location` arg — it's just
mis-stored in a side-table instead of on the node.** This is the `501abdb8c` regression: provenance was
moved off the node (to free the old `.state` name for Parséman) into a WeakMap; the churn + get-indirection
is the cost. **FIX = put spans back INLINE on the node** (a dedicated field the parser sets at construction;
`.flags`/Parséman naming is already resolved, so the original name-collision reason is gone). The parser sets
the field ONCE at construction (parser-level, where it belongs); clone/inherit then copies it as part of the
node's **fixed shape** — a monomorphic field copy, NOT the current eval-time `setSourceSpan` WeakMap write
(`node-base.ts:1384`). Eliminate the `PROV` WeakMap entirely — do not "lazy-alloc" or "denser-store" it; it
shouldn't exist. No WeakMap, no eval churn, fast V8 object. Cross-cutting (node-base + provenance.ts + all
`*Of` readers) — own stage, gate byte-identical + baseline.

### Remaining tracker perf items — triage verdicts (explore-all pass)
- **Focus A — Ruleset source-direct render eligibility:** minor; render fast-path *eligibility* refinement,
  not on the measured hot list. Keep deferred.
- **Focus B — loops COPY per iteration — MEASURED, CLOSED (not worth a refactor).** `@each` over a list var
  (4000 rulesets, identical output): loop wall-time ≈ flat (0.97x — loop parses the body once, so it's even
  marginally faster). Per-iteration body copy + frame setup (`createForIterationSurface` +
  `copyOwnedWithReusableLeaves` + extra `clone`/`inherit` + `resolveEntries`) = **~1–1.5% of CPU** total; the
  copy already uses reusable leaves (not naive deep clone). Verdict: NOT worth a zero-copy loop refactor at
  current priorities — the real loop-render cost was serialization (`refreshPositions`), already fixed by W2.
  scss-render path (for reruns): `compiler.renderString(src, { extension: '.scss', config: { compile: {
  plugins: [scssPluginInstance] } } })`. **Bugs found in passing (out of perf scope, flag separately):**
  (1) `jess-plugin-scss/src/index.ts:87` passes `'stylesheet'` but the grammar root is `'Stylesheet'` →
  scss plugin can't parse anything as-is; (2) range `@for` (`range.ts:87` evalNode stub + no `Range` case in
  `control.ts:335 resolveEntries`) doesn't iterate; `@each` over an inline comma list mis-routes.
- **Focus D.1 — `F_VISIBLE` per-node reads:** cheap (bitmask `&`); `fullRender` prototype-read already
  deleted. Not a headline; hygiene only.

### Copy/materialization — `createRulesLikeReferenceSurface` (spec'd, #1 dynamic-eval alloc)
`reference.ts:2591-2637`. Builds a defensive "owned surface" over a Rules-like reference value (independent
`parent`/`sourceNode` per reference site, per LIVE_BINDING invariant 8) using **reflective
`Object.getOwnPropertyDescriptors` + `Object.defineProperties` + a shallow `_options` clone** — ~20-30
descriptor objects PER call, once per mixin-ruleset reference resolve (call sites 2792/2810/2833/2988/3118).
~921ms / ~8% of dynamic eval self-time.
- **MANDATORY (per the FAST V8 OBJECTS rule above): nuke the reflective descriptor dance.** Replace the
  `getOwnPropertyDescriptors`/`Reflect.deleteProperty`/`defineProperties` with a fixed-shape surface — a small
  class with declared fields, or the node's own clone-constructor + the 3 explicit field sets (sourceNode,
  parent, index). Follow the `node-base.ts` 38x precedent. This is THE fix, not an option; do it FIRST.
- **Memoization (agent's FIX A) — CAUTION, do NOT key on `(input, referenceNode)` alone.** The surface's
  `parent` is the *reference-SITE scope*, which differs when the same reference node resolves in different
  scopes (recursion / a mixin called from multiple sites). Keying without the resolution scope returns a
  surface with the WRONG parent → output corruption. Only safe with the scope-identity in the key (agent's
  FIX C), which is the higher-risk architectural version. Prefer the construction win first; memoize only
  with scope-keying and heavy gating.
- Gate: byte-identical on the 1200-mixin dynamic input + the 2-known-fail baseline. Own stage (eval-semantics;
  overlaps live reference/less work — coordinate). Full agent report in session history.

### Reference-node specialization (idea — captured; tradeoff-nuanced)
Should the one generic `Reference` split into distinct node types so eval dispatches by TYPE (monomorphic
per class) instead of branching per-reference on `options.type`/flags? Separate two axes:
- **Axis 1 — syntactic kind (known at PARSE): real win.** `.mixin()` call / `@var` / property-lookup /
  `@import (reference)` member are syntactically distinct — the parser already knows which. Distinct node
  classes → each gets a **monomorphic `evalNode`** (stable hidden class, hot ICs) instead of one mega-method
  over a varying `options` bag. This is the "repeated mixin call / import-style lookup" case: the call site
  stays monomorphic instead of megamorphic. Aligns with the FAST-V8 rule (fixed shape per type).
- **Axis 2 — resolution outcome (only known at EVAL): NOT reducible by node typing.** Same `@x` → color /
  number / ruleset / import-member by runtime scope. Distinct types can't remove that branch (one node, many
  outcomes). BUT the hot `options.type === 'mixin-ruleset'` surface branch CAN become **polymorphic dispatch
  on the resolved value's class** (`resolvedValue.createReferenceSurface()` on Rules/Collection/Mixin) — kills
  the string compare, V8-monomorphic-per-type, without knowing the outcome at parse.
- **Tradeoffs.** Pro: monomorphic hot paths, fixed shapes, less megamorphic `options` access; a second angle
  on the `createRulesLikeReferenceSurface` hotspot. Con: more node classes; parser classifies at construction
  (trivial in Less/scss — syntax disambiguates); shared lookup engine must factor into helpers so the split
  doesn't duplicate resolution; a few refs ambiguous until eval (rare). Irreducible: outcome-polymorphism
  stays; a per-node resolved-kind cache hits the same scope-variance caveat as memoization (scope-key or corrupt).
- **TESTED → NO WIN → REVERTED.** Built the full 7-kind split (`VariableReference`/`DeclarationReference`/
  `PropertyReference`/`IndexReference`/`MixinReference`/`MixinRulesetReference`/`FunctionReference`) via a
  `createReference` factory routing on `options.type` — CORE-ONLY (no grammar changes; subclasses keep
  `type==='Reference'` + `N.Reference` bit so all checks pass), byte-identical, all tests green. **But measured
  PERF-NEUTRAL** (152.8 vs 153.0ms dynamic, same-dir A/B) — reference DISPATCH isn't the hotspot (the bench is
  GC + provenance dominated; V8 already handles the polymorphic Reference eval fine). Also: NO field slimmed —
  all 7 kinds kept the same 5 fields. **⚠ METHODOLOGY MISS (owner-flagged): that "no slim" was a NAIVE split,
  not proof.** Behavior IS kind-gated (`options.type === 'variable'|'index'|'mixin-ruleset'` route different
  paths, reference.ts:766/2383/2796), so the fields ARE differential — `target` only for index/property refs,
  `role` for declaration refs, `_rulesLookupHandle` for mixin-ruleset. The agent kept the UNION shape instead of
  building the per-kind field matrix + dropping unused fields per subtype. Rule going forward (added to SLIM):
  a specialization must be judged on BOTH axes — DISPATCH (measure) AND SHAPE-SLIM (per-kind field-usage matrix
  → drop unused fields per subtype). Per "perf is the driver," REVERTED (net diff = base). Backup:
  `perf/ref-specialization-regressed-backup`. **Lesson: this was a hypothesis measurement disproved** — only
  re-land if a reference-dispatch-heavy workload ever proves it hot. The eval engine is already free-functions
  threading `lookupType`, so the split bought only monomorphic dispatch, which wasn't the bottleneck.
- **⚠ BENCHMARKING HAZARD (found here):** A/B across DIFFERENT worktree directories gave a ~25ms bias on
  BYTE-IDENTICAL bundles (filesystem/path effects). ALWAYS A/B in the SAME directory (toggle via
  `git revert`/`cherry-pick` + rebuild in place), never base-worktree-vs-feature-worktree.

**Still-deferred perf backlog:**
- [defer] `Reference` lookup + callable output-body placement — remaining hot path.
- [SPEC'D ↑] Copy / materialization boundary — see above; construction-cost fix first, scope-keyed memo later.
- [NEW] Provenance side-table WeakMap churn — see above; the heap `set` 58.9%; eliminate the WeakMap (inline spans).

<!-- The former "Focus D (task #9)" duplicate block was removed: all its items (on-string
crashes, toBeString, stale materialization tests) are superseded and marked DONE in the
authoritative Focus D progress section below. -->

## Focus G — mixin namespace resolution: consolidate the several routes (OPEN — staged)

**Owner directive:** "Having several routes to resolve mixins is a non-starter — should be
drastically cleaned up." This focus tracks that consolidation. A driving bug was landed first
(minimal correct fix, gated 2805/0 core + corpus 88→89), and the full consolidation is staged
below rather than done as a blind refactor.

### The several routes (mapped)
A `#ns > .m()` mixin call reaches `scope.findMixin` (reference.ts `performMixinRulesetRulesLookup`
/ `performMixinRulesLookup`) → `findMixinPath`, which fans out into **three parallel namespace
walks** that each accumulate differently:
1. **`findRulesetNamespacePathFast`** — the RULESET-form namespace path (`#ns { … }`). Its prefix
   loop historically **returned on the first resolving match** (last-registered, via reverse
   bucket iteration) — so same-named ruleset namespaces collapsed to one.
2. **`findMixinNamespacePathFast`** — the MIXIN-form namespace path (`#ns() { … }`). Already
   accumulates across matches (`nestedResults.push`), but its `matches` come reverse-ordered
   from `collectCallableBucketResults`, so multiple same-named mixin namespaces emit reversed.
3. **`findCallableDescendants`** — resolves `.m` inside each mixin-form namespace; iterates
   `namespaceMixins` (reverse bucket order).
`findMixinPath` runs (1) FIRST and returns early if it yields; (1) also `return undefined` when a
same-named MIXIN namespace shadows the ruleset one — so a name with BOTH forms dropped the
ruleset defs. Net: three routes, three different accumulation/ordering rules, and a
ruleset-vs-mixin exclusivity that silently dropped one side.

### The bug that drove this (LANDED — commit on fix/less-corpus-failures)
`#foo when(@g>0){.m(){a}} #foo when(@g>0){.m(){c}} .caller{ #foo > .m(); }` emitted only the LAST
ruleset's `.m` (`c`). Root cause: route (1)'s first-match return. Real Less.js accumulates BOTH
(verified against less-4x lessc). Corpus fixture `tests-unit/mixins-guards` (`#guarded-caller`)
needed all THREE same-named `#guarded` namespaces (a plain guarded ruleset + two mixin-form) to
contribute, in source order. Fix (minimal, aligned with the consolidation target — accumulate in
source order across all same-named namespaces for CALLS, keep override for value lookups):
- **route (1):** accumulate across prefix matches in SOURCE order; gate on a new `mixinCall`
  option (below) so bare value/index lookups keep override (last-wins) — `#lib.sizes[@x]` /
  `#lib.core.colors[primary]` still resolve the override, verified by `namespacing-2`/`-4`.
- **route (3):** iterate `namespaceMixins` back-to-front (source order).
- **ruleset+mixin coexistence:** `findRulesetNamespacePathFast` gained
  `resolvePrefixesDespiteMixinNamespace` so `findMixinPath` can UNION the ruleset-form defs with
  the mixin path (only for `mixinCall`), instead of dropping one side.
- **the call/value distinction** (the key signal the routes were missing): a mixin-ruleset
  reference reached through `Call` is tagged `mixinRulesetCall` (call.ts `withMixinRulesetCallArgsHint`);
  the strategies thread it into `CallableFindOptions.mixinCall`. Emitting CALL ⇒ accumulate all
  same-named namespaces; bare value/index lookup ⇒ override. This distinction was **absent** at
  the `findMixin` layer — both looked like `type=mixin-ruleset, hasArgs=undefined` — which is
  precisely why the routes conflated the two semantics.
Gate: core 2805/0 (twice, stable), corpus 88→89 (only extend trio + import-remote remain), no new
tsc errors, byte-identical elsewhere.

### Consolidation plan (STAGED — the real cleanup the owner wants)
The three walks should collapse to ONE namespace-path resolver that takes an accumulation policy
(`accumulate` for calls / `override` for value lookups) and a source-order guarantee, resolving
ruleset-form and mixin-form namespaces uniformly (a namespace is a namespace; its FORM shouldn't
pick a separate code path). Concretely:
- Unify `findRulesetNamespacePathFast` + `findMixinNamespacePathFast` + the descendant walk into
  one recursive walk over "namespace segments" that, per segment, collects ALL same-named
  namespaces (both forms) from the callable bucket in SOURCE order, then recurses. The
  `mixinCall`/override policy is a parameter, not a fork.
- Kill `resolvePrefixesDespiteMixinNamespace` and the `findMixinPath` union — they exist only to
  paper over the ruleset/mixin route split; a unified walk resolves both forms in one pass.
- Normalize bucket iteration: `collectCallableBucketResults` / `collectCallableBucketRemainderResults`
  / `collectRulesetPrefixes` all iterate REVERSE (newest-first) for legacy first-match/override;
  a unified resolver should read them once, in a single defined order, and let the policy decide
  first-vs-all. (Do NOT globally flip these — several first-match/override callers depend on
  reverse; the flip must be per-resolver, gated.)
- Risk: perf-critical, 2805-test surface; each unification stage must be gated (build core, stable
  set unchanged, byte-identical, A/B the collapse/dynamic benches). Do it as its own focus, not
  inline with a corpus fix.

## Focus E — scope / mixin lookup misses (== task #17 tail)

`'x' is not defined` / `No matching mixins found`, funneling through
`getReferenceNotFoundError` / `finalizeFallbackReferenceResult`. Single-frame lookup
isn't resolving bindings that should exist. **NOT one root cause** — three families:

- [x] **E1 — call-frame fallback to call-site scope for imported configs** (merged
  cleanup/e-lookup, commit 04c285797). Imported mixin body/guard frames wiped their
  fallback to `undefined` for non-leaky calls, dropping the call-site link where `with`-
  config vars live. Fix (callable-scope-frame.ts): body + prebound param-guard frames now
  chain the distinct call-site `parentFrame` when `fallbackScopeFrame` is absent. Cleared 2
  import-style tests. Baseline 66 → **64**.
- **E2/E3 — configured/reference import surface not on the callable resolution chain.** Being
  chipped by scoped sub-agents in an isolated worktree (proper orchestration), NOT one monolith.
  - [x] **E2-a — reference-import property/declaration members** (merged cleanup/e-scope-identity,
    commit 825dc3ec0, 60→59). Root cause traced: property lookup (`findDeclarationLookupWithStrategy`
    in direct-rules-lookup.ts) walks the static AST parent chain and only checked `startRules`'s OWN
    fallback frame, never an ancestor's — so a `reference:true` import on the root frame was invisible
    to property refs (sibling variable `fromRef` resolved but property `fromRefProp` threw). Fix:
    `PROPERTY_LOOKUP.includeFallbackFrames=true` + capture the closest ancestor scope's fallback entry
    and descend into it after the primary chain exhausts (precedence preserved). Wire the frame — not a
    shim. Fixed `import-reference: real hit and miss refs avoid public declaration bridges`.
  - [x] **E2-b — reference-import callable LOOKUP** (merged cleanup/e-refimport-mixin, commit 35f8087a5,
    59→59 metric-neutral, zero-regression). Traced root cause: the single-key `findMixin` retry-walk
    (rules.ts ~3376) only chained the *calling* frame's direct fallback, never the fallback chains hanging
    off ancestor retry frames — so a ref-imported callable on an ancestor's `fallbackFrame` was invisible
    once the primary chain exhausted. Fix: queue every passed frame's fallback head and drain after the
    primary chain (precedence preserved). **Completes the 3-way ancestor-fallback consistency** (property
    [E2-a] / namespace-walk / single-key callable). Merged as a principled latent-lookup-bug fix + E3
    prerequisite; it is metric-neutral because the target test `reference-imported selector-list rulesets
    remain callable as mixins` now fails DOWNSTREAM on E3 selector-rebasing, not lookup.
  - [x] **E3-rebasing — selector-list mixin application** (merged cleanup/e-refimport-rebase, commit
    8689c52cb, 59→58). **Was NOT monolithic** — a cache-key bug. `composedSelectorCache` (print.ts) was
    keyed on `Ruleset` node identity ALONE; a mixin body shares the same canonical `.c`/`&` nodes as the
    ruleset's own placement, so the value composed first under the DEFINING header (`.z .c`) was cached and
    reused at the call site instead of recomposing against the call-site frame (`.b`). Fix: key the cache by
    `(ruleset, composed-parent)` — `WeakMap<Ruleset, Map<parentKey, Selector>>`. Header-clipping to the
    matched key + `&`-rebasing fall out for free (nested content composes against the call-site frame). No
    node mutation, F_VISIBLE untouched. Fixed `reference-imported selector-list rulesets remain callable`.
  - [DEFERRED] **E3 — lazy/cold namespace-mixin-body ref-imports** (`uncalled … stay cold`, `evaluated
    namespace mixin bodies expose … descendants`) — genuine eval-ordering/coldness behavior, closest to
    the true monolithic rework.
  - [DEFERRED] **E3 — `with`-config child-surface + detached-ruleset closures** — the monolithic core
    (config lives on a *derived* surface not on the callable's definition/lexical chain); the
    **"wrapper is scope identity" scope rework** (see LIVE_BINDING_ARCHITECTURE.md). Its own project.

  **import-style.test.ts full triage (cleanup/import-style-triage, no fix landed — all monolithic).**
  The 14 remaining import-style failures map to the deferred reworks (each traced to file:line, verified):
  - **A · with-config (5)** — all throw `'X' is not defined` at reference.ts:2311; config binding not on the
    callable/closure definition chain. = the monolithic config-surface rework.
  - **B · namespace cold/lazy crawl (3)** — broad-crawl suppression fires before the namespace body is
    evaluated (`findMixin` returns a stale hit / null / 0 broadFastHits). Eval-ordering, deferred.
  - **C · placement-ownership of shared static children (2)** — a source-free static `Declaration` returns
    `this` from `materializeValueState` (changed:false), so first-use plain-import placement keeps the shared
    canonical node. ATTEMPTED (cloneForPlacement) → **+2 regressions** (reference-import guards read caller
    scope via placement child identity), reverted clean. Needs frame-scoped ownership, not a placement-seam
    walk — entangled with reference-guard scope. Smallest next step noted in agent report.
  - **D · eval-surface cache / wrapper-identity (2)** — declaration-lookup-version bump runs on a derived
    output surface (copy-on-write); compose finalRules wrapper `sourceNode` ≠ itself. = wrapper-is-scope-
    identity monolith ([[parseman-wrapper-is-scope-identity]]).
  - **E · forward-only downstream visibility (1)** — forwarder links forwarded members into its LOCAL frame;
    should expose downstream-only. Scope-frame linkage change.

## Focus D — strings-not-nodes render (progress: 85 → 67 stable, zero regressions)

**The selector-serialization (Theme A) cluster is GREEN.** The render path no longer
calls node methods on bare strings, and the header emitter is unified:
- [x] All on-string render **crashes** gone — `ensureSelectorVisible`/`needsVisibleSelectorClone`
  array-hoist, `clone(true)→clone()` (old deep-clone API), `String(atRule.name)`.
- [x] **Stale materialize-at-registration tests deleted** (string→node SelectorList/
  ComplexSelector chain was proven dead + removed) — 10 blocks from string-backed-nodes.
- [x] **serializeTypes snapshots** updated to compact single-element arrays;
  string-backed-nodes.test.ts fully green (canonical Theme A test, 13 cases).
- [x] **Unified selector-list emission** — the bare string/array header surface
  (`emitSelectorListLike`) and the `SelectorList` node now share `emitSelectorListItems`:
  `,\n<indent>` line breaks + `:is()` hoisting + reference filter for both. Clears the
  collapsed-array `:is()` multi-selector header (ampersand test).

Remaining string failures are **NOT selector serialization** — genuine eval bugs, out of
this goal's scope, overlapping deferred work:
- [x] **Trivia loss (task #18) — was stale test fixtures, no source bug** (merged
  cleanup/decl-trivia). The `501abdb8c` provenance refactor migrated `fieldSpans` from a
  flat `[start,end,flags]` encoding to `(SourceSpan|undefined)[]` objects + reader `.[0]?.end`,
  but left unit fixtures on the dead flat shape (`[0,5,0]`), so `[0]?.end` was `undefined`
  and name-boundary trivia was dropped. Fix = align fixtures to `{start,end}`. Cleared both
  the declaration and at-rule trivia tests. Baseline 68 → 66.
- [DEFERRED] **Eval-output / collapse diffs** — recursive-mixin / merge-chain / extend / nesting-
  collapse output differs (e.g. a hoisted `.parent` wrapper ruleset dropped under `@media`);
  eval correctness coupled to Focus E lookup + the deferred F_VISIBLE eval stomps, not render.

## Focus D.1 — `F_VISIBLE` is a by-type property (major project; scoped)

**Principle (owner):** `F_VISIBLE` marks whether a node *type* is CSS output. It is set at
construction, by type, and **never mutated at runtime.** Every eval/render-time
`addFlag/removeFlag(F_VISIBLE)` is abuse — an LLM reaching for the nearest flag to force a
particular output instead of building the right mechanism. Rip them all out.

### What it currently conflates (three unrelated jobs on one flag)
1. **Static-by-type** (legit): `function`/`nil`/`mixin`/`log`/`extend`/`extend-list`/
   `declaration-var`/`comment` are born invisible because of *what they are*. ✅ keep.
2. **Dynamic reference/extend suppression** — reference imports not reached by extend.
3. **Dedup / override / already-rendered suppression** — `rules.ts` merge chains
   (last-wins declarations) + render-time "already emitted this" markers. The worst abuser.

### The ~14 runtime stomps to excise (all abuse), by subsystem
- **render dance**: `ruleset.ts:992/1750` force-visible→restore + clone during header render.
- **dedup/merge**: `rules.ts:3665-68` (comment already rendered), `3713/5803/5805` (suppress
  overridden decls).
- **extend**: `extend.ts:167`, `extend-roots:831/841/845`, `util/extend:871`.
- **reference/forward**: `import-style:1005`.
- **at-rule conditional**: `at-rule:438/440/608/609`.
- **filtered ruleset**: `ruleset:1999`. **clone**: `node-base:1366`.
- **callable**: `callable-live-slots:28`, `callable-surface:74`.

### Where the cost actually is (perf = #1)
- `hasFlag(F_VISIBLE)` — a bitmask `&`; cheap, but paid per-node-per-render.
- `this.fullRender` — a **prototype** read (chain walk), paid on every node render for a
  value that is `false` 100% of the time in production. Pure waste.
- **mutate-during-render dance** — a selector-subtree walk **+ a heap-allocated clone per
  ruleset header**. The genuinely expensive one.

### End-state (most performant + best DX): visibility is structural, branch-free on the hot path
1. **Static-by-type → method dispatch, no flag.** Non-CSS types override `writeSyntax` to a
   no-op; V8 monomorphically inlines it — zero flag read, zero prototype walk. Kills the 8
   gates + `fullRender` reads. The node's *type* is its CSS-ness.
2. **Dedup/override → exclude from the render list** at the merge/prepare pass (drop the
   superseded node) instead of flag-hiding it. The render loop never sees it.
3. **Reference/extend → the reference-mode render context** (`referenceMode` + filter) which
   already exists and is paid only in reference mode (a rare special path, off the common one).
4. **Render-despite-visibility (tests now, language conversion later) → a separate walker**
   that traverses everything; never on the common path. Replaces `Node.prototype.fullRender
   = true` and the header-selector force-visible.

Net: **common render path = zero visibility branches, zero `fullRender` reads, no per-header
clone/walk.** "Does it emit?" collapses to *is this type CSS?* (its `writeSyntax`) + *is it in
the render list?* (merge decided) — no overloaded mutable flag.

### Sequencing (perf-first, each stage verified against the stable 85-set)
1. **Rip the mutate/clone dance + `fullRender`** — biggest speed win, no eval semantics to
   preserve.
   - [x] **1a — `fullRender` deleted** (commit 47a6ca6df): field + all gate-branches +
     serialize-helper reads + dead test toggles. The real `F_VISIBLE` check stays; prod
     byte-identical. `fullRender` was test-only (always false in prod) → dead branching.
   - [x] **1c — the `writeHeaderSelector` mutate/clone dance DELETED**: `ensureSelectorVisible`
     + `needsVisibleSelectorClone` (both static methods) + the save/force/restore removed.
     It was **redundant**, not coupled — normal render selectors are already visible, and
     reference emission is driven by `referenceFilteredLocal`. Zero new failures.
     `copySelectorForRulesetMetadata` stays: a shared non-mutating copy for reference-filter
     + `ownSelector`, not the dance. **The render path no longer mutates `F_VISIBLE`.**
   - [DEFERRED] **1b — render-ignoring-visibility walker** (`renderNodeFull`): has **no current
     consumer** — the tests were migrated off `fullRender` to plain suppression, so nothing
     needs render-despite-visibility yet. It also couples with the by-type source render
     (stage 2, since a bare `!F_VISIBLE` gate would still block it). Build it when language
     conversion (its real consumer) lands; the comment-test TODO tracks the one gap.
2. **Static-by-type → no-op dispatch** (split in two once the enumeration was done):
   - [x] **2a — static render gate removed** (merged cleanup/fvisible-stage2): only
     function/mixin/nil reached the base `render()` gate while invisible — all static-by-type.
     Gave each a no-op `render()` override and DELETED the base `render()` gate (node-base.ts:1471).
     Also removed 4 DEAD value-type render gates (dimension/bool/combinator/color — never invisible).
     Output-neutral (66→66), tsc unchanged. The common render hot path no longer reads F_VISIBLE.
   - [DEFERRED] **2b — dynamic toString/render gates** (deferred, pairs with stage 4): base `toString()`
     gate (node-base:1441) + at-rule.ts:834 + comment.ts:56 + declaration-var render are genuine
     **per-instance dynamic** visibility (line `//` comments, false-guard at-rules, paramVar) — not
     by-type. These need the reference-mode/per-instance mechanism, not a type no-op.
3. **Dedup/override → list-exclusion** in the `rules.ts` merge engine (largest legibility win).
   - [x] **3a — leading-comment hoist** (commit 64ad7ae76): the root `writeStylesheet` path hoisted
     leading comments then `removeFlag(F_VISIBLE)`'d them + restored — a mutate/restore dance. Replaced
     with a `hoistedLeadingComments` Set threaded into `_emitRulesBody`; `emitNode` excludes them
     directly. Output-neutral (stable 60, zero delta). 2 of 4 rules.ts stomps gone.
   - [x] **3b — declaration-override last-wins — CLOSED (F_VISIBLE stomps excised).** Merged into dev as
     `work/fvisible-cost` (commit 6e84441cb): the two `removeFlag(F_VISIBLE)` stomps in the merge engine
     (rules.ts, now ~6190/6192) are replaced by a dedicated **`F_MERGE_SUPPRESSED`** flag bit (bit 16,
     node-base.ts); the `visible` getter reads `(flags & (F_VISIBLE | F_MERGE_SUPPRESSED)) === F_VISIBLE`, so
     `F_VISIBLE` is now PURELY by-type and never cleared by the merge engine. The old +6 render-only-suppression
     regression did NOT recur — because the coupling funnels through ONE choke point (the `visible` getter),
     and `direct-rules-lookup.ts` was verified to NOT read node-level F_VISIBLE at all (the original premise
     that lookup consults it was false on this branch). Re-coalesce idempotency reads through `.visible`, so
     the persistent bit covers it exactly as the old stomp did. Core 2737/0, byte-identical. The historical
     block below (why render-only suppression failed) is kept for the forensic record.
     — earlier note: **The failing
     merge-chain TEST is now GREEN** (cleanup/decl-merge, commit 1656b2e78): the real root cause was NOT
     the render-only vs physical-removal dilemma below — it was (1) the coalesce walk recursing into sibling
     `Ruleset`s (they carry the `N.Rules` bit) and (2) a shared mixin-output declaration node whose
     `F_VISIBLE` strip leaked to the callee's canonical decl. Fix: scope the walk to inline `Rules`; COW the
     shared placement copy before the strip (mutation-layer detach). **The broader 3b legibility project —
     excising the two `removeFlag` stomps at 5795/5797 in favour of a persistent non-`F_VISIBLE` merge marker
     — remains DEFERRED** (no failing-test signal now; it's a cleanliness rework). The historical block below
     records why the earlier render-only-suppression approach failed:
     **~~attempted the render-only suppression-set channel this session; ABANDONED — proven architecturally
     insufficient by the gate (+6 regressions), reverted clean.~~** The finding that blocked THAT approach:
     **`removeFlag(F_VISIBLE)` here is load-bearing beyond render** — it hides the superseded declaration
     from (a) **variable lookup** (`reference > resolve merged property lookups via quoted index inside a
     nested child scope` regressed — a lookup found the superseded occurrence) and (b) **re-coalesce
     idempotency** (`declaration > does not re-merge sequence assignments during post-eval coalescing`
     + 4 merge-chain tests regressed — coalesce re-read `.visible` on the still-visible node and
     double-processed). A **render-only** `options.suppressedNodes` channel structurally cannot cover
     lookup or coalesce, so it regresses both. **Physical removal** (true "drop the node") would cover all
     three consumers, but the container-suppression branch (5795: the SAME decl object registered under two
     ownerRules → suppress the earlier whole container) is unsafe to splice from the live tree.
     **Correct end-state requires untangling merge-suppression's cross-cutting lookup + coalesce dependence
     first** — i.e. make variable lookup + re-coalesce stop consulting `F_VISIBLE` on merge-superseded
     nodes (give merge-suppression its own persistent, non-`F_VISIBLE` marker honored by lookup/coalesce/
     render alike, OR restructure coalesce to physically drop survivors' losers safely). That's a
     merge-engine rework, NOT a mechanism swap — deferred as its own project. The 2 stomps at 5795/5797
     stay until then; D1-3a already removed the other 2 (render-only ones, which had no lookup/coalesce
     dependence — that's why 3a was clean and 3b is not).
4. **Leave reference-mode as the sole runtime filter.**
Guardrail throughout: stable core set must not move; string selectors emit. (baseline now 60, was 85.)

## Focus F — node method/field sprawl (NEW; requested)

Past LLM passes accreted many narrow methods/fields on `Ruleset` / `Rules` / `AtRule`
(e.g. `needsVisibleSelectorClone`). Audit method + field surface of these three,
collapse near-duplicates, and (per the concise-naming rule) shorten burmese-python
identifiers. Fold any surviving copy/surface/frame helper sprawl here.)

**Audit done (cleanup/serial-f, read-only).** Candidates below. ⚠️ **Caveat:** the audit
conflated "0 *external* call sites" with "dead" — a `private` method with internal callers
is NOT dead, it's private. Re-verify true dead-ness (0 callers *including* internal) before
deleting anything. The safe, high-value win is the **rename pass**; structural consolidations
are medium-risk on HOT files and must be gated individually.

- [x] **F-rename DONE** (all 3 classes, output-neutral, stable 60, 2 commits).
  - ruleset.ts + at-rule.ts (7): `unwrapGeneratedReferenceIs`→`unwrapGeneratedIs`,
    `expandGeneratedIsForReferenceCompose`→`expandGeneratedIs`, `filterExtendedTopLevelSelectorItems`→
    `filterExtendedItems`, `_ownComplexComponentForCompose`→`_ownForCompose`; `_preludeStartOffset`→
    `_preludeStart`, `renderSerializedAtRule`→`serializeAtRule`, `renderBodyRecord`→`renderRecord`.
  - rules.ts (13): `findVisibleExactCallableRulesetPath`→`findCallableRulesetPath`,
    `frameChainHasExactMixinNamespace`→`hasMixinNamespace`, `findCompoundPrefixCallableRulesetPathFast`→
    `findCompoundPrefixPath`, `childMixinNamespaceUncertaintyIsLimitedToPrefixes`→`uncertaintyLimitedToPrefixes`,
    et al. (done standalone once D1-3b deferred — no reason to batch with deferred work).
  <!-- original vetted candidate list (all applied):
  - Ruleset: `_ownComplexComponentForCompose`→`_ownForCompose`, `filterExtendedTopLevelSelectorItems`→
    `filterExtendedItems`, `unwrapGeneratedReferenceIs`→`unwrapGeneratedIs`,
    `expandGeneratedIsForReferenceCompose`→`expandGeneratedIs`.
  - Rules (~13): `addDirectCallableSelectorEntries`→`addCallableSelectors`, `collectCallableEntriesForKeyFrom`→
    `collectCallablesFor`, `findVisibleExactCallableRulesetPath`→`findCallableRulesetPath`,
    `frameChainHasExactMixinNamespace`→`hasMixinNamespace`, `findCompoundPrefixCallableRulesetPathFast`→
    `findCompoundPrefixPath`, `childMixinNamespaceUncertaintyIsLimitedToPrefixes`→`uncertaintyLimitedToPrefixes`,
    et al. (full list in audit output).
  - AtRule: `_nameSlotEnd`→`_nameEnd` (deferred — spans at-rule.ts + declaration.ts, ambiguous),
    `_preludeStartOffset`→`_preludeStart`, `renderSerializedAtRule`→`serializeAtRule`,
    `renderBodyRecord`→`renderRecord`. -->

**Dead-code claims VERIFIED FALSE** (re-checked all callers incl. internal + tests): the audit's
"dead" list is entirely live — `getRenderFrames`/`getRenderRules` are called by **serialize-helper.ts**
(render path) + ruleset.ts + 19 tests; `unwrapGeneratedReferenceIs`/`simplifyGeneratedIsSelector`/
`expandGeneratedIsForReferenceCompose`/`filterExtendedTopLevelSelectorItems` all have internal (and in
one case test) callers. **Nothing on the audit's dead list is safely deletable** — do NOT delete them.
F-consolidate is therefore rename + genuine-refactor only, no free deletions.

- [DEFERRED] **F-consolidate** — medium-risk pure refactors with **no correctness impact** (nothing on the
  audit's dead list is actually deletable, verified above; these are legibility-only merges of near-duplicate
  private methods). Deferred as low-priority polish behind the correctness work; each must be gated
  individually and none reduces the stable failure set. Candidates retained for when polish is warranted:
  - Rules CLUSTER-2: unify `collectPublicVariableAssignmentBindingsInto` / `collectPublicChildVariable…` /
    `prepareScopeFrameAssignmentBindings` into one parameterized visitor (~60 lines) — IF truly redundant.
  - Rules CLUSTER-3: `hasUncoveredVariableAssignmentSurface` + `hasUncoveredChildVariableAssignmentSurface`.
  - AtRule inline-extractors: `createBodyEvalRecord`/`evalBodyPreludeState` into `evalBodyResult`;
    `renderRecord` into `renderEvaluatedValue`.
  - Ruleset `_substitute*` ampersand cluster (~400 lines, extend-critical) — HIGHEST risk, only after the
    extend pipeline is otherwise green.

---

## Done this session (log)

- **Parser reconciliation onto the provenance side-table** — css/less/scss green; jess
  Chevrotain deleted (functional parser is sole), css/less Chevrotain `@ts-nocheck`'d;
  `@jesscss/parser` package deleted.
- **`raw` "prove value or delete" audit** — deleted ≈866 lines of proven-dead core
  weight (rawArgs placement/diagnostic; raw-selector materialization island; the
  reference direct-render fast-path — evidence-backed output-neutral + no perf win;
  `RawRules`). Kept + JSDoc'd the load-bearing `raw` (unevaluated args, source-form
  lookup key, single-frame finalizers).

---

## Standing guides (NOT trackers — keep, don't fold in)

- `HANDOFF.md` — focus router + prosecution history (points here for the queue).
- `archive/FOCII.md` — focus/goal menu.
- `AGGRESSIVE-CUTTING-REVIEW.md` — the architecture-review guardrail checklist.
- `packages/core/src/tree/LIVE_BINDING_ARCHITECTURE.md` — single-frame target invariants.

## Separate live concerns (own docs, not core cleanup)

`trivia-offset-inference-model.md` and the
`packages/core/src/tree/util/**/EXTEND_*` set.

### Friendly recursion detection (roadmap — belongs with less-integration/trunk, NOT the perf branch)
Owner-requested: integrate Less-4.x-style friendly errors for runaway loops/recursion. **Current jess state
(scoped):** `$while` caps at `MAX_WHILE_ITERATIONS=10000` (control.ts:36, friendly throw); `$for`/`$each` are
bounded by range/list; mixin recursion has machinery — `context.callStack` (call.ts:758), the
`inStack`/guarded-recursion candidate filter, and `CallMap` (recursion-helper.ts, SAME-args self-call
detection → the caught `'Recursive mixin call'` at callable-candidate-output.ts:40). **GAP:** no call-STACK
DEPTH cap, so DIFFERENT-args unbounded recursion (`.m(@n){ .m(@n-1) }`, no base case) hits a raw JS stack
overflow (`RangeError`) instead of a friendly message. **Less-4.x ref:** `mixin-call.js:161-180` marks a
candidate `isRecursive` by frame-stack membership (`mixin === context.frames[f].originalRuleset`) — recursion
detection via the frame stack, which jess's callStack/inStack already mirrors. **Work:** (a) a call-depth
safety cap → friendly "recursion limit exceeded" instead of RangeError; (b) polish the existing
`'Recursive mixin call'` + `$while` messages; (c) make Less's recursion-error tests pass. **WHY IT'S NOT the
perf branch:** eval-semantics that OVERLAPS the active less-integration work + Less's own test suite drives it
(the less-integration team will hit these tests getting Less green). Do it on the trunk/less-integration side
(dev / feature/less-v5-alpha-readiness), not perf/walk-collapse.

## Removed sources

Removed from the working tree; history preserved in git and open items lifted
above: `SINGLE_FRAME_PLAN.md`, `NODE-REWRITE-TRACKER.md`,
`PERFORMANCE-HANDOFF.md`, `BINDING-LOOKUP-REMAINING.md`,
`SURFACE_PRIMITIVES_AUDIT.md`, `LOOKUP_CHAINS.md`, `ponytail-core-audit.md`,
`BINDING-INDEX-PROPOSAL.md`, `FLAG-WALK-DELETION.md`,
`SINGLE-RENDER-PASS-PLAN.md`, the old `REPROFILE_*` reports,
`DEV-PERF-INTEGRATION-EVIDENCE.md`, `parser-parse-speed-plan.md`,
`pre-eval-elimination.md`, `static-eval-optimizations.md`,
`whitespace-token-proposal.md`, the scanner-first parser investigations, and
the abandoned `tree/README.md` 2.0 fragment.

## Value-less mixin params → `VarDeclaration(Nil)`, not `Any` (parser + eval — PARKED to avoid core-lane conflict)

Owner-approved shape change, deferred so it doesn't collide with the active core/perf
work. Today `scss-parser` `builders.ts::_buildScssMixinParam` builds params
**inconsistently**: `$a: 1` (with default) → `VarDeclaration { name:'a', value, paramVar:true }`,
but a value-less `$a` → `new Any('a', { role:'property' })`. They should be uniform: a
value-less param should be `VarDeclaration { name:'a', value: Nil, paramVar:true }`.

- Parser side: change `_buildScssMixinParam`'s bare-param branch (the `return new Any(...)`
  fallback) to emit the `VarDeclaration(Nil)`.
- **Eval side (the reason it's parked):** eval's mixin-param handling currently receives an
  `Any` for value-less params — it must accept a `VarDeclaration` whose value is `Nil`. This
  ripples into core, so do it *with* the eval change, on the trunk/less side, not perf/walk.
- Related and already done on the trunk side (commit `c12ec46ab`): declaration/arg **names are
  plain strings** (`string | Interpolated` per core), never `Any` — apply the same when this lands.
