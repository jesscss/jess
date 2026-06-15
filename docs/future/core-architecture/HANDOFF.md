# Core Architecture Handoff

This is the active runbook for Jess core architecture work. Keep it short:
enough to make the next LLM choose the right work, and no more.

Use the doc split:

- `HANDOFF.md`: current focus, active queue, gates, and handoff discipline.
- `AGGRESSIVE-CUTTING-REVIEW.md`: patch-shape rules and rejection criteria.
- `PERFORMANCE-HANDOFF.md`: benchmark protocol and performance evidence.
- `NODE-REWRITE-TRACKER.md`: node-family rewrite status.
- `BINDING-INDEX-PROPOSAL.md`: binding/index design target.

## Focus

Active mode: **registryless lookup and binding slimming**.

This worktree is for deleting registry-style lookup plumbing and simplifying
`Rules.find*`, direct declaration lookup, callable lookup, reference handles,
and `ScopeFrame` binding paths. Do not switch to serialization, selector,
render/materialization, node-copy, or broad cutting work unless the user
explicitly redirects the branch.

Goal:

- one canonical source tree;
- direct tree/frame lookup instead of a separate lookup registry;
- live binding state and static binding buckets where they remove lookup work;
- cold materialization only for public APIs or real semantic ownership;
- fewer hot-path objects, arrays, scans, helper calls, and fallback bridges.

Do not preserve an unreleased or self-invented public-looking lookup method
for compatibility alone. If repo usage does not need it and the user has not
approved it as API, delete or reshape it.

## Working Rules

- Work from repo evidence first.
- A "full queue pass" means all active queue items below, not one micro-edit.
- Queue items must be whole tasks. Do not create one-line queue items.
- Before ending a pass, seed the next queue with real binding/lookup tasks.
- Keep completed history out of this file. Replace old done items with a short
  baseline note only when it helps the next worker.
- Use focused tests while iterating, then run gates before commit.
- Claim speed only from proper before/after measurement. One-iteration
  hotpath runs are smoke only.
- Commit and push after a completed queue pass. Use `--no-verify` for commit
  and push in this branch because hooks have previously looped.

## Current Architecture Baseline

Registryless lookup is the active runtime direction.

- Covered simple callable lookup should resolve from `ScopeFrame` or direct
  `Rules` lookup and return hit or miss without registry fallback.
- Uncovered or complex shapes may route to direct tree search, but each bridge
  needs a deletion condition.
- Direct declaration lookup is per `Rules` and per key. It skips dynamic and
  `setDefined` declaration names until promotion/registration makes them safe.
- Callable lookup coverage is key-specific. An unprepared callable key is
  `uncovered`; a prepared key with no hits is a covered miss.
- Reference lookup carries prepared target shape when the target `Rules`
  identity is known.
- Current miss sentinel: `null` inside existing direct declaration and
  callable lookup maps means the key was prepared and missed. Absent key means
  uncovered.
- Current prepared shape helper:
  - `prepareRulesLookupShape(...)`

Recent baseline commit: `054fc959` trimmed this handoff to active guidance.
Recent passes moved simple callable/declaration lookup toward `ScopeFrame` and
direct `Rules` search, removed registry fallback bridges from covered paths,
and stopped caching arrays produced by direct callable lookup.
Latest pass deletes the dead last-callable cache surface, removes the raw
`copyLiveBindingSlots(...)` helper, keeps live binding writes synchronized
through `setScopeFrameLiveBinding(...)`, and names immutable direct-declaration
miss states separately from mutable traversal state.
Current passes store declaration occurrence identity inside direct declaration
cache records, share those occurrence records with reference handles, delete
the dead `RuntimeVarBinding` model, and use callable frame facts for guarded
and recursive namespace paths before direct crawl.
Latest passes make direct Rules/index and variable reference fallback return
declaration occurrences, delete the unreachable direct `Rules` target branch,
move selector attribute and setDefined internals off node-returning lookup
helpers, move function return lookup to occurrences, and consume
parent/fallback callable covered misses before direct crawl.
Variable reference handles now have a variable-specific cached value type that
excludes bare nodes.
Reference result types are split by lookup family: declaration/property
references return declaration occurrences, variable references return live
binding handles or declaration occurrences, callable references return callable
families, and direct target/index lookup is the only remaining broad node
result lane. `Rules.find*` is now the cold node-materialization edge for direct
declarations; `direct-rules-lookup.ts` exports occurrence-returning helpers
only.
Rules lookup handles now use a generic cached-miss sentinel; the scope-frame
variable miss sentinel is only for live variable lookup. Reference lookup now
selects a lookup-family strategy once and uses that for rules lookup and handle
write validation. Callable frame uncovered results carry `frame`, `key`, or
`child-surface` reason; direct callable crawl is gated to child-surface state.
Reference lookup strategy selection is cached on the `Reference` node and
guarded by the current lookup type. Callable namespace lookups now treat
non-child-surface uncovered frame results as covered misses instead of falling
through to direct crawl.
The reference strategy cache now uses a single node slot; the strategy object
carries its own lookup type for stale-type checks.
Last full gate smoke was usable but not a speed claim:
`mixins-guards.less` `25.35ms`, `scope-lookup-stress.less` `79.93ms`.

## Active Queue

Complete every item in this queue before committing the next pass.

7hl. [x] Reference handle eligibility is computed once per resolved lookup.
Scope: `canUseRulesLookupHandle(...)`, `readRulesLookupHandle(...)`, family
writers, `lookupResolvedReference(...)`, and handle tests.
Goal: avoid repeating the same handle-eligibility checks on read and write
without adding a generic branch ladder or stale state.
Acceptance: one eligibility computation reused safely, or no-op proof; focused
handle tests, lint, builds, aggressive review.

7hm. [x] Callable namespace first-remainder coverage gets a same-mode probe.
Scope: `findCallableDescendantsWithinMixinNamespaces(...)`,
`findMixinNamespacePathFast(...)`, `terminalMixinOnly`, `includeRulesets`, and
namespace tests.
Goal: add or reject a cheap same-mode frame probe for the first remainder
segment before recursive `findMixin(...)`, so covered misses skip recursion only
when semantics exactly match.
Acceptance: branch skip/deletion or no-op proof, namespace tests, lint, builds,
aggressive review.

7hn. [x] Reference strategy cache emitted shape is checked after minification.
Scope: `packages/core/lib/index.js`, `getCachedReferenceLookupStrategy(...)`,
strategy constants, and bundle output.
Goal: verify the single-slot strategy cache stays smaller/cleaner in emitted
code than a switch at every lookup call and does not grow retained state.
Acceptance: emitted-code proof, no source churn unless it deletes emitted work;
lint, builds, aggressive review.

7ho. [ ] Direct declaration strategy objects are split from option-state
mutation.
Scope: `direct-rules-lookup.ts`, `findDeclarationOccurrenceWithStrategy(...)`,
and declaration/property tests.
Goal: keep per-family lookup behavior selected once, then run a straight
lookup loop without mutating copied option-state except for actual traversal
state.
Acceptance: less strategy/option branching in the loop or no-op proof; focused
declaration/property tests, lint, builds, aggressive review.

7hp. [x] Empty registry-bookkeeping options stay on covered direct declaration
paths.
Scope: `Reference` declaration/property lookup option builders and
`direct-rules-lookup.ts` coverage checks.
Goal: prove and enforce that empty `searchedRules`, `candidates`, and
`optionalCandidates` objects do not push covered exact lookups back to registry
fallbacks.
Acceptance: tests that spy on registry fallback for empty bookkeeping; lint,
builds, aggressive review.

7hq. [ ] ScopeFrame callable miss coverage is keyed by child-surface kind, not
generic callable coverage.
Scope: `scope-frame.ts`, `Rules.prepareCallableLookupFrame(...)`,
`hasDirectLookupChildSurface(...)`, and callable miss tests.
Goal: make mixin-only and mixin-ruleset miss decisions use exact frame facts so
ruleset-only child surfaces do not keep mixin-only bridges alive.
Acceptance: covered misses skip direct crawl for exact surface mode; focused
callable tests, lint, builds, aggressive review.

7hr. [ ] No-frame direct callable misses use carried child-surface facts before
recursive crawl.
Scope: `findMixinsFast(...)`, child-entry registration facts, and no-frame
callable tests.
Goal: make the no-frame path match frame-owned miss behavior without allocating
a frame just to learn child-surface coverage.
Acceptance: tests prove ruleset-only child surfaces do not force mixin-only
recursion; lint, builds, aggressive review.

7hs. [x] Function reference handles bypass public method materialization for
covered static function keys.
Scope: `Reference` function lookup, `Rules.findFunction(...)`, and function
handle tests.
Goal: keep covered repeated static function references on the selected
strategy/handle path and avoid re-entering public lookup bridges.
Acceptance: second static function read skips `Rules.findFunction(...)`; lint,
builds, aggressive review.

7ht. [ ] Variable reference handles keep live/current cell identity and
occurrence identity in one validation lane.
Scope: variable handle validation in `reference.ts`,
`lookupScopeFrameVariable(...)`, and static/live variable tests.
Goal: validate live binding handles and direct declaration occurrences through
one family-specific path without broad node-result checks.
Acceptance: live-cell invalidation and direct occurrence invalidation tests
pass; lint, builds, aggressive review.

7hu. [ ] Reference lookup plan state is narrowed before `prepareReferenceLookup`.
Scope: `Reference` lookup type/key normalization and strategy selection.
Goal: reduce repeated classification of static string, array-path, and
interpolated-variable modes by carrying a reusable plan on the `Reference`
node.
Acceptance: fewer repeated normalization branches for covered static keys or
no-op proof; focused reference tests, lint, builds, aggressive review.

7hv. [ ] Direct declaration child-entry traversal avoids rediscovering
non-declaration child surfaces.
Scope: carried declaration child entries, `visitChildRulesForLookup(...)`, and
declaration child-surface tests.
Goal: ensure recursive direct declaration lookup only enters child rules whose
carried visibility can contain the requested declaration family.
Acceptance: spy tests prove declaration-only lookup avoids unrelated child
surfaces; lint, builds, aggressive review.

7hw. [ ] Assignment target lookup uses binding/current-cell facts before
source declaration fallback.
Scope: `assignScopeFrameVariable(...)`, assignment eval paths, and Jess
assignment tests.
Goal: make `:=` resolve the modeled current cell first and reserve source-node
fallback for uncovered modes.
Acceptance: focused assignment tests prove no declaration-registry fallback on
covered static assignment; lint, builds, aggressive review.

7hx. [ ] Dynamic-name pending state is represented as a frame coverage fact.
Scope: dynamic declaration/mixin names, `ScopeFrame` coverage fields, and
static-key lookup miss tests.
Goal: avoid repeatedly crawling pending dynamic records that have not changed,
while still returning `UNCOVERED` for affected static keys.
Acceptance: tests cover unaffected static misses and affected dynamic pending
uncovered paths; lint, builds, aggressive review.

7hy. [ ] Callable namespace array-path handles carry original path identity.
Scope: callable reference handles for string-array keys, namespace lookup, and
array-path tests.
Goal: repeated stable namespace lookups reuse the same path identity without
joining/splitting path strings on every covered lookup.
Acceptance: repeated array-path lookup skips path rediscovery and invalidates
on rules version; lint, builds, aggressive review.

7hz. [ ] Import/reference visibility is an explicit direct lookup mode, not a
fallback side effect.
Scope: import/reference lookup options, direct declaration/callable lookup, and
import tests.
Goal: model import/reference visibility as lookup-mode input so covered direct
lookups do not enter registry/direct-crawl fallback only to rediscover
visibility.
Acceptance: focused import/reference tests and fallback spies; lint, builds,
aggressive review.

7ia. [ ] Public `Rules.find*` node-materialization remains cold for covered
reference reads.
Scope: `Rules.findVariable`, `findDeclaration`, `findProperty`, `findFunction`,
`findMixin`, and `Reference` covered paths.
Goal: keep covered reference lookup on occurrence/binding/callable result lanes
and reserve node-materializing public methods for cold callers.
Acceptance: covered reference tests spy that public `Rules.find*` methods are
not used after handle warmup; lint, builds, aggressive review.

## Backlog Sources

When the active queue is empty, pull the next binding/lookup task from:

- `BINDING-INDEX-PROPOSAL.md` for the larger binding-index migration agenda.
- `PERFORMANCE-HANDOFF.md` for measured lookup/profile follow-ups.
- `AGGRESSIVE-CUTTING-REVIEW.md` for rejected patch shapes to avoid.

Keep only the selected next tasks here. Do not copy backlog history or old
evidence into this file.

## Gates

Use focused commands first. Current usual focused set:

```sh
pnpm exec eslint packages/core/src/tree/util/direct-rules-lookup.ts packages/core/src/tree/reference.ts packages/core/src/tree/rules.ts packages/core/src/tree/scope-frame.ts
pnpm --filter @jesscss/core exec vitest src/tree/__tests__/reference.test.ts src/tree/__tests__/mixin.test.ts src/tree/__tests__/call.test.ts src/tree/__tests__/rules.test.ts src/tree/__tests__/import-style.test.ts src/tree/__tests__/control.test.ts --run --testNamePattern "leaky|function|fallback|static function binding|static callable binding|mixin-ruleset calls with args|namespace fast path|ScopeFrame callable buckets|terminal mixin-only|rulesVisibility|readonly|findAnyDeclaration|iteration vars|import|nested mixin-ruleset|recursive namespace|callable cache|handle|ruleset path|compound-prefix|namespace union|source-order|property|variable|semanticFilter|dynamic|setDefined|ambient" --reporter=dot
```

Before commit, run:

```sh
rg -n "ReferenceLookupOptions|registryless|registry-utils|register\\('function'|findFunctionDirect|ReferenceFindOptions|stale registry|registry-backed|registry can find|findDeclaration\\([^,]+, undefined|Parameters<Rules\\['findMixinsFast'\\]>|RULES_LOOKUP_ADAPTERS|\\bRulesLookupAdapter\\b|lookupFunctionReference|lookupCallableReference|currentFrameHasNoMixinChildSurface|buildDeclarationReferenceLookupOptions|buildCallableReferenceLookupOptions|lastCallableLookup|copyLiveBindingSlots" packages/core/src packages/jess-plugin-less/src packages/language-service/src packages/scss-parser/test/baseline.test.ts
git diff --check
pnpm --filter @jesscss/core build
pnpm run verify:aggressive-cutting-review
pnpm run audit:node-creation
pnpm --filter jess build
pnpm run measure:less:hotpath -- --fixture tests-unit/mixins-guards/mixins-guards.less --fixture scripts/fixtures/less-hotpath/scope-lookup-stress.less --iterations 1
```

Use `pnpm run verify:baseline -- --changed` when the touched area needs a
broader fixture gate.

## Handoff Update Rule

At the end of a pass:

1. Replace completed queue items with one concise baseline note if needed.
2. Seed only the next active binding/lookup queue.
3. Keep this file small. Pointers to backlog docs are good; copied backlog
   content is not. If old evidence matters, put it in the commit or
   `PERFORMANCE-HANDOFF.md`, not here.
4. Keep `Aggressive Cutting Self-Prosecution` to the latest pass only.

## Aggressive Cutting Self-Prosecution

- Latest pass: reference handle eligibility reuse, callable namespace
  first-remainder same-mode miss probe, empty direct-declaration candidate
  cache preservation, function-handle family narrowing, and emitted output
  audit.
- Verdict: accepted as binding/lookup cleanup, not as a speed claim.
- New traversal: one added same-mode frame probe in
  `findCallableDescendantsWithinMixinNamespaces(...)`. It only runs when the
  child namespace rules already has `_scopeFrame`, does not call
  `getScopeFrame(...)`, and only skips recursive `findMixin(...)` on a covered
  `miss`; hits and uncovered child-surface states still use the existing path.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: one private handle-access selector replaced repeated
  broad handle eligibility checks in handle read/write. No public API was
  added. Family writers still validate only their result family.
- Metadata mutations: none.
- Allocation changes: no nodes or materialized lookup-result arrays added.
  Handle reads still allocate at most one transient call argument/access shape
  before a cache-record write; this pass did not claim allocation reduction.
- Aggressive-review tokens: the only `try` in the diff is test-only prototype
  restoration around a monkey-patched method. The array-key type tokens are
  TypeScript-only annotations for existing array-path lookup and erase from
  emitted runtime; no runtime array materialization was added for lookup.
- Evidence: focused eslint passed. Focused lookup tests passed (`6` files,
  `301` passed, `290` skipped). `@jesscss/core` build passed with the existing
  `src/tree/js-expr.ts` direct-eval warning. Emitted output inspection found
  `getCachedReferenceLookupStrategy(...)` still compiles as a single
  `_lookupStrategy` read/write and handle writers compile to family-specific
  straight-line validation plus direct `_rulesLookupHandle` assignment.
  Current bundle sizes after build: `index.js` `1023540` bytes, `index.cjs`
  `1038187` bytes. Residue grep had no matches; `git diff --check`,
  aggressive review with prosecuted scoped danger tokens, node-creation audit,
  `jess` build, and one-iteration hotpath smoke all passed. Smoke was usable
  but not a speed claim: `mixins-guards.less` `25.35ms`,
  `scope-lookup-stress.less` `79.93ms`.
