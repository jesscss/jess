## Language service tracker (Jess-first)

This tracker migrated from the experimental work in `vscode-css-languageservice/docs/jess-rewrite*.md`,
but updated for the new goal: **ship a Jess-first LSP + VS Code/Cursor extension**, no upstream merge target.

### Phase 0 — Repo scaffolding
- [x] Create `packages/language-service/` (engine + thin LSP wrapper).
- [x] Create `packages/extension/` (VS Code/Cursor client).
- [ ] Create `packages/language-service-tests/` (engine golden tests).

### Phase 1 — Engine primitives (CSS first)
- [x] Document store: open/change/close + versioning.
- [x] Parse cache: `{ lang, parseResult }` per document (CSS/Less/SCSS).
- [x] Index: `findNodeAtOffset` + node path + basic scope extraction.
- [x] Diagnostics: map Jess diagnostics → LSP diagnostics (stable ranges).

### Phase 2 — Completion (visible parity)
- [x] Route completion by Chevrotain/Jess content assist (“next token types”) at cursor.
- [x] At-rule completion (`@media`, `@supports`, …) from web custom data.
- [x] Property name completion from web custom data.
- [x] Property value completion (descriptor/value aware).
- [x] Variables: Less `@var` ✅, CSS custom properties `--x` ✅. SCSS `$var` ⚠️ (parser issues - Less/Jess have advantage).
- [ ] Degrade gracefully when the doc is syntactically invalid (slice/local fallback).

### Phase 3 — Hover + navigation
- [x] Hover: properties/values/functions/vars (with docs from custom data).
- [x] Definitions/references for vars: Less ✅, SCSS ✅ (cross-file support added).
- [x] Cross-file navigation: go-to-definition and find-references for variables and mixins across imported files.
- [x] Import graph: built using `@jesscss/style-resolver` with cycle detection and cached parsed documents.
- [x] Document symbols (rulesets, at-rules, vars, mixins, functions) - hierarchical structure ✅.

### Phase 4 — Remaining editor features
- [x] Document links (imports/urls/module resolution) with proper file resolution via `@jesscss/style-resolver`.
- [x] Code actions (quick-fixes: create variable, create mixin for undefined references).
- [x] Colors (color picker support) - supports hex, rgb/rgba, hsl/hsla, hwb, lab, lch, oklab, oklch, and color keywords.
- [x] Folding ranges (structural blocks: rulesets, at-rules, mixins, functions).
- [x] Selection ranges (nested AST spans for smart selection).
- [x] Formatting (uses core AST `toTrimmedString` for consistent indentation).
- [x] Semantic tokens (parser-driven highlighting with AST-based variable reference detection).
- [x] Dynamic diagnostic severity: undefined variables are errors when `@use` (SCSS) or `@from`/`@compose` (Less) present, warnings otherwise.

### Phase 5 — Test harness (guiding star: `vscode-css-languageservice`)
- [ ] Port/adapt a minimal subset of completion/hover/diagnostics tests as golden cases.
- [ ] Expand to cover Less/SCSS parity suites.
- [ ] Add “does not crash” suites for malformed input (editor-realistic).

### Phase 6 — `.jess` language mode
- [ ] Add a `.jess` document selector to the extension.
- [ ] Add parsing/indexing/diagnostics/completion basics for `.jess`.

