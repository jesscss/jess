# Jess 2.0.0-alpha.9 — draft release notes

> **Draft for owner review.** This is the user-facing changelog source for the
> next Jess alpha cut. It describes the validated `dev` candidate, not a claim
> that the candidate is ready to publish. Keep it in the `dev` → `alpha` squash
> snapshot and revise it only from release-gate evidence.

## Highlights

### Canonical stylesheet pipeline

Jess now treats the four shipped stylesheet syntaxes as frontends for one
compiler engine:

```text
CSS / Less / SCSS / .jess source
            ↓
canonical AST-v2 Stylesheet
            ↓
one core evaluation and rendering engine
```

The public `parse()` operation in `@jesscss/css-parser`,
`@jesscss/less-parser`, `@jesscss/scss-parser`, and `@jesscss/jess-parser`
directly returns the canonical `Stylesheet` AST. Each parser uses Parseman
grammar reductions to construct that document; the compiler route does not
convert a CST through a builder, parse host, action registry, or source reparse.

`Context` remains the compiler session: it coordinates documents, imports,
modules, diagnostics, caches, and plugins. Parser plugins provide syntax and
document-loading capabilities; they do not select a separate Less, SCSS, CSS,
or Jess evaluation/rendering mode.

### Jess syntax is a first-class frontend

The candidate alpha publish set includes `@jesscss/jess-parser` and
`@jesscss/plugin-jess`, so `.jess` sources will enter the same direct
`Stylesheet` pipeline as Less and SCSS sources. CSS remains an explicitly
configured Context document/inlining plugin; Jess does not treat a CSS entry as
a separate compilation mode.

### Public API changes

- Use each dialect package's stable `parse(source)` API for a canonical
  `Stylesheet` document.
- `@jesscss/core/ast` is the dependency-light AST construction surface. The
  core package also exposes the canonical AST serializer and typed value
  evaluator for the compiler integration path.
- Explicit CST/document APIs remain available for language-service and document
  use. They are not a compiler-to-AST conversion API.

## Breaking / experimental changes

This is a deliberately breaking alpha architecture change.

- Transitional parser exports and internal construction machinery are not a
  compatibility surface. Consumers must not depend on former builder/host,
  functional-driver, or syntax-specific compiler entrypoints.
- The canonical AST-v2 node names and shapes are still alpha API. In
  particular, `Stylesheet` is the document root and `Reference` is the recursive
  typed reference chain.
- Existing CSS/Less/SCSS/Jess syntax support is being carried through the one
  engine. A syntax does **not** gain dialect-specific render or duplicate-rule
  semantics by selecting a parser plugin.

## What this alpha does not claim

- It does not publish the external `less@5.0.0-alpha.1` package. That is a
  separate Less release, pinned to exactly that first prerelease version and
  gated on its own compatibility, CLI, and clean-install verification. Jess
  alpha.9 must be published first; the Less release script then receives
  `JESS_VERSION=2.0.0-alpha.9` so its local workspace links are rewritten to
  registry dependencies only for the publish window.
- It does not claim complete Less 4.x corpus parity. The first alpha ships only
  after its advertised public-route, package, CLI, and core-safety gates pass;
  the 34 runnable upstream divergences are published as known limitations, not
  hidden test exclusions. See [Less v5 alpha readiness](../less-v5-alpha-readiness.md)
  for every fixture, its symptom/scope, and follow-up.
- It intentionally removes four legacy Less fixture categories: backtick
  JavaScript evaluation, IE `progid:DXImageTransform` filters, the legacy
  function fixture's non-Less `$list` syntax, and legacy `@plugin` tree visitor
  hooks (`isPreEvalVisitor`, `manager.addVisitor`, `visitors.Visitor`). These do
  not have AST-v2 compatibility shims.
- It makes no parser-performance claim. The direct parser baseline and Parseman
  0.28 regression work remain release-gated and are measured separately.
- It does not publish from local workspace links. Parseman 0.28 must be
  published, consumed through a real package version, and proven in a clean
  consumer install before this Jess alpha can ship.

## Before publishing

The release owner must verify the exact candidate on `dev`, update these notes
from the resulting evidence, then squash that validated snapshot onto `alpha`.
Do not ordinary-merge or rebase `dev` into `alpha`. From the squashed `alpha`
snapshot, run the documented package, parser/plugin, Less-alpha, baseline,
cutting-review, CLI, and clean-consumer gates before `release:alpha` resolves
and publishes `2.0.0-alpha.9`.
