# Core Architecture Performance Handoff

This file is the benchmark/profile doctrine and evidence log for Jess core
architecture work.

Use `HANDOFF.md` for active integration: current mode, next pass, and the
specific benchmark leash applied to the queue. Use
`AGGRESSIVE-CUTTING-REVIEW.md` for the hardline cutting doctrine. Use this file
for benchmark protocol, measured targets, rejected experiments, historical
evidence, active performance queues, and reactivation thresholds.

Current mode: **benchmark-leashed aggressive cutting**. Performance is no
longer merely parked. The active handoff decides the next target, but the
target must be tied back to this file's benchmark/profile evidence rules.

## Preserved Lesson

Historical transition docs were removed from the working tree. The durable
lesson they preserved remains: the target is still one canonical source tree,
explicit live lookup/binding state, source-order render/eval, temporary output
state, and no routine copied evaluated AST.

## Historical Evidence To Preserve

The April 2026 broad Less benchmark audit found a real architectural
regression, not a small constant-factor problem:

- owner context at the time: before the value-forking era, Jess was roughly
  `1.6x` Less runtime on the broad benchmark path;
- April comparison: modern benchmark cases were roughly `36x` to `46x` slower
  than Less;
- `benchmark.less`: Jess `1724.7ms` avg vs Less `47.4ms` avg;
- `benchmark-v39.less`: Jess `29.1ms` avg vs Less `4.6ms` avg;
- older/smaller fixtures were competitive or faster, so the slowdown was tied
  to modern Less features and runtime architecture, not a universal parser or
  serializer tax.

Representative one-render instrumentation for broad `benchmark.less` showed:

- `Rules.find`: `301,333` calls;
- `DeclarationRegistry.find`: `260,728` calls;
- `Reference.evalNode`: `12,037` calls;
- `OutputWriter.capture`: `515,451` calls;
- `OutputWriter.getSince`: `1,064,254` calls;
- `OutputWriter.restore`: `522,538` calls;
- `OutputWriter.mark`: `1,132,616` calls;
- `Node.clone`: `92,683` calls;
- `Node.copy`: `73,607` calls.

The registry audit also found extremely hot declaration keys, especially
lexical globals and recursive mixin/loop variables:

- `base-hue`: `93,810`;
- `icon-prefix`: `28,920`;
- `i`: `28,853`;
- `base-url`: `27,580`;
- `white`: `17,444`;
- `cols`: `11,745`.

Carry this forward as the performance thesis:

- lookup must become direct frame/binding access for hot reference types;
- declaration lookup must not allocate `Set`s, convert to arrays, sort, and
  repeat generic recursive searches for ordinary variable reads;
- writer capture/rollback must not stringify or slice output just to inspect
  then throw away the result;
- copy/clone/inherit/frozen must not be routine eval/render isolation;
- extend work must be selective to touched roots/rulesets and avoid repeated
  full-tree searches, selector stringification, and cloned selector structures.

## Current Policy

Performance is active again as a leash on aggressive cutting. The next broad
eval/render/lookup/copy/rules/render-buffer change must start from a current
benchmark or profile target and end with the same benchmark/profile rerun.

In benchmark-leashed cutting mode:

- keep the aggressive-cutting posture: delete machinery and semantic reasons
  for work rather than polishing helpers;
- run focused tests and full gates before claiming behavior progress;
- run stable hot-path benchmarks before and after non-trivial hot-path edits;
- use profiler/counter/CPU-profile evidence to choose targets, not to claim
  "Jess got faster";
- do not claim speed wins without real benchmark evidence;
- reject or reshape changes that reduce local object counts but slow or fail
  to improve the real benchmark, unless the change fixes correctness and the
  regression is explicitly accepted as debt.

## Reactivation Threshold

Full performance rounds are currently active. If future work parks performance
again, bring full performance rounds back as active work when any one of these
is true:

1. A broad architecture batch touches one of the measured hot surfaces:
   reference lookup/render, callable output/body placement, rules/ruleset body
   rendering, at-rule header/body rendering, extend matching, parser/compat
   facade, `OutputWriter`, `Node` traversal, `clone/copy/inherit/frozen`, or
   `List`/`Sequence` materialization.
2. Two consecutive queue passes land without removing obvious hot-path object
   creation/function-call/generator/Array-helper waste.
3. The full alpha/correctness queue is clear and the next proposed work is a
   performance-motivated rewrite rather than a local deletion.
4. `pnpm run measure:less:hotpath` shows a median regression of roughly **10% or
   more** on any primary fixture, or a consistent smaller regression across two
   consecutive samples.
5. A CPU/V8 profile shows a concrete top-frame surface whose fix is not a small
   local cleanup.

Once reactivated, do not do unmeasured performance work. Every performance
round needs a before snapshot, one hypothesis, one patch, focused tests, the
same after snapshot, and a keep/revert decision.

## Required Real Benchmark Inputs

Record Jess alpha hot-path snapshots:

```sh
pnpm run measure:less:hotpath -- --stable
```

Treat the printed `signal=` field as the benchmark trust gate. `usable` can
support a keep/revert decision, `unstable` needs another run or CPU/allocation
profile corroboration, and `noisy` is not decision-quality evidence.

For quick smoke checks during cutting, the cheaper bounded run is still useful
as a regression tripwire:

```sh
pnpm run measure:less:hotpath -- --iterations 15 --warmup 5
```

Use saved hot-path fixture comparisons when keeping a patch:

```sh
pnpm run measure:less:hotpath:record -- --stable --note "<short hypothesis/result>"
```

The broad Less benchmark fixture can still be inspected when
`/Users/matthew/git/oss/less.js` is available:

```sh
node scripts/profile-less-benchmark.mjs --file=benchmark.less
```

## Required Profile Inputs

Build the relevant packages before profiling:

```sh
pnpm --filter @jesscss/core build
pnpm --filter @jesscss/less-parser build
pnpm --filter @jesscss/plugin-less build
pnpm --filter @jesscss/plugin-less-compat build
pnpm --filter jess build
```

Use profiler/counter runs for diagnosis, not user-facing speed claims:

```sh
node scripts/profile-less-benchmark.mjs --file=benchmark-v37.less
node scripts/profile-less-benchmark.mjs --file=benchmark-v39.less
node scripts/profile-less-benchmark.mjs --file=benchmark-color-stress.less
node scripts/profile-less-benchmark.mjs --file=benchmark.less
```

Use CPU profiles when call stacks are unclear:

```sh
./scripts/profile-test.sh core "<test-file-or-filter>"
./scripts/profile-test.sh jess "<test-file-or-filter>"
```

Use phase timing only as diagnostic support:

```sh
JESS_PROFILE=1 node scripts/profile-less-benchmark.mjs --file=benchmark-v37.less
```

## Evidence Rules

- **Real benchmark** numbers are the only numbers that count as "Jess got
  faster/slower".
- **Instrumented profiler** numbers are diagnostic counters/timings only.
- **CPU profile** sample counts identify hot stacks; they are not benchmark
  timings.
- Static node/object audits are supporting evidence only.

If a patch reduces local object counts but slows real benchmarks, reject or
reshape it.

## Current Evidence Log

### 2026-06-06 ScopeFrame Callable Hit/Miss Prototype

Hypothesis: simple static callable hits, and the subset of simple misses whose
surface coverage is already known, should be represented by the active binding
frame before the older recursive callable lookup path. This should be proved
with callable/mixin/import fixtures, not by claiming a broad benchmark win,
because the current `benchmark-v39.less` diagnostic profile is dominated by
variables and JS function calls.

Before patch:

- `node scripts/profile-less-benchmark.mjs --file=benchmark-v39.less` reported
  `Reference.evalNode` `482` calls / `5.27ms` and `Rules.find` `68` calls /
  `0.42ms`;
- `lookupStats.rulesFindByType` was `{ "function": 68 }`, so there were no
  measured mixin/ruleset `Rules.find` calls in that fixture;
- quick hot-path leash
  `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5` was mixed:
  `functions` `15.31ms` unstable, `import-reference` `22.16ms` usable,
  `mixins-guards` `18.23ms` usable, `extend-chaining` `5.91ms` unstable,
  `media` `6.63ms` unstable.

Patch shape:

- `ScopeFrame.callableBucketsByName` now reuses the existing
  `Rules.mixinsByName` arrays when present; no per-callable wrapper object,
  output cache, or node copy was added;
- an empty `Map` sentinel was rejected after `audit:node-creation` showed it
  raised the static `new-node` count from `321` to `322`; the field is optional
  instead;
- `Rules.find('mixin', staticKey, ...)` checks only the current already-built
  frame for direct, non-targeted, non-local lookups. It returns covered static
  hits without entering `Rules.findMixinsFast(...)`; it does not call
  `getScopeFrame(...)` just to attempt the shortcut;
- simple static misses stop only when `callableMissesCovered` proves the
  current frame has no child callable surfaces and no reference-import callable
  surfaces;
- targeted, namespace, local/import-visibility, child-surface, and guard
  ambiguity paths remain on the bridge until those facts are encoded in binding
  state.

Evidence:

- focused `mixin.test.ts` and `scope-frame.test.ts` passed for the initial hit
  slice (`137` tests);
- new focused tests prove direct `Rules.find(...)` static `Mixin` and simple
  `Ruleset`-as-mixin hits skip `Rules.findMixinsFast(...)` when a frame
  already exists;
- new miss tests prove a direct static miss skips `Rules.findMixinsFast(...)`
  only when no child callable surfaces exist, and keeps the bridge when child
  surfaces exist;
- regression caught: a parent-frame discovery attempt caused bad `.mixin`
  misses in import-reference namespace behavior; the shortcut now refuses
  ancestor discovery and targeted/local lookup;
- final focused callable/import gate passed (`162` tests; `78` skipped by
  filter);
- `@jesscss/core` build passed;
- post-miss `node scripts/profile-less-benchmark.mjs --file=benchmark-v39.less`
  reported `Reference.evalNode` `482` calls / `4.80ms` and `Rules.find` `68`
  calls / `0.34ms`; `Rules.find` remained only function lookup in this
  fixture, so this is diagnostic status, not a broad speed claim;
- post-miss quick hot-path leash
  `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5` reported
  `functions` `12.91ms` usable, `import-reference` `17.56ms` usable,
  `mixins-guards` `15.43ms` usable, `extend-chaining` `5.07ms` unstable, and
  `media` `5.34ms` usable;
- post-miss `pnpm run audit:node-creation` reported `new-node: 321`,
  `with-surface: 33`, `derive: 30`, `copy-leaves: 28`.

Verdict: keep as binding integration progress only. Do not claim a broad speed
win from this slice. The next callable binding target is representing
targeted/namespace/import/child-surface callable facts in binding state so those
bridges can be deleted without ancestor walks or generic registry rediscovery.

### 2026-06-05 Callable Default-Guard Classification

Hypothesis: `prepareCallableEvalCandidates(...)` should not recursively inspect
candidate guards to rediscover `default()`. The parser already knows whether a
guard contains `default()` while parsing Less guard syntax, so parsed Less must
carry explicit `hasDefault: true | false`; direct API construction can infer
the flag once at construction/entry creation when the option is omitted.

Before patch:

- stable hot-path baseline on commit `9d3ea09467ca480fb18fe7d17418459e346b04fa`:
  `functions` median `13.74ms`, `import-reference` median `22.04ms`,
  `mixins-guards` median `74.84ms`;
- broad instrumented `benchmark.less`: `Reference.evalNode` `3619` calls /
  `94.12ms`, `Rules.find` `1013` calls / `30.26ms`, `OutputWriter.getSince`
  `149331` calls / `5.45ms`;
- CPU profile top frames included `guardContainsDefault` `313` samples,
  `copyChild` `148`, `Node` `43`, `copyCallableRulesValue` `25`,
  `findWithinScopeSurface` `19`, `findVarWithinScopeSurface` `15`,
  `copyWithReusableLeaves` `12`, and `inherit` `11`;
- node-creation audit stayed broad: `new-node` `321`, `with-surface` `36`,
  `copy-leaves` `31`, `derive` `30`.

Patch kept:

- `packages/less-parser/src/productions/root.ts` passes `hasDefault: true` or
  `hasDefault: false` for guarded Less mixins/rulesets;
- `packages/core/src/tree/util/callable-candidate.ts` trusts
  `candidate.options?.hasDefault === true` and no longer scans guard trees or
  rewrites candidate metadata in the candidate loop;
- `Mixin`/`Ruleset` constructors and `callableRulesEntry(...)` infer the flag
  only for direct/synthetic construction when the caller did not provide it.

After patch:

- stable hot-path benchmark: `functions` median `12.86ms`,
  `import-reference` median `19.78ms`, `mixins-guards` median `18.74ms`,
  `extend-chaining` median `5.30ms`, `media` median `6.46ms`; all five
  signals were `usable`;
- final CPU profile
  `profiling/core-architecture/CPU.20260605.174243.84124.0.001.cpuprofile`
  showed `guardContainsDefault = 0` samples and
  `callableGuardContainsDefault = 0` samples;
- final broad instrumented `benchmark.less`: `Reference.evalNode` `3619` calls
  / `92.71ms`, `Rules.find` `1013` calls / `30.31ms`,
  `OutputWriter.getSince` `149331` calls / `5.51ms`;
- final CPU top frames shifted to copy/ownership and lookup:
  `copyChild` `144`, `Node` `35`, `copyCallableRulesValue` `24`,
  `findVarWithinScopeSurface` `23`, `findWithinScopeSurface` `14`,
  `copyWithReusableLeaves` `11`, `constructCopy` `10`, `inherit` `9`.

Next measured target:

- Copy/ownership is now the hottest concrete stack, not guard detection.
  `copyChild` samples group under `copyValueForDerived` (`45`),
  `getHeaderString` (`42`), `callWithContext` (`28`), `ownSelector` (`28`),
  `createRegistrationState` (`22`), `evaluateReferenceValueNode` (`20`), and
  `cloneBoundValue` (`9`). Treat this as evidence of registration derivation,
  selector header rendering, JS function argument ownership, reference value
  eval, and binding clone debt, not as evidence that final CSS rendering needs
  child copying.
- Repeated callable/mixin eval is suspicious. Before more helper polish, count
  semantic mixin calls versus candidate/output evals and decide whether live
  placement/binding state can avoid repeated body evaluation or copied public
  materialization.

### 2026-06-05 Static Reference Value Copy Cut

Hypothesis: a static non-rules-like referenced value should not be copied merely
because it has source trivia or child nodes. `F_STATIC` already means the value
is inert for eval, so routine reference eval/render can reuse the canonical
static value. Rules-like values stay excluded until callable/public ownership is
handled by explicit placement/materialization state.

Before patch:

- CPU profile
  `profiling/core-architecture/CPU.20260605.175415.48626.0.001.cpuprofile`
  showed `Reference.evalNode` at `146 / 1234` samples (`11.8%`);
- `Reference.evalNode` bucket split: copy/result ownership `47` samples,
  callable lookup/mixin registry `30`, variable declaration lookup `21`,
  function/declaration registry lookup `19`, result finalization/eval value
  `16`, target/key normalization `10`, variable live binding lookup `2`;
- copy leaves included `copyChild` `26` samples. This was evidence that the
  hot reference story was not only raw `Rules.find(...)`; looked-up value
  finalization and ownership copying were a large part of the stack.

Patch kept:

- `packages/core/src/tree/reference.ts` now allows
  `canReturnReferenceValue(...)` for any `F_STATIC` non-rules-like value;
- deleted `canReturnSourceFreeReferenceContainer(...)` and
  `canRenderReferenceContainerText(...)`, removing the child scans that tried
  to re-prove source-free reusable leaves on every reference result path;
- no new traversal, node creation, parent/source mutation, `.inherit(...)`, or
  copy helper was added.

After patch:

- CPU profile
  `profiling/core-architecture/CPU.20260605.180616.3382.0.001.cpuprofile`
  showed `Reference.evalNode` at `133 / 1183` samples (`11.2%`);
- `Reference.evalNode` bucket split: copy/result ownership `26` samples,
  callable lookup/mixin registry `56`, variable declaration lookup `32`,
  function/declaration registry lookup `7`, result finalization/eval value
  `12`, target/key normalization `0`, variable live binding lookup `0`;
- top leaves were `findVarWithinScopeSurface` `17`, `copyChild` `15`,
  `findWithinScopeSurface` `12` total across two lines, and smaller
  finalization/key frames;
- hot-path sanity benchmark after this patch: `functions` median `15.18ms`,
  `import-reference` median `21.34ms`, `mixins-guards` median `18.28ms`,
  `extend-chaining` median `5.65ms`, `media` median `6.76ms` with `media`
  noisy. Compared with the prior stable snapshot (`functions` `12.86ms`,
  `import-reference` `19.78ms`, `mixins-guards` `18.74ms`,
  `extend-chaining` `5.30ms`, `media` `6.46ms`), this is mixed and not a
  speed win.

Next measured target:

- The remaining `Reference.evalNode` story is lookup plus callable output
  evaluation, not live binding lookup itself. `findVarWithinScopeSurface` is
  the top leaf, but callable/mixin evaluation owns the largest semantic bucket.
  Before adding helper polish, count semantic mixin/reference calls against
  candidate/output eval work and keep cutting copy/materialization pressure
  around the looked-up value path.

### 2026-06-05 Reference Class Surface Cut

Hypothesis: `Reference` still had method-level cruft that could be deleted
without changing semantics: alias predicate wrappers, a useless Promise identity
wrapper, and nested render closures allocated before the direct raw lookup
could decide whether a static referenced value can render immediately.

Patch kept:

- `packages/core/src/tree/reference.ts` deleted
  `canReturnReferenceValueWithoutCopy(...)` and
  `canRenderReferenceValueTextOnly(...)`, both of which only called
  `canReturnReferenceValue(...)`;
- `Reference.evalNode(...)` now returns the `MaybePromise<Node>` from
  `evaluateReferenceNode(...)` directly instead of wrapping thenables in an
  identity `.then(...)`;
- `Reference.render(...)` keeps the direct raw static-reference path in
  straight-line code instead of allocating `renderResolved`, `renderRaw`, and
  `renderThroughEvaluator` closures first;
- rules lookup options are filled directly on one `FindOptions` object instead
  of building spread fragments through `getContextualReferenceLookupStart(...)`
  and `getLiveReferenceLookupStart(...)`;
- leaky rules lookup no longer builds a temporary scope array or recursive
  local walker for `[resolvedTarget, rulesParent, sourceRulesParent]`;
- `Reference.renderReferenceSyntax(...)` moved its syntax-key emitter out of a
  per-call nested closure. The array-key loop already existed; no new traversal
  or node creation was introduced.

Evidence:

- focused Reference-family tests passed: `410` tests across
  `reference`, `mixin`, `declaration`, `ruleset`, `list`, `sequence`,
  `condition`, and `operation`;
- hot-path sanity benchmark after this patch:
  `functions` median `12.99ms`, `import-reference` median `19.67ms`,
  `mixins-guards` median `17.17ms`, `extend-chaining` median `5.09ms`
  (`unstable`), and `media` median `6.18ms`;
- this is not a speed claim because the pass did not capture a clean
  before/after pair. Treat it as a benchmark leash status line only.

Next measured target:

- Continue `Reference` before moving to the next node. The remaining target is
  the copy/materialization ownership cluster, especially rules-like reference
  value surfaces, `evaluateReferenceValueNode(...)` copy pressure, declaration
  finalization, merged assign normalization, and key evaluation/conversion.

### 2026-06-06 Reference Main Eval Lookup Surface Cut

Hypothesis: the raw render path was no longer paying eager lookup/finalizer
closures, but the main `Reference` eval/render path still allocated the same
kind of closures before ordinary synchronous lookup. This pass deletes that
setup work without changing lookup semantics or claiming a measured speed win.

Patch kept:

- `evaluateReferenceNode(...)` no longer allocates local `finishLookup`,
  `runLookup`, `resolveTargetValue`, or `evaluateKey` closures before the sync
  path can run;
- the direct static-render check is preserved for sync and async lookup
  results;
- `finalizeRuntimeVarBindingResult(...)` no longer checks
  `canReturnReferenceValue(...)` twice for the same evaluated binding;
- `evaluateReferenceValueNode(...)` folds the two source-reuse static-return
  branches into one condition.

Evidence:

- `pnpm exec eslint packages/core/src/tree/reference.ts` passed;
- `pnpm --filter @jesscss/core build` passed with the existing `js-expr.ts`
  direct-eval bundler warning;
- focused Reference/mixin tests passed after build: `226` tests;
- broader affected tests passed: `410` tests across `reference`, `mixin`,
  `declaration`, `ruleset`, `list`, `sequence`, `condition`, and `operation`;
- hot-path sanity benchmark after this patch:
  `functions` median `13.70ms`, `import-reference` median `20.68ms`,
  `mixins-guards` median `17.58ms`, `extend-chaining` median `5.69ms`, and
  `media` median `6.68ms`; all five signals were usable;
- no speed claim. This pass did not capture a clean before/after benchmark
  pair, so the benchmark is a leash sanity line only.

### 2026-06-05 Reference Raw Lookup Surface Cut

Hypothesis: `Reference` still had obvious sync-path setup work that could be
deleted before the next measured copy/materialization pass. The target was
machinery, not a measured performance claim.

Patch kept:

- `evaluateFallbackValue(...)` now relies on `canReturnReferenceValue(...)`
  directly instead of checking the same static condition in a narrower first
  branch;
- `finalizeDeclarationReferenceResult(...)` computes
  `hasImportantDeclarationValue(...)` once and reuses the value for the
  text-only return branch and declaration-value evaluation;
- `evaluateReferenceValueNode(...)` no longer contains two adjacent branches
  that both called `copyWithReusableLeaves(declValue).eval(context)`;
- rules-like callable candidates no longer re-run `isNode(...)` checks after
  the loop has already validated `Mixin | Ruleset`; overloads preserve the
  type contract without runtime classification;
- `resolveRawReferenceLookupTarget(...)` no longer allocates
  `finishLookup`, `runLookup`, `resolveTargetValue`, `evaluateKey`, or a sync
  IIFE before a normal raw lookup. The sync path is straight-line through
  initial target, key evaluation, target-value resolution, lookup, pop, and
  finalization. Async branches remain explicit.

Evidence:

- `pnpm exec eslint packages/core/src/tree/reference.ts` passed;
- `pnpm --filter @jesscss/core build` passed with the existing `js-expr.ts`
  direct-eval bundler warning;
- focused Reference/mixin tests passed after build: `226` tests;
- broader affected tests passed: `410` tests across `reference`, `mixin`,
  `declaration`, `ruleset`, `list`, `sequence`, `condition`, and `operation`;
- hot-path sanity benchmark after this patch:
  `functions` median `12.84ms` usable, `import-reference` median `37.76ms`
  noisy, `mixins-guards` median `18.41ms` unstable, `extend-chaining` median
  `5.43ms` usable, and `media` median `6.38ms` usable;
- no speed claim. This pass did not capture a clean before/after benchmark
  pair, and two benchmark signals were not usable, so the benchmark is a leash
  sanity line only.

### 2026-06-05 Reference Helper Surface Cut

Hypothesis: after the class-surface pass, `Reference` still had one-call
helpers and temporary objects that made the lookup/finalization path harder to
reason about without protecting semantics.

Patch kept:

- `findVarDeclarationFast(...)` now returns the matched node directly instead
  of a single-field `{ match }` object;
- `findVarDeclarationFast(...)` no longer allocates a per-scope IIFE result
  object to split public/optional current-scope matches;
- `resolveInitialReferenceTarget(...)` no longer allocates an IIFE to compute a
  simple runtime live-slot key;
- deleted fallback predicate wrappers, lookup adapter factories, result-kind
  classification helper/type, copy delegation wrapper, and the one-call target
  materialization wrappers;
- target materialization still preserves the existing `.inherit(...)` and
  copy/materialization semantics. This pass did not solve ownership pressure.

Evidence:

- focused Reference-family tests passed: `410` tests across
  `reference`, `mixin`, `declaration`, `ruleset`, `list`, `sequence`,
  `condition`, and `operation`;
- `pnpm --filter @jesscss/core build` passed with the existing `js-expr.ts`
  direct-eval bundler warning;
- `pnpm exec eslint packages/core/src/tree/reference.ts` passed;
- hot-path sanity benchmark after this patch:
  `functions` median `12.70ms`, `import-reference` median `18.21ms`,
  `mixins-guards` median `17.01ms`, `extend-chaining` median `5.13ms`, and
  `media` median `6.33ms`; all five signals were usable;
- no speed claim. This pass did not capture a clean before/after benchmark
  pair, so the benchmark is a leash sanity line only.

## Parked Measured Targets

Keep these targets visible when performance rounds reactivate:

- Copy recursion: `copyChild`, `constructCopy`, `copyWithReusableLeaves`,
  `copyCallableRulesValue`, callable output/body placement.
- Node construction and copied ownership: `Node` construction, `.clone()`,
  `.copy()`, `.inherit()`, `frozen`.
- Variable/reference lookup: `findVarWithinScopeSurface`,
  `findWithinScopeSurface`, `Reference.render`, `Reference.evalNode`,
  `finalizeReferenceLookupResult`.
- Render serialization: `serializeRulesContainerInternal`, `renderRulesBody`,
  `_emitRulesBody`, `emitNode`, `getHeaderString`, `OutputWriter.getSince`.
- Extend matching: `wouldMatchNode`, `processExtends`,
  `applyExtendsToSelector`, `isSameOrDescendantRoot`.
- Generic traversal/materialization: `Node.forEachNode`, `Node.children`,
  `Node.nodes`, `List.resolveItems`, `Sequence.evaluateValues`,
  generator/Array-helper/tuple-array traversal.
- Parser/compat facade overhead when benchmark profiles point above core.

## Future Research Lanes

These are not active cut-queue items. Start one only after the reactivation
threshold trips, or when a focused profile says the named surface is the next
real bottleneck.

### Registryless Static Namespace Lookup

Experiment: compare static mixin/ruleset namespace lookup using a direct
source-tree walk or purpose-built namespace table against the current
`Rules.find(...)` / `MixinRegistry` path.

Hypothesis:

- hot static namespace paths such as `#theme > .colors > .primary` may be
  faster as direct structural lookup than as registry lookup plus recursive
  fallback/search machinery;
- reducing `Rules.find(...)` call count is not enough proof, because replacing
  one registry call with several helper traversals can still be slower;
- the first valid experiment must bypass the registry machinery for the tested
  family, not add another cache or branch around it.

Candidate variants:

1. Direct source-tree walk over visible `Ruleset` / no-required-param `Mixin`
   namespace segments, no `Rules.find(...)`, no `MixinRegistry.find(...)`, and
   no `indexPendingItems()` on the tested path.
2. Static namespace table built during existing registration prep, keyed by
   ordered selector/mixin segments and returning stable callable entries.
3. Hybrid direct walk for simple local/source-owned namespaces with explicit
   fallback to the current registry path only for imports, reference-import
   visibility, dynamic selector/mixin names, guards, required params, or leaky
   deprecated semantics.

Required proof before keeping any patch:

- focused namespace lookup tests covering nested rulesets, nested no-param
  mixins, guarded/required-param mixins, imports/reference imports, compound
  selectors, ambiguous prefix rulesets, and local/private visibility;
- profiler evidence showing the tested path does not call `Rules.find(...)` or
  `MixinRegistry.find(...)` for the intended static cases;
- paired real benchmark before/after on a namespace-heavy fixture plus the
  default Less hot-path suite;
- rejected micro-optimizations around the registry path must stay reverted
  unless this direct-structure experiment first proves the family is worth
  replacing.

June 2026 static namespace table trial: rejected for now. A lazy
`staticNamespacePaths` table cut the namespace stress fixture's instrumented
`Rules.find(...)` count from `1981` to `901` on the small fixture and to `5281`
on the large fixture, but same-process paired parse+render timing on
`scope-lookup-stress-large.less` did not show a wall-clock win. The decisive
160-pair run with table off/on alternated per sample produced `73` wins and
`87` losses for the table, median ratio `+2.49%`, trimmed mean ratio `+3.55%`,
and `t=1.03`. The table removed lookup calls but added enough setup/shape cost
that the real eval/render path did not get faster. Keep the paired benchmark
scripts and large fixture; do not reintroduce this table without changing the
underlying cost model.

June 2026 direct simple-mixin lookup trial: inconclusive but more promising
than namespace tables. The env-gated prototype
`JESS_DIRECT_MIXIN_LOOKUP=1` bypasses `Rules.find('mixin', string, ...)` for
simple string callable references and calls an accumulator-based
`Rules.findMixinsDirect(...)` path over `mixinsByName`, preserving collection
semantics. It passed focused mixin/reference lookup tests, but the broad
namespace/lexical stress fixture did not improve: 50 paired parse+render
samples on `scope-lookup-stress-large.less` showed candidate median
`+1.68%`, mean `+3.10%`, wins `22/50`, `t=0.35`. An isolated recursive simple
mixin fixture with about 20,000 `.noop()` lookups per sample did show a
candidate win in one 50-pair parse+render run: median `-9.38%`, mean `-8.08%`,
wins `36/50`, `t=-2.40`. Confirmation was weaker: 80-pair parse+render median
`-0.78%`, mean `-1.81%`, wins `41/80`, `t=-1.56`; a 30-pair render-only run
had median `-5.02%`, mean `+0.14%`, wins `18/30`, `t=-0.49`. Treat this as
evidence that direct callable lookup can help only when simple recursive
mixin lookup dominates. The next experiment should move more of the callable
runtime onto a direct frame/table structure, not just bypass the generic
wrapper.

June 2026 callable-frame trial: rejected. A `CallableFrame` chain parallel to
`ScopeFrame` was prototyped behind `JESS_CALLABLE_FRAME_LOOKUP=1` to resolve
static callable names via per-scope `mixinsByName` maps and parent frame
links, falling back when child surfaces were present. Focused lookup tests
passed after parent frames were built on demand, but timing did not improve.
On `simple-mixin-recursion.less`, 50 paired parse+render samples produced
median `-0.80%`, mean `+1.17%`, wins `27/50`, `t=0.70`. On
`scope-lookup-stress-large.less`, 40 paired parse+render samples produced
median `+2.33%`, mean `+3.17%`, wins `15/40`, `t=1.88`. The extra frame
construction/shape checks did not pay for themselves. Reverted; do not
reintroduce a callable frame unless it replaces more call/eval placement
machinery than simple name lookup.

June 2026 direct simple-mixin result-cache trial: rejected. An env-gated
`JESS_DIRECT_MIXIN_CACHE=1` prototype cached
`Rules.findMixinsDirect(...)` results per `Rules` node and lookup option shape,
with broad invalidation on `registerNode(...)`. Focused lookup tests passed,
but the best-case repeated-lookup fixture still did not produce a clear win:
50 paired parse+render samples on `simple-mixin-recursion.less` produced
median `-1.07%`, mean `-1.20%`, wins `26/50`, `t=-1.19`. Since this fixture
was intentionally dominated by repeated identical simple mixin lookups, the
result is not strong enough to justify carrying extra cache storage or
invalidation. Reverted.

June 2026 registryless architecture prototype: promising, but synthetic. A
standalone prototype in `scripts/prototype-no-registry-lookup.mjs` compares a
current-style registry wrapper (pending items, lazy index, per-lookup searched
set, parent traversal) with a registryless direct frame chain
(`Map<string, entry[]>` per frame plus parent pointers). Both sides validate
the same hit count before timing. On an 80-deep, 12-name, 200k-lookup
build+lookup workload, the direct frame model was about `83.5%` faster:
registry median `456.84ms`, frame median `75.45ms`, frame wins `80/80`,
`t=-169.76`. The win survived smaller workloads: 20-deep/50k lookups was
about `82.5%` faster, and 8-deep/10k lookups was about `79.0%` faster. It also
survived allocation controls: registry-count mode, which avoids materializing
result arrays on the registry side, still showed `-82.82%` median ratio; and
frame-materialize mode, which materializes result arrays on the frame side,
still showed `-80.98%` median ratio. This is not proof that Jess runtime will
speed up by the same amount, but it finally tests the user's actual question:
a no-registry hot lookup structure can be much faster than a registry-shaped
one in a controlled model. Next runtime experiment should replace one complete
hot family with direct frames end-to-end, probably simple mixin call lookup or
variable lookup, instead of adding caches around `Rules.find(...)`.

June 2026 registryless mixin runtime prototype: partial and not yet shippable.
After merging local `dev` into the experiment worktree, an env-gated
`JESS_REGISTRYLESS_MIXIN_LOOKUP=1` path was added for the mixin lookup family.
For simple static callable names it forces `ScopeFrame` construction and uses
callable buckets/direct `findMixinsFast(...)` child-surface traversal instead
of falling through to `MixinRegistry`. Array and compound string namespace
paths also stop before `getRegistry('mixin').find(...)` and use direct ruleset
namespace helpers. Repeated same-key lookup caching is separate behind
`JESS_REGISTRYLESS_MIXIN_CACHE=1` so cache behavior can be measured apart from
the registryless cut. Focused mixin/reference lookup tests passed with
`JESS_REGISTRYLESS_MIXIN_LOOKUP=1` (`38` tests), including static callable
buckets, namespace fast paths, and nested mixin-ruleset references. Runtime
timing on `simple-mixin-recursion.less` was only a weak win without cache:
50 paired parse+render samples produced median `-0.75%`, mean `-0.54%`, wins
`30/50`, `t=-1.07`. With `JESS_REGISTRYLESS_MIXIN_CACHE=1`, the same fixture
improved slightly: median `-1.07%`, mean `-1.36%`, wins `37/50`, `t=-2.95`.
Small guarded recursion and default-param recursion fixtures passed, but the
broader `scope-lookup-stress.less`/large fixture still fails semantically at
`.lexical-stack`, indicating an unresolved interaction among nested lexical
body frames, default parameters, and recursive callable lookup. Do not present
this runtime prototype as a win yet: the controlled model says registryless
frames can be much faster, but the real runtime still needs an end-to-end
callable binding/candidate path that removes enough surrounding call/eval
machinery for that lookup win to surface.

### Null-Proto Lookup Slots

Experiment: compare hot variable-reference lookup using null-prototype string
slot tables against the current lookup containers.

Hypothesis:

- `Object.create(null)` may be faster and lighter than `Map` for hot string-key
  variable names;
- lookup should return a stable `BindingCell`, not a raw node, so live-binding
  semantics are independent of the dictionary implementation;
- explicit `parentFrame` walking should be tested before prototype-chain scope
  inheritance because it is easier to reason about for shadowing, assignment,
  import/reference visibility, mixin invocation, and Sass-style live updates.

Candidate shape:

```ts
interface ScopeFrame {
  slots: Record<string, BindingCell | undefined>;
  parent: ScopeFrame | undefined;
}

interface BindingCell {
  value: Node;
  flags: number;
  sourceDecl: Node | undefined;
  version: number;
}
```

Test variants:

1. `Map<string, BindingCell>` lookup.
2. `Object.create(null)` slots plus explicit `parentFrame` walk.
3. `Object.create(parentSlots)` prototype-chain reads, only after variant 2 is
   correct and measured.
4. Optional split dictionaries for lexical/scope keys and linear/live-binding
   keys if Sass-style semantics require different write/read behavior.

Required proof before keeping any patch:

- focused Less variable lookup tests: lexical shadowing, recursive mixin/loop
  variables, defaults, imports/reference imports, declaration order, and live
  assignment/update behavior;
- focused Sass-style live-binding tests if the runtime path claims to preserve
  those semantics;
- same real benchmark before/after snapshot;
- no broad registry rewrite unless the small hot variable-reference path wins.

### JavaScript Backend / Native Scope Execution

Historical idea: original Jess advertised itself as JavaScript-evaluated style
sheets and compiled `.jess` stylesheets to JavaScript. That direction may have
been fast because lexical variables, closures, and ordinary function calls let
the JavaScript engine handle much of the scope and execution machinery.

Treat this as a radical research backend, not the active Less eval/render
architecture.

Main-branch evidence:

- `packages/jess/README.md` says Jess "transpiles to JavaScript
  under-the-hood."
- `packages/jess/src/render-module.ts` parses `.jess`, then calls
  `root.toModule(...)` twice to produce compile-time and runtime JS modules.
- `packages/jess/src/render.ts` runs Rollup, writes the generated compiler JS,
  `require(...)`s it, and calls its default export to produce CSS.
- `Root.toModule(...)` emits a JS default function, builds `$TREE` with
  `$J.root((() => { const $OUT = []; ... })())`, then calls
  `$J.renderCss($TREE, $CONTEXT)`.
- `Mixin.toModule(...)` emits JS functions for simple mixins, and `Let` emits
  JS bindings / override plumbing for `@let`.
- `Call.toModule(...)` emits a lazy `ref: () => name` for JS-callable names and
  falls back to CSS calls when the reference is not available.

Important distinction: the main-branch backend was a hybrid. It used JS
lexical names and function calls, but it still generated Jess node objects and
then evaluated/rendered a `$TREE`. The future experiment should measure both
the historical hybrid and a more radical direct-emission backend that writes CSS
without building an evaluated AST.

Hypothesis:

- for Jess-native syntax, compiling to JavaScript may make simple variables,
  functions, loops, and imports much cheaper than interpreting an AST;
- native JS scope and closure capture may replace a large share of registry,
  lookup, and frame plumbing;
- generated JS can let V8 optimize stable hot paths better than a generic
  node-dispatch interpreter.

Primary risk:

- Less mixin semantics do not map cleanly to plain JavaScript functions. Less
  mixins can be overloaded, guarded, merged, namespaced, used as maps, unlocked
  into caller scope in deprecated paths, participate in reference/import
  visibility, interact with `default()`, and depend on declaration/order
  behavior that is not just lexical JS scope.

Research shape:

1. Start with Jess-native or strict-Less subset only: variables, declarations,
   simple nesting, simple functions, loops, and plain mixins.
2. Generate JS that writes CSS directly to a buffer. Do not generate a second
   evaluated AST.
3. Represent mixin overload sets explicitly rather than pretending every Less
   mixin is one JS function.
4. Treat guards/default resolution, detached rulesets, mixin maps, reference
   imports, extends, and deprecated caller-scope leakage as separate semantic
   modules that may stay interpreted or call into runtime helpers.
5. Compare generated-JS backend against current render/eval on tiny fixtures,
   recursive mixin stress, broad Less hot-path fixtures, and Jess-native
   examples.

Keep criteria:

- generated JS must preserve source diagnostics and sourcemap strategy;
- the backend must be opt-in or isolated until it proves Less compatibility;
- no active runtime refactor should depend on this experiment succeeding;
- if it wins, use the result to inform the interpreter shape: direct emission,
  lexical binding cells, static templates, and fewer generic node dispatches.

## Recent Benchmark Sanity Notes

### Standalone Bare-Variable Cache Rejection

Date: 2026-06-06.

Change attempted and rejected: frame-local static-variable lookup identity
caching inside `lookupScopeFrameVariable(...)` as a standalone cache layer.

Two implementations were tried:

- a `Map` cache keyed by lookup identity;
- a single-entry primitive-field cache on `ScopeFrame`.

Both cached binding identity only, not evaluated values. Both were removed from
runtime code because the evidence did not justify the machinery.

Evidence:

- Initial pass status after fallback-frame ownership: `benchmark-v39.less`
  profile showed `Reference.evalNode` `482` calls / `5.43ms`, `Rules.find`
  `68` calls / `0.38ms`, and static audit showed global `new-node` `321`.
- The `Map` cache raised the static audit to `new-node` `322`, so it was cut.
- The single-entry primitive-field cache restored the audit to `new-node`
  `321`, but a clean profile still showed `Reference.evalNode` `482` calls /
  `5.59ms`.
- Stable hotpath sanity with the primitive-field cache was mixed, not a win:
  `functions` `12.79ms`, `import-reference` `20.41ms`,
  `mixins-guards` `17.44ms`, `extend-chaining` `5.29ms`, `media` `6.74ms`.

Interpretation: reject a bolt-on bare static-variable cache for this path. The
failed prototype cached only binding identity for an already-cheap lookup, so
it reasoned about the cache in isolation instead of asking why reference
evaluation had to rediscover the same binding facts.

This does not reject reuse. The next model should be one binding/index system:
a reference asks for a binding handle, and the handle carries scope/version,
reference shape, resolved declaration/callable/property identity, live/static/
effect facts, and value/text reusability. A repeated path such as
`.a.b.c[@color-1]` should not rediscover the `.a.b.c` ruleset/callable path and
the `@color-1` declaration binding twice.

Future experiments should target repeated compound reference fixtures and prove
that reuse falls out of binding handles and frame/surface versions, not a
separate side cache with newly rebuilt strings, arrays, or lookup containers.

### Fallback-Frame Lookup Ownership

Date: 2026-06-06.

Change: `lookupScopeFrameVariable(...)` now owns fallback-frame variable lookup
for covered static variable reads. It searches the primary frame chain and then
the fallback frame chain before returning `miss`, so fallback live-slot hits,
fallback declaration hits, and covered fallback misses do not route through the
old `lookupRuntimeVarBinding(...)` / `findVarDeclarationFast(...)` ladder.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `12.33ms`;
- `import-reference`: usable, median `20.09ms`;
- `mixins-guards`: usable, median `17.44ms`;
- `extend-chaining`: usable, median `5.51ms`;
- `media`: usable, median `6.66ms`.

Additional status:

- `node scripts/profile-less-benchmark.mjs --file=benchmark-v39.less` reported
  `Reference.evalNode` `482` calls / `5.07ms`, `Rules.find` `68` calls /
  `0.34ms`, and `Rules.find` still only on function keys for this fixture.
- `pnpm run audit:node-creation` reported `reference.ts` `21`, global
  `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`, `derive` `30`.

Interpretation: status only. This pass moved fallback ownership into the
binding facade for covered static variable reads. It was not a controlled
before/after performance experiment and makes no speed claim.

### Manual-Frame Declaration Coverage

Date: 2026-06-06.

Change: `ScopeFrame` now carries declaration-coverage state so
`Reference.lookupScopeFrameVariableBinding(...)` no longer checks
`targetRules.scopeFrame`, `varsByName`, `rulesIndexed`, and `value.length` on
every covered static variable lookup. `Rules` registration/indexing keeps an
existing frame's declaration buckets/pending list aligned and marks coverage
when indexing reaches the current rules length. Snapshot reads now skip
runtime live-slot fallback after an uncovered facade result.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `12.85ms`;
- `import-reference`: usable, median `20.19ms`;
- `mixins-guards`: usable, median `17.86ms`;
- `extend-chaining`: usable, median `5.47ms`;
- `media`: usable, median `6.33ms`.

Additional status:

- `node scripts/profile-less-benchmark.mjs --file=benchmark-v39.less` reported
  `Reference.evalNode` `482` calls / `5.93ms`, `Rules.find` `68` calls /
  `0.36ms`, and `Rules.find` still only on function keys for this fixture.
- `pnpm run audit:node-creation` reported `reference.ts` `21`, global
  `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`, `derive` `30`.

Interpretation: status only. This pass deleted a reference-side branch and
fixed snapshot fallback ownership; it did not capture a clean before/after
benchmark pair and makes no speed claim.

### Production Binding Facade Step 2

Date: 2026-06-06.

Change: added the first production `ScopeFrame` variable lookup facade for
static string variable references with no explicit target, no interpolation, no
contextual `start` boundary, and pending-declaration bailout. Existing
`findVarDeclarationFast(...)`/registry fallback remains for broader cases.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: unstable, median `12.31ms`;
- `import-reference`: usable, median `19.55ms`;
- `mixins-guards`: usable, median `17.60ms`;
- `extend-chaining`: usable, median `5.19ms`;
- `media`: usable, median `6.10ms`.

Interpretation: status only. This pass did not capture a clean before/after
pair, so it makes no speed claim. The benchmark remains useful as a leash: the
facade slice stayed behavior-gated and did not obviously break the hot-path
runner.

### `$!` Source-Position Facade Route

Date: 2026-06-06.

Change: `$!name` now carries an explicit source-position read fact on
`Reference`, and covered same-frame `$!` variable reads route through the
`ScopeFrame` facade with `start` and `includeLive: false`. Ordinary `$name`
current reads and loop/live reads remain on the existing path.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `12.72ms`;
- `import-reference`: usable, median `17.15ms`;
- `mixins-guards`: usable, median `16.32ms`;
- `extend-chaining`: usable, median `4.62ms`;
- `media`: unstable, median `5.74ms`.

Interpretation: status only. This was not a clean before/after benchmark
experiment, so it makes no speed claim. The important proof for the slice is
behavioral: explicit `$!` source-position reads can use the facade without
breaking ordinary current/live `$while` reads.

### Static `:=` VarDeclaration Placement-Copy Cut

Date: 2026-06-06.

Change: static `VarDeclaration` `:=`/`setDefined` now updates the resolved
declaration value and scope-frame cell directly instead of deriving a placement
declaration, adopting it into the found `Rules`, splicing/unshifting the rules
array, and re-registering the new node. Non-variable `setDefined` remains on
the older placement path.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `14.01ms`;
- `import-reference`: usable, median `21.61ms`;
- `mixins-guards`: usable, median `18.09ms`;
- `extend-chaining`: usable, median `5.63ms`;
- `media`: usable, median `6.84ms`.

Interpretation: status only. This was not a clean before/after benchmark
experiment, so it makes no speed claim. The behavioral proof is the focused
`Rules` `setDefined`/readonly test set plus the new assertion that static
`setDefined` does not call `deriveWithOptions(...)`.

### Cross-Structure Binding Proof

Date: 2026-06-06.

Change: added real mixin and `$for` binding tests for current reads,
`$!`/snapshot reads, static `:=`, and live-slot RHS `:=`. The production fix
evaluates the assigned RHS at the `setDefined` write boundary when the
registration target already carries live slots; a broader context-through-all
registration route was rejected because it broke dynamic declaration-name
reference tests.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `13.31ms`;
- `import-reference`: usable, median `21.91ms`;
- `mixins-guards`: usable, median `18.05ms`;
- `extend-chaining`: usable, median `5.48ms`;
- `media`: usable, median `6.91ms`.

Interpretation: status only. This was not a clean before/after benchmark
experiment, so it makes no speed claim. The behavioral proof is the focused
failure and fix: `$for` live-slot RHS assignment failed with `'value' is not
defined` before the write-boundary eval and passed after gating context use to
live-slot registration surfaces.

### Reference Pass 5 Static Declaration Resolve Cut

Date: 2026-06-06.

Change: public declaration references now return static, non-important,
non-merged declaration values directly when outside calc frames. This deletes
the remaining public resolve path that copied, froze, and inherited already
static declaration containers.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `13.77ms`;
- `import-reference`: unstable, median `21.87ms`;
- `mixins-guards`: usable, median `17.59ms`;
- `extend-chaining`: usable, median `5.47ms`;
- `media`: usable, median `6.80ms`.

Interpretation: status only. This was not a clean before/after benchmark
experiment, so it makes no speed claim. The behavioral/code-path proof is that
the focused declaration-reference resolve test failed before the patch because
it returned a copied/frozen `List`; it now asserts source identity and zero
`copy(...)`/`.inherit(...)`. Calc slash-list tests rejected a broader direct
return, so the kept cut is explicitly bounded by `context.calcFrames === 0`.

### Reference Pass 6 Lookup Helper Hoist

Date: 2026-06-06.

Change: `findVarDeclarationFast(...)` no longer allocates nested helper
functions for bucket selection, candidate ordering, and deferred dynamic-name
promotion on every variable lookup. The same scans and mutations remain; they
now live in module-local helpers.

Pre-pass CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.69ms`, `Rules.find` `68` calls / `0.38ms`;
- top reference keys were repeated variable reads: `value` `230`, `val` `68`,
  `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit still showed `reference.ts` with `23` creation or
  copy surfaces, and global audit totals `new-node` `321`, `with-surface` `36`,
  `copy-leaves` `31`, `derive` `30`.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `13.09ms`;
- `import-reference`: usable, median `21.33ms`;
- `mixins-guards`: usable, median `17.54ms`;
- `extend-chaining`: usable, median `5.55ms`;
- `media`: usable, median `6.73ms`.

Interpretation: status only. This was not a clean before/after benchmark
experiment, so it makes no speed claim. The code-path proof is narrower: the
hot variable lookup path no longer constructs the bucket/order/deferred-name
helper closures per call.

### Reference Pass 7 Evaluator Options Object Cut

Date: 2026-06-06.

Change: `evaluateReferenceValueNode(...)` now uses local bit flags instead of a
fresh options object for runtime-binding evaluation, and declaration-reference
evaluation no longer goes through an argument-object wrapper before calling the
same evaluator.

Pre-pass CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.70ms`, `Rules.find` `68` calls / `0.38ms`;
- top reference keys were repeated variable reads: `value` `230`, `val` `68`,
  `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit still showed `reference.ts` with `23` creation or
  copy surfaces, and global audit totals `new-node` `321`, `with-surface` `36`,
  `copy-leaves` `31`, `derive` `30`.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `13.44ms`;
- `import-reference`: usable, median `21.38ms`;
- `mixins-guards`: usable, median `18.24ms`;
- `extend-chaining`: unstable, median `5.67ms`;
- `media`: usable, median `6.78ms`.

Interpretation: status only. This was not a clean before/after benchmark
experiment, so it makes no speed claim. The code-path proof is narrower: the
reference value evaluator no longer constructs the runtime-binding options
object or declaration wrapper argument object per call.

### Reference Pass 8 Runtime-Binding Sync Closure Cut

Date: 2026-06-06.

Change: runtime-binding reference evaluation now performs rules-context and
search-scope save/restore directly for the common sync path instead of
allocating `evaluateBinding`/`evaluateInRulesContext` closures and passing them
through `withRulesContext(...)`. Async cleanup continuations remain for actual
thenables.

Pre-pass CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `6.34ms`, `Rules.find` `68` calls / `0.41ms`;
- top reference keys were repeated variable reads: `value` `230`, `val` `68`,
  `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit still showed `reference.ts` with `23` creation or
  copy surfaces, and global audit totals `new-node` `321`, `with-surface` `36`,
  `copy-leaves` `31`, `derive` `30`.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `13.69ms`;
- `import-reference`: usable, median `20.70ms`;
- `mixins-guards`: usable, median `17.75ms`;
- `extend-chaining`: usable, median `5.30ms`;
- `media`: usable, median `6.47ms`.

Interpretation: status only. This was not a clean before/after benchmark
experiment, so it makes no speed claim. The code-path proof is narrower: the
runtime-binding sync path no longer allocates the binding-eval/rules-context
closure pair before evaluating the same binding value.

### Reference Pass 9 Rules Lookup Executor Closure Cut

Date: 2026-06-06.

Change: removed `createRulesReferenceLookupExecutor(...)` and its returned
per-lookup `performRulesLookup(scope)` closure. Rules/leaky lookup now carries
the same lookup data as explicit state and calls a module-local lookup function
directly.

Current CPU/counter status:

- `benchmark-v39.less` profiler status after the patch: `Reference.evalNode`
  `482` calls / `9.57ms`, `Rules.find` `68` calls / `0.47ms`;
- top reference keys were repeated variable reads: `value` `230`, `val` `68`,
  `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit showed `reference.ts` at `21` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`.

Interpretation: status only. This CPU/counter refresh was run after the edit,
so it is not before/after speed evidence. The code-path proof is narrower: the
rules reference lookup path no longer constructs a per-lookup executor closure.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `13.80ms`;
- `import-reference`: usable, median `22.20ms`;
- `mixins-guards`: usable, median `17.60ms`;
- `extend-chaining`: usable, median `5.40ms`;
- `media`: usable, median `6.77ms`.

### Reference Pass 10 Render-Only Finalization Copy Cut

Date: 2026-06-06.

Change: render-only declaration and runtime binding finalization now returns
the evaluated node directly for non-merged values. It no longer applies a
post-eval `copyWithReusableLeaves(...)` and `.inherit(reference)` only to stamp
public result metadata before immediate string rendering.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.27ms`, `Rules.find` `68` calls / `0.37ms`;
- top reference keys were repeated variable reads: `value` `230`, `val` `68`,
  `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit showed `reference.ts` at `21` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`.

Post-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `6.36ms`, `Rules.find` `68` calls / `0.48ms`;
- top reference keys remained repeated variable reads: `value` `230`,
  `val` `68`, `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit remained unchanged: `reference.ts` `21`,
  global totals `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`,
  `derive` `30`.

Interpretation: status only, not speed proof. The code-path proof is narrower:
dynamic values that were already evaluated for render no longer pay a second
ownership copy/inherit just before stringification. The static audit does not
move because the deleted work was conditional runtime execution, not a removed
source line containing a creation token.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `13.58ms`;
- `import-reference`: usable, median `21.79ms`;
- `mixins-guards`: usable, median `17.61ms`;
- `extend-chaining`: usable, median `5.37ms`;
- `media`: usable, median `6.52ms`.

### Binding Step 4 Declaration-Bucket Binding Identity

Date: 2026-06-06.

Change: covered static variable declaration hits now return binding cell/value
identity through `RuntimeVarBinding` instead of returning a source
`VarDeclaration` and then bouncing through declaration-node finalization.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.54ms`, `Rules.find` `68` calls / `0.40ms`;
- top reference keys were repeated variable reads: `value` `230`, `val` `68`,
  `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit showed `reference.ts` at `21` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`.

Post-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.62ms`, `Rules.find` `68` calls / `0.37ms`;
- `Rules.find` for this fixture is now only function lookup:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- top reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- static node-creation audit stayed `reference.ts` `21`, global totals
  `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`, `derive` `30`.

Interpretation: status only, not speed proof. The code-path proof is the
focused reference test that instruments `Rules.find(...)`: a covered static
variable hit for `color` renders `seen: red;` with zero declaration
`Rules.find(...)` calls. The remaining binding bridge is now more exposed:
facade `undefined` still conflates covered miss and unmodeled fallback, so the
next lookup cut is explicit `MISS` vs `UNCOVERED`, not lookup caching.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `12.69ms`;
- `import-reference`: usable, median `20.95ms`;
- `mixins-guards`: usable, median `17.33ms`;
- `extend-chaining`: usable, median `5.74ms`;
- `media`: usable, median `6.46ms`.

### Binding Step 5 Covered Miss vs Uncovered Fallback

Date: 2026-06-06.

Change: `ScopeFrame` variable lookup now returns explicit `miss` or
`uncovered` states. Covered static variable misses stop before the old
runtime-binding, fast-var, and registry fallback ladder. `uncovered` remains
only for cases whose lookup facts are not yet represented by the binding frame.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.33ms`, `Rules.find` `68` calls / `0.38ms`;
- top reference keys were repeated variable reads: `value` `230`, `val` `68`,
  `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit showed `reference.ts` at `21` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`.

Post-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.57ms`, `Rules.find` `68` calls / `0.40ms`;
- `Rules.find` stayed only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- top reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- static node-creation audit stayed `reference.ts` `21`, global totals
  `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`, `derive` `30`.

Interpretation: status only, not speed proof. The code-path proof is that
covered misses now return a terminal local sentinel in `Reference`, while
pending dynamic names, fallback frames, unrepresented parent frame chains, and
manual unindexed frames stay `uncovered` and may use old lookup. Two broader
cuts were rejected by tests: terminal miss for all facade misses broke
detached rulesets, and treating all prebuilt unindexed frames as uncovered
broke `$for` snapshot reads.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `12.39ms`;
- `import-reference`: usable, median `18.77ms`;
- `mixins-guards`: usable, median `16.94ms`;
- `extend-chaining`: usable, median `5.09ms`;
- `media`: usable, median `6.35ms`.

### Binding Step 6 Parent-Frame Coverage

Date: 2026-06-06.

Change: nested `Rules` frames now build/attach their nearest ancestor
`Rules` frame on demand. Static variable lookup no longer marks a child frame
as `uncovered` just because the parent frame had not already been built.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.10ms`, `Rules.find` `68` calls / `0.36ms`;
- top reference keys were repeated variable reads: `value` `230`, `val` `68`,
  `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit showed `reference.ts` at `21` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`.

Post-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.61ms`, `Rules.find` `68` calls / `0.38ms`;
- `Rules.find` stayed only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- top reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- static node-creation audit stayed `reference.ts` `21`, global totals
  `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`, `derive` `30`.

Interpretation: status only, not speed proof. The code-path proof is the
focused nested reference test: a child `Rules` surface resolves a static parent
variable with the parent frame initially unbuilt and records zero declaration
`Rules.find(...)` calls. This deletes one `uncovered` bridge by representing
the parent frame chain directly.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `12.35ms`;
- `import-reference`: usable, median `18.18ms`;
- `mixins-guards`: usable, median `16.53ms`;
- `extend-chaining`: usable, median `5.10ms`;
- `media`: usable, median `6.25ms`.

### Binding Step 7 Pending Declaration-Name Promotion

Date: 2026-06-06.

Change: already-static pending dynamic declaration names are promoted before
`lookupScopeFrameVariable(...)`, so they can resolve through the binding facade
instead of reaching old fast-var fallback first.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.44ms`, `Rules.find` `68` calls / `0.36ms`;
- top reference keys were repeated variable reads: `value` `230`, `val` `68`,
  `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit showed `reference.ts` at `21` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`.

Post-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.77ms`, `Rules.find` `68` calls / `0.37ms`;
- `Rules.find` stayed only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- top reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- static node-creation audit stayed `reference.ts` `21`, global totals
  `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`, `derive` `30`.

Interpretation: status only, not speed proof. The code-path proof is that the
existing pending-name promotion loop now runs before the facade lookup. The
focused pending-name test asserts the promoted declaration is visible through
`lookupScopeFrameVariable(...)`; still-dynamic and async pending-name tests
remain covered and continue to avoid registry fallback.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `12.67ms`;
- `import-reference`: usable, median `18.16ms`;
- `mixins-guards`: usable, median `16.43ms`;
- `extend-chaining`: usable, median `5.11ms`;
- `media`: usable, median `6.30ms`.

### Binding Step 8 Static Compound Path Identity

Date: 2026-06-06.

Change: static compound reference keys keep their original `string[]` identity
when possible, and callable namespace lookup walks path arrays by offset instead
of allocating recursive rest arrays. This is path-fact preservation inside the
binding/index direction, not a standalone cache and not evaluated-value reuse.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status before this pass: `Reference.evalNode`
  `482` calls / `5.69ms`, `Rules.find` `68` calls / `0.42ms`;
- `Rules.find` was only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- static node-creation audit showed `reference.ts` at `21` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`.

Post-edit CPU/counter status:

- clean `benchmark-v39.less` profiler status: `Reference.evalNode` `482`
  calls / `5.11ms`, `Rules.find` `68` calls / `0.37ms`;
- top repeated reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- `Rules.find` stayed only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- static node-creation audit stayed `reference.ts` `21`, global totals
  `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`, `derive` `30`.

Interpretation: status only, not speed proof. The code-path proof is a focused
reference test that monkey-patches `Rules.find(...)` and proves a static
mixin-ruleset array-path lookup receives the original key array instance. The
remaining binding-handle work is still to stop rediscovering binding facts
across repeated lookups, and any evaluated value/text reuse still needs explicit
static/effect facts plus benchmark proof.

### Reference Step 11 Declaration Finalization Helper Cut

Date: 2026-06-06.

Change: declaration-reference finalization deleted four single-use helper/
predicate layers and keeps the same search-scope cleanup directly in
`finalizeDeclarationReferenceResult(...)`. This is a helper/function-hop cut,
not a new materialization strategy.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status before this pass: `Reference.evalNode`
  `482` calls / `5.20ms`, `Rules.find` `68` calls / `0.35ms`;
- `Rules.find` was only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- static node-creation audit showed `reference.ts` at `21` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`.

Post-edit CPU/counter status:

- clean `benchmark-v39.less` profiler status: `Reference.evalNode` `482`
  calls / `5.32ms`, `Rules.find` `68` calls / `0.38ms`;
- top repeated reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- static node-creation audit dropped `reference.ts` from `21` to `20` and
  global `with-surface` from `34` to `33`; `new-node` stayed `321`,
  `copy-leaves` stayed `31`, and `derive` stayed `30`.

Interpretation: status only, not speed proof. The code-path proof is the
deleted wrapper stack:
`withReferenceSearchScope(...)`,
`finalizeEvaluatedDeclarationReference(...)`,
`hasImportantDeclarationValue(...)`, and
`isMergedAssignDeclaration(...)`. The remaining
`copyWithReusableLeaves(...)`/`.inherit(...)` public declaration-reference
boundary is still queued for evidence-backed removal or isolation.

### Reference Step 12 Finalizer Options-Object Cut

Date: 2026-06-06.

Change: Reference finalizers pass the render-only `textOnly` state as a boolean
instead of building private option/args objects. This deletes object plumbing in
the finalization ladder; it does not change fallback/runtime binding/
declaration/direct/callable materialization semantics.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status before this pass: `Reference.evalNode`
  `482` calls / `6.13ms`, `Rules.find` `68` calls / `0.36ms`;
- `Rules.find` was only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- static node-creation audit showed `reference.ts` at `20` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `33`,
  `copy-leaves` `31`, `derive` `30`.

Post-edit CPU/counter status:

- clean `benchmark-v39.less` profiler status: `Reference.evalNode` `482`
  calls / `5.65ms`, `Rules.find` `68` calls / `0.37ms`;
- top repeated reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- static node-creation audit stayed `reference.ts` `20`, global totals
  `new-node` `321`, `with-surface` `33`, `copy-leaves` `31`, `derive` `30`.

Interpretation: status only, not speed proof. The code-path proof is that
`reference.ts` no longer contains `{ textOnly }`, `options.textOnly`, or
`finalizeReferenceLookupResult({ ... })`/fallback args-object patterns. The
remaining item-14 work is still the actual copy/materialization boundary, not
more option plumbing.

### Reference Step 13 Public Resolve Post-Eval Copy Cut

Date: 2026-06-06.

Change: runtime-binding and non-merged declaration public resolve now return the
evaluated node from `evaluateReferenceValueNode(...)` directly instead of
copying that evaluated node again and stamping `.inherit(reference)`. Merged
declaration references still keep their explicit normalization/inherit path.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status before this pass: `Reference.evalNode`
  `482` calls / `5.58ms`, `Rules.find` `68` calls / `0.40ms`;
- `Rules.find` was only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- static node-creation audit showed `reference.ts` at `20` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `33`,
  `copy-leaves` `31`, `derive` `30`.

Post-edit CPU/counter status:

- clean `benchmark-v39.less` profiler status: `Reference.evalNode` `482`
  calls / `5.27ms`, `Rules.find` `68` calls / `0.35ms`;
- top repeated reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- static node-creation audit dropped `reference.ts` from `20` to `18` and
  global `copy-leaves` from `31` to `29`; `new-node` stayed `321`,
  `with-surface` stayed `33`, and `derive` stayed `30`.

Interpretation: status only, not speed proof. The code-path proof is that two
post-eval public-resolve ownership copies are gone, with focused tests proving
dynamic runtime-binding and dynamic declaration containers no longer inherit
from the reference while canonical source parents remain intact.

### Reference Step 14 Fallback Pre-Copy Cut

Date: 2026-06-06.

Change: fallback public resolve no longer pre-copies the fallback source
container before eval. This removes one Reference-local
`copyWithReusableLeaves(fallbackValue)` boundary. It does not claim that dynamic
fallback public materialization is solved, because `List.eval(...)`/
`Sequence.eval(...)` can still create owned public containers when evaluated
children differ.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status before this pass: `Reference.evalNode`
  `482` calls / `5.61ms`, `Rules.find` `68` calls / `0.41ms`;
- `Rules.find` was only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- static node-creation audit showed `reference.ts` at `18` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `33`,
  `copy-leaves` `29`, `derive` `30`.

Post-edit CPU/counter status:

- clean `benchmark-v39.less` profiler sanity after the patch:
  `Reference.evalNode` `482` calls / `6.00ms`, `Rules.find` `68` calls /
  `0.42ms`;
- top repeated reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- static node-creation audit dropped `reference.ts` from `18` to `17` and
  global `copy-leaves` from `29` to `28`; `new-node` stayed `321`,
  `with-surface` stayed `33`, and `derive` stayed `30`.

Interpretation: status only, not speed proof. The code-path proof is one
Reference-local fallback pre-copy deletion plus focused tests proving dynamic
fallback render and public resolve do not call `List.copy` on the fallback
source container. The exposed next target is shared public container
materialization in `List.eval(...)`/`Sequence.eval(...)`, not another Reference
wrapper.

### List/Sequence Eval Wrapper Cut

Date: 2026-06-06.

Change: `List.evalNode(...)` and `Sequence.evalNode(...)` no longer pay private
evaluation-wrapper calls before evaluating child arrays. `List.evalNode(...)`
also replaced `Array.every(...)` callback checks with direct loops. This is
function-call/callback deletion only; it does not remove the owned
`List.withResolvedValue(...)` or `Sequence.withValue(...)` public
materialization boundary.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status before this pass: `Reference.evalNode`
  `482` calls / `7.24ms`, `Rules.find` `68` calls / `0.65ms`;
- `Rules.find` was only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- static node-creation audit showed `sequence.ts` at `18`, `reference.ts` at
  `17`, and global totals `new-node` `321`, `with-surface` `33`,
  `copy-leaves` `28`, `derive` `30`.

Post-edit CPU/counter status:

- clean `benchmark-v39.less` profiler sanity after the patch:
  `Reference.evalNode` `482` calls / `5.60ms`, `Rules.find` `68` calls /
  `0.41ms`;
- top repeated reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- static node-creation audit stayed flat: `sequence.ts` `18`, `reference.ts`
  `17`, global `new-node` `321`, `with-surface` `33`, `copy-leaves` `28`,
  `derive` `30`.

Interpretation: status only, not speed proof. The code-path proof is that
`evaluateItems`, `evaluateValues`, and `.every(...)` are gone from
`list.ts`/`sequence.ts`. The remaining target is still the owned public
container materialization boundary, not another local wrapper.

### Direct Declaration Tree-Crawl Prototype

Date: 2026-06-08.

Hypothesis: `Rules.find('declaration', ...)` can preserve the old declaration
registry semantics while replacing declaration-registry indexing/searching with
a direct crawl over `Rules.value` and child `Rules` bodies whose visibility
admits the requested declaration type.

Prototype shape:

- env-gated through `JESS_DIRECT_DECLARATION_LOOKUP=1`;
- parent-scope movement mirrors `DeclarationRegistry.find(...)`'s containing
  node walk and `ignoreParentScopeStart` / linear-start behavior;
- local declaration lookup scans `Rules.value` directly and skips in-flight
  `setDefined` assignments, matching the fact that those assignments have not
  been registered yet on the old path;
- child lookup derives child `Rules` bodies from direct tree children
  (`Rules`, `Ruleset`, `Mixin`, `AtRule`) instead of reading `_rulesSet`,
  `rulesSet`, or declaration registries;
- unsupported mutating/aggregate options (`findAll`, explicit candidate sets,
  caller-provided searched-rules sets) fall back to the registry path.

Behavior evidence:

- `pnpm --filter @jesscss/core build` passed;
- `JESS_DIRECT_DECLARATION_LOOKUP=1 pnpm --filter @jesscss/core exec vitest src/tree/__tests__/rules.test.ts src/tree/__tests__/reference.test.ts --run`
  passed (`173` tests, `8` skipped);
- the direct helper has no `_rulesSet`, `rulesSet`, or `getRegistry(...)` reads;
  its only `registry-utils` dependency is the shared option type.

Benchmark evidence:

- real-ish Less property-access recursion, parse+render:
  `node scripts/compare-less-parse-render-env.mjs --env JESS_DIRECT_DECLARATION_LOOKUP --fixture scripts/fixtures/less-hotpath/declaration-access-recursion.less --warmup 8 --pairs 50`
  reported baseline median `1227.24ms`, candidate median `1218.99ms`, median
  ratio `-0.96%`, wins `30/50`, `t=-1.51`; not a clear speed signal;
- same fixture, render-timed phase:
  `node scripts/compare-less-parse-render-env.mjs --phase render --env JESS_DIRECT_DECLARATION_LOOKUP --fixture scripts/fixtures/less-hotpath/declaration-access-recursion.less --warmup 8 --pairs 80`
  reported baseline median `1229.59ms`, candidate median `1230.06ms`, median
  ratio `-0.27%`, wins `44/80`, `t=-0.82`; not a clear speed signal;
- synthetic direct lookup, small declaration surfaces:
  `node scripts/prototype-direct-declaration-lookup.mjs --child-rules 4 --declarations 8 --lookups 200000 --warmup 8 --pairs 60`
  reported baseline median `337.37ms`, candidate median `176.71ms`, wins
  `60/60`;
- synthetic direct lookup, many child surfaces but small declaration surfaces:
  `node scripts/prototype-direct-declaration-lookup.mjs --child-rules 16 --declarations 8 --lookups 200000 --warmup 6 --pairs 40`
  reported baseline median `903.36ms`, candidate median `726.72ms`, wins
  `40/40`;
- synthetic direct lookup, larger declaration surfaces before direct caches:
  `node scripts/prototype-direct-declaration-lookup.mjs --child-rules 4 --declarations 64 --lookups 200000 --warmup 6 --pairs 40`
  reported baseline median `353.16ms`, candidate median `410.03ms`, wins
  `0/40`;
- synthetic direct lookup, many child and larger declaration surfaces:
  `node scripts/prototype-direct-declaration-lookup.mjs --child-rules 16 --declarations 64 --lookups 200000 --warmup 8 --pairs 60`
  reported baseline median `1036.72ms`, candidate median `1369.28ms`, wins
  `0/60`.

Follow-up direct-cache evidence:

- added a `Rules`-owned local declaration-name bucket and a conservative
  recursive lookup cache for no-filter/no-start declaration lookups. The direct
  path still discovers children by reverse-recursing through `Rules.value`; it
  does not read `_rulesSet`, `rulesSet`, or declaration registries;
- focused behavior gate still passed under `JESS_DIRECT_DECLARATION_LOOKUP=1`:
  `pnpm --filter @jesscss/core exec vitest src/tree/__tests__/rules.test.ts src/tree/__tests__/reference.test.ts --run`
  (`173` tests, `8` skipped);
- with scope frames prebuilt, synthetic var-only lookup on larger declaration
  surfaces:
  `node scripts/prototype-direct-declaration-lookup.mjs --scope-frame 1 --key-mode vars --child-rules 4 --declarations 64 --lookups 200000 --warmup 6 --pairs 40`
  reported baseline median `358.02ms`, candidate median `270.56ms`, wins
  `40/40`;
- with direct declaration-name caches, synthetic property-only lookup on larger
  declaration surfaces:
  `node scripts/prototype-direct-declaration-lookup.mjs --scope-frame 1 --key-mode properties --child-rules 4 --declarations 64 --lookups 200000 --warmup 6 --pairs 40`
  reported baseline median `347.31ms`, candidate median `250.04ms`, wins
  `40/40`;
- with both cache surfaces, synthetic mixed lookup on larger declaration
  surfaces:
  `node scripts/prototype-direct-declaration-lookup.mjs --scope-frame 1 --key-mode mixed --child-rules 4 --declarations 64 --lookups 200000 --warmup 6 --pairs 40`
  reported baseline median `343.92ms`, candidate median `259.36ms`, wins
  `40/40`;
- real-ish Less property-access recursion after direct caches:
  `node scripts/compare-less-parse-render-env.mjs --env JESS_DIRECT_DECLARATION_LOOKUP --fixture scripts/fixtures/less-hotpath/declaration-access-recursion.less --warmup 6 --pairs 30`
  reported baseline median `1232.26ms`, candidate median `1227.71ms`, median
  ratio `-0.39%`, wins `16/30`, `t=-1.19`; still not a decisive real
  parse/render speed signal.

Follow-up traversal-order merge evidence:

- removed `comparePosition` from the direct declaration helper. Same-surface
  ties now use numeric source index; cross-surface ties preserve direct
  traversal order instead of sorting arbitrary nodes after lookup;
- focused behavior gate still passed under `JESS_DIRECT_DECLARATION_LOOKUP=1`:
  `pnpm --filter @jesscss/core exec vitest src/tree/__tests__/rules.test.ts src/tree/__tests__/reference.test.ts --run`
  (`173` tests, `8` skipped);
- real-ish Less property-access recursion, render phase:
  `node scripts/compare-less-parse-render-env.mjs --phase render --env JESS_DIRECT_DECLARATION_LOOKUP --fixture scripts/fixtures/less-hotpath/declaration-access-recursion.less --warmup 8 --pairs 50`
  reported baseline median `1211.08ms`, candidate median `1203.91ms`, median
  ratio `-0.19%`, wins `25/50`, `t=0.03`; behavior-safe simplification, not a
  speed win.

Interpretation: registryless declaration lookup with `Rules`-owned caches now
has a clear mechanical win in direct lookup loops, including larger declaration
bodies. The remaining gap is translating that into broad eval/render wins: the
current property-access fixture is dominated enough by parse/render/output work
that the lookup win is diluted. The next full-find experiment should apply the
same model to callable candidates end-to-end: per-`Rules` direct name/path
caches plus reverse recursive visible-child traversal, with registry fallback
only for explicitly unsupported option shapes.

### Direct Callable Tree-Crawl Prototype

Date: 2026-06-08.

Hypothesis: simple callable lookup should be able to replace the registry child
surface walk with a direct `Rules`-owned lookup surface: exact callable buckets,
reverse recursive child traversal, and parent ascent only in the outer loop.
Child recursion must not immediately search parents.

Prototype shape:

- env-gated through `JESS_DIRECT_CALLABLE_LOOKUP=1`;
- `findMixinsFast(...)` switches its local-bucket/child-surface implementation
  under the env flag instead of doing a duplicate pre-check before the old path;
- direct child recursion walks direct `Rules.value` surfaces (`Rules`, `Ruleset`,
  `Mixin`, `AtRule`) and passes control through the existing visibility helper;
- direct `Rules` children are included explicitly so imported root-like child
  surfaces are visible without reading `_rulesSet`;
- `Rules.directChildRuleEntries` carries direct child lookup surfaces once built
  and is appended when a new child `Rules` surface is registered, avoiding
  repeated `Rules.value` rescans on recursive mixin output;
- exact local callable hits reuse already-carried `mixinsByName` when available.

Behavior evidence:

- `pnpm --filter @jesscss/core build` passed;
- `JESS_DIRECT_DECLARATION_LOOKUP=1 JESS_DIRECT_CALLABLE_LOOKUP=1 pnpm --filter @jesscss/core exec vitest src/tree/__tests__/mixin.test.ts src/tree/__tests__/reference.test.ts src/tree/__tests__/rules.test.ts --run`
  passed (`302` tests, `8` skipped).

Diagnostic counter evidence on
`scripts/fixtures/less-hotpath/simple-mixin-recursion.less`:

- baseline and candidate both called `findMixinsFast` `21001` times and
  `_indexRules` `1002` times for one render;
- naive direct replacement added `42002` direct child collector calls and about
  `21003` actual child-list builds;
- carrying direct child surfaces reduced collector calls to `2003`, all
  first-time builds, with cached property reads for the remaining hot lookups.

Benchmark evidence:

- duplicate direct pre-check before the old fast path was rejected: render-only
  paired comparison on `simple-mixin-recursion.less` reported baseline median
  `398.24ms`, candidate median `413.89ms`, median ratio `3.78%`, wins `5/50`,
  `t=6.88`;
- replacement-style direct traversal before carrying child surfaces was also
  slower: baseline median `397.00ms`, candidate median `407.64ms`, median ratio
  `2.77%`, wins `8/50`, `t=5.36`;
- after carrying direct child surfaces and inlining cached property reads:
  `node scripts/compare-less-parse-render-env.mjs --env JESS_DIRECT_CALLABLE_LOOKUP --fixture scripts/fixtures/less-hotpath/simple-mixin-recursion.less --phase render --warmup 8 --pairs 50`
  reported baseline median `397.00ms`, candidate median `401.38ms`, median
  ratio `0.59%`, wins `22/50`, `t=1.80`.
- the callable namespace helper no longer insertion-sorts namespace mixin
  candidates with `comparePosition`; it preserves the lookup traversal order.
  Focused behavior still passed with both direct flags enabled (`302` tests,
  `8` skipped);
- the broader `scope-lookup-stress.less` fixture exposed a frame coverage bug:
  live-parameter `ScopeFrame`s were marked `callablesCovered`/miss-covered after
  indexing without receiving the actual `callableBucketsByName` pointer. A
  nested `.leaf()` lookup inside a parameterized `.inner()` body could therefore
  return a false frame miss before crawling the body. The fix hydrates the frame
  bucket pointer when indexing completes and when callable registration creates
  the bucket map after a frame already exists. A focused regression was added:
  `keeps nested callable buckets visible on live parameter scope frames`;
- after that fix, `scope-lookup-stress.less` renders in baseline, direct
  declaration, direct callable, registryless, and combined modes.

Interpretation: direct callable traversal is now mechanically close to the old
fast path and avoids the worst rescans, but it is not a measured speed win on
the hit-heavy recursive mixin fixture. Keep the semantic lessons: carry direct
child surfaces at registration/mutation time, include direct `Rules` children,
and keep child recursion parentless. Do not claim callable registry removal is
faster until the broader callable binding/candidate path is replaced enough to
delete old registry work instead of approximating it beside existing fast maps.

### Registryless Callable Frame/Tree Hybrid

Date: 2026-06-08.

Hypothesis: callable lookup should use one scope-frame layer for live bindings
and stable exact-name buckets, then direct-crawl the current `Rules` body when a
frame is not fully covered. Parent walking stays in the outer lookup; recursive
child crawling uses `searchParents: false` so it does not immediately re-enter
the parent chain.

Current behavior evidence:

- `pnpm --filter @jesscss/core build` passed;
- `pnpm --filter @jesscss/core exec vitest src/tree/__tests__/mixin.test.ts --run`
  passed (`130` tests);
- `JESS_DIRECT_DECLARATION_LOOKUP=1 JESS_DIRECT_CALLABLE_LOOKUP=1 JESS_REGISTRYLESS_MIXIN_LOOKUP=1 pnpm --filter @jesscss/core exec vitest src/tree/__tests__/mixin.test.ts src/tree/__tests__/reference.test.ts src/tree/__tests__/rules.test.ts --run`
  passed (`303` tests, `8` skipped);
- a one-off flag matrix on `scripts/fixtures/less-hotpath/scope-lookup-stress.less`
  rendered successfully for baseline, `JESS_DIRECT_DECLARATION_LOOKUP=1`,
  `JESS_DIRECT_CALLABLE_LOOKUP=1`, `JESS_REGISTRYLESS_MIXIN_LOOKUP=1`,
  declaration+callable direct mode, and all three flags together.

Benchmark evidence on `scope-lookup-stress.less`, render phase, paired
comparison with `--warmup 8 --pairs 50`:

- `JESS_REGISTRYLESS_MIXIN_LOOKUP`: baseline median `59.00ms`, candidate median
  `57.97ms`, median ratio `-1.37%`, wins `33/50`, `t=-2.69`;
- `JESS_DIRECT_CALLABLE_LOOKUP`: baseline median `58.43ms`, candidate median
  `58.81ms`, median ratio `0.37%`, wins `21/50`, `t=1.56`;
- `JESS_DIRECT_DECLARATION_LOOKUP`: baseline median `57.32ms`, candidate median
  `57.02ms`, median ratio `-0.04%`, wins `26/50`, `t=0.73`;
- with declaration+callable direct modes already enabled, toggling
  `JESS_REGISTRYLESS_MIXIN_LOOKUP` still won: baseline median `59.40ms`,
  candidate median `58.56ms`, median ratio `-1.39%`, wins `37/50`, `t=-3.37`;
- all three flags versus all flags off: baseline median `59.18ms`, candidate
  median `57.74ms`, median ratio `-1.75%`, wins `37/50`, `t=-2.70`.

Follow-up exact-callable child-crawl evidence:

- exact string callable lookup now treats mixin definitions in the current
  `Rules.value` as direct bucket entries, not as child surfaces to recursively
  crawl. Child crawling remains for direct `Rules`, `Ruleset`, and `AtRule`
  surfaces, and document-order/depth traversal still uses the broader
  `childRulesOf(...)` helper;
- all-flags focused behavior still passed:
  `JESS_DIRECT_DECLARATION_LOOKUP=1 JESS_DIRECT_CALLABLE_LOOKUP=1 JESS_REGISTRYLESS_MIXIN_LOOKUP=1 pnpm --filter @jesscss/core exec vitest src/tree/__tests__/mixin.test.ts src/tree/__tests__/reference.test.ts src/tree/__tests__/rules.test.ts --run`
  (`303` tests, `8` skipped);
- after rebuilding `@jesscss/core`, `mixins-guards.less` improved from a clear
  registryless regression to roughly neutral/noisy: baseline median `20.15ms`,
  candidate median `19.56ms`, median ratio `0.68%`, wins `15/30`, `t=0.54`;
- the recursive stress fixture retained a registryless win after the same
  change: baseline median `57.35ms`, candidate median `56.67ms`, median ratio
  `-1.67%`, wins `37/50`, `t=-1.94`;
- one-render counters on `mixins-guards.less` changed from `93` direct callable
  entry builds / `4455` exact-bucket probes to `4` direct callable entry builds
  / `3143` exact-bucket probes. Remaining overhead is still many bucket probes
  across child/parent traversal, so the next target is carrying a stronger
  "this child surface can contain callable hits for this shape" fact instead of
  probing every reachable surface.

Follow-up exact-callable child-surface capability evidence:

- exact string callable lookup now keeps a narrower carried fact,
  `Rules.hasExactCallableChildSurface`, beside the existing direct child-surface
  state. A child `Rules` surface is added to recursive exact-callable traversal
  only if its body can contain direct `Mixin`, `Ruleset`, `AtRule`, or nested
  `Rules` callable surfaces. The fact is updated during indexing/cache reset and
  when `addDirectChildRuleEntry(...)` already sees a new child surface;
- focused all-flags behavior and lint still passed:
  `pnpm exec eslint packages/core/src/tree/rules.ts`, and
  `JESS_DIRECT_DECLARATION_LOOKUP=1 JESS_DIRECT_CALLABLE_LOOKUP=1 JESS_REGISTRYLESS_MIXIN_LOOKUP=1 pnpm --filter @jesscss/core exec vitest src/tree/__tests__/mixin.test.ts src/tree/__tests__/reference.test.ts src/tree/__tests__/rules.test.ts --run`
  (`303` tests, `8` skipped);
- after rebuilding `@jesscss/core`, one-render counters on `mixins-guards.less`
  under `JESS_REGISTRYLESS_MIXIN_LOOKUP=1` dropped again: exact-bucket probes
  `3143` -> `371`, child collector calls/builds `107` -> `28`, and
  direct callable entry builds stayed at `4`;
- broad `mixins-guards.less` did not produce a speed win, but the longer runs
  also did not show a decision-quality regression:
  `--warmup 8 --pairs 100 --batch-size 1` reported baseline median `13.65ms`,
  candidate median `13.58ms`, mean ratio `1.43%`, wins `48/100`, `t=0.42`;
  `--warmup 8 --pairs 60 --batch-size 5` reported baseline median `69.02ms`,
  candidate median `68.47ms`, mean ratio `1.23%`, wins `31/60`, `t=0.83`;
- recursive `scope-lookup-stress.less` render kept the real signal with a
  longer paired run:
  `node scripts/compare-less-parse-render-env.mjs --env JESS_REGISTRYLESS_MIXIN_LOOKUP --fixture scripts/fixtures/less-hotpath/scope-lookup-stress.less --phase render --warmup 10 --pairs 100`
  reported baseline median `56.04ms`, candidate median `55.14ms`, mean ratio
  `-1.64%`, wins `85/100`, `t=-4.46`.

Follow-up frame exact-miss coverage evidence:

- `ScopeFrame.callableMissesCovered` now uses the exact callable child-surface
  fact instead of the broader `_rulesSet`/any-child-surface predicate. A focused
  test proves a declaration-only child `Rules` surface no longer forces the
  `Rules.findMixinsFast(...)` bridge for a simple exact callable miss, while a
  child surface with a callable still keeps the bridge;
- focused all-flags behavior and lint still passed:
  `pnpm exec eslint packages/core/src/tree/rules.ts packages/core/src/tree/__tests__/mixin.test.ts`, and
  `JESS_DIRECT_DECLARATION_LOOKUP=1 JESS_DIRECT_CALLABLE_LOOKUP=1 JESS_REGISTRYLESS_MIXIN_LOOKUP=1 pnpm --filter @jesscss/core exec vitest src/tree/__tests__/mixin.test.ts src/tree/__tests__/reference.test.ts src/tree/__tests__/rules.test.ts --run`
  (`304` tests, `8` skipped);
- one-render `mixins-guards.less` counters barely moved from the prior
  child-surface patch: exact-bucket probes `371` -> `370`,
  `findMixinsFast` calls `46` -> `45`, and child collector builds stayed `28`.
  This is useful predicate precision, not a standalone broad speed win;
- paired `mixins-guards.less` with `--warmup 8 --pairs 60 --batch-size 5`
  reported baseline median `68.72ms`, candidate median `69.13ms`, mean ratio
  `-0.67%`, wins `36/60`, `t=-0.94`; still neutral/no decision-quality broad
  regression;
- paired `scope-lookup-stress.less` render with `--warmup 10 --pairs 100`
  reported baseline median `57.04ms`, candidate median `56.17ms`, mean ratio
  `-1.18%`, wins `76/100`, `t=-3.19`, preserving the registryless stress
  signal.

Follow-up registryless result-cache evidence:

- the existing Map-backed result cache is opt-in through
  `JESS_REGISTRYLESS_MIXIN_CACHE=1`. With registryless lookup already enabled,
  it was not worth enabling globally: `mixins-guards.less` with `--warmup 8
  --pairs 60 --batch-size 5` reported baseline median `68.52ms`, candidate
  median `69.39ms`, mean ratio `1.89%`, wins `28/60`, `t=0.75`;
- the same Map cache does help the recursive stress shape:
  `JESS_REGISTRYLESS_MIXIN_LOOKUP=1 node scripts/compare-less-parse-render-env.mjs --env JESS_REGISTRYLESS_MIXIN_CACHE --fixture scripts/fixtures/less-hotpath/scope-lookup-stress.less --phase render --warmup 10 --pairs 100`
  reported baseline median `56.76ms`, candidate median `55.20ms`, mean ratio
  `-3.67%`, wins `91/100`, `t=-8.49`;
- one-render cache instrumentation explained the split. On `mixins-guards.less`,
  Map cache mode had `7` eligible cache checks, `0` hits, and `4` sets. On
  `scope-lookup-stress.less`, it had `364` eligible checks, `358` hits, and
  `6` sets;
- a cheaper one-entry cache prototype now exists behind
  `JESS_REGISTRYLESS_MIXIN_LAST_CACHE=1`. It stores only the last registryless
  mixin lookup key/result on the owning `Rules`, invalidated with the existing
  registryless lookup cache state. The first version returned a small
  cache-access wrapper per eligible lookup; the follow-up inlined the last-key
  `has`/`get`/`set` operations into private `Rules` helpers so the env-gated
  one-entry path no longer allocates that wrapper. Focused all-flags behavior
  and lint passed with the flag enabled:
  `pnpm exec eslint packages/core/src/tree/rules.ts`, and
  `JESS_DIRECT_DECLARATION_LOOKUP=1 JESS_DIRECT_CALLABLE_LOOKUP=1 JESS_REGISTRYLESS_MIXIN_LOOKUP=1 JESS_REGISTRYLESS_MIXIN_LAST_CACHE=1 pnpm --filter @jesscss/core exec vitest src/tree/__tests__/mixin.test.ts src/tree/__tests__/reference.test.ts src/tree/__tests__/rules.test.ts --run`
  (`304` tests, `8` skipped);
- after inlining the cache access, with registryless already enabled, the
  one-entry cache stayed neutral on the broad fixture and positive on stress:
  `mixins-guards.less` `--warmup 8 --pairs 60 --batch-size 5` reported baseline
  median `66.29ms`, candidate median `66.61ms`, mean ratio `0.30%`, wins
  `32/60`, `t=-0.24`; `scope-lookup-stress.less` render with `--warmup 10
  --pairs 100` reported baseline median `55.43ms`, candidate median `54.28ms`,
  mean ratio `-1.36%`, wins `75/100`, `t=-3.70`;
- combined baseline-vs-registryless evidence with the inlined one-entry cache
  flag enabled kept the broad fixture neutral and preserved the recursive stress
  win: `JESS_REGISTRYLESS_MIXIN_LAST_CACHE=1 node scripts/compare-less-hotpath-env.mjs --env JESS_REGISTRYLESS_MIXIN_LOOKUP --fixture tests-unit/mixins-guards/mixins-guards.less --warmup 8 --pairs 60 --batch-size 5`
  reported baseline median `67.45ms`, candidate median `67.25ms`, mean ratio
  `0.08%`, wins `32/60`, `t=-0.23`; `JESS_REGISTRYLESS_MIXIN_LAST_CACHE=1 node scripts/compare-less-parse-render-env.mjs --env JESS_REGISTRYLESS_MIXIN_LOOKUP --fixture scripts/fixtures/less-hotpath/scope-lookup-stress.less --phase render --warmup 10 --pairs 100`
  reported baseline median `56.86ms`, candidate median `55.12ms`, mean ratio
  `-3.00%`, wins `85/100`, `t=-5.97`.

Follow-up default one-entry cache evidence:

- the inlined one-entry cache is now the default cache mode when
  `JESS_REGISTRYLESS_MIXIN_LOOKUP=1`. Set
  `JESS_REGISTRYLESS_MIXIN_LAST_CACHE=0` to measure registryless without it, or
  `JESS_REGISTRYLESS_MIXIN_CACHE=1` to force the older Map cache experiment;
- focused all-flags behavior and lint still passed with default cache mode:
  `pnpm exec eslint packages/core/src/tree/rules.ts`, and
  `JESS_DIRECT_DECLARATION_LOOKUP=1 JESS_DIRECT_CALLABLE_LOOKUP=1 JESS_REGISTRYLESS_MIXIN_LOOKUP=1 pnpm --filter @jesscss/core exec vitest src/tree/__tests__/mixin.test.ts src/tree/__tests__/reference.test.ts src/tree/__tests__/rules.test.ts --run`
  (`304` tests, `8` skipped);
- paired default registryless comparisons against old baseline:
  `mixins-guards.less` `--warmup 8 --pairs 60 --batch-size 5` reported
  baseline median `66.31ms`, candidate median `65.76ms`, mean ratio `-1.32%`,
  wins `33/60`, `t=-1.48`; `scope-lookup-stress.less` render with `--warmup 10
  --pairs 100` reported baseline median `56.54ms`, candidate median `54.42ms`,
  mean ratio `-3.02%`, wins `92/100`, `t=-9.27`;
- paired cache off/on under registryless confirmed the default cache still
  earns its keep on the recursive shape and stays broad-neutral:
  `scope-lookup-stress.less` render with `JESS_REGISTRYLESS_MIXIN_LOOKUP=1
  --env JESS_REGISTRYLESS_MIXIN_LAST_CACHE --warmup 10 --pairs 100` reported
  baseline median `56.22ms`, candidate median `55.16ms`, mean ratio `-2.25%`,
  wins `79/100`, `t=-5.57`; `mixins-guards.less` with `--warmup 8 --pairs 60
  --batch-size 5` reported baseline median `68.16ms`, candidate median
  `67.55ms`, mean ratio `0.40%`, wins `29/60`, `t=0.04`;
- extra default hot-path fixture checks did not show a broad regression:
  `import-reference.less` with `--warmup 6 --pairs 40 --batch-size 3` reported
  baseline median `43.46ms`, candidate median `42.57ms`, mean ratio `-3.19%`,
  wins `28/40`, `t=-1.94`; `media.less` reported baseline median `16.05ms`,
  candidate median `16.11ms`, mean ratio `1.48%`, wins `20/40`, `t=0.50`;
  `extend-chaining.less` reported baseline median `12.75ms`, candidate median
  `12.76ms`, mean ratio `-0.27%`, wins `22/40`, `t=-0.44`.

Follow-up cache-key construction cleanup:

- cache-key tuple construction now uses named separators plus direct string
  concatenation instead of allocating an array solely to `.join(...)` the exact
  lookup key, filter type, and parent-search bit. Array/path lookup still joins
  the path segments for the path component only;
- pre-cleanup one-render instrumentation with default registryless mode showed
  cache-key helper calls are mostly skipped but still frequent on the recursive
  fixture: `mixins-guards.less` had `67` calls / `7` eligible;
  `scope-lookup-stress.less` had `1263` calls / `362` eligible; and
  `import-reference.less` had `11` calls / `0` eligible;
- focused all-flags behavior and lint still passed:
  `pnpm exec eslint packages/core/src/tree/rules.ts`, and
  `JESS_DIRECT_DECLARATION_LOOKUP=1 JESS_DIRECT_CALLABLE_LOOKUP=1 JESS_REGISTRYLESS_MIXIN_LOOKUP=1 pnpm --filter @jesscss/core exec vitest src/tree/__tests__/mixin.test.ts src/tree/__tests__/reference.test.ts src/tree/__tests__/rules.test.ts --run`
  (`304` tests, `8` skipped);
- post-cleanup paired default registryless comparisons preserved the existing
  shape but should not be treated as a standalone speed claim:
  `mixins-guards.less` `--warmup 8 --pairs 60 --batch-size 5` reported
  baseline median `67.42ms`, candidate median `67.69ms`, mean ratio `-0.57%`,
  wins `33/60`, `t=-0.88`; `scope-lookup-stress.less` render with `--warmup
  10 --pairs 100` reported baseline median `55.81ms`, candidate median
  `53.99ms`, mean ratio `-2.74%`, wins `87/100`, `t=-5.19`.

Follow-up default registryless callable lookup:

- registryless mixin/callable lookup is now the default path. The legacy path is
  temporarily reachable through `JESS_LEGACY_MIXIN_LOOKUP=1` only for
  comparison, bisecting, and deletion staging. The old
  `JESS_REGISTRYLESS_MIXIN_LOOKUP=1` enable flag is no longer required for
  ordinary focused tests or benchmarks;
- focused default-path behavior and lint passed with no registryless env flag:
  `pnpm exec eslint packages/core/src/tree/rules.ts packages/core/src/tree/__tests__/mixin.test.ts`, and
  `pnpm --filter @jesscss/core exec vitest src/tree/__tests__/mixin.test.ts src/tree/__tests__/reference.test.ts src/tree/__tests__/rules.test.ts --run`
  (`304` tests, `8` skipped);
- paired legacy-vs-default comparisons used
  `JESS_LEGACY_MIXIN_LOOKUP` with `--baseline 1 --candidate 0`. Results:
  `mixins-guards.less` `--warmup 8 --pairs 60 --batch-size 5` reported legacy
  baseline median `70.87ms`, default-registryless candidate median `71.30ms`,
  mean ratio `-0.91%`, wins `35/60`, `t=-1.20`;
  `scope-lookup-stress.less` render with `--warmup 10 --pairs 100` reported
  legacy baseline median `56.16ms`, default-registryless candidate median
  `54.08ms`, mean ratio `-2.65%`, wins `85/100`, `t=-6.06`;
  `import-reference.less` `--warmup 6 --pairs 40 --batch-size 3` reported mean
  ratio `-1.62%`, wins `29/40`, `t=-1.47`; `media.less` reported mean ratio
  `2.58%`, wins `19/40`, `t=0.41` and remains neutral/noisy.

Follow-up string-key legacy branch deletion:

- string-key `Rules.find('mixin', string, ...)` now always uses the
  registryless/frame/direct-crawl path. The temporary `JESS_LEGACY_MIXIN_LOOKUP`
  opt-out now only affects the array/namespace branch while that path is
  staged for deletion;
- focused default-path behavior and lint still passed:
  `pnpm exec eslint packages/core/src/tree/rules.ts`, and
  `pnpm --filter @jesscss/core exec vitest src/tree/__tests__/mixin.test.ts src/tree/__tests__/reference.test.ts src/tree/__tests__/rules.test.ts --run`
  (`304` tests, `8` skipped);
- paired `JESS_LEGACY_MIXIN_LOOKUP` comparisons are now partly measuring only
  the remaining array/namespace opt-out, so treat them as regression checks
  rather than pure string-key before/after evidence. `scope-lookup-stress.less`
  render with `--warmup 10 --pairs 100` still won cleanly: baseline median
  `55.85ms`, candidate median `54.03ms`, mean ratio `-3.14%`, wins `84/100`,
  `t=-8.89`. `mixins-guards.less` was mixed/noisy: `--warmup 10 --pairs 100
  --batch-size 5` reported baseline median `67.37ms`, candidate median
  `67.92ms`, mean ratio `1.32%`, wins `46/100`, `t=1.20`.

Next architecture theories to test:

1. Promote exact child-surface capability to the `ScopeFrame` once the frame
   already receives callable coverage facts. The current `Rules` bit proved the
   counter cut; the next version should let exact simple-name lookup answer
   three questions from the frame without touching child arrays: this frame has
   exact callable buckets; this frame has no child callable surfaces for simple
   exact names; this frame has child surfaces that might contain simple
   callables. A miss can stop only in the first two cases.
2. Split child-surface facts by lookup shape. A nested `Ruleset`/`AtRule` may
   matter for exact simple names, namespace paths, declarations, or output
   leakage differently. One broad `hasDirectChildRuleSurface` forces too many
   defensive crawls. Prefer narrow booleans/counters such as
   `hasExactCallableChildSurface`, `hasNamespaceCallableChildSurface`, and
   declaration visibility facts if they can be carried at the same point
   `registerNode(...)` already sees the child.
3. Cache misses at the frame/local-surface level only when the frame has a
   stable version and coverage proof. Avoid broad result caches that allocate a
   map entry per transient option shape. A useful cache key should be simple:
   exact key plus include-rulesets/filter shape, invalidated by the existing
   registration mutation that already clears direct callable caches.
   The one-entry cache prototype supports this direction for repeated recursive
   exact lookups. The wrapper allocation has been removed and the inlined cache
   is now default inside the registryless prototype. Registryless callable
   lookup is now also the default runtime path. The next refinement should
   delete the remaining array/namespace legacy opt-out by proving the direct
   namespace path has enough parity coverage, then remove
   `JESS_LEGACY_MIXIN_LOOKUP` entirely.
4. Prefer negative capability over positive result caching. The broad fixture
   regressed because the candidate path repeatedly proved "nothing in this
   child surface" after the fact. A cheap carried "cannot contain simple exact
   callable hits" fact avoids both array allocation and recursive function-call
   ladders.
5. Keep parent walking outside child recursion. Child traversal should stay
   `searchParents: false`; otherwise a missing child immediately re-searches
   the parent chain and multiplies exact-bucket probes. Parent ascent belongs
   to the outer `Rules.find(...)` loop or frame chain.
6. Reuse existing direct buckets before building alternate structures. If
   `mixinsByName` exists, exact lookup should read it directly. If it does not,
   build direct buckets once and mark the frame covered. Do not build a
   parallel callable table unless it replaces `mixinsByName` and deletes work.
7. Benchmark both the stress win and ordinary Less fixtures before keeping a
   change. The acceptance bar for the next patch is: preserve the
   `scope-lookup-stress.less` win, avoid regressing `mixins-guards.less`, and
   show counter evidence that exact-bucket probes or child collector builds
   dropped. A patch that only moves time between helper calls should be
   reverted.

Interpretation: the first measured real-render win is not from the direct
callable tree crawl alone; it is from treating the `ScopeFrame` as the shared
live-binding/cache layer and using direct current-body crawl only when that
frame cannot honestly cover the lookup. Keep pursuing registry removal through
this architecture, but continue rejecting direct-callable-only work until it
deletes enough old candidate/registry machinery to beat the current fast path.

## Parked Lessons

- Declaration pre-render caching regressed enough real benchmarks that it should
  not be retried broadly without a tighter profile target.
- Virtual callable-output wrappers passed focused tests but slowed real
  hot-path samples; do not replace owned children with wrapper objects on the
  hot path.
- Local copy-loop polishing is not a destination. Delete the reason for the
  copy or move ownership behind a cold materialization boundary.
- `profile-less-benchmark.mjs` elapsed time is profiler overhead. Do not report
  it as a user-facing speed result unless debugging the profiler itself.
