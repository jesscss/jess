# R3 — Live bindings + control flow (DESIGN SPEC)

> Subsystem spec for the tree2 `BindingCell` live-cell model and control flow,
> matching the depth of
> [`TREE2-DESIGN-SPEC.md` § R0](../TREE2-DESIGN-SPEC.md#r0--collapsenestingfalse-nested-output-mode-the-less-v5-default).
> This is a **design/spec document — no tree2 code has been built for R3.** It
> specifies the data model, scope-write algorithm, control-flow eval, and
> invariants the R3 BUILD must implement, and marks every place the current
> tree2 (immutable var-`Map`) design must change.
>
> Roadmap row:
> [`…COVERAGE-AND-ROADMAP.md` § R3](../TREE2-DEFINITIVE-REWRITE-COVERAGE-AND-ROADMAP.md#r3--live-bindings--control-flow)
> (arch A5/B4). Branch of record: `experiment/tree2-cleanroom-20260715`; code
> citations are on that branch.

---

## R3 — `BindingCell` live cells + control flow

**Status:** DESIGN ONLY (not built). This section specifies what the code must
guarantee. Oracle = **owner-defined Jess semantics** (this is NOT a less.js-alpha
feature); ambiguous points are flagged "needs owner confirmation" rather than
invented.

### Problem / why the immutable var-Map is not enough

Every tree2 rung through R2 threads scope as a **per-frame immutable
`vars: Map<string, ValueNode>`** built once by `collectVars` (whole-scope,
last-wins) and read by `lookupVar` (`serialize.ts`). That model is **read-
substitution only**: a name maps to one fixed value node for the whole life of
the frame, and there is no way to *write* a binding after the frame is built.
Three owner-committed feature families need in-place mutation of a binding after
the frame exists:

1. **Sass+ scope-write operators** — `:=` (nearestOuter reassignment),
   `!global`/`setDefined`, `!default` (`$foo?:`). Each mutates an *existing*
   binding (possibly in an enclosing scope) rather than creating a shadowing
   local. `MEMORY nearest-outer-assign-semantic`; `docs/jess/.../02-variables.mdx`.
2. **`.jess` live bindings** — `$!foo` *reads the latest* value a name holds
   (not the value at the read's textual position), and `$!foo: v` *reassigns the
   existing binding without shadowing*; `!$foo` is a readonly (`const`) binding
   whose later reassignment is a compile error; `_name` is a private member.
3. **`.jess` control flow** — `$if/$else/$else if`, `$for` (list, range,
   destructuring), `$while`. A `$for`/`$while` body is iterated N times with a
   **live induction counter that mutates in place**; materialising N body copies
   would break tree2's foundational clone/inherit-ZERO invariant (B1).

The immutable Map also cannot express the **read-mode distinction** the dialects
require (see § Read-mode resolution): Less `@var` and Jess `$!var` are last-wins/
live, but Jess `$var` is a **point-in-time snapshot** — a semantic the current
whole-scope pre-collect silently collapses.

R3 replaces the immutable `Map<string, ValueNode>` with a frame of mutable
**`BindingCell`s**, re-read (and where the walk passes a write, re-written) as the
serialize walk proceeds — with **no per-iteration body copy**.

### Data / model

**No CSS-output node types change.** R3 changes the **scope representation** and
adds **control-flow statement nodes** (bridged from the `.jess` parser's `If` /
`For` / `While` CST; the bridge is R7-gated for `.jess`, so R3 lands the core
mechanism and exercises it via constructed tree2 fixtures + the SCSS/Less scope
operators that reach it earlier).

#### `BindingCell`

Replaces the value stored in a frame's var map. `Frame.vars` becomes
`Map<string, BindingCell> | null`.

```ts
interface BindingCell {
  /** The binding's CURRENT value as the walk has most recently written it.
   *  Mutated in place by declarations/assignments and by loop induction. */
  current: ValueNode;
  /** The binding's LAST-WINS value within its declaring scope — the value a
   *  lazy/live read resolves to. Seeded by the scope pre-pass; updated by any
   *  in-scope reassignment. For a binding never reassigned, `lastWins === current`.
   *  (Two fields, not one, because Jess `$foo` snapshot reads `current` while
   *  Less `@foo`/Jess `$!foo` read `lastWins` — see Read-mode resolution.) */
  lastWins: ValueNode;
  /** True once any assignment has bound it (drives `!default`/`:=` existence). */
  defined: boolean;
  /** `!$name` const binding: a later write is a compile error. */
  readonly: boolean;
  /** `_name` private member: not visible through external namespace access. */
  isPrivate: boolean;
  /** The frame that OWNS this cell (its declaring scope). Used so an outer-
   *  targeting write (`:=`/`$!`/`!global`) mutates the owner cell, not a copy. */
  owner: Frame;
}
```

A cell is a mutable object shared by reference: an enclosing scope's cell is the
*same object* an inner frame sees through the lookup chain, so an inner
`:=`/`$!`/`!global` write mutating `cell.current`/`cell.lastWins` is observed by
every later read in the owning scope (this is what makes non-shadowing
reassignment work without rebuilding maps).

#### Frame kinds

The current `Frame` (`{ parent, mixins, vars }`) gains a discriminator so the
scope-write algorithm knows where a new binding lands and which frames a write
may target:

- **`scope` frame** — a real lexical scope boundary (root, rule body, mixin call
  body, at-rule body). A plain `$foo: v` / `@foo: v` declaration creates/updates a
  cell **in the nearest enclosing `scope` frame**.
- **`transparent` frame** — a control-flow block (`$if`/`$else`/`$for`/`$while`
  body). Per owner: *"conditionals and iteration blocks do not create a new
  scope"* (`docs/jess/.../07-conditionals-iteration.mdx`). A transparent frame
  overlays ONLY its loop-induction cells (`$i`, `$section`, destructured names);
  every OTHER read and every plain declaration **falls through to the enclosing
  `scope` frame**. So `$if (true) { $c: blue; }` inside `.box` writes `.box`'s
  `$c` cell, not a block-local one.

`isScopeBoundary(frame)` = `frame.kind === 'scope'`. A binding-creating write
(§ Scope-write, `create` path) skips `transparent` frames to find its home scope;
a name *lookup* still walks straight up `parent`.

### Algorithm

#### Building a scope's cells (replaces `collectVars`)

`collectVars` currently returns a `Map<string, ValueNode>` in one forward pass
(last write wins). R3's `collectCells(statements, ownerFrame)`:

1. First forward pass over the body's **direct** var declarations (not those
   inside nested rules/mixins — those own their scopes; control-flow blocks are
   transparent so their *plain* declarations DO belong to this scope and are
   included, see below): allocate one `BindingCell` per distinct name, set
   `lastWins` to the textually-last assignment (preserving today's Less lazy
   last-wins), `current` to the textually-first assignment's value, `defined =
   true`, `readonly`/`isPrivate` from the sigil.
2. Control-flow blocks contribute their plain (non-induction) declarations to the
   enclosing scope's cell set (transparent-scope rule), so `collectCells` descends
   into `$if/$for/$while` bodies for cell *allocation* — but NOT into nested rule/
   mixin bodies.

The forward-pass seeding keeps R0–R2 byte-identity for the common case (a name
assigned once): `current === lastWins`, and both read modes agree.

#### Scope-write operators (the write algorithm)

A write carries an **op** decided at bridge time from the sigil/operator:

| Source | op | Target resolution | Unbound target |
|---|---|---|---|
| `$foo: v` / `@foo: v` | `create` | nearest enclosing **scope** frame; create-or-update its cell | n/a (creates) |
| `$foo?: v` (`!default`) | `default` | nearest visible cell up the chain | create in nearest scope frame |
| `$foo := v` (nearestOuter) | `nearestOuter` | nearest **enclosing** cell that already binds `foo` | **compile error** |
| `$!foo: v` (live assign) | `liveAssign` | nearest visible cell that already binds `foo` | **needs owner confirm** (see flags) |
| `!global` / `setDefined` (SCSS) | `global` | the existing binding ("set existing / do not shadow") | **needs owner confirm** |

Write procedure `writeBinding(frame, name, value, op, e)`:

- `create`: `home = nearestScope(frame)`; if `home.vars` has `name`, update the
  cell (`current = lastWins = value`, respect `readonly` → error); else allocate a
  new cell owned by `home`. A `create` in an inner scope that a name is already
  bound in an OUTER scope **shadows** (new cell in `home`) — this is the point `:=`
  and `$!` deliberately avoid.
- `default`: `cell = lookupCell(frame, name)`; if found and `cell.defined`, no-op;
  else `create` in `nearestScope(frame)`.
- `nearestOuter` (`:=`): `cell = lookupCell(frame.parent-chain, name)` searching
  **enclosing** scopes (start at `frame`, standard lexical walk); if none →
  **compile error** modelled on the eval `'x' is not defined` throw with location
  (owner decision, `MEMORY nearest-outer-assign-semantic`). If found, mutate the
  existing cell in place: `cell.current = value`; and `cell.lastWins = value` iff
  this write is textually the last for that cell in its owner scope (so later
  lazy/live reads see it). `readonly` cell → compile error.
- `liveAssign` (`$!foo:`): same target as `nearestOuter` per the docs ("the non-
  shadowing counterpart to `:=`"); mutate the existing cell. **Flag:** whether an
  unbound `$!foo:` errors (like `:=`) or auto-creates a global is not stated by the
  owner — see § Flagged.
- `global` (`setDefined`): mutate the existing binding wherever it lives ("set
  existing / do not shadow"; equivalent to `!global` unless already shadowed in a
  narrower scope, in which case the owner requires the *user* to refactor —
  `docs/shared/.../01-scss-compatibility.mdx`). This is DISTINCT from `:=`
  (`declaration.ts:122` in legacy: *"Used by SCSS `!global`. NOT Jess `:=`"*).

**All writes mutate a `BindingCell` object in place; no map is rebuilt and no
frame is re-created.** This is the core departure from today's immutable map.

#### Read-mode resolution (the load-bearing dialect distinction)

A `VarRef` (and its `.jess` bridge equivalents) carries a **read mode**:

- **`lazy`** — Less `@foo`, and Jess live `$!foo`. Resolves to `cell.lastWins`
  (last-wins within the owning scope). This is exactly today's behavior and stays
  byte-identical.
- **`snapshot`** — Jess `$foo`. Resolves to `cell.current` **as of the read's
  textual position** in the source-order walk. Owner: *"a `$var` reference reads
  the value the variable had at that point in the scope"* (contrast Sass point-in-
  time; contrast Less lazy) — `docs/jess/.../02-variables.mdx` "Live binding".

Because tree2 emits declarations in **source order**, snapshot reads are served
by mutating `cell.current` as the walk passes each assignment: the value emitted
for `$foo` at position *k* is `cell.current` after processing writes at positions
`< k`. Lazy reads ignore walk position and take `cell.lastWins`.

> **This is a real semantic divergence the current pre-collect masks.** tree2's
> `collectVars` builds one last-wins value per name — correct for `lazy` reads,
> WRONG for Jess `snapshot` reads. R3 must carry both `current` (order-mutated)
> and `lastWins` (pre-seeded) on the cell. For Less-only and SCSS-`!global`
> corpora every read is `lazy`, so R2 byte-identity is preserved; the snapshot
> path only activates for `.jess` `$foo`.

#### Control-flow evaluation

Control-flow nodes are walked by the SAME body emitters (`emitNestedBody` /
`walkBody`) — they are statements that expand into the current block. All operate
through a **transparent frame** (no new scope):

**`$if` / `$else if` / `$else`** — evaluate the condition through the value
service (`evaluateGuardCondition`, reusing the R2/guard leaf seam) resolved in the
current frame; walk the winning branch's body into the current block via a
transparent frame; else walk the `else` chain. Nothing is emitted for untaken
branches. Plain declarations inside the taken branch write to the enclosing scope
(transparent rule) — e.g. the owner's `.box { $my-color: red; $if(true){ $my-color:
blue } color: $my-color }` → `blue`.

**`$for`** — three source forms (`docs/jess/.../07-conditionals-iteration.mdx`,
`jess-parser` corpus 06):

- list: `$for ($item, $key of $list) { … }` — iterate the resolved list; `$item`
  bound to each element, `$key` to the element's key (list offset; collection
  member name for a `.jess` collection).
- range: `$for ($i of 1 to 3)` inclusive; `$for ($i of 1 to <3)` excludes the end.
- destructuring: `$for ([$k, $v] of $list) { … }` — bind the tuple per element.

Iteration procedure (the **no-per-iteration-copy** guarantee):

```
loopFrame = { kind: 'transparent', parent: currentFrame,
              mixins: null, vars: <induction cells> }
for each value v in sequence:
    inductionCell.current = inductionCell.lastWins = <v>   // mutate in place
    emitNestedBody(loopBody, loopFrame, e)                 // SAME shared array
```

The loop **body statement array is shared and re-walked N times**; only the
induction `BindingCell`(s) in `loopFrame.vars` mutate between iterations. No
`clone`/`inherit`/`withComponents` analog runs — the counts stay structurally
ZERO exactly as in mixin placement (B1). The induction cells are re-seeded, never
reallocated per iteration (reallocation would be correct but the spec pins in-
place mutation to match arch A5 and to keep allocation flat).

**`$while (cond) { … }`** — re-evaluate `cond` in `loopFrame` before each pass;
the counter that `cond` tests is a normal cell mutated by the body's `:=`/`$!`
writes (or plain writes into the enclosing scope). Loop terminates when `cond` is
false. **Bound:** the eval path is naturally terminating (like guarded mixin
recursion); if a `record`-style value pre-pass is retained from R2 it needs the
same `MAX_RECORD_DEPTH` cap the mixin path uses (`serialize.ts`) — the native R2
value evaluator removes that need. **Flag:** an infinite `$while` is a user error;
whether tree2 raises a diagnostic vs a depth cap in eval mode is an owner call.

#### Interaction with the canonical-body + overlay (mixin) model

A mixin call frame is `{ parent: callerFrame, mixins, vars: <param cells + body
cells> }` walked over the **shared** def body (no clone). R3 keeps this:

- Param bindings become `BindingCell`s in the call frame; the shared body is
  walked once per selected definition, exactly as today.
- A body iterated by an inner `$for`/`$while` still walks the ONE shared body
  array; the induction cells live in a transparent frame layered over the call
  frame. **A body iterated N times never materialises N copies** — this composes
  the mixin no-clone invariant with the loop no-copy invariant.
- Live writes (`:=`/`$!`/`!global`) inside a mixin body resolve their target up
  the **lexical call-site chain** (arch A4: value-frame = call-site chain, not
  `.parent` reparenting), mutating the enclosing cell object. Guard-selected
  definitions get their own per-call param cells, so a guard-chosen body mutating a
  param cell cannot leak into a sibling selection.

#### Interaction with lazy/lexical shadowing and guard-selected bindings

- **Shadowing:** a plain `create` in an inner scope allocates a new cell that
  hides the outer (lexical shadow); `:=`/`$!`/`!global` explicitly *skip* creating
  a shadow and target the existing outer cell. Lookup for a read always takes the
  nearest cell.
- **Lazy resolution ordering:** a `lazy` (`@foo`/`$!foo`) read resolves against
  `cell.lastWins`, which is fully determined once the owning scope's `collectCells`
  pre-pass runs — so it is order-insensitive and unaffected by where the read sits,
  matching today's lazy Less semantics.
- **Guard-selected bindings:** guards are evaluated in the callee frame over param
  cells (`mixin-dispatch.ts` `makeCalleeResolver`); those cells are the same
  `BindingCell`s the selected body reads/writes, so a guard that inspects a
  live-mutated counter and the body that mutates it agree.

### The non-obvious shapes (owner-sourced, to be pinned by fixtures)

Sourced from owner docs/memory — to be locked with tree2 fixtures when R3 builds
(no legacy-render oracle for the `.jess`-only forms; see Oracle):

- **Jess `$foo` is a point-in-time snapshot, NOT Less lazy last-wins.** In
  `.btn { $color: red; color: $color; $color: blue; }` the emitted `color` is
  `red` (snapshot), while the Less `@color` equivalent is `blue` (lazy). Live
  `$!color` in the same spot is `blue`.
- **`:=` / `$!foo:` reassign the nearest existing binding, do not shadow.**
  `$color: red;` at root, `.btn { $!color: blue; }`, `.box { color: $color; }` →
  `.box` emits `blue` (the root cell was mutated).
- **`:=` on an unbound name is a compile error** (not a silent global create) —
  the "catches typos" owner rationale.
- **Control-flow blocks do not open a scope.** A `$my-color:` written inside
  `$if`/`$for`/`$while` merges into the containing block's scope.
- **`!$foo` readonly reassignment is a compile error**; `_name` is invisible
  through external namespace access (`$colors._private` → error), visible within
  the owning namespace.
- **Ranges are inclusive by default**, `to <N` excludes the end.

### Invariants

1. **No per-iteration body copy.** `$for`/`$while` re-walk the ONE shared body
   statement array; only induction `BindingCell`s mutate in place.
   `clone`/`inherit`/`withComponents` analog op-counts stay structurally ZERO
   (the R0/mixin race columns must hold across a loop fixture).
2. **No frame/map rebuild on write.** A scope-write mutates a `BindingCell`
   object in place; frames and cell maps are allocated once per scope entry, never
   per write or per read.
3. **Read modes are explicit and separable.** `lazy` reads take `cell.lastWins`;
   `snapshot` reads take `cell.current` at walk position. Less-only/SCSS-`!global`
   corpora use only `lazy` → **R2 byte-identity preserved** (no regression).
4. **Reassignment respects declaration kind.** A write to a `readonly` cell is a
   compile error; `:=`/`liveAssign` on an unbound target error (`:=`) or are
   owner-decided (`$!`); `default` no-ops on an already-`defined` cell.
5. **Non-shadowing writes target the owner cell.** `:=`/`$!`/`!global` mutate the
   existing enclosing cell (shared by reference), never a shadow copy; plain
   `create` in an inner scope shadows.
6. **Lexical call-site chain, no reparenting.** Live writes inside a mixin body
   resolve up the call-site chain (A4); tree2 nodes never gain `.parent`/`adopt`.
7. **Boundary held.** No `tree2/` file imports `../tree`; no `as any`. Control-
   flow condition truth and any value math delegate through the injected
   `ValueService` seam (the R2-native evaluator), never into `../tree`.

### Oracle (owner-defined semantics — NOT less.js alpha)

R3 is **not** a less.js-alpha feature, so the R0/R1 "less.js alpha output" shape
authority does not apply. The oracle is **owner-defined Jess semantics** as
recorded in:

- `docs-content/docs/jess/02-Language/02-variables.mdx` (assignment operators,
  live binding `$!`, readonly `!$`, private `_`);
- `docs-content/docs/jess/02-Language/07-conditionals-iteration.mdx` (`$if`/
  `$for`/`$while`, ranges, destructuring, transparent block scoping);
- `docs-content/docs/shared/04-guides/02-coming-from-sass/01-scss-compatibility.mdx`
  (`!global` = `setDefined` "set existing / do not shadow"; `!default`);
- `MEMORY nearest-outer-assign-semantic` (`:=` nearestOuter, unbound → compile
  error; distinct from `setDefined`);
- `MEMORY sass-plus-dialect-reject-invalid-css` (Sass+ rejects where Sass
  tolerates invalid CSS — governs error posture).

The legacy `tree` render is **not** a safe byte-oracle here: `nearestOuter` has
**no legacy eval implementation** (it only ever *printed* `:=` —
`MEMORY nearest-outer-assign-semantic`), and the `.jess` snapshot/live/control-
flow forms are new. R3 fixtures assert against the owner-specified intended output
directly (constructed tree2 inputs + expected CSS), not a legacy round-trip. Where
SCSS `!global`/`!default` DO have a legacy eval impl (`setDefined`), that impl is
a valid proxy **only** for the `lazy`-read subset that already agrees with the v5
goldens.

### Where the current tree2 (immutable var-Map) must change

Concrete deltas the R3 build makes (all in `tree2/` + `mixin-dispatch.ts`, plus
control-flow node types and their `.jess` bridge later):

- `serialize.ts` `Frame.vars: Map<string, ValueNode>` → `Map<string, BindingCell>`;
  add `Frame.kind: 'scope' | 'transparent'`.
- `collectVars` → `collectCells` (allocate cells; seed `current`/`lastWins`;
  descend into transparent control-flow bodies for cell allocation but not into
  nested rule/mixin bodies).
- `lookupVar` → `lookupCell` (+ a `nearestScope(frame)` helper and an
  enclosing-only search for `:=`/`$!`).
- `valueText` `Kind.VarRef` case: honor the read mode — `lazy` → `cell.lastWins`,
  `snapshot` → `cell.current`. `VarRef` gains a `readMode` field (bridged from the
  `.jess` `$!` sigil / Less `@`; the current node has none).
- New `writeBinding` applied when the body walk reaches a `VarDeclaration`/assign
  in source order (today `VarDeclaration` is inert — "emits nothing; lives in
  scope"; it must now *mutate* the owner cell so snapshot reads and live reassigns
  work as the walk passes it).
- New statement kinds + emitters `If` / `For` / `While` walked by
  `emitNestedBody`/`walkBody` through a transparent frame.
- `mixin-dispatch.ts` param binding produces `BindingCell`s; guard resolvers read
  the same cells.
- The `record`/replay bound (`MAX_RECORD_DEPTH`) generalises to `$while`; the R2
  native evaluator is the clean removal of that scaffold.

### Flagged for owner confirmation of intended v5/Jess semantics

1. **`$!foo:` unbound target.** `:=` on an unbound name is a compile error
   (decided). The docs call `$!foo:` "the non-shadowing counterpart to `:=`", but
   do NOT state whether an unbound `$!foo:` errors identically or auto-creates.
   *Assumed: same as `:=` (error).* Needs confirmation.
2. **`$!foo:` vs `:=` — same target, or does `$!` reach further?** Both are
   described as "reassign the nearest existing binding." Confirm they are the SAME
   write op (differing only in the read-side `$!` live-read sigil), vs `$!:` being
   a distinct target rule.
3. **`setDefined`/`!global` unbound target.** "Set existing / do not shadow" — if
   the name is bound nowhere, does `!global` create a global (Sass behavior) or
   error? The owner note describes the *shadowed* case (refactor) but not the
   *unbound* case.
4. **`$for` header order.** `07-conditionals-iteration.mdx` writes
   `$for ($section, $i of $sections)` (item, then key) while its `:::info` gives
   the general form `$for ({$item} [, {$key} [, {$counter}]?]?)`. Confirm the
   positional order and the three-slot `item, key, counter` semantics (and that
   `key === counter` for a plain list, diverging for a collection).
5. **`$for` `$key` for collections.** Docs say for a list the key is the offset,
   for a collection the key is the declaration name. Confirm collection iteration
   key/value binding when R4 lands collections.
6. **`$while` non-termination policy.** Diagnostic vs depth cap in eval mode
   (Sass+ reject-invalid stance suggests a diagnostic, but the threshold/behavior
   is unspecified).
7. **`snapshot` vs `lazy` default for `@`-in-`.jess` and mixed corpora.** Confirm
   that within `.jess`, `$foo` is always snapshot and only `$!foo`/`@foo` are
   lazy, with no config toggle — the spec assumes the sigil alone selects the mode.
8. **Readonly `!$` scope.** Whether `!$foo` forbids only reassignment in the same/
   inner scope, or also blocks `:=`/`!global` from an inner scope targeting it
   (assumed: any write errors).
