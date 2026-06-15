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
`mixins-guards.less` `26.27ms`, `scope-lookup-stress.less` `82.22ms`.
Latest queue pass finished the prior handle/callable/direct-declaration queue:
new source changes added public `Rules.findVariable` cold-path proof for
covered variable handles and deleted dead handle writer call fields after
`handleAccess` became the selected shape. Existing production tests/code
covered the remaining stale items: separate callable miss surface facts,
no-frame child-surface pruning, dynamic pending promotion, array-path handle
identity, and registryless public `Rules.find*` cold paths.

## Active Queue

Complete every item in this queue before committing the next pass.

7ib. [ ] Direct declaration readonly propagation stops mutating option objects.
Scope: `direct-rules-lookup.ts`, `Rules` assignment paths, and readonly tests.
Goal: return readonly as lookup result state instead of using
`options.readonly` as an out-param.
Acceptance: assignment readonly behavior preserved, option mutation removed or
isolated behind one cold compatibility edge, lint/builds/aggressive review.

7ic. [ ] Direct declaration lookup mode is encoded once before traversal.
Scope: `DeclarationLookupStrategy`, `findWithinScopeSurface(...)`, and
declaration/property tests.
Goal: avoid repeated strategy/filter branching inside recursive scope and child
surface loops.
Acceptance: branch deletion or no-op proof with focused declaration tests.

7id. [ ] Variable assignment target lookup uses frame/current-cell identity
before source occurrence fallback.
Scope: `assignScopeFrameVariable(...)`, `Rules` set-defined eval, and
assignment tests.
Goal: make `:=` mutate modeled cells directly for covered static variables.
Acceptance: covered assignment avoids declaration occurrence lookup where cell
identity is already known; readonly tests still pass.

7ie. [ ] Dynamic pending declaration coverage is keyed by affected names.
Scope: `ScopeFrame.pendingDeclarationNames`, dynamic promotion, and static miss
tests.
Goal: unaffected static-key misses should not stay uncovered because an
unrelated dynamic declaration exists.
Acceptance: tests prove unrelated static misses stop and affected names remain
uncovered until promotion.

7if. [ ] Callable import/reference visibility becomes a frame coverage fact.
Scope: `_hasReferenceImports`, callable frame miss coverage, import tests.
Goal: represent import/reference callable visibility explicitly so covered
misses do not enter direct crawl just to rediscover reference surfaces.
Acceptance: import/reference callable tests plus direct-crawl spy.

7ig. [ ] Callable guard/candidate uncertainty has a named uncovered reason.
Scope: `ScopeFrameCallableLookupResult`, guarded mixins, and callable tests.
Goal: distinguish guard/candidate uncertainty from child-surface uncertainty
so simple covered misses can skip direct crawl safely.
Acceptance: guarded cases still route uncovered; unguarded misses skip bridge.

7ih. [ ] Callable namespace handle validation carries terminal mixin-only mode.
Scope: callable reference handles, `terminalMixinOnly`, and namespace tests.
Goal: repeated parameterized namespace calls reuse only handles whose terminal
mode matches the call shape.
Acceptance: repeated parameterized calls skip rediscovery and wrong-mode handle
reuse is rejected.

7ii. [ ] Array-path callable handles avoid repeated remainder construction.
Scope: `collectKeyRemainder(...)`, `getCallableLookupKeyRemainder(...)`,
reference handles, and namespace tests.
Goal: stable array-path handles should carry enough identity to avoid repeated
join/slice/remainder work.
Acceptance: spy/counter tests prove repeated covered lookups avoid remainder
construction after warmup.

7ij. [ ] Public `Rules.find*` materialization stays cold for every covered
reference family.
Scope: `Reference` covered paths and `Rules.findVariable/findProperty/
findDeclaration/findFunction/findMixin`.
Goal: covered reference reads return occurrence/binding/callable result lanes
without public node-materializing method calls.
Acceptance: spies cover variable, property, declaration, function, and callable
warmups.

7ik. [ ] Handle access shape is evaluated for allocation cost.
Scope: `getRulesLookupHandleAccess(...)`, read/write call sites, emitted
output, and focused handle tests.
Goal: decide whether the transient access object should stay, become scalar
locals, or move into strategy-specific straight-line read/write paths.
Acceptance: measured/emitted proof for keep/delete decision; no speed claim
without stable benchmark.

7il. [ ] Direct declaration child traversal uses carried visibility before
entering child rules.
Scope: `directDeclarationChildEntries`, `canEnterRulesEntryForLookup(...)`, and
child-surface tests.
Goal: skip child rules that cannot contain the requested declaration family
before recursive lookup.
Acceptance: focused tests prove unrelated child surfaces are not entered.

7im. [ ] ScopeFrame callable bucket preparation avoids redundant cache writes.
Scope: `prepareCallableLookupFrame(...)`, `getCallableEntriesForKey(...)`, and
callable tests.
Goal: do not rewrite frame coverage fields when the key/mode is already
prepared and coverage is known.
Acceptance: no behavior change; focused callable tests and emitted audit.

7in. [ ] Function binding version invalidation is key-scoped or proven global.
Scope: `setFunctionBinding(...)`, reference handles, and function tests.
Goal: avoid invalidating unrelated function handles on unrelated function
binding writes unless a global version is required by semantics.
Acceptance: keyed invalidation or documented no-op proof with tests.

7io. [ ] Direct lookup fallback names are purged from docs/tests.
Scope: lookup docs/tests/comments that still describe removed registry
fallbacks.
Goal: keep the active architecture language aligned with registryless runtime.
Acceptance: no stale declaration/mixin registry fallback language in active
binding lookup docs or tests.

7ip. [ ] Benchmark leash is refreshed for the next hot lookup target.
Scope: `PERFORMANCE-HANDOFF.md`, hotpath fixtures, and lookup smoke.
Goal: choose the next measured lookup target from current counters instead of
guessing.
Acceptance: current diagnostic command and target recorded without claiming
speed from smoke.

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

- Latest pass: public `Rules.findVariable` cold-path proof for variable
  handles, deletion of dead handle writer fields, and reseeding of the next
  binding/lookup queue after the prior queue was fully discharged.
- Verdict: accepted as binding/lookup cleanup, not as a speed claim.
- New traversal: none.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: no new helper or API. `WriteRulesLookupHandleArgs` was
  narrowed to `referenceNode`, `handleAccess`, and `returnVal`, deleting stale
  target/type/key/env/context fields from family writer calls.
- Metadata mutations: none.
- Allocation changes: no nodes or materialized lookup-result arrays added. The
  patch deletes writer argument fields but does not claim allocation reduction.
- Aggressive-review tokens: any `try` in the diff is test-only prototype
  restoration around monkey-patched methods.
- Evidence: focused eslint passed. Focused lookup tests passed (`6` files,
  `306` passed, `285` skipped). Residue grep had no matches; `git diff
  --check`, `@jesscss/core` build, aggressive review with the test-only
  restoration token prosecuted, node-creation audit, `jess` build, and
  one-iteration hotpath smoke all passed. Smoke was usable but not a speed
  claim: `mixins-guards.less` `26.27ms`, `scope-lookup-stress.less` `82.22ms`.
