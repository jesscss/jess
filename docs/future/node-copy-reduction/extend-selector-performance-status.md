# Extend / Selector Performance Status

This file is the live performance snapshot for extend orchestration, selector
matching, and selector composition work.

The measurements here are scoped narrowly:

- the external benchmark numbers come from the local
  `less@5.0.0-alpha.2` benchmark runner in
  `/Users/matthew/git/worktrees/less.js/alpha/packages/less`
- they are being used to compare Jess revisions on the Less benchmark workload
- they are not a general “Jess is faster/slower than Less overall” claim
- they are also not a claim that extend/selector work explains total engine
  time by itself

Use:

- [HANDOFF.md](./HANDOFF.md) for the chronological experiment log
- [extends-performance-contract.md](./extends-performance-contract.md) for the
  enforceable work contract and gates
- [node-update-status.md](./node-update-status.md) for edge/cursor conversion
  status

## Current Kept Structural Win

Kept in `packages/core/src/tree/util/extend-roots.ts`:

- cache per-ruleset `RulesetTargetBaseInfo` inside each extend-root pass and
  reuse it across target lookup, signature calculation, and instruction
  application
- invalidate cached base info only for the changed ruleset subtree when an
  extend rewrite lands
- `getExactOwnSelectorFallbackTarget(...)` now reuses cached
  `RulesetTargetBaseInfo`
- `isInstructionVisibleForRoot(...)` now uses the cached visible-root set
  directly instead of paying the recursive `isSameOrDescendantRoot(...)`
  fast-path before the set lookup
- `processExtends(...)` now computes `targetInfoBefore` once per
  ruleset/instruction attempt, uses it for the before-signature, and threads
  it into `applyInstructionToRuleset(...)` instead of paying a second
  `getCachedTargetInfo(...)` lookup on the hot path

Important semantic correction:

- restore `packages/core/src/tree/ruleset.ts` to the `HEAD`
  parent-composition logic
- the broad collapse/render failures came from the local `ruleset.ts` perf
  edits, not from the `extend-roots.ts` cache keeps

Verified green on the kept stack:

- `packages/core/src/tree/__tests__/ruleset.test.ts`
- `packages/core/src/tree/__tests__/extend-eval-integration.test.ts`
- `packages/core/src/tree/util/__tests__/extend-work-contract.test.ts`
- `packages/core/src/tree/util/__tests__/selector-composition-work.test.ts`
- `packages/core/src/tree/util/__tests__/process-extends.test.ts`
- `packages/core/src/tree/util/__tests__/selector-match-unit.test.ts`
- `packages/core/src/tree/util/__tests__/extend-comment-handling.test.ts`
- `packages/core/src/tree/util/__tests__/extend-core-unit.test.ts`

## Current Kept Measurements

Direct built-package eval harness on real `benchmark.less`:

- after base-info cache keep: `1520.80ms`
- after fallback-base-info reuse keep: `968.81ms`
- after visibility-check simplification keep: `1089.45ms`
- after reusing the pre-signature `targetInfo` lookup: `814.95ms`
- `targetInfoBuilds`: `78971`
- `effectiveSelectorReads`: `22278`
- `selectorCompositionCalls`: `13008`
- `routePlansBuilt`: `83404`
- `groupRequirementsBuilt`: `192111`
- `selectorPlanCacheHits`: `265870`
- `selectorPlanCacheMisses`: `23037`
- `selectorPlanCacheBypassParent`: `79921`

External Less benchmark:

- after base-info cache keep:
  - `avg: 1183.86ms`
  - `min: 1159.86ms`
  - `max: 1207.85ms`
- after fallback-base-info reuse keep:
  - `avg: 865.99ms`
  - `min: 861.06ms`
  - `max: 870.93ms`
- after visibility-check simplification keep:
  - `avg: 863.47ms`
  - `min: 843.55ms`
  - `max: 883.39ms`
- after reusing the pre-signature `targetInfo` lookup:
  - `avg: 807.01ms`
  - `min: 793.74ms`
  - `max: 820.28ms`

Interpretation:

- this is the strongest kept result so far
- the win comes from reusing per-ruleset selector/parent context during extend
  orchestration, not from changing matching semantics
- the saved work is primarily:
  - `effectiveSelectorReads`
  - selector composition
  - route plans
  - group requirements
- `targetInfoBuilds` staying flat means the next frontier is still the
  remaining per-instruction target/signature work in `extend-roots.ts`

## Recent Rejected Adjacent Follow-Ups

All of these were semantically green and reverted because the real benchmark
regressed:

- `extend-roots.ts`
  - skipping the post-match signature recompute/store when
    `applyInstructionToRuleset(...)` matched but did not change the ruleset
  - direct harness: `919.99ms`
  - external benchmark: `859.98ms`
- `extend-roots.ts`
  - precomputing `target.valueOf()` / `extendWith.valueOf()` on each recorded
    extend instruction
  - direct harness: `928.39ms`
  - external benchmark: `912.55ms`
- `extend-roots.ts`
  - storing a cached `signature` string on each `TargetInfo`
  - direct harness: `832.43ms`
  - external benchmark: `819.93ms`
- `extend-roots.ts`
  - replacing the per-root `instructions.filter(...)` visibility build with a
    local push loop
  - direct harness: `862.72ms`
  - external benchmark: `825.87ms`
- `extend-roots.ts`
  - moving visible-instruction filtering ahead of the
    `context.renderKey` / `context.rulesContext` swap
  - direct harness: `840.33ms`
  - external benchmark: `814.47ms`

These matter because they show the current nearby seam is sensitive enough that
“obvious” allocation cuts are still false positives.

## Near-Term Priority Order

1. reduce the remaining per-instruction target/signature work in
   `extend-roots.ts` without breaking partial `:is(...)` or parent-aware
   semantics
2. recorded extend instruction / target facts for static selectors, but only
   after a representation is found that survives the kept cache + broad render
   gates
3. reduce clone/materialize work in `node-base.ts` and direct callers
4. do not churn `ruleset.ts` again without broad render proof
5. keep using the real benchmark counter harness plus the external Less
   benchmark before accepting further structural extend rewrites

## Real Benchmark Counter Snapshot

Measurement harness:

- `packages/jess/test/less/benchmark-extend-counters.test.ts`

Current snapshot on
`/Users/matthew/git/worktrees/less.js/alpha/packages/less/benchmark/benchmark.less`:

- elapsed eval time under the harness: `3130.10ms`
- `processExtendsCalls`: `1`
- `processExtendsPasses`: `2`
- `extendRootsVisited`: `3382`
- `rulesetsVisited`: `3364`
- `instructionsConsidered`: `87464`
- `recordedExtendInstructions`: `26`
- `recordedExtendTargetsMissingKeySetLibrary`: `26`
- `recordedExtendTargetsWithAmpersand`: `0`
- `recordedExtendTargetsNonStatic`: `0`
- `recordedExtendTargetsStaticNoAmpersand`: `26`
- `recordedExtendWithMissingKeySetLibrary`: `26`
- `recordedExtendWithAmpersand`: `0`
- `recordedExtendWithNonStatic`: `0`
- `targetInfoBuilds`: `78971`
- `selectorMatchCalls`: `137071`
- `selectorMatchCallsWithParent`: `76916`
- `selectorMatchCallsWithoutParent`: `60155`
- `selectorMatchFastRejectEligibleCalls`: `0`
- `selectorMatchCallsMissingFindKeySetLibrary`: `137071`
- `selectorMatchCallsMissingFindKeySetLibraryAmpersand`: `0`
- `selectorMatchCallsMissingFindKeySetLibraryNonStatic`: `0`
- `selectorMatchCallsMissingFindKeySetLibraryStaticNoAmpersand`: `137071`
- `selectorMatchCallsMissingTargetKeySetLibrary`: `2030`
- `effectiveSelectorReads`: `435770`
- `selectorCompositionCalls`: `280220`
- `routePlansBuilt`: `372417`
- `groupRequirementsBuilt`: `920230`
- `fastRejectChecks`: `0`
- `fastRejectRejects`: `0`
- `positiveMatches`: `106`
- `rewritesApplied`: `51`
- `nodeCreates`: `520270`
- `nodeClones`: `2579202`
- `nodeCopies`: `566962`
- `nodeInherits`: `2919406`
- `nodeValueOfCalls`: `453215`

Interpretation:

- extend is a real contributor on `benchmark.less`
- fast reject is not helping because it is not even eligible on the real
  extend-match calls
- all recorded extend targets on the real benchmark are static,
  non-ampersand selectors, but they are still missing `keySetLibrary`
- the direct blocker is not dynamic target shape; it is that static recorded
  extend targets still do not have a detached fact representation that fast
  reject can consume safely

## Gate Caveat

Do not cite
`packages/core/src/tree/__tests__/extend-less-fixtures.test.ts`
as a green keep gate unless you rerun it on the exact commit and record a green
result.

The Vitest benchmark-counter wrapper can still hit a Vite package-resolution
failure on built `jess`. Direct Node execution against built package entrypoints
is currently the reliable path for the real benchmark snapshot above.
