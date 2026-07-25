# Pseudo-argument always-structure landing (design, pre-implementation)

Status: DESIGN for owner review — adversarial pass done against the parseman macro-fusion
constraints (proven in `PSEUDO-ARGUMENT-CONSOLIDATION-DESIGN.md`) and the core PseudoSelector model.
NOT implemented. Follow-on to that doc's Landings 1a/1b/1c (css/jess/less nth recognition — LANDED).
Owner directive driving this: "we should always parse structure, even for unknowns" +
"delete `*SelectorText` helpers, core owns joins."

## 1. Goal

Finish the consolidation by making every dialect model a functional-pseudo argument as STRUCTURE,
not opaque text — which simultaneously (a) closes the two tracked cross-dialect divergences, (b)
gives SCSS the `of`→child restriction it still lacks, and (c) deletes the duplicated
`selectorArgumentText` (css) / `staticSelectorText` (jess) helpers. After this, all four dialects
agree on what a pseudo argument is, and core `pseudoCanonical` is the sole serialization site.

### What's already true (don't re-do)
- `PseudoSelector { name, args: SelectorList|null, text, interp, crossable }` — `text` is retained
  ONLY for the degrade-to-opaque `args:null` case ([nodes.ts:468](../../../packages/core/src/ast/nodes.ts)).
- `crossable` is core-owned: `CROSSABLE_PSEUDOS = {':is', ':matches'}` ([nodes.ts:963](../../../packages/core/src/ast/nodes.ts)).
  → the design doc's "move crossablePseudos to core" is ALREADY DONE; nothing to move.
- `pseudoCanonical(p)` ([nodes.ts:589](../../../packages/core/src/ast/nodes.ts)) is the single core
  join site; the parser never joins.
- Shared g-free recognition artifact `cssAstPseudoSyntax` exists on dev and is the proven sharing
  mechanism (recognition-only `rules()` referenced via `g.`).

## 2. The per-pseudo argument taxonomy (the shared classification)

CSS functional pseudos fall into argument classes. The NAME→class mapping is a g-free recognition
fact — it extends the shared `cssAstPseudoSyntax` artifact (name-classifying regexes), and each
dialect dispatches on it and assembles its own arg grammar from its own selector/ident/value/interp
productions (the assembly stays per-dialect — the spike proved a shared SEMANTIC artifact is
impossible; only recognition + `g.`-refs are shareable).

| class | pseudos | argument grammar | on non-match |
| --- | --- | --- | --- |
| selector-list | `:is :where :not :has :matches` (+ `::slotted :host :host-context` where supported) | dialect selector-list (+ interp) | REJECT |
| nth | `:nth-child :nth-last-child` | An+B `[of <selector>]` (+ interp) | REJECT |
| nth-of-type | `:nth-of-type :nth-last-of-type` | bare An+B (+ interp) | REJECT |
| ident-list | `:lang :dir` | ident/string comma-list | REJECT (or opaque — §7 Q1) |
| any-value | unknown/other functional pseudos | dialect structure-preserving `<any-value>` | keep structure |
| sealed-opaque | `:global :local :extend()` (dialect-specific) | dialect-owned, unchanged | — |

The taxonomy is the crux: today every dialect has ONE catch-all "raw pseudo argument" (`scanTo ')'`)
that accepts anything for any functional pseudo — which is exactly why `:not(2n+1)` and
`:nth-of-type(2n of .a)` leak through. Replacing the single catch-all with name-classed arg grammars
is the whole change.

## 3. How this closes the two tracked divergences

- **`:not(2n+1)`** (css accepts as raw, jess rejects): `:not` is selector-list class → arg is
  selector-only, no raw fallback → `2n+1` is not a selector → ALL dialects REJECT. css loses its raw
  fallback for selector-arg pseudos; jess/less already reject. Converged.
- **bare `:nth-child`** (less rejects, css/jess accept as keyword pseudo): the nth/nth-of-type
  classes REQUIRE a `(…)` (function token); a paren-less nth name is NOT admitted as a bare
  keyword pseudo → ALL reject, matching less. css/jess add the boundary exclusion less already has.

## 4. `*SelectorText` deletion

`selectorArgumentText` ([css grammar.ts:359](../../../packages/css-parser/src/ast/grammar.ts)) and
`staticSelectorText` ([jess grammar.ts:338](../../../packages/jess-parser/src/ast/grammar.ts)) exist
only to stringify a selector-arg pseudo when it degrades to `text`. Once selector-arg pseudos ALWAYS
populate `args: SelectorList` (never degrade to text — reject instead), both are unused → delete.
The nth `of <selector>` text join also stops flattening: the retained selector rides in `args` /
a structured nth arg, and `pseudoCanonical` serializes it. (The `,` vs `, ` divergence dies with the
helpers — there is no parser-side join left to disagree on.)

## 5. SCSS: text → structure (the largest lift)

SCSS today models pseudo args as raw text chunks
([scss grammar.ts:2484-2593](../../../packages/scss-parser/src/ast/grammar.ts)): `DirectScssNthPseudo`
(text + `.trim()`), `DirectScssSelectorPseudo` (comma-normalized text), `DirectScssStructuredPseudo`
(the only structured arm, `:is/:not/…`), `DirectScssGenericPseudo` (raw). Migration:
- Selector-arg pseudos → route ALL of `:is/:where/:not/:has/:matches` through `g.DirectScssSelector`
  (structured), not just the current structured arm; drop the text `DirectScssSelectorPseudo` arm.
  This also fixes the residual `:not( .b )` surrounding-whitespace bug for free (structured →
  `pseudoCanonical` normalizes).
- nth → dispatch child/of-type via the shared names, structured An+B + of-restriction (the piece
  scss is missing today), rejecting `:nth-of-type(2n of .a)`.
- `#{…}` interpolation stays the escape hatch: an interpolated arg degrades to the dialect's
  interp-bearing representation, exactly as `@{…}`/`$(…)` do in less/jess. It never becomes a
  structured static selector.
- Highest byte-identity risk (text→structure changes what many selector args serialize to) →
  sequenced LAST, gated on the full SCSS byte-identity corpus + the less-compat bridge.

## 6. Macro-fusion + shape (unchanged mechanism)

- Extend `cssAstPseudoSyntax` with the g-free name-class regexes (`selectorArgPseudoName`,
  `identArgPseudoName`, the nth names already there). Recognition-only → fuses as a non-final
  `composeLeaf` arg; each dialect references `g.`.
- Each dialect's inline block dispatches on the classes and assembles arg grammars from its own
  `g.<Selector>` / `g.<Interp>` / `g.<Value>` productions + a shared reducer helper. No shared
  semantic artifact (spike-forbidden). Each parser's `*macro-compiled*.test.ts` must stay green.
- AST model: selector-list/nth args already fit `PseudoSelector.args` (SelectorList) + a structured
  nth. The open model question is the ident-list / any-value classes (§7 Q1).

## 7. Owner resolution (2026-07-23) + concrete per-dialect deltas

**Q1 RESOLVED — three classes; unknowns use the general-any algorithm.** Owner: "for unknowns they
can be the general unknown any algorithm (like matching braces and general tokens like quotes and
comments)." So:
- **selector-list class** (`:is/:where/:not/:has/:matches` + slotted/host) → dialect selector-list
  (+ interp), REJECT non-selector.
- **nth class** (`:nth-child/:nth-last-child` An+B `[of sel]`; `:nth-of-type/:nth-last-of-type` bare
  An+B) → structured, REQUIRE `(…)`, of-restriction.
- **general-any class** (`:lang`, `:dir`, unknown `:foo(…)`) → the EXISTING balanced-paren/bracket/
  quote/comment-aware scan (css `pseudoRawArgument`, scss chunk grammar, less
  `DirectLessStaticNonSelectorPseudo`) producing a VERBATIM capture. This already IS the "general any"
  algorithm — kept as-is, not flattened/canonicalized, no per-pseudo typing, no `PseudoSelector.args`
  model change. Q2 (lang/dir malformed strictness) is therefore moot — verbatim any-value.

The divergence fixes come entirely from tightening the selector + nth classes so they no longer FALL
THROUGH to the general-any arm; the general-any arm itself is unchanged.

**Per-dialect delta (traced against current grammars):**
- **less — already correct, NO change.** `:not/:is/…` route through `directStaticSelectorPseudoName`
  → selector-only (rejects `:not(2n+1)`); the generic-any arm excludes both selector-arg AND nth
  names; bare `:nth-child` is rejected by its identifier-boundary guard. Done.
- **jess — one change.** Already selector-only for `:not` (post-1b rejects `:not(2n+1)`). Needs the
  bare-nth-name guard so `:nth-child`/`:nth-of-type` WITHOUT `(…)` reject (currently accepted as a
  keyword pseudo).
- **css — two changes.** (1) Make selector-arg pseudos (`:is/:where/:not/:has/:matches`) selector-only
  by adding a shared selector-arg-name class and routing those names to `CssAstGenericPseudoArgument`
  WITHOUT the `pseudoRawArgument` fallback (the fallback stays for the true general-any pseudos only)
  → rejects `:not(2n+1)`. (2) Add the bare-nth-name guard (reject `:nth-child` with no `(…)`).
- **scss — the big one (text→structure).** Route `:is/:where/:not/:has/:matches` through
  `g.DirectScssSelector` (structured) not the text arm; nth → structured child/of-type + of-restriction;
  add bare-nth guard; keep `#{…}` interp escape + the general-any chunk scan for lang/dir/unknown.
  Fixes the residual `:not( .b )` whitespace bug. Highest byte-identity risk → last, full-corpus gated.

**`*SelectorText` deletion**: selector-arg pseudos always populate `args: SelectorList` now (never a
text degrade) → css `selectorArgumentText` / jess `staticSelectorText` selector-degrade uses die.
Their remaining use is the nth `of <selector>` text join; deleting them fully requires the nth arg to
carry the of-selector structurally (structured An+B + SelectorList) rather than a joined string —
included where cheap, else tracked.

**Q3 — migration order (recommended):** (i) css selector-only + css/jess bare-nth guards +
`*SelectorText` deletion where clean — one landing, closes BOTH divergences, byte-gated; (ii) scss
text→structure — its own full-corpus-gated landing. less needs nothing.

## 8. Adversarial review — invariants

- **Macro-fusion**: recognition-only shared classes + local assembly + `g.`-refs — the proven
  mechanism; no shared semantic artifact. ✅
- **Parser owns structure / core owns joins**: selector args ride in `args`; `pseudoCanonical` is the
  only join; `*SelectorText` deleted. ✅
- **Rob-Peter**: selector-arg-only tightening rejects `:not(2n+1)` etc. — audited: no valid CSS
  regresses (a valid `:not` arg IS a selector); interp escape hatches (`@{}`/`#{}`/`$()`) preserved
  per dialect; less `:extend`/`@{n}` and jess `$` untouched. ✅
- **Byte-identity risk**: concentrated in scss (text→structure) → last, full-corpus gated. css/jess/less
  selector-arg change is low-risk (valid selector args already parse; only invalid non-selector args
  newly reject — grep fixtures). ✅
- **No hidden classes**: same `PseudoSelector`/`SimpleSelector` shapes (unless 7-a adds an args
  union — then shape-stability review needed). ✅
