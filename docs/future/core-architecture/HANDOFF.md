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

Total remaining scope lives in `BINDING-LOOKUP-REMAINING.md`. Treat that file
as the burn-down inventory; treat the queue below as the next executable slice.

## Active Queue

Complete every item in this queue before committing the next pass.

1. [ ] Convert the remaining frame-less reference-import callable miss into a
covered miss. Scope: references inside rendered rulesets, target frame
selection, reference-import child facts, and fallback values. Goal: the real
`import-reference: rendered callable misses` fixture records zero
`findMixinsFast` bridge hits. Acceptance: fixture renamed away from
"remaining bridge" and guarded/reference-import positives still pass.

2. [ ] Split guarded/configured child-surface uncertainty from simple exact
child-frame misses. Scope: `findMixinsFastForUncoveredCallable`, imported
guarded mixins, configured import child surfaces, and `options.context`. Goal:
only genuinely dynamic guarded/configured surfaces can reach the broad crawl.
Acceptance: child-frame exact misses stay zero-bridge; guarded/config matrices
stay green.

3. [ ] Finish callable retry-frame bridge deletion where retry frames are
covered. Scope: parent/fallback frame loops in `Rules.findMixin`, fallback
frame `prepareCallableLookupFrame`, and recursive namespace starts. Goal:
covered retry-frame misses do not keep walking into broad direct crawls.
Acceptance: parent/fallback callable miss spy tests plus existing fallback
hit tests.

4. [ ] Build a reference-level static callable no-public-bridge matrix. Scope:
function, mixin, mixin-ruleset, callable versions, and reference handle reuse.
Goal: simple static callable references prove no `Rules.findMixin`,
`Rules.findFunction`, or `findMixinsFast` call after first handle write.
Acceptance: reference tests spy the bridges and prove unrelated version bumps
stay cold.

5. [ ] Build a reference-level static declaration no-public-bridge matrix.
Scope: variable, property, declaration reads, declaration versions, and
scope-frame binding handles. Goal: ordinary static reads prove no
`findVariable`, `findProperty`, `findDeclaration`, or broad `find` bridge.
Acceptance: variable/property/declaration spy matrix plus handle invalidation
on same-key mutation.

6. [ ] Finish cold assignment lookup naming through readonly/setDefined tests.
Scope: `find*DeclarationAssignmentLookup`, `setDefined`, readonly propagation,
and variable live-cell writes. Goal: assignment-only wrapper use is tested and
hot reads never import or call wrapper-returning helpers. Acceptance: readonly
setDefined tests plus grep proving helper names are assignment-only.

7. [ ] Prove leaky/searchScope disqualification across all lookup families.
Scope: `context.leakyRules`, `context.searchScope`, declaration handles,
variable handles, callable/function handles, and stale handle clearing. Goal:
active disqualification never writes handles; normal mode rebuilds them.
Acceptance: focused tests for declaration, variable, property, function, and
simple callable families.

8. [ ] Retry `ReferencePlan` only for source-static facts. Scope:
`_lookupStrategy`, key node identity, read mode, target presence, `inCall`, and
static parent/start shape. Goal: cache repeated preparation only when generated
control/mixin surfaces cannot change the facts. Acceptance: control loop matrix
plus variable/property/function/callable handle tests.

9. [ ] Eliminate remaining positive-path `collectKeyRemainder(...)` arrays.
Scope: ruleset namespace, compound-prefix namespace, recursive namespace
fallback paths, and guarded/imported namespace positives. Goal: arrays exist
only on cold miss/legacy fallback paths. Acceptance: nested array-path spies for
positive namespace cases stay zero.

10. [ ] Extend stable namespace no-fallback proof to guarded/imported namespace
surfaces. Scope: namespace path offsets, guarded mixins, reference imports,
terminal mixin-only mode, and parameterized terminals. Goal: stable positives
stay on offset paths without breaking Less semantics. Acceptance: Less fixture,
guarded namespace tests, and reference-import namespace tests.

11. [ ] Confirm scalar excluded-node handle invalidation after output binding.
Scope: merge normalization scalar getters, handle shape before/after
`bindOutput`, and stale occurrence invalidation. Goal: prove scalar exclusion
identity changes exactly when the output declaration is bound. Acceptance:
lower-level/materialization-aware handle test; do not use the rejected
render-level `Reference.eval` spy shape.

12. [ ] Audit scalar declaration exclusion fields as internal-only state.
Scope: `ReferenceOptions`, `DeclarationFindOptions`, merge normalization, and
public docs/exports. Goal: scalar excluded-node fields stay implementation
details, not compatibility surface. Acceptance: repo usage proof and no docs/API
promise.

13. [ ] Audit prepared child-entry aggregate facts for import/config mutation
safety. Scope: `directChildRuleEntries`, `hasExact*ChildSurface`,
`hasReferenceImportSurface`, replacement configs, and late child additions.
Goal: trust aggregate facts only when prepared state cannot be stale.
Acceptance: guarded import tests plus prepared-null/array mutation tests.

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

This pass fixed the branch-local ruleset header streaming blocker, proved
variable/declaration `searchScope` disqualification and declaration
`leakyRules` disqualification stay cold, renamed wrapper-producing direct
lookup helpers as assignment-only, and deleted one simple exact callable
child-surface broad-crawl case by checking covered child frames first.

Deferred: the no-frame reference-import callable miss still reaches the broad
`findMixinsFast` bridge because that rendered reference starts from a
frame-less placement before child-frame proof can help. The scalar
output-binding proof remains active because a render-level `Reference.eval` spy
was false: merge rendering folded the output without evaluating that generated
reference. `ReferencePlan`, guarded/configured child-surface splitting,
positive-path namespace array deletion, and changed-baseline verification are
reseeded above rather than hidden.

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

- Latest pass: restored ruleset header streaming with `writeSyntax`, added
  `searchScope`/`leakyRules` cold-handle proofs, renamed direct declaration
  wrapper helpers as assignment-only, and taught uncovered callable child-surface
  lookup to prove exact misses from covered child frames before broad crawl.
- Verdict: accepted as proof plus one bridge deletion for simple exact
  child-frame misses; not a wall-clock speed claim.
- New traversal: `findMixinsFastForUncoveredCallable` now continues through
  eligible child entries instead of breaking on the first child surface. That is
  accepted because it replaces a broader recursive `findMixinsFast` child crawl
  when child frames can prove an exact-key miss or hit. It still falls back to
  the existing broad crawl when a child frame is genuinely uncovered.
- New node/materialization: test-only `new Context({ leakyRules: true })` creates
  an isolated disqualified lookup context. Production code adds no new AST node
  creation.
- Render path: ruleset header capture now writes syntax directly into the
  existing writer again; it no longer calls selector `toString(...)` inside the
  capture.
- Helper/API surface: no new public helper. Internal
  `findVariableDeclarationLookup`/`findPropertyDeclarationLookup` were renamed
  to `find*DeclarationAssignmentLookup` so the wrapper-returning path is
  assignment-only by name and usage.
- Metadata mutations: child callable frame preparation uses the existing
  `getScopeFrame`/`prepareCallableLookupFrame` path. That is accepted only for
  the uncovered child-surface bridge path; it is not added to ordinary covered
  handle reads.
- Allocation changes: no new production arrays on hot reference reads.
  Test-only arrays record spy hits. The child-frame bridge path may materialize
  `frameResults` only after child-frame lookup finds callable hits that must be
  returned; covered exact misses return before the old broad child crawl.
- Rejected/deferred proof: the render-level scalar output-binding proof was
  removed because merge rendering did not evaluate the generated `Reference`.
  The no-frame reference-import callable miss still reaches the broad bridge and
  is reseeded with an exact fixture.
- Aggressive-review tokens: test-only arrays, spies, `try` blocks, and thrown
  errors restore instrumented methods or prove skipped surfaces are not read.
- Evidence: focused reference disqualification/handle matrix passed
  (`18` passed). Focused reference/mixin/import/ruleset lookup matrix passed
  (`101` passed). Stress profile on `scope-lookup-stress.less` reports no old
  `Rules.find`, registry, or searchChildren counters and direct counters:
  `declaration.cacheMiss: 7560`, `declaration.scope.v: 7560`,
  `declaration.childEntriesFamilySkip: 5400`,
  `declaration.childEntriesScanned: 1575`,
  `declaration.childEntryEntered: 1575`, and `declaration.framePrep: 1`.
  Current profile elapsed value (`236.57ms`) is profiler smoke only, not a
  speed claim. Final gates passed: stale lookup grep with no hits,
  `git diff --check`, focused eslint, `@jesscss/core` build,
  aggressive-cutting review, node-creation audit, `jess` build, and
  one-iteration hotpath smoke. Hotpath smoke values were `mixins-guards.less`
  `21.71ms` and `scope-lookup-stress.less` `81.57ms`; smoke only, not speed
  claims. `pnpm run verify:baseline -- --changed` expanded to full baseline
  because the upstream tracking ref was not local, then two baseline/Vitest
  worker trees in this worktree stuck in core tests; they were terminated and
  this remains the first task in the next queue.
