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
Current pass lets static variable lookup handles store binding-cell identity
instead of a materialized runtime value, copies direct declaration cache records
at the cache boundary, and lets frame-covered mixin namespace misses stop before
`findMixinsFast(...)`.
Last full gate smoke was usable but not a speed claim:
`mixins-guards.less` `23.53ms`, `scope-lookup-stress.less` `74.88ms`.

## Active Queue

Complete every item in this queue before committing the next pass.

7fv. [ ] Variable handle invalidation covers parent/fallback cells.
Scope: `Reference._rulesLookupHandle`, `ScopeFrame.parent`,
`ScopeFrame.fallbackFrame`, current binding replacement, `:=` assignment, loop
state mutation, mixin params, and import configured variables.
Goal: extend the binding-cell handle guard beyond the target frame's own
current binding map so parent/fallback/live-slot replacement cannot reuse a
stale cell while same-cell value mutation remains cheap.
Acceptance: repeated variable reference skips rediscovery for stable cells,
parent/fallback/current-cell replacement invalidates, mixin params and loop vars
stay live, assignment/readonly tests pass, lint, builds, aggressive review.

7fw. [ ] Property/declaration handle stores occurrence identity.
Scope: `Reference._rulesLookupHandle`, static property/declaration references,
`directDeclarationLookupCache`, `directDeclarationsByName`, source-order starts,
semantic filters, and candidate/optional-candidate sets.
Goal: stop storing only materialized declaration nodes for covered property and
declaration handles; carry occurrence/cache identity where safe and leave
explicit uncovered modes for filtered/merge cases that still need broader facts.
Acceptance: repeated property/declaration refs skip rediscovery, source-order
and semantic-filter tests pass, candidate/optional candidate behavior remains
correct, lint, builds, aggressive review.

7fx. [ ] Callable namespace frame facts for ruleset/import cases.
Scope: `findRulesetNamespacePathFast(...)`, `findMixinNamespacePathFast(...)`,
`prepareCallableLookupFrame(...)`, reference imports, guard/candidate matching,
and callable miss coverage flags.
Goal: move the next ruleset/import namespace bridge condition into frame/handle
facts so covered namespace misses can stop without generic direct crawl while
unmodeled guard/import cases stay explicit.
Acceptance: ruleset namespace, recursive namespace, compound-prefix,
import/reference visibility, guarded callable tests, terminal mixin-only, lint,
builds, aggressive review.

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

- Latest pass: variable handle cell identity, direct declaration cache ownership,
  and callable namespace frame miss coverage.
- Verdict: accepted as binding/lookup cleanup, not as a speed claim.
- New traversal: no new parent/source walks. Variable handle reads add one
  current-cell identity check on the target frame when the key is static. Mixin
  namespace lookup asks an existing frame for the first segment and can stop on
  a covered miss before the direct crawl. Test-only `fastPathHits` records the
  old bridge being skipped.
- New node/materialization: no nodes. No AST wrappers or copied nodes.
- Render path: unchanged.
- Helper/API surface: adds internal `ScopeFrameVariableBindingHandle` shape and
  shared `runtimeBindingFromCell(...)`; these replace materialized variable
  handle values with cell/source identity for static variable handles.
- Metadata mutations: no parent/source mutation. `sourceNode` is carried through
  the variable handle as existing binding identity, then used to rebuild the
  same runtime binding result shape from the current cell value.
- Allocation changes: variable handle reads rebuild a lightweight runtime
  binding from an existing cell instead of returning a cached runtime binding
  value. Static variable handle writes allocate a small cell/source handle
  record only for reusable static variable refs. Direct declaration cache writes
  allocate an owned three-field cache record instead of storing mutable
  traversal state. Callable namespace frame misses avoid `findMixinsFast(...)`
  for covered mixin-only namespace misses. The `try` token is test-only cleanup
  around monkey-patched methods.
- Evidence: focused lint passed. Focused lookup suite passed (`3` files,
  `90` passed, `263` skipped). Larger focused lookup suite passed (`8` files,
  `345` passed, `238` skipped). Residue grep, `git diff --check`,
  `pnpm --filter @jesscss/core build`, and `pnpm run audit:node-creation`
  passed. `pnpm run verify:aggressive-cutting-review` passed with documented
  handle/cache/test danger tokens. `pnpm --filter jess build` passed. Smoke
  benchmark only: `mixins-guards.less` `23.53ms`,
  `scope-lookup-stress.less` `74.88ms`.
