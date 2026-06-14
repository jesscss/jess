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
Current pass carries owner frames on variable binding hits so handles validate
parent/fallback cell replacement, stores property/declaration handles as
validated occurrence records, and lets ruleset namespace lookup use frame facts
for the first-segment mixin ambiguity check.
Current pass lets reusable variable handles finalize and raw-render directly
from binding cells, makes declaration occurrence handles validate owner lookup
version for child/source-order mutation, and proves reference imports keep
callable frame miss coverage uncovered.
Current pass stores declaration occurrence identity inside direct declaration
cache records, removes the temporary runtime-binding wrapper from frame-backed
variable lookup results, and lets callable frames answer guarded namespace
mixin starts before direct crawl.
Current pass shares direct declaration occurrence records with reference
handles, deletes the dead `RuntimeVarBinding` model, and proves recursive
namespace child-frame misses stop before direct crawl.
Last full gate smoke was usable but not a speed claim:
`mixins-guards.less` `24.70ms`, `scope-lookup-stress.less` `103.00ms`.

## Active Queue

Complete every item in this queue before committing the next pass.

7gh. [ ] Direct target `Rules` lookup uses occurrence/value records.
Scope: `lookupDirectRulesTarget(...)`, quoted property index references,
variable declaration fallback, raw reference lookup, and direct `Rules` targets.
Goal: stop direct target lookup from returning bare declaration nodes where the
same occurrence or binding-handle model can represent the hit.
Acceptance: raw target lookup, quoted property index, variable/property target
refs, owner mutation, lint, builds, aggressive review.

7gi. [ ] Declaration occurrence cache avoids test-only array scans.
Scope: `directDeclarationLookupCache`, occurrence readback tests,
source-order/owner mutation proof, and cache observability helpers.
Goal: keep occurrence-cache proof without spreading cache values into arrays,
and avoid adding cold introspection helpers unless a real test path needs them.
Acceptance: tests prove occurrence identity and invalidation without hot-path
array scans, lint, builds, aggressive review.

7gj. [ ] Callable namespace frame facts cover fallback-frame recursive hits.
Scope: `findMixinNamespacePathFast(...)`, fallback frames, recursive namespace
walks, `lookupScopeFrameCallable(...)`, and `terminalMixinOnly`.
Goal: ensure recursive namespace descent uses fallback frame facts for covered
hit/miss decisions before direct crawl.
Acceptance: fallback-frame callable namespace tests, recursive namespace,
terminal mixin-only, guarded namespace, lint, builds, aggressive review.

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

- Latest pass: direct declaration occurrences shared with reference handles,
  dead runtime binding shape deletion, and recursive namespace child-frame miss
  proof.
- Verdict: accepted as binding/lookup cleanup, not as a speed claim.
- New traversal: no new parent/source walks. Direct occurrence records are
  returned through property/declaration reference lookup and validated in the
  existing handle read path. Recursive namespace test warms the child frame and
  proves its covered miss stops before `findMixinsFast(...)`.
- New node/materialization: no nodes. No AST wrappers or copied nodes.
- Render path: unchanged.
- Helper/API surface: adds occurrence-returning direct lookup variants for the
  reference path and deletes `RuntimeVarBinding`, its guard, and its finalizer
  branches. Node-returning `Rules.find*` methods stay as thin wrappers over
  direct lookup for callers that need nodes.
- Metadata mutations: no parent/source mutation. `sourceNode` is carried through
  variable handles as existing binding identity; declaration occurrence
  validation compares existing parent/version/index without mutating metadata.
- Allocation changes: reference handles now store the direct occurrence record
  instead of rebuilding `DeclarationOccurrenceHandle`. Deleting
  `RuntimeVarBinding` removes dead branch objects and branch checks.
  `RulesLookupResult` is a type-only union over existing node and callable
  array results; it does not allocate. Test-only `fastPathHits` arrays and
  monkey-patch `try/finally` blocks prove direct bridge use or skip.
- Evidence: focused lint passed. Focused lookup suite passed (`4` files,
  `128` passed, `241` skipped). Larger focused lookup suite passed (`9` files,
  `369` passed, `230` skipped). `pnpm --filter @jesscss/core build` passed
  with the existing `js-expr.ts` direct-eval warning. Residue grep found no
  runtime binding or old declaration-handle shapes outside tests that assert
  removed method names; broader residue grep, `git diff --check`,
  `pnpm run verify:aggressive-cutting-review`,
  `pnpm run audit:node-creation`, and `pnpm --filter jess build` passed.
  Smoke only: `mixins-guards.less` `24.70ms`,
  `scope-lookup-stress.less` `103.00ms`.
