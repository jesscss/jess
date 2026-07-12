# V8 / Performance Suspicious Code Audit

Date: `2026-04-13`
Branch: `dev`

## Purpose

This document is a centralized dumping ground for code that looks suspicious
from a runtime performance / V8 optimization perspective.

This is intentionally broader than "confirmed benchmark root cause." A finding
may be:

- a likely hot-path problem
- a likely V8 deopt / hidden-class / polymorphism issue
- unnecessary allocation / cloning / temporary-object churn
- repeated scans / sorting / normalization that should be cached or incremental
- architectural work that should be zero-cost until a feature is actually used

## Regression Context

User-provided historical context for the same broad Less benchmark path:

- before the value-forking era, Jess was around `1.6x` Less runtime
- current linked `less.js` benchmark comparison is roughly `36x` to `46x`
  slower on the modern benchmark cases

That means this audit is not about shaving a small constant factor. It is about
recovering from a major architectural regression. Any finding that looks like
"global work," "copy-on-write churn," "speculative output," or "whole-tree
compat work" should be treated as a serious suspect until disproven.

## Scope Buckets

1. Registry / lookup / search
2. Serializer / output writer / rollback
3. Extend / selector matching / rewrite
4. Clone / copy / object churn
5. Import / reference-import / parse-load reuse
6. Less facade / compat / proxy boundary

## Review Standard

For each suspicious site, record:

- severity
- file and line reference
- what is suspicious
- why it is suspicious for perf or V8 specifically
- a short benchmark-facing hypothesis

## Findings

### Registry / Lookup / Search

- `high` [packages/core/src/tree/util/registry-utils.ts:858](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:858)
  `MixinRegistry.find()` scans `registry.index.values()` to find
  `entry.match === targetMatch` even after it already got the `startKey`
  bucket.
  Why suspicious: indexed lookup falls back into a full-index walk with
  repeated `arraysEqual()` calls.
  Hypothesis: nested mixin/ruleset lookup multiplies this cost until `find`
  dominates the benchmark.

- `high` [packages/core/src/tree/util/registry-utils.ts:1328](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:1328)
  [packages/core/src/tree/util/registry-utils.ts:1344](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:1344)
  [packages/core/src/tree/util/registry-utils.ts:1403](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:1403)
  `DeclarationRegistry.find()` repeatedly does set-to-array conversion, filter,
  sort, and then later another array conversion and sort to choose a winner.
  Why suspicious: repeated allocation and sorting in a hot path where
  declaration order is stable.
  Hypothesis: property-heavy files spend large CPU and GC budgets just ranking
  the same declaration candidates.

- `high` [packages/core/src/tree/util/registry-utils.ts:182](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:182)
  `_searchRulesChildren()` rebuilds `rulesSet = rulesSet.filter(...)` every
  time it runs.
  Why suspicious: full-array allocation happens before the actual child search.
  Hypothesis: untouched subtrees still pay broad re-filtering cost during
  repeated scope descent.

- `high` [packages/core/src/tree/util/registry-utils.ts:242](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:242)
  [packages/core/src/tree/util/registry-utils.ts:259](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:259)
  [packages/core/src/tree/util/registry-utils.ts:1384](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:1384)
  Recursive lookup paths keep recreating options objects with spread.
  Why suspicious: high-frequency `{ ...options }` churn hurts allocation and
  inlineability.
  Hypothesis: nested lookup recursion pays a steady object-churn tax on top of
  search cost.

- `high` [packages/core/src/tree/util/registry-utils.ts:827](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:827)
  On a start-key miss, `MixinRegistry.find()` walks the whole index for
  interpolated keys like `@{x}` and nests declaration lookups for each one.
  Why suspicious: full-index scan plus nested `rules.find('declaration', ...)`
  fan-out.
  Hypothesis: one mixin lookup can explode into many declaration lookups.

- `high` [packages/core/src/tree/util/registry-utils.ts:959](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:959)
  [packages/core/src/tree/util/registry-utils.ts:980](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:980)
  Candidate sets are cloned with `new Set(candidates)` and re-iterated just to
  detect newly added children and recurse/remove.
  Why suspicious: repeated full-set cloning in the hot path.
  Hypothesis: nested mixin lookup grows quadratic-ish as candidate sets expand.

- `medium-high` [packages/core/src/tree/util/registry-utils.ts:574](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:574)
  [packages/core/src/tree/util/registry-utils.ts:595](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:595)
  [packages/core/src/tree/util/registry-utils.ts:621](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:621)
  [packages/core/src/tree/util/registry-utils.ts:649](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:649)
  `MixinRegistry.indexPendingItems()` repeatedly recomputes selector keys,
  values, slices, and stringifications.
  Why suspicious: expensive normalization during incremental indexing instead of
  caching local callable keys.
  Hypothesis: indexing itself becomes a major hidden CPU bucket.

- `medium-high` [packages/core/src/tree/util/registry-utils.ts:54](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:54)
  [packages/core/src/tree/util/registry-utils.ts:21](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:21)
  `getOrderedSelectorKeys()` and `getSelectorKeyValues()` allocate fresh arrays
  every call.
  Why suspicious: same selector/keyset seems to be re-expanded repeatedly.
  Hypothesis: selector-heavy files repeatedly pay the same tree walks and array
  creation.

- `medium` [packages/core/src/tree/reference.ts:475](/Users/matthew/git/oss/jess/packages/core/src/tree/reference.ts:475)
  [packages/core/src/tree/reference.ts:501](/Users/matthew/git/oss/jess/packages/core/src/tree/reference.ts:501)
  [packages/core/src/tree/reference.ts:507](/Users/matthew/git/oss/jess/packages/core/src/tree/reference.ts:507)
  [packages/core/src/tree/reference.ts:515](/Users/matthew/git/oss/jess/packages/core/src/tree/reference.ts:515)
  [packages/core/src/tree/reference.ts:537](/Users/matthew/git/oss/jess/packages/core/src/tree/reference.ts:537)
  Reference resolution fans out into multiple full registry searches for the
  same key.
  Why suspicious: one authored reference can trigger several independent
  lookups up the same parent chain.
  Hypothesis: ambiguous property/function/mixin syntax amplifies registry cost
  well beyond authored reference count.

- `medium` [packages/core/src/tree/rules.ts:217](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts:217)
  Every `Rules.find()` call goes through `getRegistry()`, which may trigger
  `_indexRules()` if `rulesIndexed < value.length`.
  Why suspicious: hot lookups may repeatedly hit partial-index checks if rule
  arrays keep changing during eval.
  Hypothesis: dynamic rule emission adds indexing overhead before actual search.

### Serializer / Output Writer / Rollback

- `high` [packages/core/src/tree/rules.ts:475](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts:475)
  `emitBoundaryIfNeeded()` calls `w.getSince(0)` for every emitted child.
  Why suspicious: `getSince(0)` joins the entire output-so-far every time.
  Hypothesis: this is accidental quadratic behavior on large files.

- `high` [packages/core/src/tree/util/print.ts:209](/Users/matthew/git/oss/jess/packages/core/src/tree/util/print.ts:209)
  [packages/core/src/tree/util/print.ts:241](/Users/matthew/git/oss/jess/packages/core/src/tree/util/print.ts:241)
  [packages/core/src/tree/util/print.ts:254](/Users/matthew/git/oss/jess/packages/core/src/tree/util/print.ts:254)
  `getSince()`, `capture()`, and `captureWithMeta()` all materialize strings
  with `slice(...).join('')`, and captures also copy segment/signal arrays.
  Why suspicious: heavy speculative output means repeated joins, copies, and
  rollbacks.
  Hypothesis: direct source of the hot `getSince/restore/capture` cluster.

- `high` [packages/core/src/tree/util/serialize-helper.ts:252](/Users/matthew/git/oss/jess/packages/core/src/tree/util/serialize-helper.ts:252)
  [packages/core/src/tree/util/serialize-helper.ts:268](/Users/matthew/git/oss/jess/packages/core/src/tree/util/serialize-helper.ts:268)
  [packages/core/src/tree/util/serialize-helper.ts:277](/Users/matthew/git/oss/jess/packages/core/src/tree/util/serialize-helper.ts:277)
  Per-node `sourceChainHas()` BFS is used during serialization to ask
  “from reference import?” and “from call?”.
  Why suspicious: repeated ancestry BFS with fresh `Set` and queue allocation in
  a hot serializer loop.
  Hypothesis: import-origin suppression is implemented as repeated graph walks
  instead of explicit serializer state.

- `high` [packages/core/src/tree/util/serialize-helper.ts:284](/Users/matthew/git/oss/jess/packages/core/src/tree/util/serialize-helper.ts:284)
  [packages/core/src/tree/util/serialize-helper.ts:313](/Users/matthew/git/oss/jess/packages/core/src/tree/util/serialize-helper.ts:313)
  Duplicate-declaration pruning pre-serializes every declaration with a fresh
  `OutputWriter`.
  Why suspicious: a whole extra serialization pass with one writer/set/map
  allocation per declaration.
  Hypothesis: declaration-heavy files pay large speculative serialization cost
  before real output.

- `high` [packages/core/src/tree/util/serialize-helper.ts:416](/Users/matthew/git/oss/jess/packages/core/src/tree/util/serialize-helper.ts:416)
  [packages/core/src/tree/util/serialize-helper.ts:468](/Users/matthew/git/oss/jess/packages/core/src/tree/util/serialize-helper.ts:468)
  Frame reconciliation repeatedly recomputes header strings via capture and
  selector serialization.
  Why suspicious: repeated header rendering just to decide whether braces can
  stay open.
  Hypothesis: nested output with many siblings keeps reserializing the same
  headers.

- `high` [packages/core/src/tree/node-base.ts:1403](/Users/matthew/git/oss/jess/packages/core/src/tree/node-base.ts:1403)
  Generic `Node.toString()` does three captures per node: `pre`, `body`, `post`.
  Why suspicious: any node on the generic path pays three speculative
  serializations before actual output.
  Hypothesis: `OutputWriter.capture()` count is inflated by generic node
  printing, not just explicit serializer helpers.

- `medium` [packages/core/src/tree/util/print.ts:168](/Users/matthew/git/oss/jess/packages/core/src/tree/util/print.ts:168)
  [packages/core/src/tree/util/print.ts:188](/Users/matthew/git/oss/jess/packages/core/src/tree/util/print.ts:188)
  `OutputWriter.add()` pushes position and signal-position entries on every
  write.
  Why suspicious: very high-frequency tiny-object churn in the hottest loop.
  Hypothesis: heavy serialization with many small `add()` calls creates steady
  GC pressure.

- `medium` [packages/core/src/tree/sequence.ts:72](/Users/matthew/git/oss/jess/packages/core/src/tree/sequence.ts:72)
  [packages/core/src/tree/sequence.ts:79](/Users/matthew/git/oss/jess/packages/core/src/tree/sequence.ts:79)
  `Sequence.toTrimmedString()` uses `getSince(mark)`, `restore()`, and then
  `captureWithMeta()` mid-loop.
  Why suspicious: per-item backtracking just to detect boundary spacing.
  Hypothesis: value-heavy shorthand serialization creates another accidental
  quadratic path.

- `medium` [packages/core/src/tree/list.ts:56](/Users/matthew/git/oss/jess/packages/core/src/tree/list.ts:56)
  [packages/core/src/tree/list.ts:66](/Users/matthew/git/oss/jess/packages/core/src/tree/list.ts:66)
  `List.toTrimmedString()` captures every item and runs regex trim on each
  captured string.
  Why suspicious: repeated capture and regex cleanup instead of streaming.
  Hypothesis: list-heavy values add avoidable string churn.

### Extend / Selector Matching / Rewrite

- `high` [packages/core/src/tree/util/extend-roots.ts:531](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend-roots.ts:531)
  [packages/core/src/tree/util/extend-roots.ts:577](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend-roots.ts:577)
  [packages/core/src/tree/util/extend-roots.ts:607](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend-roots.ts:607)
  [packages/core/src/tree/util/extend-roots.ts:675](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend-roots.ts:675)
  `processExtends()` builds full instruction arrays, filters per root, classifies
  instructions per ruleset, then walks again to build apply-time instructions.
  Why suspicious: broad root × ruleset × instruction work before a ruleset is
  known to be affected.
  Hypothesis: touched and untouched rulesets alike pay too much upfront.

- `high` [packages/core/src/tree/util/extend-roots.ts:251](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend-roots.ts:251)
  [packages/core/src/tree/util/extend-roots.ts:281](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend-roots.ts:281)
  `analyzeNonPartialExtends()` calls full extend application inside analysis via
  `applyExtendsToSelector(selector, [instruction])`.
  Why suspicious: full simulation in classification rather than real
  application only.
  Hypothesis: non-partial extends pay for mini full-pipeline runs just to decide
  which branch to take.

- `high` [packages/core/src/tree/util/extend-roots.ts:408](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend-roots.ts:408)
  [packages/core/src/tree/util/extend-roots.ts:432](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend-roots.ts:432)
  `isSameOrDescendantRoot()` recursively walks roots without memoization.
  Why suspicious: repeated root-graph traversal during visibility checks.
  Hypothesis: layered root graphs multiply this cost.

- `high` [packages/core/src/tree/util/extend.ts:277](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend.ts:277)
  [packages/core/src/tree/util/extend.ts:345](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend.ts:345)
  [packages/core/src/tree/util/extend.ts:383](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend.ts:383)
  Chained extend queueing stringifies selectors and linearly searches expanded
  instruction arrays.
  Why suspicious: temporary string keys and O(N) instruction lookup during chain
  expansion.
  Hypothesis: long extend chains cause avoidable lookup churn on top of match
  cost.

- `high` [packages/core/src/tree/util/extend.ts:1343](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend.ts:1343)
  [packages/core/src/tree/util/extend.ts:1358](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend.ts:1358)
  `extendSelector()` retries matching with normalization after an initial miss.
  Why suspicious: miss path still does multiple full selector walks and
  `selectorCompare()` runs.
  Hypothesis: selectors that usually miss still burn CPU on normalization.

- `high` [packages/core/src/tree/util/extend.ts:3206](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend.ts:3206)
  [packages/core/src/tree/util/extend.ts:3280](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend.ts:3280)
  [packages/core/src/tree/util/extend.ts:3390](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend.ts:3390)
  [packages/core/src/tree/util/extend.ts:3421](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend.ts:3421)
  Ampersand boundary handling copies selector trees, traverses them, finds
  parents by another traversal, then copies again on replacement.
  Why suspicious: repeated copy plus repeated tree scans in one path.
  Hypothesis: nested ampersands can create quadratic-ish selector churn.

- `high` [packages/core/src/tree/util/extend.ts:558](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend.ts:558)
  [packages/core/src/tree/util/extend.ts:930](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend.ts:930)
  `createProcessedSelector()` is a giant polymorphic cleanup pipeline for many
  selector shapes.
  Why suspicious: heavy branching, array allocation, copying, sorting, and
  `valueOf()` work in one megafunction.
  Hypothesis: bad for V8 inlineability and hidden-class stability on the hot
  extend path.

- `high` [packages/core/src/tree/util/extend-walk.ts:140](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend-walk.ts:140)
  [packages/core/src/tree/util/extend-walk.ts:1001](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend-walk.ts:1001)
  Matching code repeatedly uses `valueOf()` for equivalence during recursive
  walks.
  Why suspicious: selector stringification in deep recursive matching.
  Hypothesis: `find` and extend matching are coupled through repeated selector
  serialization.

- `medium` [packages/core/src/tree/util/extend-walk.ts:281](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend-walk.ts:281)
  [packages/core/src/tree/util/extend-walk.ts:339](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend-walk.ts:339)
  `findSubsequence()` rebuilds virtual find components on every call.
  Why suspicious: fresh virtual compound objects and nested loops per target.
  Hypothesis: repeated multi-position matching pays setup costs that could live
  on precomputed specs.

- `medium` [packages/core/src/tree/util/extend-walk.ts:1252](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend-walk.ts:1252)
  [packages/core/src/tree/util/extend-walk.ts:1289](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend-walk.ts:1289)
  `wouldMatchWithParent()` allocates combinator wrappers and virtual arrays on
  every call.
  Why suspicious: nested selector-list parents create cross-product iteration
  with fresh virtual arrays.
  Hypothesis: nested selectors under selector-list parents explode match cost.

### Clone / Copy / Object Churn

- `high` [packages/core/src/tree/node-base.ts:1057](/Users/matthew/git/oss/jess/packages/core/src/tree/node-base.ts:1057)
  [packages/core/src/tree/node-base.ts:979](/Users/matthew/git/oss/jess/packages/core/src/tree/node-base.ts:979)
  [packages/core/src/tree/node-base.ts:952](/Users/matthew/git/oss/jess/packages/core/src/tree/node-base.ts:952)
  `Node.copy()` recursively re-clones the whole subtree while also rewriting
  comments to `Nil`.
  Why suspicious: deep copy is still the generic escape hatch in hot paths.
  Hypothesis: selector rewrite, import handling, and declaration merging create
  large transient object graphs and GC pressure.

- `high` [packages/core/src/tree/node-base.ts:552](/Users/matthew/git/oss/jess/packages/core/src/tree/node-base.ts:552)
  [packages/core/src/tree/node-base.ts:571](/Users/matthew/git/oss/jess/packages/core/src/tree/node-base.ts:571)
  Render-key writes clone object and array values on first mutation via `set()`.
  Why suspicious: copy-on-write of value containers even for small leaf changes.
  Hypothesis: render-key-heavy eval multiplies mutation cost.

- `high` [packages/core/src/tree/node-base.ts:446](/Users/matthew/git/oss/jess/packages/core/src/tree/node-base.ts:446)
  [packages/core/src/tree/rules.ts:2523](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts:2523)
  [packages/core/src/tree/rules.ts:2535](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts:2535)
  [packages/core/src/tree/import-style.ts:516](/Users/matthew/git/oss/jess/packages/core/src/tree/import-style.ts:516)
  `adopt()` rewrites parent/fork metadata on every attach, and many call sites
  repeatedly adopt freshly cloned nodes.
  Why suspicious: repeated clone-then-adopt turns list assembly into metadata
  churn and hidden-class churn.
  Hypothesis: repeated reparenting makes otherwise cheap paths expensive.

- `high` [packages/core/src/tree/rules.ts:2513](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts:2513)
  [packages/core/src/tree/rules.ts:2564](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts:2564)
  Mixin and ruleset invocation still deep-clone complete rule bodies before
  eval.
  Why suspicious: directly fights the canonical-tree + sparse-state direction.
  Hypothesis: body cloning alone can dominate allocation in benchmark-heavy
  mixin/ruleset code.

- `high` [packages/core/src/tree/rules.ts:1505](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts:1505)
  [packages/core/src/tree/rules.ts:1675](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts:1675)
  [packages/core/src/tree/declaration.ts:377](/Users/matthew/git/oss/jess/packages/core/src/tree/declaration.ts:377)
  Declaration merge normalization repeatedly copies prior values, next values,
  list children, normalized tails, and accumulated merged values.
  Why suspicious: copy-heavy before serialization even begins.
  Hypothesis: repeated declaration patterns trigger quadratic-ish object churn.

- `high` [packages/core/src/tree/ruleset.ts:527](/Users/matthew/git/oss/jess/packages/core/src/tree/ruleset.ts:527)
  [packages/core/src/tree/ruleset.ts:620](/Users/matthew/git/oss/jess/packages/core/src/tree/ruleset.ts:620)
  Selector materialization for hoisted implicit ampersands does recursive
  `copy(true)` almost everywhere.
  Why suspicious: full-selector rematerialization when only one implicit
  ampersand may need replacement.
  Hypothesis: nested and extended selectors rebuild too much structure.

- `medium-high` [packages/core/src/tree/import-style.ts:267](/Users/matthew/git/oss/jess/packages/core/src/tree/import-style.ts:267)
  [packages/core/src/tree/import-style.ts:657](/Users/matthew/git/oss/jess/packages/core/src/tree/import-style.ts:657)
  Import handling shallow-clones wrapper rules, rebuilds arrays, and re-registers
  nodes.
  Why suspicious: wrapper churn plus array churn plus registry churn around
  imports.
  Hypothesis: import finalization is far more expensive than a cheap scope flag.

- `medium-high` [packages/core/src/tree/selector.ts:71](/Users/matthew/git/oss/jess/packages/core/src/tree/selector.ts:71)
  [packages/core/src/tree/selector.ts:176](/Users/matthew/git/oss/jess/packages/core/src/tree/selector.ts:176)
  Selector key-set computation clones and ORs bitsets repeatedly, and `inherit()`
  re-adopts nested children.
  Why suspicious: recomputation and re-adoption in hot selector flows.
  Hypothesis: selector-heavy files rebuild key-set caches too often.

- `medium-high` [packages/core/src/tree/ampersand.ts:167](/Users/matthew/git/oss/jess/packages/core/src/tree/ampersand.ts:167)
  [packages/core/src/tree/ampersand.ts:349](/Users/matthew/git/oss/jess/packages/core/src/tree/ampersand.ts:349)
  Ampersand resolution builds fresh selector lists and strings and clones
  selectors for append forms.
  Why suspicious: repeated `copy(true)`, `clone(true)`, `toTrimmedString()`,
  string replacement, and node traversal.
  Hypothesis: nested selectors and suffix ampersands allocate too much.

- `medium` [packages/core/src/tree/node-base.ts:834](/Users/matthew/git/oss/jess/packages/core/src/tree/node-base.ts:834)
  `Node.children()` materializes an intermediate `nodes[]` array before
  yielding.
  Why suspicious: every traversal allocates an array of child nodes.
  Hypothesis: repeated traversals add steady temporary-allocation pressure.

- `medium` [packages/core/src/tree/node-base.ts:722](/Users/matthew/git/oss/jess/packages/core/src/tree/node-base.ts:722)
  [packages/core/src/tree/node-base.ts:738](/Users/matthew/git/oss/jess/packages/core/src/tree/node-base.ts:738)
  `Node._visitValues()` uses `Object.values()` on plain objects.
  Why suspicious: array allocation on every walk of object-valued nodes.
  Hypothesis: contributes to constant background allocation during eval.

### Import / Reference-Import / Parse-Load Reuse

- `high` [packages/core/src/tree/util/serialize-helper.ts:252](/Users/matthew/git/oss/jess/packages/core/src/tree/util/serialize-helper.ts:252)
  `sourceChainHas()` does a fresh BFS over `sourceNode`, `sourceParent`, and
  `parent` links for `originatesFromReferenceImport()` and `originatesFromCall()`.
  Why suspicious: repeated ancestry walking in the hot serializer loop.
  Hypothesis: import-origin suppression is paying repeated graph-walk cost
  instead of using explicit push/pop render state.

- `high` [packages/core/src/tree/import-style.ts:657](/Users/matthew/git/oss/jess/packages/core/src/tree/import-style.ts:657)
  Import finalization re-registers local root rulesets by walking
  `finalRules.nodes()` and re-adding descendants into the registry.
  Why suspicious: full-tree rescans after import finalization.
  Hypothesis: wrapper/finalization churn forces rebuild work rather than
  preserving registry state incrementally.

- `high` [packages/core/src/context.ts:483](/Users/matthew/git/oss/jess/packages/core/src/context.ts:483)
  `_getPath()` has no memoization and re-runs expand/resolve/locate/module
  fallback probing on every import path resolution.
  Why suspicious: source-tree caching does not prevent repeated path-resolution
  work.
  Hypothesis: repeated import probes burn time before cache hits can help.

- `high` [packages/core/src/tree/import-style.ts:422](/Users/matthew/git/oss/jess/packages/core/src/tree/import-style.ts:422)
  `withValues` import handling clones wrappers, rebuilds declaration registry
  state, indexes pending items, splices arrays, adopts nodes, and flattens into
  a new `Rules`.
  Why suspicious: large object, registry, and array churn in one path.
  Hypothesis: configured imports are disproportionately expensive even before
  normal eval.

- `medium-high` [packages/core/src/tree/import-style.ts:337](/Users/matthew/git/oss/jess/packages/core/src/tree/import-style.ts:337)
  `finalize()` mutates import options, pushes/pops scopes, switches treeContext,
  may resolve paths again, may fetch cached eval trees, may push extend roots,
  and may clone/wrap again.
  Why suspicious: a branch-heavy orchestration method shared by simple and
  reference imports.
  Hypothesis: cheap imports still pay for compose/protected/dedupe/with/set
  machinery.

- `medium-high` [packages/core/src/tree/import-style.ts:267](/Users/matthew/git/oss/jess/packages/core/src/tree/import-style.ts:267)
  `getFinalRules()` clones the evaluated `Rules` wrapper on every import
  finalization just to attach per-scope options.
  Why suspicious: wrapper churn even when the underlying tree is cached.
  Hypothesis: repeated imports of the same file still allocate fresh wrappers.

- `medium` [packages/core/src/context.ts:631](/Users/matthew/git/oss/jess/packages/core/src/context.ts:631)
  [packages/core/src/context.ts:638](/Users/matthew/git/oss/jess/packages/core/src/context.ts:638)
  `getTree()` still scans plugins for `getSource` and redoes extension/plugin
  selection on every call.
  Why suspicious: repeated dispatch overhead in a path that should collapse to a
  cheap cache hit.
  Hypothesis: import graphs pay steady overhead even when trees are cached.

- `medium` [packages/core/src/context.ts:363](/Users/matthew/git/oss/jess/packages/core/src/context.ts:363)
  `inReferenceImportScope` and `inMultipleImportScope` use `.some(...)` over the
  whole stack on every read.
  Why suspicious: branch-state scans instead of constant-time counters/flags.
  Hypothesis: nested import-heavy evaluation repeatedly pays O(stack depth)
  checks.

- `medium` [packages/core/src/tree/import-style.ts:186](/Users/matthew/git/oss/jess/packages/core/src/tree/import-style.ts:186)
  `queueCssImport()` dedupes by linear scan of `topImports`, building signature
  strings from location/prelude.
  Why suspicious: O(n) dedupe plus repeated stringification.
  Hypothesis: stylesheets with many preserved CSS imports pay unnecessary output
  import overhead.

### Less Facade / Compat / Proxy Boundary

- `high` [packages/jess-plugin-less-compat/src/plugin.ts:124](/Users/matthew/git/oss/jess/packages/jess-plugin-less-compat/src/plugin.ts:124)
  [packages/jess-plugin-less-compat/src/plugin.ts:189](/Users/matthew/git/oss/jess/packages/jess-plugin-less-compat/src/plugin.ts:189)
  [packages/jess-plugin-less-compat/src/plugin.ts:606](/Users/matthew/git/oss/jess/packages/jess-plugin-less-compat/src/plugin.ts:606)
  [packages/jess-plugin-less-compat/src/plugin.ts:1000](/Users/matthew/git/oss/jess/packages/jess-plugin-less-compat/src/plugin.ts:1000)
  [packages/jess/src/index.ts:705](/Users/matthew/git/oss/jess/packages/jess/src/index.ts:705)
  `less-compat` always exposes a `preEvalVisitor`, even when there are no
  initial visitors and no `@plugin` in the file.
  Why suspicious: that guarantees a full-tree pre-eval visitor pass just to
  discover nothing needs compat.
  Hypothesis: if `lessCompatPlugin()` is globally configured, benchmark renders
  pay node-by-node compat cost before normal eval.

- `high` [packages/jess-plugin-less-compat/src/plugin.ts:217](/Users/matthew/git/oss/jess/packages/jess-plugin-less-compat/src/plugin.ts:217)
  [packages/jess-plugin-less-compat/src/plugin.ts:389](/Users/matthew/git/oss/jess/packages/jess-plugin-less-compat/src/plugin.ts:389)
  `visitor()` eagerly creates Less runtime scaffolding, registry proxies, plugin
  manager state, and closure-heavy helpers before compat is proven necessary.
  Why suspicious: a lot of startup allocation and proxy setup is front-loaded.
  Hypothesis: render startup cost scales badly even when no Less plugin visitor
  touches the AST.

- `high` [packages/jess-plugin-less-compat/src/plugin.ts:1054](/Users/matthew/git/oss/jess/packages/jess-plugin-less-compat/src/plugin.ts:1054)
  [packages/jess-plugin-less-compat/src/plugin.ts:1071](/Users/matthew/git/oss/jess/packages/jess-plugin-less-compat/src/plugin.ts:1071)
  Every compat-visited node is converted with `toLessNode(...)` before the code
  checks whether any Less visitors are present or whether any visitor will ask
  for child nodes.
  Why suspicious: proxy creation and conversion happen at node entry, not on
  demand.
  Hypothesis: hot nodes are being converted into Less proxies even when compat
  visitors are absent or noop.

- `high` [packages/jess-plugin-less-compat/src/transform/to-less.ts:67](/Users/matthew/git/oss/jess/packages/jess-plugin-less-compat/src/transform/to-less.ts:67)
  [packages/jess-plugin-less-compat/src/transform/to-less.ts:84](/Users/matthew/git/oss/jess/packages/jess-plugin-less-compat/src/transform/to-less.ts:84)
  plus adapter/node mappers in `src/nodes/*`
  Child conversion is only lazy at property-access granularity, and when hit it
  eagerly maps arrays and objects of converted children.
  Why suspicious: repeated `.map(...)`, object copies, nested conversions, and
  unstable shapes.
  Hypothesis: V8 loses inline-cache stability once compat visitors touch
  selectors, rulesets, and lists.

- `high` [packages/jess-plugin-less-compat/src/plugin-utils.ts:10](/Users/matthew/git/oss/jess/packages/jess-plugin-less-compat/src/plugin-utils.ts:10)
  [packages/jess-plugin-less-compat/src/plugin-utils.ts:91](/Users/matthew/git/oss/jess/packages/jess-plugin-less-compat/src/plugin-utils.ts:91)
  `filterPlugins()` speculatively calls constructors and functions to classify
  plugins.
  Why suspicious: side effects, duplicate instantiation, and megamorphic plugin
  shapes before real use.
  Hypothesis: plugin-array construction adds startup cost before compilation.

- `medium` [packages/jess-plugin-less-compat/src/transform/proxy.ts:42](/Users/matthew/git/oss/jess/packages/jess-plugin-less-compat/src/transform/proxy.ts:42)
  Compat nodes are real JS `Proxy` wrappers.
  Why suspicious: `Proxy` blocks many ordinary property-access optimizations and
  makes inline caches brittle.
  Hypothesis: once compat is active, every wrapped-node property read gets
  slower and less predictable under V8.

- `medium` [packages/jess/src/index.ts:682](/Users/matthew/git/oss/jess/packages/jess/src/index.ts:682)
  [packages/jess/src/index.ts:698](/Users/matthew/git/oss/jess/packages/jess/src/index.ts:698)
  `applyPreEvalVisitors()` does two passes and calls `setContext` and
  `setCurrentFilePath` on every plugin on every render.
  Why suspicious: per-plugin mutable setup occurs before a plugin is known to do
  useful work.
  Hypothesis: globally configured compat plugins become nontrivial overhead even
  when effectively idle.

- `medium` [packages/jess/src/index.ts:617](/Users/matthew/git/oss/jess/packages/jess/src/index.ts:617)
  [packages/jess/src/index.ts:624](/Users/matthew/git/oss/jess/packages/jess/src/index.ts:624)
  [packages/jess/src/index.ts:546](/Users/matthew/git/oss/jess/packages/jess/src/index.ts:546)
  `jess` always tries to create and register the lazy JS plugin proxy if
  `@jesscss/plugin-js` is resolvable.
  Why suspicious: violates the same zero-cost principle at the facade boundary.
  Hypothesis: smaller than less-compat, but still needless startup work.

## Notes

- This audit should stay additive and concrete.
- If a finding is merely stylistic, do not include it.
- Prefer "this allocates N temporary arrays in a hot loop" over vague language.
- Prefer direct file references over paraphrased module descriptions.
