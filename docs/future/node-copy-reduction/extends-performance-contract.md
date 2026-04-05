# Extend / Selector-System Performance Contract

This is the contract for extend, selector matching, and selector composition
performance work.

Treat it as a hard constraint, not a style preference.

## Purpose

This contract exists because semantic tests alone are not enough.

Extend work can stay green while silently adding:

- global rescans
- planner work on reject paths
- parent composition before candidate survival
- clone/materialize churn
- GC-heavy short-lived arrays, maps, selector nodes, and strings

Future extend work must prove both:

- semantic correctness
- reduced or bounded work

## System Model

The intended system shape is:

- canonical authored selector facts are the first matching surface
- effective selector is a current-placement view, not a universal preprocessing
  step
- extend target facts are built once per recorded instruction
- selector composition is a downstream boundary operation
- rewrite/materialization is the final step after a positive surviving match

The intended runtime order is:

1. build selector facts once per candidate ruleset
2. build extend-target facts once per recorded instruction
3. run cheap disjoint fast reject first
4. only then build route/group match plans
5. only then compose selector routes if the surviving candidate actually needs
   parent-aware matching
6. only then rewrite/materialize the affected selector or ruleset
7. only then schedule follow-up work for chained extends

## Architectural Red Lines

These are hard failures for extend-path work:

- no whole-world rescans unless a work queue proves they are required
- no planner work before fast reject
- no selector composition before candidate survival
- no clone/copy/materialize on reject paths
- no `valueOf()`-driven negative rejection
- no generic `.get(...)` on canonical hot paths
- no preserving wrapper/helper machinery because old tests tolerated it
- no accepting “tests passed” when the runtime shape added a new class of work

## Selector Composition Contract

`getEffectiveSelector(...)` and `composeSelectorRouteWithParent(...)` are
boundary operations.

They are allowed only when:

- the candidate survived fast reject
- the candidate actually needs parent-aware composition

They are not allowed as:

- global preprocessing for every ruleset
- per-instruction preprocessing before candidate survival
- a substitute for selector facts

Matching should consume selector facts first and composed selectors only when
facts are not enough.

## GC / Allocation Contract

Extend-path work must prefer:

- selector facts
- compact plans
- sparse patches

over:

- rebuilt selector node graphs
- short-lived arrays and maps in hot loops
- repeated stringification
- clone/materialize/create/inherit churn

On extend paths, `clone`, `copy`, `create`, `inherit`, and `valueOf` are
presumed guilty until justified by a concrete surviving-match need.

## Acceptance Rule

A keep requires all three:

- semantic green
- work-contract green
- benchmark non-regression

Any two of the three are not enough.

## Required Work Counters

Extend-path changes must use and report these counters:

- `processExtendsCalls`
- `processExtendsPasses`
- `extendRootsVisited`
- `rulesetsVisited`
- `instructionsConsidered`
- `visibleInstructionListsBuilt`
- `targetInfoBuilds`
- `effectiveSelectorReads`
- `selectorCompositionCalls`
- `routePlansBuilt`
- `groupRequirementsBuilt`
- `fastRejectChecks`
- `fastRejectPasses`
- `fastRejectRejects`
- `positiveMatches`
- `rewritesApplied`
- `rulesetsChanged`
- `chainedFollowupEnqueues`
- `nodeCreates`
- `nodeClones`
- `nodeCopies`
- `nodeInherits`
- `nodeValueOfCalls`

## Required Work Gates

Work characterization must cover at least:

- no-extend fixture
- disjoint extend fixture
- single exact extend
- single partial extend through `:is(...)`
- chained extend
- nested selector / parent-composition with no surviving extend match

These tests must assert non-work, not just output:

- no planner work on no-extend
- no rewrite on reject
- bounded passes on chained micro fixtures
- bounded selector composition on disjoint nested fixtures

## Review Checklist

Any future extend or selector-performance PR must answer:

1. What gets rejected before planning?
2. What gets planned once vs repeatedly?
3. What gets composed only after survival?
4. What gets rewritten only on positive match?
5. Which counters go down?
6. Which semantic tests prove correctness?
7. Which work-characterization test proves we did less work?

If the change cannot answer those questions, it is not ready.
