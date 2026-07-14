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
| Q-38 | **OWNER-GATED — remaining eval fallback residuals** — no safe `emit-walk.ts`-only removal was found. Unmatched imported `:extend` now remains on the spine, but the representative `benchmark.less` import/extend shape still enters the spine and falls back after the strict resolved-topology re-gate (`spine=1`, `derive=831`). A genuinely unresolvable interpolated import must retain eval ownership for Less error semantics, and root-direct loops remain outside the current spine emitter. Continue only with an owner of `packages/core/src/tree/extend/spine-extend.ts` and a topology/parity test batch; do not weaken the re-gate or duplicate the existing worker's investigation. | `packages/core/src/tree/extend/spine-extend.ts`, `packages/core/src/tree/util/emit-walk.ts`, spine topology tests | current-dev owner refresh, imported-extend topology proof, root-loop and unresolved-import parity, spine derive counter, all-less byte identity, benchmark A/B, aggressive review |
| Q-39 | **CLOSED — lazy OutputWriter transient state** — ordinary `tracksSources=false` writers no longer materialize idle captured-segment or queued-spacer own fields, and the dead trailing-newline-origin diagnostic/accessor is deleted. `_posLength` remains intentionally eager for constant-time rollback. Full core passed `3311` tests with `15` skipped and `2` deferred; focused writer coverage passed `55/55`; the exact same-checkout `benchmark.less` control/candidate/candidate sequence was `253.67 → 289.79 → 242.93 ms` (15 iterations, 5 warmups, 3 rounds), an order-sensitive swing with no causal speed claim. | `packages/core/src/tree/util/print.ts` | generated writer shape, capture/spacer/source-map behavior, full core, core build, benchmark sanity; no AST or eval fallback ownership |
| Q-40 | **ACTIVE — canonical `benchmark.less` performance program (<40 ms)** — use the Less 4.6.3 fixture at `/Users/matthew/git/oss/less.js/packages/less/benchmark/benchmark.less`, with Jess `Compiler.render()` configured for `collapseNesting: true` plus the Less and Less-compat plugins. The contract is `scripts/compare-less-parse-render-env.mjs`, Node v25.9.0 arm64, 20 warmups, 45 alternating no-op pairs, fixed fixture/options/cache process, and a separate `parse-render` versus parse-once `render` phase; `profile-less-benchmark.mjs` is diagnostic only. Current same-checkout controls: Jess parse+render **238.98 ms** median (control 238.98, no-op candidate 241.79) and parse-once/render-only **202.92 ms** (control 202.92, no-op candidate 202.38)—both far from the target and proving render/eval is the immediate dominant gap. On the same machine/runtime, Less 4.6.3 measured `less.parse(..., { processImports: false })` **4.258 ms** and `less.render()` **31.101 ms** median (20 warmups, 45 samples). Jess preserves its own baseline output byte-for-byte (133,983 bytes); Less output is a speed comparator, not a byte oracle (131,674 bytes). The direct profile records 4,085 declaration preview fallbacks, 1,644 duplicate-declaration containers, and 33,607 declaration-strategy child-surface traversals. Those traversals are only 22 property-merge references and the safe local short-circuit activates once, so generic lookup cache/index work is rejected. Parseman remains separately ranked: equal-contract no-import parsing measured Less AST 6.01 ms, Jess `parseLessFn` 35.77 ms, and recognizer-only 12.58 ms; the next parser work is a capture/raw-child representation proof plus a separate no-op-trivia-call guard, not a claim that AST building explains the whole gap. Every retained core change must have same-checkout A/B evidence plus core/spine/all-less/aggressive gates. | eval/render/fallback, detached declaration formatting, parser recognizer/capture, import/mixin placement scaling, node allocation | stable medians with fixed Node/fixture/options/cache/warmups/rounds, byte identity against Jess baseline, core/spine/all-less/aggressive gates, then merge/push |

#### Q-40 representation and allocation decisions — 2026-07-14

- **Reject merge-lookup caching as a canonical lever.** The reported 33,607
  direct declaration “cache misses” are all 22 synthesized property-merge
  references (`transition`, `transform`, `font-family`, `box-shadow`) walking
  child surfaces under required merge filters. They yield 37,554 child misses
  and only six public hits. The sole safe local-dominance proof fires once and
  deletes one child scan, so it is not worth landing; do not build an index,
  generic cache, or prototype scope engine from this counter.
- **Refresh the benchmark contract before every core comparison.** Current
  uninstrumented no-op pairs are 238.98 ms parse+render and 202.92 ms
  parse-once/render-only. Less 4 is 31.101 ms render on the same 20-warmup,
  45-sample machine run. The 36 ms parse portion matters, but it cannot account
  for Jess's 203 ms render-only result; rank eval/render ahead of parser cuts
  for the <40 ms target while holding parser POCs to separate three-phase gates.

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
