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
Current pass collapses variable frame binding lookup into one helper with an
explicit live-only mode, makes cached direct declaration match state readonly at
the type boundary, and lets fully indexed callable child surfaces append
current-key hits once before skipping recursion when no relevant descendants
exist.
Current pass lets static variable lookup handles store binding-cell identity
instead of a materialized runtime value, copies direct declaration cache records
at the cache boundary, and lets frame-covered mixin namespace misses stop before
`findMixinsFast(...)`.
Current pass carries owner frames on variable binding hits so handles validate
parent/fallback cell replacement, stores property/declaration handles as
validated occurrence records, and lets ruleset namespace lookup use frame facts
for the first-segment mixin ambiguity check.
Current pass lets reusable variable handles finalize and raw-render directly
from binding cells, makes declaration occurrence handles validate owner lookup
version for child/source-order mutation, and proves reference imports keep
callable frame miss coverage uncovered.
Last full gate smoke was usable but not a speed claim:
`mixins-guards.less` `24.18ms`, `scope-lookup-stress.less` `78.62ms`.

## Active Queue

Complete every item in this queue before committing the next pass.

7gb. [ ] Promote declaration occurrence slots into direct lookup cache records.
Scope: `directDeclarationLookupCache`, declaration bucket entries,
`DeclarationOccurrenceHandle`, owner lookup version, source-order starts, and
public/optional match selection.
Goal: store reusable occurrence identity at the direct lookup cache boundary so
reference handles and direct lookup share one occurrence model instead of each
carrying partial node/index facts.
Acceptance: source-order, public/optional, candidate, semantic-filter, and
child owner mutation tests pass; no new registry-like maps; lint, builds,
aggressive review.

7gc. [ ] Collapse variable binding result and handle shapes.
Scope: `RuntimeVarBindingWithCell`, `ScopeFrameVariableBindingHandle`,
`lookupScopeFrameVariableBinding(...)`, assignment/raw render/finalization, and
snapshot/live variable lanes.
Goal: remove the remaining temporary runtime-binding wrapper from static
frame-backed variable lookup so binding cell identity is the shared live result
model, not an intermediate object.
Acceptance: variable eval/render/raw lookup stays live, assignment and readonly
semantics hold, async definition rules context tests pass, lint, builds,
aggressive review.

7gd. [ ] Callable frame facts cover guarded namespace candidates without crawl.
Scope: callable buckets, guard/candidate matching, mixin-ruleset namespace
resolution, `terminalMixinOnly`, `prepareCallableLookupFrame(...)`, and
`findMixinNamespacePathFast(...)`.
Goal: use frame facts for guarded namespace hit/miss decisions where candidate
metadata is already known, while leaving true dynamic guard cases uncovered.
Acceptance: guarded callable, recursive namespace, mixin-ruleset with args,
terminal mixin-only, import/reference visibility, lint, builds, aggressive
review.

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

- Latest pass: direct variable handle finalization, declaration occurrence
  owner invalidation, and callable namespace/import frame facts.
- Verdict: accepted as binding/lookup cleanup, not as a speed claim.
- New traversal: no new parent/source walks. Variable handle reads check the
  owner frame's current cell for the static key and finalization reads the
  existing cell directly. Ruleset namespace lookup asks an existing frame for
  first-segment mixin ambiguity before falling back to direct crawl only when
  the frame cannot cover the miss.
- New node/materialization: no nodes. No AST wrappers or copied nodes.
- Render path: unchanged.
- Helper/API surface: `lookupScopeFrameVariable(...)` hit results now carry the
  owner frame. `DeclarationOccurrenceHandle` validates static property and
  declaration handles against parent/index and owner lookup version before
  reuse. Small binding-handle accessors replace per-read runtime binding
  object construction for reusable variable handles.
- Metadata mutations: no parent/source mutation. `sourceNode` is carried through
  variable and declaration handles as existing binding identity; no source or
  parent fields are mutated.
- Allocation changes: variable and declaration handle writes allocate small
  identity records. Reusable variable handle reads no longer allocate a
  runtime binding wrapper; raw render reads the current cell value. Test-only
  `fastPathHits` arrays and monkey-patch `try/finally` blocks prove direct
  bridge use or skip. The handle `returnVal` object replaces cached declaration
  nodes with explicit occurrence identity. Ruleset namespace frame misses can
  avoid the mixin ambiguity direct crawl, while reference imports keep miss
  coverage false.
- Evidence: focused lint passed. Focused lookup suite passed (`4` files,
  `122` passed, `245` skipped). Larger focused lookup suite passed (`9` files,
  `359` passed, `238` skipped). `pnpm --filter @jesscss/core build` passed
  with the existing `js-expr.ts` direct-eval warning. Residue grep found no
  matches; `git diff --check`, `pnpm run verify:aggressive-cutting-review`,
  `pnpm run audit:node-creation`, and `pnpm --filter jess build` passed.
  Smoke only: `mixins-guards.less` `24.18ms`,
  `scope-lookup-stress.less` `78.62ms`.
