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

3. [ ] Add reference-level simple callable bridge proof for `findMixinsFast`.
Scope: function, mixin, mixin-ruleset, callable versions, and reference handle
reuse. Goal: simple static callable references prove no public bridge or broad
child crawl after first handle write. Acceptance: reference tests spy
`Rules.findMixin`, `Rules.findFunction`, and `Rules.findMixinsFast`.

4. [ ] Complete leaky/searchScope disqualification across remaining lookup
families. Scope: `context.leakyRules`, `context.searchScope`, property,
variable, declaration, function, mixin, and mixin-ruleset handles. Goal: active
disqualification never writes handles; normal mode rebuilds them. Acceptance:
focused tests cover every family, including callable leaky and function
searchScope.

5. [ ] Audit `shouldPrepareCallableReferenceFrame` for hot-path cost and
coverage. Scope: reference callable lookup, root/rulesContext flags,
reference-import trees, array keys, explicit targets, and local lookup. Goal:
frame prep stays limited to reference-import callable string lookups that can
delete broad crawl. Acceptance: tests prove no frame build for ordinary simple
callable references and zero bridge for reference-import misses.

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

11. [ ] Audit prepared child-entry aggregate facts for import/config mutation
safety. Scope: `directChildRuleEntries`, `hasExact*ChildSurface`,
`hasReferenceImportSurface`, replacement configs, and late child additions.
Goal: trust aggregate facts only when prepared state cannot be stale.
Acceptance: guarded import tests plus prepared-null/array mutation tests.

12. [ ] Prove assignment-only direct lookup wrappers stay cold. Scope:
`find*DeclarationAssignmentLookup`, `find*DeclarationOccurrence`, `setDefined`,
readonly propagation, and reference read imports. Goal: occurrence helpers never
allocate `DirectDeclarationLookupResult`; wrapper helpers are assignment-only.
Acceptance: grep plus focused setDefined/direct-reference tests.

13. [ ] Add final public-bridge grep/test for ordinary static declaration
reads. Scope: variable, property, declaration, index, and merge-chain refs.
Goal: no hot read imports or calls wrapper-returning helpers or public
`Rules.find*` materialization wrappers. Acceptance: reference spy matrix plus
grep.

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

This pass converted the rendered reference-import callable miss from a
documented broad-crawl bridge into a zero-bridge covered miss, using existing
`getScopeFrame()` parent wiring only for reference-import callable string
lookups. It also split reference-mode render suppression from lookup
reference-import uncertainty, added variable/function/callable cold-handle
proof, and removed the wrapper allocation from hot variable/property occurrence
helpers.

Deferred: guarded/configured child-surface splitting, retry-frame cleanup,
`ReferencePlan`, namespace array deletion, scalar output-binding invalidation,
and changed-baseline verification remain active. Namespace positive-path array
proof already exists, but the remaining `collectKeyRemainder(...)` fallbacks
need a deeper namespace pass rather than a speculative one-line cut.

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

- Latest pass: converted the real rendered reference-import callable miss to a
  covered zero-bridge miss, split reference-mode render state from lookup
  reference-import uncertainty, added variable/function/callable handle
  disqualification proofs, and made hot occurrence helpers bypass the
  assignment wrapper object.
- Verdict: accepted as bridge deletion plus hot wrapper deletion; not a
  wall-clock speed claim.
- New traversal: `shouldPrepareCallableReferenceFrame` checks the current
  target scope plus existing root/rulesContext flags before calling
  `getScopeFrame()`. This is accepted only for string-key, no-target, non-local
  callable references in reference-import trees, where it replaces the broader
  `findMixinsFast` crawl. It is not used for ordinary callable references,
  explicit targets, local lookup, or array-path namespace keys.
- New node/materialization: test-only `new Context({ leakyRules: true })` and
  `new JsFunction(...)` create isolated disqualified/function lookup fixtures.
  Production code adds no new AST node creation.
- Render path: no render materialization was added. The changed render fixture
  still emits the optional callable miss as text; lookup now reaches the
  fallback without broad crawl.
- Helper/API surface: added one private reference helper to share the gated
  frame-prep decision between mixin and mixin-ruleset lookup. Hot
  `findVariableDeclarationOccurrence` and `findPropertyDeclarationOccurrence`
  now call scalar occurrence lookup directly instead of using the
  wrapper-returning assignment helpers.
- Metadata mutations: `Rules.hasReferenceImportLookupSurface()` keeps
  reference-mode wrappers from marking callable miss coverage unknown unless
  they carry real child reference-import lookup surfaces. No parent/source
  restoration or new side maps were added.
- Allocation changes: hot occurrence helpers no longer allocate
  `DirectDeclarationLookupResult`. Test-only arrays record spy hits. Callable
  reference frame prep may create an existing `ScopeFrame` only under the gated
  reference-import condition.
- Rejected/deferred proof: ordinary callable frame prep remains rejected as too
  broad. Guarded/configured child-surface splitting, scalar output-binding
  invalidation, `ReferencePlan`, and namespace fallback array deletion remain
  queued.
- Aggressive-review tokens: test-only arrays, spies, `try` blocks, and thrown
  errors restore instrumented methods or prove skipped surfaces are not read.
  The `string | string[]` key type on `shouldPrepareCallableReferenceFrame` is a
  typed gate that rejects array-path namespace keys before frame prep.
- Evidence: focused reference-import/mixin/rules-flags matrix passed
  (`9` passed). Focused reference disqualification/bridge matrix passed
  (`13` passed). Focused setDefined/direct lookup matrix passed (`16` passed).
  Broad lookup matrix passed (`339` passed, `306` skipped). Stress profile on
  `scope-lookup-stress.less` reports no old `Rules.find`, registry, or
  searchChildren counters and direct counters:
  `declaration.cacheMiss: 7560`, `declaration.scope.v: 7560`,
  `declaration.childEntriesFamilySkip: 5400`,
  `declaration.childEntriesScanned: 1575`,
  `declaration.childEntryEntered: 1575`, and `declaration.framePrep: 1`.
  Current profile elapsed value (`208.64ms`) is profiler smoke only, not a
  speed claim. Final gates passed: stale lookup grep with no hits,
  `git diff --check`, focused eslint, `@jesscss/core` build,
  aggressive-cutting review, node-creation audit, `jess` build, and
  one-iteration hotpath smoke. Hotpath smoke values were `mixins-guards.less`
  `27.15ms` and `scope-lookup-stress.less` `78.12ms`; smoke only, not speed
  claims.
