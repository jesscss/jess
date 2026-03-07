# Jess language service (LSP + extension) — project notes

This project will provide a **Jess-first** language service for:
- CSS
- Less
- SCSS
- (eventually) `.jess`

It will ship as:
- a reusable **library engine** (programmatic API)
- a thin **LSP server wrapper**
- a VS Code / Cursor **extension** that runs the server

This is a pivot away from attempting to “replace internals of `vscode-css-languageservice` while keeping its public API compatible”.
We will still use Microsoft’s `vscode-css-languageservice` as a **reference implementation / guiding star** for behavior, tests, and messaging.

## Packages

- `packages/language-service/`
  - Engine + thin LSP server wrapper.
- `packages/extension/`
  - VS Code / Cursor extension that launches the server.
- `packages/language-service-tests/`
  - Golden/parity-style tests against the engine (using `vscode-css-languageservice` as an oracle where useful).

## Principles

- **Jess AST is the source of truth**: no legacy AST compatibility layer inside the new engine.
- **Parse normally (fast path)** on text changes; cache parse results + indexes per document.
- **Use Chevrotain syntactic content assist on-demand** (completion requests, and optionally diagnostic enrichment).
- **Editor-centric APIs**: everything is offset-based and scope-aware (`getNodeAtOffset`, `getCompletionsAt`, etc.).

## Tracking

See:
- `packages/language-service/TRACKER.md`

