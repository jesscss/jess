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
  `Rules` lookup and return hit or miss without old lookup bridges.
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
direct `Rules` search, removed old lookup bridges from covered paths, and
stopped caching arrays produced by direct callable lookup.
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
`mixins-guards.less` `30.37ms`, `scope-lookup-stress.less` `84.79ms`.
Latest queue pass finished the prior handle/callable/direct-declaration queue:
new source changes added public `Rules.findVariable` cold-path proof for
covered variable handles and deleted dead handle writer call fields after
`handleAccess` became the selected shape. Existing production tests/code
covered the remaining stale items: separate callable miss surface facts,
no-frame child-surface pruning, dynamic pending promotion, array-path handle
identity, and registryless public `Rules.find*` cold paths.
Current queue pass moved readonly assignment lookup off option mutation,
deleted redundant callable frame-coverage writes, and purged stale registry
fallback wording from the active handoff. Items that require broader semantic
modeling were carried forward as new concrete tasks below.
Latest queue pass names callable reference-import uncertainty as a
`ScopeFrame` fact, keeps that path conservative instead of treating it as a
covered child-surface miss, proves direct property lookup skips child rules
whose visibility cannot contain properties, refreshes the active lookup
benchmark leash, and records the property merge-chain occurrence-slot target.
Dynamic pending declaration affected-key precision, keyed function invalidation,
assignment current-cell-first writes, and handle allocation splitting remain
larger semantic/measured cuts, not micro-edits.
Latest queue pass adds handle-shape proof for stale lookup-type rejection and
terminal mixin-only rejection, prebuilds the direct property child-visibility
spy so it tests traversal instead of setup, and records that the
`benchmark-v39.less` profile no longer exercises the lookup counters needed
for direct declaration strategy splitting. A attempted variable-family child
visibility spy exposed a source-prep boundary instead: variable lookup can
index child rules while preparing scope-frame state before the child-entry
visibility skip can be observed.

## Active Queue

Complete every item in this queue before committing the next pass.

7ju. [ ] Dynamic pending declarations get a real affected-key model.
Scope: `pendingDeclarationNames`, dynamic-name promotion, and static miss
tests. Goal: do not broad-uncover misses unless an unresolved dynamic name can
actually affect the requested key. Acceptance: semantic model plus tests for
unknown dynamic, promoted static, and unaffected static miss.

7jv. [ ] Callable guard/candidate uncertainty is named separately from child
and reference-import uncertainty. Scope: guarded mixins/rulesets and
`ScopeFrameCallableLookupResult`. Goal: only guarded candidate uncertainty
routes to the bridge. Acceptance: guarded cases return a named uncovered
reason; unguarded covered misses stop.

7jw. [ ] Array-path callable handles stop rebuilding remainders after warmup.
Scope: `collectKeyRemainder(...)`, `getCallableLookupKeyRemainder(...)`, and
array namespace references. Goal: stable path identity carries/reuses the
needed remainder. Acceptance: counter proof or a documented emitted no-op.

7jx. [ ] Handle access object allocation gets a measured keep/delete decision.
Scope: `getRulesLookupHandleAccess(...)`, strategy write/read call sites, and
emitted output. Goal: decide scalar locals versus transient object with
evidence. Acceptance: emitted audit plus benchmark/profile note, no speed
claim without stable signal.

7jy. [ ] Direct declaration strategy branching gets measured before splitting.
Scope: `DeclarationLookupStrategy`, `findWithinScopeSurface(...)`, and lookup
profile counters. Goal: identify which strategy fields are hot enough to
specialize. Acceptance: profile/counter evidence recorded in
`PERFORMANCE-HANDOFF.md`.

7jz. [ ] Function binding invalidation is key-scoped or explicitly proven
global. Scope: `setFunctionBinding(...)`, lookup handles, and function tests.
Goal: unrelated declarations should not invalidate function handles unless
global invalidation is semantically required. Acceptance: keyed invalidation or
no-op proof with tests.

7ka. [ ] Assignment target lookup tries modeled current cells before occurrence
fallback. Scope: `assignScopeFrameVariable(...)`, set-defined eval, readonly
rules. Goal: covered `:=` writes mutate modeled cells without source lookup
when readonly semantics are represented. Acceptance: occurrence spy proves the
covered current-cell path skips direct declaration lookup.

7kb. [ ] Import/reference declaration visibility becomes an explicit direct
lookup mode. Scope: declaration lookup options, import/reference fixtures, and
direct child entries. Goal: direct lookup should carry visibility facts instead
of rediscovering them through fallback side effects. Acceptance: focused
import/reference declaration tests plus fallback spy.

7kc. [ ] Property merge-chain occurrence slots are implemented from the design
note. Scope: property declaration occurrences, merge metadata, assignment
normalization. Goal: delete the remaining filtered property registry fallback
without adding a second name map. Acceptance: merge-chain fixtures use direct
occurrence lookup.

7kd. [ ] Reference-import callable uncertainty gets direct-crawl boundary
proof for namespace lookups. Scope: reference imports, namespace callable
lookup, and fallback frames. Goal: reference-import uncertainty remains
conservative but does not poison covered frame/key misses. Acceptance:
namespace/fallback spy tests.

7ke. [ ] Variable-family child visibility skips child prep/indexing.
Scope: `findWithinScopeSurface(...)`, scope-frame preparation, and
`directDeclarationChildEntries`. Goal: variable lookup should not index or
enter a child rules surface whose carried visibility cannot contain variables.
Acceptance: the attempted variable-family getter spy passes without touching
the child `value`.

7kf. [ ] Function handles stop invalidating on unrelated declaration pushes or
the global invalidation reason is documented with proof. Scope:
`lookupVersion`, `setFunctionBinding(...)`, `Rules.push(...)`, and function
reference handles. Goal: avoid key-independent invalidation when possible.
Acceptance: changed keyed invalidation or explicit failing-proof note.

7kg. [ ] Assignment/current-cell lookup records readonly provenance on modeled
cells. Scope: `BindingCell.readonly`, set-defined writes, and readonly tests.
Goal: current-cell-first assignment can be implemented without losing readonly
errors. Acceptance: focused readonly cell tests.

7kh. [ ] Import/reference declaration visibility gets a direct-mode test matrix.
Scope: reference imports, compose/import boundaries, declarations vs variables.
Goal: choose the explicit direct lookup mode before source changes.
Acceptance: matrix tests or documented unsupported cells.

7ki. [ ] `scope-lookup-stress.less` gains lookup counters/profile support.
Scope: benchmark/profile scripts. Goal: provide a measured target for
strategy branching and handle-access allocation. Acceptance: command records
lookup counters for the stress fixture.

7kj. [ ] Next queue is reseeded only from binding/lookup backlog after the
above pass. Scope: this handoff plus `BINDING-INDEX-PROPOSAL.md`. Goal:
maintain 10-15 sizable tasks, no micro-items, no non-binding cutting drift.
Acceptance: completed items replaced by concise baseline and a fresh real
queue.

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

- Latest pass: added proof that `Reference`'s single cached lookup strategy
  rejects stale lookup types, that callable lookup handles reject stale
  `terminalMixinOnly` mode, and that the direct property child-visibility spy
  tests traversal after frame prep. The pass also recorded that
  `benchmark-v39.less` no longer exposes lookup counters for declaration
  strategy splitting, and reseeded the queue around real binding/lookup cuts.
- Verdict: accepted as lookup-handle and handoff proof, not as a speed claim.
- New traversal: none in production. Tests add existing lookup calls and
  prototype spies around them.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: no production helper or API added.
- Metadata mutations: tests mutate `Reference.options.type` and
  `mixinRulesetCallHasArgs` to prove stale cache rejection; production metadata
  paths are unchanged.
- Allocation changes: no production allocation changes.
- Rejected/failed proof: a variable-family child-visibility spy was attempted
  and removed because variable lookup still indexes child `Rules` while
  preparing scope-frame declaration state. That is now a source-cut queue item,
  not a completed proof.
- Aggressive-review tokens: test-only `throw new Error(...)`/`try/finally`
  spies remain in the existing property visibility proof and the new handle
  prototype spies restore patched methods.
- Evidence: focused handle/property tests passed (`1` file, `4` passed,
  `146` skipped). `node scripts/profile-less-benchmark.mjs
  --file=benchmark-v39.less` ran but produced empty lookup counters, so it is
  not usable as a strategy-branching target. Focused eslint passed. Full
  focused lookup gate passed (`6` files, `308` passed, `286` skipped). Residue
  grep had no matches; `git diff --check`, `@jesscss/core` build, aggressive
  review, node-creation audit, and `jess` build passed. Emitted audit showed
  handle reads still reject mismatched `lookupType` and `terminalMixinOnly` in
  the straight-line guard. Node-creation audit stayed at `new-node: 302`,
  `with-surface: 39`, `derive: 30`, `copy-leaves: 28`. One-iteration hotpath
  smoke passed and is not a speed claim: `mixins-guards.less` `28.18ms`,
  `scope-lookup-stress.less` `113.07ms`.
