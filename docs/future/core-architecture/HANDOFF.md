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
Last full gate smoke was usable but not a speed claim:
`mixins-guards.less` `31.98ms`, `scope-lookup-stress.less` `85.60ms`.

## Active Queue

Complete every item in this queue before committing the next pass.

7ge. [ ] Share declaration occurrence identity with reference handles.
Scope: `DirectDeclarationOccurrence`, `DeclarationOccurrenceHandle`,
`writeRulesLookupHandle(...)`, direct declaration lookup results, and
source-order/static property references.
Goal: stop rebuilding a separate reference-only occurrence record when direct
lookup has already produced a validated occurrence; pass the occurrence through
the reference path where safe.
Acceptance: property/declaration handle reuse, source-order, owner mutation,
candidate/semantic-filter, lint, builds, aggressive review.

7gf. [ ] Remove remaining variable runtime-binding fallback from handleable refs.
Scope: `RulesLookupResult`, `RuntimeVarBinding`, variable reference lookup,
raw lookup, assignment/readonly, and async definition context.
Goal: keep `RuntimeVarBinding` only for truly non-frame legacy paths; static
frame-backed refs should use binding handles end to end.
Acceptance: no `RuntimeVarBindingWithCell`, fewer runtime binding branches in
handleable paths, variable eval/render/raw tests pass, lint, builds,
aggressive review.

7gg. [ ] Callable namespace frame facts cover recursive miss propagation.
Scope: `findMixinNamespacePathFast(...)`, `findRulesetNamespacePathFast(...)`,
`lookupScopeFrameCallable(...)`, recursive namespace walks, fallback frames,
and `terminalMixinOnly`.
Goal: carry covered miss/hit facts through recursive namespace descent so child
namespace misses do not re-enter parent/direct crawl when the frame already
knows the current segment.
Acceptance: recursive namespace, guarded namespace, mixin-ruleset with args,
terminal mixin-only, fallback-frame callable tests, lint, builds, aggressive
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

- Latest pass: direct declaration occurrence cache records, collapsed
  frame-backed variable binding handles, and guarded namespace frame hits.
- Verdict: accepted as binding/lookup cleanup, not as a speed claim.
- New traversal: no new parent/source walks. Direct declaration cache reads
  validate stored occurrence owner/version/index before reuse. Variable lookup
  returns the existing binding handle directly. Callable namespace lookup asks
  a prepared frame for the first segment before calling `findMixinsFast(...)`.
- New node/materialization: no nodes. No AST wrappers or copied nodes.
- Render path: unchanged.
- Helper/API surface: adds `DirectDeclarationOccurrence` as the direct cache's
  typed internal value and `isDirectDeclarationOccurrenceCurrent(...)` for cache
  validation. `createScopeFrameVariableBindingHandle(...)` replaces the deleted
  `RuntimeVarBindingWithCell` wrapper path.
- Metadata mutations: no parent/source mutation. `sourceNode` is carried through
  variable and declaration handles as existing binding identity; no source or
  parent fields are mutated.
- Allocation changes: direct declaration cache entries now hold occurrence
  records instead of naked node refs. Frame-backed variable lookup no longer
  allocates a temporary runtime binding object before handle writing. Test-only
  `fastPathHits` arrays and monkey-patch `try/finally` blocks prove direct
  bridge use or skip. Guarded namespace starts can skip the direct
  `findMixinsFast(...)` crawl when the frame has a covered hit.
- Evidence: focused lint passed. Focused lookup suite passed (`4` files,
  `127` passed, `241` skipped). Larger focused lookup suite passed (`9` files,
  `368` passed, `230` skipped). `pnpm --filter @jesscss/core build` passed
  with the existing `js-expr.ts` direct-eval warning. Residue grep found no
  matches; `git diff --check`, `pnpm run verify:aggressive-cutting-review`,
  `pnpm run audit:node-creation`, and `pnpm --filter jess build` passed.
  Smoke only: `mixins-guards.less` `31.98ms`,
  `scope-lookup-stress.less` `85.60ms`.
