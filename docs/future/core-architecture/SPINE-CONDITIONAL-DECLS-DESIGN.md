# Spine conditional / scope-mutating declarations — design + recommendation

Status: DESIGN ONLY (owner-decision input). No production code changed.
Base: `cb19de6bc` (branch `work/conditional-decls-design`).

## Problem

The single-pass spine (`packages/core/src/tree/util/emit-walk.ts`) resolves-and-emits
in one downward traversal. Its variable model is **UPFRONT frame + position-gated
READ**: at scope-enter it builds a `ScopeFrame` whose `declarationBucketsByName` is
populated STATICALLY from the source body's `VarDeclaration`s in source order
(`Rules.prepareScopeFrameDeclarationIndex`, `rules.ts:1564`), and a leaf read resolves
through `lookupScopeFrameVariable` (`scope-frame.ts:560`) gated by the reader's
`start` (its `node.index`, assigned at scope-enter by `assignSpineChildIndices`,
`emit-walk.ts:134`).

Three declaration shapes are currently EXCLUDED (`isSimpleSpineLeaf`,
`emit-walk.ts:961-976`) and route the whole enclosing root to the eval path. They are
locked excluded by `emit-walk-ratchet.test.ts:533`.

1. **Conditional assign `@x ?: v`** (`AssignmentType.CondAssign`, `declaration.ts:61`) —
   bind-if-not-already-bound. Ordering matters: `@x: red; @x ?: blue; color:@x` → `red`.
2. **`setDefined`** (Sass `!global`, `declaration.ts:125`) — write a binding cell in an
   OUTER scope (the nearest enclosing scope that binds the name; else the top).
3. **`nearestOuter`** (Jess `:=`, `declaration.ts:135`) — reassign the nearest enclosing
   binding.

## What the EVAL path actually does (byte-for-byte semantics to match)

### `?:` — a value rewrite, NOT a special binding write

`Declaration._normalizeAssignmentValue` (`declaration.ts:1818`), run during
REGISTRATION, rewrites a `?:` declaration's value to a **self-`Reference` with a
`fallbackValue`** (`declaration.ts:1950-1958`):

```
case AssignmentType.CondAssign:
  setValue(new Reference({ key: referenceKey }, { type, fallbackValue: inputValue }));
```

That is: `@x ?: v` becomes `@x = <read @x (position-gated), fallback v>`. The reference
carries `ref.index = this.index` (as the `+:` merge does, `declaration.ts:1925`) so the
prior-value lookup only sees bindings with `sourceNode.index < this.index` — i.e. the
`@x: red` BEFORE it, never itself. If a prior binding exists, the read returns it
(`red`); if not, the fallback (`v`) is used. **This is the SAME read model the spine
already runs** — a position-gated `lookupScopeFrameVariable` against the statically
built frame. The only reason it does not fold today is that the *value rewrite* happens
in registration, which the spine skips.

Critically: `prepareScopeFrameDeclarationIndex` inserts EVERY static VarDeclaration into
the bucket upfront — including the `?:` node itself (it is not `setDefined`, so it is not
skipped at `rules.ts:1595`). So at the moment the spine emits `@x?:blue`, the frame's
`x` bucket already contains `[{@x:red, index 0}, {@x?:blue, index 1}]`. A self-reference
with `start = index-of-the-?:-node` reads entry 0 → `red`. Exactly the eval result.

### `setDefined` — an incremental binding WRITE to an outer cell

`Rules.evalNode` (`rules.ts:5150-5235`): for a `setDefined` VarDeclaration it does NOT
declare a new binding. It looks up the existing binding via
`lookupScopeFrameVariable(frame, key, { includeAssignmentTargets: true })` and writes
`hit.cell.value = evalSetDefinedAssignedValue(node, context)` — mutating the cell in
whatever (possibly outer) frame owns it (`writeSetDefinedBindingCell`, `rules.ts:5347`).
Misses throw `"x" is not defined`; readonly throws. `prepareScopeFrameDeclarationIndex`
SKIPS `setDefined` nodes entirely (`rules.ts:1595`) — they are writes, not declarations,
so they never enter a bucket. This is inherently an **outer-scope write during descent**.

### `nearestOuter` (Jess `:=`) — NOT IMPLEMENTED in eval either

`grep nearestOuter` finds only render sites (`declaration.ts:1104-1110/1316-1318` render
`:=`). There is NO eval handler — the parser accepts it and it round-trips, but no
runtime rebind occurs. It is a declared-but-unimplemented intent (near-zero in any
corpus). **The spine cannot be behind eval on a shape eval does not implement.** So this
design covers `nearestOuter` only as "match eval" (currently a no-op rebind); if/when
eval implements it as a nearest-enclosing write, it becomes mechanism-(B) shaped.

## The two candidate mechanisms

### (A) Read-time side-table threaded into `lookupScopeFrameVariable`

A structure consulted at READ time that layers conditional/outer-scope writes over the
upfront frame.

- For `?:`: a per-body plan (`WeakMap<Node, resolvedValue>`) that, at emit, hands the
  `?:` anchor its resolved value (the self-reference read) instead of last-wins.
- For `setDefined`/`nearestOuter`: an overlay map consulted on EVERY variable read to see
  whether an outer write has shadowed the frame's cell.

**Perf verdict: DISQUALIFIED for the outer-write cases.** Variable reads are the hottest
path in the engine. `lookupScopeFrameVariable` is a tight parent-walk over Maps.
Threading a side-table probe into it adds a branch + lookup to EVERY read in EVERY tree —
including the 99.99% of trees with no conditional/outer writes at all. The memory-savings
/ no-defensive-slowdown rules both say: never add cost to the universal hot path for a
rare shape. It could be *gated* (only trees that carry a `setDefined`/`?:` pay), but the
gate itself is a per-frame flag check on the read path, and the mechanism is strictly
more complex than (B) for `?:` while being WRONG-shaped for `setDefined` (a write
modeled as a read overlay). Keep (A) only in the narrow `?:`-as-a-plan form (below),
which is NOT a `lookupScopeFrameVariable` change — it is a body plan, identical in shape
and cost profile to `spine-merge.ts`.

### (B) Incremental binding-write during descent

Let the spine WRITE binding cells as it descends, mirroring `Rules.evalNode`'s
setDefined path exactly. When the descent reaches a `setDefined` node, resolve its RHS
against the live frame and write `cell.value` on the resolved (outer) cell via the same
`lookupScopeFrameVariable(includeAssignmentTargets)` + `writeSetDefinedBindingCell`
helpers the eval path uses.

- **Cost: ZERO on the hot READ path.** A write happens only at the `setDefined` node
  itself, which is as rare as the shape. Reads are untouched.
- The cells are per-placement (per mixin invocation / loop iteration) — the design's
  existing frame-per-placement invariant already isolates them, so a shared AST template
  is never mutated (`writeSetDefinedBindingCell` comment, `rules.ts:5347`).
- Ordering is naturally correct: the spine descends in source order, so a write lands
  before any later sibling reads it and after earlier ones — exactly eval's order.

## Coverage matrix

| Shape         | (A) read-side-table | (A′) `?:`-as-body-plan | (B) incremental write |
|---------------|---------------------|------------------------|-----------------------|
| `?:`          | works, hot-path cost| **works, zero hot cost** | works (write the cell)|
| `setDefined`  | wrong shape (write-as-read), hot cost | N/A | **works, zero hot cost** |
| `nearestOuter`| N/A (eval no-op)    | N/A                    | matches eval (no-op today; write-shaped when eval implements it) |

## Recommendation — HYBRID: `?:` via a body plan (A′) + `setDefined` via incremental write (B)

Neither pure (A) nor pure (B) is right; the two shapes are genuinely different (`?:` is a
VALUE composition, `setDefined` is a scope WRITE), and the eval path itself splits them
exactly this way. So mirror that split:

### `?:` → a `spine-cond.ts` body plan (mechanism A′, modeled 1:1 on `spine-merge.ts`)

At body-enter (same call site as `planBodyMerges`, `emit-walk.ts` container descent),
walk the DIRECT children; for each `?:` VarDeclaration build the eval-path self-reference
(`new Reference({ key }, { type, fallbackValue: inputValue })` with `ref.index =
node.index`) and resolve it against the live frame — the frame already holds all prior
bindings position-gated, so the read returns the prior value or the fallback, byte-for-
byte as eval. Store `WeakMap<Node, { value }>` (an anchor entry). At emit, a `?:` leaf
emits the planned value instead of going through `emitLeaf`'s naive eval.

- **Hot-path cost: zero** — no `lookupScopeFrameVariable` change; the plan is built only
  in bodies that contain a `?:` (fast pre-scan bail, exactly `planBodyMerges`
  lines 108-118), and touched only at those anchors.
- Reuses the EXACT node the eval path constructs → byte-identical by construction.
- The plan must ALSO feed the frame: because `@x ?: v` may itself become the value a
  LATER read of `@x` sees, the resolved value overwrites `x`'s current binding cell for
  positions after the `?:` node. Since the cell for the `?:` node is already in the
  frame (it was not skipped), the plan writes `cell.value` on that node's own entry —
  one in-place write at the anchor, no version bump needed for cached handles (reads
  dereference the live cell). This is the one subtlety: `?:` is a value plan AND a
  single-cell write-forward, but the write is to the node's OWN already-present cell, so
  it needs no outer-scope machinery.

### `setDefined` → incremental binding write (mechanism B), reusing the eval helpers

In the container descent's child loop, when a child is a `setDefined` VarDeclaration,
call the SAME path `Rules.evalNode` uses:
`lookupScopeFrameVariable(frame, key, { includeAssignmentTargets: true, blockedSource, filter })`
→ on hit, `cell.value = evalSetDefinedAssignedValue(node, context)`; on `miss` throw
`"x" is not defined`; on `uncovered`, fall back to the eval path for that root (the
occurrence-crawl path is an eval-pass concept the spine should not replicate — gate it
out, do not port it). This is a handful of lines calling existing, tested helpers.

- **Hot-path cost: zero** — reads untouched; the write fires only at the `setDefined`
  node.
- The `evalSetDefinedAssignedValue` + `writeSetDefinedBindingCell` + `lookupScopeFrame
  Variable` helpers are already exported/used; the spine calls them directly.

### `nearestOuter`

Match eval = no runtime rebind today. Keep it eligible ONLY once eval implements it; if
eval implements it as a nearest-enclosing-scope write, it slots into mechanism (B)'s
write path with `searchParents: true, includeLive: true` and the first hit past the
current frame. Until then, leave it EXCLUDED (do not silently no-op a shape whose eval
semantics are undefined) — this is the one shape neither mechanism "cleanly covers"
because the ORACLE is undefined.

## Why not a shared read-time side-table (pure A)

Explicitly rejected on PERF: it taxes the universal variable-read path for two rare Jess-
native shapes (`?:` / `:=` are near-zero in the Less corpus). Even gated, it is more
machinery than (A′)+(B), and it models a WRITE (`setDefined`) as a read overlay — an
impedance mismatch that would drift from eval semantics. The prior speculative attempt
(carry the CondAssign fallback-ref's `index` into a shared-eval read gate) was tried and
REVERTED (`CUTOVER-CHECKLIST.md:142`); the binding cell resolves too late in that shape.
(A′) sidesteps that by building the reference in the BODY PLAN with the correct `index`
already set, exactly as `_normalizeAssignmentValue` does — not by mutating shared eval.

## Fold plan (increments)

1. **`?:` fold (A′).** New `spine-cond.ts` (`planBodyConditionals`), wired at the same
   container-descent site as `planBodyMerges` (`withSpineMergePlan` neighbor). Lift the
   `options?.setDefined || options?.nearestOuter` half of the gate is UNCHANGED; lift
   only `assign === '?:'` in `isSimpleSpineLeaf` (`emit-walk.ts:970`) — add `?:` to a
   `CONDITIONAL_ASSIGNS` set the leaf-emit consults its plan for. Root-level `?:`
   (directly in the document root) stays excluded like root-level `+:`
   (`isSpineEligibleRoot`, `emit-walk.ts:1165` neighbor) — the flat root path runs no
   body plan.
2. **`setDefined` fold (B).** In the container child loop, handle a `setDefined` leaf via
   the eval helpers (above). Lift `options?.setDefined` from the `emit-walk.ts:973` gate;
   on `uncovered` from the lookup, return false from eligibility (keep that sub-shape on
   eval). Root-level `setDefined` writing a top binding: same outer-write path, frame is
   the root frame.
3. **`nearestOuter`:** leave excluded; add a note that it unlocks with eval support.

## Gate-lift + ratchet strategy

- The exclusion ratchet `emit-walk-ratchet.test.ts:533` must FLIP for `?:` and
  `setDefined` (they become eligible) while STILL asserting `nearestOuter` is excluded.
  Replace the single "excludes all three" assertion with: (a) `?:`-fold routed through
  the spine + byte-identical to eval (`@x:red; @x?:blue; color:@x` → `red`; and the
  undefined case → fallback) + `spineRenderCounter` moves + `Rules.derive`/`eval` not
  called; (b) `setDefined` routed + byte-identical (outer-scope write observed by a later
  read) + miss throws; (c) `nearestOuter` STILL excluded.
- Keep a NEGATIVE ratchet on the pure read-time-side-table: assert
  `lookupScopeFrameVariable`'s signature/behavior on a non-conditional tree is unchanged
  (no new options consulted on the hot path) — locks the "no hot-path tax" decision so a
  future change can't smuggle mechanism (A) in.
- Correctness oracle for both: the eval path on the SAME source (the working all-less
  oracle), asserting identical bytes — not a golden `.css`.

## Open question for the owner

`nearestOuter` (Jess `:=`) has NO eval implementation — it renders `:=` but performs no
rebind. Two paths:
  (i) Leave it excluded from the spine AND unimplemented in eval (status quo; near-zero
      usage) — this design does that.
  (ii) Define its semantics (nearest-enclosing-scope non-shadowing rebind) and implement
      it in BOTH eval and the spine mechanism-(B) write path in one go.
Recommend (i) now — do not spend the spine increment on a shape whose oracle is
undefined; revisit only if a real `:=` case appears. Owner decides whether `:=` is a
committed language feature or a parser-accepted no-op.
