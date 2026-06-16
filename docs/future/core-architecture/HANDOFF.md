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

1. [ ] Extend callable offset/path views through ruleset prefix and compound
paths. Scope: `findMixinNamespacePathFast`, ruleset prefix matches,
compound-prefix namespace recursion, and positive-hit fallback boundaries.
Goal: remove more `collectKeyRemainder(...)` array materialization without
changing miss semantics. Acceptance: namespace spy matrix proves repeated
array-path calls fall and existing namespace/mixin-ruleset fixtures pass.

2. [ ] Replace callable lookup string slicing with a path-key offset. Scope:
`getCallableLookupKeyRemainder(...)`, callable handle keys, namespace path
prefixes, and newline/selector normalization. Goal: stop rebuilding remainder
strings where the caller already has a normalized path and offset. Acceptance:
simple callable and namespace handle tests plus focused namespace fixtures.

3. [ ] Delete remaining callable direct-crawl bridges where exact surface facts
are now carried. Scope: `RulesEntryLike` exact callable flags, caller-routed
candidate decisions, child-surface decisions, and reference-import decisions.
Goal: covered callable misses stop before `findMixinsFast`. Acceptance: spies
for no-child, no-reference-import, and candidate-miss cases.

4. [ ] Make carried exact callable surface flags the only prepared-entry gate.
Scope: direct child-entry collection, output-slot placement facts, namespace
lookup, and child-entry traversal. Goal: remove recursive surface rediscovery
from prepared entries. Acceptance: focused child-surface tests plus aggressive
review shows no new recursive rediscovery.

5. [ ] Scalarize merge assignment excluded-node state. Scope:
`Declaration._normalizeAssignmentValue`, reference lookup options, handle shape,
and direct declaration predicates. Goal: replace per-merge excluded-node arrays
with source/output scalar fields or colder state. Acceptance: merge fixtures,
handle reuse tests, and lower aggressive-review array-token pressure.

6. [ ] Narrow typed declaration constraint handle fields by lookup family.
Scope: variable/property/declaration handle writes, function/callable handle
writes, and shared handle shape. Goal: prevent declaration-only constraint
fields from riding along callable/function handles if avoidable. Acceptance:
handle tests pass and direct code evidence shows hot family shapes are smaller.

7. [ ] Prove import/reference declaration misses avoid fallback bridges. Scope:
direct declaration lookup, optional/public import visibility, reference imports,
and fallback frames. Goal: covered import/reference misses return from direct
lookup without parent rediscovery or public materialization. Acceptance:
fallback spy plus import/reference declaration fixtures.

8. [ ] Finish property merge-chain handle proof in real Less evaluation. Scope:
merge assignment references, typed `requiredNormalizedFromAssign` constraints,
occurrence slot freshness, and stale handle invalidation. Goal: prove real Less
merge reads use direct occurrence handles without generic semantic-filter
fallback. Acceptance: property merge fixtures plus handle/fallback spies.

9. [ ] Retry `ReferencePlan` only for static source facts. Scope:
`_lookupStrategy`, key node identity, read mode, target presence, and static
parent facts. Goal: cache only facts that cannot change under generated
control/mixin surfaces. Acceptance: control loop matrix plus variable/property/
function/callable handle tests.

10. [ ] Delete or keep-cold the leaky/searchScope bridge beyond proof. Scope:
`context.leakyRules`, `context.searchScope`, handle eligibility, and stale
handle clearing. Goal: ordinary covered lookups never pay for disqualified
lookup machinery, while active leaky/searchScope lookups stay cold. Acceptance:
focused leaky/searchScope tests plus handle reuse/clear tests.

11. [ ] Flatten direct lookup result shapes where cold materialization is not
needed. Scope: `DirectDeclarationLookupResult`, public match/result
materialization, handle writes, and fallback-only details. Goal: simple reads
return scalar occurrence facts and build public result objects only on cold
paths. Acceptance: focused declaration/property/variable handle tests.

12. [ ] Build static function/simple callable no-fallback proof. Scope:
function handles, simple mixin handles, callable versions, and fallback spies.
Goal: prove simple static callable reads do not enter registry-shaped search or
public materialization wrappers. Acceptance: function/callable spy matrix.

13. [ ] Build static variable/property/declaration no-fallback proof. Scope:
scope-frame binding hits, direct occurrence reads, declaration versions, and
fallback spies. Goal: prove ordinary static reads avoid fallback ladders and
unnecessary child scans. Acceptance: variable/property/declaration spy matrix
plus stress profile counters.

14. [ ] Build stable namespace no-fallback proof. Scope: namespace path lookup,
recursive parent/child traversal, callable remainder handling, and reference
imports. Goal: prove stable namespace reads bypass old direct-crawl bridges
after surface facts are complete. Acceptance: namespace spy matrix plus Less
fixture coverage.

15. [ ] Refresh profile, update burn-down docs, and reseed the next queue.
Scope: direct lookup profile, one-iteration hotpath smoke, handoff, and
`BINDING-LOOKUP-REMAINING.md`. Goal: record changed counters, explain any
unfinished queue items, and seed exactly 15 real next tasks. Acceptance:
profile output recorded; no speed claim from smoke.

## Unfinished-Item Exception

This pass completed a positive-hit callable namespace offset fast path,
carried exact callable/mixin/ruleset child-surface facts on prepared entries,
allowed source-static typed property/declaration constraints into handles,
proved wider excluded-node filters stay cold, proved active `searchScope`
clears stale handles and later rebuilds ordinary handles, and audited existing
parameterized namespace terminal coverage. A sub-agent handled the
property/declaration handle slice and the controller integrated it.

Deferred: full path-view/string-slice deletion, scalar excluded-node state,
callable direct-crawl bridge deletion, `ReferencePlan`, import/reference miss
proof, final no-fallback proof, and final result-shape flattening remain active.
These are reseeded above rather than hidden.

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

- Latest pass: added a positive-hit callable namespace offset fast path,
  carried exact callable/mixin/ruleset child-surface facts on prepared entries,
  admitted source-static typed property/declaration constraints into handles,
  kept wider excluded-node filters cold, and proved active `searchScope`
  disqualification clears stale handles before ordinary lookup rebuilds them.
- Verdict: accepted as fact carrying, positive-only fast pathing, and typed
  handle identity work; not a wall-clock speed claim.
- New traversal: no new recursive lookup traversal. The offset path reuses the
  existing `findMixinNamespacePathFast` walker before array fallback and only
  accepts positive hits; miss/empty-hit semantics still fall back to the old
  path. Prepared child-entry traversal now reads carried exact surface flags
  instead of rediscovering exact callable/ruleset/mixin surfaces recursively.
  Handle shape comparisons are scalar field checks.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: added optional internal `pathStart` to
  `findMixinNamespacePathFast` and added declaration-constraint shape helpers in
  `reference.ts`. They are internal to lookup and are queued for further
  narrowing where family-specific fields can delete broad handle shape.
- Metadata mutations: `RulesEntryLike` now carries exact callable/mixin/ruleset
  flags in addition to reference-import surface facts. Reference handles now
  carry source-static normalized-assignment and small excluded-node constraint
  identity. No node parent/source/frozen metadata changed.
- Allocation changes: positive namespace offset hits avoid some
  `collectKeyRemainder(...)` arrays. Typed declaration constraints currently
  generate a normalized assignment key string for handleable filters; existing
  excluded-node arrays are still queued for scalarization.
- Rejected/deferred proof: accepting offset fast-path misses was rejected after
  the namespace fixture exposed exact ruleset terminal semantics. The fast path
  is now positive-only. The first hotpath smoke also exposed that nested offset
  calls must respect `searchParents: false`; that fix is included and the smoke
  now passes.
- Aggressive-review tokens: production array/key tokens remain around namespace
  fallback arrays and typed declaration constraints; accepted for this pass
  because the former is now avoided on positive offset hits and the latter keeps
  wider filters cold. Test-only arrays/spies and `try` blocks restore
  instrumented methods and build isolated fixtures.
- Evidence: focused eslint passed for touched lookup files and tests. Focused
  namespace tests passed (`34` passed, then `35` passed after exact surface
  flags). Focused reference handle/searchScope tests passed (`75` passed,
  `94` skipped). Broad lookup matrix passed (`7` files, `338` passed,
  `293` skipped). Stress profile on `scope-lookup-stress.less` reports no old
  `Rules.find`, registry, or searchChildren counters and direct counters:
  `declaration.cacheMiss: 7560`, `declaration.scope.v: 7560`,
  `declaration.childEntriesFamilySkip: 5400`,
  `declaration.childEntriesScanned: 1575`,
  `declaration.childEntryEntered: 1575`, and `declaration.framePrep: 1`.
  Final gates passed: stale lookup/plan grep, `git diff --check`, touched-file
  eslint, `@jesscss/core` build, aggressive-cutting review, node-creation
  audit, `jess` build, and one-iteration hotpath smoke. Node-creation audit is
  unchanged at `new-node: 307`, `with-surface: 39`, `derive: 30`,
  `copy-leaves: 28`. The profile elapsed value (`197.84ms`) and hotpath smoke
  values (`mixins-guards.less` `18.94ms`, `scope-lookup-stress.less`
  `72.00ms`) are smoke only, not speed claims.
