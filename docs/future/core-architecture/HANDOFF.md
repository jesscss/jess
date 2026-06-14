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
Current pass collapses variable frame binding lookup into one helper with an
explicit live-only mode, makes cached direct declaration match state readonly at
the type boundary, and lets fully indexed callable child surfaces append
current-key hits once before skipping recursion when no relevant descendants
exist.
Last full gate smoke was usable but not a speed claim:
`mixins-guards.less` `30.68ms`, `scope-lookup-stress.less` `82.20ms`.

## Active Queue

Complete every item in this queue before committing the next pass.

7fs. [ ] Variable lookup handle carries binding identity.
Scope: `Reference._rulesLookupHandle`, `RuntimeVarBinding`, `BindingCell`,
`lookupScopeFrameVariable(...)`, ordinary static variable reads, `$!` snapshot
reads, and live mutation invalidation.
Goal: extend repeated static variable lookup reuse without caching a stale value:
the handle should carry cell/source identity or a versioned slot fact, not a
materialized runtime binding value.
Acceptance: repeated variable reference skips rediscovery, live updates do not
return stale values, snapshot reads preserve source-order behavior, assignment
and readonly tests pass, lint, builds, aggressive review.

7ft. [ ] Declaration occurrence slots for property modes.
Scope: `directDeclarationLookupCache`, `directDeclarationsByName`,
filtered property lookup, merge-chain/assignment-normalization property reads,
candidate and optional-candidate sets, and source-order starts.
Goal: replace the remaining registry-owned property/filtered modes with
binding-frame occurrence facts where semantics are understood; leave explicit
`UNCOVERED` only for modes still not modeled.
Acceptance: property merge/source-order tests, assignment-normalization tests,
candidate/optional candidate tests, readonly/property tests, lint, builds,
aggressive review.

7fu. [ ] Callable frame facts for namespace/import bridges.
Scope: `prepareCallableLookupFrame(...)`, `findMixinsFast(...)`,
`findMixinNamespacePathFast(...)`, `findRulesetNamespacePathFast(...)`,
import/reference visibility, guard/candidate matching, and callable miss
coverage flags.
Goal: move the next callable direct-crawl bridge condition into frame/handle
facts so covered namespace or import misses return hit/miss/`UNCOVERED` without
generic child crawling.
Acceptance: namespace, recursive namespace, compound-prefix, import/reference
visibility, guarded callable tests, terminal mixin-only, lint, builds,
aggressive review.

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

- Latest pass: variable binding helper consolidation, direct declaration cache
  readonly typing, and callable child-surface recursion tightening.
- Verdict: accepted as binding/lookup cleanup, not as a speed claim.
- New traversal: no new parent/source walks. `findMixinsFast(...)` now uses one
  local bucket loop from both current-surface and fully indexed child precheck
  paths; this is the same candidate iteration the old recursive path performed,
  but it can now avoid entering a child with no current-key hits and no relevant
  descendants.
- New node/materialization: no nodes. No new arrays, maps, or AST wrappers.
- Render path: unchanged.
- Helper/API surface: deleted `lookupLiveScopeFrameVariableBinding(...)`.
  `lookupScopeFrameVariableBinding(...)` now owns full and live-only reads so
  target/index/variable paths share one binding-cell result construction path.
- Metadata mutations: none.
- Allocation changes: cached direct declaration match state is readonly at the
  cache type boundary. Variable live-only reads no longer build a second helper
  result path. Callable child recursion can avoid a recursive call after using
  the existing per-key bucket and descendant-surface fact. The existing
  `results` array is still the public `findMixinsFast(...)` return surface; no
  additional result array is introduced.
- Evidence: focused lint passed. Focused lookup suite passed (`5` files,
  `102` passed, `318` skipped). Larger focused lookup suite passed (`8` files,
  `332` passed, `249` skipped). Residue grep, `git diff --check`,
  `pnpm --filter @jesscss/core build`, and `pnpm run audit:node-creation`
  passed. `pnpm run verify:aggressive-cutting-review` passed with the documented
  callable loop/result-surface danger tokens. `pnpm --filter jess build` passed.
  Smoke benchmark only: `mixins-guards.less` `30.68ms`,
  `scope-lookup-stress.less` `82.20ms`.
