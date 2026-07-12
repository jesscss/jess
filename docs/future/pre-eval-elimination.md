# Eliminating `preEval`

## Goal

Shrink evaluation down to one real pass: `eval()`.

The desired future shape is not "do the same work inside `evalNode()`". It is:

- remove the mandatory tree-wide `preEval()` phase
- keep any required setup local and incremental
- let `Rules.evalNode()` drive registration and evaluation together
- reduce retries to the smallest set of nodes that are actually blocked

One important guardrail for the later buffered-render model:

- do **not** replace eval with direct string emission that bypasses the
  evaluated-node boundary entirely
- do **not** build and retain a whole evaluated tree before serialization

The intended shape is local and streaming:

1. evaluate one node in context
2. produce the immediate evaluated/derived node for that step
3. allow a visitor/rewrite hook to replace it
4. serialize it immediately

So "single pass" means "no retained eval tree", not "no intermediate evaluated
node exists at all".

This note is exploratory. It is not an implementation plan.

## Why `Rules` Is The Choke Point

Today, `Rules.evalNode()` in `packages/core/src/tree/rules.ts` assumes the tree
has already been prepared by `Rules.preEval()`.

That preparation currently includes several separate concerns:

- cloning / root setup / rules-context setup
- child index assignment
- root and extend-root registration
- static-name registration
- multi-pass retry for dynamic declaration names
- depth-first child `preEval()` for nested `Rules`, `Ruleset`, and `AtRule`

Only after that does `Rules.evalNode()` build its priority queue and run actual
evaluation.

That means Jess pays for:

- one pass to discover what can be registered
- one pass to actually evaluate
- extra retries inside `preEval()` before the eval queue even starts

If `preEval` goes away, `Rules.evalNode()` has to become the single
orchestrator for all of that.

## Current `preEval` Responsibilities

### Root And Extend Setup

`Rules.preEval()` currently decides:

- what `context.root` is
- when to register the main root in `extendRoots`
- when a nestable at-rule body needs to become the current extend root
- when a clone must replace the original for registry correctness

That setup is real, but it does not need to live in a separate semantic pass.

### Indexing And Source Order

`Rules.preEval()` also assigns stable child indices up front.

That is not just bookkeeping. The important contract is the node's own `.index`
property, not registry insertion order.

The current runtime uses `.index` for:

- linear lookup start positions in `Reference`
- `DeclarationRegistry._findClosestByStart()` when choosing the nearest prior
  declaration
- anchoring "find the closest earlier declaration" semantics even when nodes
  resolve out of order
- preserving the source position of a node when a resolved replacement inherits
  the original node's identity

So if `preEval` goes away, index assignment still needs to happen early inside
`Rules.evalNode()`, before any linear lookups can run.

That does **not** mean evaluation itself has to become source-ordered.

The cleaner model is:

- assign `.index` from the current child array in source order as an initial
  setup step
- build the eval queue after those indices exist
- evaluate in whatever priority order the queue needs
- preserve `.index` when a node is replaced by its resolved/evaluated form
- assign a derived source position to nodes that are materialized later
  (imports, call results, mixin outputs) based on the source position that
  emitted them

So the rule is "source position must exist before lookup", not
"evaluation must happen in source order".

That makes indexing a setup concern, not a reason to keep a separate pass.

### Registration Before Evaluation

`_multiPassPreEval()` currently tries to make the tree lookup-ready before
evaluation starts:

- register declarations, mixins, and rulesets with static names
- retry dynamic declaration names up to a fixed cap
- attempt other dynamic names once
- recurse into child rules so nested rulesets are registered before extends run

This is the main reason `preEval()` exists today.

### Node-Specific Structural Prep

Several nodes currently depend on `preEval()` for local rewrites:

- `Ruleset.preEval()` composes selectors, stores `ownSelector`, registers the
  ruleset to the current extend root, and eagerly `preEval`s child `Rules`
- `Declaration.preEval()` resolves interpolated property names and normalizes
  assignment operators into reference-based value forms
- `AtRule.preEval()` resolves interpolated at-rule names, queues top-level
  `@import`, and eagerly `preEval`s child `Rules`
- `Mixin.preEval()` resolves interpolated mixin names and mutates body
  visibility rules

Those are the specific surfaces that would need to be split into
"registration-time" work versus "actual evaluation" work.

## Better Shape: Registration As Part Of `eval`

The future model should be:

- `Rules.evalNode()` does one shallow setup step
- nodes register themselves when they become lookup-ready
- unresolved names stay pending instead of forcing a whole-tree pre-pass
- evaluation requeues only nodes that gained new prerequisites

That implies a new contract:

- registration is no longer proof that a node was pre-evaluated
- registration only means "this node's lookup identity is now stable enough to
  index"
- child traversal happens because evaluation reached that child, not because a
  global prep phase touched everything first

## A Possible `Rules.evalNode()` Shape

One plausible future structure:

1. Do non-semantic setup once.
   Set `context.root`, establish the correct extend root, snapshot context, and
   assign child indices before any registration or queue scheduling.

2. Build one queue from the current children.
   This can reuse the existing priority queue idea in `_buildEvalQueue()`.

3. Classify registrable children into:
   - immediately registerable
   - pending-name
   - non-registrable

4. Evaluate the queue.
   Before or after a node evaluates, attempt registration if that node's lookup
   identity is now stable.

5. When a node resolves a blocked name, requeue only the affected pending nodes.

6. Run final root-only work once.
   This includes `processExtends(context)` and any final output-order
   normalization that still belongs in eval.

The key change is that registration becomes incremental state inside
`Rules.evalNode()`, not a completed prerequisite from another pass.

## What Would Replace `_multiPassPreEval()`

`_multiPassPreEval()` is currently doing two jobs:

- eager registration of static names
- speculative retries for dynamic names

A future replacement should be narrower:

- keep a `pendingRegistrations` set per `Rules`
- never register a partial or speculative lookup key
- attempt registration only when a node's lookup identity is fully resolved
- track why a node is blocked, if that can be expressed cheaply
- re-attempt blocked nodes only when one of those causes changes

That would be better than the current fixed retry loop for dynamic declaration
names.

### Simple Version

The simplest version does not need a full dependency graph:

- static-name nodes register immediately
- dynamic-name nodes stay pending
- after each successful declaration evaluation, retry only pending-name nodes in
  the same `Rules` that might now be fully resolvable
- stop when a full local sweep makes no progress

That is still iterative, but it is much smaller than
"whole-tree preEval, then whole-tree eval".

### Better Version

A stronger version would distinguish:

- nodes blocked on declaration names
- nodes blocked on declaration values
- nodes blocked on selector composition context
- nodes blocked on import materialization

Then `Rules.evalNode()` could wake up only the relevant bucket when something
changes.

## Likely Node Splits

Removing `preEval()` probably means splitting current node behavior into smaller
hooks, even if they stay private.

### `Ruleset`

Current `Ruleset.preEval()` mixes together:

- selector composition against parent selector frames
- extend-root registration
- child `Rules` traversal

A future split could look more like:

- `prepareSelectorIdentity(context)`
  Enough work to know whether the ruleset can be indexed for mixin / extend
  lookup.
- `enterRulesetScope(context)`
  Push selector / frame state only while evaluating the ruleset body.
- `evaluateRulesetBody(context)`
  Evaluate nested `Rules` when the queue reaches them.

That would keep selector prep local without requiring a full depth-first
pre-pass.

### `Declaration`

Current `Declaration.preEval()` is mostly:

- resolve interpolated property name
- normalize assignment operators into explicit reference/value structures

That likely wants to become:

- one-time lookup-key preparation for registration
- then normal value evaluation in `evalNode()`

If assignment normalization is truly semantic and not just registration prep, it
may belong in an early step inside `evalNode()` instead.

### `AtRule`

Current `AtRule.preEval()` handles three different concerns:

- interpolated at-rule names
- child `Rules` traversal
- top-level `@import` collection for render ordering

Those should probably separate.

The promising direction is:

- keep only the minimum needed to establish lookup identity during eval
- move `@import` hoisting fully to serialization-time
- treat child-rule traversal as a consequence of evaluating the at-rule body,
  not as a prerequisite walk

### `Mixin`

`Mixin.preEval()` mostly resolves name identity and mutates body visibility.

That should be one of the easier surfaces to fold into registration-time work
inside `Rules.evalNode()`.

## Override-By-Override Treatment

Not every `preEval` override should survive as a new hook.

The useful split is:

- identity / registration prep that still needs to happen somewhere
- serializer-facing side effects that should move out of eval
- clone / recurse stubs that should simply disappear with the phase

### `Rules`

Keep, but shrink radically.

This is the one override that really does need a replacement shape, because it
currently owns orchestration:

- root setup
- extend-root setup
- child indexing
- pending registration management
- eval queue scheduling

Indexing is especially important here: the future model still needs a stable
source-position identity on the node itself for linear lookup semantics,
without relying on registry insertion order or a separate pre-pass.

The future replacement should live inside `Rules.evalNode()`, not as a second
tree pass.

### `Ruleset`

Keep only the identity-relevant subset.

`Ruleset.preEval()` is currently overloaded. The likely split is:

- keep selector-identity preparation near registration
- keep extend-root registration tied to the point where the selector identity is
  known
- move body traversal into normal eval flow

This is one of the few overrides that probably still needs an explicit
"prepare identity" concept.

### `Declaration`

Keep a small registration-prep step, not a full `preEval`.

The two important behaviors are:

- interpolated property names affect lookup identity
- assignment normalization rewrites value semantics

The likely treatment is:

- resolve the property key before registration, and skip registration entirely
  while it is still unresolved
- move assignment normalization into an early, one-time step in
  `Declaration.evalNode()` unless a lookup path truly needs it sooner

This should become local node preparation, not part of a tree-wide pass.

### `AtRule`

Split aggressively.

`AtRule.preEval()` currently mixes:

- at-rule name identity
- child traversal
- `@import` hoist collection

Those should likely become three separate concerns:

- name resolution stays near eval if lookup identity depends on it
- child traversal becomes ordinary body evaluation
- `@import` ordering moves to serialization

For root-only at-rules and nestable wrappers, the important part is preserving
correct extend-root and frame semantics without forcing an eager recursive walk.

### `Mixin`

Mostly keep as registration prep.

`Mixin.preEval()` is close to the kind of small hook that still makes sense in a
preEval-free model:

- resolve interpolated mixin name if needed
- establish body visibility defaults

It does not need a deep traversal of its body, and it already avoids one today.
This likely becomes a cheap "prepare callable identity" step used by
`Rules.evalNode()` when registering mixins.

### `Any`

Do not preserve as a general pre-pass hook.

`Any.preEval()` only has one meaningful side effect today:

- role=`charset` records `context.currentCharset` and returns `Nil`

That is not a general evaluation concern. It is output-order bookkeeping.

Likely future treatment:

- handle `@charset` collection at root render/setup time, or
- handle it as a tiny root-level scan for leading charset nodes

Either way, this should not justify a global `preEval` contract for all nodes.

### `List`

Probably delete as a distinct phase hook.

`List.preEval()` mostly:

- clones
- marks pre-evaluated
- recursively `preEval`s children

That is container mechanics, not standalone semantics.

In a preEval-free design, lists should usually just:

- evaluate children when a consumer evaluates the list, or
- participate in a narrower "prepare identity" walk only when used in a place
  that actually needs lookup identity before full eval

The important gotcha is selector-bearing lists. If any current caller relies on
`List.preEval()` to recursively stabilize selector identity before registration,
that caller should ask for selector preparation explicitly instead of depending
on generic list recursion.

### `SelectorCapture`

Probably fold into selector preparation.

`SelectorCapture.preEval()` just forwards preparation to its wrapped selector.
That suggests it should not remain an independently important phase boundary.

Future treatment is likely:

- if a caller needs selector identity, it prepares the underlying selector
- otherwise normal eval is enough

### `Collection`

Delete the hook.

`Collection.preEval()` is effectively a mark-only clone step. Collections are
already lazy and `Collection.evalNode()` is a no-op.

That means `Collection` is a good example of a node whose `preEval` override
exists only because the phase exists.

### Control Nodes

Delete the hook.

The control-node override in `packages/core/src/tree/control.ts` is also just a
mark-only clone step.

Loops and directives do real work in `evalNode()`, not `preEval()`. They do not
participate in registration-by-name, and they should not require a separate prep
phase.

The only real concern is queue placement:

- control nodes should stay in the eval scheduler at the right priority
- any rules they emit should register as they materialize

That is an eval-scheduler problem, not a reason to preserve `preEval()`.

## Extends Are The Main Semantic Constraint

The hardest part is not declarations. It is preserving extend correctness.

Today, the separate `preEval` phase guarantees that:

- rulesets are registered to the right extend root before `processExtends()`
- nested rulesets inside nestable at-rules are discoverable
- source order is preserved while those registries are built

A preEval-free design still needs those guarantees, but it does not need them as
"everything must already be registered before any eval starts".

The narrower requirement is:

- by the time `processExtends(context)` runs at the outermost `Rules`, every
  extend-relevant ruleset must have been visited and registered to the correct
  root

That suggests a simpler contract:

- nested `Rules` under rulesets and at-rules must be evaluated before final
  extend processing
- but they do not all need a dedicated prep pass up front

In practice, that means the future queue probably still needs depth-first
behavior for extend-relevant containers, just folded into eval rather than split
across `preEval` and `eval`.

## How To Reduce Iterations

The best iteration reduction opportunities are in `Rules`, not in leaf nodes.

### 1. Stop Doing Two Global Phases

The biggest win is eliminating:

- tree-wide registration pre-pass
- then tree-wide eval pass

Even if eval still does some local retries, that is already a major reduction.

### 2. Retry Only Pending Registrables

Do not retry comments, calls, or other non-registrable nodes just because one
interpolated declaration name was blocked.

### 3. Retry Locally, Not Recursively

If a declaration name resolves inside one `Rules`, only retry pending-name nodes
in that same `Rules` unless there is a proven cross-boundary dependency.

### 4. Make Ordering Explicit In The Queue

The existing priority queue already encodes most of the useful staging:

- imports
- calls
- declarations
- mixins / rulesets / extends / at-rules

That is a better foundation than `preEval` retries because it already expresses
semantic order. Future work should lean into that queue instead of duplicating
it with a second preparatory traversal.

### 5. Push More Output Shaping To Serialization

Anything that only exists to make rendering come out correctly should not force
extra eval iterations.

Likely candidates:

- `collapseNesting` frame capture and selector flattening
- root-only at-rule bubbling / hoisting
- top-level `@import` output ordering

The more of that moves to serialization, the less work eval has to front-load.

## Open Question: Priority Queue vs Linear Render With Deferred Misses

Status: exploratory. Decide empirically before Track 5 (buffered render)
hardens a direction.

The discussion above assumes the existing priority queue is the right shape and
the work is to lean into it harder. That assumption is worth testing. There is a
competing shape that may be cheaper in practice.

### Shape A — Prioritized queue (current direction)

Classify each child into a bucket (imports, calls, declarations, mixins,
rulesets, extends, at-rules), evaluate in bucket order, requeue blocked nodes
when a dependency resolves.

- Pro: semantic staging is explicit; forward references resolve in a "good"
  order; blocked retries are narrow.
- Con: per-node classification cost; queue bookkeeping on every child; priority
  ordering is a second source of truth for evaluation order separate from source
  order.

### Shape B — Linear render with deferred misses

Walk `Rules.value` in source order, streaming into the segmented render buffer.
When a reference cannot resolve, push a *pending-ref* placeholder segment (same
mechanism as `RulesetBlock` / `HoistBlock` / `MergeSlot` in the
registry-redesign proposal) and record the miss against the current scope. At
the end of the `Rules` walk, drain the miss list; anything still unresolved
after a fixed-point pass is a real error.

- Pro: one traversal order — source order — matches "render IS evaluation"; the
  placeholder mechanism is already required for extends/`@media`/reference
  imports, so pending refs are a new segment type, not new machinery; static
  bucket pre-population from `_indexRules` means forward refs usually resolve
  on first touch, so the miss list is small or empty in the common case.
- Con: needs a well-defined placeholder segment and a drain step; cascades
  (a miss resolved only after a later miss resolves) need a fixed-point loop;
  diagnostic quality for unresolved names has to be preserved explicitly.

### The hybrid worth considering

Default to Shape B. Fall back to Shape A only where Shape B provably costs more
— e.g. constructs with known resolution hazards. Most stylesheets are nearly
source-order resolvable once static buckets are pre-populated; paying queue
overhead for every node to handle rare cases is likely the wrong default.

### What to measure before committing

- Per-file histogram of how many references actually need deferral vs resolve
  on first touch, across the Less benchmark and the jess test corpus.
- Cost of classification + queue ops per child vs cost of one extra segment
  allocation per pending ref.
- Worst-case cascade depth for fixed-point drain (expected: 1–2 in realistic
  code; pathological cases can be capped with an explicit iteration limit).

Until those numbers exist, treat the priority queue's current dominance as
inherited, not proven.

## A Conservative Migration Path

This probably should not be attempted as one large rewrite.

A safer order would be:

1. Document the exact responsibilities currently hidden in `Rules.preEval()`.
2. Move pure render-order concerns out of eval entirely.
3. Split node-local "prepare identity" logic from full node evaluation.
4. Teach `Rules.evalNode()` to manage pending registrations directly.
5. Remove `_multiPassPreEval()`.
6. Remove the public assumption that `eval()` implies a prior deep `preEval()`.

This keeps the intermediate states understandable and testable.

## Non-Goals

This document does not propose:

- weakening extend behavior
- removing selector composition semantics
- flattening evaluation order until tests happen to pass
- replacing one global pass with a hidden global scan inside `eval`

If `preEval` is removed, the replacement should be a genuinely smaller and more
local runtime model, not the same model with different method names.
