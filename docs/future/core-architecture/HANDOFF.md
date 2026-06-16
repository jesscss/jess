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

Current hot evidence:

- `scope-lookup-stress.less` still reports
  `declaration.cacheMiss: 16560`,
  `declaration.childEntryEntered: 11520`, and
  `declaration.childEntriesScanned: 10530`.
- Function handles are per-key; callable handles use
  `Rules.callableLookupVersion`.
- Variable/property/declaration handles still use broad `Rules.lookupVersion`.
- Reference lookup still allocates handle/access/context shapes around some
  typed paths.
- Callable namespace lookup still has direct-crawl bridges for child-surface,
  candidate, terminal, and reference-import cases.

Total remaining scope lives in `BINDING-LOOKUP-REMAINING.md`. Treat that file
as the burn-down inventory; treat the queue below as the next executable slice.

## Active Queue

Complete every item in this queue before committing the next pass.

1. [ ] Take a fresh direct-lookup profile baseline for the next pass. Scope:
`scripts/profile-less-benchmark.mjs`, `scope-lookup-stress.less`, and direct
lookup counters. Goal: know whether the pass moved child-entry scans, cache
misses, or `Reference.evalNode`. Acceptance: baseline counters recorded before
the first semantic edit.

2. [ ] Redesign declaration child-surface family facts around
registration-complete state. Scope: `registerNode(...)`,
`collectDirectDeclarationChildEntries(...)`, child `Rules` adoption, import
boundaries, and `setDefined` registration. Goal: know whether a child can
contain variable and/or property hits before allocating/entering child entries.
Acceptance: child-surface tests plus `"doesn't preserve readonly later"`.

3. [ ] Replace declaration child-entry scans with family-specific carried
facts where possible. Scope: `findWithinScopeSurface(...)`,
`directDeclarationChildEntries`, and `canEnter*ForLookup(...)`. Goal: simple
exact variable/property misses skip child surfaces that cannot contain that
family. Acceptance: direct lookup counter comparison for
`childEntriesScanned`/`childEntryEntered`.

4. [ ] Add explicit direct declaration visibility mode for imports/reference.
Scope: `DeclarationLookupStrategy`, reference imports, compose/import
boundaries, optional/public visibility, and direct child entries. Goal:
visibility facts travel with direct lookup rather than being rediscovered by
fallback behavior. Acceptance: focused import/reference declaration matrix plus
fallback spy.

5. [ ] Carry reference-import facts without recursive child-body scans. Scope:
`rulesMayContainReferenceImports(...)`,
`prepareScopeFrameDeclarationIndex(...)`, reference-mode child `Rules`, and
style imports. Goal: carry/adopt the fact once instead of recursively
rediscovering it during lookup prep. Acceptance: focused reference-import tests
plus traversal spy/counter.

6. [ ] Prove reference-import callable boundary for namespace lookups. Scope:
reference imports, namespace callable lookup, fallback frames, and covered
misses. Goal: reference-import uncertainty stays conservative without
poisoning covered frame/key misses. Acceptance: namespace/fallback spy tests.

7. [ ] Convert callable candidate uncertainty into caller-specific decisions.
Scope: `ScopeFrameCallableLookupResult.reason === 'candidate'`, namespace
lookup, terminal mixin-only lookup, and direct bridge gates. Goal: candidate
uncertainty routes through namespace logic instead of generic child-surface or
reference-import bridges. Acceptance: namespace candidate and terminal
mixin-only tests.

8. [ ] Make parameterized terminal namespace lookup mixin-only at the terminal
segment. Scope: recursive mixin-ruleset namespace lookup, ruleset container
lookup, and `terminalMixinOnly`. Goal: keep rulesets as namespace containers
but stop exact ruleset terminals when params require mixins. Acceptance:
mixin-ruleset calls-with-args fixtures and recursive namespace tests.

9. [ ] Make `setDefined` writes update only semantically current live/current
cells before occurrence fallback. Scope: `lookupScopeFrameVariable(...)`,
`setDefined`, declaration cells, loop/mixin live bindings, and readonly
propagation. Goal: stop using static declaration buckets as an assignment
registry. Acceptance: loop/mixin live-binding fixtures plus static
readonly/setDefined fixtures.

10. [ ] Implement property merge-chain occurrence slots. Scope: property
declaration occurrences, merge metadata, assignment normalization, and property
lookup tests. Goal: delete remaining filtered property fallback without adding
a second name registry. Acceptance: merge-chain fixtures resolve by direct
occurrence lookup.

11. [ ] Split declaration/property handle versioning by lookup key or prove
global versioning is required. Scope: `ReferenceRulesLookupHandle`,
`Rules.lookupVersion`, direct declaration cache keys, variable/property handle
writes, and dynamic-name promotion. Goal: affected declaration invalidation
does not invalidate unrelated declaration/property handles unless a semantic
dependency proves it must. Acceptance: handle stale/fresh tests for affected
and unaffected declaration keys.

12. [ ] Remove duplicate callable cache/frame invalidation writes after
`callableLookupVersion` split. Scope: `registerNode(...)`,
`callableLookupCache`, `_scopeFrame.callable*` flags, and callable handle
tests. Goal: callable-surface writes invalidate exactly the callable state
they must, while declaration-only writes do not pay callable cache churn.
Acceptance: callable handle tests plus focused callable/frame coverage tests.

13. [ ] Replace callable namespace remainder arrays with an offset/path view.
Scope: `collectKeyRemainder(...)`, `getCallableLookupKeyRemainder(...)`,
recursive namespace lookup, and reference callable handles. Goal: avoid
rebuilding remainder arrays/strings end-to-end after namespace semantics are
stable. Acceptance: repeated array-path lookup proof plus focused namespace
tests.

14. [ ] Split or delete handle-access object allocation. Scope:
`getRulesLookupHandleAccess(...)`, reference handle read/write sites, and
stress profile counters. Goal: remove transient access objects when scalar
locals or existing handle fields are simpler. Acceptance: measured/audited
before-after note; no speed claim without stable signal.

15. [ ] Refresh profile and reseed from `BINDING-LOOKUP-REMAINING.md`. Scope:
direct lookup profile, one-iteration hotpath smoke, handoff, and remaining
inventory. Goal: record what changed, explain any unfinished items, and seed
the next 15 real tasks from the burn-down inventory. Acceptance: profile
output recorded; no speed claim from one-iteration smoke.

## Unfinished-Item Exception

This docs-only scoping pass did not implement the active queue. It corrected
the remaining-work model, added `BINDING-LOOKUP-REMAINING.md`, and reseeded the
next active queue from dependency order. Immediate continuation stopped because
the user's request was to scope and update guidance before more implementation.

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

- Latest pass: split parent-frame callable prep from variable lookup, kept
  `setDefined` live-binding probing off implicit scope-frame creation, and
  versioned callable handles on `Rules.callableLookupVersion`.
- Verdict: accepted as lookup slimming and handle-invalidation reduction, not
  as a speed claim.
- New traversal: none in production. Tests add spies around `getScopeFrame`,
  `Rules.value`, and public lookup methods.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: no public API added. `Rules.callableLookupVersion` is a
  private invalidation lane for callable handles.
- Metadata mutations: callable-surface registration now mutates
  `callableLookupVersion`; declaration/function-only writes do not.
- Allocation changes: variable lookup no longer asks auto-wired parent frames
  for callable coverage, and `setDefined` fallback variable lookup runs with
  `includeLiveBindings: false` so it does not build scope frames to discover
  fallback declarations.
- Rejected/failed proof: reference-import recursive fact carrying remains
  unfinished; the current recursive scan still crosses registration/import
  semantics and needs a focused pass.
- Aggressive-review tokens: the gate found no production danger token in this
  diff. Test-only tokens are `new JsFunction`, three spy `try` blocks, and the
  `callableCoveragePrep` spy array.
- Evidence: focused eslint passed for touched lookup files/tests. Focused
  reference/rules tests passed (`2` files, `11` passed, `213` skipped). The
  broader focused lookup gate passed (`8` files, `327` passed, `295` skipped).
  Stale registry/lookup wording search returned no matches. `git diff
  --check`, `@jesscss/core` build, aggressive review, node-creation audit, and
  `jess` build passed. Node-creation audit remains `new-node: 306`,
  `with-surface: 39`, `derive: 30`, `copy-leaves: 28`. Stress profile on
  `scope-lookup-stress.less` reported direct declaration counters unchanged at
  `declaration.cacheMiss: 16560`, `declaration.childEntryEntered: 11520`,
  `declaration.childEntriesScanned: 10530`; `Reference.evalNode` was `6528`
  calls / `71.14ms`. One-iteration hotpath smoke is not a speed claim:
  `mixins-guards.less` `28.44ms`, `scope-lookup-stress.less` `98.72ms`.
