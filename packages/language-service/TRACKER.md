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
- [ ] Index: `findNodeAtOffset` + node path + basic scope extraction.
- [x] Diagnostics: map Jess diagnostics → LSP diagnostics (stable ranges).

### Phase 2 — Completion (visible parity)
- [x] Route completion by Chevrotain/Jess content assist (“next token types”) at cursor.
- [x] At-rule completion (`@media`, `@supports`, …) from web custom data.
- [x] Property name completion from web custom data.
- [x] Property value completion (descriptor/value aware).
- [ ] Variables: Less `@var`, SCSS `$var`, CSS custom properties `--x` (where relevant).
- [ ] Degrade gracefully when the doc is syntactically invalid (slice/local fallback).

### Phase 3 — Hover + navigation
- [ ] Hover: properties/values/functions/vars (with docs from custom data).
- [ ] Definitions/references/rename for vars (and later more symbols).
- [ ] Document symbols (rulesets, at-rules, vars, etc.).

### Phase 4 — Remaining editor features
- [ ] Document links (imports/urls/module resolution).
- [ ] Code actions (quick-fixes from recovery metadata, unknown prop/at-rule suggestions).
- [ ] Colors.
- [ ] Folding ranges.
- [ ] Selection ranges.
- [ ] Formatting strategy (keep existing formatter? Jess formatter? decide per language).

### Phase 5 — Test harness (guiding star: `vscode-css-languageservice`)
- [ ] Port/adapt a minimal subset of completion/hover/diagnostics tests as golden cases.
- [ ] Expand to cover Less/SCSS parity suites.
- [ ] Add “does not crash” suites for malformed input (editor-realistic).

### Phase 6 — `.jess` language mode
- [ ] Add a `.jess` document selector to the extension.
- [ ] Add parsing/indexing/diagnostics/completion basics for `.jess`.

