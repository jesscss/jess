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
- Simple exact callable misses with covered child frames now skip the broad
  `findMixinsFast` child crawl; frame-less reference-import placements still
  document the remaining bridge.
- Rendered reference-import callable misses now prepare the existing scope-frame
  parent chain for reference-import trees and prove zero broad `findMixinsFast`
  hits for the real miss fixture. Reference-mode wrappers no longer count as
  lookup-unknown child surfaces by themselves.
- Static reference handles now prove `leakyRules` and `searchScope`
  disqualify handle writes across variable, property, declaration, function,
  mixin, and mixin-ruleset families. Ordinary simple callable references also
  prove they do not force scope-frame prep, and simple callable handle reuse
  proves no repeated public or broad callable bridge after the first write.

Total remaining scope lives in `BINDING-LOOKUP-REMAINING.md`. Treat that file
as the burn-down inventory; treat the queue below as the next executable slice.

## Active Queue

Complete every item in this queue before committing the next pass.

1. [ ] Split guarded/configured child-surface uncertainty from simple exact
child-frame misses. Scope: `findMixinsFastForUncoveredCallable`, imported
guarded mixins, configured import child surfaces, `options.context`, and
replacement/additive import config. Goal: only genuinely dynamic
guarded/configured surfaces can reach the broad crawl. Acceptance: child-frame
exact misses stay zero-bridge; guarded/config matrices stay green.

2. [ ] Finish callable retry-frame bridge deletion where retry frames are
covered. Scope: parent/fallback frame loops in `Rules.findMixin`, fallback
frame `prepareCallableLookupFrame`, recursive namespace starts, and
reference-import fallback frames. Goal: covered retry-frame misses do not keep
walking into broad direct crawls. Acceptance: parent/fallback callable miss spy
tests plus existing fallback hit tests.

3. [ ] Add retry-frame bridge proof before deleting more fallback bridges.
Scope: parent scope frames, fallback frames, covered misses, recursive namespace
starts, and `findMixinsFastForUncoveredCallable`. Goal: prove which retry
frames are already covered and which still need dynamic child-surface fallback.
Acceptance: spy tests separate parent/fallback zero-bridge misses from real
guarded/configured positives.

4. [ ] Tighten direct child-entry callable aggregates without reviving an
index. Scope: `directChildRuleEntries`, exact mixin/ruleset flags,
reference-import flags, late child additions, and prepared-null state. Goal:
carry only source-tree facts that make exact misses cheaper. Acceptance:
prepared-null/late-addition tests plus guarded import fixtures.

5. [ ] Delete any remaining simple exact callable child scans that are
provably covered by frame facts. Scope: current-frame miss, child-entry family
skip, child-frame covered miss, and terminal mixin-only mode. Goal: avoid
child-surface crawl when the frame already says the family/key cannot hit.
Acceptance: `findMixinsFast` spy tests for simple mixin and mixin-ruleset
misses.

6. [ ] Retry `ReferencePlan` only for source-static facts. Scope:
`_lookupStrategy`, key node identity, read mode, target presence, `inCall`, and
static parent/start shape. Goal: cache repeated preparation only when generated
control/mixin surfaces cannot change the facts. Acceptance: control loop matrix
plus variable/property/function/callable handle tests.

7. [ ] Eliminate remaining positive-path `collectKeyRemainder(...)` arrays.
Scope: ruleset namespace, compound-prefix namespace, recursive namespace
fallback paths, and guarded/imported namespace positives. Goal: arrays exist
only on cold miss/legacy fallback paths. Acceptance: nested array-path spies for
positive namespace cases stay zero.

8. [ ] Extend stable namespace no-fallback proof to guarded/imported namespace
surfaces. Scope: namespace path offsets, guarded mixins, reference imports,
terminal mixin-only mode, and parameterized terminals. Goal: stable positives
stay on offset paths without breaking Less semantics. Acceptance: Less fixture,
guarded namespace tests, and reference-import namespace tests.

9. [ ] Confirm scalar excluded-node handle invalidation after output binding.
Scope: merge normalization scalar getters, handle shape before/after
`bindOutput`, and stale occurrence invalidation. Goal: prove scalar exclusion
identity changes exactly when the output declaration is bound. Acceptance:
lower-level/materialization-aware handle test; do not use the rejected
render-level `Reference.eval` spy shape.

10. [ ] Audit scalar declaration exclusion fields as internal-only state.
Scope: `ReferenceOptions`, `DeclarationFindOptions`, merge normalization, and
public docs/exports. Goal: scalar excluded-node fields stay implementation
details, not compatibility surface. Acceptance: repo usage proof and no docs/API
promise.

11. [ ] Prove assignment-only direct lookup wrappers stay cold. Scope:
`find*DeclarationAssignmentLookup`, `find*DeclarationOccurrence`, `setDefined`,
readonly propagation, and reference read imports. Goal: occurrence helpers never
allocate `DirectDeclarationLookupResult`; wrapper helpers are assignment-only.
Acceptance: grep plus focused setDefined/direct-reference tests.

12. [ ] Add final public-bridge grep/test for ordinary static declaration
reads. Scope: variable, property, declaration, index, and merge-chain refs.
Goal: no hot read imports or calls wrapper-returning helpers or public
`Rules.find*` materialization wrappers. Acceptance: reference spy matrix plus
grep.

13. [ ] Prove reference-import declaration/callable misses stay on modeled
frames after retry-frame cleanup. Scope: reference import roots, rendered
reference imports, parent/fallback frames, and optional callable misses. Goal:
no regression to frame-less broad crawl. Acceptance: real reference-import
fixtures plus broad-bridge spies.

14. [ ] Run changed-baseline and fix any lookup-owned fallout now that the
ruleset header streaming blocker is repaired. Scope: changed Less/Jess
fixtures, ruleset render interaction with lookup work, and branch-local
failures. Goal: use baseline evidence as a gate again. Acceptance:
`pnpm run verify:baseline -- --changed` either passes or has a lookup-owned
failure recorded with a fix.

15. [ ] Refresh lookup profile and one-iteration hotpath smoke after the next
bridge deletion batch. Scope: `scope-lookup-stress.less`, direct lookup
counters, old registry counters, and smoke timings. Goal: keep counter evidence
current without claiming speed. Acceptance: profile recorded with old
`Rules.find`/registry counters empty and smoke values labeled smoke-only.

## Unfinished-Item Exception

This pass closed proof gaps rather than cutting production code: disqualified
lookups now prove cold handles across every lookup family, ordinary simple
callable references prove they do not prepare scope frames, and simple callable
handle reuse proves no repeated public or broad callable bridge after the first
write.

Deferred: guarded/configured child-surface splitting, retry-frame cleanup,
`ReferencePlan`, namespace array deletion, scalar output-binding invalidation,
and changed-baseline verification remain active. Namespace positive-path array
proof already exists, but the remaining `collectKeyRemainder(...)` fallbacks
need a deeper namespace pass rather than a speculative one-line cut. The
production bridge-deletion items remain because this pass deliberately turned
the vague proof gaps into concrete acceptance coverage before cutting the next
fallback path. `pnpm run verify:baseline -- --changed` still expands to full
baseline because the branch upstream ref is not stored as a remote-tracking
branch; the full core Vitest phase was stopped after several minutes of no new
output, so changed-baseline remains unresolved rather than passed.

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

- Latest pass: added proof-only binding coverage for disqualification,
  ordinary callable frame-prep cost, and simple callable handle bridge reuse.
- Verdict: accepted as evidence hardening for the next bridge-deletion pass;
  not a wall-clock speed claim.
- New traversal: production code adds none. Test spies record calls to
  `getScopeFrame`, `findMixin`, `findFunction`, and `findMixinsFast`.
- New node/materialization: production code adds none. Test fixtures create
  small `Rules`, `Mixin`, `Ruleset`, `Context`, and `JsFunction` nodes to cover
  each lookup family.
- Render path: no render code changed and no render materialization was added.
- Helper/API surface: one test helper, `expectNodeType`, replaces repeated
  local type assertions. No production helper or public API was added.
- Metadata mutations: no production metadata mutations. Tests temporarily patch
  prototype methods inside `try/finally` and restore them.
- Allocation changes: production code adds none. Test arrays count spy hits.
- Rejected/deferred proof: guarded/configured child-surface splitting,
  retry-frame bridge deletion, scalar output-binding invalidation,
  `ReferencePlan`, namespace fallback array deletion, and changed-baseline
  verification remain queued.
- Evidence: focused reference disqualification/bridge matrix passed (`19`
  passed, `165` skipped). Broad lookup matrix passed (`346` passed, `307`
  skipped). Stress profile on `scope-lookup-stress.less` reports no old
  `Rules.find`, registry, or searchChildren counters and direct counters:
  `declaration.cacheMiss: 7560`, `declaration.scope.v: 7560`,
  `declaration.childEntriesFamilySkip: 5400`,
  `declaration.localMatch: 2385`, `declaration.childEntriesScanned: 1575`,
  `declaration.childEntryFamilySkip: 1575`,
  `declaration.childEntryEntered: 1575`, `declaration.scopeBindingHit: 1575`,
  and `declaration.framePrep: 1`. Current profile elapsed value (`233.34ms`) is
  profiler smoke only, not a speed claim. One-iteration hotpath smoke values
  were `mixins-guards.less` `25.84ms` and `scope-lookup-stress.less`
  `109.33ms`; smoke only, not speed claims. Final gates passed: stale lookup
  grep with no hits, `git diff --check`, focused eslint, `@jesscss/core`
  build, aggressive-cutting review, node-creation audit, and `jess` build.
  Changed-baseline did not pass; it expanded to full baseline because of the
  missing upstream tracking ref and was stopped during the full core Vitest
  phase after several minutes without new output.
