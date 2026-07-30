# MS ↔ Jess Language-Service Feature-Parity Gap Analysis

Goal: reach and exceed parity with Microsoft's built-in VS Code CSS/SCSS/Less
support (the `vscode-css-languageservice` library) across css / scss / less.
Microsoft's service is the coverage baseline; TypeScript-style hovers and
completions are the presentation target for Jess: code/signature first, concise
symbol category, docs next, metadata last.

- **Side A (MS):** `microsoft/vscode-css-languageservice` — `src/cssLanguageService.ts`,
  `src/services/{cssCompletion,scssCompletion,lessCompletion,cssHover,cssNavigation,scssNavigation,cssValidation,lintRules,cssCodeActions,cssFolding,cssSelectionRange,cssDocumentSymbol}.ts`,
  and `src/languageFacts/*` (MDN-sourced data + `@vscode/web-custom-data`).
- **Side B (Jess):** `packages/language-service/src/engine.ts` (the
  `JessLanguageServiceEngine` surface) plus `cst-analysis.ts`, `cst-symbols.ts`,
  `cst-syntactic.ts`, `color-utils.ts`. Data: `@vscode/web-custom-data`
  (`data/browsers.css-data.json`) + `known-css-properties`.

Priority key: **P0** = user's stated top priority (completions) or a glaring
day-one gap; **P1** = important for "feels like real CSS support"; **P2** = nice
to have / niche.

---

## 1. Parity matrix

Depth is judged honestly, not yes/no. "✓" without qualification means genuinely
comparable; a qualifier ("names only", "no context") flags shallow support.

> **Status note:** the matrix tracks current implementation depth. Section 2 is
> the implementation ledger for completed slices and remaining polish.

### Completions (the P0 area)

| Feature | MS provides | Jess provides | Gap | Prio |
|---|---|---|---|---|
| **Property names** | Full, relevance-scored, in declaration context | ✓ names from `known-css-properties`, with TypeScript-style detail/docs when web-custom-data has metadata | Ranking + context precision | P1 |
| **Property VALUES (per-property)** | Extensive: enum values, units, functions, color fns, timing fns, shapes, box keywords, image fns — driven by each property's `restrictions` | ✓ `values[]` + restrictions + CSS-wide keywords/functions, all with TypeScript-style detail/docs when metadata or synthetic facts are available; diagnostics validate simple static values against values/restrictions | Compound value grammar validation, richer function/value facts, ranking + context precision | P1 |
| **`var()` / CSS-wide fns** | ✓ (`var()`, `calc()`, `env()` …) | ✓ `var()` / `env()` / `calc()` plus CSS-wide keywords; rich completion docs | Add broader CSS function families as data warrants | P1 |
| **At-rule keywords** | ✓ context-aware (top-level vs nested) | ✓ web-custom-data at-rules with context filtering and TypeScript-style detail/docs | Ranking + deeper context precision | P1 |
| **At-rule bodies** (`@media` features/values, `@supports` conditions, `@font-face` descriptors, `@keyframes` `from/to`, `@page`) | ✓ media descriptors + discrete values, `@supports` conditions | Partial: `@media` prelude names/types/operators, `@supports` declaration/value/function helpers, descriptor names/values for `@font-face`/`@property`/`@counter-style`/`@page`, and `@keyframes` `from`/`to`, all with rich detail/docs | Deeper descriptor snippets, `@page` margin boxes, and richer condition grammar | P1 |
| **Pseudo-classes** (`:hover`, `:nth-child(...)`) | ✓ incl. argument snippets | ✓ with TypeScript-style detail/docs | At parity; argument-specific docs/signatures remain polish | **P0** |
| **Pseudo-elements** (`::before`, single+double colon) | ✓ | ✓ with TypeScript-style detail/docs | At parity | **P0** |
| **`!important`** | ✓ | ✓ with rich detail/docs | At parity | P1 |
| **Selectors / combinators / element tags** | ✓ HTML5+SVG tags at top level, class selectors mined from document | Partial: known HTML/SVG/MathML type-selector completions plus document-local class selectors at root and nested dialect selector sites | Combinator-specific snippets remain polish | P2 |
| **Named colors + color fns as values** | ✓ named colors + `rgb()/hsl()/…` in color contexts, with color swatch | ✓ named colors with swatches plus modern color functions with rich detail/docs | Function parameter snippets/docs remain future polish | P1 |
| **`url()` path completion** | ✓ (via completion participants / `doComplete2`) | ✓ filesystem path completion | At parity | P2 |
| **@import path completion** | ✓ (participant-based) | ✓ filesystem path completion for `@import` / `@use` | At parity | P2 |
| **SCSS/Less variable names** | ✓ mined from document + imports | ✓ declared names off the tolerant CST (`cstVariableNames`), sigil-wrapped, prefix-filtered, rich detail/docs — survives half-typed input | Cross-import variable completion remains future polish | P1 |
| **SCSS/Less mixin completion** (`@include`, `.mixin()`) | ✓ mixin references + params | ✓ CST-mined mixins with rich detail/docs | Parameter-aware snippets remain future polish | **P0** |
| **SCSS/Less function completion** | ✓ user functions + all built-in Sass/Less fns | ✗ | Missing | P1 |
| **SCSS placeholders `%name`** | ✓ | ✓ placeholder completions with rich detail/docs | At parity for document-local placeholders | P2 |
| **Built-in Sass modules** (`sass:math`, `sass:color`, `sass:list`, `sass:map`, `sass:string`, `sass:selector`, `sass:meta`) | ✓ all 7 modules + members, with doc links | ✓ all 7 modules + members with rich detail/docs | Per-member Sass docs and signatures remain future polish | P1 |
| **`@use` / `@forward` namespacing** (`namespace.$var`, `namespace.fn()`) | ✓ | ✗ | Missing | P1 |
| **Interpolation `#{}` / `@{}`** | ✓ completes inside interpolation | ✓ variable completion inside Less/Jess/SCSS interpolation with rich detail/docs | At parity for variables | P2 |
| **Snippet completions** (`@media {…}`, at-rule bodies) | ✓ | Partial: function completions insert snippets, including CSS value and `@supports` helpers; at-rule body snippets are not implemented | Add at-rule/body snippets | P1 |

### Hover

| Feature | MS provides | Jess provides | Gap | Prio |
|---|---|---|---|---|
| Property hover | ✓ MDN description + **browser-compat table + MDN "syntax" + spec/MDN links** | ✓ TypeScript-style code block + category, description, formal syntax, Baseline, browser support summary, and MDN link from web-custom-data | Comparable coverage; keep improving richness/ranking beyond MS formatting | P2 |
| Property-value hover | ✓ | ✓ TypeScript-style value hover with description, Baseline, and browser support summary when web-custom-data includes it | Comparable coverage; richer compound values remain future work | P2 |
| At-rule hover | ✓ | ✓ TypeScript-style at-rule hover from web-custom-data | Comparable | P2 |
| Pseudo-class/element hover | ✓ | ✓ TypeScript-style selector hover from web-custom-data | Comparable | P1 |
| Selector-specificity hover | ✓ (shows computed specificity for a selector) | ✓ static CSS selector branches | Dialect nested/interpolated selector specificity remains future work | P2 |
| Variable / mixin hover (show value/definition) | partial (SCSS) | ✓ CST-grounded authored definition hover for variables and mixins | Shows definitions, not evaluated values/signatures; evaluator-backed richness remains future work | P1 |

### Navigation

| Feature | MS provides | Jess provides | Gap | Prio |
|---|---|---|---|---|
| Go to definition | ✓ (scss cross-file via `SCSSNavigation`) | ✓ **CST-grounded, cross-import** (`findDefinitionAcrossDocs`), variables + mixins, real import resolution | At parity / arguably ahead | — |
| Find references | ✓ | ✓ CST-grounded across open+imported docs | At parity | — |
| Rename + prepareRename | ✓ | ✓ CST-grounded, narrows to identifier, preserves sigil/combinator, cross-file | At parity | — |
| **Document highlights** | ✓ `findDocumentHighlights` | ✗ (not on the engine interface) | Missing | P1 |
| Document links (`@import`/`url()`) | ✓ `findDocumentLinks2` (async fs resolution) | ✓ `url()` + `@import`/`@use` resolved to file URIs + bare http links | At parity | — |

### Diagnostics / Linting

| Feature | MS provides | Jess provides | Gap | Prio |
|---|---|---|---|---|
| Syntax / parse errors | ✓ | ✓ lexer + parser errors from the Jess parse result | At parity | — |
| **Lint rules** | ✓ ~20 configurable rules (see below) | ✓ shared diagnostics surfaced through language-service severity config | Keep expanding parity and semantic facts | P1 |
| `unknownProperties` | ✓ (Warning) | ✓ shared diagnostic default Warning | At parity | — |
| `unknownAtRules` | ✓ (Warning) | ✓ shared diagnostic default Warning | At parity | — |
| `emptyRules` | ✓ (Warning) | ✓ shared diagnostic default Warning | At parity | — |
| `duplicateProperties` | ✓ | ✓ shared diagnostic default Warning | At parity plus Stylelint-compatible lint naming | — |
| `hexColorLength` / `argumentsInColorFunction` | ✓ (Error) | ✓ shared diagnostics default to Error | At parity for hex length and rgb()/rgba()/hsl()/hsla() definite argument errors | — |
| `vendorPrefix` / `compatibleVendorPrefixes` / `unknownVendorSpecificProperties` | ✓ | ✓ shared diagnostics; `compatibleVendorPrefixes` and `unknownVendorSpecificProperties` opt-in | At parity for CSS declarations/keyframes; dialect semantic facts remain future work | — |
| `propertyIgnoredDueToDisplay`, `fontFaceProperties` | ✓ (Warning) | ✓ shared diagnostics default to Warning | At parity for CSS @font-face required descriptors and display/property interactions | — |
| `boxModel` | ✓ (Ignore by default) | ✓ shared diagnostic, opt-in | At parity for definite CSS width/height plus padding/border size risks | — |
| `universalSelector`, `zeroUnits`, `important`, `float`, `idSelector`, `importStatement` | ✓ (mostly default-Ignore, opt-in) | ✓ shared diagnostics; opinionated rules remain opt-in | At parity for CSS source facts | — |
| `ieHack` | ✓ (Ignore by default) | ✓ shared diagnostic, opt-in for underscore-prefixed CSS declarations whose stripped property is known | `*property` remains parser-blocked until diagnostic recovery exposes it structurally; no source scan | P3 |
| Configurable severities | ✓ per-rule | ✓ for shared diagnostic codes and lint rule-name aliases | Per-language settings shape remains future polish | P2 |
| **Semantic: undefined variable / mixin** | ✗ (MS does not resolve semantics this deeply) | Future evaluator-backed work | Do not report from CST-only facts; needs project/module/evaluation context | Future |

MS lint rules with default levels (`src/services/lintRules.ts`):
`compatibleVendorPrefixes`=Ignore, `vendorPrefix`=Warning, `duplicateProperties`=Ignore,
`emptyRules`=Warning, `importStatement`=Ignore, `boxModel`=Ignore, `universalSelector`=Ignore,
`zeroUnits`=Ignore, `fontFaceProperties`=Warning, `hexColorLength`=Error,
`argumentsInColorFunction`=Error, `unknownProperties`=Warning, `unknownAtRules`=Warning,
`ieHack`=Ignore, `unknownVendorSpecificProperties`=Ignore, `propertyIgnoredDueToDisplay`=Warning,
`important`=Ignore, `float`=Ignore, `idSelector`=Ignore.

### Color

| Feature | MS provides | Jess provides | Gap | Prio |
|---|---|---|---|---|
| Document colors (swatches) | ✓ | ✓ `getDocumentColors` — hex, `rgb/rgba/hsl/hsla/hwb/lab/lch/oklab/oklch`, named colors (rebeccapurple etc.), off the AST | At parity / broader modern-fn coverage | — |
| Color presentations | ✓ | ✓ `getColorPresentations` — rgb, rgba, hsl, hsla, hwb, lab, oklab, hex | At parity / broader | — |

### Formatting

| Feature | MS provides | Jess provides | Gap | Prio |
|---|---|---|---|---|
| Document format | ✓ `format()` with rich options (JS-Beautify based) | ✓ `formatDocument` via core printer (`toTrimmedString`), conservative, whole-document only | Shallower; no range format, few options | P2 |
| Range / on-type format | partial | ✗ | Missing | P2 |

### Structure

| Feature | MS provides | Jess provides | Gap | Prio |
|---|---|---|---|---|
| Document symbols (outline) | ✓ | ✓ **CST-grounded** (`cstDocumentSymbols`): rulesets→Class, at-rules→Namespace, vars→Variable, mixins/funcs→Function | At parity, tolerant | — |
| Folding ranges | ✓ (incl. region markers/comments) | ✓ CST-grounded (blocks) — no `#region` markers | Minor: region-comment folding | P2 |
| Selection ranges | ✓ | ✓ CST-grounded | At parity | — |
| Semantic tokens | ✗ (not in this library; VS Code uses TextMate) | ✓ `getSemanticTokens` off AST+source | **Jess AHEAD** (extra feature) | — |
| Signature help | ✗ | ✗ | Neither | — |

### Data model (a huge part of MS's value)

| Feature | MS provides | Jess provides | Gap | Prio |
|---|---|---|---|---|
| Property data | MDN-sourced `languageFacts` + `@vscode/web-custom-data`: descriptions, **`restrictions`**, `values`, `status`, **`browsers`/compat** | `known-css-properties` (names) + web-custom-data (descriptions, values, restrictions, status, browser support summaries) | Rich compat table UI remains missing | P2 |
| At-rule data | ✓ rich | ✓ web-custom-data | Comparable | P2 |
| Pseudo-class / pseudo-element data | ✓ (names + descriptions + compat) | ✓ web-custom-data names, descriptions, Baseline, browser support summaries, and MDN links | Rich compat table UI remains missing | P2 |
| Custom-data provider API (`setDataProviders`) | ✓ extensible | ✓ custom properties, at-rules, pseudos, completions, hover, and shared CSS diagnostics | Per-language settings shape remains future polish | P2 |
| Built-in Sass/Less function catalog | ✓ (baked into scss/less completion) | ✗ | Missing dataset | P1 |

---

## 2. To reach parity — prioritized (completions FIRST)

Each item is one line of implementation sketch. Ordered by the user's priority.

**P0 — completions & the data behind them**

1. ✅ **DONE (dev f00b51fb2).** **Load `restrictions` + pseudo data from `@vscode/web-custom-data`.** Property
   value completions and simple static value diagnostics now read the same
   restriction/value data; deeper compound value grammar validation remains
   future work. Pseudo-classes/elements also come from web-custom-data
   `pseudoClasses`/`pseudoElements`.
2. ✅ **DONE.** **Restriction-driven value completions.** Given the property before the `:`,
   read its `restrictions` (e.g. `color`, `length`, `enum`, `timing-function`)
   and emit the matching value kinds: enum names *plus* units (`px/em/rem/%/…`),
   CSS-wide keywords (`inherit/initial/unset/revert`), and `var()`/`calc()`.
   Mirror MS's `cssCompletion.getValueEnumProposals`/`getCSSWideKeywordProposals`.
3. ✅ **DONE.** **Pseudo-class / pseudo-element completions** on `:` / `::` in selector
   context, with argument snippets for `:nth-*`. Pure data + a selector-context
   check (reuse the brace-depth scanner already in `getCompletions`).
4. ✅ **DONE (SCSS `@include` + Less `.foo()` calls).** **SCSS/Less mixin completions.** The declared-mixin inventory already exists
   (`cstDeclaredSymbols().mixins`, used for did-you-mean). Surface it as
   completions in `@include ` (scss) / `.` call context (less) — symmetric to the
   existing `cstVariableNames` path.
5. ✅ **DONE.** **`!important`** after a value — trivial keyword completion; near-zero cost.

**P1 — feels-like-real-support**

6. ✅ **DONE (namespace member completions: math./color./string./list./map./meta./selector.).** **Built-in Sass module + function catalog.** Ship a static dataset of the 7
   `sass:*` modules and their members (+ Less built-ins) and complete them; also
   complete namespaced `ns.$x` / `ns.fn()` after `@use`.
7. ✅ **DONE (@media features/types/operators + @keyframes from/to).** **At-rule body completions** — `@media` feature names/values, `@supports`
   conditions, `@keyframes from/to`, `@font-face` descriptors. Data-driven off
   web-custom-data at-rule `values`.
8. ✅ **DONE (function completions insert as `name($1)` snippets).** **Snippet completions** — emit `InsertTextFormat.Snippet` for at-rules and
   function calls (`@media $1 { $0 }`), instead of plain `textEdit`.
9. ✅ **DONE (configurable shared diagnostics, including VSCode-data-backed
   property/value warnings and recommended IDE defaults).** **Diagnostics / lint rules** — port the high-value
   stylesheet-service subset first: `emptyRules`, `unknownProperties`,
   `declaration-property-value-no-unknown`, `unknownAtRules`,
   `duplicateProperties`, `hexColorLength`, `zeroUnits`, `fontFaceProperties`,
   `propertyIgnoredDueToDisplay`, `boxModel`, and follow-on CSS validity diagnostics.
   Detection lives in diagnostics-core; lint and the language service only
   configure and surface the shared records.
10. ✅ **DONE.** **Hover enrichment** — pseudo-class/element hover added; property,
    value, pseudo, and at-rule hover use a TypeScript-style shape (code block /
    category first, docs second, metadata last) and include formal `syntax`,
    Baseline status, browser support summaries, and the MDN reference link when
    web-custom-data provides those fields.
10a. ✅ **DONE.** **Selector specificity hover** — static CSS selector branches
    show specificity from `postcss-selector-parser` + CSSTools specificity
    calculation. Dialect nested/interpolated selector specificity remains future
    work.
10b. ✅ **DONE.** **Variable / mixin definition hover** — CST-grounded hover uses the
    existing definition resolver and shows the authored definition/signature for
    Less/SCSS/Jess variables and mixins without claiming evaluated values or
    callable overload resolution.
11. ✅ **DONE (highlights all occurrences of the symbol under the cursor).** **`findDocumentHighlights`** — add to the engine interface; reuse
    `collectReferenceSet` but scope to the current document only.
12. ✅ **DONE (named colors w/ swatch + color functions; units on numeric prefix).** **Named-color + color-function value completions** in color contexts, with
    a color swatch (`CompletionItemKind.Color`) — the color math already exists
    in `color-utils.ts`.
13. ✅ **DONE.** **Context-aware at-rule filtering** — `@import`/`@charset`/`@namespace`
    hidden whenever nested; `@font-face`/`@keyframes`/… hidden inside a style rule
    but kept in conditional-group at-rules; `@media`/`@supports`/… stay offered
    inside style rules.
13a. ✅ **DONE.** **Selector completions** — known HTML/SVG/MathML type selectors
     use the same metadata as `selector-type-no-unknown`; static class selectors
     are mined from CST simple selector nodes and completed at root selector
     sites plus nested Less/SCSS/Jess selector contexts. Combinator-specific
     snippets remain future polish.

**P2 — polish / niche**

14. ✅ **DONE.** `url()` and `@import`/`@use` path completion (filesystem-backed;
    style-file-filtered for imports, all files for `url()`).
15. ✅ **DONE.** SCSS placeholder `%name` completions; interpolation-context
    completions (Less `@{…}`, Jess `$[…]`; SCSS `#{$x}` already flowed through).
16. ✅ **DONE.** `var()` custom-property completions mined across the document + imports.
17. ✅ **DONE.** Region-comment folding (`/* #region */`), range formatting (formats
    the top-level rules the selection intersects), and `setDataProviders`-style
    custom-data extensibility (custom properties, at-rules, and pseudos →
    completion, hover, and shared CSS diagnostics).
    *Remaining niche:* richer format options (indent size, etc.).
18. ✅ **DONE.** TypeScript-style completion details/docs for metadata-backed CSS
    property, property-value, pseudo selector, and at-rule completions, plus
    synthetic CSS/value/dialect completions that Microsoft also surfaces as
    language-service messages.
19. ✅ **DONE.** Data-backed at-rule body completion slice: `@supports`
    declaration conditions, CSS descriptor names/values for `@font-face`,
    `@property`, `@counter-style`, and `@page`, plus `env()` as a CSS-wide value
    function.

---

## 3. Where Jess is already AHEAD

- **Incremental, subtree-level reparse.** Jess keeps a Parseman `ParseDoc` and
  applies single-range `.edit(from,to,replacement)` per keystroke (dual-tree:
  tolerant CST for syntactic features + Jess AST for semantics), with lazy
  coalesced re-derivation (`analysisDirty`). MS re-parses the whole stylesheet
  on each change. **Caveat:** MS's parser is *also* fully error-tolerant, so the
  *tolerance* itself is at parity — the genuine edge is the **incremental cost
  model** (one subtree, not the file) and that syntactic features (symbols,
  folding, def/refs/rename, variable completion) run straight off the CST
  without an AST reparse. Frame this as *performance/latency*, not as "we
  tolerate errors and they don't."
- **Future semantic analysis.** Call resolution, scope leakage, undefined
  symbol certainty, and overload/named-argument diagnostics need evaluator-backed
  facts plus project/module resolution before Jess should claim them in lint or
  the language service. MS does not do this depth of semantic validation.
- **Semantic tokens** (`getSemanticTokens`) — not offered by
  `vscode-css-languageservice` at all (VS Code colors CSS via TextMate).
- **Broader modern color coverage** in document colors / presentations
  (`hwb/lab/lch/oklab/oklch`).
- **Compact browser-support hover summaries** from the same web-custom-data used
  by VS Code; MS still presents richer browser tables.

Net: Jess leads on *engine semantics, incremental performance, and
navigation/rename quality*; MS leads massively on *breadth of completion + the
MDN data behind it + lint*.

---

## 4. Features that don't map cleanly

- **MS lint rules that are style opinions** (`float`, `idSelector`,
  `universalSelector`, `ieHack`, `important`) default to *Ignore*
  even in MS. Jess keeps the implemented opinion rules opt-in; `ieHack` waits
  for real CST support for star-prefixed declarations.
- **Jess-only language surface** — `.jess` control-flow (`$if`/`$for`/`${}`
  scope blocks), `@compose`/`@from`, cross-dialect function imports. MS has no
  concept of these; parity is one-directional (Jess must add its *own*
  completions/diagnostics for them, with no MS baseline to match).
- **`setCompletionParticipants` / `doComplete2`** — MS's async completion-
  participant hook exists mainly to let the VS Code host inject path completions.
  Jess can implement `url()`/import path completion directly instead of adopting
  the participant indirection.
- **Signature help** — neither side ships it; not a parity item.
- **`@vscode/web-custom-data` is shared**, so the raw property/at-rule dataset is
  common ground. The MS *advantage* is the additional MDN-derived `languageFacts`
  layer (richer browser compat presentation and specificity) that Jess does not
  fully mirror yet — closing that presentation/data gap unlocks more polish
  without changing parser semantics.
</content>
</invoke>
