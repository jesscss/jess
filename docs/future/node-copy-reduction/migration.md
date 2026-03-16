# Node Copy Reduction Migration

## Purpose

This document turns the copy-reduction architecture into a staged refactor that can be
executed over time without leaving the tree in a broken or half-migrated state.

This is the execution-order document.

Use with:

- [README.md](./README.md)
- [subsystems.md](./subsystems.md)

## Core Refactor Rule

Do not do a flag-day rewrite.

Every stage must preserve a compatibility path where:

- existing code still works when no session is active
- old mutation-based eval remains valid outside the migrated slice
- the new sessionized path is introduced one vertical slice at a time

The migration pattern is:

1. add compatibility layer
2. route one subsystem through it
3. prove parity
4. expand

## Migration Strategy

There are three workstreams that can progress mostly independently:

1. `RenderMask` for comment/output-only copies
2. selector path-copy helpers for extend and generated selectors
3. `EvalSession` for mutation isolation and repeated evaluation

Only the third workstream is needed to stop clone-before-mutate for repeated imports.

Because extend internals are expected to be replaced, the `EvalSession` workstream should not
depend on any extend refactor.

## Stage 0: Measure and Freeze Assumptions

### Goal

Capture the current clone/copy and eval behavior before migration starts.

### Work

Add instrumentation behind a test/bench-only flag for:

- `clone()` call count
- `copy()` call count
- deep-clone count
- approximate nodes allocated by clone/copy
- import eval count per stylesheet
- repeated-import benchmark on large source trees

Record current behavior for:

- repeated imports with different `with` / `set` values
- dynamic declaration names
- dynamic mixin names
- scope lookup vs linear lookup
- call-time lookup

### Compatibility Rule

No behavior changes in this stage.

### Exit Criteria

- baseline numbers are recorded
- high-cost clone sites are known
- target tests for repeated imports and dynamic names exist

## Stage 1: Introduce `EvalSession` as an Optional Layer

### Goal

Add the session object without changing default eval behavior.

### Work

Introduce an `EvalSession` object that can hold:

- runtime state
- structural patches
- scope snapshots
- materialized nodes

Add it to `Context` as an optional field.

Do not make it mandatory.

### Compatibility Rule

When no `EvalSession` exists:

- all current node fields remain the source of truth
- all current mutation-based behavior remains unchanged

### Exit Criteria

- code can ask for the current session
- default behavior is unchanged when session is absent

## Stage 2: Add Session-Aware Read Helpers

### Goal

Stop reading runtime eval state directly from nodes in newly migrated code.

### Work

Introduce explicit helpers for runtime reads:

- `getParent(node, session)`
- `getSourceParent(node, session)`
- `getIndex(node, session)`
- `isPreEvaluated(node, session)`
- `isEvaluated(node, session)`
- `getRulesChildren(rules, session)`
- `getOptions(node, session)` if options become overlayable

Important rule:

- helpers must fall back to node fields when no session exists
- helpers must return identical behavior to node fields in compatibility mode

### Compatibility Rule

Do not replace all call sites at once.

Only newly migrated subsystems must use helpers.

### Exit Criteria

- read helpers exist
- at least one subsystem can use them with no behavior change

## Stage 3: Move Import Lookup and Configuration to Session Scope

### Goal

Stop cloning imported trees merely to inject/replace vars for lookup/configuration.

### Work

Use the session to represent:

- prepended injected declarations
- same-name replacements
- per-import lookup snapshots

Scope snapshots must be built from the session's logical view of a `Rules` scope.

This stage should cover:

- `with`
- `set`
- repeated configured imports of the same source tree
- dynamic declaration names
- dynamic mixin names

### Compatibility Rule

Only configured import lookup paths use session snapshots.

Actual eval may still use clone-backed mutation at this point.

### Exit Criteria

- configured imports do not need eager clone+rewrite for lookup
- repeated configured imports do not leak names across sessions
- import lookup parity tests pass

## Stage 4: Externalize Eval Runtime Flags and Ordering

### Goal

Stop using canonical nodes as storage for eval bookkeeping.

### Work

Move these fields into session runtime state for migrated paths:

- `preEvaluated`
- `evaluated`
- `index`

Anything that currently mutates these fields during import/sessionized evaluation must write to
the session instead.

Ordering must remain correct for:

- scope lookup
- linear lookup
- call-time lookup
- sort/closest-by-start behavior

### Compatibility Rule

Node fields remain readable for old paths.

New sessionized paths must prefer session runtime state.

### Exit Criteria

- import/sessionized eval no longer depends on mutating node-local `preEvaluated`, `evaluated`, or `index`
- linear lookup still passes under sessionized imports

## Stage 5: Externalize Parent and Source-Parent Traversal

### Goal

Allow the same canonical subtree to participate in multiple live eval sessions safely.

### Work

Move these runtime relationships into session state for migrated paths:

- `parent`
- `sourceParent`

Add session-aware ancestry traversal.

This is the most delicate stage because lookup semantics currently depend heavily on ancestry.

Focus first on:

- import/sessionized evaluation
- nested rules inside imported rulesets
- call-time lookup ancestry

### Compatibility Rule

Old non-sessionized paths still use node-local ancestry.

Sessionized paths must not mutate canonical ancestry.

### Exit Criteria

- repeated imports of the same canonical AST can have independent ancestry/runtime chains
- parent/sourceParent-dependent lookups still pass in migrated paths

## Stage 6: Redirect Structural Writes Through the Session

### Goal

Make sessionized eval stop mutating canonical `data`.

### Work

Introduce session-owned write APIs for migrated code:

- `setData`
- child insertion/removal/replacement
- self-replacement
- runtime option overrides if needed

This stage should start with the smallest hot set:

- `Rules`
- `Declaration` / `VarDeclaration`
- `Mixin`
- `Ruleset`
- `AtRule`

Do not start with every node type.

### Compatibility Rule

Node mutation APIs remain valid for old paths.

Migrated import/sessionized paths must go through session writes instead.

### Exit Criteria

- import/sessionized eval no longer requires eager subtree clone before structural edits
- canonical imported tree is still reusable after evaluation

## Stage 7: Add Copy-On-Write Materialization

### Goal

Create concrete node trees only for touched paths, not entire subtrees.

### Work

When a migrated path needs a concrete node:

1. materialize the touched node
2. materialize ancestors on the rewritten path
3. preserve untouched descendants as canonical until materialization is required

Materialization boundaries must be explicit.

### Initial Materialization Boundaries

Start with:

- final import result returned to caller
- mixin output rules
- detached ruleset unlock output

Do not materialize earlier than necessary.

### Compatibility Rule

Materialized output must be behaviorally identical to current clone-based output.

### Exit Criteria

- touched paths materialize correctly
- untouched branches do not deep-clone
- repeated imports reuse canonical AST safely

## Stage 8: Reinterpret `preserveOriginalNodes`

### Goal

Change the meaning of source-protection from eager cloning to session protection.

### Work

For migrated paths only:

- `preserveOriginalNodes = true` means "write to session, not source node"
- not "clone subtree before mutation"

This should be done only after runtime state and structural writes are sessionized.

### Compatibility Rule

Old paths may still interpret `preserveOriginalNodes` as clone-before-mutate until they are migrated.

The codebase may temporarily support both semantics depending on entrypoint.

### Exit Criteria

- sessionized import evaluation no longer depends on subtree clone as the protection mechanism

## Stage 9: Expand Beyond Imports

### Goal

Apply the same sessionized eval model to other high-clone areas.

### Expansion Order

Recommended order:

1. repeated imports
2. detached rulesets
3. mixin call evaluation
4. call-time lookup / lazy nested lookups
5. broader eval replacement paths

Keep extend-specific rewrite work separate.

### Compatibility Rule

Each expansion must preserve parity before moving to the next subsystem.

### Exit Criteria

- clone-heavy eval paths shrink over time without requiring a global rewrite

## Stage 10: Remove Obsolete Clone-Backed Paths

### Goal

Delete compatibility code only after sessionized behavior is proven stable.

### Work

Remove:

- eager clone-for-protection code in migrated entrypoints
- obsolete registry rebuild paths that existed only for clone-based rewriting
- temporary dual-path helper logic that is no longer used

### Exit Criteria

- migrated paths no longer rely on old clone-backed protection
- instrumentation confirms meaningful allocation reduction

## Guardrails

The following rules apply throughout the migration:

1. Never migrate read and write semantics in the same broad sweep.
2. Always introduce read helpers before redirecting writes.
3. Keep materialization explicit; never let it become an accidental side effect.
4. Do not make extend refactors a prerequisite for sessionized import eval.
5. Any stage that changes lookup semantics must add parity tests before rollout.

## Validation Gates Per Stage

Every stage must pass:

- focused import/configuration tests
- repeated-import isolation tests
- dynamic-name tests

When the stage touches lookup ancestry or ordering, also pass:

- declaration scope lookup tests
- linear lookup tests
- call-time lookup tests
- detached ruleset lookup tests

When the stage touches materialization, also pass:

- render parity tests
- source provenance assertions using `sourceNode`
