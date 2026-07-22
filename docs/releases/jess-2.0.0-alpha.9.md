# Jess 2.0.0-alpha.9 — draft release notes

> **Draft for owner review.** This is the user-facing changelog source for the
> next Jess alpha cut. The `dev` candidate has passed its pre-cut gates, but it
> is not publishable until the controlled `dev` → `alpha` snapshot has passed
> those gates again. Keep this file in that snapshot and revise it only from
> release-gate evidence.

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

### Candidate verification snapshot

The validated `dev` candidate resolves the next registry version as
`2.0.0-alpha.9`. Its publishable runtime closure contains 18 packages; the
closure validator and packed-consumer installation proof both pass.

The pre-cut gate run passed the release build, strict production types,
production lint (no errors), Less-alpha public API and fixture gates, Jess
parser/plugin/Rollup tests, AST-v2 production-route ratchet, baseline suite,
aggressive-cutting release review, package-closure validation, and packed
consumer proof. Parseman `0.28.1` is the published dependency used by that
candidate.

The complete Less corpus currently reports 84 byte-identical passes, 32 output
mismatches, 15 known errors, zero timeouts, and zero crashes. Seven of the
output mismatches do not yet have dedicated fixture markers; they remain visible
in the corpus report and are release-note follow-up work, not passing evidence.

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
- It does not claim complete Less 4.x corpus parity. The current full-corpus
  result is 84 byte-identical passes, 32 output mismatches, and 15 known
  errors; seven output mismatches still need dedicated fixture markers. These
  remain visible compatibility work, not hidden passing evidence. See
  [Less v5 alpha readiness](../less-v5-alpha-readiness.md) for the tracked
  inventory and follow-up.
- Less v5 intentionally removes backtick JavaScript evaluation, IE
  `progid:DXImageTransform` filters, the legacy fixture's non-Less `$list`
  parameter/reference syntax, legacy `@plugin` tree visitor hooks
  (`isPreEvalVisitor`, `manager.addVisitor`, `visitors.Visitor`), and dash-only
  variable names (`@-` and `@{-}`). The corresponding Less 4 line emits a
  deprecation warning for the dash-only variable forms; alpha.9 does not retain
  an AST-v2 compatibility shim for any of these removals.
- Other known Less-alpha limitations include source-map artifacts, selected URL
  and import configuration behavior, legacy CommonJS `@plugin` graphs, and
  documented rendering differences such as media-query merging. They remain
  classified corpus results rather than dialect-specific engine fallbacks.
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
