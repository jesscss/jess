# R4 — Interpolation · Detached Rulesets · Merge · Namespaces/Maps (DESIGN SPEC)

> Rung R4 of the tree2 definitive rewrite
> ([`TREE2-DEFINITIVE-REWRITE-COVERAGE-AND-ROADMAP.md`](../TREE2-DEFINITIVE-REWRITE-COVERAGE-AND-ROADMAP.md) §3 R4).
> Same contract as [`TREE2-DESIGN-SPEC.md` § R0](../TREE2-DESIGN-SPEC.md): each
> feature is specified as **data model · algorithm · invariants · oracle ·
> both-emit-mode · where current tree2 must change · open owner-confirm items.**
> This is DESIGN/SPEC ONLY — no tree2 code is built by this document.
>
> Branch of record: `experiment/tree2-cleanroom-20260715`. Code citations are on
> that branch. Oracle for shapes: less.js **`alpha`** branch fixtures
> (`~/git/worktrees/less.js/**`, `tests-unit/*`), NOT Less 4.x.
>
> ⚠️ SUPERSEDED (task #36): the merge sections below describe a v5 LAST-occurrence
> anchor. The shipped `ast/` engine matches less.js's **FIRST**-occurrence anchor
> exactly (byte-identical to alpha's `merge.css`); read every "LAST-occurrence /
> the R4 target" claim in §R4.3 as the retired intent. See
> `proposed-alpha-corrections/README.md` §Merge.

---

## R4.0 — Orientation: what today's tree2 assumes, and why R4 breaks it

Four load-bearing assumptions in the current model (verified against
`serialize.ts`, `nodes.ts`, `mixin-dispatch.ts`, `tree2-frontend/bridge.ts`) are
each contradicted by exactly one R4 feature:

| Current assumption | Where | Broken by |
|---|---|---|
| `@{...}` in any position is left **literal bytes** (`parseValue` only turns `@name` into `VarRef`; a `{` after `@` is not matched by `/@([A-Za-z_][\w-]*)/`). | `bridge.ts` `parseValue` | **Interpolation** |
| A selector's canonical text is a **frame-independent** string cached once on the node (`Compound._canon`, `Complex._canon`). | `nodes.ts` `Compound.canonical()`, `Complex.canonical()` | **Interpolation (selectors)** |
| The value union has **no ruleset value** — a value is `Word\|Dimension\|SpacedValue\|VarRef\|Concat\|Operation\|FunctionCall\|Paren`. | `nodes.ts` `ValueNode` | **Detached rulesets** |
| A block's declarations **stream** to a buffer and flush verbatim, one property → one emitted line, source order. | `serialize.ts` `flushBlock` / `emitNestedLeaf` | **Merge** |
| Mixin dispatch is **flat-name** — `lookupMixinCandidates` matches `call.name` against `Frame.mixins` up the lexical chain, no path. | `serialize.ts` `lookupMixinCandidates` | **Namespaces / maps** |

R4 is therefore not additive-only: it changes the **selector canonicalization
contract** (interpolation), the **value union** (detached rulesets), the
**leaf-flush contract** (merge), and the **callable/lookup resolution** (paths).
Each subsection below states its model delta precisely so the changes compose
into one coherent pass rather than four bolt-ons.

**Dependency ordering inside R4.** Interpolation is specified first and is a hard
prerequisite for the rest: it is the piece **R1 (extend) already depends on**
(see §R4.1.7), and namespace/map key interpolation (`#ns[$@prop-name]`) reuses
its resolver.

---

## R4.1 — Interpolation `@{var}` / `$(...)` / `$[key]` — value, property, selector

### R4.1.1 Problem statement

Interpolation splices a *resolved variable/property value, unquoted, as bytes*
into a surrounding literal context. Three positions, one resolver:

- **value**: `url: "http://lesscss.org@{var}/image.jpg"` with `@var: '/dev'` →
  `url: "http://lesscss.org/dev/image.jpg"` (quotes on `@var`'s value stripped;
  surrounding string quotes kept). Oracle: `tests-unit/strings/strings.css`
  `#interpolation`.
- **property name**: `@{prefix}width: 50%` with `@prefix: ufo-` →
  `ufo-width: 50%`; `@{a}-@{bb}-@{c_c}-@{d-d4}: 2em` → `border-top-left-radius: 2em`.
  Oracle: `tests-unit/property-name-interp/property-name-interp.css`.
- **selector**: `.icon-@{type}` with `@type: 5_large` → `.icon-5_large`;
  `@{a2}` with `@a2: ~".foo"` → `.foo` (a whole selector from one variable);
  `#@{c1}-foo > .@{c2} { .@{c3} { … } }` → `#foo-foo > .bar .baz`. Oracle:
  `tests-unit/mixins-interpolated/mixins-interpolated.css`,
  `tests-unit/variables/variables.css` (`.icon-5_large`).

Related string/escape operators that resolve to the same "unquoted bytes" leaf:

- `~"…@{x}…"` — an **escaped (unquoted) string** with interpolation inside; emits
  the inner bytes with `@{x}` resolved and NO surrounding quotes. E.g.
  `~"url(/img/icon/@{type}.svg)"` → `url(/img/icon/5_large.svg)`
  (`variables.css`). `.mix-mul(@a) { color: ~"@{a}"; }` called with `blue` →
  `color: blue`.
- `e("…")` / `%("…", …)` — function forms of escape/format; these route through
  the value service (they are function calls), NOT a distinct interpolation node.
  E.g. `e('/* anything to unquote */')` → `/* anything to unquote */`
  (`css-escapes.css`). See §R4.1.6.
- **indirect variable** `@@name` — a variable whose *name* comes from another
  variable's value (`@name: var; name: @@name;`). This is a two-step `VarRef`,
  adjacent to interpolation but distinct (no braces, no quote-stripping); spec'd
  in §R4.1.6 because it shares the "resolve to a name, then look up" machinery.
- **`.jess` forms** `$(expr)` (value interpolation) and `$[key]` (map/property
  index interpolation) are the `.jess`-dialect spellings of the same two
  operations (splice-resolved-value, index-a-collection). They bridge to the
  SAME tree2 nodes as `@{…}` / `#map[key]`; only the front-end (`.jess` parser →
  bridge) differs. The `.jess` parser deliberately trails (memory
  `jess-parser-intentionally-trails`), so R4 builds the core nodes + the Less
  front-end now; the `.jess` front-end wires the identical nodes later.

### R4.1.2 Data model

Two new value leaves and one selector-model extension.

**(a) `Interp` value node** (`Kind.Interp`) — a template that resolves to bytes:

```
class Interp extends Node {
  kind = Kind.Interp
  parts: InterpPart[]           // literal chunks and embedded references, in order
}
type InterpPart =
  | { lit: string }             // verbatim bytes (incl. surrounding quote chars)
  | { ref: ValueNode; quoted: boolean }  // a resolved reference spliced UNQUOTED
```

- A plain value `"a@{x}b"` bridges to `Interp[{lit:'"a'},{ref:VarRef('x')},{lit:'b"'}]`.
  (The surrounding `"` are literal bytes; only `@{x}` is a `ref`.)
- `~"a@{x}b"` bridges to `Interp[{lit:'a'},{ref:VarRef('x')},{lit:'b'}]` — same
  shape, quotes NOT in the literal parts (escaped ⇒ unquoted output).
- `ref` is any `ValueNode` (usually `VarRef`, but `@{$@name}` etc. compose).
  `quoted:false` means: resolve the ref to bytes, then **strip one layer of
  surrounding matching quotes** before splicing (Less "unquote-on-interpolation").

> **Design note — why not reuse `Concat`.** `Concat` (`nodes.ts`) already
> concatenates `valueText` of its parts, but a `VarRef` inside a `Concat` emits
> the value bytes **as-is** (quotes preserved) and, crucially, `Concat` cannot
> distinguish `@c` (emit `@c`'s value) from `@{c}` (emit `@c`'s value *unquoted*).
> Interpolation's defining behavior is the quote-strip + the "this is a name
> fragment, not a value" contract. Keep `Interp` distinct; do NOT overload
> `Concat`. (`Concat` remains for `1px solid @c` reference substitution.)

**(b) Selector interpolation.** `Simple` (`nodes.ts`) currently carries a single
`readonly text: string` and `Compound.canonical()` sums `sim.text`. Extend
`Simple` so a token can be *either* static text *or* an interpolation template:

```
class Simple extends Node {
  kind = Kind.Simple
  text: string | null           // static token text, or null if interpolated
  interp: Interp | null         // present iff the token contains @{…}
}
```

`Compound.canonical()` / `Complex.canonical()` become **frame-parameterized** for
interpolated selectors (see algorithm). A static selector (the common case, no
`interp` anywhere) keeps the existing zero-arg cached `canonical()` verbatim —
this is a fast-path preserved by an `hasInterp` bit computed once per
`Compound`/`Complex`.

**(c) Property-name interpolation.** `Declaration.name` is a `string` today. Make
it `string | Interp`; a `@{prefix}width` name bridges to an `Interp`. At emit,
the name resolves through the same resolver before the `: `.

### R4.1.3 Algorithm

**Value resolver (one function, all positions).** Add an `Interp` arm to
`valueText` (`serialize.ts`):

```
case Kind.Interp:
  out = ''
  for part of node.parts:
    if part.lit: out += part.lit
    else:
      bytes = valueText(part.ref, frame, service, depth)
      out += part.quoted ? bytes : stripOuterQuotes(bytes)
  return out
```

`stripOuterQuotes` removes one matching leading/trailing `'…'` or `"…"` pair
only. Numbers/dimensions/colors pass through unchanged (`@var2: 256` → `256`;
`@var3: #456` → `#456`; `@var5: 54.4px` → `54.4px`, per `strings.css`).

**Selector resolution AT RULESET-ENTER (the load-bearing rule).** When
`emitNestedRule` / `flatten` enters a rule (before composing or emitting the
header), it resolves the rule's `SelectorList` to concrete strings **once, in the
current frame**:

```
ownStrings(list, frame, service):
  for each Complex c in list.selectors:
    if !c.hasInterp: out.push(c.canonical())        // cached fast path (unchanged)
    else:            out.push(resolveComplex(c, frame, service))  // frame-dependent
```

`resolveComplex` walks head + tail compounds, and for each `Simple` emits
`sim.text` if static else `valueText(sim.interp, frame, service)`. The RESULT is
a concrete canonical string identical in kind to today's cached string — it then
feeds the **exact same** downstream machinery: `compose`/`composeOne`
(flattened) or verbatim emit (nested), AND (R1) the extend target index. The
selector model's invariant "**selectors compose to interned canonical strings**"
is preserved; interpolation only moves the moment the string is produced from
*construction time* to *ruleset-enter time*, per placement.

This is why interpolated selectors resolve to a **concrete string at enter** and
not lazily at compose: an interpolated selector may be an *extend target*
(`[data=@{attr-data}]`), and the extend index (R1) keys on concrete strings; a
literal-`@{}` selector would never match. See §R4.1.7.

**Property-name resolution.** `emitLeaf` / `emitNestedLeaf` resolve
`typeof node.name === 'string' ? node.name : valueText(node.name, frame, service)`
before `put(e, name)`.

**Bridge (`parseValue`) delta.** `parseValue` must tokenize `@{name}` (and, in
`.jess`, `$(…)`/`$[…]`) BEFORE the bare-`@name` pass. Regex extension: match
`@\{\s*([^}]+)\s*\}` → an interp `ref` (its inner text re-parsed as a value node,
so `@{$@prop}` composes), and `@([A-Za-z_][\w-]*)` → `VarRef` (unchanged). A
value string containing any `@{…}` or wrapped in `~"…"` yields an `Interp`;
a value with only bare `@name` still yields `Concat`/`VarRef` (byte-unchanged).
The selector bridge (`toCompound`/`simpleText`) must likewise detect `@{…}`
inside a simple token and emit an interpolated `Simple`.

### R4.1.4 Invariants

1. **Static selectors byte-unchanged.** A rule with no `@{…}` in any token takes
   the cached `canonical()` path; `Compound._canon`/`Complex._canon` semantics
   and the entire existing byte-identity suite are untouched.
2. **One resolution per placement.** An interpolated selector resolves once per
   ruleset-enter in the entering frame; a mixin that emits an interpolated child
   resolves it in the *call* frame (so `.Person(@name,…){ .@{name}{…} }` yields
   `.person`, per `mixins-interpolated.css`).
3. **Interpolation unquotes; reference substitution does not.** `@{c}` strips one
   quote layer; `@c` (a `VarRef` in `Concat`) does not. Numbers/colors/dimensions
   splice verbatim.
4. **Resolves to the same string kind as static.** The output of interpolation
   resolution is an ordinary canonical selector string / value byte string — no
   downstream code branches on "was interpolated".
5. **Boundary held.** New nodes live in `tree2/`; `parseValue` interpolation
   tokenizing lives in the bridge (front end). No `../tree`, no `as any`.

### R4.1.5 Both emit modes

- **Flattened (`collapseNesting:true`).** `ownStrings(...,frame)` feeds
  `compose`; `#@{c1}-foo > .@{c2} { .@{c3} {c:c} }` → `#foo-foo > .bar .baz`
  (composition after resolution). Byte-identical to `mixins-interpolated.css`.
- **Nested (`collapseNesting:false`, v5 default).** `emitNestedRule` emits the
  *resolved own* selector verbatim (`.icon-5_large { … }`); no composition, same
  resolver. Property/value interpolation is emit-mode-independent (leaf-level).

The resolver is shared; the only per-mode difference is whether the resolved
string is then composed (flattened) or emitted verbatim (nested) — the exact
same fork R0 already draws for static selectors.

### R4.1.6 Adjacent operators

- **`e(...)` / `%(...)`** — function calls; already covered by `FunctionCall` +
  `ValueService.callFunction`. No new node. (`e('/* … */')` →
  `/* … */`, `css-escapes.css`.)
- **`~"…"` without interpolation** — an escaped literal; bridges to an `Interp`
  with a single `{lit}` part (or, as an optimization, a plain `Word` of the
  unquoted bytes). Either is byte-correct; prefer the `Word` fast path when the
  escaped string has no `@{…}`.
- **`@@name` indirect variable** — bridge to a new `VarIndirect` value node
  `{ nameRef: ValueNode }`; `valueText` resolves `nameRef` to a name, then
  `lookupVar(frame, name)`. Distinct from `Interp` (no quote strip, no literal
  parts). `@name: var; name: @@name` → the value of `@var`. (Small, isolated;
  could defer to a follow-up if it complicates the R4 slice — **flag**.)

### R4.1.7 THE selector-interpolation → extend dependency (R1 unblock)

**This is the piece R1 (extend) explicitly deferred and depends on.** R1's design
(roadmap §R1, "Where tree2 changes (1)") states selectors "must resolve to
concrete strings **early**, so `@{}` interpolation in selectors … must resolve at
ruleset-enter (arch D2/OQ-A) — this pulls interpolation forward as a dependency."

Oracle proof (`tests-unit/extend-selector/extend-selector.less` + `.css`):

```less
@attr-data: "test3";
[data=@{attr-data}] { extend: attributes2; }
.attribute-test    { &:extend([data="test3"] all); }
```
```css
[data="test3"],
.attribute-test {
  extend: attributes2;
}
```

The extender `.attribute-test` extends the concrete target `[data="test3"]`. For
the match to fire, `[data=@{attr-data}]` MUST have been resolved to the concrete
string `[data="test3"]` **before** extend's SOLVE phase runs. If selector
interpolation stayed literal (today's behavior), the extend index would key on
`[data=@{attr-data}]` and never match `[data="test3"]` — reference/extend of
interpolated targets would be silently dead.

**Contract R4 provides to R1:** `ownStrings(list, frame, service)` returns the
fully-resolved concrete canonical strings for a rule's selectors at ruleset-enter.
R1's PLAN phase builds its `(scope, find-target)` index over exactly these
strings; R1's `:extend(<target>)` argument is itself resolved through the same
resolver (an extend argument may also contain `@{…}`). **R4.1 must land the
`ownStrings(…, frame)` signature change and the enter-time resolution before R1's
SOLVE can be built.** (R1 was sequenced after R4-interpolation for this reason.)

### R4.1.8 Where current tree2 must change

- `node.ts`: `Kind` += `Interp`, `VarIndirect` (and see R4.4 for accessors).
- `nodes.ts`: add `Interp`, `VarIndirect`; `ValueNode` union += both; `Simple`
  gains `interp`/nullable `text` + a per-`Compound`/`Complex` `hasInterp` bit;
  `Declaration.name: string | Interp`.
- `serialize.ts`: `valueText` `Interp`/`VarIndirect` arms; `ownStrings` gains
  `(frame, service)` + `resolveComplex`; `emitLeaf`/`emitNestedLeaf` resolve
  interpolated names; the cached `canonical()` stays the no-interp fast path.
- `bridge.ts`: `parseValue` tokenizes `@{…}`/`~"…"`; selector bridge emits
  interpolated `Simple`s; declaration-name bridge emits `Interp` names.

### R4.1.9 Open owner-confirm items (interpolation)

- **Quote-strip breadth.** Confirm Less alpha strips exactly one matching outer
  quote pair and leaves inner escapes intact (`escapes: "\"hello\" \\world"`
  survives). *needs owner confirmation of intended v5 shape* for any interp
  whose resolved value itself contains quotes.
- **`@@name` inclusion in the R4 slice** vs deferral (§R4.1.6).
- **Whitespace inside `@{ … }`** — alpha appears to trim; confirm no fixture
  relies on inner spacing.

---

## R4.2 — Detached rulesets as a value type

### R4.2.1 Problem statement

A detached ruleset is a block of statements bound to a variable, passed as an
argument, and *called* to splice its body at the call site — with a specific
scope-unlock rule. Oracle: `tests-unit/detached-rulesets/detached-rulesets.less`
+ `.css`.

Core behaviors from the oracle:

- **assign + call**: `@ruleset: { color: black; background: white; }` then
  `@ruleset();` splices the two declarations.
- **as a mixin parameter**: `.wrap-mixin(@ruleset){ … @ruleset() … }` and
  `.wrap-mixin({ color: black; one: @a; });`.
- **as a default parameter**: `.mixin-definition(@a: {}; @b:{default: works;}){…}`.
- **scope unlock (the subtle rule)**: inside `.wrap-mixin`, the body has
  `@a: hidden…; @b: visible; @d: magic-frame;`, and the passed ruleset uses
  `one: @a` (its own literal binds `@a` at the call), `four: @d`. The output is
  `one: 1px` (the file-level `@a: 1px`, because the ruleset LITERAL re-declares
  `@a` locally? no — see below), `four: magic-frame` (the CALLING mixin's `@d`),
  `visible-one: visible`, `visible-two: visible`. I.e. **a detached ruleset's
  declarations evaluate with the CALLER's scope layered over the ruleset's
  DEFINITION scope**: references resolve caller-first, then definition-scope.
- **at-rule bodies**: a detached ruleset can wrap `@media` blocks and nested
  rules (`.desktop-and-old-ie({ background: red; })` → hoisted `@media` + a
  `html.lt-ie9 header` rule) — so calling one is a full body-splice, not just
  declarations.
- **recursion / re-wrapping**: `.wrap-mixin-calls-wrap(@ruleset){ .wrap-mixin(@ruleset); }`.
- **unlocking mixins**: `@my-mixins: { .mixin(){…} }; @my-mixins();` then
  `.a { .mixin(); }` — calling a detached ruleset can INTRODUCE mixin
  definitions into the calling scope (`.a { test: test; }`).

### R4.2.2 Data model

New value node (`Kind.DetachedRuleset`):

```
class DetachedRuleset extends Node {
  kind = Kind.DetachedRuleset
  body: Statement[]             // the block, stored ONCE (canonical, never cloned)
  defFrame: Frame | null        // the lexical frame captured at definition (closure)
}
type ValueNode = … | DetachedRuleset
```

`defFrame` is the closure: the frame in effect where the `{ … }` literal appears.
Because tree2 frames are immutable and never reparented (`node.ts` boundary,
arch B3), capturing a frame reference is O(1) and safe.

**Frame gains a fallback tail** to express the unlock scope precisely. Today
`Frame = { parent, mixins, vars }` is a single chain. Calling a detached ruleset
needs lookup order = **[caller chain] then [definition chain]**. Add:

```
interface Frame {
  parent: Frame | null
  mixins: Map<string, MixinDef[]> | null
  vars:   Map<string, ValueNode>  | null
  fallback?: Frame | null         // consulted after `parent` chain is exhausted
}
```

`lookupVar`/`lookupMixinCandidates` walk `parent` to the root, then, if
`fallback` is set on any visited frame, continue into it. (Equivalently: the call
frame's root `parent` is spliced to the captured `defFrame` — but an explicit
`fallback` avoids mutating shared frames.)

### R4.2.3 Algorithm

**Bridge.** A `{ … }` in value position (variable value, mixin arg, or default)
bridges to `DetachedRuleset(body = toBody(...), defFrame = null)` — `defFrame` is
filled at *definition-evaluation* time, not bridge time (the bridge has no
frame). Practically: the node stores `body` only; `defFrame` is captured when the
`VarDeclaration`/arg is first bound, by wrapping the value in a frame-capturing
thunk. Simplest concrete design: `collectVars` stores the `DetachedRuleset`
value; when a `VarRef` resolves to a `DetachedRuleset`, resolution records the
frame *that held the binding* as `defFrame` (the binding's home frame is known
during `lookupVar`). See open item R4.2.6.

**Call (`@ruleset()`).** A statement `@ruleset()` (parser: a call whose callee is
a variable) resolves `@ruleset` to a `DetachedRuleset` value, then:

```
callFrame = {
  parent: currentFrame,                       // caller scope (unlock: caller-first)
  mixins: collectMixins(dr.body),
  vars:   collectVars(dr.body),               // ruleset's own literal decls
  fallback: dr.defFrame,                       // then the definition scope
}
walkBody(dr.body, composed, callFrame, …)      // flattened
emitNestedBody(dr.body, callFrame, …)          // nested
```

This is the SAME "walk a shared body through an overlay frame, zero clone" engine
as mixin placement (`expandCall`/`expandNestedCall`) — a detached ruleset call is
mixin placement with (a) a variable-resolved body instead of a name-dispatched
one and (b) the caller frame as `parent` and `defFrame` as `fallback`. The
scope-unlock semantics fall out of `collectVars(dr.body)` (its literals) + `parent`
(caller) + `fallback` (definition). `.a { test: test; }` (unlocking mixins) works
because `collectMixins(dr.body)` publishes the ruleset's `.mixin()` into the
call frame, and the call frame is the caller's scope.

**At-rule bodies inside a detached ruleset** splice through the existing at-rule
emitters (they are just `Statement`s in `dr.body`), so `@media` hoisting/nesting
is whatever R0/R1 already do for at-rules — no special path.

**Passing as an argument / default.** `mixinParams` (bridge) already handles a
default value node; a `{ … }` default bridges to a `DetachedRuleset`. `callArgs`
already handles positional/named value nodes; a `{ … }` arg bridges to a
`DetachedRuleset`. Binding is unchanged (`bindArgs`) except that the bound value
is a `DetachedRuleset`, not a `Word` — so `bindArgs`' eager `resolveEager`
(which wraps every arg as `new Word(bytes)` in `mixin-dispatch.ts`) MUST NOT
byte-flatten a `DetachedRuleset`. **This is a real dispatch change**: args that
are detached rulesets bind by *reference*, not by resolved bytes (§R4.2.5).

### R4.2.4 Invariants

1. **Zero clone.** A detached ruleset body is stored once and walked in place
   through an overlay frame — identical to mixin placement; `clone`/`inherit`
   op-counts stay ZERO.
2. **Unlock order is caller-first, definition-fallback.** `vars`=ruleset literal,
   `parent`=caller, `fallback`=defFrame. `four: @d` → the caller's `@d`.
3. **Calling can publish mixins** into the caller scope
   (`collectMixins(dr.body)` on the call frame).
4. **A detached ruleset is a value, not a statement, until called** — it emits
   nothing when merely assigned/passed (like `VarDeclaration`/`MixinDef`).
5. **Boundary held**; the `fallback` field is neutral scaffolding, no `../tree`.

### R4.2.5 Both emit modes + dispatch interaction

- Flattened vs nested: the call splices `dr.body` through `walkBody` or
  `emitNestedBody` respectively — no detached-specific mode logic; nesting policy
  is inherited from the surrounding walk. The `header {...}` +
  `@media screen … { header {…} }` + `html.lt-ie9 header {…}` shape in
  `detached-rulesets.css` is produced by the ordinary at-rule/rule emit through
  whichever collapse policy is active.
- **`bindArgs` must not stringify ruleset args.** `mixin-dispatch.ts`
  `resolveEager(v) = new Word(resolveCaller(v))` byte-flattens every arg;
  detached-ruleset args must be excepted (bind the node itself). Add a guard:
  if `v.kind === Kind.DetachedRuleset`, bind by reference; else eager-resolve as
  today. Pattern/`@arguments` params over a ruleset arg are ill-defined — reject
  or pass-through (open item).

### R4.2.6 Where current tree2 must change

- `node.ts`: `Kind` += `DetachedRuleset`.
- `nodes.ts`: add `DetachedRuleset`; `ValueNode` union += it.
- `serialize.ts`: `Frame.fallback`; `lookupVar`/`lookupMixinCandidates` walk
  `fallback`; a `@ruleset()` call arm in `walkBody`/`emitNestedBody` (parser
  emits this as a distinct call kind — see bridge); `valueText` for a
  `DetachedRuleset` in non-call position is an error/empty (a ruleset is not
  byte-serializable as a value).
- `mixin-dispatch.ts`: `bindArgs` binds `DetachedRuleset` args by reference.
- `bridge.ts`: recognize `{ … }` value literals → `DetachedRuleset`; recognize
  `@name()` call-of-variable → a detached-ruleset call statement (today `Call`
  bridges only to `MixinCall`); `defFrame` capture strategy (see below).

### R4.2.7 Open owner-confirm items (detached rulesets)

- **`defFrame` capture mechanics.** The clean options: (a) capture at
  binding-resolution time (the home frame of the binding is known in
  `lookupVar`); (b) a small frame-capturing thunk value. Pick the one that keeps
  `collectVars` pure. *needs design decision*, not owner — but flag if it forces
  a `Frame` mutation (it should not).
- **Detached ruleset as a pattern/`@arguments` arg** — undefined; confirm reject
  vs pass-through. *needs owner confirmation.*
- **Error parity.** `tests-error/eval/detached-ruleset-{1,2,3,5}.txt` define
  out-of-scope-call and calling-a-non-ruleset errors; R4 should raise
  `UnsupportedShape`/a typed error matching those, but exact message parity is a
  R5/error-reporting concern, not R4 byte-output. Flag: do NOT silently emit.

---

## R4.3 — Merge `+` / `+_` (⚠️ SUPERSEDED: shipped as FIRST-occurrence, task #36)

### R4.3.1 Problem statement

`prop+: v` and `prop+_: v` accumulate multiple declarations of the same property
into one combined value: `+` joins members with `, ` (comma), `+_` joins with
` ` (space). Only `+`/`+_` declarations merge; a plain `prop:` does not merge with
them (CSS back-compat). Oracle: `tests-unit/merge/merge.{less,css}` — **but the
committed `merge.css` golden encodes Less's FIRST-occurrence anchor; Jess v5 uses
LAST-occurrence (owner)**, so the golden's *emit order* is a candidate for owner
update, NOT the tree2 target (see §R4.3.4).

Less-alpha golden (first-occurrence) for the interleaved case:

```less
.test-rule-interleaved {
  transform+:  t1; background+: b1; transform+:  t2;
  background+: b2, b3; transform+:  t3;
}
```
```css
/* less alpha (first-occurrence anchor) */
.test-rule-interleaved {
  transform: t1, t2, t3;
  background: b1, b2, b3;
}
```

Here `transform` emits before `background` because `transform`'s FIRST `+:`
precedes `background`'s first. **Jess v5 anchors the combined line at each
property's LAST occurrence**, which reorders this to:

```css
/* jess v5 (last-occurrence anchor) — the R4 target */
.test-rule-interleaved {
  background: b1, b2, b3;
  transform: t1, t2, t3;
}
```

(`transform`'s last `+:` is `t3`, after `background`'s last `b2, b3`; so
`background` anchors earlier.) **Member order within a property is unchanged
(source order); only the property's LINE position moves to its last member.**
The `background: b1 b2, b3` spaced/comma mixing in `test-rule-spaced` /
`test-rule-interleaved-with-spaced` shows `+`/`+_` interleave: each member keeps
its own joiner, so `t1s`(`+_`) `t2`(`+`) `t3s`(`+_`) → `t1s, t2 t3s` (a `+_`
member glues to the previous with a space, a `+` member starts a new comma
group). This joiner-interleave semantics is **independent of the anchor** and
matches the golden's *content* (only line order differs under last-occurrence).

`!important` correctness case: `test-rule7` has three `.second-transform()` calls,
the middle one `!important`; output `transform: scale(2,4), scale(2,4), scale(2,4) !important;`
— **any member's `!important` promotes the whole combined line** (project memory
`spine-merge-last-occurrence-anchor`: the spine bug that dropped a middle/first
member's `!important` was fixed; the combined value takes `!important` if ANY
member has it). tree2 carries `!important` in value bytes today
(`bridge.ts` `rawDeclValue`), so R4 must detect `!important` on ANY member and
place exactly one `!important` at the end of the combined value.

### R4.3.2 Data model

`Declaration` gains a merge marker (bridged from the `+`/`+_` suffix on the
property name):

```
class Declaration extends Node {
  kind = Kind.Declaration
  name: string | Interp
  value: ValueNode
  merge: null | ',' | ' '        // null = normal; ',' = `+`; ' ' = `+_`
  important: boolean              // parsed out of the value bytes at bridge time
}
```

> `important` is promoted to a structured flag (from today's "bytes carry
> `!important`") *specifically because* merge must OR it across members and emit
> it once. This also resolves the §4 R-important risk (custom-prop `!important`
> survival) for merged props. Non-merged declarations may keep carrying it in
> bytes for byte-stability — but a structured flag is cleaner and R4 needs it
> anyway; **flag as a small owner-visible model choice**.

### R4.3.3 Algorithm (emit-time, per block, last-occurrence anchor)

Merge is an EMIT-time fold over a single block's leaf group — it fits the existing
`flushBlock` / `emitNestedBody` buffer, extended:

1. **Buffer pass (already exists).** As a block's statements are walked, leaves
   accumulate (`group: Leaf[]` in `flushBlock`; the nested path emits inline —
   see §R4.3.4 for the nested-mode buffering change). Merge needs the WHOLE
   block's leaves before it can place a combined line at the last occurrence, so
   the nested path must also buffer a block's direct leaves (it currently streams
   them). This is the arch-D5 "per-subject buffer + flush discipline" already
   flagged for R1; R4-merge and R1-extend share it.
2. **Group merge members.** Partition the buffered leaves into: non-merge
   declarations (emit verbatim, in place) and merge declarations grouped by
   resolved property name. For each merge group, in SOURCE order, concatenate
   members: the first member starts the value; each subsequent member appends
   `<joiner><member-value>` where `<joiner>` is THAT member's own marker (`,` →
   `, `, `_` → ` `). `important = OR(members.important)`.
3. **Anchor at LAST occurrence (v5).** The combined declaration is emitted at the
   position of the group's LAST member in the block's leaf order; all other block
   leaves keep their positions. Concretely: walk the buffered leaves in order; a
   non-merge leaf emits immediately; a merge leaf emits the combined line ONLY
   when it is the last member of its group (earlier members emit nothing). This
   yields last-occurrence line placement with source-order members.
4. **Emit** `name: combinedValue[ !important];`.

**Only `+`/`+_` merge.** A plain `prop:` (`merge:null`) between merge members does
NOT join and does NOT reset the group — it emits as its own line at its own
position (see `test-rule2`: `.first-transform()` is `+:`, `.third-transform()` is
plain `transform:` → two lines `transform: rotate…, skew…;` then
`transform: scaleX(45deg);`). So grouping is by `(name, merge!=null)`; a plain
same-name decl is a separate, unmerged leaf.

**Cross-source merge** works because members come from spliced mixin bodies
(`test-rule1` merges `.first-transform()`'s `transform+:` with
`.second-transform()`'s) — the buffer sees them after mixin expansion, so no
special handling: merge folds the *expanded* leaf stream.

### R4.3.4 Both emit modes + the buffering change

- **Flattened.** `flushBlock` already buffers `group: Leaf[]`; add the merge fold
  before it emits leaves. Straightforward.
- **Nested (v5 default).** `emitNestedBody` currently **streams** leaves
  (`emitNestedLeaf` per node) and interleaves them with nested rules in source
  order. Merge needs the block's direct leaves buffered to place the combined
  line at last-occurrence. Change: `emitNestedBody` buffers *consecutive direct
  leaves* into a group, folds merges, and flushes the group when a nested
  rule/at-rule/mixin-with-rules interrupts (to preserve leaf-vs-nested source
  order). A merge group does NOT span across an interrupting nested rule (Less
  merges within a rules block; a nested child is a new block). **This is the same
  buffer+flush discipline R1 needs; build it once here.**
- **Anchor is emit-time and mode-independent**: last-occurrence line placement is
  computed on the buffered leaf order identically in both modes.

### R4.3.5 Invariants

1. **Last-occurrence line placement (v5, owner).** A merged property's combined
   line sits at its last member's position; members stay in source order.
2. **`!important` promotes from ANY member**, emitted once at the end.
3. **Only `+`/`+_` merge; plain decls never merge and never break a group's
   source-order membership** (they are separate leaves).
4. **`+` = comma, `+_` = space, per-member joiner** (interleave preserved).
5. **Merge folds the expanded leaf stream** (post-mixin/detached splice), so
   cross-source merge is automatic.
6. **Boundary held.**

### R4.3.6 Where current tree2 must change

- `node.ts`: no new Kind (Declaration extended in place).
- `nodes.ts`: `Declaration` += `merge`, `important`.
- `serialize.ts`: a `mergeFold(group)` helper invoked by `flushBlock` and by
  `emitNestedBody`'s new leaf-buffer; nested-mode leaf buffering + flush-on-nested.
- `bridge.ts`: parse `+`/`+_` off the property name → `merge`; parse trailing
  `!important` off the value → `important` (both from the declaration source).

### R4.3.7 Open owner-confirm items (merge)

- **`merge.css` golden update.** The committed golden is first-occurrence
  (Less). Under v5 last-occurrence the *line order* differs for
  `test-rule-interleaved` / `test-rule-spaced` / `test-rule-interleaved-with-spaced`.
  **The golden is an owner-update candidate** (memory: flag, don't edit). R4's
  byte-oracle for these three cases must be the intended last-occurrence output,
  NOT the current golden. *needs owner confirmation of the exact v5 line order*
  for the interleaved-with-spaced case.
- **Whether `important` becomes a structured field for ALL declarations or only
  merged ones** (§R4.3.2). *owner-visible model choice.*
- **`+`/`+_` at the top level / in at-rule direct bodies** — same fold applies;
  confirm no shape (e.g. `@media` direct decls) is excluded.

---

## R4.4 — Namespaces / accessors `#ns.mixin()`, `#map[key]`, indexed access

### R4.4.1 Problem statement

Two related lookups beyond flat mixin names:

- **Namespaced mixin call**: `#namespace .borders()`, `#theme > .mixin()`,
  `#namespace .biohazard .man()`, chained `#foo-foo > .bar.baz()`. The call
  descends a *path* of selectors into nested rulesets to find the mixin. Oracle:
  `tests-unit/mixins/mixins.{less,css}`.
- **Map / property accessor**: `@p[text]` (index a ruleset-valued/`.mixin()`
  variable by a property name → that declaration's value), `#namespace[$@prop-name]`
  (index a namespace ruleset by an interpolated property name),
  `@color-schemes[@@color-name]`, `@scheme[@color]`. Oracle:
  `tests-unit/mixins/maps.{less,css}`, `tests-unit/namespace-targeted/*`,
  `tests-unit/functions-each/functions-each.less`.

Oracle shapes:

```less
// mixins.less (namespaced call, flattened golden)
#namespace { .borders { border-style: dotted; } }
#theme { > .mixin { background-color: grey; } }
#container { .mixin(); #theme > .mixin(); }
.direct { #namespace > .borders(); }
```
```css
.direct { border-style: dotted; }          /* #namespace > .borders() resolved */
/* #container gets #theme > .mixin() → background-color: grey; */
```

```less
// maps.less
.maps {
  .mk-map() { text: white; background: black; }
  @p: .mk-map();
  h1 { color: @p[text]; }     // → white
}
```
```css
.maps h1 { color: white; }
```

```less
// namespace-targeted.less  (interpolated map key)
@prop-name: my-prop;
#namespace { my-prop: prop-value; }
.test-prop-interp { value: #namespace[$@prop-name]; }  // → prop-value
```

Indexing supports **property name** (`[text]`, `[$prop]`), **interpolated name**
(`[$@var]`, `[@@name]`), and (Less v5) **numeric + negative index**
(`[1]`, `[-1]`) over a ruleset/list's declarations. (No numeric-index fixture in
tests-unit; sourced from the v5 map grammar — **flag as source-not-assert**.)

### R4.4.2 Data model

**Namespace path** — a call/mixin definition can be *nested inside a ruleset
whose selector is a namespace* (`#namespace`, `#theme`). Nothing new is needed on
`MixinDef`; the change is in *resolution* (§R4.4.3): the lookup must descend into
a matching ruleset's body scope. To resolve a path efficiently, `Frame` should
expose the RULESETS visible in a scope keyed by their (composed-own) selector, not
only their mixins. Add:

```
interface Frame {
  …
  rulesets: Map<string, Rule[]> | null   // own-selector-string → rules at this level
}
```

populated by a `collectRulesets(statements)` alongside `collectMixins`. A
namespaced call `#ns .a .b()` walks: resolve `#ns` in `rulesets`, enter its body's
frame, resolve `.a`, enter, resolve `.b` as a mixin.

**Namespaced call node** — extend `MixinCall` with an optional path prefix:

```
class MixinCall extends Node {
  kind = Kind.MixinCall
  path: PathSeg[]               // e.g. [{comb:' ',sel:'#namespace'},{comb:'>',sel:'.borders'}]
  name: string                 // final mixin name (last segment)
  args: CallArg[]
}
type PathSeg = { comb: Combinator; sel: string }
```

A plain `.mixin()` has `path: []` (byte-unchanged flat dispatch).

**Map accessor value node** (`Kind.MapAccessor`):

```
class MapAccessor extends Node {
  kind = Kind.MapAccessor
  base: ValueNode              // VarRef('p') | a namespace ref (#namespace)
  key: ValueNode | number      // property-name value (may be Interp) or numeric index
  keyIsProp: boolean           // true for `[$prop]`/`[name]`; false for numeric
}
type ValueNode = … | MapAccessor
```

### R4.4.3 Algorithm

**Namespaced mixin call.** New `resolveNamespacedCall(call, frame)`:

```
scopeFrame = frame
for seg in call.path:
  rules = lookupRulesets(scopeFrame, seg.sel)        // matches seg.sel by own-string
  if none: return []                                  // unknown namespace → nothing
  // enter the (union of) matching rules' bodies as one scope layer
  scopeFrame = { parent: scopeFrame, mixins: collectMixins(bodies),
                 rulesets: collectRulesets(bodies), vars: collectVars(bodies) }
candidates = scopeFrame.mixins.get(call.name) ?? []    // final flat dispatch here
return selectDefinitions(candidates, call, …)          // same guard/arity/pattern path
```

The combinator in `seg.comb` (`>` in `#theme > .mixin()`) constrains matching to
direct-child rulesets; a descendant space matches nested-at-any-depth (Less
allows `#namespace .biohazard .man()` to descend two levels). The FINAL segment
dispatches as an ordinary mixin (arity/pattern/guards via `selectDefinitions` —
reuse verbatim). Bodies expand through the SAME overlay-frame engine (zero clone).

Note: a namespaced call's mixin runs with the NAMESPACE's scope as its lexical
parent (Less closure semantics — `mixins-closure` fixture), so `scopeFrame` (the
descended frame) is the mixin body's `parent`, not the call site. Confirm against
`mixins-closure.css`.

**Map accessor (`valueText` arm).** `resolveMapAccessor(node, frame, service)`:

```
baseVal = resolve node.base to a ruleset-like scope:
  - VarRef('p') where @p = .mk-map() (a mixin call value) → the mixin's body decls
  - VarRef bound to a DetachedRuleset → its body decls
  - a #namespace ref → the namespace ruleset's body decls
decls = the declarations of that body (name → value), + numeric list of members
key = node.keyIsProp ? valueText(node.key, frame, service)   // resolves Interp/@@ 
                     : node.key (numeric; negative → count from end)
match = keyIsProp ? decls.byName(key) : decls.byIndex(key)
if none: ERROR (namespace-property-not-found parity) — do NOT emit literal
return valueText(match.value, matchFrame, service)
```

`@p[text]` → the `text: white` declaration's value → `white`. `#namespace[$@prop-name]`
resolves `$@prop-name` (interp) → `my-prop`, indexes → `prop-value`. The key
resolver is R4.1's `valueText(Interp)` — **map keys reuse the interpolation
resolver**, which is why R4.1 is spec'd first.

`@p: .mk-map()` (a mixin-call-as-value) requires evaluating the mixin body to a
declaration set — this is the same body-walk, captured into a name→value map
instead of emitted. Design: a `evalToDeclMap(body, frame)` that runs the walk in
"collect" mode (no output, gather declarations). Reuses the walk; new sink.

### R4.4.4 Invariants

1. **Flat dispatch unchanged.** `path:[]` calls take the existing
   `lookupMixinCandidates` path verbatim; every current mixin test byte-stable.
2. **Path descent = scope layering**, resolved through `rulesets` maps; final
   segment dispatches via the unchanged `selectDefinitions`.
3. **Zero clone.** Namespaced bodies expand through the overlay-frame engine.
4. **Map miss is an ERROR, not a literal emit** (parity with
   `namespace-*-not-found`); never silently pass `@p[text]` through.
5. **Map keys use the interpolation resolver** (shared with R4.1).
6. **Boundary held**; `rulesets`/accessor nodes are tree2-native.

### R4.4.5 Both emit modes

- Namespaced calls emit their resolved body through the active collapse policy
  (flattened composes the mixin body's nested rules with the call-site selector;
  nested splices them under the call site) — identical to plain mixin placement,
  no namespace-specific mode logic.
- Map accessors are leaf value resolution — emit-mode-independent.

### R4.4.6 Where current tree2 must change

- `node.ts`: `Kind` += `MapAccessor`.
- `nodes.ts`: `MixinCall` += `path`; add `MapAccessor`; `ValueNode` += it.
- `serialize.ts`: `Frame.rulesets` + `collectRulesets`; `lookupRulesets`;
  `resolveNamespacedCall` (called from `walkBody`/`emitNestedBody` when
  `call.path.length>0`); `valueText` `MapAccessor` arm; `evalToDeclMap` collect
  sink.
- `mixin-dispatch.ts`: unchanged (final-segment dispatch reuses
  `selectDefinitions`); `lookupMixinCandidates` stays for flat calls.
- `bridge.ts`: bridge a namespaced call selector-path (parser `Call` with a
  namespace/selector callee) → `MixinCall.path`; bridge `base[key]` →
  `MapAccessor` (key may be `$prop`/`$@var`/`@@name`/numeric).

### R4.4.7 Open owner-confirm items (namespaces/maps)

- **Numeric + negative index over rulesets** has no tests-unit fixture; the
  syntax/semantics are **sourced from the v5 map grammar, not asserted** —
  *needs owner confirmation of intended v5 shape* (esp. what a negative index
  counts over: all decls? only same-name? list members?).
- **Closure parent of a namespaced mixin** (namespace scope vs call-site scope) —
  verify against `mixins-closure.css`; *flag if the fixture disagrees.*
- **`@p: .mk-map()` (mixin-call-as-map-value) evaluation timing** — lazy on first
  index vs eager; pick lazy (matches Less), *confirm.*
- **Guarded / parametric namespace segments** (`#ns(@x) .m()`) — out of the
  tests-unit corpus; defer + flag.

---

## R4.5 — Cross-feature summary

### R4.5.1 New / changed tree2 node model (all four features)

| File | Change |
|---|---|
| `tree2/node.ts` | `Kind` += `Interp`, `VarIndirect`, `DetachedRuleset`, `MapAccessor`. |
| `tree2/nodes.ts` | add `Interp`, `VarIndirect`, `DetachedRuleset`, `MapAccessor`; `ValueNode` union += all four; `Simple` gains `interp`/nullable `text` + `hasInterp` bit on `Compound`/`Complex`; `Declaration` += `name: string\|Interp`, `merge`, `important`; `MixinCall` += `path`. |
| `tree2/serialize.ts` | `Frame` += `fallback`, `rulesets`; `valueText` arms (Interp, VarIndirect, DetachedRuleset-in-non-call=error, MapAccessor); `ownStrings(…, frame, service)` + `resolveComplex` (enter-time selector resolution); interpolated property names; `mergeFold` in `flushBlock` + nested-mode leaf buffering; detached-ruleset call arm; `resolveNamespacedCall`; `collectRulesets`/`lookupRulesets`; `evalToDeclMap`. |
| `tree2/mixin-dispatch.ts` | `bindArgs` binds `DetachedRuleset` args by reference (skip byte-flatten). |
| `tree2-frontend/bridge.ts` | `parseValue` tokenizes `@{…}`/`~"…"`/`base[key]`; selector bridge emits interpolated `Simple`s; `{…}` value → `DetachedRuleset`; `@name()` → detached call; `+`/`+_`/`!important` → `merge`/`important`; namespaced call path → `MixinCall.path`. |

### R4.5.2 The one contract R4 owes R1 (selector-interpolation → extend)

`ownStrings(list, frame, service)` resolves a rule's selectors to concrete
canonical strings **at ruleset-enter**, so an interpolated target
(`[data=@{attr-data}]` → `[data="test3"]`) is a concrete string BEFORE R1's SOLVE
builds its target index. Landing this signature change + enter-time resolution is
a **prerequisite for R1 SOLVE**. (§R4.1.7 has the oracle proof.)

### R4.5.3 Shared machinery R4 introduces that later rungs reuse

- **Per-block leaf buffer + flush discipline** (merge §R4.3.4) is the arch-D5
  buffer R1-extend also needs — build once.
- **Interpolation resolver** (`valueText(Interp)`) is reused by map keys (§R4.4)
  and by `.jess` `$(…)`/`$[…]` (R7 front-end).
- **`Frame.fallback`** (detached unlock) is a general secondary-scope mechanism;
  **`Frame.rulesets`** (namespace paths) generalizes lookup beyond mixins.

### R4.5.4 Consolidated open owner-confirm items

1. Interpolation quote-strip breadth on values that themselves contain quotes
   (§R4.1.9).
2. `@@name` indirect-variable inclusion in the R4 slice vs deferral (§R4.1.6/9).
3. Detached ruleset as a pattern/`@arguments` arg (§R4.2.7).
4. `important` structured field for ALL declarations vs merged-only (§R4.3.2/7).
5. **`merge.css` golden update** to v5 last-occurrence line order for the
   interleaved cases — owner-update candidate, and the exact
   interleaved-with-spaced order needs confirmation (§R4.3.7).
6. Numeric/negative map index semantics — no fixture, sourced from grammar, needs
   confirmation (§R4.4.7).
7. Namespaced-mixin closure parent (namespace vs call-site) — verify vs
   `mixins-closure.css` (§R4.4.7).

### R4.5.5 Oracle policy note

All four features' shapes are sourced from less.js **alpha** `tests-unit`
fixtures (`~/git/worktrees/less.js/**`), reconciled with the owner `.css`
goldens — NOT Less 4.x, NOT the legacy tree render. The single deliberate
divergence is **merge = last-occurrence** (owner), where the alpha golden's line
order is a candidate for owner update rather than the tree2 target. Where a Jess
behavior may diverge from Less/Sass and no owner ruling exists, items are marked
*needs owner confirmation of intended v5 shape* above — none is asserted as a bug.
