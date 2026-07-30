# MS ↔ Jess Language-Service Feature-Parity Gap Analysis

Goal: reach and exceed parity with Microsoft's built-in VS Code CSS/SCSS/Less
support (the `vscode-css-languageservice` library) across css / scss / less.

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

> **Status note:** the matrix below is the ORIGINAL gap snapshot. Section 2 is the
> live tracker — all P0/P1 items and the P2 completion tail (#14–17) are now ✅ done
> and merged, for css/less/scss **and** `.jess`. Rows still reading "Missing" below
> are superseded by the ✅ entries in section 2.

### Completions (the P0 area)

| Feature | MS provides | Jess provides | Gap | Prio |
|---|---|---|---|---|
| **Property names** | Full, relevance-scored, in declaration context | ✓ names from `known-css-properties`, gated on `depth>0` brace count (naive) | Ranking + context precision | P1 |
| **Property VALUES (per-property)** | Extensive: enum values, units, functions, color fns, timing fns, shapes, box keywords, image fns — driven by each property's `restrictions` | Enum value *names* only, from web-custom-data `values[]`, when a property is found before the `:` | No units, no functions, no restriction-driven value kinds, no CSS-wide keywords (`inherit`/`initial`/`unset`/`revert`) | **P0** |
| **`var()` / CSS-wide fns** | ✓ (`var()`, `calc()`, `env()` …) | ✗ | Missing | P1 |
| **At-rule keywords** | ✓ context-aware (top-level vs nested) | ✓ every `@name` from web-custom-data, triggered only on leading `@` or empty suggest — no nesting context | No context; unfiltered list | P1 |
| **At-rule bodies** (`@media` features/values, `@supports` conditions, `@font-face` descriptors, `@keyframes` `from/to`, `@page`) | ✓ media descriptors + discrete values, `@supports` conditions | ✗ | Missing entirely | P1 |
| **Pseudo-classes** (`:hover`, `:nth-child(...)`) | ✓ incl. argument snippets | ✗ | Missing | **P0** |
| **Pseudo-elements** (`::before`, single+double colon) | ✓ | ✗ | Missing | **P0** |
| **`!important`** | ✓ | ✗ | Missing (trivial) | P1 |
| **Selectors / combinators / element tags** | ✓ HTML5+SVG tags at top level, class selectors mined from document | ✗ | Missing | P2 |
| **Named colors + color fns as values** | ✓ named colors + `rgb()/hsl()/…` in color contexts, with color swatch | ✗ (color *detection* exists, but not color *completion*) | Missing | P1 |
| **`url()` path completion** | ✓ (via completion participants / `doComplete2`) | ✗ | Missing | P2 |
| **@import path completion** | ✓ (participant-based) | ✗ (links resolve, but no completion) | Missing | P2 |
| **SCSS/Less variable names** | ✓ mined from document + imports | ✓ **declared names off the tolerant CST** (`cstVariableNames`), sigil-wrapped, prefix-filtered — survives half-typed input | Roughly at parity for local vars; no cross-import var completion | P1 |
| **SCSS/Less mixin completion** (`@include`, `.mixin()`) | ✓ mixin references + params | ✗ (mixins are found for def/refs/rename, but not offered as completions) | Missing | **P0** |
| **SCSS/Less function completion** | ✓ user functions + all built-in Sass/Less fns | ✗ | Missing | P1 |
| **SCSS placeholders `%name`** | ✓ | ✗ | Missing | P2 |
| **Built-in Sass modules** (`sass:math`, `sass:color`, `sass:list`, `sass:map`, `sass:string`, `sass:selector`, `sass:meta`) | ✓ all 7 modules + members, with doc links | ✗ | Missing | P1 |
| **`@use` / `@forward` namespacing** (`namespace.$var`, `namespace.fn()`) | ✓ | ✗ | Missing | P1 |
| **Interpolation `#{}` / `@{}`** | ✓ completes inside interpolation | ✗ | Missing | P2 |
| **Snippet completions** (`@media {…}`, at-rule bodies) | ✓ | ✗ (all completions are plain `textEdit`, no `insertText`/snippet) | Missing | P1 |

### Hover

| Feature | MS provides | Jess provides | Gap | Prio |
|---|---|---|---|---|
| Property hover | ✓ MDN description + **browser-compat table + MDN "syntax" + spec/MDN links** | ✓ description string from web-custom-data only | No browser-compat, no links, no syntax | P1 |
| Property-value hover | ✓ | ✓ value description from web-custom-data | Comparable (shallower text) | P2 |
| At-rule hover | ✓ | ✓ description from web-custom-data | Comparable | P2 |
| Pseudo-class/element hover | ✓ | ✗ | Missing | P1 |
| Selector-specificity hover | ✓ (shows computed specificity for a selector) | ✗ | Missing | P2 |
| Variable / mixin hover (show value/definition) | partial (SCSS) | ✗ | Missing | P1 |

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
| **Lint rules** | ✓ ~20 configurable rules (see below) | ✗ **none** | **Whole category missing** | **P0/P1** |
| `unknownProperties` | ✓ (Warning) | ✗ | Missing | P1 |
| `unknownAtRules` | ✓ (Warning) | ✗ | Missing | P1 |
| `emptyRules` | ✓ (Warning) | ✗ | Missing | P1 |
| `duplicateProperties` | ✓ | ✗ | Missing | P1 |
| `hexColorLength` / `argumentsInColorFunction` | ✓ (Error) | ✗ | Missing | P1 |
| `vendorPrefix` / `compatibleVendorPrefixes` / `unknownVendorSpecificProperties` | ✓ | ✗ | Missing | P2 |
| `boxModel`, `universalSelector`, `zeroUnits`, `important`, `float`, `idSelector`, `ieHack`, `importStatement`, `propertyIgnoredDueToDisplay`, `fontFaceProperties` | ✓ (mostly default-Ignore, opt-in) | ✗ | Missing | P2 |
| Configurable severities | ✓ per-rule | ✓ but only for the 2 semantic Jess codes (`var/undefined`, `mixin/undefined`) | Framework exists; needs rules to configure | P1 |
| **Semantic: undefined variable / mixin** | ✗ (MS does not resolve semantics this deeply) | ✓ `var/undefined`, `mixin/undefined` + escalate-to-error when modern features present | **Jess AHEAD** | — |

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
| Property data | MDN-sourced `languageFacts` + `@vscode/web-custom-data`: descriptions, **`restrictions`**, `values`, `status`, **`browsers`/compat** | `known-css-properties` (names) + web-custom-data (descriptions, values) | **No `restrictions` (kills value-completion depth), no browser-compat, no status** | **P0** |
| At-rule data | ✓ rich | ✓ web-custom-data | Comparable | P2 |
| Pseudo-class / pseudo-element data | ✓ (names + descriptions + compat) | ✗ (not loaded at all) | Missing dataset | **P0** |
| Custom-data provider API (`setDataProviders`) | ✓ extensible | ✗ | Missing extensibility | P2 |
| Built-in Sass/Less function catalog | ✓ (baked into scss/less completion) | ✗ | Missing dataset | P1 |

---

## 2. To reach parity — prioritized (completions FIRST)

Each item is one line of implementation sketch. Ordered by the user's priority.

**P0 — completions & the data behind them**

1. ✅ **DONE (dev f00b51fb2).** **Load `restrictions` + pseudo data from `@vscode/web-custom-data`.** The
   property value-completion depth is entirely gated on data: currently only
   `values[]` names are read. Also load pseudo-classes/elements (web-custom-data
   ships `pseudoClasses`/`pseudoElements`) — Jess ignores them today.
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
   property/value warnings).** **Diagnostics / lint rules** — port the high-value
   stylesheet-service subset first: `emptyRules`, `unknownProperties`,
   `declaration-property-value-no-unknown`, `unknownAtRules`,
   `duplicateProperties`, `hexColorLength`, `zeroUnits`, and follow-on CSS
   validity diagnostics. Detection lives in diagnostics-core; lint and the
   language service only configure and surface the shared records.
10. ✅ **DONE.** **Hover enrichment** — pseudo-class/element hover added; property +
    at-rule hover append formal `syntax`, Baseline status, and the MDN reference
    link (from web-custom-data `references`/`baseline`/`syntax`).
11. ✅ **DONE (highlights all occurrences of the symbol under the cursor).** **`findDocumentHighlights`** — add to the engine interface; reuse
    `collectReferenceSet` but scope to the current document only.
12. ✅ **DONE (named colors w/ swatch + color functions; units on numeric prefix).** **Named-color + color-function value completions** in color contexts, with
    a color swatch (`CompletionItemKind.Color`) — the color math already exists
    in `color-utils.ts`.
13. ✅ **DONE.** **Context-aware at-rule filtering** — `@import`/`@charset`/`@namespace`
    hidden whenever nested; `@font-face`/`@keyframes`/… hidden inside a style rule
    but kept in conditional-group at-rules; `@media`/`@supports`/… stay offered
    inside style rules.

**P2 — polish / niche**

14. ✅ **DONE.** `url()` and `@import`/`@use` path completion (filesystem-backed;
    style-file-filtered for imports, all files for `url()`).
15. ✅ **DONE.** SCSS placeholder `%name` completions; interpolation-context
    completions (Less `@{…}`, Jess `$[…]`; SCSS `#{$x}` already flowed through).
16. ✅ **DONE.** `var()` custom-property completions mined across the document + imports.
17. ✅ **DONE.** Region-comment folding (`/* #region */`), range formatting (formats
    the top-level rules the selection intersects), and `setDataProviders`-style
    custom-data extensibility (custom properties + at-rules → completion & hover).
    *Remaining niche:* richer format options (indent size, etc.).

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
- **True semantic analysis.** `var/undefined` and `mixin/undefined` diagnostics
  come from actually resolving symbols against a real evaluating engine
  (jess/less/scss), with cross-file import resolution (`@jesscss/style-resolver`)
  and severity escalation when modern features (`@use`/`@from`/`@compose`) are
  present. MS does not do this depth of semantic validation.
- **Semantic tokens** (`getSemanticTokens`) — not offered by
  `vscode-css-languageservice` at all (VS Code colors CSS via TextMate).
- **Broader modern color coverage** in document colors / presentations
  (`hwb/lab/lch/oklab/oklch`).

Net: Jess leads on *engine semantics, incremental performance, and
navigation/rename quality*; MS leads massively on *breadth of completion + the
MDN data behind it + lint*.

---

## 4. Features that don't map cleanly

- **MS lint rules that are style opinions** (`float`, `idSelector`,
  `universalSelector`, `boxModel`, `ieHack`, `important`) default to *Ignore*
  even in MS. Port the objective correctness rules first (unknown/duplicate/empty
  /hex-color); treat the opinionated ones as opt-in P2, not parity-critical.
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
  layer (restrictions, browser compat, pseudo data, specificity) that Jess does
  not yet load — closing that data gap unlocks most of the P0 completion depth
  for free.
</content>
</invoke>
