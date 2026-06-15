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
Last full gate smoke was usable but not a speed claim:
`mixins-guards.less` `26.51ms`, `scope-lookup-stress.less` `104.69ms`.

## Active Queue

Complete every item in this queue before committing the next pass.

7gz. [ ] Rules lookup handle miss state stops using the variable miss symbol.
Scope: `reference.ts` handle read/write, variable lookup misses, declaration
misses, function/callable misses, and tests that exercise repeated missed
references.
Goal: separate the generic cached lookup miss sentinel from the scope-frame
variable binding miss sentinel, so the handle model stops implying every cached
miss is a variable binding result.
Acceptance: no extra runtime objects, no behavior change, targeted miss/cache
tests, lint, builds, aggressive review.

7ha. [ ] Reference lookup dispatch becomes strategy-assigned by lookup family.
Scope: `performRulesReferenceLookup(...)`, `writeRulesLookupHandle(...)`,
handle value validation, and the family-specific lookup helpers in
`reference.ts`.
Goal: reduce string-branching by assigning the lookup/write strategy for the
current reference family once, without adding a generic helper ladder or
weakening the family-specific return types.
Acceptance: less repeated branch work or documented no-op, focused reference
tests, lint, builds, aggressive review.

7hb. [ ] Callable uncovered branches carry enough surface facts to delete one
direct crawl.
Scope: `prepareCallableLookupFrame(...)`, `lookupScopeFrameCallable(...)`,
`findMixin(...)`, `findMixinNamespacePathFast(...)`, fallback frames,
reference-import surfaces, and `terminalMixinOnly`.
Goal: make a concrete uncovered state distinguish reference-import/child-surface
needs from already-covered misses, then delete one fallback direct crawl branch
only when the frame fact proves it cannot contain callable hits.
Acceptance: one real branch deletion with tests, or a tight no-op proof that
the needed fact cannot be carried yet without more overhead; lint, builds,
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

- Latest pass: reference result-family split, deletion of node-returning direct
  declaration helper exports, and callable fallback branch boundary audit.
- Verdict: accepted as binding/lookup cleanup, not as a speed claim.
- New traversal: no new runtime traversal. Caller audit via `rg` found runtime
  node-returning direct declaration helper calls only inside `Rules.find*`
  wrappers, so those helpers were deleted and `Rules.find*` now unwraps
  occurrence records directly. Callable fallback branches were not hidden behind
  a helper: after a real `Rules` fallback frame is prepared, remaining
  `uncovered` means reference-import or child-surface state still needs direct
  crawl semantics.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: deletes exported node-returning direct declaration helper
  functions from `direct-rules-lookup.ts`. Adds type-only reference result
  families and discriminated handle value families; no runtime helper added.
- Metadata mutations: no parent/source mutation. `sourceNode` is carried through
  variable handles as existing binding identity; declaration occurrence
  validation compares existing parent/version/index without mutating metadata.
- Allocation changes: no new traversal allocations or node allocations. The
  aggressive review array/object tokens are type-only `MixinEntry[]` aliases
  plus repeated `_rulesLookupHandle = { ... }` assignment sites. Handle writes
  still allocate one cache record as before; the family-specific writer repeats
  fields instead of building a spread base object or helper object.
- Evidence: focused eslint passed for `reference.ts`, `rules.ts`, and
  `direct-rules-lookup.ts`. Focused type/build passed with the existing
  `js-expr.ts` direct-eval warning. Targeted lookup tests passed (`4` files,
  `68` passed, `302` skipped). Broader lookup test slice passed (`8` files,
  `313` passed, `290` skipped). Residue grep had no matches; `git diff --check`,
  `@jesscss/core` build, aggressive review, node-creation audit, `jess` build,
  and one-iteration hotpath smoke all passed. Smoke was usable but not a speed
  claim: `mixins-guards.less` `26.51ms`, `scope-lookup-stress.less` `104.69ms`.
