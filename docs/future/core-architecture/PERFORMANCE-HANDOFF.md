# Core Architecture Performance Handoff

This file is the benchmark/profile doctrine and evidence log for Jess core
architecture work.

Use `HANDOFF.md` for routing and `FOCII.md` for the active goal/focus. Use
`AGGRESSIVE-CUTTING-REVIEW.md` for the hardline cutting doctrine. Use this file
for benchmark protocol, measured targets, rejected experiments, historical
evidence, active performance queues, and reactivation thresholds.

Current mode: **benchmark-leashed aggressive cutting**. Performance is no
longer merely parked. The active focus decides the next target, but the
target must be tied back to this file's benchmark/profile evidence rules.

Completion target: the performance campaign is complete only when Jess exceeds
Less 4.x speed on the canonical Less benchmark comparison with stable/usable
wall-clock evidence. A profile refresh, hotspot report, rejected experiment, or
next-target selection completes only that pass; it must not be recorded as
completion of the performance goal.

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
- run stable wall-clock hot-path benchmarks before and after every
  performance-targeting hot-path edit, and record the benchmark `signal=` value
  with the interpretation;
- choose measured performance targets from actual time attribution first:
  V8/CPU profile samples, benchmark phase timing, or scoped elapsed-time
  instrumentation for named functions/tasks;
- use counters only as supporting diagnostics after V8/CPU samples, scoped
  timing, or wall-clock evidence has already identified a timed hot surface.
  Counters answer narrow volume/branch questions that a CPU profile may not
  distinguish, such as which semantic path inside a hot function fired, whether
  a supposed fast path is actually reached, whether a deleted traversal stayed
  deleted, or whether a rejected prototype merely moved work elsewhere. They
  must not pick a performance target by themselves;
- do not claim speed wins without real benchmark evidence;
- reject or reshape changes that reduce local object counts but slow or fail
  to improve the real benchmark, unless the change fixes correctness and the
  regression is explicitly accepted as debt.

## Active Hotspot Leash

Current timed target selection must start from the latest CPU/V8 or scoped
timing evidence. The broad `benchmark.less` lookup counters remain useful
supporting context, but they do not make merge-reference reads or child-entry
scans the active target by themselves.

Current broad `benchmark.less` CPU profile points first at source-surface/copy
and extend work: `Node` construction, `copyChild`,
`createRulesLikeReferenceSurface(...)`, `constructCopy`, garbage collection,
`processExtends(...)`, `isSameOrDescendantRoot(...)`, and
`applyExtendsToSelector(...)`. Keep lookup counters in view only when a timed
profile also shows lookup/reference frames as the real hot task.

2026-06-18 extend root-bit pruning pass: a safe coarse root-level selector-bit
guard now skips extend instructions for roots that share no selector bits with
the target. This is intentionally weaker than the rejected selector-level
candidate pruning: it does not require full `requiredKeySet` containment, does
not assume composed combinator bits are present in the root aggregate, and adds
extended selectors back into the root aggregate when selectors mutate. It also
keeps `Ruleset.selector` and `Ruleset.value.selector` coherent after extend
assignment because direct tests and older value-shape readers observe the
value slot. Evidence on canonical external Less `benchmark.less`
(`--runs=24 --warmup=8 --math=parens-division`) improved from the guard-only
refresh `avg 235.00ms` / `median 222.37ms` to `avg 224.17ms` /
`median 221.04ms`, then `avg 216.93ms` / `median 212.81ms`; after loop-shape
cleanup the rerun was `avg 221.06ms` / `median 218.47ms`. The profiled run
improved from `avg 236.43ms` / `median 229.45ms` to `avg 230.89ms` /
`median 227.83ms`; CPU self-time showed `applyExtendsToSelector(...)`
down from about `42.46ms` to `26.81ms`, while `processExtends(...)` self-time
stayed essentially flat (`64.45ms` to `64.07ms`). Focused extend tests passed
except `extend-rules.test.ts` deep `.l -> ... -> .t` chaining, which was
confirmed failing on branch baseline before this patch.

2026-06-18 extend root target-aggregate pass: the root-bit guard now builds a
single aggregate of visible extend target bits during the existing visibility
scan and skips the whole ruleset loop when that aggregate is disjoint from the
root's original selector bits. It still adds visible `extendWith` bits after
that first existence proof so chained extends can become visible only after a
real root target can start the chain. Focused extend tests passed (`78` passed,
`1` skipped). External canonical Less `benchmark.less`
(`--runs=24 --warmup=8 --math=parens-division`) measured `avg 211.69ms` /
`median 200.74ms` with high variance, then `avg 206.95ms` /
`median 201.76ms`; after removing the extra `visibleExtends` pass and
rebuilding the exact source shape, the final run was `avg 202.89ms` /
`median 200.16ms`, versus the refreshed clean branch `avg 210.71ms` /
`median 210.70ms`. Profiled run for the previous equivalent aggregate shape
was `avg 213.75ms` / `median 208.33ms`; CPU attribution showed
`processExtends(...)` self around `29.39ms`, similar to the refresh, and no
sampled standalone cost for the aggregate merge. Keep as a small
wall-clock/median win unless a later broader run contradicts it.

2026-06-18 default-assignment canonical registration pass: current profile
selection came from
`profiling/core-architecture/20260618-192941-current-refresh-cpu/CPU.20260618.192941.10969.0.001.cpuprofile`,
where `copyChild(...)` self was `352.00ms` / stack `1172.87ms`;
`copyValueForDerived(...)` stack was `325.11ms`; and
`createRegistrationState(...)` stack was `347.39ms`, mostly ordinary Less
declarations whose parser options carried `AssignmentType.Default` (`:`).
The kept cut treats default `:` as no assignment during declaration
registration normalization and lets `Rules._prepareRegisterableNode(...)` use
the existing `reuseCanonical` declaration lane for declarations whose only
assignment marker is default `:`. Merge/add/conditional assignments still take
the owned materialization path.

Focused behavior passed:
`pnpm --filter @jesscss/core test -- --run src/tree/__tests__/declaration.test.ts src/tree/__tests__/reference.test.ts src/tree/__tests__/rules.test.ts -t "renders assignment families without reparenting authored declaration values|normalizes assignment registration without preparing value subtrees|normalizes assignment registration without deriving a declaration surface|does not pull a prior plain declaration into Less-style property merge chains|real Less merge-chain property refs avoid public lookup bridges|routes direct Rules.evalNode through registration prep|renders registration-prepared rules without deriving another root surface"`
(`7` passed, `363` skipped). The broader
`declaration.test.ts -t "coalesces merged declaration lists without recopying
copied leaves"` remains branch-baseline red: it failed with the same
`src: one, two, one, three;` output after temporarily backing out this patch.
`pnpm run verify:baseline -- --changed` also remains branch-baseline red in
this worktree; representative import/mixin/nesting failures sampled from that
run reproduced with this patch backed out.

Ordered benchmark-path rebuild passed before timing. External canonical Less
`benchmark.less --runs=24 --warmup=8 --math=parens-division` measured
`avg 178.73ms` / `median 176.21ms`, then `avg 184.53ms` /
`median 179.40ms`, versus the current refresh `avg 213.86ms` /
`median 199.20ms` with high variance and the previous clean kept-run evidence
around `avg 202.89ms` / `median 200.16ms`. Profiled benchmark
`profiling/core-architecture/20260618-193228-default-assign-canonical-cpu/CPU.20260618.193228.34197.0.001.cpuprofile`
reported `avg 186.21ms` / `median 183.60ms`. CPU attribution moved as
intended: `copyChild(...)` self `352.00ms -> 17.23ms`,
`copyValueForDerived(...)` stack `325.11ms -> 3.18ms`, and
`createRegistrationState(...)` stack `347.39ms -> 1.69ms`. Keep as a measured
wall-clock and CPU-profile win.

2026-06-18 bitset data guard pass: the current profile after default
declaration registration still showed `isNumberArray(...)` under
`dataOf(...)` / `isDisjoint(...)` in selector-bit extend checks. The kept cut
trusts the bitset package's own `data` array shape after `Array.isArray(...)`
instead of validating every word with `.every(...)` on each hot-path check.
This does not change the public bitset contract; it removes repeated defensive
validation from internal bitset reads that already come from `BitSet`.

Focused behavior passed:
`pnpm --filter @jesscss/core test -- --run src/tree/util/__tests__/bitset.test.ts src/tree/util/__tests__/fast-reject.test.ts src/tree/util/__tests__/process-extends.test.ts src/tree/__tests__/extend-roots.test.ts src/tree/__tests__/extend-eval-integration.test.ts`
(`95` passed, `1` skipped), and the assignment/registration smoke passed
(`7` passed, `363` skipped). Ordered benchmark-path rebuild passed before
timing. External canonical Less `benchmark.less
--runs=24 --warmup=8 --math=parens-division` measured `avg 177.37ms` /
`median 173.85ms`, then `avg 182.55ms` / `median 179.24ms`, versus the
default-assignment kept pair of `178.73ms` / `176.21ms` and `184.53ms` /
`179.40ms`. Profile
`profiling/core-architecture/20260618-194009-bitset-data-guard-cpu/CPU.20260618.194009.78647.0.001.cpuprofile`
reported `avg 188.29ms` / `median 185.89ms`; CPU attribution moved
`isNumberArray(...)` from `9.73ms` self / `12.43ms` total to zero, and
`dataOf(...)` total from `12.43ms` to `1.52ms`. After reverting the rejected
root aggregate subset-update prototype and rebuilding the accepted source
shape, the same harness reported `avg 176.81ms` / `median 173.09ms`. Keep as
a small CPU-profile cleanup and neutral-to-small wall-clock win.

Companion correctness repair: the previous default-assignment pass briefly
introduced a runtime import of `AssignmentType` into `rules.ts`, which created
an import cycle exposed by extend tests as `Class extends value undefined is
not a constructor or null` at `declaration-custom.ts`. The fix compares the
normalized parser default literal `':'` in the hot path and keeps the
`Declaration` import type-only.

Rejected follow-up: sparse root aggregate update. A prototype made
`addRootSelectorKeys(...)` skip empty keysets and avoid `or(...)` when the new
selector bits were already a subset of the root aggregate. Focused extend
coverage passed (`110` passed, `1` skipped), but canonical `benchmark.less`
rejected the bookkeeping: `avg 189.38ms` / `median 185.05ms`, and the profiled
run had a large outlier (`avg 230.26ms`, `median 194.37ms`,
`variance 41.16%`). Reverted. Keep the existing rule: one aggregate selector
bitset per extend root is useful, and selector mutations must update it, but
do not add per-update subset checks unless a profile shows duplicate root
ORs are hotter than the subset bookkeeping.

2026-06-18 callable default-assignment reuse pass: refreshed current-source
evidence before the patch was external canonical Less `benchmark.less
--runs=24 --warmup=8 --math=parens-division` at `avg 185.93ms` /
`median 183.36ms` (`variance 4.82%`). The CPU profile
`profiling/core-architecture/20260618-194511-current-refresh-cpu/CPU.20260618.194511.6804.0.001.cpuprofile`
pointed at callable placement/copy stacks: `createOwnedCallableRulesSurface`
total `152.30ms`, `prepareCallableCandidateState` total `152.65ms`,
`copyCallableRulesValue` total `558.88ms`, `copyCallableRulesNode` total
`505.29ms`, and `copyChild` total `389.18ms`.

The kept cut lets `canReuseStaticCallableChildren(...)` treat parser-default
declaration assignment `':'` as ordinary default assignment instead of forcing
the owned callable-copy path. It still rejects nested rulesets, at-rules,
non-default assignment forms, and `setDefined` declarations. The first
prototype allowed `setDefined` through and focused tests caught the semantic
bug: mixin `setDefined` writes stopped updating the resolved caller binding.
That prototype was narrowed before benchmarking.

Focused behavior passed:
`pnpm --filter @jesscss/core test -- --run src/tree/util/__tests__/callable-candidate-state.test.ts src/tree/util/__tests__/callable-candidate-loop.test.ts src/tree/util/__tests__/callable-candidate-execution.test.ts src/tree/util/__tests__/callable-eval.test.ts src/tree/util/__tests__/callable-special-case.test.ts`
(`15` passed), and
`pnpm --filter @jesscss/core test -- --run src/tree/__tests__/declaration.test.ts src/tree/__tests__/reference.test.ts src/tree/__tests__/mixin.test.ts -t "does not pull a prior plain declaration into Less-style property merge chains|real Less merge-chain property refs avoid public lookup bridges|routes mixin setDefined writes through the resolved caller binding|evaluates mixin setDefined writes from live parameter bindings|continues a property merge chain after a mixin emits the first declaration|continues a property merge chain with direct important state after mixin output|continues a property merge chain after a callable ruleset emits the first declaration"`
(`7` passed, `467` skipped). Ordered benchmark-path rebuild passed before
timing.

External canonical Less `benchmark.less --runs=24 --warmup=8
--math=parens-division` reported one noisy run with a large outlier
(`avg 204.74ms`, `median 180.89ms`, `variance 35.59%`), then stable repeats
at `avg 175.16ms` / `median 170.38ms` and `avg 172.94ms` /
`median 172.41ms`. Clean CPU profile
`profiling/core-architecture/20260618-194811-callable-default-assign-reuse-clean-cpu/CPU.20260618.194811.25741.0.001.cpuprofile`
reported `avg 181.40ms` / `median 180.15ms`, and moved the targeted stacks:
`createOwnedCallableRulesSurface` total `152.30ms -> 132.62ms`,
`prepareCallableCandidateState` total `152.65ms -> 130.99ms`,
`copyCallableRulesValue` total `558.88ms -> 553.12ms`,
`copyCallableRulesNode` total `505.29ms -> 491.43ms`, and `copyChild` total
`389.18ms -> 280.24ms`. Keep as a measured wall-clock and CPU-profile win.

2026-06-18 direct child-rule type checks pass: post-callable refresh measured
external canonical Less `benchmark.less --runs=24 --warmup=8
--math=parens-division` at `avg 178.45ms` / `median 176.92ms`
(`variance 5.99%`). The CPU profile
`profiling/core-architecture/20260618-195000-post-callable-reuse-refresh-cpu/CPU.20260618.195000.35206.0.001.cpuprofile`
showed `isNode(...)` as a visible self-time frame while local child
rules/callable-rules probes were on lookup/render stacks.

The kept cut replaces `isNode(node, N.Rules | N.Ruleset | N.AtRule | N.Mixin)`
calls inside `childRulesOf(...)` and `childCallableRulesOf(...)` with direct
`node.type` checks for those known node types. It adds no helpers, state, or
traversal.

Focused behavior passed:
`pnpm --filter @jesscss/core test -- --run src/tree/__tests__/reference.test.ts src/tree/__tests__/mixin.test.ts src/tree/__tests__/rules.test.ts -t "real Less merge-chain property refs avoid public lookup bridges|routes mixin setDefined writes through the resolved caller binding|evaluates mixin setDefined writes from live parameter bindings|direct variable lookup still skips children without variable or reference-import surfaces|direct property lookup still skips children without property or reference-import surfaces|renders registration-prepared rules without deriving another root surface|routes direct Rules.evalNode through registration prep|ScopeFrame callable buckets: static miss skips Rules.findMixinsFast when child surfaces cannot contain exact callables|ScopeFrame callable buckets: prepared child entries stop recursive surface rediscovery"`
(`9` passed, `483` skipped), and
`pnpm --filter @jesscss/core test -- --run src/tree/util/__tests__/callable-candidate-state.test.ts src/tree/util/__tests__/callable-candidate-loop.test.ts src/tree/util/__tests__/callable-candidate-execution.test.ts src/tree/util/__tests__/callable-eval.test.ts src/tree/util/__tests__/callable-special-case.test.ts`
(`15` passed). Ordered benchmark-path rebuild passed before timing.

External canonical Less `benchmark.less --runs=24 --warmup=8
--math=parens-division` reported `avg 174.32ms` / `median 172.11ms`
(`variance 6.25%`) and then `avg 171.53ms` / `median 169.61ms`
(`variance 4.25%`). CPU profile
`profiling/core-architecture/20260618-195354-direct-child-rule-type-checks-cpu/CPU.20260618.195354.57146.0.001.cpuprofile`
reported profiler-overhead `avg 181.64ms` / `median 179.08ms`; parsed samples
showed `isNode(...)` reduced to scattered tiny samples and `processExtends(...)`
as the clearest next core self-time frame (`28` self samples / `151` total in
that run). Keep as a small measured wall-clock and CPU-profile cleanup.

2026-06-18 rejected extend root-bucket relocation/potential-union gate: the
prototype moved root selector bit-bucket population into
`registerRulesetWithRoot(...)`, removed duplicate bucket construction from the
pre-extend snapshot walk, then tried a root bucket plus global `extendWith`
potential union before per-root visibility checks. Focused extend utility,
root, process, and integration suites passed; the branch-baseline deep
`.l -> ... -> .t` chaining test still fails without the patch. Ordered
benchmark-path rebuild passed. External canonical Less `benchmark.less
--runs=24 --warmup=8 --math=parens-division` was neutral: relocation-only runs
reported `avg 173.04ms` / `median 171.15ms`, `avg 176.46ms` /
`median 173.87ms`, and `avg 174.53ms` / `median 170.75ms`; the profiled run
reported `avg 181.52ms` / `median 179.55ms` with
`processExtends(...)` total samples lower (`151 -> 120`) but shifted samples
into registration/bitset work. The tightened potential-union gate still stayed
neutral (`avg 174.45ms` / `median 171.51ms`, then `avg 173.70ms` /
`median 170.24ms`). Reverted. The lesson: one root selector bit bucket is
useful, but moving bucket construction earlier or adding a broad potential
union does not remove enough total work on `benchmark.less`; retry only with a
shape that avoids both global pre-snapshot work and extra per-root bitset ORs.

2026-06-18 rejected root activation closure: a stricter prototype tried to
start each root from its actual selector aggregate, activate only visible
extends whose target bits intersected that aggregate, then add each activated
`extendWith` bitset and repeat until no more visible extends could become
root-relevant. This modeled the "one bitset per extend root can prove whether
anything in the root can match" idea more tightly than the kept coarse
root-bit pruning, while still updating the root aggregate when selectors
mutated. Focused extend tests passed except the known branch-baseline
`extend-rules.test.ts` deep `.l -> ... -> .t` chaining failure. The first
prototype had neutral wall-clock (`avg 208.04ms` / `median 208.46ms`, then
`avg 207.08ms` / `median 206.60ms`) and a promising profiled
`processExtends(...)` self-time around `22.28ms`, but the order-preserving
version kept wall-clock neutral/noisy (`avg 209.69ms` / `median 207.40ms`,
then `avg 210.90ms` / `median 206.87ms`) and profiled
`processExtends(...)` back up around `38.72ms`. Reverted. Keep the existing
coarse root-level bitset guard; do not add activation-closure arrays/loops
unless a future profile shows enough irrelevant visible extends to outweigh
the closure overhead.

2026-06-18 rejected extend helper micro-cut: replacing two
`targetKeys.equals(library.getBitset())` checks with `targetKeys.isEmpty()`
passed focused extend tests and the full Jess package rebuild, but wall-clock
was unstable/no better (`avg 230.99ms` / `median 231.15ms`, then
`avg 213.21ms` / `median 209.41ms`) against the refreshed branch baseline
(`avg 206.88ms` / `median 203.95ms`). Reverted with the activation prototype.
Do not keep bitset helper micro-cuts without a clear wall-clock or CPU signal.

2026-06-18 rejected reference-import cache: caching
`rulesMayContainReferenceImports(...)` as a tri-state on `Rules` dropped that
named CPU frame from about `23.07ms` to `1.64ms`, but canonical
`benchmark.less` wall-clock worsened/noised (`avg 214.64ms` /
`median 207.13ms`, then `avg 216.91ms` / `median 213.47ms` versus refreshed
baseline `avg 206.88ms` / `median 203.95ms`) and garbage collection rose.
Reverted. Do not retry as a generic node flag; if revisited, tie it to an
existing construction/adoption fact.

2026-06-18 rejected selector-key cache: caching ordered selector keys on the
selector node, then in a side table with ampersand skips, failed focused
namespace/ampersand tests. Failures included complex selector mixin-ruleset
indentation in `reference.test.ts` and nested mixin-ruleset lookups in
`mixin.test.ts`. Reverted. A future key cache would need to be scoped to the
semantic selector surface/context, not the raw selector object.

The previous binding/lookup target was `findWithinScopeSurface(...)` and the
callers that still make declaration lookup branch through strategy objects,
child visibility gates, and assignment occurrence fallback.

Use timed proof before reshaping this path. A lookup-targeted measured pass
must answer which of these is hottest in real lookup work:

- strategy fields in `direct-rules-lookup.ts`;
- child declaration-surface traversal through `directDeclarationChildEntries`;
- current-cell assignment target lookup versus occurrence fallback;
- callable reference-import uncertainty and direct crawl handoff;
- handle access object creation in `reference.ts`.

Do not treat one-iteration smoke as a speed result. Use it only as a regression
tripwire after behavior gates.

2026-06-15 leash refresh: `node scripts/profile-less-benchmark.mjs
--file=benchmark-v39.less` is not useful for the current direct-declaration
branching target. It reported empty lookup counters (`rulesFindByType`,
`registryFindByType`, `searchChildrenByType`, and reference-key buckets all
empty), so the next measured lookup pass should instrument
`scope-lookup-stress.less` or another lookup-heavy fixture before splitting
`DeclarationLookupStrategy` or handle access allocation.

2026-06-15 stress fixture profile: `node scripts/profile-less-benchmark.mjs
--fixture=scripts/fixtures/less-hotpath/scope-lookup-stress.less
--compat=false` now profiles repo-local fixtures. It reported
`Reference.evalNode` `6528` calls / `66.46ms`; top reference keys were
`variable:n` `1530`, `variable:depth` `767`, `variable:value` `720`,
`variable:seed` `630`, `variable:local` `540`, `variable:global-base` `450`,
`mixin-ruleset:.path-loop` `405`, and the deep
`#lookup-catalog > #alpha > #beta > #gamma > .pick` path `360`.
`Rules.find` and old registry counters stayed empty, so the next measurement
needs direct lookup counters inside `findWithinScopeSurface(...)`,
scope-frame variable lookup, and callable handle access rather than old
registry wrappers.

2026-06-15 direct declaration counters: the stress fixture now reports
`lookupStats.directLookupCounters`. A direct Jess run showed
`declaration.cacheMiss` `16560`, `declaration.scope.v` `16560`,
`declaration.childEntryEntered` `11520`, `declaration.childEntriesScanned`
`10530`, `declaration.localMatch` `2475`, `declaration.childEntryStartSkip`
`2295`, `declaration.scopeBindingHit` `1665`, and
`declaration.framePrep` `139`. That says the next direct-declaration cut should
target child-entry scans/entries and cache identity before splitting smaller
strategy fields.

2026-06-15 pending declaration prep follow-up: after folding
`pendingDeclarationNames` into declaration frame prep, the same stress fixture
still reported the same leading direct lookup counters:
`declaration.cacheMiss` `16560`, `declaration.scope.v` `16560`,
`declaration.childEntryEntered` `11520`, `declaration.childEntriesScanned`
`10530`, `declaration.childEntryStartSkip` `2295`, and
`declaration.framePrep` `139`. `Reference.evalNode` was `6528` calls /
`59.88ms`. A no-child-surface shortcut using only `hasDirectChildRuleSurface`
failed import/optional/local child-surface tests and was rejected; the next
child-entry pruning attempt needs stronger per-family carried facts. Treat this
as diagnostic counter evidence only; profiler elapsed is not a benchmark speed
claim.

2026-06-15 key-aware dynamic-name bailout follow-up: after making
`lookupScopeFrameVariable(...)` check whether static entries in
`pendingDeclarationNames` can affect the requested key, the stress fixture
reported unchanged direct lookup counters: `declaration.cacheMiss` `16560`,
`declaration.scope.v` `16560`, `declaration.childEntryEntered` `11520`,
`declaration.childEntriesScanned` `10530`, and `declaration.framePrep` `139`.
`Reference.evalNode` was `6528` calls / `62.74ms`. This keeps the same next
performance target: child-entry scans and entry allocation, not old registry
paths.

2026-06-15 dynamic-name promotion cache retention follow-up: after resolved
dynamic-name promotion started deleting direct declaration bucket/cache state
by resolved key, the stress fixture again reported unchanged direct lookup
counters: `declaration.cacheMiss` `16560`, `declaration.scope.v` `16560`,
`declaration.childEntryEntered` `11520`, `declaration.childEntriesScanned`
`10530`, and `declaration.framePrep` `139`. `Reference.evalNode` was `6528`
calls / `62.76ms`. This is correctness/cache-retention evidence for rare
dynamic-name promotion; the measured hot target remains child-entry scans.

2026-06-15 function handle versioning follow-up: after function reference
handles moved to per-function-key versions, the variable-heavy stress fixture
reported unchanged direct lookup counters: `declaration.cacheMiss` `16560`,
`declaration.scope.v` `16560`, `declaration.childEntryEntered` `11520`,
`declaration.childEntriesScanned` `10530`, and `declaration.framePrep` `139`.
`Reference.evalNode` was `6528` calls / `65.56ms`. This is handle-invalidation
proof for function lookups; it does not change the active measured target,
which remains declaration child-entry scans.

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
round needs a before wall-clock benchmark snapshot, actual time attribution for
target selection, one hypothesis, one patch, focused tests, the same after
wall-clock benchmark snapshot, and a keep/revert decision. Counter-only target
selection is not acceptable.

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
pnpm --filter styles-config build
pnpm --filter @jesscss/awaitable-pipe build
pnpm --filter @jesscss/core build
pnpm --filter @jesscss/less-parser build
pnpm --filter @jesscss/plugin-less build
pnpm --filter @jesscss/plugin-less-compat build
pnpm --filter @jesscss/plugin-js build
pnpm --filter jess build
```

In a fresh worktree, do not rely on the narrower historical build set alone:
`jess` imports `styles-config` and `@jesscss/core` imports
`@jesscss/awaitable-pipe`, so both must have `lib/` output before
`measure:less:hotpath` or `profile-less-benchmark.mjs` can run. A full
`pnpm -r --if-present build` may still fail in packages unrelated to this
benchmark path, such as `@jesscss/language-service`; treat that as a setup
signal, then run the focused benchmark-path build set above.

Use profiler/counter runs for diagnosis, not user-facing speed claims:

```sh
node scripts/profile-less-benchmark.mjs --file=benchmark-v37.less
node scripts/profile-less-benchmark.mjs --file=benchmark-v39.less
node scripts/profile-less-benchmark.mjs --file=benchmark-color-stress.less
node scripts/profile-less-benchmark.mjs --file=benchmark.less
```

Use CPU/V8 profiles or scoped timing before choosing a performance target. Do
not run these commands in parallel with wall-clock benchmarks or other
CPU-heavy work; noisy profiles and outlier-heavy benchmark runs are evidence to
rerun, not evidence to keep a patch.

CPU profile options:

```sh
./scripts/profile-test.sh core "<test-file-or-filter>"
./scripts/profile-test.sh jess "<test-file-or-filter>"
node --cpu-prof --cpu-prof-dir=profiling/core-architecture scripts/profile-less-benchmark.mjs --file=benchmark.less
```

Use phase timing only as diagnostic support:

```sh
JESS_PROFILE=1 node scripts/profile-less-benchmark.mjs --file=benchmark-v37.less
```

## Evidence Rules

- **Real benchmark** numbers are the only numbers that count as "Jess got
  faster/slower".
- **CPU profile** sample counts and scoped elapsed-time instrumentation identify
  hot stacks/tasks for target selection; they are not benchmark timings.
- **Instrumented counters** are diagnostic volume/context only. They are useful
  after a timed hotspot is known, mainly for branch-path attribution inside a
  profiled function and for proving that a tested edit changed the intended
  work volume. They do not supersede V8/CPU or scoped timing evidence and are
  not target-selection evidence by themselves.
- Static node/object audits are supporting evidence only.

If a patch reduces local object counts but slows real benchmarks, reject or
reshape it.

## Current Evidence Log

### 2026-06-18 Rules-Like Reference Surface Descriptor Cut

Focus: CPU-profile-backed cut to `createRulesLikeReferenceSurface(...)`, which
the fresh external `benchmark.less` profile showed as a hot self-time frame.

Pre-edit evidence:

- `pnpm run measure:less:hotpath -- --stable` was not decision-quality:
  `functions` unstable median `23.21ms`, `import-reference` noisy median
  `37.06ms`, `mixins-guards` noisy median `32.55ms`, `extend-chaining` noisy
  median `10.36ms`, and `media` unstable median `11.16ms`.
- Sequential external benchmark CPU profile:
  `node --cpu-prof --cpu-prof-dir=/Users/matthew/git/worktrees/jess/performance-evidence/profiling/core-architecture/20260618-141212-external-benchmark-less-cpu benchmark/benchmark-runner.cjs benchmark/benchmark.less --runs=12 --warmup=4 --math=parens-division`
  from `/Users/matthew/git/worktrees/jess/less.js/packages/less`.
- Pre-edit external runner output: median `713.73ms`, average `729.73ms`,
  stddev `62.38ms`, variance `8.55%`, samples `8`.
- Pre-edit CPU artifact:
  `profiling/core-architecture/20260618-141212-external-benchmark-less-cpu/CPU.20260618.141212.27117.0.001.cpuprofile`.
  Relevant self-time: `createRulesLikeReferenceSurface(...)` `243.12ms`,
  `Node` constructor `1060.59ms`, garbage collector `552.18ms`, `copyChild`
  `543.54ms`, `isNode` `428.32ms`, and `_processNodes` `256.31ms`.

Patch kept:

- `createRulesLikeReferenceSurface(...)` no longer calls
  `Object.getOwnPropertyDescriptors(...)`, deletes descriptor entries, and
  defines all copied descriptors.
- It now creates the same prototype-preserving shallow surface, walks own
  property names, skips `sourceNode`/`parent`/`index`, clones `_options`, copies
  direct values, and then defines preserved `sourceNode`, `parent`, and `index`
  metadata explicitly.

Behavior evidence:

- Ordered benchmark-path rebuild passed:
  `styles-config`, `@jesscss/awaitable-pipe`, `@jesscss/core`,
  `@jesscss/css-parser`, `@jesscss/less-parser`, `@jesscss/plugin-less`,
  `@jesscss/plugin-less-compat`, `@jesscss/plugin-js`, and `jess`.
- Focused reference surface tests passed:
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/reference.test.ts -t "preserves direct mixin-ruleset hits|preserves rules-like variable references|renders rules-like variable references|keeps canonical rules-like sources|keeps referenced source value containers canonical|keeps fallback value containers canonical|direct complex selector callable lookup consumes compound selector remainder entries|should resolve nested mixin-ruleset reference chains"`.
- Focused namespace/mixin tests passed:
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts -t "mixin-ruleset calls with args|namespace fast path|ruleset namespace path|mixin namespace path"`.
- The two complex-selector reference indentation expectations still fail after
  restoring the old descriptor implementation and rebuilding, so they are
  baseline-red in this worktree and not a regression from this patch.

Post-edit evidence:

- Sequential external benchmark CPU profile:
  `node --cpu-prof --cpu-prof-dir=/Users/matthew/git/worktrees/jess/performance-evidence/profiling/core-architecture/20260618-141643-surface-copy-post-cpu benchmark/benchmark-runner.cjs benchmark/benchmark.less --runs=12 --warmup=4 --math=parens-division`.
- Post-edit external runner output: median `628.40ms`, average `624.61ms`,
  stddev `96.51ms`, variance `15.45%`, samples `8`. Directionally better than
  the immediate pre-edit runner, but still noisy.
- Post-edit CPU artifact:
  `profiling/core-architecture/20260618-141643-surface-copy-post-cpu/CPU.20260618.141643.8247.0.001.cpuprofile`.
  `createRulesLikeReferenceSurface(...)` self-time dropped to `47.43ms`.
- Post-edit diagnostic profile:
  `node scripts/profile-less-benchmark.mjs --file=benchmark.less` reported
  unchanged lookup counters and `Reference.evalNode` `3567` calls /
  `104.04ms`.
- Post-edit `pnpm run measure:less:hotpath -- --stable` stayed mixed:
  `functions` unstable median `27.54ms`, `import-reference` noisy median
  `39.39ms`, `mixins-guards` usable median `31.21ms`, `extend-chaining`
  unstable median `8.45ms`, and `media` unstable median `9.27ms`.

Verdict: keep as a measured CPU self-time reduction on a named hot frame, not
as a real wall-clock speed win. Next timed targets remain the largest CPU
clusters: generic node construction/copying, GC pressure, and extend root or
selector work.

### 2026-06-18 CPU Attribution Policy Correction

Prompt: counters had been over-weighted as target-selection evidence. Policy is
now tightened: CPU/V8 profile samples, benchmark phase timing, or scoped
elapsed-time instrumentation must identify the hot function/task before a
performance edit. Counters are diagnostic support only.

Sequential external Less alpha CPU-profiled run from
`/Users/matthew/git/worktrees/jess/less.js/packages/less` with the harness links
verified to resolve `@jesscss/core` and `jess` to this worktree:

```sh
node --cpu-prof --cpu-prof-dir=/Users/matthew/git/worktrees/jess/performance-evidence/profiling/core-architecture/20260618-140642-external-benchmark-less-cpu benchmark/benchmark-runner.cjs benchmark/benchmark.less --runs=12 --warmup=4 --math=parens-division
```

Benchmark output was noisy but completed: median `619.88ms`, average
`626.95ms`, stddev `109.15ms`, variance `17.41%`, samples `8`. This is target
selection evidence, not a speed claim.

Profile artifact:
`profiling/core-architecture/20260618-140642-external-benchmark-less-cpu/CPU.20260618.140643.38374.0.001.cpuprofile`.
Top relevant self-time samples included `Node` constructor `906.71ms`,
garbage collector `484.26ms`, `copyChild` `469.48ms`,
`isNode` `356.92ms`, `_processNodes` `214.19ms`,
`createRulesLikeReferenceSurface(...)` `188.37ms`, `constructCopy` `186.09ms`,
`isSameOrDescendantRoot(...)` `140.03ms`, `processExtends(...)` `122.24ms`,
`applyExtendsToSelector(...)` `109.37ms`, `inherit` `97.85ms`,
`copyWithReusableLeaves(...)` `75.93ms`, and `visit` `72.23ms`.

Interpretation: the next performance target should not be chosen from
merge-reference counters alone. The strongest timed clusters are source-surface
preservation/copy construction and extend processing. A quick prototype that
memoized `ExtendRootRegistry.isSameOrDescendantRoot(...)` was rejected before
keep/revert measurement because `process-extends.test.ts` failures were
observed; removing the prototype and rebuilding still left the same focused
test failing, so that test file is not currently a clean regression gate for
this pass. Use broader Less behavior gates and/or repair that test before
relying on it for extend work.

### 2026-06-18 Extend Root Descendant Memoization

Focus: CPU-profile-selected extend stack. This pass does not use counters for
target selection.

Implementation: `ExtendRootRegistry.isSameOrDescendantRoot(...)` now memoizes
root-pair results in a per-registry WeakMap and clears that memo table at
`registerRoot(...)`, the boundary that mutates root graph membership. The
uncached parent walk moved into a private `computeSameOrDescendantRoot(...)`.

Focused behavior proof:

```sh
pnpm --filter @jesscss/core build
pnpm --filter @jesscss/core test -- --run src/tree/util/__tests__/extend-unit.test.ts src/tree/util/__tests__/extend-utils.test.ts src/tree/__tests__/mixin.test.ts -t "namespace fast path|mixin-ruleset calls with args|extendSelector|applyExtendsToSelector|ruleset namespace path|mixin namespace path"
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/ruleset.test.ts -t "extend|prepareRegistration|registration"
```

All passed. The ordered benchmark-path rebuild also passed:

```sh
pnpm --filter styles-config build &&
pnpm --filter @jesscss/awaitable-pipe build &&
pnpm --filter @jesscss/core build &&
pnpm --filter @jesscss/css-parser build &&
pnpm --filter @jesscss/less-parser build &&
pnpm --filter @jesscss/plugin-less build &&
pnpm --filter @jesscss/plugin-less-compat build &&
pnpm --filter @jesscss/plugin-js build &&
pnpm --filter jess build
```

External Less alpha CPU-profiled benchmark from
`/Users/matthew/git/worktrees/jess/less.js/packages/less`:

```sh
node --cpu-prof --cpu-prof-dir=/Users/matthew/git/worktrees/jess/performance-evidence/profiling/core-architecture/20260618-142636-extend-root-cache-post-cpu benchmark/benchmark-runner.cjs benchmark/benchmark.less --runs=12 --warmup=4 --math=parens-division
```

Benchmark output completed but was too noisy for a speed claim: median
`587.80ms`, average `711.62ms`, stddev `309.73ms`, variance `43.53%`, samples
`8`.

Profile artifact:
`profiling/core-architecture/20260618-142636-extend-root-cache-post-cpu/CPU.20260618.142636.41574.0.001.cpuprofile`.

Relevant self-time comparison: previous post-surface-copy broad profile showed
`isSameOrDescendantRoot(...)` around `144.60ms`; this profile reports
`isSameOrDescendantRoot(...)` `8.76ms` and
`computeSameOrDescendantRoot(...)` `8.76ms`. `processExtends(...)` remains hot
at `113.87ms`, `applyExtendsToSelector(...)` remains hot at `97.60ms`, and
copy/GC pressure is still dominant.

Stable hot-path sanity after the edit:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result: all reported fixtures were `unstable` or `noisy`
(`functions.less`, `import-reference.less`, `mixins-guards.less`,
`extend-chaining.less`, `media.less`). Treat this as sanity only, not
decision-quality wall-clock evidence.

Verdict: keep as a CPU-profile-backed reduction in a named hot stack, not as a
real benchmark speed win. Next timed targets should come from the remaining V8
clusters, especially `processExtends(...)`, `applyExtendsToSelector(...)`,
copy/constructor work, and GC pressure.

### 2026-06-18 Ruleset Comparable Header Copy Cut

Focus: CPU-profile-selected render-header copy/constructor stack under
`getComparableHeaderString(...)`.

Kept implementation: `Ruleset.writeHeaderSelector(..., withoutComments=true)`
no longer clones the selector up front. It now writes the source selector
directly unless later reference filtering or visibility isolation needs a
placement-local copy. Source trivia comments are still suppressed by the
existing empty trivia map; selector visibility mutation remains isolated by the
existing `needsVisibleSelectorClone(...)` branch.

Rejected implementation during this pass: `classifyInstructionMatch(...)`
fallback was briefly changed from `applyExtendsToSelector(selector,
[instruction])` to `tryExtendSelector(...)`. Focused tests passed, but the
external CPU-profiled `benchmark.less` run regressed to median `1092.28ms`
with `23.93%` variance and `processExtends(...)` self-time rose to `181.03ms`,
so the code change was reverted. It did reduce classification
`applyExtendsToSelector(...)` samples, but the full benchmark shape rejected
the trade.

Focused behavior proof for the kept ruleset cut:

```sh
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/ruleset.test.ts -t "getComparableHeaderString|writeHeader|HeaderString|visibility forcing|reference|render|comment-free"
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/selector.test.ts -t "comment trivia|selector"
pnpm --filter @jesscss/core test -- --run src/tree/util/__tests__/extend-unit.test.ts src/tree/util/__tests__/extend-utils.test.ts src/tree/__tests__/mixin.test.ts -t "namespace fast path|mixin-ruleset calls with args|extendSelector|applyExtendsToSelector|ruleset namespace path|mixin namespace path"
```

All passed. Ordered benchmark-path rebuild passed before the CPU-profiled
measurement; after temporary A/B reverts only `@jesscss/core` and `jess` were
rebuilt because the touched code was core-only.

External CPU-profiled benchmark for the kept cut:

```sh
node --cpu-prof --cpu-prof-dir=/Users/matthew/git/worktrees/jess/performance-evidence/profiling/core-architecture/20260618-144019-ruleset-header-copy-slim-post-cpu benchmark/benchmark-runner.cjs benchmark/benchmark.less --runs=12 --warmup=4 --math=parens-division
```

Profile artifact:
`profiling/core-architecture/20260618-144019-ruleset-header-copy-slim-post-cpu/CPU.20260618.144019.63405.0.001.cpuprofile`.

The intended header-copy stack moved: the previous post-extend profile had
`copyOwnedWithReusableLeaves(...)` / `constructCopy(...)` under
`ownSelector(...) -> writeHeaderSelector(...) -> getComparableHeaderString(...)`
with BasicSelector/CompoundSelector constructor samples. The kept profile no
longer shows the comparable-header path cloning through `ownSelector(...)`;
remaining `copyOwnedWithReusableLeaves(...)` samples are registration
preparation and reference filtering paths. The run itself was noisy and worse
by median (`738.26ms`, `37.76%` variance), so this is not a wall-clock speed
claim.

Non-profiled same-harness A/B sanity after rebuilding:

- kept patch: median `564.98ms`, average `649.14ms`, variance `26.95%`;
- temporary reverted baseline: median `579.52ms`, average `666.33ms`,
  variance `29.89%`.

This A/B is noisy but does not reject the patch. Stable repo hotpath sanity
remained non-decision-quality: `functions.less`, `import-reference.less`, and
`extend-chaining.less` were `unstable`; `mixins-guards.less` and `media.less`
were `noisy`.

Verdict: keep as a CPU-profile-supported copy/materialization cut with weak
noisy wall-clock support, not as a real speed win. Next timed targets are still
the larger remaining clusters: declaration registration `copyValueForDerived`,
binding-value clone paths, `processExtends(...)` / `applyExtendsToSelector(...)`,
and header writer trim/source-map work.

### 2026-06-18 Header Writer Trim/Trivia Fast Path

Focus: CPU-profile-selected header writer stack under
`getComparableHeaderString(...)`, specifically
`refreshPositions(...) <- trimEndSince(...) <- writeHeaderSelector(...)` and
per-call empty `createTriviaMap(...)` work for comment-free selector headers.

Kept implementation:

- `OutputWriter.trimEndSince(mark)` now returns immediately when the marked
  range is empty or when the last emitted chunk after the mark does not end in
  CSS whitespace. That avoids the previous unconditional position-array refresh
  for a no-op trim.
- `Ruleset.writeHeaderSelector(..., withoutComments=true)` now reuses a
  module-level empty trivia map instead of allocating a new empty map for each
  comment-free header render. The map is used only as immutable lookup input;
  emitted-trivia state remains on the writer/options path.

Focused behavior proof:

```sh
pnpm --filter @jesscss/core test -- --run src/tree/util/__tests__/outputwriter.test.ts src/tree/__tests__/ruleset.test.ts -t "trimEndSince|getComparableHeaderString|writeHeader|HeaderString|visibility forcing|reference|render|comment-free"
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/selector.test.ts -t "comment trivia|selector"
```

Both passed. A broader declaration/query-condition grep also hit the existing
property-merge duplicate failure
`src: one, two, one, three;` versus `src: one, two, three;`; that is not
introduced by this header-writer patch and remains residual correctness debt.

Ordered benchmark-path rebuild passed:

```sh
pnpm --filter styles-config build &&
pnpm --filter @jesscss/awaitable-pipe build &&
pnpm --filter @jesscss/core build &&
pnpm --filter @jesscss/css-parser build &&
pnpm --filter @jesscss/less-parser build &&
pnpm --filter @jesscss/plugin-less build &&
pnpm --filter @jesscss/plugin-less-compat build &&
pnpm --filter @jesscss/plugin-js build &&
pnpm --filter jess build
```

External CPU-profiled benchmark:

```sh
node --cpu-prof --cpu-prof-dir=/Users/matthew/git/worktrees/jess/performance-evidence/profiling/core-architecture/20260618-145644-header-trim-trivia-final-cpu benchmark/benchmark-runner.cjs benchmark/benchmark.less --runs=12 --warmup=4 --math=parens-division
```

Profile artifact:
`profiling/core-architecture/20260618-145644-header-trim-trivia-final-cpu/CPU.20260618.145644.94314.0.001.cpuprofile`.

Result: median `316.07ms`, average `370.46ms`, variance `31.12%`.

Relevant V8 sampled self-time comparison against the previous
`20260618-144019-ruleset-header-copy-slim-post-cpu` profile:

- `refreshPositions(...)`: `142.57ms` -> `0.00ms`;
- `trimEndSince(...)`: `21.46ms` -> `0.00ms`;
- `createTriviaMap(...)`: `29.14ms` -> `8.63ms`, with no material remaining
  `createTriviaMap <- writeHeaderSelector` stack;
- `writeHeaderSelector(...)`: `61.63ms` -> `20.82ms`;
- `getComparableHeaderString(...)`: `3.15ms` -> `1.46ms`.

Non-profiled same-harness wall-clock:

```sh
node benchmark/benchmark-runner.cjs benchmark/benchmark.less --runs=16 --warmup=6 --math=parens-division
```

Result: median `306.11ms`, average `311.08ms`, variance `4.94%`.

Stable repo hotpath sanity:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result: all fixtures remained `unstable` or `noisy`, so this is sanity only
and not decision-quality speed evidence.

Verdict: keep as a CPU-profile-supported header-writer hot-path cut with
supporting same-harness wall-clock evidence. This is progress toward the
canonical benchmark target, not completion of the Less 4.x speed goal. Next
timed targets should come from the remaining largest V8 clusters:
declaration-registration copies, binding-value clone copies, and
`processExtends(...)` / `applyExtendsToSelector(...)`.

### 2026-06-18 Exact Callable Surface Summary Cache

Focus: CPU-profile-selected recursive lookup-surface rediscovery. The final
header-trim profile showed `rulesMayContainExactMixinSurface(...)` as a
`90.70ms` self-time frame, mostly deep recursive self-calls while answering
whether child `Rules` surfaces could contain exact mixin terminals.

Kept implementation:

- `Rules` now caches `mayContainExactMixinSurface` and
  `mayContainExactRulesetSurface` summaries on the rules object.
- Callable registration invalidates those summaries on the current `Rules` and
  ancestor `Rules` nodes. This adds a parent walk at sparse mutation time to
  avoid repeated recursive child-surface walks during lookup/render.

Focused behavior proof:

```sh
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts -t "namespace fast path|mixin-ruleset calls with args|ruleset namespace path|mixin namespace path|exact mixin child surface|child surface|callable"
```

Passed: `78` tests, `117` skipped.

Ordered benchmark-path rebuild passed:

```sh
pnpm --filter styles-config build &&
pnpm --filter @jesscss/awaitable-pipe build &&
pnpm --filter @jesscss/core build &&
pnpm --filter @jesscss/css-parser build &&
pnpm --filter @jesscss/less-parser build &&
pnpm --filter @jesscss/plugin-less build &&
pnpm --filter @jesscss/plugin-less-compat build &&
pnpm --filter @jesscss/plugin-js build &&
pnpm --filter jess build
```

External CPU-profiled benchmark:

```sh
node --cpu-prof --cpu-prof-dir=/Users/matthew/git/worktrees/jess/performance-evidence/profiling/core-architecture/20260618-150130-exact-surface-cache-post-cpu benchmark/benchmark-runner.cjs benchmark/benchmark.less --runs=12 --warmup=4 --math=parens-division
```

Profile artifact:
`profiling/core-architecture/20260618-150130-exact-surface-cache-post-cpu/CPU.20260618.150130.36115.0.001.cpuprofile`.

Result: median `258.91ms`, average `265.73ms`, variance `5.89%`.

Relevant V8 sampled self-time comparison against the previous
`20260618-145644-header-trim-trivia-final-cpu` profile:

- `rulesMayContainExactMixinSurface(...)`: `90.70ms` -> `1.27ms`;
- `getCallableEntriesForKey(...)`: `33.32ms` -> `10.23ms`;
- `processExtends(...)`: `81.17ms` -> `42.25ms`;
- `copyChild(...)`: `431.49ms` -> `366.20ms`.

Non-profiled same-harness wall-clock:

```sh
node benchmark/benchmark-runner.cjs benchmark/benchmark.less --runs=16 --warmup=6 --math=parens-division
```

Result: median `279.78ms`, average `281.32ms`, variance `11.18%`.

Stable repo hotpath sanity:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result:

- `import-reference.less`: `signal=usable`, `trimmedMedian=19.10ms`;
- `mixins-guards.less`: `signal=usable`, `trimmedMedian=18.77ms`;
- `extend-chaining.less`: `signal=usable`, `trimmedMedian=5.51ms`;
- `functions.less`: `signal=unstable`, `trimmedMedian=14.40ms`;
- `media.less`: `signal=unstable`, `trimmedMedian=7.97ms`.

Verdict: keep as a CPU-profile-supported recursive lookup-surface reduction
with supporting wall-clock evidence. This is still not completion of the Less
4.x speed goal. Next timed targets from the post-cache profile are still
copy/GC dominated: `copyChild(...)`, `Node` construction, binding-value clones,
declaration-registration copies, plus the remaining extend path.

### 2026-06-18 Performance Evidence Focus Refresh

Context: fresh isolated worktree
`/Users/matthew/git/worktrees/jess/performance-evidence` on
`feature/jess-performance-evidence` at
`c083d90ec537967773c1528a9e82020d45c78785`.

Focus: Performance Evidence selected from `FOCII.md`. This is a current
measurement/status pass, not a before/after implementation experiment and not
a speed claim.

Policy/doc update:

- benchmark-leashed mode now explicitly requires stable wall-clock hot-path
  benchmark evidence before and after every performance-targeting hot-path
  edit, and CPU/profile/counter evidence for target selection on every
  measured performance round;
- the benchmark-path build list now includes `styles-config`,
  `@jesscss/awaitable-pipe`, and `@jesscss/plugin-js`, because fresh worktrees
  otherwise fail at missing workspace `lib/` outputs before measurement.

Build/setup evidence:

- `pnpm install` was required in the fresh worktree before package builds;
- the documented focused build set plus `styles-config`,
  `@jesscss/awaitable-pipe`, and `@jesscss/plugin-js` passed;
- broad `pnpm -r --if-present build` was attempted only to materialize missing
  workspace outputs and failed later in `@jesscss/language-service` with
  existing TypeScript API errors (`getValues` export, `Call.get`, and
  `TreeContext` value usage). Those errors are outside the benchmark path.

Stable hot-path wall-clock status:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result summary:

- `functions.less`: `signal=unstable`, median `13.76ms`, trimmed RSD `11.2%`;
- `import-reference.less`: `signal=usable`, median `18.76ms`, trimmed RSD
  `8.6%`;
- `mixins-guards.less`: `signal=usable`, median `19.51ms`, trimmed RSD `6.6%`;
- `extend-chaining.less`: `signal=usable`, median `5.12ms`, trimmed RSD
  `7.7%`;
- `media.less`: `signal=unstable`, median `5.07ms`, trimmed RSD `11.3%`.

Interpretation: the usable fixtures can leash future before/after decisions;
`functions` and `media` need rerun or CPU/allocation corroboration before they
can justify a keep/revert decision. No current speed claim.

Lookup-heavy profile status:

```sh
node scripts/profile-less-benchmark.mjs --fixture=scripts/fixtures/less-hotpath/scope-lookup-stress.less --compat=false
```

Key results:

- old lookup counters stayed empty: `rulesFindByType`,
  `registryFindByType`, and `searchChildrenByType` were `{}`;
- `Reference.evalNode`: `6528` calls / `65.39ms`;
- direct lookup counters: `declaration.cacheMiss` `7560`,
  `declaration.scope.v` `7560`, `declaration.childEntriesFamilySkip` `5400`,
  `declaration.childEntryFamilySkip` `4815`, `declaration.localMatch` `2385`,
  `declaration.childEntriesScanned` `1575`,
  `declaration.childEntryEntered` `1575`,
  `declaration.scopeBindingHit` `1575`, `declaration.framePrep` `1`;
- writer counters remained substantial but secondary on this fixture:
  `OutputWriter.getSince` `18425`, `mark` `18515`, `restore` `810`;
- serialize counters: `duplicateDeclarationPrerenderedDeclarations` `360`,
  `emissionRenderNodeTextPreviewCalls` `450`,
  `emissionRenderNodeTextDeclarationFallbackCalls` `450`.

Broad fixture counter status:

```sh
node scripts/profile-less-benchmark.mjs --file=benchmark-v37.less
node scripts/profile-less-benchmark.mjs --file=benchmark-v39.less
node scripts/profile-less-benchmark.mjs --file=benchmark-color-stress.less
node scripts/profile-less-benchmark.mjs --file=benchmark.less
```

Key results:

- `benchmark-v37.less`: old lookup counters empty; direct declaration counters
  small (`declaration.cacheMiss` `20`); serialize preview/fallback calls `154`;
- `benchmark-v39.less`: old lookup counters empty; direct declaration counters
  tiny (`declaration.cacheMiss` `8`); serialize preview/fallback calls `231`;
- `benchmark-color-stress.less`: old lookup counters empty; direct declaration
  counters moderate (`declaration.cacheMiss` `300`); serialize
  preview/fallback calls `120`;
- broad `benchmark.less`: old lookup counters empty, but direct declaration
  work is large: `declaration.cacheMiss` `56446`,
  `declaration.childEntryEntered` `53217`, `declaration.scope.d` `51984`,
  `declaration.childEntriesScanned` `18731`,
  `declaration.childEntryFamilySkip` `18180`, `declaration.scope.v` `4462`,
  `declaration.childEntriesFamilySkip` `4455`,
  `declaration.childEntryStartSkip` `1420`, `declaration.localMatch` `913`,
  `declaration.scopeBindingHit` `893`, `declaration.framePrep` `34`;
- broad `benchmark.less` serialize counters are also large:
  `duplicateDeclarationComparisonContainers` `1644`,
  `duplicateDeclarationPrerenderedDeclarations` `860`,
  `emissionRenderNodeTextPreviewCalls` `4063`,
  `emissionRenderNodeTextDeclarationFallbackCalls` `4053`.

CPU/profile corroboration:

```sh
node --cpu-prof --cpu-prof-dir=profiling/core-architecture scripts/profile-less-benchmark.mjs --file=benchmark.less
```

Profile file:
`profiling/core-architecture/CPU.20260618.121531.89001.0.001.cpuprofile`.
The sampled profile is startup/parse/render mixed because
`profile-less-benchmark.mjs` performs a single render and has no repeat or
render-only mode. Treat it as noisy target-selection evidence only. Real Jess
samples that stood out included `processExtends` `10`,
`applyExtendsToSelector` `5`, `createRulesLikeReferenceSurface` `3`,
`extendSelector` `3`, and `isSameOrDescendantRoot` `3`; startup, file reads,
Chevrotain lexer/parser frames, and garbage collection also appeared.

External Less v5 alpha harness status:

```sh
node benchmark/benchmark-runner.cjs benchmark/benchmark.less --runs=30 --warmup=5 --math=parens-division
```

Run from `/Users/matthew/git/oss/less.js/packages/less` against the current
dirty alpha checkout. It completed all 30 runs: median `382.74ms`, average
`420.42ms`, stddev `121.78ms`, variance `28.97%`, throughput `248KB/s`.
Interpretation: useful proof that the external harness completes, but too
noisy to use as a Jess speed comparison by itself.

Concrete next implementation target:

1. First target broad `benchmark.less` direct declaration scan/cache shape,
   especially `findWithinScopeSurface(...)` and child declaration entry
   traversal for declaration/property reads. The strongest current counters are
   `declaration.cacheMiss` `56446`, `childEntryEntered` `53217`,
   `scope.d` `51984`, and `childEntriesScanned` `18731`, while old registry
   counters are empty.
2. Keep serialization fallback counters as the next competing target:
   broad `benchmark.less` still reports `emissionRenderNodeTextPreviewCalls`
   `4063` and declaration fallback calls `4053`.
3. Extend processing is a CPU-profile corroboration target, but the current
   profile is startup/parse/render mixed. Before editing extend code, add or
   use a repeated render-only CPU/profile harness so `processExtends` and
   selector-extension samples are cleanly separated from startup and parser
   samples.

Stop-rule result: Performance Evidence focus produced a current
profile/benchmark interpretation and concrete next implementation target for
this pass only. The performance campaign remains open until Jess beats Less 4.x
on the canonical benchmark comparison with stable/usable wall-clock evidence.
The next focus should be an implementation focus chosen from this evidence,
most likely direct declaration lookup scanning or serialization fallback
readback.

### 2026-06-18 Property-Merge Typed Lookup Pass

Focus: direct declaration lookup family narrowing from the broad
`benchmark.less` evidence above.

Harness correction discovered during the pass:

- `/Users/matthew/git/worktrees/jess/less.js/packages/less/node_modules`
  was still linked to `/Users/matthew/git/oss/jess/packages/*`, so early broad
  profiles were measuring the base checkout instead of this worktree;
- for this pass, the external Less harness links were pointed at
  `/Users/matthew/git/worktrees/jess/performance-evidence/packages/{core,jess,jess-plugin-less,jess-plugin-less-compat}`;
- before future external `benchmark.less` comparisons, verify with
  `realpath /Users/matthew/git/worktrees/jess/less.js/packages/less/node_modules/@jesscss/core`
  and `realpath /Users/matthew/git/worktrees/jess/less.js/packages/less/node_modules/jess`
  that the harness resolves to the active worktree.

Patch kept:

- property merge normalization in `Declaration._normalizeAssignmentValue(...)`
  now creates its synthetic lookup reference as `type: 'property'`; only
  `VarDeclaration` merge normalization creates `type: 'variable'`;
- this removes the avoidable `findAnyDeclarationOccurrence(...)` lane for
  ordinary property merges and routes the lookup through
  `findPropertyDeclarationOccurrence(...)`.

Fair A/B profile evidence with the external harness linked to this worktree:

- reversed/baseline broad `benchmark.less`:
  `declaration.cacheMiss` `56446`, `declaration.childEntryEntered` `53217`,
  `declaration.scope.d` `51984`, `declaration.childEntriesScanned` `18731`,
  `declaration.childEntryFamilySkip` `18180`;
- patched broad `benchmark.less`:
  `declaration.cacheMiss` `54780`, `declaration.childEntryEntered` `51551`,
  `declaration.scope.p` `50318`, `declaration.childEntriesScanned` `18527`,
  `declaration.childEntryFamilySkip` `18826`;
- lookup-stress fixture stayed in the same variable-only counter shape:
  `declaration.cacheMiss` `7560`, `declaration.scope.v` `7560`,
  `declaration.childEntriesScanned` `1575`, and
  `declaration.scopeBindingHit` `1575`.

Wall-clock status:

- patched stable run 1: all fixtures were unstable/noisy;
- reversed/baseline stable run: only `mixins-guards.less` was usable
  (`trimmedMedian` `23.03ms`); other fixtures were unstable/noisy;
- patched stable run 2: only `mixins-guards.less` was usable
  (`trimmedMedian` `23.44ms`); other fixtures were unstable/noisy.

Interpretation: keep as a semantic lookup-family narrowing with supporting
counter diagnostics, not as a speed claim. The reliable counter movement is
useful, but the wall-clock runs are too noisy to claim faster. The next
declaration-lookup
target is no longer "why are property merges using any-declaration lookup";
it is reducing the still-hot property child-entry traversal:
`declaration.scope.p` about `50318`, `childEntryEntered` about `51551`, and
`childEntriesScanned` about `18527` on broad `benchmark.less`.

### 2026-06-18 Rejected Declaration Child-Entry / Filter Cache Prototypes

Focus: follow-up on the still-hot broad `benchmark.less` property lookup
traversal after the property-merge typed lookup pass.

Rejected prototype 1: split `directDeclarationChildEntries` into a
lookup-only child-entry list that omitted child rules without declaration,
variable, reference-import, or callable surfaces.

- Focused property/variable lookup tests initially passed, but broader
  `reference.test.ts` and `import-style.test.ts -t "reference|import"` failed
  reference-import namespace/callable suppression cases and complex selector
  rendering.
- Diagnosis: `directDeclarationChildEntries` is not only a declaration lookup
  list. It also carries import/setDefined/callable bridge and placement
  suppression state. Filtering it before the direct lookup layer can make
  reference-import namespace rules emit or force broad callable fallback.
- Verdict: reverted. Do not retry by filtering the shared child-entry list.
  A future cut must either split the semantic carrier cleanly or avoid the
  child-entry path from a higher-level merge/reference specialization.

Rejected prototype 2: skip the synthetic reference filter wrapper for ordinary
property references when there is no user filter and `context.searchScope` is
empty.

- Behavior gate passed after rebuilding `@jesscss/core`, `@jesscss/css-parser`,
  `@jesscss/less-parser`, and `jess`:
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/reference.test.ts -t "property handles|merge-chain|property refs|direct property lookup|static property"`
  (`17` passed, `189` skipped).
- Broad `benchmark.less` counters were unchanged:
  `declaration.cacheMiss` `54780`, `declaration.scope.p` `50318`,
  `declaration.childEntryEntered` `51551`, and
  `declaration.childEntriesScanned` `18527`.
- Stable hot-path wall-clock did not show a usable win:
  only `mixins-guards.less` was usable (`trimmedMedian` `22.58ms`), while
  other fixtures were unstable/noisy and counters did not move.
- Verdict: reverted. The broad property-merge path has a real original filter,
  exclusion list, and assignment constraint; the synthetic wrapper is not the
  broad-benchmark problem.

Diagnostic result from temporary cache-bypass counters:

- broad `benchmark.less`: all `declaration.scope.p` work was merge-shaped:
  `cacheBypass.filter` `54780`, `cacheBypass.excludedDeclarations` `50318`,
  and `cacheBypass.requiredAssignments` `50318`;
- `scope-lookup-stress.less`: variable lookup bypassed through live-binding
  and filter requirements (`cacheBypass.liveBindings` `7560`,
  `cacheBypass.filter` `7560`).

Next implementation target: replace merge-reference reads in
`Declaration._normalizeAssignmentValue(...)` with a direct typed occurrence
read, or otherwise delete the need to fabricate a generic `Reference` for each
merge read. The current merge path creates a `Reference` with `filter`,
`excludedDeclarations`, and `requiredDeclarationAssignments`, so the generic
direct lookup cache cannot help the broad `benchmark.less` property hotspot.
A worthwhile next patch must preserve copied/output self-exclusion semantics
while avoiding the generic recursive declaration lookup for every merge item.

### 2026-06-18 Rejected Structured Merge Exclusion Handle Prototype

Focus: test whether the merge-reference hotspot can be made handle/cacheable by
turning the opaque self-exclusion filter into structured source/location
constraints and by using a string key for merge references.

Patch shape tested and reverted:

- `ReferenceOptions` gained structured `excludedDeclarationSources` and
  `excludedDeclarationLocations` constraints alongside `excludedDeclarations`;
- declaration lookup handle freshness stored the first two structured
  source/location exclusions;
- `passesDeclarationFilter(...)` rejected declarations by source identity and
  concrete source-location tuple before calling the remaining filter;
- merge normalization used `String(key.valueOf())` as the synthetic reference
  key, so source-static declaration handles could potentially engage.

Behavior proof before rejection:

- ordered package rebuild passed for `@jesscss/core`, `@jesscss/css-parser`,
  `@jesscss/less-parser`, and `jess`;
- focused property/merge/reference slice passed:
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/reference.test.ts -t "property handles|merge-chain|property refs|direct property lookup|static property|Less property merges"`
  (`17` passed, `189` skipped);
- focused live-binding/setDefined slice passed:
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/rules.test.ts -t "setDefined|ScopeFrame|direct"`
  (`24` passed, `67` skipped).

Counter result:

- broad `benchmark.less` counters were unchanged from the pre-patch baseline:
  `declaration.cacheMiss` `54780`, `declaration.childEntryEntered` `51551`,
  `declaration.scope.p` `50318`, `declaration.childEntryFamilySkip` `18826`,
  `declaration.childEntriesScanned` `18527`, `declaration.scopeBindingHit`
  `893`;
- `scope-lookup-stress.less --compat=false` counters were also unchanged:
  `declaration.cacheMiss` `7560`, `declaration.scope.v` `7560`,
  `declaration.childEntriesFamilySkip` `5400`, `declaration.localMatch`
  `2385`, `declaration.childEntriesScanned` `1575`,
  `declaration.scopeBindingHit` `1575`, `declaration.framePrep` `1`.

Verdict: reverted. Structured exclusions preserve semantics but add handle and
filter-shape plumbing without reducing actual lookup work. Do not retry this
as more declaration-handle constraint state. The next merge-performance patch
should delete the generic synthetic-`Reference` merge read or make it a direct
typed occurrence read that can share live binding/cache state without freezing
values.

### 2026-06-18 Merge Declaration Surface Pruning + Terminal Mixin Parse Classification

Focus: keep the generic merge-reference path for semantics, but stop merge
assignment lookups from entering child declaration surfaces that cannot contain
merge declarations. Also classify parsed parameterized terminal namespace calls
as terminal `mixin` lookups up front so runtime does not need to discover the
terminal-only shape from a broad `mixin-ruleset` reference.

Patch kept:

- `Rules` now carries `hasMergeDeclarationChildSurface` and each declaration
  child entry carries `hasMergeDeclarationSurface`;
- direct declaration lookup checks this carried fact only when
  `requiredDeclarationAssignments` is merge-shaped (`&,:`, `&_:` or the Less
  normalized `+,:`, `+_:` forms);
- merge-constrained property lookup still enters reference-import surfaces,
  but skips ordinary declaration child entries that cannot contain merge
  declaration candidates;
- Less parser `lookupOrCall(...)` rewrites non-empty-arg terminal
  `mixin-ruleset` references into a terminal `mixin` reference while preserving
  the namespace prefix as a `mixin-ruleset` target. Empty-paren calls stay in
  the older broad `mixin-ruleset` shape.

Counter evidence:

- broad `benchmark.less` before this patch was:
  `declaration.cacheMiss` `54780`, `declaration.scope.p` `50318`,
  `declaration.childEntryEntered` `51551`, `declaration.childEntriesScanned`
  `18527`;
- patched broad `benchmark.less` is:
  `declaration.cacheMiss` `4766`, `declaration.scope.p` `304`,
  `declaration.childEntryEntered` `1537`, `declaration.childEntriesScanned`
  `1085`, with `declaration.childEntryMergeFamilySkip` `14654`;
- `scope-lookup-stress.less --compat=false` stayed in its variable-heavy shape:
  `declaration.cacheMiss` `7560`, `declaration.scope.v` `7560`,
  `declaration.childEntriesScanned` `1575`, and
  `declaration.childEntryEntered` `1575`.

Wall-clock status:

- repo `pnpm run measure:less:hotpath -- --stable` was unstable for every
  fixture, so it is not decision-quality;
- external Less alpha `benchmark.less` runner was directionally mixed/noisy in
  adjacent runs: reversed baseline `avg` `454.12ms`, `median` `460.56ms`;
  patched rerun `avg` `431.61ms`, `median` `413.50ms`; a later patched run
  reported `avg` `541.61ms`, `median` `514.35ms`. Treat wall-clock as noisy,
  not as a speed claim.

Behavior proof:

- ordered rebuild passed for `@jesscss/core`, `@jesscss/css-parser`,
  `@jesscss/less-parser`, and `jess`;
- focused reference/property merge slice passed:
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/reference.test.ts -t "property handles|merge-chain|property refs|direct property lookup|static property|Less property merges"`
  (`17` passed, `189` skipped);
- focused live-binding/setDefined slice passed:
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/rules.test.ts -t "setDefined|ScopeFrame|direct"`
  (`24` passed, `67` skipped);
- focused runtime callable terminal-args slice passed:
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts -t "mixin-ruleset calls with args|terminal mixin-only|parameterized|namespace"`
  (`39` passed, `156` skipped);
- full Less parser `mixins.test.ts` passed (`22` passed).

Verdict: keep as a traversal cut and parser classification cleanup supported
by diagnostics, not as a wall-clock speed claim. The next target should continue this
shape: carry cheap family facts at registration/parse time and use them to
avoid recursive lookup work, while avoiding broad filtered result caches that
can freeze live values or add option-shape overhead.

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
direct mixin path over per-scope callable buckets, preserving collection
semantics. The old helper name from that prototype was later deleted as
unreleased transitional surface. It passed focused mixin/reference lookup tests, but the broad
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
direct simple-mixin lookup results per `Rules` node and lookup option shape,
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
paths also stop before the deleted mixin registry fallback and use direct
ruleset namespace helpers. Repeated same-key lookup caching is separate behind
`JESS_REGISTRYLESS_MIXIN_CACHE=1` in this historical prototype so cache behavior
could be measured apart from the registryless cut; that Map-cache experiment
has since been deleted. Focused mixin/reference lookup tests passed with
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

June 2026 binding-handle prototype: accepted as a standalone design proof, not
a production speed claim. `scripts/prototype-binding-handle-reuse.mjs` models a
repeated `.a .b .c[color-1]` reference with a handle carrying scope version,
original path array identity, target scope, declaration name, and binding cell.
It does not cache evaluated values, rendered text, mixin output, or public
materialized nodes. Default evidence: `pnpm run prototype:binding-handle-reuse`
passed semantic assertions and reduced `500,000` repeated references from
`1,500,000` path segment lookups plus `500,000` declaration lookups to `3`
path segment lookups plus `1` declaration lookup. Median time moved from
`12.149ms` to `3.521ms` (`28.99%` ratio). A smaller `50,000` reference run
kept the signal: `150,000` path lookups and `50,000` declaration lookups to
`3` and `1`, median `1.145ms` to `0.354ms` (`30.88%` ratio).

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

Status update: the runtime `JESS_DIRECT_DECLARATION_LOOKUP` switch and
`scripts/prototype-direct-declaration-lookup.mjs` comparator were deleted after
the covered direct declaration/property modes became production defaults. The
measurements below are historical evidence only; do not rerun these commands
as current gates.

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
- a cheaper one-entry cache prototype was first measured behind
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
  enabled kept the broad fixture neutral and preserved the recursive stress
  win: `JESS_REGISTRYLESS_MIXIN_LAST_CACHE=1 node scripts/compare-less-hotpath-env.mjs --env JESS_REGISTRYLESS_MIXIN_LOOKUP --fixture tests-unit/mixins-guards/mixins-guards.less --warmup 8 --pairs 60 --batch-size 5`
  reported baseline median `67.45ms`, candidate median `67.25ms`, mean ratio
  `0.08%`, wins `32/60`, `t=-0.23`; `JESS_REGISTRYLESS_MIXIN_LAST_CACHE=1 node scripts/compare-less-parse-render-env.mjs --env JESS_REGISTRYLESS_MIXIN_LOOKUP --fixture scripts/fixtures/less-hotpath/scope-lookup-stress.less --phase render --warmup 10 --pairs 100`
  reported baseline median `56.86ms`, candidate median `55.12ms`, mean ratio
  `-3.00%`, wins `85/100`, `t=-5.97`.

Follow-up default one-entry cache evidence:

- the inlined one-entry cache became the default cache mode when
  `JESS_REGISTRYLESS_MIXIN_LOOKUP=1`. The temporary
  `JESS_REGISTRYLESS_MIXIN_LAST_CACHE=0` measurement off-switch and older
  `JESS_REGISTRYLESS_MIXIN_CACHE=1` Map-cache experiment have since been
  removed;
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
  staged for deletion; the following array/namespace deletion pass supersedes
  this temporary state;
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

Follow-up array/namespace legacy branch deletion:

- array/namespace `Rules.find('mixin', string[], ...)` with more than one
  segment now always uses the registryless namespace/direct-crawl path. Runtime
  callable lookup no longer reads `JESS_LEGACY_MIXIN_LOOKUP` or
  `JESS_DIRECT_CALLABLE_LOOKUP`; the old direct-callable env toggle was also
  removed from the focused miss test. The later cache cleanup passes also
  removed `JESS_REGISTRYLESS_MIXIN_LAST_CACHE` and the older
  `JESS_REGISTRYLESS_MIXIN_CACHE` Map-cache experiment from runtime code;
- this is a permanentization/deletion pass, not a fresh standalone speed claim:
  the old legacy env comparator has intentionally been deleted from runtime
  code, so post-delete benchmarking used cache off/on regression sanity rather
  than pretending the legacy path still exists;
- focused default-path behavior, lint, and build passed:
  `pnpm exec eslint packages/core/src/tree/rules.ts packages/core/src/tree/__tests__/mixin.test.ts`,
  `pnpm --filter @jesscss/core exec vitest src/tree/__tests__/mixin.test.ts src/tree/__tests__/reference.test.ts src/tree/__tests__/rules.test.ts --run`
  (`304` tests, `8` skipped), and `pnpm --filter @jesscss/core build`;
- paired last-cache off/on sanity after deletion:
  `mixins-guards.less` with `--warmup 8 --pairs 60 --batch-size 5` reported
  baseline median `85.67ms`, candidate median `86.16ms`, mean ratio `1.38%`,
  wins `29/60`, `t=0.80` and remains neutral/slightly worse/noisy;
  `scope-lookup-stress.less` render with `--warmup 10 --pairs 100` reported
  baseline median `62.27ms`, candidate median `61.52ms`, mean ratio `-1.56%`,
  wins `71/100`, `t=-3.09`, preserving the recursive cache/stress signal.

Follow-up mixin registry shim deletion:

- the internal no-hit `MixinRegistry` class has been deleted outright; tests no
  longer monkeypatch `MixinRegistry.prototype.find` just to preserve the old
  registry probe surface;
- direct behavior coverage remains for empty/one-segment array lookup,
  namespace misses, compound-prefix precedence, terminal rulesets, imported
  reference rulesets, and parameterized namespace hops. This is compatibility
  scaffolding deletion, not a new speed claim;
- focused package-scoped default-path behavior passed:
  `pnpm --filter @jesscss/core exec vitest run src/tree/__tests__/mixin.test.ts src/tree/__tests__/reference.test.ts src/tree/__tests__/import-style.test.ts src/tree/__tests__/rules.test.ts src/tree/__tests__/call.test.ts`
  (`471` passed, `9` skipped);
- the earlier one-segment array dispatch normalization had passed:
  `pnpm exec eslint packages/core/src/tree/rules.ts packages/core/src/tree/__tests__/mixin.test.ts`,
  `pnpm --filter @jesscss/core exec vitest src/tree/__tests__/mixin.test.ts src/tree/__tests__/reference.test.ts src/tree/__tests__/rules.test.ts --run`
  (`306` tests, `8` skipped), and `pnpm --filter @jesscss/core build`;

Follow-up generic mixin find wrapper deletion:

- the stringly `Rules.find('mixin', ...)` overload and switch branch have been
  deleted; remaining internal callers/tests use the typed `Rules.findMixin(...)`
  path directly;
- this is branch/API-surface deletion only, not a new speed claim. Focused
  lookup-adjacent behavior passed:
  `pnpm --filter @jesscss/core exec vitest run src/tree/__tests__/mixin.test.ts src/tree/__tests__/reference.test.ts src/tree/__tests__/import-style.test.ts src/tree/__tests__/rules.test.ts src/tree/__tests__/call.test.ts`
  (`471` passed, `9` skipped);
- paired last-cache off/on sanity after the change stayed in the existing
  shape: `mixins-guards.less` with `--warmup 8 --pairs 60 --batch-size 5`
  reported baseline median `83.53ms`, candidate median `82.26ms`, mean ratio
  `-0.30%`, wins `31/60`, `t=-0.64`; `scope-lookup-stress.less` render with
  `--warmup 10 --pairs 100` reported baseline median `61.53ms`, candidate
  median `60.12ms`, mean ratio `-3.23%`, wins `78/100`, `t=-6.09`.

Follow-up source-backed callable surface prep skip:

- static source-backed callable surfaces now mark registration prep complete
  when they are created. They reuse canonical source children and must not run
  ordinary registration prep, because ordinary prep adopts/stores child nodes as
  owned output children and violates the source-backed placement contract;
- this pass was kept as correctness and local prep-machinery reduction, not as
  a proven broad benchmark speed win. The focused ruleset-as-mixin ownership
  test failed before the patch because source-backed output children were
  reparented to the output wrapper; it passes after the patch. A nearby test had
  stale `isNode`/`N` imports and a `VarDeclaration` assertion for an ordinary
  declaration fixture; that test proof surface was corrected;
- focused behavior passed:
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
  -t "keeps ruleset-as-mixin placement children owned while reusing reusable
  leaves"`,
  `pnpm --filter @jesscss/core test -- --run
  src/tree/util/__tests__/callable-candidate-state.test.ts
  src/tree/util/__tests__/callable-candidate-loop.test.ts
  src/tree/util/__tests__/callable-special-case.test.ts
  src/tree/__tests__/mixin.test.ts -t
  "createOwnedCallableRulesSurface|ruleset-as-mixin|source-backed|static direct
  mixin output|placement|reusing reusable leaves|unlock|callable outer|mixin
  output"`, and
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
  -t "namespace fast path|mixin-ruleset calls with args|ruleset namespace
  path|mixin namespace path|callable"`;
- ordered benchmark-path rebuild passed:
  `pnpm --filter styles-config build && pnpm --filter @jesscss/awaitable-pipe
  build && pnpm --filter @jesscss/core build && pnpm --filter
  @jesscss/css-parser build && pnpm --filter @jesscss/less-parser build &&
  pnpm --filter @jesscss/plugin-less build && pnpm --filter
  @jesscss/plugin-less-compat build && pnpm --filter @jesscss/plugin-js build
  && pnpm --filter jess build`;
- external CPU-profiled benchmark:
  `node --cpu-prof
  --cpu-prof-dir=/Users/matthew/git/worktrees/jess/performance-evidence/profiling/core-architecture/20260618-170329-source-backed-callable-prep-post-cpu
  benchmark/benchmark-runner.cjs benchmark/benchmark.less --runs=12
  --warmup=4 --math=parens-division` reported median `314.79ms`, variance
  `22.66%`, so use it for attribution only. Profile artifact:
  `profiling/core-architecture/20260618-170329-source-backed-callable-prep-post-cpu/CPU.20260618.170329.43359.0.001.cpuprofile`;
- same-profile comparison against
  `20260618-150130-exact-surface-cache-post-cpu` showed local intended
  movement: `_storePreparedRegistrationNode(...)` `5.65ms -> 1.28ms`,
  `adopt(...)` `21.75ms -> 15.44ms`, `_prepareRegistrationOnce(...)`
  `3.02ms -> 1.72ms`, and `copyChild(...)` `366.20ms -> 323.31ms`. It also
  showed broader noisy movement against the change: `Node` `334.05ms ->
  422.76ms`, `isNode(...)` `180.47ms -> 242.72ms`, and `processExtends(...)`
  `42.25ms -> 88.37ms`. Do not claim a benchmark win from this profile;
- non-profiled external `benchmark.less` runs did not give decision-quality win
  evidence: `--runs=16 --warmup=6` reported median `264.95ms` but variance
  `64.30%` with a `1080.56ms` outlier; `--runs=24 --warmup=8` reported median
  `346.02ms` and variance `45.63%`. Stable hotpath also stayed noisy or
  unstable across all listed fixtures. The change remains because it fixes the
  source-backed callable ownership contract and removes local prep work, not
  because broad wall-clock speed is proven.

Rejected follow-up audit from the same CPU profile:

- callable collector bitmask/selector-key prototype was rejected. The fresh CPU
  profile showed `isNode(...)` under `collectCallableEntriesForKeyFrom(...)`,
  so the prototype tried direct `nodeType` checks for callable child categories
  and a callable-local selector-key walker. Focused simple callable/namespace
  tests passed, but broader reference/mixin lookup tests failed on complex
  selector and ampersand descendant callable paths. Restoring the shared
  selector-key utility still left complex-path failures until the entire
  collector change was reverted. Do not retry this as local bit-twiddling;
  complex selector callable lookup needs semantic-state changes or broader
  extend/callable tests first;
- binding leaf location shortcut was rejected. The copy profile showed
  `cloneBoundValue(...)` under live binding reads, so the prototype changed the
  source-free scalar check from `value.location.length` to `_location`. Focused
  binding helper tests passed, but the mixin setDefined caller-binding test
  failed (`after-call` / `after-root` stayed `red` instead of becoming `blue`).
  Treat location materialization as semantic in this binding path until the
  live binding/write contract is redesigned;
- no production code was kept. The worktree was restored clean after both
  experiments. A broad grep test command still fails on existing branch debt:
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
  src/tree/__tests__/reference.test.ts src/tree/__tests__/rules.test.ts -t
  "callable|mixin-ruleset|namespace|reference|lookup"` reports complex
  mixin-ruleset formatting/ampersand misses even with no diff. Use narrower
  focused tests for future edits until that baseline debt is addressed.

Follow-up extend instruction-shape cut:

- `applyExtendsToSelector(...)` no longer eagerly allocates expanded
  instruction arrays when no exact selector-list target exists. It keeps the
  mutable work queue separate with one shallow copy, but the read-only
  all-extends list can stay as the original instruction array on the common
  path;
- chained extend discovery now returns the existing `ExtendInstruction`
  objects instead of projecting every instruction into tuple arrays and then
  searching `expandedAllExtends` again to recover the matching instruction.
  This deletes allocation and an avoidable valueOf/find loop in the profiled
  extend path;
- focused behavior passed:
  `pnpm --filter @jesscss/core test -- --run
  src/tree/util/__tests__/extend-unit.test.ts
  src/tree/util/__tests__/extend-utils.test.ts
  src/tree/__tests__/extend.test.ts` (`34` passed);
- baseline caveat: adding
  `src/tree/util/__tests__/process-extends.test.ts` to that focused command
  fails `7` eval-flow tests against clean `HEAD` as well. Those failures leave
  simple eval-flow extend assertions unchanged (`.foo` instead of
  `.foo,.bar`, and related partial/chained cases). Treat that file as existing
  branch debt, not as a regression signal for this pass;
- ordered benchmark-path rebuild passed:
  `pnpm --filter styles-config build && pnpm --filter @jesscss/awaitable-pipe
  build && pnpm --filter @jesscss/core build && pnpm --filter
  @jesscss/css-parser build && pnpm --filter @jesscss/less-parser build &&
  pnpm --filter @jesscss/plugin-less build && pnpm --filter
  @jesscss/plugin-less-compat build && pnpm --filter @jesscss/plugin-js build
  && pnpm --filter jess build`;
- external CPU-profiled benchmark:
  `node --cpu-prof
  --cpu-prof-dir=/Users/matthew/git/worktrees/jess/performance-evidence/profiling/core-architecture/20260618-172309-extend-instruction-shape-post-cpu
  benchmark/benchmark-runner.cjs benchmark/benchmark.less --runs=12
  --warmup=4 --math=parens-division` reported average `253.11ms`, median
  `254.41ms`, and variance `6.95%`. Profile artifact:
  `profiling/core-architecture/20260618-172309-extend-instruction-shape-post-cpu/CPU.20260618.172309.89662.0.001.cpuprofile`;
- same-profile comparison against
  `20260618-170329-source-backed-callable-prep-post-cpu` showed useful
  movement in the selected timed area: `processExtends(...)` `88.37ms ->
  63.29ms`, `collectSelectorSubtreeValues(...)` `28.38ms -> 18.33ms`,
  `findChainedExtends(...)` `2.58ms -> 1.27ms`, `wouldMatchNode(...)`
  `37.39ms -> 31.20ms`, and `isNode(...)` `242.72ms -> 166.09ms`.
  `applyExtendsToSelector(...)` itself stayed flat (`54.25ms -> 55.23ms`),
  so the win is from less surrounding extend/process work rather than a
  direct self-time drop in that function;
- non-profiled same-harness wall-clock stabilized across two runs:
  `--runs=16 --warmup=6` reported average `230.79ms`, median `227.13ms`,
  variance `5.53%`; `--runs=24 --warmup=8` reported average `230.87ms`,
  median `227.55ms`, variance `5.50%`;
- `pnpm run measure:less:hotpath -- --stable` reported usable signals for all
  listed fixtures, including `functions.less` trimmed median `11.61ms`,
  `import-reference.less` `17.95ms`, `mixins-guards.less` `17.61ms`,
  `extend-chaining.less` `4.77ms`, and `media.less` `5.07ms`.

Verdict: keep as a measured benchmark and CPU-profile win on the current
extend/process hot path. This is progress toward the canonical target, not
completion: the historical Less 4.x comparison target remains about `47.4ms`
average for `benchmark.less`, so Jess is still materially slower.

Rejected follow-up scratch-writer source tracking cut:

- the fresh profile showed `sourceSegmentFor(...)` under scratch header/value
  rendering, so the prototype changed text-only scratch writers in
  `Ruleset.renderHeaderSelectorString(...)`, `Rules.writeDetached(...)`,
  `Declaration.stringifyDetached(...)`, and
  `Declaration.renderDeclarationPartsToBuffer(...)` to `new
  OutputWriter(false)`;
- focused behavior passed:
  `pnpm --filter @jesscss/core test -- --run
  src/tree/util/__tests__/sourcemap.test.ts
  src/tree/util/__tests__/outputwriter.test.ts
  src/tree/__tests__/ruleset.test.ts
  src/tree/__tests__/declaration.test.ts -t
  "source map|OutputWriter|HeaderString|writeHeader|getComparableHeaderString|render|custom property|Declaration render"`
  (`115` passed, `67` skipped), and the ordered benchmark-path rebuild passed;
- CPU attribution moved as intended:
  `sourceSegmentFor(...)` dropped `27.48ms -> 10.08ms` in
  `profiling/core-architecture/20260618-172931-scratch-writer-no-source-post-cpu/CPU.20260618.172931.21697.0.001.cpuprofile`;
- real speed evidence did not support keeping it. The first non-profiled
  `benchmark.less --runs=24 --warmup=8` run looked slightly better (average
  `229.13ms`, median `224.72ms`, variance `6.15%`), but confirmations were
  noisy/worse: another `24/8` run reported average `259.82ms`, median
  `236.53ms`, variance `23.61%`; a `32/10` run reported average `256.78ms`,
  median `231.97ms`, variance `30.61%`;
- stable hotpath sanity also did not support it: compared with the kept extend
  pass, most trimmed medians worsened or became noisy (`functions.less`
  `11.61ms -> 12.07ms`, `import-reference.less` `17.95ms -> 18.59ms`,
  `extend-chaining.less` `4.77ms -> 4.90ms`, `media.less` `5.07ms -> 5.77ms`
  with noisy signal). The prototype was fully reverted. Do not retry this as a
  blind scratch-writer default flip; if source tracking remains hot, isolate a
  narrower text-only writer path and prove it with wall-clock first.

Rejected follow-up declaration registration and lazy extend cuts:

- refreshed the current source after reverting the scratch-writer prototype and
  rebuilt the benchmark path before measuring. The refreshed CPU-profiled
  `benchmark.less --runs=12 --warmup=4` run was noisy (average `300.33ms`,
  median `286.78ms`, variance `15.36%`) but showed the same dominant target:
  declaration registration copying. The profile artifact is
  `profiling/core-architecture/20260618-173627-current-refresh-post-revert-cpu/CPU.20260618.173627.2756.0.001.cpuprofile`;
- declaration registration source-free assignment input reuse was rejected.
  The prototype tried applying the existing render-side
  `canReuseSourceFreeAssignmentInput(...)` guard to registration assignment
  prep. Focused declaration tests caught both ownership and behavior failures:
  the reused `Sequence` was reparented to the prepared declaration, and merged
  declaration output changed from `src: one, two, three;` to
  `src: one, two, one, three;`. This confirms render-only assignment reuse
  does not transfer to registration materialization without a different
  ownership model. The prototype was fully reverted;
- lazy `collectSelectorSubtreeValues(...)` in `applyExtendsToSelector(...)` was
  also rejected. The focused extend tests passed (`34` passed), and CPU
  attribution moved strongly in the intended stack:
  `collectSelectorSubtreeValues(...)` `23.57ms -> 0.00ms`,
  `applyExtendsToSelector(...)` `60.68ms -> 31.41ms`, and
  `processExtends(...)` `79.99ms -> 68.98ms` in
  `profiling/core-architecture/20260618-173753-lazy-extend-subtree-values-post-cpu/CPU.20260618.173753.20729.0.001.cpuprofile`;
- real speed evidence did not support keeping the lazy extend patch. A stable
  first `benchmark.less --runs=24 --warmup=8` run reported average `231.84ms`,
  median `226.77ms`, variance `6.66%`, but confirmations were noisy/worse:
  another `24/8` run reported average `262.34ms`, median `237.08ms`, variance
  `21.80%`, and a `32/10` run reported average `256.84ms`, median `241.94ms`,
  variance `16.02%`. `pnpm run measure:less:hotpath -- --stable` also worsened
  or became unstable across the listed fixtures. The patch was fully reverted;
- conclusion: the remaining copy/registration hotspot is real, but safe wins
  probably need a deeper registration-state ownership change rather than
  reusing containers in the existing materialized declaration path. The extend
  subtree set is CPU-visible, but it does not currently translate into stable
  wall-clock improvement.

Follow-up no-extend guard kept; selector-bit candidate pruning rejected:

- `Rules._finishEval(...)` now calls `processExtends(...)` only when
  `context.extends.length > 0`, and `processExtends(...)` has the same early
  guard for direct callers. No-extend input no longer snapshots or walks the
  global registered ruleset set for extend work;
- rejected prototype: extend processing built selector-bit facts lazily inside
  `processExtends(...)`, with one aggregate selector bitset and key buckets per
  visible root. The aggregate bitset skipped roots whose selector surface could
  not contain the extend target, and buckets narrowed simple/compound targets
  before running full Less extend semantics;
- the first version eagerly built key buckets during ruleset registration. It
  moved `processExtends(...)` CPU sharply but regressed/noised real wall-clock
  (`benchmark.less --runs=24 --warmup=8` average `276.86ms`, median
  `252.39ms`, variance `23.33%`; `--runs=32 --warmup=10` average `321.52ms`,
  median `290.71ms`, variance `20.99%`). That proved no-extend and non-extend
  registration paths must not pay selector-index costs;
- the lazy version produced strong benchmark numbers:
  `benchmark.less --runs=24 --warmup=8` average `196.46ms`, median `193.34ms`,
  variance `4.42%`; `--runs=32 --warmup=10` average `200.20ms`, median
  `199.09ms`, variance `5.64%`; no-extend `benchmark-v39.less --runs=24
  --warmup=8` average `15.31ms`, median `15.15ms`, variance `10.80%`.
  After reverting to the guard-only production patch, no-extend
  `benchmark-v39.less --runs=24 --warmup=8` reported average `17.01ms`,
  median `15.29ms`, variance `17.60%`;
- the exact-code CPU profile for the lazy selector-bit prototype was
  `profiling/core-architecture/20260618-175814-extend-bitset-candidates-complex-safe-post-cpu/CPU.20260618.175814.27791.0.001.cpuprofile`,
  with `processExtends(...)` about `4.24ms`,
  `applyExtendsToSelector(...)` about `3.90ms`,
  `buildRulesetSelectorIndex(...)` about `6.64ms`, and
  `registerRulesetWithRoot(...)` about `1.76ms`;
- despite the timing win, the selector-bit candidate prototype was rejected.
  Complex/combinator targets can match composed parent/child selectors that are
  not represented by a ruleset's local selector bitset. The prototype failed
  focused serialized/combinator extend tests before it was reverted. A direct
  reproduction of the serialized complex target still hangs after reverting the
  prototype, so that hang is tracked as separate existing extend debt rather
  than blamed on the candidate path. The safe production state keeps only the
  no-extend guard and reverts candidate pruning;
- focused behavior passed:
  `pnpm --filter @jesscss/core test -- --run
  src/tree/util/__tests__/extend-unit.test.ts
  src/tree/util/__tests__/extend-utils.test.ts src/tree/__tests__/extend.test.ts
  src/tree/util/__tests__/find-extendable-locations.test.ts
  src/tree/util/__tests__/fast-reject.test.ts` (`75` passed) before the
  candidate prototype was reverted;
- ordered benchmark-path rebuild passed:
  `pnpm --filter styles-config build && pnpm --filter @jesscss/awaitable-pipe
  build && pnpm --filter @jesscss/core build && pnpm --filter
  @jesscss/css-parser build && pnpm --filter @jesscss/less-parser build &&
  pnpm --filter @jesscss/plugin-less build && pnpm --filter
  @jesscss/plugin-less-compat build && pnpm --filter @jesscss/plugin-js build
  && pnpm --filter jess build`.

Verdict: keep only the no-extend guard. Reject selector-bit candidate pruning
until it can model composed selector surfaces, chained extend-created keys, and
complex/combinator targets without missing serialized targets or depending on
the currently fragile complex-target behavior.
The performance campaign remains open; the historical Less 4.x comparison
target remains about `47.4ms`.

Follow-up selector/parent bit negative kept; registration-time aggregate
rejected:

- rejected prototype: moved root selector-bit aggregation from the
  `processExtends(...)` prepass into `registerRulesetWithRoot(...)`. Focused
  extend tests passed, and CPU self-time for `processExtends(...)` dropped
  (`57.25ms -> 37.93ms` against the refreshed root-bit profile), but this
  created an always-on registration/keyset tax that would also hit no-extend
  files. Same-harness wall-clock rejected it:
  `benchmark.less --runs=24 --warmup=8` reported average `222.50ms`, median
  `219.20ms`, then average `235.72ms`, median `233.03ms`. The prototype was
  reverted;
- kept cut: before classifying a visible instruction for a ruleset,
  `processExtends(...)` now checks the instruction target bits against the
  local selector and the parent selector. If neither surface shares target
  bits, the full classifier/apply path is skipped. This preserves composed
  parent/child boundary matching while avoiding the rejected local selector
  bucket/index shape;
- kept companion cut: `isDisjoint(...)` now checks backing bitset words
  directly for the normal non-inverted case instead of allocating
  `a.and(b)`. The old allocation path remains for inverted bitsets;
- focused behavior passed:
  `pnpm --filter @jesscss/core test -- --run
  src/tree/util/__tests__/bitset.test.ts
  src/tree/util/__tests__/fast-reject.test.ts
  src/tree/util/__tests__/process-extends.test.ts
  src/tree/__tests__/extend-roots.test.ts
  src/tree/__tests__/extend-eval-integration.test.ts
  src/tree/util/__tests__/extend-combinator-handling.test.ts` (`110` passed,
  `1` skipped);
- ordered benchmark-path rebuild passed before each external benchmark run;
- wall-clock evidence on external canonical Less `benchmark.less
  --runs=24 --warmup=8 --math=parens-division`: refreshed root-bit baseline
  was average `219.93ms`, median `212.96ms`; selector/parent bit skip produced
  average `212.38ms`, median `208.59ms`, then average `213.51ms`, median
  `211.39ms`; after the non-allocating `isDisjoint(...)` cut, the same harness
  reported average `209.26ms`, median `207.83ms`;
- CPU profile evidence: refreshed baseline profile
  `profiling/core-architecture/20260618-post-root-bits-refresh-cpu/CPU.20260618.181934.84133.0.001.cpuprofile`
  reported `processExtends(...)` `57.25ms`,
  `applyExtendsToSelector(...)` `43.43ms`, `wouldMatchNode(...)` `30.71ms`,
  `BitSet` `15.03ms`, and `isNode(...)` `178.13ms`. The kept combined
  profile
  `profiling/core-architecture/20260618-selector-parent-bit-skip-nonalloc-cpu/CPU.20260618.182836.46477.0.001.cpuprofile`
  reported `processExtends(...)` `31.42ms`,
  `applyExtendsToSelector(...)` `0.00ms`, `wouldMatchNode(...)` `3.32ms`,
  `BitSet` `9.09ms`, and `isNode(...)` `120.97ms`.

Verdict: keep as a measured wall-clock and CPU-profile win. The safe shape is
root aggregate pruning plus local-or-parent negative pruning; do not move
selector-bit aggregation into registration unless no-extend files can avoid
the cost.

Follow-up root aggregate snapshot fold kept:

- kept cut: `processExtends(...)` now builds each extend root's aggregate
  selector-bit bucket during the already-required pre-extend selector snapshot
  pass. This deletes the later duplicate walk over `rulesetsByRoot` without
  moving keyset work into `registerRulesetWithRoot(...)`, so no-extend files
  still avoid the rejected registration-time tax;
- selector mutation handling stays conservative: every extend assignment path
  already ORs the new selector into the root aggregate, so the root bucket can
  gain false-positive keys after mutation but must not miss later chained
  targets;
- focused behavior passed:
  `pnpm --filter @jesscss/core test -- --run
  src/tree/util/__tests__/process-extends.test.ts
  src/tree/__tests__/extend-roots.test.ts
  src/tree/__tests__/extend-eval-integration.test.ts` (`50` passed, `1`
  skipped). The broader `extend-rules.test.ts` command still has the known
  branch-baseline deep `.l -> ... -> .t` chaining failure, and the broad Less
  fixture command was stopped after it failed to return; do not count that
  fixture file as verified for this pass;
- ordered benchmark-path rebuild passed before external timing;
- wall-clock evidence on external canonical Less `benchmark.less
  --runs=24 --warmup=8 --math=parens-division`: refreshed current branch
  baseline before this patch was average `210.15ms` / median `212.73ms`, then
  average `211.61ms` / median `209.79ms`; after this patch the same harness
  reported average `201.50ms` / median `198.43ms`, average `201.70ms` /
  median `197.50ms`, then average `199.22ms` / median `197.15ms`;
- CPU profile caveat: the post-patch profiled run at
  `profiling/core-architecture/20260619-extend-root-bitset-cpu/CPU.20260618.185717.59701.0.001.cpuprofile`
  showed profiler-overhead average `214.92ms` / median `207.66ms` and sampled
  `processExtends(...)` self-time around `19.67ms`, up from the refreshed
  current profile's `12.67ms`. Treat the three stable wall-clock runs as the
  keep signal, and treat this profile as "no clear CPU attribution win" rather
  than proof that the timed win came from `processExtends(...)` self-time.

Verdict: keep as a small measured wall-clock win. The safe rule is still
"aggregate inside `processExtends`, not at registration," unless a future
version proves no-extend inputs pay no keyset tax.

Follow-up empty selector-bit check kept:

- kept cut: `rootMayContainExtendTarget(...)` and
  `selectorMayContainExtendTarget(...)` now use `isEmptyBitSet(...)` instead
  of `targetKeys.equals(library.getBitset())`. This avoids allocating/cloning
  the empty library bitset on every extend target check;
- rejected variant: replacing the comparison with the bitset package's
  `targetKeys.isEmpty()` passed focused tests, but CPU samples merely moved
  the cost into `isEmpty(...)` and `processExtends(...)` rose in the profiled
  run. That variant was superseded by the direct non-inverted word scan in
  `isEmptyBitSet(...)`;
- focused behavior passed:
  `pnpm --filter @jesscss/core test -- --run
  src/tree/util/__tests__/bitset.test.ts
  src/tree/util/__tests__/fast-reject.test.ts
  src/tree/util/__tests__/process-extends.test.ts
  src/tree/__tests__/extend-roots.test.ts
  src/tree/__tests__/extend-eval-integration.test.ts` (`95` passed, `1`
  skipped);
- ordered benchmark-path rebuild passed before external timing;
- wall-clock evidence on external canonical Less `benchmark.less
  --runs=24 --warmup=8 --math=parens-division`: current refresh before this
  patch was average `200.93ms` / median `197.97ms`; the plain `isEmpty()`
  variant was neutral (`201.23ms` / `197.63ms`, then `200.04ms` /
  `195.86ms`); the kept direct helper reported average `196.69ms` / median
  `194.20ms`, then average `198.48ms` / median `196.26ms`;
- CPU profile caveat: the kept helper profile at
  `profiling/core-architecture/20260619-extend-empty-bitset-direct-cpu/CPU.20260618.190417.5544.0.001.cpuprofile`
  reported profiler-overhead average `206.90ms` / median `204.10ms`, with
  `processExtends(...)` `25.65ms`, `selectorMayContainExtendTarget(...)`
  `6.03ms`, and `isEmptyBitSet(...)` `6.34ms`. Treat the wall-clock pair as
  the keep signal; the profile confirms the old `equals(getBitset())` clone
  path is gone, not that empty-bit testing disappeared.

Verdict: keep as a small measured wall-clock win. Do not widen this into a
generic bitset-helper rewrite without a fresh CPU-selected target.

Rejected follow-up: root extend reachability closure.

- unsafe variant: removing the eager `extendWith` key union from
  `processExtends(...)` made the root target prefilter more selective but broke
  Less media chaining (`.ma -> .mb -> .mc`) in
  `extend-eval-integration.test.ts`;
- behavior-correct variant: start from each root's selector-bit aggregate,
  activate only visible extends whose target intersects that aggregate, OR in
  each activated `extendWith`, then repeat until no more instructions can
  become reachable. Focused extend coverage passed (`110` passed, `1` skipped),
  including media-chain and combinator cases;
- wall-clock rejected it on external canonical Less `benchmark.less
  --runs=24 --warmup=8 --math=parens-division`: against the current refresh of
  average `200.72ms` / median `198.62ms`, the closure prototype reported
  average `213.88ms` / median `215.17ms`, then `202.39ms` / `200.55ms`, then
  `207.31ms` / `201.23ms`. Benchmark.less has few extend instructions and most
  are chain-relevant, so the added closure loop/array costs more than it saves;
- keep the existing production shape: root aggregate pruning plus local/parent
  negative pruning, with eager `extendWith` union for chain safety. Do not retry
  closure pruning unless a measured workload has many unrelated visible extends
  per root.

Rejected follow-up: pending declaration-name canonical reuse.

- attempted to share the static registration path's `{ reuseCanonical: true }`
  rule with `_retryPendingDeclarationNamePrep(...)` for non-assignment
  declarations. The goal was to avoid the `copyValueForDerived(...)` stack
  sampled under `_prepareRegistrationForEval(...)`;
- focused declaration/reference coverage rejected it before benchmarking:
  `declaration.test.ts` reintroduced the duplicate merge output
  `src: one, two, one, three;`, and two complex selector callable reference
  tests rendered different whitespace under nested `> .bar.baz`;
- conclusion: pending declaration-name prep has merge/ownership side effects
  that the static declaration path does not. Do not apply canonical reuse there
  without first separating merge-chain occurrence state from declaration
  materialization.

Rejected follow-up: recursive negative cache for reference-import scans.

- attempted to cache negative `rulesMayContainReferenceImports(...)` scans on
  `Rules`, clearing the local cache in `registerNode(...)` and avoiding parent
  negative caching when an unprepared child was seen;
- focused reference/import/mixin coverage rejected it. Failures included
  reference-import namespaces rendering optional imported namespace blocks,
  guarded import `with` configs falling back to direct child-surface bridges,
  missed nested mixin lookups, and setDefined mixin writes no longer updating
  caller bindings;
- conclusion: reference-import visibility is not just a recursive yes/no
  subtree fact. The next safe cut must carry explicit reference-import surface
  facts at registration/eval boundaries instead of caching negative recursive
  discovery after the fact.

Next architecture theories to test:

1. Continue selector-bit/root-surface pruning only after modeling composed
   selector surfaces. A safe version needs facts for local selector bits,
   parent-composed selector bits, chained extend-created keys, and
   complex/combinator targets before it can prune candidates. Do not reintroduce
   simple local-selector buckets as the only candidate source.
2. Promote exact child-surface capability to the `ScopeFrame` once the frame
   already receives callable coverage facts. The current `Rules` bit proved the
   diagnostic count moved; the next version should let exact simple-name lookup
   answer three questions from the frame without touching child arrays: this
   frame has exact callable buckets; this frame has no child callable surfaces
   for simple exact names; this frame has child surfaces that might contain
   simple callables. A miss can stop only in the first two cases.
3. Split child-surface facts by lookup shape. A nested `Ruleset`/`AtRule` may
   matter for exact simple names, namespace paths, declarations, or output
   leakage differently. One broad `hasDirectChildRuleSurface` forces too many
   defensive crawls. Prefer narrow booleans/counters such as
   `hasExactCallableChildSurface`, `hasNamespaceCallableChildSurface`, and
   declaration visibility facts if they can be carried at the same point
   `registerNode(...)` already sees the child.
4. Cache misses at the frame/local-surface level only when the frame has a
   stable version and coverage proof. Avoid broad result caches that allocate a
   map entry per transient option shape. A useful cache key should be simple:
   exact key plus include-rulesets/filter shape, invalidated by the existing
   registration mutation that already clears direct callable caches.
   The one-entry cache prototype supports this direction for repeated recursive
   exact lookups. The wrapper allocation has been removed and the inlined cache
   is now default inside the registryless prototype. Registryless callable
   lookup is now also the default runtime path, and the temporary
   `JESS_LEGACY_MIXIN_LOOKUP` comparator has been removed from runtime code.
   The next refinement should delete remaining registry callable plumbing only
   where a direct/frame path has explicit parity coverage.
5. Prefer negative capability over positive result caching. The broad fixture
   regressed because the candidate path repeatedly proved "nothing in this
   child surface" after the fact. A cheap carried "cannot contain simple exact
   callable hits" fact avoids both array allocation and recursive function-call
   ladders.
6. Keep parent walking outside child recursion. Child traversal should stay
   `searchParents: false`; otherwise a missing child immediately re-searches
   the parent chain and multiplies exact-bucket probes. Parent ascent belongs
   to the outer `Rules.find(...)` loop or frame chain.
7. Reuse existing direct buckets before building alternate structures. If
   `mixinsByName` exists, exact lookup should read it directly. If it does not,
   build direct buckets once and mark the frame covered. Do not build a
   parallel callable table unless it replaces `mixinsByName` and deletes work.
8. Benchmark both the stress win and ordinary Less fixtures before keeping a
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
