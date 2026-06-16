# Core Architecture Handoff

This is the active runbook for Jess core architecture work. Keep it short:
enough to make the next LLM choose the right work, and no more.

Use the doc split:

- `HANDOFF.md`: current focus, active queue, gates, and handoff discipline.
- `AGGRESSIVE-CUTTING-REVIEW.md`: patch-shape rules and rejection criteria.
- `PERFORMANCE-HANDOFF.md`: benchmark protocol and performance evidence.
- `NODE-REWRITE-TRACKER.md`: node-family rewrite status.
- `BINDING-INDEX-PROPOSAL.md`: binding/index design target.
- `BINDING-LOOKUP-REMAINING.md`: total remaining binding/lookup inventory.

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

`_indexRules()` is legacy lookup-indexing debt. Do not add new lookup
dependencies on it. Runtime lookup should crawl the canonical tree directly
and consult evaluated/live binding state only when that state already exists.

## Working Rules

- Work from repo evidence first.
- A "full queue pass" means an automated uninterrupted burn through every
  active queue item below, not one micro-edit and not one commit-sized nibble.
- Do not stop at a wrap-up point merely because one item passed tests. Continue
  into the next queue item until the queue is empty, a semantic blocker is
  proven, or the next item would conflict with uncommitted work from a parallel
  agent.
- If any active queue item remains unfinished at wrap-up, explicitly explain
  in the handoff and final response which items remain, what blocked immediate
  continuation, and why stopping was necessary.
- Queue items must be whole tasks. Do not create one-line queue items.
- Before ending a pass, seed the next queue with exactly 15 real
  binding/lookup tasks.
- Queue numbering is always plain `1` through `15`. Do not preserve old queue
  IDs, ticket-like labels, or historical numbering.
- Reseeding the next queue is mandatory closeout work, not one of the 15 queue
  items.
- Keep completed history out of this file. Replace old done items with a short
  baseline note only when it helps the next worker.
- Use focused tests while iterating, then run gates before commit.
- Claim speed only from proper before/after measurement. One-iteration
  hotpath runs are smoke only.
- Commit and push after a completed queue pass. Use `--no-verify` for commit
  and push in this branch because hooks have previously looped.

## Automated Loop And Sub-Agents

When the user says `continue`, `do all queue items`, or `complete the queue`,
run this loop without asking for another permission ping:

1. Snapshot `git status --short --branch`.
2. Read the active queue and `BINDING-LOOKUP-REMAINING.md`.
3. Dispatch sub-agents when available for independent slices:
   declaration/property, callable/namespace, reference handles/plans,
   import/reference visibility, and verification/review.
4. Work locally on the critical-path item while sub-agents inspect or edit
   disjoint owned files.
5. Integrate returned work, run focused tests, then continue to the next item.
6. Run commit gates only at a coherent batch boundary, not after every tiny
   edit, unless a risky semantic split needs its own checkpoint.
7. Update this handoff and the remaining-work inventory only with facts that
   change the next worker's decisions.
8. Commit and push with `--no-verify`.

Sub-agent rules:

- Prefer sub-agents for sidecar analysis, targeted implementation, and review
  when their file ownership can be made disjoint.
- Tell worker agents they are not alone in the codebase and must not revert
  other workers' changes.
- The controller owns final integration, gates, handoff, commit, and push.
- Do not use sub-agents to avoid the critical path; keep moving locally while
  they run.

## Current Architecture Baseline

Registryless lookup is still the active runtime direction, but the scope is
larger than the earlier "three passes" estimate. The old registry classes and
`_indexRules()` lookup path are no longer the main blocker. The remaining work
is finishing the binding-frame/direct-crawl replacement so covered simple paths
do not enter fallback ladders, public materialization wrappers, unnecessary
child scans, or broad invalidation lanes.

Current hot evidence after the latest queue pass:

- `scope-lookup-stress.less` direct profile now reports
  `declaration.cacheMiss: 7560`,
  `declaration.scope.v: 7560`,
  `declaration.childEntriesScanned: 1575`,
  `declaration.childEntryEntered: 1575`,
  `declaration.childEntriesFamilySkip: 5400`,
  `declaration.childEntryFamilySkip: 1575`, and
  `declaration.framePrep: 1`.
- The pre-pass profile for the same fixture was
  `declaration.cacheMiss: 16560`,
  `declaration.childEntryEntered: 11520`,
  `declaration.childEntriesScanned: 10530`, and
  `declaration.framePrep: 139`.
- This is counter evidence only. Do not claim wall-clock speed from it.
- Function handles are per-key; callable handles use
  `Rules.callableLookupVersion`.
- Variable/property/declaration handles now use per-key declaration versions.
  Variable direct occurrences owned by ancestor rules are not cached as variable
  handles because live/current bindings on the target frame can later shadow
  them.
- Scope-frame variable handles use cell identity plus owner-frame current
  pointer version; cached handle reads no longer re-read
  `currentBindingsByName`.
- Reference variable lookup uses one modeled `live-current` lane instead of a
  second live-only retry. Ancestor variable handle freshness is tracked with
  target-frame current binding facts.
- Reference lookup still allocates handle/context shapes around some typed
  paths. A broad `ReferencePlan` attempt remains rejected after the control
  loop matrix exposed stale dynamic-surface facts.
- Reference handle access no longer allocates a separate access object; handle
  reads/writes use scalar locals and the cached handle shape.
- Callable namespace lookup routes candidate, child-surface, and
  reference-import uncertainty through caller-specific decisions before using
  the old direct-crawl bridge. Terminal mixin-only lookup ignores ruleset-only
  exact candidates, and namespaced parameterized terminals keep rulesets only
  as namespace containers.

Total remaining scope lives in `BINDING-LOOKUP-REMAINING.md`. Treat that file
as the burn-down inventory; treat the queue below as the next executable slice.

## Active Queue

Complete every item in this queue before committing the next pass.

1. [ ] Delete remaining callable direct-crawl bridges where exact surface facts
are complete. Scope: `findMixinsFastForUncoveredCallable`, child-surface and
reference-import uncovered reasons, fallback-frame callable retry, and exact
surface flags. Goal: covered callable misses stop before `findMixinsFast`.
Acceptance: spies for no-child, no-reference-import, candidate-miss, and
fallback-frame cases.

2. [ ] Retry `ReferencePlan` only for static source facts. Scope:
`_lookupStrategy`, key node identity, read mode, target presence, and static
parent facts. Goal: cache only facts that cannot change under generated
control/mixin surfaces. Acceptance: control loop matrix plus variable/property/
function/callable handle tests.

3. [ ] Delete or keep-cold the leaky/searchScope bridge beyond proof. Scope:
`context.leakyRules`, `context.searchScope`, handle eligibility, and stale
handle clearing. Goal: ordinary covered lookups never pay for disqualified
lookup machinery, while active leaky/searchScope lookups stay cold. Acceptance:
focused leaky/searchScope tests plus handle reuse/clear tests.

4. [ ] Flatten direct lookup result shapes where cold materialization is not
needed. Scope: `DirectDeclarationLookupResult`, public match/result
materialization, handle writes, and fallback-only details. Goal: simple reads
return scalar occurrence facts and build public result objects only on cold
paths. Acceptance: focused declaration/property/variable handle tests.

5. [ ] Eliminate remaining positive-path `collectKeyRemainder(...)` fallback
arrays. Scope: ruleset namespace, compound-prefix namespace, and mixin namespace
descendant fallback paths. Goal: arrays exist only on cold miss/legacy fallback
paths. Acceptance: nested array-path spies for positive cases stay at zero.

6. [ ] Build static function/simple callable no-fallback proof. Scope:
function handles, simple mixin handles, callable versions, and fallback spies.
Goal: prove simple static callable reads do not enter registry-shaped search or
public materialization wrappers. Acceptance: function/callable spy matrix.

7. [ ] Build static variable/property/declaration no-fallback proof. Scope:
scope-frame binding hits, direct occurrence reads, declaration versions, and
fallback spies. Goal: prove ordinary static reads avoid fallback ladders and
unnecessary child scans. Acceptance: variable/property/declaration spy matrix
plus stress profile counters.

8. [ ] Build stable namespace no-fallback proof. Scope: namespace path lookup,
recursive parent/child traversal, callable remainder handling, and reference
imports. Goal: prove stable namespace reads bypass old direct-crawl bridges
after surface facts are complete. Acceptance: namespace spy matrix plus Less
fixture coverage.

9. [ ] Audit scalar declaration exclusion fields as internal-only state.
Scope: `ReferenceOptions`, `DeclarationFindOptions`, merge normalization, and
public callers. Goal: keep scalar excluded-node fields from becoming a
compatibility commitment. Acceptance: repo usage proof and no docs/API promise.

10. [ ] Investigate baseline ruleset render failure before relying on full
changed-baseline as a gate. Scope: `ruleset.test.ts` "streams header selectors
without capture scaffolding", render writer path, and whether it is pre-existing
on dev. Goal: unblock full baseline evidence without mixing render work into
lookup commits. Acceptance: reproduce on dev or fix in a separate render-owned
pass.

11. [ ] Build real import/reference callable miss fixture. Scope:
reference-imported mixins/rulesets, callable miss fallback, and public callable
bridge spies. Goal: match the declaration import fixture proof for callable
lookup. Acceptance: rendered fixture plus no public callable fallback.

12. [ ] Build real stable namespace no-fallback Less fixture. Scope:
ruleset namespace containers, compound-prefix namespaces, mixin namespace
containers, and parameterized terminal mode. Goal: prove real Less namespace
calls stay on direct offset/frame paths. Acceptance: rendered fixture plus
nested array-path/direct-crawl spies.

13. [ ] Confirm scalar excluded-node handle invalidation after output binding.
Scope: merge normalization scalar getters, handle shape before/after
`bindOutput`, and stale occurrence invalidation. Goal: prove scalar exclusion
identity changes exactly when the output declaration is bound. Acceptance:
focused handle test with pre/post binding identity.

14. [ ] Re-run lookup profile after any bridge deletion or result-shape flatten.
Scope: `scope-lookup-stress.less`, direct lookup counters, and top metrics.
Goal: keep counter evidence current and avoid wall-clock claims. Acceptance:
profile recorded with old registry counters empty.

15. [ ] Refresh profile, update burn-down docs, and reseed the next queue.
Scope: direct lookup profile, one-iteration hotpath smoke, handoff, and
`BINDING-LOOKUP-REMAINING.md`. Goal: record changed counters, explain any
unfinished queue items, and seed exactly 15 real next tasks. Acceptance:
profile output recorded; no speed claim from smoke.

## Unfinished-Item Exception

This pass completed real Less merge-chain proof, real reference-import
declaration hit/miss proof, prepared child-entry rediscovery removal, and
namespace result-loop cleanup. The changed-baseline gate was run because real
fixture proof landed; it fell back to full baseline and failed on the unrelated
`ruleset.test.ts` render test "streams header selectors without capture
scaffolding". The focused lookup matrix and isolated new fixture tests pass.

Deferred: callable direct-crawl bridge deletion, `ReferencePlan`, final direct
result-shape flattening, final no-fallback proof, and baseline render-test
investigation remain active. These are reseeded above rather than hidden.

## Backlog Sources

When the active queue is empty, pull the next binding/lookup task from:

- `BINDING-LOOKUP-REMAINING.md` for the total remaining burn-down inventory.
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
rg -n "ReferenceLookupOptions|registryless|registry-utils|register\\('function'|findFunctionDirect|ReferenceFindOptions|stale registry|registry-backed|registry can find|findDeclaration\\([^,]+, undefined|Parameters<Rules\\['findMixinsFast'\\]>|RULES_LOOKUP_ADAPTERS|\\bRulesLookupAdapter\\b|lookupFunctionReference|lookupCallableReference|currentFrameHasNoMixinChildSurface|buildDeclarationReferenceLookupOptions|buildCallableReferenceLookupOptions|lastCallableLookup|copyLiveBindingSlots|ReferencePlan|_referencePlan|live-only" packages/core/src packages/jess-plugin-less/src packages/language-service/src packages/scss-parser/test/baseline.test.ts
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
2. If any active queue item was not completed, record a short explicit
   unfinished-item exception: which item remains, what blocked immediate
   continuation, and why stopping was necessary.
3. Seed only the next active binding/lookup queue. Do not reseed in a way that
   hides unfinished active queue work.
4. The new active queue must contain exactly 15 real binding/lookup tasks,
   numbered `1` through `15`; reseeding itself is not a queue item.
5. Keep this file small. Pointers to backlog docs are good; copied backlog
   content is not. If old evidence matters, put it in the commit or
   `PERFORMANCE-HANDOFF.md`, not here.
6. Keep `Aggressive Cutting Self-Prosecution` to the latest pass only.

## Aggressive Cutting Self-Prosecution

- Latest pass: added real Less merge-chain proof, real reference-import
  declaration hit/miss proof, made prepared direct-child callable entries stop
  later recursive surface rediscovery, and collapsed namespace result append to
  one loop.
- Verdict: accepted as proof plus removal of one prepared-entry rediscovery
  path; not a wall-clock speed claim.
- New traversal: no new traversal family. `findMixinNamespacePathFast` still
  uses the same offset walker, but the mixin/ruleset namespace branches now
  share one nested-scope path and one append loop instead of duplicate append
  blocks.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: no new production helper or public method. Test-only
  spies were added around public lookup bridges.
- Metadata mutations: none. Prepared child callable entries now prevent
  `hasDirectLookupChildSurface(...)` from rediscovering child surfaces by
  walking child values again.
- Allocation changes: production allocation shape unchanged in this pass.
  Test-only arrays record spy hits.
- Rejected/deferred proof: `ReferencePlan` remains deferred because the prior
  broad attempt was unsafe for dynamic control surfaces. Direct result-shape
  flattening, callable direct-crawl bridge deletion, and remaining positive-path
  `collectKeyRemainder(...)` fallback deletion are reseeded for a narrower
  follow-up rather than hidden.
- Aggressive-review tokens: production loop token is the existing namespace
  append loop, now shared. Test-only arrays, spies, `try` blocks, and thrown
  errors restore instrumented methods or prove skipped surfaces are not read.
- Evidence: focused eslint passed for touched lookup files and tests. Focused
  callable namespace/prepared-entry tests passed (`38` passed, `125` skipped).
  Focused reference/import fixture tests passed (`13` passed, `243` skipped).
  Broad lookup matrix passed serially (`7` files, `344` passed, `292` skipped).
  `pnpm run verify:baseline -- --changed` ran, fell back to full baseline, and
  failed on unrelated `ruleset.test.ts` "streams header selectors without
  capture scaffolding"; that isolated test also fails by itself and the file was
  untouched by this lookup pass. Stress profile
  on `scope-lookup-stress.less` reports no old
  `Rules.find`, registry, or searchChildren counters and direct counters:
  `declaration.cacheMiss: 7560`, `declaration.scope.v: 7560`,
  `declaration.childEntriesFamilySkip: 5400`,
  `declaration.childEntriesScanned: 1575`,
  `declaration.childEntryEntered: 1575`, and `declaration.framePrep: 1`.
  Final gates passed: stale lookup grep, `git diff --check`, focused eslint,
  `@jesscss/core` build, aggressive-cutting review, node-creation audit,
  `jess` build, and one-iteration hotpath smoke. Node-creation audit remains
  `new-node: 307`, `with-surface: 39`, `derive: 30`, `copy-leaves: 28`.
  The profile elapsed value (`224.73ms`) and hotpath smoke values
  (`mixins-guards.less` `21.41ms`, `scope-lookup-stress.less` `81.26ms`) are
  smoke only, not speed claims.
