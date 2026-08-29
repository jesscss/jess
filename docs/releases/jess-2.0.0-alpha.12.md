# Jess 2.0.0-alpha.12

The first published Jess alpha since `2.0.0-alpha.11`.

## Highlights

### Parser engine

The four dialect parsers depend on published `parseman@0.50.1` (up from
`0.44.0`). `check:macro` and `verify:compose-integrity` pass with 0 interpreter
fallbacks; the one-grammar host-mode fold is unchanged.

### Extend semantics (X11)

- `$extend &` is admitted as an extend target under the default policy; a
  self-extend `$extend &` that resolves to a no-op now emits a diagnostic
  instead of silently doing nothing.
- `$apply &` remains class-only by default.
- Extend graft ownership boundaries are preserved and immutable graft values are
  transferred rather than copied; nested reference pseudo visibility is retained.

### Selectors and nesting

- A top-level `&` is accepted, representing `:scope` (CSS Nesting L1 §4). It is
  emitted verbatim, or collapsed per `collapseNesting`, with no `:scope`
  rewrite.
- A root-level leading combinator (e.g. `> .a {}` at the stylesheet top) is
  rejected with an honest diagnostic — there is no parent to relate it to.
  Nested `> .a` is unchanged.
- Bootstrap renders green against the alpha fixture.

### Less behavior fixes

- `strictUnits: false` now maps to `unitMode: 'loose'`.
- Static import facts are published before rendering; visible imports after a
  reference import are retained; imported mixin body trivia is preserved.
- Structural mixin binding is consolidated and structural mixin arguments are
  preserved.

### Plugins

- `@jesscss/plugin-js` resolves its bundled Deno binary when none is on `PATH`.

### Performance and internals

- Core eval/render caches negative structured-parent checks and flattens
  deferred CSS import links; the less-parser drops speculative boundary leaves.
- `Context` option ownership is cut to an entry-dialect freeze.
- Release tooling: the alpha version resolver now always publishes `published+1`
  within a release base, so unpublished cuts can no longer drift the version
  ahead of npm.

## What this alpha does not claim

- It does not publish the external `less@5.0.0-alpha.1` package (separate,
  later release).
- It does not claim complete Less 4.x corpus parity.
- It does not make SCSS or `.jess` grammar cleanup a release gate.
- It does not treat parser-performance investigation as a rollback reason for
  the one-grammar parser fold.
- It does not publish from workspace links; registry-backed resolution remains
  part of the release proof.

## Known Limitations

The Less alpha fixture lane is a classified compatibility signal, not a claim
that every upstream Less 4.x fixture is byte-identical. The release-facing
inventory is
[`less-v5-corpus-inventory.md`](../state/less-v5-corpus-inventory.md); the
readiness gates and open package-flow blockers are tracked in
[`less-v5-alpha-readiness.md`](../state/less-v5-alpha-readiness.md). Known gaps
include URL/import option handling, source-map artifacts, removed legacy
plugin/parser behavior, and settled Less 5 policy boundaries. Those names stay
visible until the behavior is implemented or intentionally removed from scope.

## Before publishing

Refresh `alpha` from pushed `dev` with the controlled two-tree patch flow
(`pnpm run release:alpha:update-from-dev`), run the provenance/version
restoration step, review these notes, and run `pnpm run release:alpha:dry-run`.
With explicit owner approval, run `pnpm run release:alpha` from the clean
refreshed `alpha` worktree.
