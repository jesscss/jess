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
Last full gate smoke was usable but not a speed claim:
`mixins-guards.less` `24.89ms`, `scope-lookup-stress.less` `77.56ms`.

## Active Queue

Complete every item in this queue before committing the next pass.

7hc. [ ] Reference lookup strategy can shrink repeated handle object writes.
Scope: `reference.ts` strategy writers, `_rulesLookupHandle` assignment sites,
family-specific validation, and cached miss tests.
Goal: keep family-specific validation while deleting repeated assignment
boilerplate only if it does not add another per-lookup object or generic branch
ladder.
Acceptance: one smaller writer path or a documented no-op, focused handle tests,
lint, builds, aggressive review.

7hd. [ ] Callable uncovered reasons remove another direct crawl path.
Scope: `lookupScopeFrameCallable(...)`, `prepareCallableLookupFrame(...)`,
`findMixin(...)`, `findMixinNamespacePathFast(...)`, namespace/fallback tests,
and reference-import surfaces.
Goal: use the new uncovered reason to skip or delete one more direct crawl when
the frame proves the key was covered and cannot contain callable hits.
Acceptance: branch deletion or tight no-op proof, namespace/fallback tests,
lint, builds, aggressive review.

7he. [ ] Lookup strategy selection moves earlier only if it deletes work.
Scope: `Reference.eval/resolution` setup, `prepareReferenceLookup(...)`,
`lookupResolvedReference(...)`, and direct target/index handling.
Goal: see whether the lookup strategy can be derived at reference construction
or first eval and reused without stale state, avoiding repeated
`getReferenceLookupStrategy(...)` calls.
Acceptance: reused strategy without stale lookup type, or no-op proof that
options can mutate too late; focused reference tests, lint, builds, aggressive
review.

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

- Latest pass: generic cached lookup miss sentinel, lookup-family strategy
  dispatch, and callable uncovered reason gating.
- Verdict: accepted as binding/lookup cleanup, not as a speed claim.
- New traversal: no new runtime traversal. Reference rules lookup now calls the
  selected family strategy instead of switching inside each rules lookup.
  Callable direct crawls are only attempted when `lookupScopeFrameCallable(...)`
  reports `reason: 'child-surface'`; `frame` and `key` uncovered reasons must be
  prepared/rechecked or treated as no direct-crawl state.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: adds module-local strategy functions/objects in
  `reference.ts` and a reason field on callable uncovered results. This is not
  public API; it replaces per-rules-lookup and per-handle-write branching with
  one strategy selection per resolved reference.
- Metadata mutations: none.
- Allocation changes: no new per-lookup arrays or nodes. Strategy objects are
  module constants. The callable uncovered result remains the existing small
  result object with one string reason. Handle writes still allocate one cache
  record as before. Aggressive review object/array tokens are the module-level
  strategy constants, type-only callable array aliases, type-only argument
  shapes, and existing handle object assignment sites.
- Evidence: focused eslint passed for `reference.ts`, `rules.ts`, and
  `scope-frame.ts`. `@jesscss/core` build passed with the existing `js-expr.ts`
  direct-eval warning. Targeted lookup/callable tests passed (`4` files,
  `152` passed, `294` skipped). Broader lookup test slice passed (`8` files,
  `313` passed, `290` skipped). Residue grep had no matches; `git diff --check`,
  aggressive review, node-creation audit, `@jesscss/core` build, `jess` build,
  and one-iteration hotpath smoke all passed. Smoke was usable but not a speed
  claim: `mixins-guards.less` `24.89ms`, `scope-lookup-stress.less` `77.56ms`.
