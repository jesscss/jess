# Extend semantics (canonical behavior reference)

This is the contributor-facing behavior reference for Jess's `extend` feature —
the sibling of `VARIABLE-RESOLUTION-SEMANTICS.md`. It documents the INTENDED v5
behavior with a worked example for every rule, each lifted from a test fixture.

## Reference policy (read first)

The behavior below is anchored on two references, NOT on the current engine:

1. **The extend fixtures** in less.js `alpha`
   (`packages/test-data/tests-unit/<fixture>/{<fixture>.less,<fixture>.css}`),
   read read-only via `oracle-source.ts` and gated by
   `packages/core/src/ast/parse-host/__tests__/extend-byte-identity.test.ts`.
   The `alpha` TOP-LEVEL `.css` (with `:is()` compaction) is the intended v5
   output.
2. **Owner-confirmed corrections** in
   `docs/future/core-architecture/proposed-alpha-corrections/` for the two
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
`legacy/*.css` is NOT a v5 reference (see `oracle-source.ts`).

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
:is(.sidebar, .sidebar2, .type1 .sidebar3, .type2.sidebar4) .box { … }
.sidebar2 { background: blue; }
.type1 .sidebar3 { background: green; }
.type2.sidebar4 { background: red; }
```

The extenders' compiled complex selectors (`.type1 .sidebar3`,
`.type2.sidebar4`) join both the header list and the nested `.box` rule's `:is()`
graft.

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
  the children flat (`'collapse'`, which cascades to descendants). Flatten only when
  there is no shared prefix to strip and the match crosses; otherwise the local
  rewrite / prefix strip keeps the rule nested.

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
(`.button:hover, .submit:hover` → `:is(.button, .submit):hover`), with two guards:

- Single-compound rows merge only when they share a trailing suffix — two whole
  branches sharing NOTHING (`.ext8.ext9` / `.fuu`) stay a comma list.
- Multi-segment (descendant-complex) rows compact only under a shared parent-composition
  prefix (`allowMultiSeg`, a flattened nested rule's hoisted header); a TOP-LEVEL rule's
  own header keeps `.foo .bar, .foo .baz` as a comma list (never `:is()`-collapsed).

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
- **Interpolated extender selector** — an `:extend` ATTACHED to an interpolated
  selector works (`@{variable}:extend(.bucket)`), but an interpolated selector as
  a match target/subject matches nothing (`extend.md`, "Selector Interpolation
  with Extend"): "Extend is not able to match selectors with variables." (See
  §12 — the interpolated-attribute extend in `extend-selector` is currently a
  DEFERRED engine gap.)

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

5. **Cross-`@import` extend is EVAL-routed, not spine-folded.** The transitive
   closure through an import boundary currently routes to the legacy eval path
   (per `extend-cross-import.test.ts`), a separate WIP from the spine fold. The
   OUTPUT reference holds regardless of routing, but the intended final routing for
   cross-import extend is unsettled.

6. **`div.ext5` / duplicated-extender dedup.** `extend.md` "Duplication
   Detection" notes Less 4.x has NONE (`.alert:extend(.alert-info, .widget)`
   emits `.alert` twice). The v5 engine dedups extender branches (SOLVE "value
   dedup"). Confirm v5 intentionally dedups where 4.x duplicated.

## Cross-links

- Engine: `packages/core/src/ast/extend/` (clean-room `ir`/`compose`/`match`/`plan`/`solve`/`emit`; barrel `packages/core/src/ast/extend.ts`).
- Legacy (dying, NOT a reference): `packages/core/src/tree/extend/{plan,solve,emit,pipeline,extend-index}.ts`.
- Reference plumbing: `packages/core/src/ast/parse-host/__tests__/oracle-source.ts`, `docs/future/core-architecture/REFERENCE.md`.
- Byte-identity gate: `packages/core/src/ast/parse-host/__tests__/extend-byte-identity.test.ts`.
- Corrections: `docs/future/core-architecture/proposed-alpha-corrections/{README.md,extend.css,extend-exact.css}`.
- Handoff / status: `docs/future/core-architecture/R1-EXTEND-HANDOFF.md`.
- Kill-list (extend cleanup): `docs/future/core-architecture/TREE2-KILL-LIST.md`.
- User-facing pages (canonical source `packages/docs-content/`):
  - Less: `docs/less/features/extend.md` (syntax), `docs/less/advanced/extend-is-wrapping.md` (`:is()` grafting), `docs/less/advanced/extend-semantics.md` (full behavior + nuances).
  - Jess: `docs/jess/02-Language/05a-advanced-extend.mdx`, `docs/jess/06-Advanced/05-extend.md`.
