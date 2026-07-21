# R6 — Plugin/visitor hook · less-compat · module semantics

> DESIGN SPEC for roadmap rung **R6**
> ([`TREE2-DEFINITIVE-REWRITE-COVERAGE-AND-ROADMAP.md` §3 R6](../TREE2-DEFINITIVE-REWRITE-COVERAGE-AND-ROADMAP.md), arch F/G in
> [`UNIFIED-EVAL-EMIT-DESIGN.md` §6–§7](../UNIFIED-EVAL-EMIT-DESIGN.md)). Same
> shape as [`TREE2-DESIGN-SPEC.md` §R0](../TREE2-DESIGN-SPEC.md): **data model ·
> algorithm · invariants · reference · owner-confirm**. This is a DESIGN doc — no
> tree2 code is built by it.
>
> Branch of record: `experiment/tree2-cleanroom-20260715`. Code citations are on
> that branch unless marked otherwise.

R6 closes three coverage rows, all tagged NOTYET/NEEDS-DESIGN today with **no
tree2 code**:

1. **Plugin/visitor hook** — the settled projection contract `(node) => Node |
   void`, fired on the emit walk (arch F1–F6, G1–G2).
2. **less-compat** — the ONE genuine external contract: `less.functions` custom
   fns via the ValueService seam; the `less.tree` 4.x node-ctor external API via a
   compat ADAPTER that lives OUTSIDE the tree2 boundary.
3. **Module semantics** — `@use`/`@compose` (module) vs `@-import`/`@import`
   (leaky fold + warn), per the owner import/at-rule decision.

The governing constraint throughout: **HARD boundary — no `../tree` import inside
`tree2/`** (guarded by `tree2-harness/__tests__/boundary-guard.test.ts`), and
**core stays Less-agnostic** — the whole R6 core surface is one generic hook edge
plus the existing `ValueService` seam; every Less-branded shape lives in
`tree2-frontend/` or the `@jesscss/plugin-less-compat` package.

---

## Part A — The plugin/visitor hook

### A.0 What tree2 already has (the alignment)

tree2 IS a projection serializer: `serialize.ts` walks the tree once and, at each
emit position, stands on **the node in OUTPUT form** — a static node is its
concrete canonical form; a dynamic node is already value-resolved (variable refs
substituted, operations folded through the `ValueService`, selectors composed).
This is precisely the node the settled contract hands a visitor (arch F1). So R6
does **not** build a visitor framework; it exposes **one hook edge** on a walk
that already exists.

`TREE2-DEFINITIVE-REWRITE-COVERAGE-AND-ROADMAP.md` tags this **ALIGNED-BYCON
(unwired)**: "tree2 per-emit-position node = the settled contract; wire a hook
edge, don't build a walk framework." The whole-tree `TreeVisitor` /
`preSerializeRoot` / self-driven-`Visitor.visit` machinery of the legacy core is
DELETED, not ported (`UNIFIED-EVAL-EMIT-DESIGN.md` §6.3, §7).

### A.1 Data model — the contract (core-owned, Less-agnostic)

The entire core surface added by R6 for plugins:

```ts
// @jesscss/core (tree2) — generic, zero Less knowledge.
type NodeVisitor = (node: Node) => Node | void

interface VisitorRegistry {
  registerVisitor(enter: NodeVisitor, opts?: { exit?: NodeVisitor }): void
}
```

- `Node` is tree2's own `Node` (the `kind`-tagged base in `tree2/node.ts`) — NOT
  a `less.tree` node, NOT a legacy `../tree` node. Core owes no Less-specific type.
- **Return semantics — exactly two cases** (`UNIFIED-EVAL-EMIT-DESIGN.md` §6.1):
  - `void`/`undefined` → node unchanged; the same shape flows to serialize.
  - a `Node` → REPLACEMENT; the returned node is what serializes.
    (`shape = visitor.enter(shape) ?? shape` — the `fn(n) ?? n` semantics the
    legacy core's `Visitor._visit` already implements at
    `visitor/index.ts:144-150`.)
- **NO `REMOVE`, NO `ABORT`, NO `visitDeeper`, NO `ctx`/`frame`.** The audit
  (`UNIFIED-EVAL-EMIT-DESIGN.md` §6.6) found no published plugin needs node
  removal, skip-children, multi-visitor chaining in core, a structural-stack, an
  output-writer handle, or a value-frame. Removal is expressed by returning a
  Nil/invisible node (serializes to nothing) on the CONSUMER side; the frame is
  unnecessary because the node is already resolved and custom-fn scope comes from
  the Call-eval path, not the hook (Part B).
- **Registry** = a trivial ordered list held on the serialize/compile context.
  No chaining/short-circuit/priority. Empty unless a caller registers.

The `NodeVisitor`/`registerVisitor` type is the DESIGN PORT of the legacy pruned
contract; tree2 must ADD it (it has none today — verified: no `registerVisitor`,
no visitor list in `tree2/`).

### A.2 Algorithm — one enter edge (+ optional exit) on the emit walk

**Where the edge fires.** The hook fires at each node's **enter** (post-shape,
pre-children) — after the node's own output shape is settled (value resolved,
selector composed, extend contribution projected once R1 lands) and BEFORE its
children serialize. An **optional exit** edge fires post-children, pre-close.

Concretely, in `serialize.ts` this is a SINGLE guarded call site threaded into the
emit dispatch. Both the flattened path (`flatten`/`walkBody`/`emitLeaf`/
`emitAtRuleBlock`) and the R0 nested path (`emitNestedBody`/`emitNestedRule`/
`emitNestedLeaf`/`emitNestedAtRuleBlock`) resolve, per statement, to an output
node before writing bytes. The hook interposes there:

```
resolvedNode = <the output-form node the walk currently stands on>
if (e.visitors)                                   // gate: null unless ≥1 registered
  resolvedNode = runEnter(e.visitors, resolvedNode)
<emit resolvedNode's own bytes / header>
<recurse into children>
if (e.visitors && e.visitors.hasExit)
  runExit(e.visitors, resolvedNode)               // post-children, pre-close
<emit close>
```

`runEnter` iterates the ordered list: `for (v of list) node = v.enter(node) ??
node`. `runExit` iterates the exit-bearing subset (LIFO not required — no plugin
depends on exit ordering; keep registration order for determinism).

**The single edge is `Emit.visitors`.** Add ONE field to the internal `Emit`
struct (`serialize.ts:253`): `visitors: VisitorList | null` (null = none
registered). This mirrors how `Emit.service` already threads the `ValueService`
and how `Emit.collapse` threads the R0 policy — one nullable field, checked once
per node.

**Zero cost when idle (arch F, the "least weight" rule).** Two gates, both keying
on REAL WORK not on presence:

1. **`e.visitors === null` ⇒ no call at all.** With no visitor registered the walk
   is byte-for-byte what it is today; the branch is one null-check per node.
2. **Resolve-before-hook is gated on registration** (`UNIFIED-EVAL-EMIT-DESIGN.md`
   §6.1). tree2 already resolves values at emit; the only extra cost a visitor can
   impose is forcing a DYNAMIC leaf into output form *before* the hook rather than
   at write. That forcing happens ONLY when `e.visitors !== null`. Static nodes are
   already concrete, so they need no pre-hook resolution regardless.

**Replacement takes the fresh-transient path** (arch F, ruling 1 interaction,
`UNIFIED-EVAL-EMIT-DESIGN.md` §6.4). A visitor that returns a NEW node produces a
fresh local object for THIS emit position; it MUST NOT mutate the shared canonical
node in a byte- or reuse-affecting way. tree2 already honors this discipline — its
canonical strings (`Complex._canon`, `Compound._canon`) are output-invisible caches
(loosened invariant B2); a replacement node simply serializes in place of the
original and is released. Rule of thumb: **change the output ⇒ return a new node;
observe/invisibly-cache ⇒ return void.**

**Per-type dispatch is NOT a core edge.** Core fires one generic enter/exit keyed
on nothing. A consumer that wants `visitRuleset`/`visitDeclaration`/… switches on
the node's tag inside its own `enter` — exactly as the bridge does today
(`less-compat-structures.ts:70`).

### A.3 Pre-eval visitors — a SEPARATE gated pre-walk (cannot fold into the pass)

Less 4.x `isPreEvalVisitor` plugins run BEFORE eval. The single resolve-and-emit
pass **cannot** host this by construction — it never materializes an un-evaluated
whole tree mid-pass (arch F6/G1, `UNIFIED-EVAL-EMIT-DESIGN.md` §6.9). One real
published plugin needs it: `less-plugin-inline-urls` is a pre-eval replacing
visitor.

**Design: a separate, gated pre-walk over the BRIDGE OUTPUT before `serialize`.**
tree2's natural pre-eval surface is the tree2 node tree produced by
`bridgeToTree2` (`tree2-frontend/bridge.ts`) — the un-evaluated tree2 tree, before
the value-resolving serialize walk. R6 hosts the pre-eval pre-pass THERE:

```
statements = bridgeToTree2(...)          // un-evaluated tree2 tree (frontend)
if (preEvalVisitors.length)              // HARD gate: skip entirely if empty
  statements = preWalk(statements, preEvalVisitors)   // structural pre-walk
result = serialize(root(statements), options)         // the single pass
```

- The pre-walk feeds the SAME `(node) => Node | void` contract at the pre-eval
  lifecycle point.
- **Hard leanness gate:** the pre-walk only runs if ≥1 pre-eval visitor is
  registered. Pre-eval visitors are rare (`inline-urls` is the lone published
  one); the common case never walks the tree pre-eval and costs nothing.
- This pre-walk lives in `tree2-frontend/` (it may touch the bridge output and, if
  a consumer needs it, provenance) — NOT inside `tree2/`. The serialize pass and
  its single enter/exit edge are untouched by it.

**Owner note (unchanged from §6.9):** the owner may choose to drop pre-eval compat
entirely; if kept, this is the shape.

### A.4 Accepted non-goals (design decisions, not gaps)

- **Whole-tree mutate-then-observe** (arch G2). The projection model deliberately
  cannot serve a plugin that mutates a whole materialized tree and then re-observes
  it. The published-plugin audit found NO plugin needs it. Accepted non-goal.
- **Node removal / skip-children / multi-visitor chaining as CORE signals.** No
  published-plugin usage; expressed on the consumer side (removal = return a Nil
  node) or unneeded.
- **`ctx`/`frame` at the hook.** The node is already resolved; custom-fn scope
  comes from the Call-eval path (Part B). Core exposes no frame.

---

## Part B — less-compat (the ONE genuine external contract)

less-compat is an **optional side dependency** of the `less` package, never
imported or auto-registered by jess (`UNIFIED-EVAL-EMIT-DESIGN.md` §6.8). It has
two independent seams into tree2, and they must be kept independent:

### B.1 `less.functions` custom fns — via the ValueService seam (NOT the visitor)

**Key realization (already true in the model):** custom functions never run inside
the visitor hook. A Less custom function is wrapped and added to a Jess function
registry (`addToJessRegistry`, `plugin.ts:26-45`; `wrapWithLessNodeArgs`,
`plugin.ts:81-106`), and Jess invokes it during the **Call node's own eval**,
binding `this` to the live eval context and resolving args via `arg.eval(this)`
(`plugin.ts:37-42`). Scope comes from the function-call path, not the hook.

**tree2 mapping.** In tree2, function calls (`FunctionCall` nodes) are evaluated
by the injected **`ValueService`** (`tree2/value-service.ts` interface;
`ValueService.callFunction(name, argsSource)`). That interface IS the seam:
`less.functions` custom fns register into the same fns backend the real
`ValueService` impl already wraps.

- **Today's real impl** (`tree2-frontend/value-service.ts`) computes math/functions
  by an async record → sync replay that re-renders through the legacy
  fns-registered path (`registerLessFunctions`, `oracle.ts:23` → `@jesscss/fns`).
  A Less custom fn is just another registered fn in that backend — it resolves the
  same way, with the same `less.tree`-shaped arg values (`wrapWithLessNodeArgs`
  converts evaluated args to `less.tree` views via `toLessNode` before the fn runs,
  `plugin.ts:106`).
- **R2 supersedes the scaffold** (roadmap): value math becomes a real synchronous
  tree2-native/fns-backed evaluator. R6's requirement on R2 is only that the
  synchronous evaluator keeps a **registry seam** — a way for less-compat to add a
  `(name) => fn` binding that `callFunction` consults — so custom fns keep working.
  This is a `ValueService` capability, expressed as an interface method or a
  registry handed to the impl; **not** a tree2-core Less concept.

**Design item R6.B1 (needs owner confirmation of the seam shape):** the current
`ValueService` interface has no *registration* method — it only computes. Custom
fns are wired today by `registerLessFunctions` mutating the legacy tree's scope
OUTSIDE tree2. For the JS-module endgame that indirection dies with the scaffold.
The clean shape is a `ValueService` that accepts a **custom-function map** at
construction (in `tree2-frontend`, where the real impl lives), so
`callFunction('myFn', args)` consults `customFns` before built-ins. This keeps the
seam a value concern, not a visitor concern, and keeps `less.functions` off the
core surface entirely. **Confirm:** whether the custom-fn registry is a
construction parameter of the frontend `ValueService` impl (preferred) vs a
mutable `register` method on the interface.

### B.2 `less.tree` node constructors — a compat ADAPTER OUTSIDE the boundary

`less.tree` is the real external API: 4.x plugins construct nodes with
`new less.tree.Dimension(...)`, `new less.tree.Color(...)`, `new less.tree.Call(...)`,
etc., and read fields off nodes handed to their `visit*` methods (`.value`,
`.unit`, `.rgb`, `.type`, `.accept`). tree2's clean-room nodes are `kind`-tagged
and expose NONE of that. This is arch G's "genuine model unknown": *can the
projection model host `less.tree` node-ctor compat without leaking the boundary?*

**Answer: YES — and the existing code already proves the pattern.** The `less.tree`
constructors are NOT `../tree` classes; they are **plain-object factories** in the
less-compat package: `LessTreeConstructors` (`less-compat-structures.ts:284`)
builds `{ type, ...fields, accept, toCSS }` plain objects
(`Dimension:424`, `Color:442`, `Call:340`, `Ruleset:389`, `Quoted:306`,
`DetachedRuleset:327`, …). `createLessMock(functionRegistry)` (`:532`) exposes them
as `mockLess.tree`. **None of these import or subclass `../tree`.** So the external
`less.tree` API surface is already synthesized entirely inside the compat package.

The adapter therefore lives in exactly TWO already-boundary-legal places, and
tree2-core imports NEITHER:

1. **`@jesscss/plugin-less-compat` (the `less` facade package).** Owns the
   `less.tree` constructor shapes (`LessTreeConstructors`), the `toLessNode` /
   `fromLessNode` transforms (`transform/`), and the `less.tree` view adapter
   (`createLessAdapter`, `less-adapter.ts`). This package is ALLOWED to know both
   Less and (via a thin tree2-facing conversion) tree2.
2. **`tree2-frontend/` (optional).** If a shared node-shape reader is wanted, it
   can live here — `tree2-frontend` is the boundary-crossing front end already
   permitted to touch `../tree` and the parser. But the cleaner split keeps ALL
   Less shape in the `less` package; `tree2-frontend` only exposes the generic
   hook + `ValueService` seam.

**The one required change: a tree2-facing `toLessNode`/`fromLessNode`.** The
current transforms couple to the LEGACY tree: `toLessNode` reads `jessNode.type`
and `jessNode instanceof Node` (`../tree` `Node`), `to-less.ts:50,65`. For tree2
the compat package needs a variant that reads tree2's `kind` tag and tree2 node
fields instead — a **pure translation table** (`Kind → less.tree type + field
projection`). This is:

- **`toLessNode2(tree2Node) → less.tree view`** — reads `node.kind`
  (`tree2/node.ts`) + concrete fields (`Dimension.num`/`.unit`,
  `Declaration.name`/value bytes, `Rule.selector`, …), builds the plain-object
  `less.tree` view via `LessTreeConstructors` / `createLessAdapter`. Children
  adapted lazily via the adapter's own `accept` walk
  (`less-compat-structures.ts:60,121`) — core never materializes a subtree.
- **`fromLessNode2(less.tree node) → tree2 Node`** — the reverse, for when a Less
  visitor RETURNS a replacement (or constructs a fresh `new less.tree.Call(...)`,
  e.g. `inline-urls`'s `Call("data-uri", …)`). Reads the plain-object `.type` +
  fields and builds the corresponding tree2 node.

Both functions live in the `less` package (or `tree2-frontend`), read tree2's
PUBLIC node shape, and construct tree2 nodes through tree2's PUBLIC constructors —
**a normal downstream consumer of tree2's exported node API, not a `../tree`
import inside `tree2/`.** The boundary is respected because the direction is
`less` → depends-on → `tree2`, never `tree2` → `less` and never `tree2` →
`../tree`.

**How it plugs into Part A.** less-compat registers ONE generic tree2 visitor via
`registerVisitor(enter, { exit? })`. Inside its `enter(node)` it:
`toLessNode2(node)` → runs the registered Less `visit*` visitors over the view →
if a replacement is produced, `fromLessNode2(result)` back to a tree2 node and
return it; else return void. `exit` registered only when a wrapped Less visitor
declares enter/exit state (`inline-urls`). This is byte-for-byte the shape the
bridge already has for the legacy tree (`plugin.ts:1136` `visit`, `:1345`
`toLessNode`, `:1398` `fromLessNode`) — only the node-shape reader changes from
legacy-tree to tree2.

**Conditional registration (the leanness gate, arch F, §6.7 leanness note 2).**
less-compat registers its bridge visitor ONLY when it has real work:
`hasConfiguredBeforeEvalWork()` (`plugin.ts:206-208` —
`opts.plugins?.length || opts.visitors?.length`) OR
`sourceMayContainPluginDirective(tree)` (`plugin.ts:210-213` — source contains
`@plugin`). If neither holds, less-compat registers NOTHING → core's
`e.visitors === null` gate stays true → the no-copy fast path holds even with
less-compat LOADED. "Loaded but idle" costs exactly zero.

**Adapter-footprint refinement (a `less`-package concern, core unaffected).** At
registration, enumerate the SET of `visit{Type}` methods the registered Less
visitor(s) define (as `accept` discovers them,
`less-compat-structures.ts:76-91`); in `enter`, skip `toLessNode2` + dispatch for
tree2 `kind`s not in that set — those nodes stay tree2 nodes with no round-trip.
Recompute when `@plugin`-injected visitors widen the set mid-run.

---

## Part C — Module semantics (`@use`/`@compose`/`@-import`/`@-use`)

Source of truth: **owner memory `import-atrule-semantics-less-vs-jess`** (settled)
and `forward-as-export-design-thread` (open). tree2 has NO module handling today
(`grep` for `@use`/`@compose` in `tree2/` + `tree2-frontend/` = 0 hits); `@import`
is intercepted structurally in `tree2-frontend/import-bridge.ts`
(`resolveImportStatements`). Module at-rules are a **front-end / import-bridge**
concern, NOT a `tree2/` serialize concern — they resolve to tree2 statements before
the single pass runs, exactly like `@import` does today.

### C.1 The five `@-` compiler at-rules and their two families

Per owner: **the dash means "explicitly the compiler at-rule" — namespace-safe,
can never collide with a future CSS at-rule.** The five dash forms: `@-import`,
`@-compose`, `@-use`, `@-from`, `@-export` (the `.jess` grammar is dash-only for
all). Two behavior families:

**Family 1 — Leaky source-fold (DISCOURAGED, warns "use `@compose`"):**

| At-rule | Behavior | tree2 mapping |
|---|---|---|
| `@import` (bare, `.less`) | HEURISTIC — extension + options (`.css`/`.less`/none, `(reference)`/`(inline)`/`(css)`/`(less)`) decide passthrough-vs-fold | already `import-bridge.ts` — `isCssPassthrough` / `resolveLessPath` / `readFlags` |
| `@import` (bare, `.jess`) | ALWAYS plain CSS at-rule (no heuristic, ever) | emit as `AtRuleStatement` bytes; NO fold |
| `@-import` | EXPLICIT source-fold — ALWAYS inlines source, no heuristic; **disambiguates** the heuristic (not a redundant synonym) | `import-bridge.ts` fold path, unconditional; emit a deprecation warning → `@compose` |

Both `@import` and `@-import` **warn → `@compose`/`@-compose`**.

**Family 2 — Module system (NOT deprecated):**

| At-rule | Behavior | tree2 mapping |
|---|---|---|
| `@compose`/`@-compose` | ISOLATED scope, namespaced — the `@import` successor | resolve the module to a NAMESPACED scope; members reachable by namespace path, NOT folded flat into the importer's scope |
| `@use`/`@-use` | SCRIPT / JS import; replaces Less `@plugin` (a `less-plugin` deprecation) | load the JS module; register its functions/plugins via the `ValueService` custom-fn seam (Part B.1) + the pre-eval/visitor registry (Part A) |
| `@-export` (`.jess` only) | = Sass `@forward` | re-export a composed module's members; OPEN (§C.3) |
| `@-from` (`.jess` only) | = ESM named imports | selective named import from a module scope |

**Per facing (owner):**
- **`.less`** (bare-tolerant, both spellings work): `@import`/`@-import`
  (discouraged, warn), `@compose`/`@-compose`, `@use`/`@-use`. NOT `@-export`, NOT
  `@-from`.
- **`.jess`** (dash REQUIRED — bare `@use`/`@compose` invalid): bare `@import`
  ALWAYS plain CSS; `@-import` the sole leaky-fold path (warns → `@compose`); also
  `@-export` and `@-from`.

Bare and dashed module forms (`@use`/`@-use`, `@compose`/`@-compose`) are TRUE
aliases (no CSS collision to resolve) — the dash is the collision-safe canonical,
the bare form a fully supported convenience. Docs examples use the BARE form to
avoid transition shock. Only deprecate a bare form IF CSS ever claims the name (a
`future` lever), not now.

### C.2 Design — module vs fold in the tree2 front end

The load-bearing distinction is **fold vs module scope**, and it lands in
`import-bridge.ts` (the existing `@import` interception point), NOT in `serialize.ts`:

- **Leaky fold** (`@import` heuristic-fold, `@-import`) = the CURRENT
  `resolveImportStatements` behavior: parse + bridge the target to tree2
  statements, SPLICE them at the call site, importer scope sees the imported
  definitions FLAT. This is what tree2 already does for folding `@import`. R6 adds:
  (a) the `@-import` explicit-fold spelling; (b) a deprecation warning on both
  `@import`(fold) and `@-import` → `@compose` (emitted on `result.warnings`, R5's
  warning channel).
- **Module** (`@compose`/`@use`) = a NEW resolution mode: the target resolves to
  an **isolated, namespaced scope** rather than a spliced flat body. Its members
  are reachable only by namespace path (ties into the R4
  namespaces/accessors `#ns.mixin()` design — module member access is the same
  path-resolution mechanism). `@use` additionally loads a JS module and registers
  its exports via the Part B seams.

**Where it changes tree2.** `import-bridge.ts` gains a resolution-MODE switch
keyed on the at-rule spelling + facing (`.less` vs `.jess`) + `@import` options.
The bridge must know the FACING (source dialect) to apply the `.jess` "bare
`@import` is always plain CSS" rule — this is available at bridge time (the parser
that produced the source is dialect-specific). Module scope needs a
namespaced-scope representation the tree2 `Frame` chain does not yet have (the
current `Frame.mixins`/`Frame.vars` are flat Maps); this is shared with R4's
namespace/map work — **module scope should reuse R4's namespace-path resolution,
not invent a parallel one.**

**Warning emission** rides R5's `result.warnings` channel (deprecation emission is
R5; the fold→`@compose` warning is a deprecation). R6 defines WHICH constructs warn
(`@import`-fold, `@-import`); R5 owns the channel.

### C.3 Open thread — `@-export` / `@forward`

Per `forward-as-export-design-thread` (owner musing 2026-07-11, NOT committed):
`@forward` might be implemented as `@-export` in core IF a strong use-case is
articulated. Owner-declared "will never be": `as prefix-*` prefixing and
`show`/`hide` visibility lists (they don't map to Jess's explicit-namespacing
model). This is a language-lowering concern downstream of the parser. **R6 does NOT
build `@-export` semantics** beyond parsing/accepting the node; flag as owner-open
(§below).

---

## Part D — PROPOSED: `@use`/`@compose` namespace-access syntax

> **STATUS: PROPOSED — pending owner sign-off (ruled 2026-07-18, not yet landed).**
> Source of truth is owner memory `namespace-access-use-compose-model` (owner-
> decided 2026-07-18, verbatim). This part specifies HOW a namespaced module's
> members are *accessed* once §C's module scope exists (`@compose` isolated scope,
> `@use` JS import). It ties directly into R4.4's namespace/accessor resolution
> engine — the interpolation-body half of the model lives in
> `R4-interpolation-detached-merge-namespaces.md` §R4.6 (cross-linked below).
> Nothing here is built until the owner signs off.
>
> **Blocked on / see [`REFERENCE-CALL-PLAN.md`](../REFERENCE-CALL-PLAN.md)** — the
> core Reference-call machinery (grammar member-call chain + node + eval dispatch
> + chain/call round-trip render) is the buildable prerequisite this module
> member-access rides on; the module-kind gate below (`.name()` mixin-vs-function,
> the Less-`@compose` member-function ERROR) is the resolve-time policy layered on
> that machinery. The open questions D.8 [R6.D-a/b/c] intersect that plan.

### D.1 No new operator — reuse the existing `@var` head + `[]` + `.name()` grammar

The access syntax introduces **no new operator and no new head sigil**. It REUSES
Less's already-parsed shapes:

- the `@var` (Less) / `$var` (Jess) **variable head**,
- the `[key]` **map-lookup** accessor (R4.4's `MapAccessor`,
  `R4-…-namespaces.md:741-751`),
- the `.name(args)` **call** grammar (R4.4's `MixinCall.path`,
  `:727-739`, which already reuses `MixinCall.path`).

The module KIND (`@compose` vs `@use`, §C.1) decides what each shape *resolves to*
— NOT the grammar. Parser grammar unchanged from
`packages/less-parser/src/grammar.ts:184-260,566-720` (map-lookup + mixin-call
path productions).

### D.2 Sigil'd head — this OVERTURNS the earlier "bare head" idea

**The namespace head is SIGIL'd (`@`/`$`), NOT bare.** This explicitly overturns
the earlier "bare `theme` head" + "disambiguation fork" sketch — the sigil'd head
IS the design, deliberately grammatically identical to a variable-map-lookup:

| dialect | value read | call |
|---|---|---|
| **Less** | `@theme[@primary]` | `@theme.elevate()`, `@my-functions.func()` |
| **Jess** | `$theme[primary]` | `$theme.elevate()`, `$my-functions.func()` |

The `as`-bound (or filename-derived, §D.5) name simply **binds an ordinary
`@var`/`$var`** to a namespace/map-like value; RESOLUTION discovers that the bound
value is a namespace. Consequences:

- **NO parse-time binding table** — the parser does not need to know which names
  are namespaces.
- **NO new head sigil** — `@theme[…]` parses as an ordinary `@var` map-lookup
  (`grammar.ts:184-260`); the namespace-ness is a *resolve-time* property of the
  bound value.

### D.3 Two operators — `[key]` reads, `.name()` calls

**`[key]` = value READ.**

- **Jess:** a *bare* key is a **variable member** (`$theme[primary]`); a *quoted*
  key is a **property member** (`$theme['prop']`).
- **Less:** a sigil'd key, Less convention (`@theme[@primary]`).

**`.name(args)` = CALL**, and the member KIND is decided by the module type:

- for **`@compose`** → a **mixin** call (statement position);
- for **`@use`** → a **function** call (value position, JS-exported).

**No member functions in Less `@compose`.** `@theme.scale(4)` on a `@compose`
namespace is an **ERROR** — per owner, "there is no such thing as an exposed
function in Less." `@use` is the one module kind that brings callable functions.

**Member kind by module type** (from memory, verbatim):

| module | `head[key]` | `head.name(...)` |
|---|---|---|
| `@compose` | variable / custom-prop read | **mixin** call (stmt) |
| `@use` | (JS values, if exported) | **function** call (value) |

This routes onto R4.4's engine: `head[key]` → `MapAccessor`
(`R4-…-namespaces.md:741-751`), `head.name(args)` → `MixinCall` with a namespace
`path` (`:727-739`). The module-kind gate (mixin-vs-function, and the Less-compose
"no member function" error) is applied where the module scope is resolved
(`import-bridge.ts`, §C.2 / [R6.C1]).

### D.4 Jess `$.foo` / `.foo` shorthand — variable-or-property, ambiguous-error on both

**`$.foo`** = look up `foo` as **variable OR property**, whichever exists. If BOTH
a variable and a property named `foo` exist, it is an **ambiguous-reference
ERROR**. It is the "don't-care-which" lookup that only fails on a genuine name
collision. (Jess-only shorthand; no Less equivalent.)

**`.foo` in a Jess value position** is exact shorthand for **`$.foo`**. It is
allowed wherever a value atom is allowed: declaration values, value expressions,
and function arguments. It is not selector syntax in that position. The spelling
is unambiguous with a decimal literal because a decimal needs a digit after the
dot (`.5`), while this form requires a Jess identifier start after it.

This is a generic variable-or-property read, not a property-only AST `PropRef`.
Its AST reduction must therefore preserve the same collision check as `$.foo`:
variable-only and property-only names resolve; a name present in both namespaces
throws the same ambiguous-reference error. Do not silently prefer either side.
It is not raw selector, property-name, or at-rule-name syntax by itself, but it
is valid inside an expression embedded in any of those positions—for example
`--prop-$(.var): bar;`.

Parser acceptance must be proved at the public Jess `parse(): Stylesheet` route with
at least declaration, expression (`foo: $(.var + 1)`), function-argument,
property-name expression (`--prop-$(.var): bar;`), decimal-boundary, raw
selector-boundary, variable-only, property-only, and same-name-collision cases.
The canonical AST node name is a separate public API decision; it must describe
this generic lookup rather than reuse a misleading property-only name.

### D.4a SCSS variable modifiers lower to Jess assignment operators

SCSS modifiers are not a dialect-only semantic flag family. They map to the
same source-level variable operations as native Jess:

| SCSS | Jess canonical source | Required semantic result |
|---|---|---|
| `$foo: bar;` | `$foo: bar;` or `$$foo: bar;` | declaration creates or updates both bindings |
| `$foo: bar !default;` | `$$foo?: bar;` | test the scoped/final map, then create/update both only on a miss |
| `$foo: bar !global;` | `$$foo := bar;` | update the scoped/final binding |

`$foo` is the live/current reference and `$$foo` is the scoped/final reference;
`$!` is retired. Both `$foo:` and `$$foo:` create or update both bindings, so a
declaration has no sigil-selected binding kind. `?:` and `:=` use the target
reference's lookup mode. The evaluator semantics are the binding-system rules in
`RESOLVER-SHAPE-SPEC.md`: scoped declarations use immutable lazy stacks plus a
per-activation reassignment overlay, while live-reference assignments use
mutable source-order cells; `?:` and `:=` act within the selected system. SCSS
grammar must preserve that behavior when parser/evaluator migration begins. The
AST-v2 representation is an implementation decision for that migration; this
document does not prescribe a node shape or introduce Sass-shaped flags.

### D.5 `@use` namespace binding — dialect-split

The namespace name a module binds to differs by facing:

- **Less** — no `as` at all. `@use "./my-functions.js";` derives the namespace
  from the filename basename → `@my-functions`.
- **Jess / Sass** — `as` is OPTIONAL; the full Sass-shaped triple:
  - `@use "./mod";` → filename-derived default namespace;
  - `@use "./mod" as ns;` → explicit namespace `ns`;
  - `@use "./mod" as *;` → NO namespace — members exposed unqualified.

(`@compose` binding follows §C's module-scope rules; the `as`-triple detail above
is specified for `@use`.)

### D.6 Separator = `.` (owner-confirmed)

The call separator is **`.`** (`@theme.elevate()`), owner-confirmed — it reuses
R4.4's `MixinCall.path` segment model (`R4-…-namespaces.md:727-739`) directly. No
`>`-style descend token is introduced for module member calls.

### D.7 Cross-link — interpolation body widening

Namespaced value reads inside `@{…}` interpolation are specified in
`R4-interpolation-detached-merge-namespaces.md` **§R4.6** (the `@{}` interp-body
widening, an amendment to the owner-LOCKED §4.1 `@{`…`}` delimiters, owner-approved
2026-07-18). Summary: `@{theme[variant]}` is legal (READ only, never `.`-call —
interpolation must yield a string, and `ns.mixin()` yields a ruleset body). See
§R4.6 for the full rule.

### D.8 Open questions (owner to rule)

- **[R6.D-a] Module-kind gate placement.** The mixin-vs-function decision and the
  Less-`@compose`-member-function ERROR must be applied at the resolve site
  (`import-bridge.ts` / R4.4 dispatch). Confirm this rides the §C.2 / [R6.C1]
  module-scope resolution rather than a parse-time reject (the head is
  grammatically a plain var map-lookup until resolved).
- **[R6.D-b] `$.foo` ambiguity surface.** Confirm the ambiguous-both error is a
  resolve-time diagnostic (not parse-time), consistent with the resolve-time
  namespace discovery of §D.2.
- **[R6.D-c] `as *` unqualified exposure vs flat fold.** Confirm `@use … as *`
  (unqualified members) is distinct from the leaky `@import`/`@-import` fold (§C.1)
  — same *reachability*, different *provenance/isolation* rules — or whether it is
  intentionally the same splice.

---

## Invariants

1. **Boundary held.** No `tree2/` file imports `../tree` or anything Less-branded.
   The core visitor contract is `(node: tree2.Node) => tree2.Node | void`; the
   `less.tree` adapter, `LessTreeConstructors`, `toLessNode2`/`fromLessNode2`, and
   ALL module at-rule spelling knowledge live in `@jesscss/plugin-less-compat` or
   `tree2-frontend/`. Guarded by `boundary-guard.test.ts`. No `as any`.
2. **Core is Less-agnostic.** The R6 core surface is exactly: the generic
   `registerVisitor` + one `Emit.visitors` edge (enter always, exit optional) +
   the existing `ValueService` seam. Core exposes NO `less.tree`/`less.functions`
   shape and no module-at-rule spelling.
3. **Zero cost when idle.** `Emit.visitors === null` ⇒ one null-check per node, no
   behavior change; the pre-eval pre-walk is skipped entirely when the pre-eval
   registry is empty; less-compat registers NOTHING unless it has real work. A
   loaded-but-idle less-compat is cost-indistinguishable from no plugin.
4. **Replacement is output-affecting ⇒ fresh transient.** A visitor returning a new
   node produces a fresh per-position object; it never mutates a shared canonical
   node in a byte- or reuse-affecting way (ruling 1 / B2). tree2's canonical-string
   caches remain the only permitted output-invisible in-place mutation.
5. **Custom fns resolve via the value seam, never the hook.** `less.functions` are
   consulted by `ValueService.callFunction` at the `FunctionCall`'s own eval; the
   visitor hook never calls a custom function and never carries a frame.
6. **Fold vs module is a front-end decision.** All `@import`/`@-import`/`@use`/
   `@compose` resolution happens in `import-bridge.ts` before `serialize`; the
   single emit pass sees only already-resolved tree2 statements (spliced for fold,
   namespaced-scope for module).
7. **`UnsupportedShape` fail-loud (no permanent eval fallback, H2).** A module/
   compat/visitor shape tree2 cannot yet handle raises `UnsupportedShape`; it never
   silently falls back to the legacy engine.

---

## Reference

- **Plugin/visitor + less-compat.** The external contract is the
  `@jesscss/plugin-less-compat` bridge behavior over the two proof plugins:
  `less-plugin-rtl` (enter-only replace over declaration/value shapes) and
  `less-plugin-inline-urls` (optional-exit + pre-eval, rewrites `Url`/value islands
  to `Call("data-uri", …)`). R6 is correct when, with the tree2-facing
  `toLessNode2`/`fromLessNode2`, these two plugins produce byte-identical output vs
  the existing legacy-tree bridge on the same inputs. Custom-fn correctness:
  `less.functions`-registered fns produce identical values through the
  `ValueService` seam as through the current `wrapWithLessNodeArgs` path.
- **Module semantics.** Reference = the owner import/at-rule decision
  (`import-atrule-semantics-less-vs-jess`) reconciled with intended-v5 `.css`
  expected outputs and less.js `alpha` for the `@import` heuristic. Less 4.x is a
  behavior-parity reference for the `@import` heuristic ONLY, never a shape
  authority for the module forms (which are v5-new). The fold→`@compose` warning
  text is owner-defined (docs at
  `docs-content/docs/shared/02-Language/14-modules-and-imports.mdx`).
- **Proxy caution.** The legacy-tree bridge is a valid byte-reference for the
  visitor/compat path (it IS the external contract). It is NOT a reference for module
  scope (the legacy engine's `@import`-fold-everything behavior predates the
  module/fold split) — module semantics reference against owner decisions + expected outputs.

---

## Flagged for owner confirmation

1. **[R6.B1] Custom-fn registry seam shape.** Is the less-compat custom-fn map a
   *construction parameter* of the `tree2-frontend` `ValueService` impl (preferred,
   keeps the seam immutable + pure) or a *mutable `register()` method* on the
   `ValueService` interface (matches today's late `registerRootFunctions` /
   `@plugin`-injected-mid-run reality)? `@plugin` and `@use` can inject fns
   mid-render, which argues for a mutable seam or a per-render rebuild. **Needs
   owner confirmation.**
2. **[R6.C1] Module-scope representation shared with R4.** Module (`@compose`/
   `@use`) isolated-namespaced scope should reuse R4's namespace-path resolution
   (`#ns.mixin()`) rather than a parallel mechanism — confirm the sequencing:
   does R6 land module *at-rule recognition + fold-vs-module routing + warnings*
   but DEFER isolated-namespaced-member ACCESS to R4, or must R6 carry the
   namespace scope itself? Recommend: R6 routes + warns + folds; module MEMBER
   access lands with R4 namespaces. **Needs owner confirmation of the split.**
3. **[R6.C2] `@use` JS-module loading vs `javascriptEnabled`.** `@use` replaces
   Less `@plugin` (script import). Per memory `backtick-js-removed-v5`,
   `javascriptEnabled` gates `@plugin` at most. Confirm whether `@use` script
   loading is gated by `javascriptEnabled`, and whether `@use`'d module exports
   register through the SAME Part-B seams (`ValueService` custom-fns +
   visitor/pre-eval registry) or a distinct module-loader path. **Needs owner
   confirmation.**
4. **[R6.C3] `@-export`/`@forward`.** Open thread — build only node acceptance in
   R6, or full re-export lowering? Owner-rejected `as prefix-*`/`show`/`hide`.
   **Needs owner confirmation (currently: parse/accept only).**
5. **[R6.A1] Exit-edge ordering.** Registration order for exit edges (vs LIFO). No
   published plugin depends on it; recommend registration order for determinism.
   Low-stakes; flag only so it is a decision, not an accident.
6. **[R6.A2] Pre-eval compat retention.** Owner may drop pre-eval compat entirely
   (§6.9 residual). If dropped, `less-plugin-inline-urls` loses pre-eval; if kept,
   the gated pre-walk over bridge output (Part A.3) is the shape. **Needs owner
   confirmation.**

---

## Where the current tree2 MUST change (build-time deltas for R6)

Core (`packages/core/src/tree2/`) — the MINIMAL Less-agnostic surface:

- **`serialize.ts`** — add ONE `visitors: VisitorList | null` field to the internal
  `Emit` struct (`:253`), threaded like `service`/`collapse`; interpose the guarded
  enter (and optional exit) call at the per-statement emit dispatch in BOTH the
  flattened (`flatten`/`walkBody`/`emitLeaf`/`emitAtRuleBlock`) and nested
  (`emitNestedBody`/`emitNestedRule`/`emitNestedLeaf`/`emitNestedAtRuleBlock`)
  paths. Gate resolve-before-hook on `visitors !== null`.
- **New `tree2/visitor.ts`** (or fold into `serialize.ts`) — the `NodeVisitor`
  type, `VisitorList`, and `registerVisitor` on the serialize/compile context.
  Generic, zero Less knowledge. Port the pruned contract; do NOT port
  `TreeVisitor`/`preSerializeRoot`/self-driven-`Visitor.visit`.
- **`SerializeOptions`** (`serialize.ts:53`) — accept a registered visitor list
  (mirrors `valueService`/`collapseNesting`).
- **`value-service.ts` (interface)** — possibly a custom-fn registry seam per
  [R6.B1]; otherwise unchanged.

Front end (`packages/core/src/tree2-frontend/`) — boundary-legal:

- **`value-service.ts` (impl)** — wire the `less.functions` custom-fn map into the
  real `ValueService` impl (per [R6.B1]); superseded/reshaped by R2's native
  evaluator (keep the registry seam through the R2 cutover).
- **`import-bridge.ts`** — add the fold-vs-module resolution-mode switch keyed on
  at-rule spelling (`@import`/`@-import`/`@compose`/`@-compose`/`@use`/`@-use`) +
  facing (`.less`/`.jess`); the `@-import` explicit-fold path; the `.jess`
  "bare `@import` = plain CSS" rule; fold→`@compose` deprecation warnings (channel
  from R5). Module isolated-namespaced scope resolution (member access deferred to
  R4 per [R6.C1]).
- **New pre-eval pre-walk** (`tree2-frontend/`) — the gated structural pre-walk
  over bridge output feeding the `(node) => Node | void` contract (Part A.3),
  skipped when the pre-eval registry is empty.

Consumer (`packages/jess-plugin-less-compat/`) — where all Less shape lives:

- **New `toLessNode2`/`fromLessNode2`** (in `transform/`) — tree2-facing variants
  reading tree2's `kind` tag + fields instead of legacy `../tree` `Node.type`
  (`to-less.ts:50,65`); reuse `LessTreeConstructors` (`less-compat-structures.ts:284`)
  + `createLessAdapter`.
- **Register ONE generic tree2 visitor** via core's `registerVisitor`, bridging in
  its `enter`/`exit` to the wrapped Less visitors; conditional registration on
  `hasConfiguredBeforeEvalWork()` / `sourceMayContainPluginDirective`
  (`plugin.ts:206-213`).
- **Custom-fn registration** through the `ValueService` seam ([R6.B1]) instead of
  legacy `registerRootFunctions` mutating a legacy scope.

---

## Answer to the boundary question (explicit)

**Can the `less.tree` node-ctor adapter be built WITHOUT leaking the tree2
boundary? YES.** The `less.tree` constructors are already plain-object factories
in the less-compat package (`LessTreeConstructors`, `less-compat-structures.ts:284`)
— they do NOT subclass or import `../tree`. The adapter is a **downstream consumer
of tree2's public node API**: `toLessNode2` reads tree2's exported node shape and
builds a plain-object `less.tree` view; `fromLessNode2` reads the plain-object view
and constructs tree2 nodes via tree2's public constructors. Both live in the `less`
package (or `tree2-frontend`), giving a strict `less → tree2` dependency direction.
tree2-core imports nothing Less-branded and exposes only the generic
`(node) => Node | void` hook + the `ValueService` seam. The genuine-unknown flagged
in the roadmap ("whether the projection model can host `less.tree` node-ctor compat
without leaking the boundary") is **resolved in the affirmative** by the existing
plain-object-factory pattern. The only new code is the `Kind`→`less.tree`
translation table, which is boundary-legal by construction.
