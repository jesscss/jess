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

Current hot evidence after the child-family fact pass:

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
- Variable/property/declaration handles still use broad `Rules.lookupVersion`.
- Reference lookup still allocates handle/access/context shapes around some
  typed paths.
- Callable namespace lookup still has direct-crawl bridges for child-surface,
  candidate, terminal, and reference-import cases.

Total remaining scope lives in `BINDING-LOOKUP-REMAINING.md`. Treat that file
as the burn-down inventory; treat the queue below as the next executable slice.

## Active Queue

Complete every item in this queue before committing the next pass.

1. [ ] Add explicit direct declaration visibility mode for imports/reference.
Scope: `DeclarationLookupStrategy`, reference imports, compose/import
boundaries, optional/public visibility, and direct child entries. Goal:
visibility facts travel with direct lookup rather than being rediscovered by
fallback behavior. Acceptance: focused import/reference declaration matrix plus
fallback spy.

2. [ ] Carry reference-import facts without recursive child-body scans. Scope:
`rulesMayContainReferenceImports(...)`,
`prepareScopeFrameDeclarationIndex(...)`, reference-mode child `Rules`, and
style imports. Goal: carry/adopt the fact once instead of recursively
rediscovering it during lookup prep. Acceptance: focused reference-import tests
plus traversal spy/counter.

3. [ ] Prove reference-import callable boundary for namespace lookups. Scope:
reference imports, namespace callable lookup, fallback frames, and covered
misses. Goal: reference-import uncertainty stays conservative without
poisoning covered frame/key misses. Acceptance: namespace/fallback spy tests.
Note: the previous sub-agent attempt was rejected because namespace-focused
tests failed with `No matching mixins found for '#theme.dark.navbar.colors'`.

4. [ ] Convert callable candidate uncertainty into caller-specific decisions.
Scope: `ScopeFrameCallableLookupResult.reason === 'candidate'`, namespace
lookup, terminal mixin-only lookup, and direct bridge gates. Goal: candidate
uncertainty routes through namespace logic instead of generic child-surface or
reference-import bridges. Acceptance: namespace candidate and terminal
mixin-only tests.

5. [ ] Make parameterized terminal namespace lookup mixin-only at the terminal
segment. Scope: recursive mixin-ruleset namespace lookup, ruleset container
lookup, and `terminalMixinOnly`. Goal: keep rulesets as namespace containers
but stop exact ruleset terminals when params require mixins. Acceptance:
mixin-ruleset calls-with-args fixtures and recursive namespace tests.

6. [ ] Make `setDefined` writes update only semantically current live/current
cells before occurrence fallback. Scope: `lookupScopeFrameVariable(...)`,
`setDefined`, declaration cells, loop/mixin live bindings, and readonly
propagation. Goal: stop using static declaration buckets as an assignment
registry. Acceptance: loop/mixin live-binding fixtures plus static
readonly/setDefined fixtures.

7. [ ] Implement property merge-chain occurrence slots. Scope: property
declaration occurrences, merge metadata, assignment normalization, and property
lookup tests. Goal: delete remaining filtered property fallback without adding
a second name registry. Acceptance: merge-chain fixtures resolve by direct
occurrence lookup.

8. [ ] Split declaration/property handle versioning by lookup key or prove
global versioning is required. Scope: `ReferenceRulesLookupHandle`,
`Rules.lookupVersion`, direct declaration cache keys, variable/property handle
writes, and dynamic-name promotion. Goal: affected declaration invalidation
does not invalidate unrelated declaration/property handles unless a semantic
dependency proves it must. Acceptance: handle stale/fresh tests for affected
and unaffected declaration keys.

9. [ ] Replace callable namespace remainder arrays with an offset/path view.
Scope: `collectKeyRemainder(...)`, `getCallableLookupKeyRemainder(...)`,
recursive namespace lookup, and reference callable handles. Goal: avoid
rebuilding remainder arrays/strings end-to-end after namespace semantics are
stable. Acceptance: repeated array-path lookup proof plus focused namespace
tests.

10. [ ] Split or delete handle-access object allocation. Scope:
`getRulesLookupHandleAccess(...)`, reference handle read/write sites, and
stress profile counters. Goal: remove transient access objects when scalar
locals or existing handle fields are simpler. Acceptance: measured/audited
before-after note; no speed claim without stable signal.
Note: the previous scalarization attempt was rejected and cut back because the
same namespace-focused tests failed.

11. [ ] Promote stable reference facts into a small `ReferencePlan` shape only
where it deletes repeated hot-path preparation. Scope: `_lookupStrategy`, key
normalization, static filters, handle access, and typed reference tests. Goal:
remove per-lookup prep without adding a generic wrapper ladder. Acceptance:
focused variable/property/function/callable handle tests and allocation audit.

12. [ ] Replace variable/declaration handle identity with frame plus slot/cell
identity where coverage is complete. Scope: `ScopeFrameVariableBindingHandle`,
`DirectDeclarationOccurrence`, reference handle read/write sites, and direct
lookup tests. Goal: keep cold materialization out of ordinary reference reads.
Acceptance: handle freshness tests and no new public materialization path.

13. [ ] Add lookup-identity versions to cells/current pointers before any
evaluated-value cache work. Scope: `BindingCell`, live/current binding writes,
variable/declaration handle freshness, and loop/mixin binding tests. Goal:
make current-cell identity explicit without caching evaluated values yet.
Acceptance: stale/fresh tests for current-cell writes and dynamic promotion.

14. [ ] Delete one covered leaky/fallback bridge end-to-end. Scope: choose a
single modeled bridge from variable live-only fallback, declaration fallback
frames, callable child/reference-import bridges, leaky rules, or `searchScope`
disqualification. Goal: prove one simple read cannot enter fallback after a
covered direct/frame miss. Acceptance: spy test plus focused fixture matrix.

15. [ ] Refresh profile, update `BINDING-LOOKUP-REMAINING.md`, and reseed the
next handoff queue. Scope: direct lookup profile, one-iteration hotpath smoke,
handoff, and burn-down inventory. Goal: record changed counters, remove any
completed inventory, explain unfinished items, and seed exactly 15 real next
tasks. Acceptance: profile output recorded; no speed claim from smoke.

## Unfinished-Item Exception

This implementation pass did not complete the full active queue. Completed:
pre-pass profile, declaration child-surface family facts, family-specific
child-entry skips, and callable cache/frame invalidation cleanup. Attempted and
rejected/cut back: reference-import/callable namespace work and handle-access
scalarization, because namespace-focused tests failed with
`ReferenceError: No matching mixins found for '#theme.dark.navbar.colors'`.
Items now queued as `1` through `15` remain because committing the green
child-family/invalidation slice was necessary after isolating and reverting the
failed side slices; continuing immediately would have mixed proven and unsafe
namespace changes in one dirty tree.

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

- Latest pass: carried declaration child-family facts onto direct child
  entries, skipped impossible variable/property child families during direct
  declaration lookup, and kept declaration/function-only registrations from
  clearing callable cache/frame state.
- Verdict: accepted as direct lookup work reduction and narrower invalidation,
  not as a wall-clock speed claim.
- New traversal: two production recursive loops in
  `rulesMayContainDeclarationSurface(...)` and
  `rulesMayContainVarDeclarationSurface(...)`. They run while collecting or
  registering direct declaration child entries, not per reference read. They
  were accepted because they carry child-family facts onto the existing child
  entry state and the direct profile drops `childEntriesScanned` from `10530`
  to `1575` and `childEntryEntered` from `11520` to `1575`.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: two private family-fact helpers in `rules.ts`, two
  private direct-lookup family guards, two private `Rules` booleans, and two
  optional child-entry fields. No public API added.
- Metadata mutations: `Rules` now carries
  `hasDeclarationChildSurface`/`hasVarDeclarationChildSurface`; child entries
  carry matching optional family facts. Callable-surface registration still
  mutates `callableLookupVersion`; declaration/function-only writes no longer
  clear callable cache/frame state.
- Allocation changes: no new hot reference object shapes. The rejected
  handle-access scalarization was cut back.
- Rejected/failed proof: callable namespace/reference-import side work and
  handle-access scalarization were rejected because
  `pnpm --filter @jesscss/core exec vitest src/tree/__tests__/reference.test.ts
  src/tree/__tests__/mixin.test.ts --run --testNamePattern
  "namespace|recursive namespace|ruleset namespace|reference imports check
  fallback|candidate" --reporter=dot` failed three namespace tests with
  `No matching mixins found for '#theme.dark.navbar.colors'`.
- Aggressive-review tokens: the gate flags the two production loops above.
  They are documented here and must be prosecuted again if later work can carry
  the same facts during adoption without recursion.
- Evidence: focused eslint passed for touched lookup files/tests. Focused
  reference/rules tests passed (`2` files, `11` passed, `213` skipped). The
  broader focused lookup gate passed (`8` files, `327` passed, `295` skipped).
  Stale registry/lookup wording search returned no matches. `git diff
  --check`, `@jesscss/core` build, `jess` build, aggressive review,
  node-creation audit, and one-iteration hotpath smoke passed. Node-creation
  audit remains `new-node: 306`, `with-surface: 39`, `derive: 30`,
  `copy-leaves: 28`. Stress profile on `scope-lookup-stress.less` reports
  `declaration.cacheMiss: 7560`, `declaration.childEntriesScanned: 1575`,
  `declaration.childEntryEntered: 1575`, and `Reference.evalNode` `6528` calls
  / `50.88ms`. One-iteration hotpath smoke is not a speed claim:
  `mixins-guards.less` `18.37ms`, `scope-lookup-stress.less` `72.58ms`.
