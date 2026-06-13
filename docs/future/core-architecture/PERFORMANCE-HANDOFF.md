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

### Selector `writeSyntax` Render-Stringification Cut

Date: 2026-06-08.

Status: focused machinery deletion, not a real speed claim.

Pre-pass broad `benchmark.less` status after the parentless callable fix had
`OutputWriter.mark` `154363` and `OutputWriter.getSince` `149331`.
Caller-stack profiling showed selector/header public string APIs as major
illegal render transport: `BasicSelector`, `Ruleset.getHeaderString`,
`CompoundSelector`, `ComplexSelector`, `SelectorList`, and `Any`.

Patch shape: selector containers and `Ruleset.getHeaderString(...)` now use a
direct `writeSyntax(options)` writer path instead of public
`toString(...)`/`toTrimmedString(...)` as child transport. Public string APIs
remain cold wrappers around direct writer emission.

Post-pass broad `benchmark.less` profiler status:
`OutputWriter.mark` `54534`, `OutputWriter.getSince` `49502`,
`OutputWriter.restore` `26638`, `Reference.evalNode` `3619` calls /
`69.29ms`, `Rules.find` `1013` calls / `25.68ms`, elapsed `540.89ms`.

Interpretation: `mark/getSince` traffic moved sharply, but elapsed is
profiler/noisy status only. Do not call this a runtime speed win without a
clean real benchmark before/after.

Remaining measured serialization targets from caller stacks:
`Ruleset.getHeaderString` header-string capture (`21911`),
declaration duplicate pre-rendering (`4129` repeated marks plus
`replaceSince`), `Any.toString` (`6871`), `Dimension`/`Num`, `Color`,
`PseudoSelector`, `Sequence`, and `Quoted`.

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

### Comment/QueryCondition Writer Pass Leash

Date: 2026-06-08.

Change: `Comment` gained a direct scalar `writeSyntax(...)`; `QueryCondition`
split source syntax writing from dynamic value render, removed the source
writer closure, and cut static child writer-mark probes. `BasicSelector`
source serialization now emits authored `value` while keeping `valueOf()` as
normalized key text.

Hotpath status:

- `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `10.23ms` unstable, `import-reference` median `16.10ms`
  usable, `mixins-guards` median `14.46ms` usable,
  `extend-chaining` median `4.45ms` usable, and `media` median `4.37ms`
  usable.

Interpretation: status only, not speed proof. This pass did not capture a
clean before/after pair. The code-path proof is direct source writing for
comments/query conditions, static query-condition probe removal, and rejection
of invented source writers for JS host wrappers whose tests define no source
syntax contract.

### Flat RenderBuffer / OutputWriter Sharing Leash

Date: 2026-06-09.

Change: internally owned `renderNodeToString(...)` flat buffers can lend their
`parts` array to `OutputWriter`, so flat string rendering can share one chunk
array instead of writing to a writer chunk array and then pushing the same
rendered text into a separate flat buffer. Explicit caller-owned flat buffers
keep their old observable `parts` grouping; segmented render buffers remain
semantic segment buffers and do not share with `OutputWriter`.

Hotpath status:

- `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `9.88ms` usable, `import-reference` median `15.79ms`
  usable, `mixins-guards` median `14.26ms` usable,
  `extend-chaining` median `4.31ms` usable, and `media` median `4.38ms`
  unstable.

Interpretation: status only, not speed proof. The code-path proof is shared
flat writer chunks for internally owned string renders plus converted
prepare/write boundaries in `Node`, `List`, `Sequence`, `Declaration`,
`Block`, `Url`, `Quoted`, and `QueryCondition`. The rejected broader version
changed caller-visible `buffer.parts` chunk shape, so it was narrowed before
keeping the patch.

### Output Writer / RenderBuffer Finishing Leash

Date: 2026-06-09.

Change: extended the shared flat writer finish path to
`AttributeSelector`, escaped-list `Paren`, `Interpolated`, plain `Call`,
evaluated `Ruleset`, and evaluated/body `AtRule` container serialization.
`Rules.writeRulesRenderOutput(...)` was tried and rejected because its writer
output and returned fragment string intentionally differ around body
separators/newlines.

Hotpath status:

- `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `9.89ms` usable, `import-reference` median `16.28ms`
  usable, `mixins-guards` median `14.77ms` usable,
  `extend-chaining` median `4.32ms` usable, and `media` median `4.36ms`
  unstable.

Interpretation: status only, not speed proof. The code-path proof is more
node-local prepare/write pairs using the already introduced shared flat writer
finish path. The remaining `Rules` bridge needs a staging-separation pass,
not a blind shared-writer conversion.

### Call Evaluated Arg/Content Writer Leash

Date: 2026-06-12.

Change: plain/finalized `Call` rendering now writes already-evaluated argument
and content nodes through `writeSyntax(...)` instead of public
`toTrimmedString(...)` transport. The cut covers normal arguments,
escaped-paren argument inners, and call content.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `8099e114` reported:
  `functions` median `13.05ms` unstable, `import-reference` median `20.80ms`
  unstable, `mixins-guards` median `17.10ms` usable,
  `extend-chaining` median `5.10ms` usable, and `media` median `5.85ms`
  usable.
- Post-pass dirty `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `12.87ms` unstable, `import-reference` median `20.64ms`
  unstable, `mixins-guards` median `17.28ms` unstable,
  `extend-chaining` median `5.30ms` unstable, and `media` median `5.81ms`
  noisy.

Interpretation: status only, not speed proof. The code-path proof is the
removal of public string API transport for evaluated `Call` arg/content nodes,
with focused tests that trip if `toTrimmedString(...)` is called. Remaining
`Call` work is ownership/copy pressure, whole-call mark/readback, and helper
ladder reduction.

### EvalSync / MaybePromise Narrowing Leash

Date: 2026-06-12.

Change: added `Node.evalSync(context)` for `!F_MAY_ASYNC`-proven sync eval
paths and removed local `as Node`/`as Promise<Node>` casts where
`isThenable(...)` already narrows `MaybePromise<Node>`. Initial call sites are
`Call`, `Paren`, and `Operation`.

Hotpath status:

- Dirty `pnpm run measure:less:hotpath -- --stable` from `d0bd3717` reported:
  `functions` median `12.41ms` usable, `import-reference` median `19.15ms`
  usable, `mixins-guards` median `17.03ms` usable,
  `extend-chaining` median `4.84ms` usable, and `media` median `5.35ms`
  usable.

Interpretation: status only, not speed proof. There was no clean before/after
pair for this exact patch. The code-path proof is a narrower sync assertion
boundary for flag-proven paths and deletion of casts after existing thenable
checks.

### Full MaybePromise Narrowing / Sync Child Eval Sweep

Date: 2026-06-12.

Change: extended the `evalSync(...)`/`MaybePromise` narrowing rule to
`Expression`, `Block`, `Url`, `PseudoSelector`, `Declaration`, `Interpolated`,
and the shared node-array evaluator. Non-async child paths in expression/block
/url now use `evalSync(...)`; generic maybe-async branches delete local
`as Node`/`as Promise<Node>` casts where `isThenable(...)` already narrows the
value.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `6963d319` reported:
  `functions` median `13.65ms` unstable, `import-reference` median `21.15ms`
  unstable, `mixins-guards` median `17.46ms` unstable,
  `extend-chaining` median `5.43ms` usable, and `media` median `5.71ms`
  noisy.
- Post-pass dirty `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `12.88ms` usable, `import-reference` median `22.18ms`
  unstable, `mixins-guards` median `18.12ms` usable,
  `extend-chaining` median `5.32ms` noisy, and `media` median `5.62ms`
  unstable.

Interpretation: status only, not speed proof. The pre/post signals are too
mixed for a runtime claim. The code-path proof is fewer generic thenable
branches on non-async child eval paths and deletion of unsafe local casts after
existing type guards.

### Second MaybePromise Narrowing / Sync Child Eval Sweep

Date: 2026-06-12.

Change: extended the same narrowing rule to `Negative`, `Quoted`, `Condition`,
`AttributeSelector`, `Selector`, `InterpolatedSelector`, `Extend`, `Log`,
`Operation`, `Node` base registration/eval helpers, `Interpolated`,
`SelectorList`, `CompoundSelector`, and `ComplexSelector`. `Negative` now uses
`evalSync(...)` for non-async child render/eval; the other touched paths delete
local assertions where `isThenable(...)` already proves the branch.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `1726d33c` reported:
  `functions` median `13.56ms` usable, `import-reference` median `21.48ms`
  usable, `mixins-guards` median `17.14ms` usable,
  `extend-chaining` median `5.15ms` usable, and `media` median `5.47ms`
  usable.
- Final dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `12.99ms` usable, `import-reference` median `19.78ms`
  usable, `mixins-guards` median `16.72ms` usable,
  `extend-chaining` median `5.24ms` usable, and `media` median `5.85ms`
  usable.

Interpretation: status only, not a runtime win claim. The code-path proof is
deleted assertion scaffolding and a narrower sync assertion boundary on
`Negative`; remaining casts should be attacked by tightening ownership/API
types, not by sprinkling more branch-local assertions.

### Final Broad MaybePromise Assertion Sweep

Date: 2026-06-12.

Change: removed the remaining `as Promise<...>` assertion scaffolding under
`packages/core/src/tree` where `isThenable(...)` already narrows a
`MaybePromise<T>` branch. Touched paths include `List`, `Sequence`,
`QueryCondition`, `Paren`, `CustomDeclaration`, `Declaration`, `AtRule`,
`Ruleset`, `Rules`, and the internal render-buffer adapter. No helper,
traversal, materialization, copy, or metadata mutation was added.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `c6c4d0c` reported:
  `functions` median `14.21ms` usable, `import-reference` median `22.67ms`
  usable, `mixins-guards` median `18.16ms` usable,
  `extend-chaining` median `5.90ms` usable, and `media` median `6.41ms`
  noisy.
- Final dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `11.60ms` usable, `import-reference` median `18.82ms`
  unstable, `mixins-guards` median `16.43ms` usable,
  `extend-chaining` median `5.07ms` usable, and `media` median `5.39ms`
  unstable.

Interpretation: status only, not a runtime win claim. The code-path proof is
the deletion of branch-local assertions after existing thenable checks. The
remaining cast sites are structural identity/value casts and should be handled
by tightening ownership/API types or node-family contracts.

### Ampersand Append Placement State Cut

Date: 2026-06-12.

Change: removed unused ampersand append placement text fields
(`inputItemTexts`, `inputItemCount`, `resultItemTexts`, `resultItemCount`,
`resultText`) and their `toTrimmedString()` array builder. Replaced
`appendValue.split('&')`/`templateParts` with direct `indexOf` scanning, and
replaced selector-list `for...of` plus spread-push with indexed loops.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `acc3a910` reported:
  `functions` median `12.37ms` usable, `import-reference` median `19.95ms`
  unstable, `mixins-guards` median `16.96ms` usable,
  `extend-chaining` median `5.04ms` usable, and `media` median `5.35ms`
  usable.
- Final dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `11.88ms` usable, `import-reference` median `19.60ms`
  usable, `mixins-guards` median `16.21ms` usable,
  `extend-chaining` median `4.82ms` unstable, and `media` median `4.81ms`
  usable.

Interpretation: status only, not a runtime win claim. The code-path proof is
deleted placement string arrays and deleted split/iterator/spread allocation on
ampersand append/template evaluation.

### Mixin / Interpolated / QueryCondition Writer Cut

Date: 2026-06-12.

Change: `Mixin.deriveMixin(...)` now builds its owned value object directly
instead of allocating conditional object-spread fragments for optional fields.
`Interpolated.writeReplacement(...)` writes replacement nodes through
`writeSyntax(...)` plus the existing trim window instead of calling public
`toTrimmedString(...)` as writer transport. `QueryCondition` dynamic render now
uses a straight sync loop and only enters an async rest method after a thenable
is observed, deleting the per-render local closure/rest scaffold from the sync
path.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `9f5b8b43`
  reported: `functions` median `12.64ms` usable, `import-reference` median
  `20.24ms` usable, `mixins-guards` median `16.94ms` usable,
  `extend-chaining` median `4.93ms` unstable, and `media` median `5.22ms`
  usable.
- Final dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `13.18ms` usable, `import-reference` median `20.62ms`
  usable, `mixins-guards` median `17.49ms` usable,
  `extend-chaining` median `5.12ms` usable, and `media` median `5.35ms`
  usable.

Interpretation: status only, not a runtime win claim. The post-pass medians
were slower across the leash, so this pass is kept only as behavior-preserving
machinery deletion. Next performance-sensitive cuts should prioritize larger
measured buckets rather than more local polish unless the code path is
obviously wrong.

### List / Sequence Async Render Scaffold Cut

Date: 2026-06-12.

Change: `List` async-capable render no longer allocates a local
`renderNode(...)` closure or nested async `renderRest(...)` function on the
sync path, and `List[Symbol.iterator]` now returns the array iterator directly
instead of using a generator wrapper. `Sequence` async-capable render no longer
allocates local render-node/rest closures on the sync path; async rest work is
isolated behind private methods only used after a thenable is observed.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `78a26349`
  reported: `functions` median `12.93ms` usable, `import-reference` median
  `20.57ms` usable, `mixins-guards` median `16.32ms` usable,
  `extend-chaining` median `4.80ms` usable, and `media` median `5.31ms`
  usable.
- Final dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `12.19ms` usable, `import-reference` median `19.46ms`
  usable, `mixins-guards` median `16.64ms` usable,
  `extend-chaining` median `5.61ms` usable, and `media` median `5.69ms`
  usable/noisy.

Interpretation: status only, not a runtime win claim. The leash was mixed:
functions/import improved, mixins-guards moved slightly slower, and
extend/media regressed. Keep only as behavior-preserving scaffold deletion;
future passes should keep pressure on larger measured buckets before polishing
more local helper shape.

### Reference Lookup Closure Hoist

Date: 2026-06-13.

Change: hoisted the recursive `findVarWithinScopeSurface(...)` helper out of
`findVarDeclarationFast(...)`, and hoisted `lookupRuntimeVarBinding(...)`'s
local `searchChain(...)` helper to module scope. The same lookup state is now
passed explicitly; traversal and lookup behavior are unchanged.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `8b4c1073`
  reported: `functions` median `12.06ms` usable, `import-reference` median
  `18.18ms` usable, `mixins-guards` median `16.46ms` usable,
  `extend-chaining` median `5.02ms` unstable, and `media` median `5.10ms`
  usable.
- Final dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `12.58ms` usable, `import-reference` median `19.25ms`
  usable, `mixins-guards` median `16.45ms` usable,
  `extend-chaining` median `5.33ms` usable, and `media` median `5.54ms`
  usable.

Interpretation: status only, not a runtime win claim. The post-pass leash was
slower for functions, import-reference, extend-chaining, and media, while
mixins-guards was roughly flat. Keep only as code-path deletion of per-lookup
closure allocation; do not sell it as a speedup.

### Reference Lookup Utility Placement Correction

Date: 2026-06-13.

Change: moved the heavy Reference lookup helper bodies from
`packages/core/src/tree/reference.ts` to
`packages/core/src/tree/util/reference-lookup.ts`. This is a file-boundary and
node-file cleanup pass; traversal and lookup behavior are unchanged.

Hotpath status:

- Dirty post-correction `pnpm run measure:less:hotpath -- --stable` at
  `327f3a2e` reported: `functions` median `12.34ms` usable,
  `import-reference` median `19.23ms` usable, `mixins-guards` median
  `17.02ms` usable, `extend-chaining` median `4.95ms` usable, and `media`
  median `5.34ms` usable.

Interpretation: status only, not a runtime win claim. Keep as architecture
placement cleanup: node files should not carry heavy reusable utility bodies.

### Control-Flow Iteration Scaffold Cut

Date: 2026-06-13.

Change: removed `$for` async-generator entry iteration, per-entry tuple arrays,
the `sourceRules.value.map(...)` iteration child copy path,
`rules.value.some(...)` state-mutation probing, the constructor
`getBindingDeclarations(...)` allocation path, and the public control-render
callback wrapper. `$for` now uses a direct async visitor for resolved entries;
`$if`/`$for`/`$while` public render overloads pass a flat `RenderBuffer`
directly to their existing render routines.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `4cd3718f`
  reported: `functions` median `12.49ms` usable, `import-reference` median
  `20.14ms` usable, `mixins-guards` median `17.28ms` usable,
  `extend-chaining` median `5.15ms` usable, and `media` median `5.44ms`
  usable.
- Dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `12.12ms` usable, `import-reference` median `18.53ms`
  usable, `mixins-guards` median `15.90ms` usable,
  `extend-chaining` median `4.64ms` unstable, and `media` median `5.00ms`
  unstable.

Interpretation: keep as machinery deletion with favorable usable hotpath
signals, but do not call it a proven speedup because two lower medians were
marked unstable and this was not a controlled performance-only run.

### Immediate Callable Wrapper Cut

Date: 2026-06-13.

Change: `Call` direct `Rules`/`Collection` callable render/eval paths and
`Func.evalCall(...)` now call `evaluateCallableCollection(...)` directly
instead of allocating one-entry `MixinCollection` wrappers only to immediately
call `.evalCall(...)`. `MixinCollection` remains live as a callable-value
handoff surface; this pass only cut eval-only wrapper construction.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `af2c6955`
  reported: `functions` median `10.37ms` usable, `import-reference` median
  `15.40ms` usable, `mixins-guards` median `14.67ms` usable,
  `extend-chaining` median `4.56ms` unstable, and `media` median `4.35ms`
  noisy.
- Dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `11.09ms` unstable, `import-reference` median `16.35ms`
  unstable, `mixins-guards` median `14.43ms` usable,
  `extend-chaining` median `4.36ms` usable, and `media` median `4.35ms`
  usable.

Interpretation: status only, not a speed claim. Keep as a small wrapper-node
deletion backed by focused callable tests; the hotpath leash was mixed/noisy.

### Cast/Cloning Callback Scaffold Cut

Date: 2026-06-13.

Change: `packages/core/src/tree/util/cast.ts` now casts JS arrays with a
pre-sized indexed loop instead of `.map(...)`; `packages/core/src/tree/util/cloning.ts`
now scans/copies child arrays and render-frame metadata with indexed loops
instead of `.some(...)`, `.map(...)`, and `[...frames]`. Copy ownership
semantics are unchanged.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `b237feb5`
  reported: `functions` median `14.11ms` unstable,
  `import-reference` median `20.90ms` unstable,
  `mixins-guards` median `17.36ms` unstable,
  `extend-chaining` median `5.44ms` usable, and `media` median `5.67ms`
  usable.
- Dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `13.94ms` unstable,
  `import-reference` median `22.13ms` unstable,
  `mixins-guards` median `17.82ms` unstable,
  `extend-chaining` median `5.56ms` noisy, and `media` median `5.77ms`
  unstable.

Interpretation: status only, not a speed claim. Keep as callback/spread
scaffold deletion in shared cast/copy utilities; the hotpath leash was
unstable/noisy and mixed.

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
