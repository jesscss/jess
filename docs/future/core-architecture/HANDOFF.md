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
- Current shared empty miss buckets:
  - `EMPTY_DIRECT_DECLARATION_BUCKET`
  - `EMPTY_CALLABLE_LOOKUP_BUCKET`
- Current narrow helper to audit:
  - `prepareRulesLookupTarget(...)`

Recent baseline commit: `31396ec4` shared lookup miss sentinels and pushed
`feature/jess-scope-lookup-experiment`. Last smoke was usable but not a speed
claim: `mixins-guards.less` `27.09ms`, `scope-lookup-stress.less` `73.58ms`.

## Active Queue

Complete every item in this queue before committing the next pass.

7ec. [ ] Reference prepared-shape helper audit.
Scope: `prepareRulesLookupTarget(...)`, `performRulesReferenceLookup(...)`,
and `readRulesLookupHandle(...)`.
Goal: prove the helper is a net deletion of repeated shape work, or inline a
cheaper path if the helper adds avoidable hot-path calls.
Acceptance: reference callable/function handle, leaky fallback,
ambient-output, import/reference tests, lint, builds, aggressive review.

7ed. [ ] Direct declaration empty-bucket sentinel audit.
Scope: `EMPTY_DIRECT_DECLARATION_BUCKET`, `directDeclarationsByName`,
`getDirectDeclarationBucket(...)`, and dynamic-name promotion.
Goal: prove the shared empty declaration bucket cannot be mutated or mistaken
for a hit bucket; replace it with a cheaper sentinel only if that reduces work
without adding a new map or side registry.
Acceptance: property/variable source-order, same-key miss, child-surface,
dynamic-name, `setDefined(...)`, readonly tests, lint, builds, aggressive
review.

7ee. [ ] Callable empty-bucket sentinel audit.
Scope: `EMPTY_CALLABLE_LOOKUP_BUCKET`, `callableLookupCache`,
`lookupScopeFrameCallable(...)`, and last-callable lookup results.
Goal: prove the shared empty callable bucket cannot leak as a mutable hit
bucket; replace it with a cheaper sentinel only if the result path stays
branch-light and key-covered.
Acceptance: callable bucket, static miss, fallback-frame, terminal mixin-only,
namespace, import/reference tests, lint, builds, aggressive review.

## Gates

Use focused commands first. Current usual focused set:

```sh
pnpm exec eslint packages/core/src/tree/util/direct-rules-lookup.ts packages/core/src/tree/reference.ts packages/core/src/tree/rules.ts packages/core/src/tree/scope-frame.ts
pnpm --filter @jesscss/core exec vitest src/tree/__tests__/reference.test.ts src/tree/__tests__/mixin.test.ts src/tree/__tests__/call.test.ts src/tree/__tests__/rules.test.ts src/tree/__tests__/import-style.test.ts src/tree/__tests__/control.test.ts --run --testNamePattern "leaky|function|fallback|static function binding|static callable binding|mixin-ruleset calls with args|namespace fast path|ScopeFrame callable buckets|terminal mixin-only|rulesVisibility|readonly|findAnyDeclaration|iteration vars|import|nested mixin-ruleset|recursive namespace|callable cache|handle|ruleset path|compound-prefix|namespace union|source-order|property|variable|semanticFilter|dynamic|setDefined|ambient" --reporter=dot
```

Before commit, run:

```sh
rg -n "ReferenceLookupOptions|registryless|registry-utils|register\\('function'|findFunctionDirect|ReferenceFindOptions|stale registry|registry-backed|registry can find|findDeclaration\\([^,]+, undefined|Parameters<Rules\\['findMixinsFast'\\]>|RULES_LOOKUP_ADAPTERS|\\bRulesLookupAdapter\\b|lookupFunctionReference|lookupCallableReference|currentFrameHasNoMixinChildSurface|buildDeclarationReferenceLookupOptions|buildCallableReferenceLookupOptions" packages/core/src packages/jess-plugin-less/src packages/language-service/src packages/scss-parser/test/baseline.test.ts
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
3. Keep this file small. If old evidence matters, put it in the commit or
   `PERFORMANCE-HANDOFF.md`, not here.
4. Keep `Aggressive Cutting Self-Prosecution` to the latest pass only.

## Aggressive Cutting Self-Prosecution

Latest pass: handoff size discipline correction.

- Verdict: accepted as documentation discipline cleanup; it deletes stale
  history and keeps this file as an operational guide.
- New traversal: none.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: none.
- Metadata mutations: none.
- Evidence: this edit deletes stale completed-task history and keeps only the
  active lookup focus, current baseline, active queue, gates, and update rule.
