# tree2 — Definitive-Rewrite DESIGN SPEC

> The subsystem-by-subsystem specification for the tree2 core rewrite. Each rung
> in the done-right roadmap
> ([`TREE2-DEFINITIVE-REWRITE-COVERAGE-AND-ROADMAP.md`](./TREE2-DEFINITIVE-REWRITE-COVERAGE-AND-ROADMAP.md))
> adds one section here: **data model · algorithm · invariants · oracle**. Keep it
> a real spec (what the code guarantees), not a status log — the living
> experiment log stays in `AST-ARENA-EXPERIMENT-HANDOFF.md`.

Branch of record: `experiment/tree2-cleanroom-20260715`. Code citations are on that
branch.

---

## R0 — `collapseNesting:false` nested-output mode (the Less v5 default)

**Status:** built + proven byte-identical on the corpus (this rung's first spec
section). Code: `packages/core/src/tree2/serialize.ts` (the `emitNested*` family +
the `collapse` flag); option surface `SerializeOptions.collapseNesting`.

### Problem / why R0 precedes extend

Every prior tree2 rung was validated ONLY in the flattened form (benched
`collapseNesting:true`). The **v5 shipping default is nested output**
(`collapseNesting:false`), and until R0 tree2 had no nested-emit mode — the
serializer only built flattened, composed selector strings. Extend's EMIT phase
must project through the collapse policy (arch E1 / D-EMIT), so the nested form is
a hard prerequisite for building extend correctly. R0 is also the first proof in
the mode that actually ships.

### Data / model (unchanged by R0)

R0 adds NO node types. It is a **second emit policy over the same tree2 model and
the same single walk**, selected by an option. It reuses:

- the selector model (`SelectorList` / `Complex` / `Compound` / `Simple`) and its
  cached canonical strings (`Complex.canonical()`, `Compound.canonical()`);
- the scope model (`Frame` chain, `collectVars` / `collectMixins` /
  `lookupVar` / `lookupMixinCandidates`);
- mixin dispatch (`selectDefinitions`) and the injected `ValueService`.

The only additions in `serialize.ts` are the `collapse: boolean` field on the
internal `Emit` struct and the `SerializeOptions.collapseNesting` public option
(default `true` = flatten, preserving all existing behavior).

### Algorithm

**Selection.** `serialize(root, { collapseNesting: false })` sets `e.collapse =
false` and routes the root's children through `emitNestedBody` instead of the
flattening `flatten`/`walkBody`/`flushBlock` path. `collapseNesting` defaults to
`true`, so the flattened path is byte-for-byte unchanged.

**Indentation contract.** Within the nested emitters, `e.depth` is the
indentation LEVEL of the statements currently being emitted (a direct
declaration, a child-rule header, or a nested at-rule header all sit at
`INDENT.repeat(e.depth)`; `INDENT` = two spaces). Entering a rule/at-rule body
raises the level by one for that body's contents. (This differs from the
flattened path's at-rule convention, where `e.depth` is the enclosing header
level and content is emitted at `e.depth + 1`; the two paths do not share the
leaf emitter.)

**`emitNestedBody(statements, frame, e)`** — walks a body in SOURCE ORDER (no
flush/split, no grouping):

- `Declaration` / `Comment` → `emitNestedLeaf` at exactly `e.depth`.
- `Rule` → `emitNestedRule` (nests one level deeper).
- `MixinCall` → `expandNestedCall` (splices inline at the current level).
- `AtRuleBlock` → `emitNestedAtRuleBlock`; `AtRuleStatement` → `emitAtRuleStatement`.
- `MixinDef` / `VarDeclaration` → emit nothing (definitions live only in scope).

**`emitNestedRule(rule, frame, e)`** — emits `<indent><ownSelector> {\n` … `<indent>}\n`:

- the header is the rule's OWN local selector list via `ownStrings(rule.selector)`
  (each `Complex.canonical()`), joined `,\n<indent>` for a list — it is **NEVER
  composed with the parent**;
- the body is emitted by `emitNestedBody` at `e.depth + 1`;
- **empty-block elision**: chunk/offset/position marks are taken before the header
  and after it; if the body produced nothing, everything is rewound (no header, no
  braces). This is naturally recursive — a parent whose only content is a
  nested rule that itself elides also elides.

**`expandNestedCall(call, frame, e)`** — the mixin×nesting rule (see below): it
selects matching definitions with the SAME `selectDefinitions` dispatch as the
flattened path (arity + literal pattern + named/default params + guards +
`default()`), then splices each shared canonical body inline by calling
`emitNestedBody(def.body, callFrame, e)` at the current `e.depth`. No clone, no
per-placement node build — the def body is walked in place through an overlay
frame (bindings + collected locals). `clone` / `inherit` / `withComponents`
op-counts stay structurally ZERO.

**`emitNestedAtRuleBlock(node, frame, e)`** — the `&`/at-rule×nesting rule: emits
`@name prelude {\n` … `}\n` with the body walked by `emitNestedBody` at
`e.depth + 1`, so **nested rules inside an at-rule STAY nested** (they are not
flattened). Same empty-block elision as rules. v5 does not merge sibling `@media`
blocks and does not bubble — each at-rule stays its own block where authored.

### The non-obvious shapes (SOURCED from the oracle, not assumed)

Sourced from the REAL pipeline rendered `collapseNesting:false` (the v5 proxy),
verified byte-identical in `nested-byte-identity.test.ts`:

- **`&` / descendant nesting renders LITERALLY.** A nested child emits its own
  local selector verbatim — `&:hover`, `&.b`, `& > .b`, `.b &`, and a nested list
  `.b, .c` all stay exactly as authored inside the parent block. There is **no**
  `:is()` grouping and **no** parent composition in nested mode (contrast the
  flattened path, which composes `.a` × `&:hover` → `.a:hover` and wraps list
  parents as `:is(.a, .b) .c`).

  ```less
  .a { color: red; &:hover { color: blue; } .b, .c { x: 1; } }
  ```
  ```css
  .a {
    color: red;
    &:hover {
      color: blue;
    }
    .b,
    .c {
      x: 1;
    }
  }
  ```

- **mixin placement SPLICES inline under the call site.** A placed mixin body's
  declarations join the call-site block in source order, and its nested rules nest
  under the call site keeping their OWN local selectors (they do NOT gain the
  call-site selector as a prefix):

  ```less
  .m() { color: red; .inner { x: 1; } }
  .a { .m(); border: 1px; }
  ```
  ```css
  .a {
    color: red;
    .inner {
      x: 1;
    }
    border: 1px;
  }
  ```

- **source order is preserved within a block.** Declarations that follow a nested
  rule stay in the same parent block (the flattened path would split them into a
  second `.a { … }` block); nested rules and declarations interleave exactly as
  authored.

### Invariants

1. **Flattened mode is untouched.** `collapseNesting` defaults to `true`; the
   flattened emit path and its byte-identity suite are byte-for-byte unchanged
   (verified: the full flattened suite stays green, and the corpus flat-pass set
   is unchanged).
2. **Zero structural copy.** Mixin placement in nested mode walks the shared
   canonical body through an overlay frame; `clone` / `inherit` /
   `withComponents` analog op-counts are structurally ZERO (race op-columns).
3. **Selectors never composed in nested mode.** A nested rule's header is its own
   `ownStrings(selector)`; the parent selector never enters the child header.
4. **Empty blocks elide recursively.** A rule/at-rule that produces no body output
   emits nothing (header + braces rewound).
5. **Boundary held.** No `tree2/` file imports `../tree`; no `as any`.

### Oracle (corrected policy)

The oracle is **intended Jess v5 output**, NOT Less 4.x. For nested output the v5
reference is the owner-maintained top-level `.css` goldens (v5 nested) and,
equivalently, the **full jess pipeline rendered `collapseNesting:false`** (the
plugin's v5 default). The legacy `tree` render is a valid proxy for intended-v5
only where it agrees with those goldens — used here via
`renderRealOracleNested` (`oracle.ts`), the function-evaluating pipeline rendered
`{ collapseNesting: false }`.

**Proof (this rung).** `nested-byte-identity.test.ts` — 30 curated cases across
plain rules, nesting/`&`, declarations/values/variables, mixin placement,
at-rules/`@media`, guards, and empty-block elision, all byte-identical to the
nested oracle. `nested-census.test.ts` — over the 133 less.js `tests-unit`
fixtures, **33 pass byte-identical in the nested (v5-default) form — the SAME 33
that pass in the flattened form (0 nested-only, 0 flat-only)**, i.e. R0 introduced
zero regressions and the nested shape is as correct as the flattened one on the
supported feature surface. The remaining bridged-but-diff fixtures fail on
pre-existing feature gaps (maps `#map[key]`, arithmetic/scope in specific mixins,
namespace/closure resolution, comma-list values, calc, escaping) that also diff in
the flattened form — none is a nesting-emit defect. `nested-race.test.ts` confirms
the nested lane byte-identical with tree2 clone/inherit/withComponents ZERO.

### Flagged for owner confirmation of intended v5 nested shape

- **Leading-combinator child selectors.** A nested child authored with a leading
  combinator (`.a { > .b { … } }` / `#ns { > .mixin }`) renders in the v5 oracle
  as `> .b` verbatim inside the parent, but tree2's selector MODEL (`Complex` =
  head compound + combinator-joined tail) has no slot for a leading combinator, so
  the bridge drops it (pre-existing gap noted since rung 7; it surfaces directly in
  nested mode because the child header is emitted verbatim). This is a
  bridge/selector-model gap, orthogonal to the R0 collapse policy — it needs the
  selector model to carry an optional leading combinator, then both emit modes get
  it for free. `rulesets/rulesets.less` is the corpus example.
