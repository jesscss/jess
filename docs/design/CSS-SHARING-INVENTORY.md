# CSS sharing inventory across the four grammars

> **PROVENANCE — every count below is a fact about `4dcfd84fb`, not about `dev`.**
> Measured 2026-07-24 and landed unchanged, so the structure it reads no longer
> exists: `packages/internal-css-recognition/` is now `@jesscss/parser-shared`
> (`a74131e8f`), and the four `src/ast/grammar.ts` files it counts 13,415 lines
> across were deleted by the host-mode fold — each dialect now has one
> `src/grammar.ts`. Since then the by-const promotion sweep restructured all four
> grammars and P20 replaced six hand-spelled at-rule name lists with `not()`
> composed over shared leaves, which is a direct change to the sharing picture
> this document measures.
>
> The METHOD and the BROKEN rows are what survive: each broken row was an observed
> rejection through a built parser, so it is a real defect unless separately fixed.
> The reference-matrix counts need re-running before they are quoted. Landed for
> the method and the defect list, not for the numbers.

Answers the question: *how many other CSS constructs are not properly shared?*

**Method.** Read `packages/internal-css-recognition/src/{recognition,opaque-at-rule,pseudo-consts}.ts`
and all four `packages/{css,less,scss,jess}-parser/src/ast/grammar.ts` (13,415 lines);
computed a shared-rule reference matrix mechanically; then ran a 200+ case
**empirical conformance battery** of pure-CSS snippets through all four built
`parse()` entry points. Every BROKEN row below is an observed rejection, not an
inference from source.

**Covered:** values/component values, selectors, at-rules, media/container/supports
queries, functions, units, custom properties, nesting, comments, empty statements.
**Deferred:** `@media` level-3 legacy `-webkit-min-device-pixel-ratio` style vendor
features; `@font-feature-values` descriptor *semantics*; error-recovery quality
(only accept/reject was measured); CSS-wide keyword handling (`revert-layer` etc.),
which is a value-keyword concern with no per-dialect grammar.

---

## Headline

The shared layer exports **55 CSS-generic rules**. Only **13 are referenced by all
four grammars**. Two are referenced by **nobody**.

| | count |
|---|---|
| shared rules referenced by all 4 | 13 |
| shared rules referenced by 3 | 8 |
| shared rules referenced by 2 | 19 |
| shared rules referenced by 1 | 13 |
| shared rules referenced by 0 (dead) | 2 |
| **CSS constructs where ≥1 dialect rejects valid CSS** | **26** (§1) |

The recurring failure mode is not "a construct was forgotten". It is that
**`internal-css-recognition` shares lexical terminals but almost no CSS *shapes*.**
`calc()`, `<ratio>`, `<mf-range>`, `var()` fallback, the attribute selector, the
pseudo-argument shape, keyframe selectors, the combinator set, and every at-rule
body are structure, not terminals — so each dialect re-derives them, and they drift.

A second, sharper mechanism produces most of the jess and less breakage:
**the shared `genericAtRuleName` (recognition.ts:75) excludes 19 known at-rule names
from the opaque fallback.** That exclusion is only safe if the dialect implements a
typed rule for each excluded name. jess implements 7 of them; less composes no
opaque fallback at all. Every un-implemented excluded name therefore falls into a
hole with no recovery path.

---

## 1. BROKEN — a dialect rejects valid CSS

Sorted by blast radius. `repro` is the exact input; the dialect column lists which
parsers throw.

| # | construct | fails in | repro | note |
|---|---|---|---|---|
| B1 | **`calc()`** | jess | `a{width:calc(1px + 2px)}` | `calc` appears **zero times** in the jess grammar. `calc(` matches the generic call; bare `+`/`-`/`*` match no operand arm. `min()`/`max()`/`clamp()` share the same operand grammar, so they don't rescue it. Arithmetic exists only behind Jess's `$( … )` sigil. |
| B2 | **`&` nesting selector** | jess | `a { & b { color: red } }` | No `&` token anywhere in the jess grammar. `&:hover`, `&.b`, `& b` all reject. css/less/scss each have their own local `literal('&')`. |
| B3 | **`unicode-range`** | jess rejects; **css + scss corrupt** | `@font-face{unicode-range:U+0-7F}` | Only less recognises it (local `directUnicodeRange`, less:1478). css yields `[Keyword(U), Dimension(+0), Dimension(-7F)]`. **scss folds it into arithmetic** — `Operation('-', Operation('+', Keyword(U), 0), 7F)` — and re-serialises as `U + 0 - 7F`. That is data corruption, not a gap. |
| B4 | **selector namespaces** | scss, jess (type); css, scss, jess (attribute) | `ns\|a{color:red}` · `[ns\|a="b"]{color:red}` | scss/jess combinator sets are `('\|\|','>','+','~')` — the single `\|` is absent (scss:2974, jess:1663). For attribute namespaces only **less** works (`DirectLessStaticAttributeNamespace`, less:4136). All four accept `@namespace` itself — so the at-rule parses and its syntax doesn't. |
| B5 | **`<general-enclosed>` in media queries** | **all four** | `@media (foo: bar baz){a{color:red}}` | mediaqueries-4 §3.1. **css throws a raw internal `Error` ("CSS AST value grammar lost its value child"), not a `CssParseError`** — an invariant violation escaping the public API. css/scss/jess have general-enclosed for `@supports` only; the media path has no such arm. |
| B6 | **vendor-prefixed unknown at-rules** | jess | `@-ms-viewport{width:device-width}` | jess:1058 `jessGenericCssAtRuleName` opens `@(?!-…` — a leading `-` is rejected outright — and jess:2738 adds `not(literal('@-'))`. `@ms-viewport` (no dash) works. Also kills `@-moz-document`. **One-line fix available:** the shared `CssAstSyntaxGenericAtRuleName` (recognition.ts:75) already permits `-?`; jess references it at 2739 but gates it behind the local regex. |
| B7 | **descriptor at-rules with a `<dashed-ident>` prelude** | jess | `@color-profile --x{src:url(a.icc)}` · `@font-palette-values --x{}` · `@position-try --x{}` | Mechanism (B-mechanism above): shared `genericAtRuleName` excludes these names, jess has no typed rule for them, so they fall to the structured generic prelude whose atom is `keywordValue` (`-?ident`) and cannot match a second leading `-`. `@color-profile x{}` works; only the dashed form fails. |
| B8 | **`@scope` with a prelude** | less, jess | `@scope (.a) to (.b){c{color:red}}` · `@scope (.a){}` | Both reach only a generic at-rule prelude whose `(…)` arm is math-only (less:2167) / keyword-only (jess:2101). Bare `@scope { }` works in both. css and scss are fine. |
| B9 | **`@container style()` / `scroll-state()`** | jess (all); less (named + style) | `@container style(--x:1){a{}}` · `@container card style(--x:1){a{}}` | jess's at-rule prelude atom set (jess:2020) has no function arm and cannot bridge `style` to `(`. less's `DirectLessContainerStyleQuery` (less:3651) accepts exactly one `--prop: value` and doesn't compose with a container name. |
| B10 | **`@import` `layer()` / `supports()` tail** | jess rejects; less unstructured | `@import "a.css" layer(x);` · `@import "a.css" supports(display:grid);` | jess:2351 prelude terms have no function-call arm. less accepts them but only as opaque `Any` text (less:1777), so the tail is unstructured. |
| B11 | **comments as value/selector trivia** | scss, jess, less (partial) | `a{color:/* c */red}` (scss,jess) · `a{color:/*c*/red}` (less too) · `a /* c */ b{}` (scss,jess) · `a{margin:1px /*c*/ 2px}` (jess) | jess's `whitespace` trivia is `[ \t\n\r\f]+` only (jess:1000-1001) — a comment is legal only where an explicit arm admits it. css treats block comments as interstitial trivia (css:500) and is the only fully-correct dialect. |
| B12 | **`var()` empty fallback** | scss, jess | `a{color:var(--x,)}` · `a{color:var(--x, )}` | css-variables-1 §3 makes the empty fallback valid. css/less accept. Nested fallbacks (`var(--x, var(--y, red))`) work everywhere. |
| B13 | **empty `;` statement** | scss (in blocks); **all four** (top level) | `a{;color:red}` · `a{color:red;;}` (scss) · `; a{color:red}` (all) | scss admits `literal(';')` in only 4 of ~8 body positions (page-margin, page, font-feature-value, keyframe). Top-level `;` rejects in all four — uniform, so low priority, but it *is* discarded rather than fatal per css-syntax-3 §5.4.1. |
| B14 | **`@page` pseudo-page selector** | jess | `@page :first{margin:1cm}` | jess:2020 prelude atoms have no pseudo arm; `page` is excluded from `genericAtRuleName` so no opaque fallback. `@page {}` and `@page named {}` work. |
| B15 | **relative selector in `:has()`** | jess | `a:has(> .b){color:red}` · `a:has(+ .b){}` | jess:1680 requires a leading compound; no relative-combinator arm. css/less/scss each have their own local `relativeSelectorCombinator`. |
| B16 | **`@media <type> and (…) and (…)`** | scss | `@media screen and (min-width:1px) and (max-width:2px){a{}}` | scss:2259 clause arm 2 allows exactly **one** trailing `and (…)` — it lacks the `many(...)` that the `only` arm at scss:2251 has. `@media only screen and (a) and (b)` therefore works and the un-`only` form doesn't. |
| B17 | **`@media not <type> and (…)`** | scss | `@media not all and (monochrome){a{}}` | scss's `not` only introduces a parenthesised condition. `@media not (monochrome)` works. |
| B18 | **attribute modifier without whitespace** | less | `[a="b"i]{color:red}` | less:1342 `selectorAttributeModifierSpace` requires ≥1 space before the modifier. Selectors-4 §6.3 makes the space optional. `[a="b" i]` works. |
| B19 | **unknown at-rule with a non-atom prelude** | less | `@foo a > b{color:red}` · `@foo (a: b){}` · `@custom-media --m (max-width:30em);` | less composes **no** `opaqueAtRuleRecognition` at all. Every unmodelled at-rule prelude must fit the closed 12-arm atom set at less:3781, with no `scanTo('{'\|';')` recovery. |
| B20 | **`@-moz-document` functional preludes** | jess (all); less (unquoted) | `@-moz-document url-prefix(){a{}}` · `@-moz-document domain(mozilla.org){}` | jess: B6. less: its generic function name can't start an argument with `.`, so the bare `domain(mozilla.org)` form rejects while `domain("mozilla.org")` works. |
| B21 | **dotted `@layer` names** | jess | `@layer a.b;` · `@layer a.b{c{}}` | jess prelude keyword has no `.` and no whitespace to continue the term. less has a dedicated `DirectLessDottedAtRuleKeyword` (less:3766). |
| B22 | **multi-target `@import`** | scss, jess | `@import url(a.css), url(b.css);` | Acknowledged in the scss source (comment scss:1616). |
| B23 | **`@property` / `@keyframes` nested inside a block** | scss, jess | `@media screen{@property --x{syntax:"*";inherits:false}}` · `a{@keyframes x{from{opacity:0}}}` | Both rules are present only in the document-level statement set (jess:3144, scss:3096) and absent from nested body sets — and both names are excluded from `genericAtRuleName`, so there is no fallback. |
| B24 | **empty `;` in a `@keyframes` body** | all four | `@keyframes x{from{opacity:0};}` | Uniform; low priority. |
| B25 | **`U+4??` wildcard range** | scss | `@font-face{unicode-range:U+4??}` | Subcase of B3. |
| B26 | **parenthesised value group** | jess | `a{width:(1px)}` | jess:1970 value atoms have no `( … )` arm; parens exist only in call args, `@supports`, query groups and `$( … )`. Low priority (a bare paren is a valid component value but not valid for any real property). |

**Divergence in the permissive direction** (not a rejection, but a drift worth
recording): `calc(1px+2px)` is **rejected by css** (correct — css-values-4 §10.9
requires whitespace around `+`/`-`) and **accepted by less and scss**.
And `calc(4px / 2)` yields `Operation('/')` in css/less but a slash-**`List`** in
scss, because scss's top-level product operator excludes `/` (scss:856).

---

## 2. DUPLICATED — `g`-free, consolidatable **today**

Every row is a pure terminal or a terminal-only composite (`choice`/`sequence` of
literals and regexes) with no `g.` reference, so it can move into a shared
`rules()` artifact without waiting on parseman 0.34.0.

| construct | copies | divergence |
|---|---|---|
| keyframe endpoint `from\|to` | 4 (css:541, less:1412, scss:860, jess:1063) | **none — byte-identical ×4.** Free win. |
| keyframe percent | 4 (css:540, less:1413, scss:863, jess:1064) | **2 spellings.** css/jess `[+-]?(?:[0-9]+(?:\.[0-9]+)?\|\.[0-9]+)%`; less/scss `[-+]?(?:\d+\.?\d*\|\.\d+)%` — less/scss additionally accept a trailing dot (`10.%`). |
| combinator set | 4 (css:542, less:1417, scss:2974, jess:1663) | **css/less include `\|`, scss/jess don't** → B4. |
| relative-selector combinator | 3 (css:546, less:1420, scss:2850) | identical; **absent in jess** → B15. |
| `@charset` at-keyword | 3 local (less:1486, scss:2469, jess:1059) | **not in the shared layer at all.** |
| `@namespace` at-keyword | 2 local (less:1485, scss:2469) | not in the shared layer. |
| `@import` at-keyword | 4 local (css:536, less:1343, scss:1749, jess:1060) | not in the shared layer — `statementAtRuleName` deliberately *excludes* import. less's also covers `@-import`/`@-export`. |
| media/container/supports/layer/scope/page/document/starting-style/font-feature-values at-keywords | shared exists; **scss re-spells all 9 locally** (scss:904-912) | spellings match the shared ones; pure duplication. |
| `unicode-range` | 1 (less:1478) | g-free regex; **trivially shareable** and would fix B3 for the other three. |
| block comment | 4 local (css:491, less:1344, scss:889, jess:1002) | byte-identical ×4; shared `CssAstSyntaxBlockComment` exists and is used by only 2. |
| `url` name | 2 local variants (css:537, less:1426/1432) | shared has `urlOpen` (`url\(`); css/less use their own boundary. |
| generic function name | 2 local (css:505, less:1442) | css excludes `calc`; less excludes `url\|calc`. Divergent exclusion sets. |
| general-enclosed template text | 4 local (css:592, less:1516, scss:871, jess:1049) | **partly per-dialect** — each excludes its own interpolation opener. The CSS-only skeleton is shareable; the opener exclusion is not. |
| balanced `()`/`[]`/`{}` + quoted-string skip sets | css:571-587 local; `opaque-at-rule.ts:13-21` has private equivalents | already proven shareable — `opaque-at-rule.ts` exports `sequence`/`choice`/`balanced` composites, so the constraint is `g`-freedom, not "regex only". |

**Caveat — some duplication is deliberate.** css:548-567 and scss:874-883 keep
local copies of `pseudoColon`, `hexColor`, `numberValue`, `simpleSelectorToken`
*on purpose*: a cross-composition `g.` reference leaves the arm's first-set
unresolved (`any`), so the compiler stops first-char-gating it and the node frame
is entered speculatively at every value/selector boundary. Those rows are a
**perf trade, not an oversight**, and consolidating them would regress parse time.
Any consolidation pass must check the gating snapshot, not just the byte-identity.

---

## 3. NEEDS VALUE HOLE — blocked on parseman 0.34.0 (PR #54)

Each of these is a CSS *shape* whose leaves are already shared but whose interior
must bind to the dialect's own value/selector production via an external `g.` ref.

| construct | hole binds to | current state |
|---|---|---|
| `calc()` math grammar (`CalcValue`/`MathProduct`/`MathSum`/`CalcParen`) | dialect value atom | css:1134-1153 dedicated; less:2149-2257 dedicated; scss **none** (generic math, diverges on `/`); jess **missing** (B1) |
| `var()` fallback family (`CalcVarFallback*`, 9 rules) | dialect declaration-value | css only (css:970-1133). less/scss/jess route `var()` through the generic call → B12 |
| `<ratio>` | dialect value | css:1519 `CssAstQueryValue`; less:3472; scss:2152; jess:2031 — 4 hand-written copies, all agreeing on `Operation('/')` in query position and all disagreeing with their own declaration-position handling |
| `<mf-range>` / comparison feature | dialect value + property | css:1549/1565; less:3482/3507; scss:2174; jess:2049 — 4 copies. The **operator terminal** is already shared (`CssAstSyntaxQueryComparisonOperator`) and now referenced by all four |
| query bare/colon feature | dialect value | 4 copies |
| `@supports` condition / in-parens | dialect value | 4 copies; only the `not`/`and`/`or` terminals are shared |
| attribute selector shape | dialect quoted + keyword | 4 copies; operator + modifier terminals shared. Would fix B4-attr and B18 |
| pseudo-argument shape | dialect selector | 4 copies; the *names* are shared (`cssAstPseudoSyntax`) |
| custom-property value assembly | dialect interpolation opener | content-run leaves already shared and g-free; the paren/square/curly recursion is per-dialect |
| keyframe block + selector list | dialect declaration body | 4 copies |
| at-rule block bodies | dialect statement production | 4 copies each, ×12 at-rule families |

---

## 4. GENUINELY PER-DIALECT

- Anything embedding interpolation: selectors with `@{}`/`#{}`/`$[]`, interpolated
  properties/URLs, quoted-string chunking. The *static* CSS bytes around them are
  already shared (`interpolatedProperty{Start,Tail}`).
- Custom-property value **scanning** — less must be `@{…}`-aware, scss/jess must
  reserve `#{`/`${`. (The shared layer already ships both a CSS and a Less variant.)
- Opaque-prelude scanning — scss/jess stop at a top-level `$`; css doesn't.
- Generic at-rule name **exclusion lists** — each dialect reserves different names.
- The math/value grammar itself: less math-mode, scss native arithmetic, jess's
  `$( … )` expression language. Only `calc()`'s *CSS* semantics are shareable.

---

## 5. OK — shared and referenced by all four (13)

`AttributeOperator`, `AttributeModifier`, `Nth`, `Important`, `QueryNot`,
`QueryOnly`, `QueryAndOr`, `QueryComparisonOperator`, `KeyframesAtKeyword`,
`DimensionUnit`, `NthChildName`, `NthTypeName`, `OfKeyword`.

The pseudo-argument consolidation (2026-07-23) and the query-operator unification
are the two places where this worked end-to-end — they are the template.

**Dead shared rules (0 consumers):** `CssAstSyntaxConditionalAtKeyword`,
`CssAstSyntaxMediaContainerAtKeyword`.

---

## Appendix: shared-rule reference matrix

`Y` = the grammar references it via `g.<name>`.

| shared rule | css | less | scss | jess |
|---|---|---|---|---|
| CssAstSyntaxProperty | Y | Y | · | Y |
| CssAstSyntaxKeyword | Y | · | Y | Y |
| CssAstSyntaxDoubleQuotedText | Y | · | · | Y |
| CssAstSyntaxSingleQuotedText | Y | · | · | Y |
| CssAstSyntaxUrlOpen | Y | · | Y | Y |
| CssAstSyntaxUrlInner | Y | · | · | · |
| CssAstSyntaxStaticUrlInner | · | · | · | Y |
| CssAstSyntaxSimple | · | · | Y | Y |
| CssAstSyntaxPseudoColon | · | · | · | Y |
| CssAstSyntaxAttributeOperator | Y | Y | Y | Y |
| CssAstSyntaxAttributeModifier | Y | Y | Y | Y |
| CssAstSyntaxNth | Y | Y | Y | Y |
| CssAstSyntaxMalformedPseudoNumericArgument | Y | · | Y | · |
| CssAstSyntaxBlockComment | · | Y | Y | · |
| CssAstSyntaxImportant | Y | Y | Y | Y |
| CssAstSyntaxHexColor | · | Y | · | Y |
| CssAstSyntaxConditionalAtKeyword | · | · | · | · |
| CssAstSyntaxMediaContainerAtKeyword | · | · | · | · |
| CssAstSyntaxMediaAtKeyword | Y | Y | · | Y |
| CssAstSyntaxContainerAtKeyword | Y | Y | · | Y |
| CssAstSyntaxSupportsAtKeyword | Y | Y | · | · |
| CssAstSyntaxStartingStyleAtKeyword | Y | · | · | · |
| CssAstSyntaxPageAtKeyword | Y | · | · | · |
| CssAstSyntaxMarginAtKeyword | Y | · | Y | · |
| CssAstSyntaxQueryNot | Y | Y | Y | Y |
| CssAstSyntaxQueryOnly | Y | Y | Y | Y |
| CssAstSyntaxQueryAndOr | Y | Y | Y | Y |
| CssAstSyntaxQueryComparisonOperator | Y | Y | Y | Y |
| CssAstSyntaxQueryFunctionName | Y | Y | Y | · |
| CssAstSyntaxScopeAtKeyword | Y | · | · | · |
| CssAstSyntaxDescriptorAtKeyword | Y | · | · | · |
| CssAstSyntaxDocumentAtKeyword | Y | · | · | · |
| CssAstSyntaxLayerAtKeyword | Y | · | · | · |
| CssAstSyntaxKeyframesAtKeyword | Y | Y | Y | Y |
| CssAstSyntaxStatementAtRuleName | Y | · | · | · |
| CssAstSyntaxGenericAtRuleName | Y | · | · | Y |
| CssAstSyntaxFontFeatureValuesAtKeyword | Y | · | · | · |
| CssAstSyntaxFontFeatureValueAtKeyword | Y | · | Y | · |
| CssAstSyntaxNumber | · | Y | · | Y |
| CssAstSyntaxDimensionUnit | Y | Y | Y | Y |
| CssAstSyntaxInterpolatedPropertyStart | · | Y | · | Y |
| CssAstSyntaxInterpolatedPropertyTail | · | Y | · | Y |
| CssAstSyntaxCustomProperty | Y | · | Y | Y |
| CssAstSyntaxCustomOuterContent | · | · | Y | Y |
| CssAstSyntaxCustomInnerContent | · | · | Y | Y |
| CssAstSyntaxCustomSingleQuoted | · | · | Y | Y |
| CssAstSyntaxCustomDoubleQuoted | · | · | Y | Y |
| CssAstSyntaxNthChildName | Y | Y | Y | Y |
| CssAstSyntaxNthTypeName | Y | Y | Y | Y |
| CssAstSyntaxNthName | Y | · | Y | Y |
| CssAstSyntaxSelectorArgPseudoName | Y | · | Y | · |
| CssAstSyntaxOfKeyword | Y | Y | Y | Y |
| CssAstSyntaxPseudoCloseAhead | Y | · | · | Y |
| CssAstOpaqueCapturePrelude | Y | · | · | · |
| CssAstOpaqueCaptureBody | Y | · | · | · |

less references the `LessAstSyntax*` variants instead of the CSS custom-property
and hex/number leaves, and re-implements `SelectorArgPseudoName` (less:1497) and
`NthName` (less:1505) locally despite `cssAstPseudoSyntax` being composed.

---

## Suggested order of attack

1. **B5** — css throwing a raw `Error` out of the public API is the only crash.
2. **B1 / B2** — jess has no `calc()` and no `&`. These are not edge cases.
3. **B3** — scss silently corrupting `unicode-range` into arithmetic is worse than
   rejecting it. less already has the g-free regex to share.
4. **B6** — one-line-shaped: jess already composes the shared `GenericAtRuleName`
   that permits `-?`; the local regex at jess:1058 is what blocks it. *(Not landed
   here — other sessions are editing this grammar.)*
5. The **DUPLICATED** table, minus the deliberate perf copies — free, no parseman
   dependency.
6. The **NEEDS VALUE HOLE** table, once 0.34.0 lands.

Nothing in this document was fixed; several sessions are concurrently editing all
four grammars.
