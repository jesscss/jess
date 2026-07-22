# SCSS-parser rebase off `LessGrammar` → shared `preprocessorBase` (DESIGN)

> **Historical design evidence — not an execution plan.** The proposed shared
> builder/host path and its deletion sequencing are superseded. SCSS, like every
> dialect, must reduce Parseman grammar directly to canonical `Stylesheet`
> through public `parse()`; retain only independently verified recognition
> observations from this document.

> **Archive boundary (2026-07-22).** The BuilderHost inheritance, shared-host
> migration, and “unblocks BuilderHost deletion” language below describes a
> superseded implementation snapshot. It is not a current blocker or a request
> to add a host, bridge, or deferred public-wiring stage. Current SCSS work uses
> its own direct Parseman grammar reductions and the retained Context/plugin
> dispatch.

Archived DESIGN/SCOUT survey — no current implementation plan. Base: `origin/dev`.
Task **#34** and any BuilderHost deletion sequencing below are historical evidence
only; the public direct-parser contract in `HANDOFF.md` is authoritative.

This doc is the engineering spec for work items **W1, W5, W6, W7** of the owner-directed
program in `../parser-architecture/DIALECT-ARCHITECTURE-AND-ERROR-COVERAGE.md` (the
canonical sequencing/tracking doc — update *that* as items land; this doc details *how*).

Companion specs (referenced, not duplicated):
- `../parser-architecture/DIALECT-ARCHITECTURE-AND-ERROR-COVERAGE.md` — W1–W13 program + sequencing.
- `BUILDERHOST-RETIREMENT-DESIGN.md` — the two-producer fact + BuilderHost R0–R4 endgame.
- `GRAMMAR-RELOCATION-DESIGN.md` — the Less builders.ts regex site map.
- Memory: `scss-should-compose-on-css-not-less`, `sass-plus-dialect-reject-invalid-css`, `less-math-mode-is-parse-time`.

---

## 0. Executive summary

**Problem.** SCSS is welded to Less on BOTH axes. The grammar is
`scssGrammar = compose([lessGrammar, <SCSS delta>])` (`scss-parser/src/grammar.ts:34`)
and the builders are `class ScssGrammar extends LessGrammar`
(`scss-parser/src/builders.ts:123`), giving a linear class chain
`CssParser → LessGrammar → ScssGrammar`. SCSS and Less are **sibling** dialects over
CSS; SCSS inheriting Less is wrong on three counts:

1. **Correctness / leaks.** SCSS's `Stylesheet`/`atRuleBody`/`declarationList` end their
   `choice(...)` with Less's `g.stylesheetItem` / `g.blockItem`
   (`scss grammar.ts:704-736, 822-825`), pulling the ENTIRE Less statement set into SCSS:
   `.mixin()` calls, `when` guards, detached rulesets `@dr:{}`, `+:`/`+_:` merge,
   `#ns[...]` lookup, `@var`, `~"…"`. These are wrong-accepts SCSS must reject
   (`sass-plus-dialect-reject-invalid-css`). They are invisible to the dart-sass oracle
   (sass-spec ships no Less fixtures) and are tracked today as `it.fails` locks in
   `test/cross-dialect-leakage.test.ts`. Dropping this one fallback removes ~80% of the
   leaks structurally (confirmed via probe, per `scss-should-compose-on-css-not-less`).
2. **A dead-override trap.** Less's `buildNode` switch hard-routes `'QueryAtRuleBlock'` to
   `_buildLessQueryAtRuleBlock`, which SCSS never overrides — so SCSS's
   `_buildQueryAtRuleBlock` (`scss builders.ts:1277`) is DEAD, and a workaround node name
   (`ScssQueryInterpBlock`) had to be minted (commit `1d160dae1`). `super`-chained
   switch-over-inheritance makes override-by-name non-total.
3. **Cutover blocker.** `class ScssGrammar extends LessGrammar` +
   `compose([lessGrammar, …])` means scss-parser *imports and depends on*
   `less-parser/src/builders.ts` (the 3613-LOC `LessGrammar`) and `lessGrammar`. That file
   cannot be deleted at the engine cutover (`BUILDERHOST-RETIREMENT-DESIGN.md` R4) while a
   second package extends its class — a hard cross-package block orthogonal to the render
   cutover.

**Key enabling fact.** Less was effectively *authored as the de-facto preprocessor base* —
it already exposes explicit, commented extension seams that SCSS leans on:
`stylesheetItem`/`blockItem` ("grammars that EXTEND Less e.g. SCSS can inject their own
statements ahead of it… without re-listing the whole set", `less grammar.ts:180-182`),
`customValue` ("a composition seam for SCSS's custom-property override", `less grammar.ts:534`),
`strInterp = lessInterp` (the string-interp body seam, `less grammar.ts:146-164`), and
`basicSel`+`extendAhead` exposed (`less grammar.ts:1178`) precisely so SCSS can rebuild
`simpleSelector` with its own `&`. So the re-base is **largely relocating already-designed
seams** from "the Less delta that SCSS happens to compose on" into an explicit,
sigil-neutral `preprocessorBase` — then letting each dialect fill them. This makes the
factor tractable rather than a rewrite.

**Target.** `preprocessorBase = compose([cssGrammar, preprocDelta])` holding SIGIL-NEUTRAL
preprocessor machinery, each dialect composing on it, NO dialect composing on another:

```
cssGrammar                                                     // plain CSS (unchanged)
  └─ preprocessorBase = compose([cssGrammar, preprocDelta])    // sigil-neutral seams
       ├─ lessGrammar = compose([preprocessorBase, lessSigilDelta])  // @var @{} ~"" .mixin() when
       ├─ scssGrammar = compose([preprocessorBase, scssSigilDelta])  // $var #{} @mixin @if @use %ph
       └─ jessGrammar = compose([preprocessorBase, jessSigilDelta])  // (later)
```

Builder dispatch flips from a class-`switch` chain to a **name-keyed builder MAP** merged
`css ⊕ preproc ⊕ dialect` (last-wins), keyed 1:1 by grammar rule name.

**Why it's tractable.** The grammar layer is *already* override-by-name
(`compose([base, rules(...)])`; delta wins by name; `g.<name>` resolves across the fused
set). Slotting `preprocessorBase` between `cssGrammar` and the dialects is a natural fit —
it need only re-declare `{ trivia: rw }` (with the `//` line-comment arm CSS omits) and own
the neutral seams. The one structural change of substance is builders: today three
subclasses each override a `buildNode` `switch(type)` and delegate via `super`; the
`ctx.build` host (`FunctionalParseHost.build`, `css-parser functional-driver.ts`) already
dispatches purely on the `type` string, so replacing the class `switch` with a merged
`Map<string, BuilderFn>` is a localized change behind that same seam — and it turns the
builder-relocation from a *method-relocation* exercise into a *data move*.

**Phasing (landable increments; byte-identity preserved at each internal step):**
- **P1 = W1** Builder-map dispatch (mechanical, byte-identical, conflict-free). Kills the trap.
- **P2 = W5** Factor `preprocessorBase` out of the Less delta; `less = compose([preprocessorBase, lessSigilDelta])`; prove Less suite byte-identical.
- **P3 = W6** Re-point SCSS to `compose([preprocessorBase, scssSigilDelta])`; drop Less-only seam refs; SCSS builder map = `css ⊕ preproc ⊕ scss` (no Less).
- **P4 = W7** Fill the gaps the dropped Less fallback exposes as POSITIVE additions.
- **Unblocks** `BUILDERHOST-RETIREMENT-DESIGN.md` R4 by removing the hidden cross-package
  scss-parser dependency on `LessGrammar`/`lessGrammar` (§5).

---

## 1. What SCSS shares with Less vs what it must NOT inherit

Method: for every `g.<name>` the SCSS delta references, determine whether SCSS **overrides**
it in its own return map (`scss grammar.ts:827-847`) — in which case `g.<name>` resolves to
SCSS's own rule and there is no Less coupling — or **inherits** it (falls through the fused
set to Less/CSS). Only the *inherited* names are true couplings.

**SCSS already overrides (self-contained, NOT a coupling):** `VarDeclaration`, `Reference`,
`Quoted`, `value`, `valueList`, `Call`, `InterpolatedSelector`, `Declaration`,
`CustomDeclaration`, `AtRuleStatement`, `AtRuleBlock`, `simpleSelector`, `declarationList`,
`atRuleBody`, `Stylesheet`. (The less-parser inventory flags `value`/`Reference`/`Quoted`/
`simpleSelector` as "Less-contaminated" *as Less defines them* — but SCSS shadows all four,
so the contamination does not reach valid SCSS. They matter only as a reminder that these
seams must exist in `preprocessorBase` for SCSS to override cleanly.)

### (a) CSS-CORE — dialect-neutral, live in `cssGrammar`; keep composing on it

| SCSS inherits | cssGrammar rule (`css grammar.ts:733`) | Notes |
|---|---|---|
| `g.Dimension`, `g.Num` | `Dimension`, `numeric`→`Num` | typed numeric leaves (number/unit split) |
| `g.Color`, `g.NamedColor` | `Color` (+ named-color set) | `NamedColor` is Less-*defined* today but CSS-semantic; base must own it |
| `g.Url` | `Url` | Less override adds interp/ref arms → base version is the neutral one |
| `g.CalcCall` | `CalcCall` (`→'Call'`) | Less folded calc into `Call`; `g.CalcCall` resolves to the CSS rule |
| `g.SquareParen` | (CSS square-bracket group) | bracketed value group |
| `g.AttributeSelector`, `g.PseudoSelector` | same | CSS shape (Less adds an interp arm) |
| `g.ComplexSelector`, `g.SelectorList`, `g.CompoundSelector` | same | CSS structure (Less adds extend/`when` boundary) |
| `g.anyValue` | `anyValue` | whitespace-bounded fallback token |
| `g.topSum` | CSS math sum | `@for` range bounds (see math-mode caveat, §1c) |
| `g.basicSel` | `basicSel` (`less grammar.ts:47`) | pure selector/ident regex; neutral |

### (b) PREPROCESSOR-SHARED — both Less & SCSS need, not plain CSS → `preprocessorBase`

These justify a shared preprocessor layer (vs composing SCSS straight on `cssGrammar`, which
would duplicate them). They are SIGIL-NEUTRAL once the sigil-specific piece is parameterized
into a dialect delta. Several are *already* Less's designed seams (cited):

| Concept | Less rule(s) | Neutral form in `preprocessorBase` | Dialect fills |
|---|---|---|---|
| statement containers | `stylesheetItem` (`183`), `blockItem` (`497`) — **designed seams** (`180-182`) | seams whose neutral body is only CSS-level statements | dialect PREPENDS its own statements (§2) |
| block-body frames | `atRuleBody` (`1162`), `declarationList` (`503`), `Ruleset` (`485`) | frame seams | SCSS already overrides `atRuleBody`/`declarationList` |
| value grammar + trailing comma | `valueList` (`594`), `valueSequence` (`599`) | value/valueSequence with a **math-mode hook** + interp-atom seam | Less `@{}`/`@var`; SCSS `#{}`/`$var` |
| arithmetic precedence | `topSum`/`topProduct`/`mathSum`/`mathProduct`/`operand` (`663-679`) | precedence grammar **parameterized by math-mode** | Less parens-division; SCSS `/`-deprecation |
| value parens | `Paren` (`920`), `parenBody`/`permissiveParenBody` (`723`/`730`), `SquareParen` (`930`) | paren over overridable `parenBody` | SCSS list-tolerant paren + map disambiguation |
| block-as-value | `DetachedRuleset` (`732`), `AnonymousMixinDefinition` (`283`) | callback/block-arg value (both need `each(list,{…})`-style callbacks) | neutral |
| call/mixin arg productions | `MixinArgs`/`functionCallArgs`/`argsInner`/`callArgSeq` (`859/858/857/846`) | arg grammar with dialect arg-shape seam | SCSS named args/`...` splat |
| **ampersand nesting** | `LessAmpersand` (`362`), `simpleSelector` (`404`) | `simpleSelector` with an ampersand arm gated on the `inner` flag | `&` is SHARED (Less/SCSS/Jess all nest); SCSS variant has no suffix-merge |
| interpolation SEAM | `strInterp = lessInterp` (`146-164`), `interpOrBasic` (`403`), `customPropInterp` | generic interp-atom seam in string / selector / name / custom-prop positions | Less `@{}` vs SCSS `#{}` |
| custom-prop values | `customValue` (`536`) — **designed SCSS seam** (`534`), `customCurlyBlock` (`543`), `cpValue` (`582`) | custom-prop value seam | dialect interp token |
| variable reference / decl | `Reference` (`244`), `VarDeclaration` (`217`) | reference/var-decl **seam** | Less `@var`+accessor; SCSS `$var` + `!default`/`!global` |
| string values | `Quoted` (`165`) | `Quoted` with interp-atom seam (P0 KEYSTONE) | Less `@{}`; SCSS `#{}` |
| named colors | `NamedColor` (`686`) | neutral CSS named-color token | none |

> The neutral hooks that must become first-class in `preprocessorBase`: **(i)** the
> interpolation-atom seam, **(ii)** the parse-time math-mode hook, **(iii)** the
> statement-container seams, **(iv)** the reference/var-decl seam, **(v)** the
> ampersand-nesting selector arm, **(vi)** the custom-prop value seam. Less already exposes
> (i), (iii), (v-partial via `basicSel`/`extendAhead`), and (vi) as named seams — the factor
> mostly makes them explicit and sigil-neutral.

### (c) LESS-SPECIFIC — SCSS must NOT inherit → `lessSigilDelta` only

These are names SCSS **inherits today** (does not override) that carry Less-only semantics:

| SCSS inherits | Less rule | Less-only construct | Fate |
|---|---|---|---|
| `g.Guard` | `Guard`/`GuardOr`/… (`350…`) | `when (…)` guards | DROP — SCSS `@if`/`ScssCond*` is its own (already built) |
| `g.EscapedValue` | `EscapedValue` (`684`) | `~"…"` escaping | DROP — invalid SCSS |
| `g.GluedParen` | `GluedParen` (`928`) | glued mixin-ref-args paren | DROP |
| `g.DetachedRuleset` | `DetachedRuleset` (`732`) | Less `@dr:{}` *assignment* is Less-only; the block-as-value *concept* is shared | keep the neutral block-value in base; SCSS uses it only for callbacks |
| `g.AnonymousMixinDefinition` | `AnonymousMixinDefinition` (`283`) | `.(…){…}` callback | keep neutral in base (SCSS refs it for callbacks); Less name retires |
| `g.extendAhead` | `extendAhead` (`389`) | `:extend(` lookahead | DROP — SCSS uses `@extend`/`%` |
| `g.LessAmpersand` | `LessAmpersand` (`362`) | the `&`-with-suffix-merge *token* | the `&` CONCEPT is shared → base; SCSS supplies its own `&` arm |
| `g.stylesheetItem`, `g.blockItem` (Less bodies) | `183`/`497` | the whole Less statement set | DROP the Less fallback (§2) |

**Adversarial check — does any SCSS rule genuinely NEED Less semantics?**
- `&` (`g.LessAmpersand`) — the parent selector is a **shared preprocessor** feature. SCSS
  re-derives `simpleSelector` with a gated `&` arm (`scss grammar.ts:726`); Less even exposes
  `basicSel`/`extendAhead` for exactly this. It is Less-*named* only because SCSS composes on
  Less. → base concept, NOT `lessSigilDelta`.
- `DetachedRuleset`/`AnonymousMixinDefinition` — the block-as-value / callback concept is
  genuinely shared (SCSS references them ×2 for callback args). The Less-only part is the
  `@dr: {…}` *variable assignment* form, which lives in `lessSigilDelta`'s `VarDeclaration`.
  → the value form is neutral base; the assignment form is Less-only.
- `EscapedValue` (`~"…"`), `GluedParen`, `Guard`, `extendAhead` — genuinely Less-only; SCSS
  references them only inside `value`/selector/callArg choices where dropping them changes
  nothing for valid SCSS (and correctly rejects the Less-ism). → confirmed Less-only.
- `stylesheetItem`/`blockItem` — the leak vector; SCSS must supply its own (§2).

**Is `preprocessorBase` truly dialect-neutral?** The one genuine neutrality risk is the
**math-mode hook**. SCSS inherits `valueSequence`/`topSum`, i.e. Less's arithmetic
precedence, *even though it overrides `value`* — so Less's `/`-as-division policy would flow
into SCSS unless the base exposes value-arithmetic **parameterized by a parse-time math-mode
predicate** (`less-math-mode-is-parse-time`), not a hard-coded `/` policy. If that hook is
neutral, the base is neutral: interpolation is already an atom seam (`@{}` vs `#{}`), the
statement set is dialect-supplied, and no other bucket-(b) rule embeds a sigil.

---

## 2. The MASTER LEAK VECTOR and the statement-container seams

SCSS's `Stylesheet`/`atRuleBody`/`declarationList` fall back to Less's `g.stylesheetItem` /
`g.blockItem` (`scss grammar.ts:704-736, 822-825`), which admit the full Less statement set.
Dropping this one fallback removes ~80% of the leaks structurally.

**Design:** `preprocessorBase` defines `stylesheetItem` / `blockItem` as **named override
seams** whose neutral body is only the CSS-level statements (ruleset, declaration, plain
at-rule, nested rule). Each dialect delta overrides them to PREPEND its OWN preprocessor
statements, then the neutral base tail — never another dialect's set:
- SCSS: `scssStatement` (already assembled at `scss grammar.ts:704`: `@if/@each/@for/@while`,
  `@mixin/@include/@content`, `@function/@return`, `@use/@forward`, import, diagnostics,
  `@at-root`) + `ScssExtend` + placeholder rulesets, then the NEUTRAL base statements.
- Less: its own statement set (mixins, guards, detached-ruleset assignment, …).

Because override is by name, SCSS's `blockItem`/`stylesheetItem` shadow the base's and no
Less statement is reachable from SCSS. This subsumes W2's six wrong-accepts structurally
(the `it.fails` locks in `cross-dialect-leakage.test.ts` flip red → promote to `it`).

---

## 3. The name-keyed builder MAP (replaces `extends LessGrammar`)

### 3.1 Today — a `super`-chained switch

`CssParser.buildNode` → `_dispatchBuild` is `switch(type)` (`css builders.ts:454`).
`LessGrammar extends CssParser` overrides `buildNode` with its own switch (~46 Less cases) +
`default: super.buildNode(...)` (`less builders.ts:370-435`). `ScssGrammar extends
LessGrammar` overrides again + `default: super.buildNode(...)` (`scss builders.ts:154-227`).
The functional host `BuilderHost extends <dialect>Grammar` (`*/functional-parser.ts`) just
forwards `build(type,…) → this.buildNode(type,…)`. The `ctx.build` host dispatches purely on
the `type` string — the class chain sits *behind* that single seam.

The trap: an ancestor `case` (Less's `'QueryAtRuleBlock' → _buildLessQueryAtRuleBlock`)
intercepts a rule name before the intended override, because `super.buildNode` runs only on
`default`. Override-by-name is NOT total.

### 3.2 Target — a merged map keyed 1:1 by rule name

Replace each per-class `switch` with a `Record<string, BuilderFn>` built per dialect by
MERGING contributor maps, last-wins:

```ts
type BuilderFn = (ctx: BuildCtx, args: BuildArgs) => JessNode;

const cssBuilders:     Record<string, BuilderFn> = { Stylesheet, Ruleset, SelectorList, Numeric, … };
const preprocBuilders: Record<string, BuilderFn> = { /* shared: ampersand selector, interp fold, value-arith */ };
const scssBuilders:    Record<string, BuilderFn> = { ScssIf, ScssMixin, VarDeclaration, Reference, Quoted, Declaration, … };

const scssBuilderMap = { ...cssBuilders, ...preprocBuilders, ...scssBuilders };   // NO Less
const lessBuilderMap = { ...cssBuilders, ...preprocBuilders, ...lessBuilders };   // NO Scss
```

`build(type, …)` becomes `(map[type] ?? fallbackAny)(ctx, args)`. **INVARIANT: builder key
≡ grammar rule name, 1:1.** No private renamed builder (`_buildLessQueryAtRuleBlock`) may
shadow a rule name — that renamed indirection is exactly what created the dead-override trap.
A builder that needs base behavior calls the base contributor's function explicitly
(`cssBuilders.Quoted(ctx, args)`), replacing today's `super._buildQuoted`/`super.buildNode`
with ordinary function composition. This turns builder inheritance into a data merge:
`preprocBuilders` has a home the current class chain (SCSS-extends-Less) cannot express.

### 3.3 W1 as a byte-identical mechanical step (do FIRST)

W1 does NOT change the grammar or node outputs — it only flattens the three switches into
merged maps:
- Convert each `case 'X': return this._buildX(...)` into an entry `X: (ctx,args)=>…`; keep
  the method bodies (bind `this`/ctx).
- Merge `css ⊕ less` for the Less host and `css ⊕ less ⊕ scss` for the SCSS host **for now**
  (the Less contributor is dropped from SCSS only at P3, once the grammar no longer needs the
  Less fallback). Keeps W1 byte-identical while installing the mechanism.
- Because merge is last-wins by name, SCSS's `QueryAtRuleBlock` builder now WINS over Less's
  — the dead-override trap is fixed the moment the map lands (retire the
  `ScssQueryInterpBlock` workaround, coordinating with the prelude sessions, task_3bd93f77).

> `BUILDERHOST-RETIREMENT-DESIGN.md`: at the engine cutover the SOLE producer becomes the
> `ast/` dispatch-host (`core/src/ast/parse-host`), *already* a name-keyed action host. This
> interim builder-map is the shape for the legacy `tree/`-producing hosts and must not
> re-introduce the two-producer value-classification regex — value literals stay on the
> grammar's typed leaves.

---

## 4. Migration path — landable increments, no scss-suite regression

Each phase lands green on `packages/scss-parser` (and, where it touches Less,
`packages/less-parser`). Gate on both suites plus the cross-dialect leakage matrix.

### P1 — W1 builder-map dispatch  *(byte-identical; now; independent)*
1. css-parser: `_dispatchBuild` switch → `cssBuilders` map; `buildNode` looks up the merged
   map the host installs. Keep methods.
2. less-parser: `LessGrammar` switch → `lessBuilders`; Less host = `{...css, ...less}`.
3. scss-parser: `ScssGrammar` switch → `scssBuilders`; SCSS host = `{...css, ...less, ...scss}`
   (Less still present — dropped at P3).
4. **Gate:** all three parser suites byte-identical; verify `_buildQueryAtRuleBlock` is now
   reachable (trap fixed). Coordinate `ScssQueryInterpBlock` retirement with the prelude
   sessions.

### P2 — W5 factor `preprocessorBase`  *(Less-side; byte-identical Less)*  [dep: prelude sessions land first]
1. Add `preprocessorBase = compose([cssGrammar, rules({ trivia: rw }, preprocDelta)])` with
   the sigil-neutral bucket-(b) rules + the six named seams; `preprocBuilders`. Re-declare
   `{ trivia: rw }` WITH the `//` line-comment arm (CSS base omits `//`).
2. Re-express `lessGrammar = compose([preprocessorBase, lessSigilDelta])`; move Less's
   sigil-neutral rules into `preprocDelta`; keep Less-only rules (`@var`, `@{}`, `~"…"`,
   `.mixin()`, `when`, detached-ruleset *assignment*, `@import (options)`) in `lessSigilDelta`.
3. Less host builder map = `{...css, ...preproc, ...less}`.
4. **Gate:** `packages/less-parser` suite byte-identical — proves the factor is pure
   relocation (Less's designed seams make this a move, not a rewrite).

### P3 — W6 re-point SCSS  *(the sever)*
1. `scssGrammar = compose([preprocessorBase, scssSigilDelta])` — replace
   `import { lessGrammar }` with `import { preprocessorBase }`.
2. SCSS host builder map = `{...cssBuilders, ...preprocBuilders, ...scssBuilders}` — DROP the
   Less contributor. `ScssGrammar` stops extending `LessGrammar` (`scss builders.ts:123`) —
   it composes css + preproc contributors instead.
3. Drop SCSS's Less-only seam refs: `g.EscapedValue`, `g.GluedParen`, `g.Guard`,
   `g.extendAhead`, and the Less `g.stylesheetItem`/`g.blockItem` fallback (now the
   SCSS-overridden seams from §2). Re-home the neutral names SCSS still needs
   (`DetachedRuleset`/`AnonymousMixinDefinition` value forms, `LessAmpersand`→neutral `&`,
   `basicSel`) onto `preprocessorBase`.
4. **Gate:** SCSS suite green; the `it.fails` tracked wrong-accepts in
   `cross-dialect-leakage.test.ts` flip red → promote each to a plain `it` IN this commit
   (they now correctly reject). `sass-spec-errors.test.ts` XFAIL set shrinks or holds
   (its symmetric-diff assertion catches regressions both directions).

### P4 — W7 fill the exposed gaps  *(positive additions)*
Removing the Less fallback exposes anything SCSS silently leaned on Less to parse. Each is a
POSITIVE addition in `scssSigilDelta` (or, if neutral, `preprocessorBase`):
- **Statement set** — already assembled (`scssStatement`); ensure `blockItem`/`stylesheetItem`
  seams route to it, not Less.
- **Selector stack** — shared ampersand + `#{}` interp (`InterpolatedSelector`, already
  overridden) + `%` placeholder (`ScssPlaceholderSelector`); confirm no residual Less-named
  `basicSel`/`extendAhead` dependence (re-home neutral versions to base).
- **Arithmetic + math-mode** — SCSS `/`-deprecation vs Less parens-division. HIGHEST RISK:
  SCSS inherits `valueSequence`/`topSum`, so the base value-arithmetic MUST be
  math-mode-parameterized; SCSS supplies its `/` policy.
- **Custom-prop values** — `customValue`/`cpValue` seam fills (already overridden).
- **Named colors** — from `cssGrammar` (`NamedColor`); confirm reachable without Less.
- **Rejection tests** — per dropped leak (W2/W12 matrix), assert SCSS now rejects.

---

## 5. How this unblocks `builders.ts` / `BuilderHost` deletion

`BUILDERHOST-RETIREMENT-DESIGN.md` establishes that deleting
`less-parser/src/builders.ts` (`LessGrammar`) + the `BuilderHost` subclass is the endgame
that clears ~33 of the ~34 remaining Less builders.ts regex "for free" at the engine
cutover (the `ast/` dispatch-host becomes the sole producer). Its §4 blocker table lists the
consumers that must be severed first: production render (tree/ eval — the true gate, clears
at the object-reduction cutover); the less-compat bridge (non-sacred, re-pointed at R4); the
`ast/` import sub-parse (re-pointed at R0).

**This rebase removes a consumer that table does NOT yet account for: a SECOND PACKAGE
extends the class.** While `class ScssGrammar extends LessGrammar` (`scss builders.ts:123`)
and `scssGrammar = compose([lessGrammar, …])` hold, deleting `LessGrammar`/`lessGrammar`
breaks scss-parser at compile time — a hard cross-package block orthogonal to the render
cutover. After **P3**, SCSS imports neither `lessGrammar` nor `LessGrammar`; the only
remaining consumers of `builders.ts` are Less's own render + bridge — exactly the ones the
retirement design already sequences at R4. So this rebase is a **named precondition of
`BUILDERHOST-RETIREMENT-DESIGN.md` R4**: with it done, R4's "delete `builders.ts` +
`BuilderHost` wholesale" no longer has a hidden scss-parser dependency, and the deletion is
gated only on the (already-tracked) Less render cutover + bridge re-point.

**Action at R4 land:** add to the retirement design's §4 blocker table — "cross-package
`ScssGrammar extends LessGrammar` — cleared by SCSS-PARSER-REBASE-DESIGN P3."

---

## 6. Byte-identity / test-preservation plan

The scss-parser suite (`packages/scss-parser/test/`, 10 test files) is the contract to
preserve. SCSS has NO less-compat bridge, so its internal test expectations are freely
updatable when the intended output is confirmed (`no-sacred-test-expectations`); the
dart-sass sass-spec corpus is the SCSS reference oracle.

| Suite | Locks | Behavior through the rebase |
|---|---|---|
| `baseline`, `parse-only`, `coverage-features`, `parseman-grammar-basic` | valid SCSS → right tree | MUST stay green every phase (P1 byte-identical; P3/P4 unchanged for valid SCSS) |
| `ast-serialize` | serialized-output byte-identity | MUST stay byte-identical for valid SCSS |
| `cross-dialect-leakage` | `it.fails` TRACKED wrong-accepts + GREEN reject regression guards | P3 is the EXPECTED flip: each `it.fails` becomes a real reject; the in-file protocol is "delete the `it.fails` wrapper, promote to plain `it`." Land the promotion IN the P3 commit |
| `sass-spec-errors` | `XFAIL_PARSE_MISSES` frozen baseline (symmetric-diff) | catches regressions AND newly-fixed fixtures; as P3/P4 tighten, remove matching XFAIL entries the same landing |
| `sass-spec.smoke` | valid sass-spec fixtures parse clean | MUST stay green — the positive-corpus guard that P4's dropped fallback did not over-reject |
| `cst-public`, `inner-ampersand` | CST shape + `&`-nesting gate | `&`-nesting moves to `preprocessorBase` (shared) — `inner-ampersand` staying green proves the ampersand arm is faithfully re-homed |

**Protocol:**
1. **P1**: run scss + less + css suites; require byte-identical (map flatten is pure). Record
   the trap-fix (`_buildQueryAtRuleBlock` reachable).
2. **P2**: require `packages/less-parser` byte-identical (factor is relocation).
3. **P3/P4**: the ONLY intended behavior changes are (a) leaked Less-isms now reject (leakage
   matrix flips → promote), (b) any XFAIL fixture SCSS now rejects. Valid-SCSS output MUST
   NOT change — assert via `ast-serialize` + `sass-spec.smoke`. Any valid-SCSS output diff is
   a P4 gap (Less was silently parsing something SCSS must now parse itself) → fix forward in
   `scssSigilDelta`, NEVER by re-adding the Less fallback (`never-revert-lean-ification-on-red`).

---

## 7. OPEN (owner) items

1. **Package boundary for `preprocessorBase`.** New package `@jesscss/preprocessor-base`, or
   an internal module re-exported from `css-parser` (already a shared dep of both dialects),
   or a `less-parser`-internal module both import? A new package is the cleanest "no dialect
   composes on another" but adds a build-order node. **Recommendation:** internal module under
   `css-parser` (`@jesscss/css-parser/preprocessor`) — no new package, honors the
   neutral-base intent, `css-parser` is already a shared dependency.
2. **Math-mode hook shape.** Confirm the neutral value-arithmetic hook (a parse-time
   `mathMode` predicate governing `/`) that both Less parens-division and SCSS
   `/`-deprecation parameterize (`less-math-mode-is-parse-time`). The single
   highest-risk neutrality question for §1's dialect-neutral check.
3. **Builder-map vs the `ast/` dispatch-host.** Should the interim `preprocBuilders`/
   `scssBuilders` maps be shaped to converge onto the `ast/` parse-host action-map layout, so
   P1's mechanical flatten also pre-stages the cutover? (Coordinate with
   `BUILDERHOST-RETIREMENT-DESIGN.md`.)
4. **Sequencing vs in-flight prelude sessions.** P2/P3 move
   `QueryAtRuleBlock`/`atPrelude`/`AtRuleBlock`/`queryPrelude` into `preprocessorBase` — the
   exact rules the prelude-restructure (task_3bd93f77) + bare-`@var`-in-prelude (task_724c20d1)
   sessions edit. Per the program doc's conflict map, the re-base MUST consume their FINAL
   shape — P1 lands now (independent); P2+ after they land.
