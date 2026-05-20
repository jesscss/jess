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

This note is both a design record and an implementation guide. The exact code
shape can still change, but the ordering decisions below are the target unless a
focused test proves a missing semantic constraint.

## Why `Rules` Is The Choke Point

Today, `Rules.evalNode()` in `packages/core/src/tree/rules.ts` owns the
registration-prep bridge before it evaluates children.

That preparation currently includes several separate concerns:

- cloning / root setup / rules-context setup
- child index assignment
- root and extend-root registration
- static-name registration
- multi-pass retry for dynamic declaration names
- depth-first child prep for nested `Rules`, `Ruleset`, and `AtRule`

Only after that does `Rules.evalNode()` run the source-order child evaluation
walk.

That means Jess pays for:

- one pass to discover what can be registered
- one pass to actually evaluate
- extra retries during registration prep before the source-order eval walk even
  starts

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

That also means evaluation itself can now be source-ordered.

The cleaner model is:

- assign `.index` from the current child array in source order as an initial
  setup step
- run child evaluation in source order after those indices exist
- use narrow pending lanes only for proven blockers
- preserve `.index` when a node is replaced by its resolved/evaluated form
- assign a derived source position to nodes that are materialized later
  (imports, call results, mixin outputs) based on the source position that
  emitted them

So the rule is "source position must exist before lookup"; source order is the
normal eval/render order unless a focused test proves a specific pending lane is
needed.

That makes indexing a setup concern, not a reason to keep a separate pass.

### Registration Before Evaluation

`Rules._prepareRegistration()` still tries to make the tree lookup-ready before
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
- evaluation defers only the narrow blockers that gained new prerequisites

That implies a new contract:

- registration is no longer proof that a node was pre-evaluated
- registration only means "this node's lookup identity is now stable enough to
  index"
- child traversal happens because evaluation reached that child, not because a
  global prep phase touched everything first

## Evaluation Order Decision

The target order is **source-order render/eval with local prep**, not a broad
priority queue.

That does not mean "evaluate every child before registration" or "serialize raw
source text directly." It means `Rules` owns one local walk with a few explicit
preconditions:

1. **Scope setup first.** Establish `context.root`, `context.rulesContext`,
   `treeRoot`, import/reference scope, and the current extend root for this
   `Rules`.
2. **Index before lookup.** Assign stable child `.index` values from source
   order before any reference lookup can run. This preserves nearest-prior
   declaration behavior without forcing evaluation itself into priority order.
3. **Static registration before child evaluation.** Register lookup identities
   that are already stable: static declarations, static mixins/functions,
   static callable rulesets, and known extend/reference flags. This keeps normal
   forward references cheap and avoids turning every reference into a deferred
   miss.
4. **Local dynamic identity prep.** Dynamic declaration keys, interpolated mixin
   names, interpolated selectors, and interpolated at-rule names are not
   "pre-evaluated" as whole subtrees. They get a local identity-prep attempt only
   when registration needs their key/selector/name.
5. **Source-order render/eval walk.** Walk children in authored order. A child
   may materialize a local evaluated node via `resolve(context)` before it
   serializes, but the result is not retained as a whole evaluated tree.
6. **Typed deferral for real misses.** If a value is needed only for final
   output and is not currently resolvable, emit a typed pending slot and record
   the miss. Do not reintroduce a general priority queue.
7. **Run narrow semantic side-effect lanes.** Keep these explicit and small:
   - engine imports evaluate before ordinary rules so imported symbols are
     available to the file that imports them
   - mixin/function calls evaluate before ordinary declarations/rulesets in the
     same `Rules` so Less property accessors can see call-produced declarations
8. **Drain narrow pending work.** Run fixed-point drains only for the specific
   shapes that genuinely need them:
   - dynamic declaration names in the current `Rules`
   - `StyleImport` path interpolation
   - pending render slots that could not resolve during the linear walk
9. **Finalize after nested containers have been visited.** `processExtends`
   still runs only after the outermost root has evaluated enough of the tree for
   every extend-relevant ruleset to be registered to the correct extend root.

The old `NodeTypeToPriority` queue was useful as a bridge because preEval made
lookup state exist before output evaluation. It has been removed from
`Rules.evalNode()` and should not come back as the normal renderer. Its only
durable lessons were the narrow blockers above: imports carry symbol side
effects and can be blocked on path identity, calls can produce declarations that
Less property accessors read, and dynamic declaration keys can be blocked on
other declaration identities.

## Why We Pre-Evaluated Parts First

The old phase did not exist because every node had meaningful pre-work. It
existed because a few parts of a few nodes were needed before their full
evaluation:

| Current preEval surface | Why it happened early | Replacement |
| --- | --- | --- |
| `Rules` context/root setup | References, imports, and extends need the right root/scope before any child runs. | Keep as a shallow `Rules` setup step at the start of eval/render. |
| Child `.index` assignment | Linear lookup semantics depend on source positions, especially nearest-prior declarations. | Keep early index assignment in `Rules`; preserve index on replacements/materialized output. |
| Static declaration/mixin/ruleset registration | Forward refs and mixin calls need names/selectors indexed before first use. | Keep static identity registration before the source-order walk. Registration means "identity is stable," not "node is pre-evaluated." |
| Dynamic declaration names | Declaration keys can be interpolated and can depend on other declarations. | Use a local fixed-point pending-name set for the current `Rules`; do not retry unrelated children. |
| `Ruleset` selector prep | Mixin lookup and extends need a stable own selector and key sets. | Split into selector identity prep near registration. Body evaluation waits for source-order traversal. |
| `Declaration` assignment normalization | `+=`, `+_=`/merge forms change the semantic value, not only the output text. | Normalize the assignment wrapper during declaration registration; leave the normalized value subtree for source-order eval/render. |
| `AtRule` name/prelude prep | Interpolated names and import hoisting were mixed with child traversal. | Name identity is local prep; prelude evaluation stays in eval where live scope is correct; import hoisting moves to render/finalization. |
| `Mixin` name prep | Callable registry needs a stable name, but mixin bodies must not be walked until call time. | Keep cheap callable identity prep; continue avoiding body traversal during registration. |
| `Any(role='charset')` | Root output ordering needed to remember the first charset and hide duplicate/source token output. | Treat as root/render setup or charset collection, not a general node preEval hook. |
| `Collection` / control mark-only overrides | These existed to avoid generic recursion or to mark phase completion. | Removed; do not replace them with new hooks. |

The key rule is: **prepare the part that defines lookup identity; do not prepare
the whole node unless full node evaluation is actually needed.**

## `Rules.evalNode()` Target Shape

One plausible future structure:

1. Do non-semantic setup once.
   Set `context.root`, establish the correct extend root, snapshot context, and
   assign child indices before registration and eval-owned side-effect lanes.

2. Register immediately stable identities.
   This can reuse pieces of `_indexRules()` and `registerNode()`, but it must
   not mark nodes pre-evaluated or recurse through child bodies.

3. Classify dynamic identity nodes into:
   - immediately registerable
   - pending-name
   - non-registrable

4. Walk children in source order.
   Before rendering/evaluating a node, attempt the local identity prep needed
   for that node's registration surface. After a node produces output or a
   derived node, register any newly materialized lookup identities.

5. When a node resolves a blocked identity, retry only the affected local
   pending set.

6. Run final root-only work once.
   This includes `processExtends(context)` and any final output-order
   normalization that still belongs in eval.

The key change is that registration becomes incremental state inside
`Rules.evalNode()`, not a completed prerequisite from another pass.

## What Would Replace `_prepareRegistration()`

`Rules._prepareRegistration()` is currently doing two jobs:

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

### Blocking Kinds

Track these as separate buckets, even if the first implementation only uses a
couple of arrays:

- `declaration-name`: a declaration cannot be registered until its key resolves.
- `callable-name`: a mixin/function/ruleset callable identity is not stable.
- `selector-identity`: selector/key-set composition is not stable enough for
  mixin/extend indexing.
- `import-path`: import path interpolation failed before the file can load.
- `render-ref`: output needs a value that was not resolvable during the linear
  walk.

Do not wake all buckets when one changes. In particular, a resolved declaration
value should not cause comments, calls, static rulesets, or unrelated at-rules to
run again.

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
  Evaluate nested `Rules` when the source-order walk reaches them.

That would keep selector prep local without requiring a full depth-first
pre-pass.

### `Declaration`

Current `Declaration.preEval()` is mostly:

- resolve interpolated property name
- normalize assignment operators into explicit reference/value structures

The current code now separates declaration name-identity prep from the rest of
declaration prep, but assignment normalization and recursive value prep still
run immediately after the name is known. That timing is intentional for now:
assignment normalization builds references and value containers that later eval
and merge logic depend on. Moving it into `Declaration.evalNode()` needs focused
assignment tests, not a mechanical helper shuffle.

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

Do not move at-rule child traversal casually. Current pre-eval traversal is
still what registers nested rulesets against the correct extend root, especially
inside nestable wrappers and root-only at-rules that temporarily clear selector
frames. The guard tests live in `src/tree/__tests__/at-rule.test.ts`,
`src/tree/__tests__/extend-roots.test.ts`, and
`src/tree/__tests__/extend-eval-integration.test.ts`.

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
- source-order evaluation

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

The current code now names selector identity prep separately, but child `Rules`
traversal still runs immediately after selector prep. That is intentional until
there is a replacement for the extend-root registration side effect: nested
rulesets must still be registered under the correct current extend root before
root-final `processExtends(context)`.

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

The mark-only hook is gone.

Collections are already lazy and `Collection.evalNode()` is a no-op. They
should not be recursively prepared by declaration registration; declaration
values now wait for source-order eval/render.

### Control Nodes

The mark-only hook is gone.

`$if`, `$for`, and `$while` do real work in `evalNode()`, not `preEval()`.
Control nodes do not participate in registration-by-name, and they should not
require a separate prep phase.

The only real concern is eval placement:

- control nodes should run when the source-order walk reaches them
- any rules they emit should register as they materialize

That is an eval/materialization problem, not a reason to preserve `preEval()`.

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

In practice, that means extend-relevant containers still need to be visited
before finalization, just folded into eval rather than split across `preEval`
and `eval`.

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

### 4. Make Ordering Explicit In The Walk

The removed priority queue documented which concerns were order-sensitive.
Treat it as evidence for narrow blockers, not as the target architecture:

- import path identity can need retry
- call output can define properties read elsewhere in the same scope
- dynamic declaration keys can need a fixed-point pass
- ruleset/extend identity must be known before final extend processing

The normal path should be source-order traversal with explicit local prep and
typed pending slots. If a new priority bucket seems necessary, first prove the
specific semantic dependency with a focused test.

### 5. Push More Output Shaping To Serialization

Anything that only exists to make rendering come out correctly should not force
extra eval iterations.

Likely candidates:

- `collapseNesting` frame capture and selector flattening
- root-only at-rule bubbling / hoisting
- top-level `@import` output ordering

The more of that moves to serialization, the less work eval has to front-load.

## Decision: Linear Render With Deferred Misses

Status: decided for the Track 5 target. Use Shape B as the default runtime
shape: linear render/eval with explicit pending slots for misses. Do not bring
back a broad priority queue as the normal renderer.

The rejected alternative was to treat the old priority queue as the right shape
and lean into it harder. That assumption did not match the desired eval/render
architecture.

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

Segmented buffers do not imply "keep child nodes around." A child that can
finalize its own output should write a string segment immediately; only the
parent/finalization boundary that genuinely needs delayed ordering should stay
typed.

### Target Hybrid

Default to Shape B. Keep narrow schedulers only where the current code already
shows a real blocking shape:

- `StyleImport` path interpolation can fail before the import path is known.
  `Rules._evaluateSourceOrder(...)` keeps a narrow pending-import lane for this
  tagged path-resolution error; content evaluation errors are not retried.
- `Call` output can add declarations before ordinary declarations and nested
  rulesets serialize. This is needed for Less property accessors, where `$color`
  can read a declaration produced by a mixin call in the same `Rules`.
- Dynamic declaration names can depend on other dynamic declaration names.
  `Rules._resolvePendingDeclarationNamesFixedPoint(...)` already handles this
  as a local fixed-point loop with a small retry cap.

Everything else should either resolve from indexed scope state or emit a typed
pending segment with an explicit drain step. The future renderer should not keep
bucket ordering for every child just to support these two special cases.

This still preserves the evaluated-node boundary described at the top of this
file: a node may transform or evaluate before it serializes. The target is not
direct string emission that bypasses node semantics; it is one local render/eval
walk with explicit pending work instead of a separate tree-wide pre-pass plus a
general priority queue.

### What to measure while implementing

- Per-file histogram of how many references actually need deferral vs resolve
  on first touch, across the Less benchmark and the jess test corpus.
- Cost of classification + queue ops per child vs cost of one extra segment
  allocation per pending ref.
- Worst-case cascade depth for fixed-point drain (expected: 1–2 in realistic
  code; pathological cases can be capped with an explicit iteration limit).

Use those numbers to validate the pending-slot implementation and decide whether
the remaining narrow lanes can shrink further. Do not use the old queue's
existence as evidence that a broad queue is the target architecture.

## A Conservative Migration Path

This probably should not be attempted as one large rewrite.

A safer order is:

1. **Characterize current hidden preEval work.**
   Add focused tests or debug counters for:
   - which nodes register during `Rules.preEval()`
   - which dynamic declaration names actually need more than one retry
   - which `StyleImport` retries are path-identity failures
   - which rulesets are registered only because of recursive child preEval

2. **Introduce explicit identity-prep helpers without changing behavior.**
   Add small private helpers for the real identity surfaces:
   - declaration key prep
   - declaration assignment normalization
   - mixin callable-name prep
   - ruleset selector identity prep
   - at-rule name prep

   Initially these helpers can be called from existing `preEval()` methods so
   tests stay stable, but the helper names should describe the smaller concern.

3. **Move mark-only hooks out of the way.**
   Done for `Collection` and control nodes. Keep this boundary intact: if a
   future path reintroduces broad child recursion, fix the caller rather than
   adding new mark-only hooks.

4. **Teach `Rules` local pending registration.**
   Replace `_prepareRegistration()` with `Rules`-owned local state:
   - `pendingDeclarationNames`
   - `pendingCallableNames`
   - `pendingSelectorIdentity`
   - `pendingImportPaths`

   Registration should stop depending on a completed tree-wide pre-pass.

5. **Fold recursive child preEval into container eval.**
   `Ruleset` and `AtRule` should evaluate child `Rules` when the source-order
   walk reaches their body. They may still prepare identity before registration,
   but they should not force a depth-first preparatory traversal just to make
   rendering possible.

6. **Keep source-order render/eval as the normal path.**
   Keep only proven narrow lanes:
   - import symbol side effects and path retry
   - call output side effects for Less property accessors
   - dynamic declaration-key fixed point

   Everything else resolves from indexed scope state, evaluates locally, or
   emits a typed pending render slot.

7. **Remove the public preEval assumption.**
   Once `Rules.evalNode()` owns setup, registration, pending names, and body
   traversal, remove the public contract that `eval()` implies a prior
   tree-wide `preEval()`.

This keeps the intermediate states understandable and testable.

## Current Implementation State

Do not start by deleting `preEval()`. The current bridge is intentionally
halfway between the old public phase name and the target eval-owned setup:

- `Node.prepareEval()` and `Node.prepareRegistration()` are the migration
  surfaces for local setup.
- Public `preEval()` remains as a compatibility delegate while callers still
  depend on the old phase shape. Node classes no longer carry redundant
  `preEval()` overrides that only delegate to `prepareRegistration()`;
  node-specific setup should live in `prepareRegistration()` or
  `prepareEval()`.
- `Rules` owns pending registration state for two proven surfaces:
  - dynamic declaration names use a local fixed-point bucket.
  - callable, selector, and import identities stay in one source-ordered list.
- Declaration registration prep now stabilizes names and normalizes assignment
  wrappers only. Declaration values are left for source-order eval/render so
  value containers such as `Collection` and control nodes do not need mark-only
  registration hooks.
- `Ruleset` and `AtRule` body traversal now happens from eval-owned setup rather
  than through base `prepareEval()`. Some registration prep remains inside those
  nodes where extend-root and selector identity need it.

The next step is to shrink the remaining node-local registration prep that still
does semantic rewrites before the source-order eval walk reaches the node. Do
not split the ordered non-declaration identity list into separate schedulers
unless focused tests prove each surface can move independently without changing
registration or import retry timing.

Do not simply override `Rules.eval()` to skip the public `preEval()` wrapper.
That changes when registration prep runs relative to `rulesEvalStack` setup and
can break root-final extend serialization. A concrete guard is
`src/tree/__tests__/extend-rules.test.ts`'s pseudo-class same-header extend
case: `.btn:hover` must coalesce declarations when the selector was
extend-mutated, while plain duplicate sibling selectors must remain separate.

## Non-Goals

This document does not propose:

- weakening extend behavior
- removing selector composition semantics
- flattening evaluation order until tests happen to pass
- replacing one global pass with a hidden global scan inside `eval`
- replacing the evaluated AST with a second render-buffer AST

If `preEval` is removed, the replacement should be a genuinely smaller and more
local runtime model, not the same model with different method names. The render
buffer may carry typed delayed-output slots, but only for output that cannot be
finalized immediately. It should not grow node identity, parent/child ownership,
lookup APIs, or general traversal semantics. Children inside delayed slots
should still serialize to strings as soon as they are final; a delayed parent is
not permission to retain renderable child structure.
