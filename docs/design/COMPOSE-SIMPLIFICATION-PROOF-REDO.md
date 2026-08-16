# Compose-simplification proof — redone the correct way (whole-CSS base + helper hoist)

**Scope.** Re-run of the compose-simplification proof, correcting the two
methodology errors of the prior attempt
(`COMPOSE-FAMILY-PROOF-SCSS-SELECTOR.md`, commit `b87f007ea`): (1) it built a
THIN standalone base with a hole (`CompoundSelector`) and (2) it skipped the
prerequisite helper hoist. This run composes onto CSS's **whole, hole-free**
grammar after hoisting CSS's reducer helpers to an importable module.

**Base SHA:** `8fb0a35775f5bf227398d76d493fa44441bd866e` (branch
`compose-proof-redo`, forked from `origin/dev`).

**Parseman:** the **lifted** `compose-analyzer-lifts` build, installed via
`pnpm.overrides.parseman = file:…/deliverables/parseman-0.48.1.tgz`. The tarball
is version-labeled **0.48.1** (not 0.49.0); it carries the three lifts
(`buildImports` present in `dist`; patch `0001-feat-plugin-compose-analyzer-lifts…`).
On stock parseman the base refuses immediately (`unsupported binding(s):
tokenText`), so every positive fuse result below is from the lifted build.

---

## Bottom line (three findings, do not conflate them)

1. **The whole-CSS hole-free base DOES macro-fuse.** After hoisting CSS's
   reducer helpers to an importable module, `cssBaseRules = compose([cssSyntax,
   opaqueAtRuleRecognition, cssPseudoSyntax, rules(cssFactory)], {hostMode:'ast'})`
   compiles to a **fused static table** (0 interpreter fallbacks, 0 degraded, 0
   runtime `compose(` calls in the artifact). It is a **208-rule hole-free** map
   and **parses byte-for-byte-identical AST to standalone `cssGrammar`**. This
   **refutes the prior proof's central technical claim** ("a hole poisons
   fusion / a hole-free base cannot fuse" — that was an artifact of the THIN
   base with a hole, not a property of a real base).

2. **The actual dialect pattern — `compose([cssBaseRules, rules(delta)])` — does
   NOT macro-fuse under this build (RESIDUAL BLOCKER).** Composing a delta ONTO
   the base fails two ways, both reproduced:
   - **same-package** (delta module does not itself import the base's helpers):
     the macro emits the base's reducers but does **not re-emit their imports**,
     yielding `166 identifier(s) are read but bound by nothing … would throw
     ReferenceError` → fail-closed refusal.
   - **cross-package** (`scss-parser` importing `cssBaseRules` from
     `@jesscss/css-parser/grammar`): the macro cannot lower it
     (`ref() used before .define()`), leaves a **runtime** `compose()`, which
     then **throws at runtime**: `IR direct node builder for VarCall references
     module import(s) funcCall, functionOpenName, isValueSlotValue that a runtime
     compose() cannot supply`.
     So the four-grammar compose refactor is **not truly unblocked** by this
     lifted build: the base's builder imports are not propagated to the module
     that composes onto it. `cssBaseRules` fuses only because it is compiled in
     the same module (`grammar.ts`) that already imports all the helpers.

3. **Even if it fused, compose does NOT substantially lean SCSS.** SCSS's
   152-entry rule map is **~83% genuine overrides** (131/157 node rules). Only
   **11 rules are confidently inheritable**, 15 more are keep-uncertain →
   **deletion range 7–17% (11–26 rules)**. This is essentially the prior proof's
   ~12–18% ceiling. The owner's hypothesis ("MUCH more than ~18% deletion if
   most of SCSS's copies are behavior-equivalent") is **not borne out**: most
   SCSS "copies" are **not** behavior-equivalent — they inject `#{…}`
   interpolation or run Sass value/math semantics, which are genuine overrides
   regardless of the base being hole-free.

**So the prior proof was WRONG on fusion (a hole-free base fuses) and roughly
RIGHT on the inherit rate (low), and there is an additional blocker that stops
the composition from being realized at all today.**

---

## Finding 1 — the whole-CSS base fuses (evidence)

### The prerequisite hoist (STEP 1, behavior-neutral)

CSS's 515-line block of module-private reducer helpers (`tokenText`,
`foldOperation`, `complexSegments`, the `is*` guards, …) was moved verbatim from
`css-parser/src/grammar.ts` to a new importable module
`packages/core/src/ast/css-grammar-helpers.ts` and re-exported from the
`@jesscss/core/ast` barrel. Why core/ast: it is the module every grammar already
imports its AST constructors from, so the analyzer's provenance rescue re-emits
`from '@jesscss/core/ast'`, which resolves everywhere (the precedent set by the
−32KB byte-identical hoist, `4fb05c560`). A dedicated module keeps these
CSS-specific helpers out of the byte-identical-only `grammar-helpers.ts`.

One wrinkle surfaced (see "New refusal" below): a reducer passed **by bare name**
(`node('CalcProduct', pat, foldOperation)`) refuses once `foldOperation` is an
import; it was wrapped in an inline arrow (`children => foldOperation(children)`),
which routes it through the free-binding rescue and also clears the
`build-arity-unconfirmed` degradation.

**Behavior-neutral verification:**
- css-parser suite: **512/512 pass**.
- SCSS byte-identity oracle (2404 sass-spec cases, AST + CST **parse-result**
  surfaces): **identical** to the pre-change baseline (self-generated to sidestep
  the env-red committed baseline, task #61).
- `check:macro`: all 5 parsers fully macro-buildable, **0 fallbacks**.
- `check:guardrails` OK; no `as any`/`: any`/`@ts-ignore` in the added files.

### The base export (STEP 2) and its fusion

```ts
export const cssBaseRules = compose(
  [cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax,
   rules({ trivia: whitespace, scanSkip: […] }, cssFactory)],
  { hostMode: 'ast' }
);
```

- Builds clean; **0 runtime `compose(`** in the artifact (fused to a table).
- `cssBaseRules` is a **208-rule, hole-free** map — `Stylesheet`,
  `BasicSelector`, `CompoundSelector`, `ComplexSelector`, `SelectorList`,
  `Value`, `CalcSum`, `VarCall`, `AttributeSelector`, `PseudoSelector` all
  present (the prior proof left `CompoundSelector` a HOLE).
- Parsing `.a > .b:hover, div[data-x="y"] .c { color:red; width:calc(1px + 2px);
  background:var(--z, blue) }` through `cssBaseRules.Stylesheet` yields an AST
  **identical** to standalone `cssGrammar`.

Repro: `docs/design/compose-proof-probes/` and the base re-export in
`css-parser/src/grammar/ast.ts`.

## Finding 2 — the base+delta compose does not fuse (the residual blocker)

Reproduction lives at
`docs/design/compose-proof-probes/scss-cross-package-compose-probe.ts`: a
minimal `scss-parser` delta that overrides ONE leaf (`BasicSelector`, widened
with a `%placeholder` form) and inherits the whole selector subtree from
`cssBaseRules`. Wiring it as a build entry produces, at build time:

```
compose(): could not be lowered to a table; leaving the runtime compose() in
place — ref() used before .define()
```

and at runtime:

```
IR direct node builder for VarCall references module import(s)
funcCall, functionOpenName, isValueSlotValue that a runtime compose() cannot
supply; compose at build time via the parseman macro plugin, which re-emits the
imports.
```

A same-package twin (delta importing `cssBaseRules` from `./grammar.js`) fails
differently but for the same root cause — the base's helper imports are not
re-emitted into the composing module:

```
parseman will not emit this module: 166 identifier(s) are read but bound by
nothing … would throw ReferenceError  (sourceText, isNodeType, importPrelude, …)
```

The patch claims "the plugin harvests provenance off the composed graph and
re-emits the imports into the fused module." Empirically that re-emit does **not**
fire for `compose([importedBase, rules(delta)])`. This is the blocker to route
to the parseman lane; it is distinct from the three named lifts.

## Finding 3 — the lean measurement

SCSS grammar: **152 rule-map entries** (157 `node()` rule consts). Per-rule
classification against the CSS base, using the criterion "delete if CSS's rule
WOULD WORK for SCSS (same accepted language + same emitted node), even if spelled
differently; keep only if SCSS must parse it differently":

| Classification | Count |
|---|---|
| Genuine override — interpolation `#{…}` injection/reservation | ~30 |
| Genuine override — Sass value/math semantics | ~24 |
| Sass-only construct (no CSS counterpart) | ~45 |
| Genuine override — shape/body divergence (admits Sass directives) | ~32 |
| **Genuine-override subtotal** | **131** |
| **Inheritable (behavior-equiv incl. naming-divergence)** | **11** |
| Keep-uncertain (conservative keep; couldn't prove equivalence quickly) | **15** |
| **Total** | **157** |

- **Genuine overrides: 131/157 (83%).**
- **Confidently deletable: 11** — the value **leaves** (`Color`, `Keyword`,
  `CustomPropertyValue`, `UnicodeRange`, `Important`, `Dimension` = CSS
  `Dimension`+`Percentage`) and selector **leaves** (`SimpleSelector`≈
  `BasicSelector`, `NamespaceTypeSelector`, `NestingSelector`, `KeyframeSelector`)
  plus `QueryPrelude`.
- **Deletion range 11–26 of 152 (7–17%).** 15 keep-uncertain are the pseudo-text
  captures (`Nth*`, `Generic`, `PseudoArgument`) and the descriptor blocks whose
  only divergence is `Comment`-as-node.

### The two towers

- **Value/math tower is a genuine different-language override**, not inheritable.
  `Value`/`ValueTerm`/`ValueAtom`/`ValuePair`/`Math*`/`Call`/`Collection` fold
  Sass arithmetic into `Operation` nodes and build `and`/`or`/`not`/comparison
  lists; CSS emits space-separated `Sequence`s and folds math only inside
  `calc()`. Only the pure value leaves inherit.
- **Selector tower is mixed**: the **leaves** inherit (naming-divergence:
  scss `Simple`/`Compound`/`Complex`/`Selector` vs css
  `BasicSelector`/`CompoundSelector`/`ComplexSelector`/`SelectorList`), but the
  **structural chain** `Compound → ComplexTail → Complex → Selector →
  NestedSelector` is a genuine override because `Compound` must admit `#{…}`
  (`InterpolatedSimple`) and `%`-placeholders, and every parent inherits that
  through the reference chain.

### Net source change

- **SCSS delta:** could delete **11 (confident) – 26 (optimistic)** of 152 rule
  consts. The other **131–146 are genuinely required.** So SCSS source shrinks by
  ~7–17% of its rule consts at best — not the large lean hoped for.
- **CSS side (one-time, shared by all three supersets):** the 515 helper lines
  are a **pure relocation** (grammar.ts −523/+60; new `css-grammar-helpers.ts`
  565 = 515 moved + ~50 scaffold). The genuinely **new** boilerplate to enable
  compose is ~**160 lines** total (barrel re-exports 55, helper-import list ~45,
  the `cssBaseRules` export ~16, the base re-export 3, module scaffold ~50) —
  amortized ~53 lines/superset.
- **Global net (CSS side): +~160 lines** of one-time boilerplate; SCSS unchanged
  in this run because the base+delta compose does not fuse, so no deletion was
  realized.

---

## Answers to the standing questions

1. **Parseman:** lifted `compose-analyzer-lifts` build, `file:` tgz override,
   version string **0.48.1** (not 0.49.0), `buildImports` present. Positive fuse
   results are from this build; stock parseman refuses.
2. **Green:** whole-CSS base macro-fuses ✔; CSS parse-result identity ✔ (512
   tests + SCSS oracle unchanged); base parses identical AST ✔. **Not** green:
   SCSS composed-and-fused (blocked, Finding 2).
3. **Coverage:** CSS base + partial SCSS only. **Less and Jess not composed**
   (they build green against the additive core change but were not converted). 2
   of 4.
4. **New refusal beyond the three lifts:** **yes, two.** (a) A reducer passed by
   **bare name** refuses once it is an import (`unsupported callback shape` /
   arity-unconfirmed) — mechanical fix: wrap in an arrow. (b) **The base+delta
   compose does not re-emit the base's helper imports** (Finding 2) — the real
   blocker; the four-grammar refactor is not unblocked by this build.
5. **ETA to a fused, oracle-green SCSS result:** blocked on the parseman lane
   (Finding 2). Once unblocked, the SCSS-side work is the P22 migration (hoist
   SCSS's ~80 reducer helpers, convert the export, delete the 11–26 inheritable
   rules, oracle sweep) — hours, but the payoff is small (Finding 3).

## Verdict

Composing onto the whole hole-free CSS base **does macro-fuse** (correcting the
prior proof), but under this lifted build **a delta cannot be composed onto that
base** (the base's imports are not re-emitted), and even if it could, SCSS is
**~83% genuine overrides**, so compose leans SCSS by only **7–17%** at best. The
prior "net worse / low inherit rate" conclusion was a **correct inherit-rate
result reached through a wrong fusion argument**; the corrected method reproduces
the low inherit rate and adds a newly-located parseman blocker.
