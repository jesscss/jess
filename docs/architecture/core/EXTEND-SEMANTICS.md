# Extend semantics (canonical behavior reference)

This is the contributor-facing behavior reference for Jess's `extend` feature —
the sibling of `VARIABLE-RESOLUTION-SEMANTICS.md`. It documents the INTENDED v5
behavior with a worked example for every rule, each lifted from a test fixture.

## Reference policy (read first)

The behavior below is anchored on two references, NOT on the current engine:

1. **The extend fixtures** in less.js `alpha`
   (`packages/test-data/tests-unit/<fixture>/{<fixture>.less,<fixture>.css}`),
   rendered and gated by the Less fixture lane
   (`packages/jess/test/less/all-less.test.ts`) and
   `packages/jess/test/less/extend-exact-oracle.test.ts`, both applying the pending
   golden edits in `packages/jess/test/less/pending-golden-edits.ts`.
   The `alpha` TOP-LEVEL `.css` (with `:is()` compaction) is the intended v5
   output.
2. **Owner-confirmed corrections** in
   `docs/architecture/core/proposed-alpha-corrections/` for the two
   places where alpha's hand-converted NESTED expected output carries a known bug
   (`extend.css`, `extend-exact.css`; see the corrections `README.md`).

Do NOT treat the legacy `tree/extend/**` renderer (`renderRealOracle`) as a
correctness reference — it has known nested-extender bugs. The clean-room engine is
`packages/core/src/ast/extend/` (barrel: `packages/core/src/ast/extend.ts`), split
into `ir` / `compose` / `match` / `plan` / `solve` / `emit`; read it for the feature
surface, not the correctness answer. Corpus/differential coverage lives in
`packages/core/src/tree/extend/__tests__/` and the cross-`@import` output reference
in `packages/jess/test/less/extend-cross-import.test.ts`.

Every fixture snippet below is `<fixture>.less` → `<fixture>.css` from `alpha`
unless it names a `proposed-alpha-corrections/` file.

---

## 1. What extend is

`extend` merges the selector it is attached to onto every selector that matches
its target, *wherever that target appears in the compiled CSS*. It is the
opposite direction of a mixin: instead of copying the target's declarations into
the extender, it copies the extender's *selector* up to the target's rule.
Matching runs against the **compiled** selectors (after nesting is resolved), not
the source text (`extend.md`, "Essentially the extend looks at the compiled
css").

The `:extend()` clause itself is never emitted — it is stripped before output.

## 1a. Architectural law — extend consumes resolved static shapes (HARD RULE)

Extend runs on the output of the **one** evaluator. By the time extend matches or
rewrites anything, every mixin has already been expanded, every function already
called, every loop already iterated, every variable already resolved, and every
selector already composed — by the single render walk. Extend's whole job is the
last sentence of §1: **extend selectors.** It appends the extender's compiled
selector onto the target's compiled selector list, and does nothing else.

Therefore extend collection and the extend engine (`packages/core/src/ast/extend/**`
and any extend-fact collection in `serialize.ts`) **MUST NOT re-drive evaluation.**
Specifically they may never call — directly or transitively — the evaluator
entrypoints `expandCall` / `expandApply` / `expandReferenceCall` / `expandFor` /
`expandRule` / `forItems` / `bindForEntry` / `activateVariableDeclaration`, nor
re-expand a mixin body, re-run a loop, or re-resolve a selector to discover an
extend placement. A rule inside a mixin-call body or a loop body is reached the
one time the real walk expands it; its extend facts are recorded **at that
moment**, keyed to the slot being emitted. There is no "extend preflight" that
walks the program a second time.

**Why this is not negotiable.** A second evaluation is not merely slow — it is
*unsound*: mixins with side-effecting `@name` reassignment, `::=` optional-shadow,
guard evaluation order, and once-only imports do not produce identical facts on a
second pass, so a cold twin can silently disagree with the real output. It also
scales the whole program's evaluation cost by the number of passes. Extend is a
selector rewrite over already-computed shapes; anything more is a defect. See the
class rule in `.cursor/rules/20-quality-bar.mdc` ("single pass over resolved
shapes") and ledger row X13 in `DESIGN-DECISIONS.md`.

**How the one pass satisfies "compute extends before you emit the target."** A
target can be defined ahead of the extender that augments it, so the augmented
selector list is not known when the target's header is first produced. This is
resolved by a **deferred rewrite**, never by a look-ahead second evaluation: the
walk emits selector headers as addressable slots into the render buffer and records
extend facts inline; after the single walk completes, the extend engine folds each
extender's compiled selector into the target slots (held **by reference** — a
nested `&` holds a reference to the parent's composed selector, it is not
re-flattened per rule); then the buffer is stringified. Match-time flattening is
lazy and cached, and only for the selectors that actually participate in a match.

This law is enforced by `extend-evaluator-isolation.test.ts` (a source-frontier
gate: the extend paths may not name an evaluator entrypoint).

## 2. Forms

| Form | Syntax | Notes |
|------|--------|-------|
| Attached to selector (Less) | `.a:extend(.b) {}` | extend clause must be LAST in the selector |
| Space before clause (Less) | `.a :extend(.b) {}` | whitespace allowed |
| Inside a ruleset body (Less) | `.a { &:extend(.b); }` | shorthand for attaching to every selector of the ruleset |
| Multiple targets (Less) | `.a:extend(.b, .c) {}` | == two separate `:extend` clauses |
| **Jess statement** | `$extend .b;` / `$extend .b !exact;` | Jess-native body statement — see §4 |

The body form is exactly equivalent to attaching the clause to each selector of
the ruleset (`extend.md` "Extend Inside Ruleset"):

```less
pre:hover, .some-class { &:extend(div pre); }
// ≡
pre:hover:extend(div pre), .some-class:extend(div pre) {}
```

Grammar: the Jess `$extend` statement is `packages/jess-parser/src/grammar.ts`
(search `$extend`); the core node is `Extend { target, flag }` with the parsed
`ExtendInstruction { partial }` surfaced in `packages/core/src/ast/nodes.ts` and
consumed by the engine under `packages/core/src/ast/extend/`.

## 3. Exact match (default) vs `all` (partial)

Two matching modes, selected by the `all` keyword:

- **Exact (default, no `all`)** — matches only where the target is the *whole*
  compiled selector. The extender is APPENDED to the matched rule's selector
  list.
- **`all` (partial)** — matches the target *wherever it appears as part of* a
  selector, and substitutes the matched span IN PLACE. In v5 this substitution
  grafts `:is(<matched>, <extender…>)` into the matched compound (see §5).
  `extend.md` calls this "a non-destructive search and replace."

`extend-clearfix.less` → `.css` (FLAT default) shows `all`:

```less
.clearfix { *zoom: 1; &:after { content: ''; display: block; clear: both; height: 0; } }
.foo { &:extend(.clearfix all); color: red; }
.bar { &:extend(.clearfix all); color: blue; }
```
```css
.clearfix, .foo, .bar { *zoom: 1; }
:is(.clearfix, .foo, .bar):after { content: ''; display: block; clear: both; height: 0; }
.foo { color: red; }
.bar { color: blue; }
```

Where the target is the whole compound (`.clearfix`), the extenders simply join
the selector list. Where the target is part of a compound (`.clearfix:after`),
the matched span is wrapped `:is(.clearfix, .foo, .bar):after`.

Exact-match strictness (from `extend.md`, "Exact Matching with Extend" — not
individually fixture-gated here, flagged in §12):

- Leading star matters: `*.class` ≠ `.class`.
- Pseudo-class order matters: `link:hover:visited` ≠ `link:visited:hover`.
- `nth` form matters: `1n+3` ≠ `n+3`.
- Attribute-selector quote type does NOT matter: `[t=x]` ≡ `[t='x']` ≡ `[t="x"]`.

## 4. Jess `$extend` — inverted default + `!exact`

The Jess statement form flips the Less default. Per
`packages/jess-parser/src/grammar.ts`:

> `$extend <target> [!exact];` — Jess/Sass default is a partial (`all`) match;
> `!exact` flips it to Less's exact match.

So `$extend .b;` behaves like Less's `:extend(.b all)`, and `$extend .b !exact;`
behaves like Less's `:extend(.b)`. `partial` in `ExtendInstruction` is `true`
for `all` (parser flag 0) and `false` for exact. Targets may be a complex/
compound/simple selector (including `&`, interpolation, and namespaced `ns|.sel`)
or a variable reference; a comma list gives multiple targets.

## 5. `:is()` grafting / compaction (v5)

v5's headline divergence from Less 4.x: instead of DUPLICATING the matched rule
once per extender (4.x's expanded form, preserved in each fixture's
`legacy/<fixture>.css`), v5 GRAFTS a single `:is()` group into the matched
compound position.

`extend-clearfix` again: 4.x `legacy` emits `.clearfix:after, .foo:after,
.bar:after`; v5 emits `:is(.clearfix, .foo, .bar):after`. This is why
`legacy/*.css` is NOT a v5 reference.

Two compaction behaviors:

- **Whole-compound match → list append** (no `:is()` needed): `.error, .badError`.
- **Partial (in-compound) match → `:is()` graft**: `:is(.error, .badError).intrusion`.

`extend.less` (NESTED) demonstrates both from one `all` extender:

```less
.error { border: 1px #f00; background: #fdd; }
.error.intrusion { font-size: 1.3em; font-weight: bold; }
.intrusion .error { display: none; }
.badError { &:extend(.error all); border-width: 3px; }
```
```css
.error, .badError { border: 1px #f00; background: #fdd; }
:is(.error, .badError).intrusion { font-size: 1.3em; font-weight: bold; }
.intrusion :is(.error, .badError) { display: none; }
.badError { border-width: 3px; }
```

**Guarded grouping (ledger X3 and O10, both amended by the owner 2026-10-05).**
Extend's own `:is()` groups — the `all` graft and sibling compaction (§7c) — keep
native specificity, matching and
invalid-selector behaviour, by the SAME rule `collapseNesting: 'native'` folds a
nested child list by, and in EVERY output mode (nested, `'native'` and `'compact'`;
extend grouping is not mode-coupled). One module owns that rule:
`packages/core/src/ast/is-grouping.ts` (specificity, the "may this branch sit inside
`:is()`" check, and the partition into groups); the serializer's `opaqueJoin` and
the extend engine both call it.

- Members of one `:is()` share one Selectors-4 §17 specificity. A group that would
  mix specificities splits into equal-specificity groups, gathered across
  non-adjacent members (branch order inside one selector list changes neither the
  cascade nor specificity) and emitted in order of first appearance.
- A member that cannot sit inside `:is()` — a pseudo-element, a pseudo-class outside
  the standard allowlist, a token the parser did not build one-to-one (a `&` replaced
  by its parent's text, a dynamic extender's composed text: its kind would have to be
  read back out of serialized text), or a complex member the group does not lead
  with — is written as its own branch in the Less 4.x expanded form: the simples
  before the group join the member's FIRST compound and those after it its LAST
  compound (`.a > .m:is(.c, .p .q).n` → `.a > .m.p .q.n`). Each joined compound is made
  valid: the type selector leads and a repeated type is written once (`div` + `div.b`
  → `div.b`, where 4.x wrote `divdiv.b`); a member that would need two element types
  matches no element and is dropped (4.x wrote `divspan`).
- A group may hold a complex member only where it leads the whole selector: first in
  the head compound of a top-level header. Only there `:is(.t .b).k .box` matches what
  the expanded `.t .b.k .box` does; `.p :is(.x .y)` would let `.x` sit above `.p`, and
  `.m:is(.p .q)` is `.p .m.q` where 4.x's `.m.p .q` is meant. A nested header has an
  implicit `&` before it, so it never leads.
- A group nested in a member (a chained extend, `.j.k:extend(.c all)` then
  `.p .q:extend(.j all)`) is checked as an `:is()` argument first, and again where the
  member lands when the outer group splits: with `.r .s:extend(.j all)` too,
  `.a > .c` gives `.a > .p .q.k, .a > .r .s.k`, never `.a > :is(.p .q, .r .s).k`.
- The solve keeps each group whole (later instructions chain through it as one set of
  alternatives); the split happens once, as a header is emitted (`emit.ts`
  `groupedBranches`). Only extend-built groups (`Simple.fold`) split. An authored
  `:is()` and the nesting `:is(parents)` token keep their arms as one list: an arm whose
  extend group split keeps its first alternative there (the one holding the matched
  selector, at the arm's own specificity), and every other alternative replaces the
  whole `:is()` on its own — returned to the list it would raise elements the extend
  never touched (`:is(.c.k, .z) .d` + `#b:extend(.c all)` → `:is(.c.k, .z) .d, #b.k .d`).
  An alternative is written in place in the 4.x placement, a complex one too
  (`.p .q:extend(.c all)` gives `.p .q.k .d`), never as a one-arm `:is()`.
- A `&` fused into a compound under a parent of several compounds composes as the
  parent spliced in place, as the serializer writes it (`.b { .p { &.q {} } }` is
  `.b .p.q`, `.q&` is `.q.b .p`, `&-foo` is `.b .p-foo`), and extend matches that
  composed selector: `.x:extend(.b .p.q)` reaches it, and an `all` graft on `.x` in
  `.x { .arrow { &::before {} } }` gives `:is(.x, .y) .arrow::before`, never a one-arm
  `:is(:is(.x, .y) .arrow)::before`.
- An `all` match of a whole authored or nesting `:is()` arm appends the extender to
  that list; the append is extend's own grouping and follows the same guard
  (orchestrator judgment 2026-10-05). The extender joins the list only at the list's
  specificity and where its shape may sit in the `:is()`; otherwise it replaces the
  whole `:is()` on its own, so the authored list keeps its specificity
  (`:is(.c, .z) .d` + `#b:extend(.c all)` → `:is(.c, .z) .d, #b .d`; `.y` joins:
  `:is(.c, .z, .y) .d`; `.a :is(.c, .z)` + `.p .q:extend(.c all)` →
  `.a :is(.c, .z), .a .p .q`).
- KNOWN GAPS: a pseudo-element member written as its own branch makes the whole
  rule invalid, as in 4.x (the forgiving `:is()` kept the other branches). SCSS `@extend` uses the same Less 4.x expansion, not
  dart-sass's weave — deferred Sass-parity work, tracked with its repro in
  `docs/state/PINNED-DEFECTS-AUDIT.md` ("Deferred, not pinned").

```less
.a > .c { color: red; }
.x:extend(.c all) {}
#b:extend(.c all) {}
.y:extend(.c all) {}
.p .q:extend(.c all) {}
```
```css
.a > :is(.c, .x, .y),
.a > #b,
.a > .p .q {
  color: red;
}
```

**Sibling compaction** — exact extenders that append identical trailing parts are
compacted. `extend-nest.less`:

```less
.button { color: black; &:hover { color: inherit; } }
.submit { &:extend(.button); &:hover:extend(.button:hover) {} }
```
```css
.button, .submit { color: black; }
:is(.button, .submit):hover { color: inherit; }
```

`.button:hover, .submit:hover` compacts to `:is(.button, .submit):hover`.

## 6. Fixpoint — transitive / chained extends

Extend runs to a fixpoint: an extender's produced selector is itself a match
target, so chains resolve fully. From `extend-chaining.less`:

```less
.a { color: black; }
.b:extend(.a) {}
.c:extend(.b) {}
```
```css
.a, .b, .c { color: black; }
```

`.c` extends `.b`; because `.b` became an extender of `.a`, the new `.b`
product matches `.c`'s target and `.c` chains all the way in.

**Order-independent** — the extender may precede the target:

```less
.d:extend(.e) {}  .e:extend(.f) {}  .f { color: black; }
// → .f, .e, .d { color: black; }
```

**Termination** — fire-once per instruction + value dedup guarantee the fixpoint
halts even on circular references:

```less
// self-referencing is ignored
.u { color: black; }
.v.u.v:extend(.u all) {}      // → .u, .v.u.v { color: black; }  (extender never self-wraps)

// circular (product re-matches the existing extend) still terminates
.w:extend(.w) { color: black; }
.v.w.v:extend(.w all) {}       // → .w, .v.w.v { color: black; }

// classic circular reference — each block collects all three
.x:extend(.z) { color: x; }
.y:extend(.x) { color: y; }
.z:extend(.y) { color: z; }
// → .x,.y,.z {color:x}  .y,.z,.x {color:y}  .z,.x,.y {color:z}
```

Cross-`@import` closure resolves through the import boundary
(`extend-cross-import.test.ts`, reference = real less@4): `.a:extend(.b)` in main +
`.b:extend(.c)` in the imported sheet yields `.c, .b, .a { color: red; }`.

Targets are graph-wide: a rule of an imported sheet is a target for an extend anywhere
in the import graph, whether or not that sheet has an `:extend()` of its own
(`@import "t.less"; .x:extend(.sm) {}` with `.sm` in `t.less` → `.sm, .x { … }`), subject
to the same `@media` scoping as inlined rules (§8). An extend inside a mixin or loop body
counts like any other. The zero-extend fast-reject is per import GRAPH, never per
document: a graph with no extend plans nothing and records nothing in the render walk
(jess#349), and when no rule the walk recorded can meet an extend target the deferred
fold re-solves nothing. Interpolated selectors are covered by §10.

A rule a mixin call places (a ruleset called as a mixin and a detached ruleset's call
included), or a loop or `$if`/`$while` body places — or an `@import` inside a ruleset,
which runs as that ruleset's body (`.wrap { @import "t.less"; }` → `.wrap .sm`; ledger
A2's source fold, N10's splice at the import position) — extends and is extended where
it lands: as its selector composed under the rules it is placed in, in the `@media`
scope it is placed in (§8), once per placement:

```less
.m() { .p { &.q, &.r { a: 1; } } }
.m();
.x:extend(.p.q) {}
// → .p.q, .p.r, .x { a: 1; }

.a { .p { a: 1; } }
.z { .a(); }
.x:extend(.z .p) {}
// → .a .p { a: 1; }  .z .p, .x { a: 1; }
```

Two gaps remain. An interpolated selector in such a body is held as its composed text,
matched whole and never part by part; ledger X7 says an interpolated selector matches
nothing as a target, and X15 records the open inconsistency, so this awaits an owner
ruling. In nested output (`collapseNesting: false`) a placed EXTENDER folds in as its
composed selector (`.a { .m(); } .b { .m(); }` → `.sm, .a .x, .b .x`), but a placed
TARGET written inside a parent block is not rewritten when its extender lies outside that
parent: moving the extender out is restructuring, not a header rewrite (§1a).

Extend across `@compose` follows Sass module semantics (ledger X14): the composing
sheet's extend reaches the composed module's rules, and a module's extend reaches only
the module and what it composes — never the composing sheet's rules. A module is one
module however many sheets compose it, so the extends of every sheet that composes it
reach it, whichever loaded it first (`extend-cross-import.test.ts`).

## 7. Nested / ruleset-scoped extends

Extend matches nested (compiled) selectors and can be authored from any nesting
depth. `extend-nest.less`:

```less
.sidebar { width: 300px; background: red; .box { … } }
.sidebar2 { &:extend(.sidebar all); background: blue; }
.type1  { .sidebar3 { &:extend(.sidebar all); background: green; } }
.type2  { &.sidebar4 { &:extend(.sidebar all); background: red; } }
```
```css
.sidebar, .sidebar2, .type1 .sidebar3, .type2.sidebar4 { width: 300px; background: red; }
:is(.sidebar, .sidebar2) .box, :is(.type1 .sidebar3, .type2.sidebar4) .box { … }
.sidebar2 { background: blue; }
.type1 .sidebar3 { background: green; }
.type2.sidebar4 { background: red; }
```

The extenders' compiled complex selectors (`.type1 .sidebar3`,
`.type2.sidebar4`) join both the header list and the nested `.box` rule's `:is()`
graft — in their own group, since they score `(0,2,0)` where `.sidebar` and
`.sidebar2` score `(0,1,0)` (§5 guarded grouping). The graft leads the selector, so
the complex member keeps its matching inside `:is()`.

### 7a. NESTED-mode re-nesting, shared-prefix strip, flatten triggers (LANDED)

NESTED mode does NOT re-derive extend semantics — it RE-NESTS the correct FLAT
result (`emit.ts` module JSDoc is the canonical statement of these rules). A rule
STAYS nested and its extend rewrites the local selector in place, with three refinements:

- **Shared-prefix strip** (`relativizeExtender` / `sharedPrefixLen` in `emit.ts`). A
  folded-in extender that shares an ancestor `Level` with its target (identity-shared
  by the plan walk) drops the shared levels and contributes only its own-local
  remainder — `.attributes .attribute-test` folded into `.attributes [data="test"]`
  surfaces as the sibling `.attribute-test`. A top-level extender (no shared ancestor)
  is unchanged; the strip is capped at parent depth so a self-extend never slices empty.
- **Flatten triggers** — a rule (and its descendants) FLATTEN to a top-level block when
  the match CROSSES the `&` (the parent-context ↔ child-appended-compound join), which
  nested structure cannot express locally:
  - **trigger B** — a NESTED rule that itself carries `:extend()` (its extender
    contribution incorporates the parent context).
  - **trigger P** — a NESTED rule whose PARENT is aliased by an `all`-extender whose
    target does NOT also match the child's own local compound (foreign parent-context
    alias, e.g. `.sidebar2:extend(.sidebar all)` reaching `.sidebar .box`). A UNIFORM
    alias that also rewrites the child's own compound does NOT cross → stays nested.
  - **trigger X** — a NESTED rule whose whole composed complex is matched EXACTLY by an
    extender that does not descend from its parent (hoisted whole-complex sibling).
  A flatten whose subject STILL HAS surviving nested children RE-NESTS the corrected
  subtree under its hoisted header (`emit.ts` `'renest'` mode) rather than composing
  the children flat (`'collapse'`, which cascades to descendants). A trigger-P/X
  flatten's header is the full flat composition, so the rule rises out of EVERY
  enclosing rule block (`hoistBubble` = its nesting depth); rising one block left
  `.a { .b, .c { e } }` + `.d:extend(.a .b e)` as `.a { :is(.a .b, .a .c) e, .d {…} }`,
  which needs two `.a` ancestors. An at-rule it rises out of is not a rule block but
  goes with it: `.a { @media q { .b, .c { e {…} } } }` emits `@media q { … }` beside
  `.a` (`serialize.ts` `HoistEntry.wrappers`). Only a sub-span match that crosses the `&`
  (`emit.ts` trigger C, the per-boundary hoist) keeps outer ancestors as wrappers.
  Flatten only when there is no shared prefix to strip and the match crosses;
  otherwise the local rewrite / prefix strip keeps the rule nested.

### 7b. Exact-extender-into-children SPLIT (LANDED)

An EXACT extender folds into a target's block header ONLY if the block has no
surviving nested children (exact never propagates into sub-parts). If it HAS children,
the extender SPLITS to a SEPARATE sibling rule carrying only the target's DIRECT
declarations (dropped if empty) — it does not leak into the children. `all`-extenders
fold into the header and DO propagate to children. This is the corrected form gated
against `proposed-alpha-corrections/{extend.css,extend-exact.css}`, superseding alpha's
hand-converted leak (see §12.1).

### 7c. Sibling `:is()` compaction, guarded (LANDED)

`siblingCompact` / `tryMergeSiblings` / `mergeCompoundsToIs` (`emit.ts`) compact whole
sibling branches differing in exactly ONE compound into `:is(...)` at that position
(`.button:hover, .submit:hover` → `:is(.button, .submit):hover`), with three guards:

- Single-compound rows merge only when they share a trailing suffix — two whole
  branches sharing NOTHING (`.ext8.ext9` / `.fuu`) stay a comma list.
- Multi-segment (descendant-complex) rows compact only under a shared parent-composition
  prefix (`allowMultiSeg`, a flattened nested rule's hoisted header); a TOP-LEVEL rule's
  own header keeps `.foo .bar, .foo .baz` as a comma list (never `:is()`-collapsed).
- The merged group is an extend group, so it follows §5's guarded grouping (ledger
  X3, amended by the owner 2026-10-05) in every output mode: `.button:hover, #submit:hover` stays a comma list, and
  `.arrow::before` / `.arrow::after` never share an `:is()`. A leading extend group on
  either side flattens into the merge; an authored or nesting `:is()` joins it as one
  member, so emission never splits a selector the author wrote. A lead already in
  the group joins it once (`#b.x` reached twice is one `#b`).

Compaction is not mode-coupled either: a top-level rule the extend changed compacts
its header the same way in nested output (its `nestedPlan` header) as in flat
output (`flatByRule`).

The NESTING fold is mode-coupled, and an extended header keeps it (orchestrator
judgment 2026-10-05): in a nested rule's extended, flattened header the branches its
own child list produced fold by `collapseNesting` exactly as the serializer folds the
unextended rule (ledger O10; `'compact'` unguarded, `'native'` and the nested output's
hoisted headers by specificity), while the branches the extend added keep to the
guarded grouping above. `.t { th, .x {} }` + `.foo:extend(.t th)` is
`.t :is(th, .x), .foo` under `'compact'` and `.t th, .t .x, .foo` under `'native'`;
`#y:extend(.x all)` on the same rule gives `.t :is(th, .x), .t #y` under `'compact'`
(`emit.ts` `nestingFold`).

## 8. `@media` scoping — v5 does NOT merge media

An extend inside `@media` only matches selectors in the SAME (or a descendant)
media scope; it does not reach the top level or a sibling media. A TOP-LEVEL
extend reaches everything, including inside nested media. `extend-media.less`:

```less
.ext1 .ext2 { background: black; }
@media (tv) {
  .ext1 .ext3 { color: inherit; }
  .tv-lowres :extend(.ext1 all) { background: blue; }
  @media (hires) {
    .ext1 .ext4 { color: green; }
    .tv-hires :extend(.ext1 all) { background: red; }
  }
}
.all:extend(.ext1 all) {}
```
```css
:is(.ext1, .all) .ext2 { background: black; }
@media (tv) {
  :is(.ext1, .tv-lowres, .all) .ext3 { color: inherit; }
  .tv-lowres { background: blue; }
  @media (hires) {
    :is(.ext1, .tv-lowres, .tv-hires, .all) .ext4 { color: green; }
    .tv-hires { background: red; }
  }
}
```

Note the top-level `.all` reaches every scope; `.tv-lowres` (in `@media (tv)`)
reaches `tv` and its descendant `hires` but NOT the top-level `.ext2` rule.
Crucially, v5 keeps the nested `@media` blocks nested — it does NOT merge/flatten
them (contrast Less 4.x, which merges `@media (tv) and (hires)`).

The scope is the placed one, across `@import`: an imported sheet's `@media` blocks
scope its extends exactly as if the sheet were inlined, and an import inside an at-rule
block (including the `@import "x" screen;` form) places the whole sheet in that block's
scope. So `@media print { .x:extend(.sm) {} }` in one imported sheet does not reach a
top-level `.sm` in another, while `@media print { @import "t.less"; .x:extend(.sm) {} }`
extends the imported `.sm` (`extend-cross-import.test.ts`).

A mixin call is placed the same way: `@media print { .m(); }` puts the rules and extends
of `.m()`'s body in the `print` scope, wherever `.m()` is defined.

## 9. Compound / complex / combinator targets

The target can be a compound, a complex selector, or carry combinators, and each
combinator is significant. `extend.less`:

```less
.ext8.ext9 { result: add-foo; }
.ext8 .ext9, .ext8 + .ext9, .ext8 > .ext9 { result: bar-matched; }
.fuu:extend(.ext8.ext9 all) {}
.buu:extend(.ext8 .ext9 all) {}
.zap:extend(.ext8 + .ext9 all) {}
.zoo:extend(.ext8 > .ext9 all) {}
```
```css
.ext8.ext9, .fuu { result: add-foo; }
.ext8 .ext9, .ext8 + .ext9, .ext8 > .ext9, .buu, .zap, .zoo { result: bar-matched; }
```

`.fuu` (compound `.ext8.ext9`) joins only the compound rule; the descendant/
adjacent/child targets each match their respective combinator form.

## 10. Pseudo / attribute / interpolated targets

- **Pseudo target** — `.submit { &:hover:extend(.button:hover) {} }` → the
  `.button:hover` rule gains `.submit:hover` (§5, sibling-compacted to `:is()`).
- **Attribute target** — `extend-selector.less` extends `[data="test"]`,
  `[data]`, and an interpolated `[data=@{attr-data}]` (resolving to
  `[data="test3"]`):
  ```css
  [data="test"], .attribute-test { extend: attributes; }
  [data], .attribute-test2 { extend: attributes2; }
  [data="test3"], .attribute-test { extend: attributes2; }
  ```
- **Interpolated selectors** — an `:extend` ATTACHED to an interpolated selector
  works (`@{variable}:extend(.bucket)`), and a rule whose selector is interpolated
  (`.@{v} {}`, `.c-@{n} {}`) IS an extend target once resolved, at the root, in
  imported sheets and in mixin/loop bodies alike (ledger X7, amended by the owner
  2026-10-05, as lessc 4.9.1 behaves; it closes X15). 4.x `extend.md`'s "Extend is
  not able to match selectors with variables" is superseded. Imported sheets are
  not yet covered: they are planned from unresolved IR (`planImportedStaticExtend`),
  so an imported `.@{v}` rule is still missed. (See §12 for the
  interpolated-attribute extend in `extend-selector`.)

## 11. Reference-mode (`@import (reference)`) visibility

`@import (reference)` hides the imported sheet's own rules from output. An extend
that matches a referenced target pulls the matched declarations into the
EXTENDER's selector only — the referenced target header never surfaces on its own
(`extend-cross-import.test.ts`, reference = less@4):

```
// ref-main.less extends a target in a (reference)-imported sheet
.ext { color: red; }        // pulled-in referenced declaration under .ext
.ext { background: blue; }  // .ext's own body
// `.target` never appears in output
```

Hiding follows the import placement, not the rule. Each `(reference)` or `(multiple)`
import is its own placement of the sheet's rules, so an extend inside one `@media` block
reaches only that block's copy — a `(reference)` import inside a sheet imported
`(multiple)` twice is placed once per copy. Import-once drops a `(reference)` re-import
of a sheet an `@import` already loaded, as Less 4.x does (orchestrator judgment
2026-10-05, jess#359): `@import "t.less"; @import (reference) "t.less";` places the
sheet once, visibly. A `(reference)` import that comes first does not stop a later
plain import, which places its own visible copy. A sheet a `(reference)` sheet imports is
referenced too, and a reference sheet's rule called as a mixin from outside the import
renders as normal. A hidden rule that an extend in a mixin or loop body (recorded by the
render walk) may still reveal renders as a reserved block, which the deferred fold
rewrites to the extender, or blanks when nothing reveals it.

---

## 12. OPEN / needs owner confirmation

Points that are unsettled, engine-diverges-from-reference, or not directly gated by
a fixture. These are the owner questions:

1. **Exact-extender-into-children (alpha expected-output bug).** When an EXACT extender
   targets a rule that HAS nested children, alpha's hand-converted NESTED expected output
   folds the extender into the block header, wrongly leaking it into the children
   (`.aa, .cc { .dd … }` → `.cc .dd`). The owner-confirmed rule
   (`proposed-alpha-corrections/README.md`): an exact extender folds into a block
   header ONLY if the block has no child rules; if it has children, emit the
   extender as a SEPARATE sibling carrying only the block's DIRECT declarations
   (dropped if empty). `all`-extend DOES propagate into sub-parts and stays
   folded. tree2 emits the corrected form; `extend` and `extend-exact` are gated
   against the corrections, NOT alpha's bytes. **STATUS: owner-confirmed in the
   corrections README; still pending the owner applying it on alpha.**

2. **`extend-selector` full render is DEFERRED.** The interpolated-attribute
   extend target (`[data=@{attr-data}]` participating in an extend) and the
   NESTED-mode `:is()` extend-composition for the subject-scoped `statement:Rules`
   shape are not yet byte-identical; the bridge accepts the shape but the full
   render is a tracked engine gap (`extend-byte-identity.test.ts`, R4). Confirm
   the intended output matches `extend-selector.css` on alpha.

3. **Exact-match strictness cases (star / pseudo-order / `nth`) are documented
   from `extend.md` (Less 4.x) but are NOT individually fixture-gated in the
   tree2 suite.** Confirm v5 keeps Less's byte-exact matching (no normalization)
   for these; only attribute-quote normalization is asserted (via
   `extend-selector`).

4. **"Last-occurrence anchor" is a MERGE (`+`/`+_`) concept, not extend.** The
   v5 last-occurrence line anchor (`spine-merge-last-occurrence-anchor`,
   `proposed-alpha-corrections/merge.css`) governs `+`/`+_` merge groups, not
   `:extend`. For extend, the target rule keeps its document position and
   extenders append in instruction order. Flagging in case the umbrella task
   intended to fold merge-anchoring in here — confirm it stays out of the extend
   surface.

5. **Cross-`@import` extend routing (ledger X9).** No longer eval-routed: the import
   planner records each imported sheet's statically-placed rules and extends from
   their selector shapes (`planImportedStaticExtend`), and the one render walk records
   loop/mixin-body placements (§1a). Extend across `@compose` follows ledger X14 (§6).

6. **`div.ext5` / duplicated-extender dedup.** `extend.md` "Duplication
   Detection" notes Less 4.x has NONE (`.alert:extend(.alert-info, .widget)`
   emits `.alert` twice). The v5 engine dedups extender branches (SOLVE "value
   dedup"). Confirm v5 intentionally dedups where 4.x duplicated.

## Cross-links

- Engine: `packages/core/src/ast/extend/` (clean-room `ir`/`compose`/`match`/`plan`/`solve`/`emit`; barrel `packages/core/src/ast/extend.ts`).
- Legacy (dying, NOT a reference): `packages/core/src/tree/extend/{plan,solve,emit,pipeline,extend-index}.ts`.
- Reference plumbing: `docs/architecture/core/REFERENCE.md`.
- Byte-identity gates: `packages/jess/test/less/all-less.test.ts`, `packages/jess/test/less/extend-exact-oracle.test.ts` (pending golden edits: `packages/jess/test/less/pending-golden-edits.ts`).
- Corrections: `docs/architecture/core/proposed-alpha-corrections/{README.md,extend.css,extend-exact.css}`.
- Handoff / status: `docs/architecture/core/R1-EXTEND-HANDOFF.md`.
- User-facing pages (canonical source `packages/docs-content/`):
  - Less: `docs/less/features/extend.md` (syntax), `docs/less/advanced/extend-is-wrapping.md` (`:is()` grafting), `docs/less/advanced/extend-semantics.md` (full behavior + nuances).
  - Jess: `docs/jess/02-Language/05a-advanced-extend.mdx`, `docs/jess/06-Advanced/05-extend.md`.
