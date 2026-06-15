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
Latest pass makes direct Rules/index target lookup return declaration
occurrences, removes test-only declaration-cache array spreading, and lets
recursive namespace lookup hit fallback frames before child direct crawl.
Last full gate smoke was usable but not a speed claim:
`mixins-guards.less` `29.84ms`, `scope-lookup-stress.less` `97.25ms`.

## Active Queue

Complete every item in this queue before committing the next pass.

7gk. [ ] Reference variable fallback stops returning bare declaration nodes.
Scope: `lookupVariableReference(...)`, `lookupIndexReference(...)`,
`findVariableDeclaration(...)` reference callers, raw render/eval finalization,
and `_rulesLookupHandle` validation.
Goal: variable reference fallback should use binding-cell handles or
declaration occurrence records, not reusable bare `VarDeclaration` nodes.
Acceptance: static variable refs, explicit target refs, snapshot reads, owner
mutation, lint, builds, aggressive review.

7gl. [ ] Dead direct `Rules` target branch is proven and removed or covered.
Scope: `lookupReferenceTarget(...)`, `lookupDirectTarget(...)`,
`lookupDirectRulesTarget(...)`, and resolved `Rules` targets from refs/calls.
Goal: if resolved `Rules` targets always route through
`lookupRulesReferenceTarget(...)`, delete the direct `Rules` branch; otherwise
add exact coverage and keep only the occurrence-returning lane.
Acceptance: no unreachable branch left unexamined, direct target tests for the
kept path or deletion proof, lint, builds, aggressive review.

7gm. [ ] Callable fallback-frame coverage avoids unnecessary direct fallback.
Scope: simple `findMixin(...)`, `findMixinNamespacePathFast(...)`, fallback
frame chains, covered misses, uncovered frames, and `terminalMixinOnly`.
Goal: when fallback frames have covered hit/miss facts for a callable key,
consume those facts without searching direct child surfaces or repeating
parent fallback work.
Acceptance: fallback covered hit and covered miss tests for simple and
namespace lookup, uncovered fallback still bridges only when needed, lint,
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

- Latest pass: direct Rules/index target occurrence returns, test-only
  declaration-cache array-spread removal, and recursive namespace fallback-frame
  hit coverage.
- Verdict: accepted as binding/lookup cleanup, not as a speed claim.
- New traversal: adds one fallback-frame loop inside
  `findMixinNamespacePathFast(...)` only after a recursive child frame reports a
  covered miss. It reuses existing `ScopeFrame.fallbackFrame` state and avoids
  child direct crawl for covered fallback hits/misses; uncovered fallback frames
  still bridge to direct lookup only on that fallback surface. Test-only cache
  readback uses a cold `for...of` over `directDeclarationLookupCache` values to
  prove occurrence identity without materializing an array or adding a runtime
  introspection helper.
- New node/materialization: no nodes. No AST wrappers or copied nodes.
  Test-only `rules([])` creates an empty fixture body for fallback-frame proof.
- Render path: unchanged.
- Helper/API surface: no helper or API added. Existing occurrence-returning
  direct lookup functions are reused by direct target/index lookup.
- Metadata mutations: no parent/source mutation. `sourceNode` is carried through
  variable handles as existing binding identity; declaration occurrence
  validation compares existing parent/version/index without mutating metadata.
- Allocation changes: direct target/index lookup now returns existing
  declaration occurrence records instead of bare declaration nodes. Test cache
  proof uses a single cold `for...of` instead of spreading cache values into an
  array. Test-only `fastPathHits` arrays and monkey-patch `try/finally` blocks
  prove that direct crawl is skipped and restore patched methods.
- Evidence: focused lint passed. Targeted lookup tests passed (`2` files,
  `10` passed, `285` skipped). Larger focused lookup suite passed (`6` files,
  `295` passed, `290` skipped). Residue grep produced no matches.
  `git diff --check`, `pnpm --filter @jesscss/core build`,
  `pnpm run verify:aggressive-cutting-review`,
  `pnpm run audit:node-creation`, and `pnpm --filter jess build` passed.
  Core build kept the existing `js-expr.ts` direct-eval warning. Smoke only:
  `mixins-guards.less` `29.84ms`, `scope-lookup-stress.less` `97.25ms`.
