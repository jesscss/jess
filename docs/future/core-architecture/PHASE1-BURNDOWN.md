# Core Cleanup Burndown — Current Work

## Completed cuts

The core parser-construction host, action-list machinery, bridge renderer, and
duplicate import/filesystem resolver are gone. Parser-side legacy builder
entries and functional parser compatibility routes are also deleted. These are
not pending cleanup items and must not be reintroduced to repair a caller.

Core now has one job at this boundary: own canonical AST data, constructors,
evaluation, and serialization. Dialects own grammar recognition and direct AST
construction. Plugins/Context own import and filesystem capabilities.

## Remaining closure work

- Give each dialect a complete direct canonical-AST `parse` root. A private
  grammar experiment is not an API or a completion claim.
- Close AST node-family gaps from grammar facts, then prove core evaluation on
  that AST. Do not substitute an old tree, bridge, or text conversion.
- Remove remaining handwritten parser runtime recognition after the direct
  grammar families replace it. Parseman macro-generated recognition is allowed;
  handwritten scanner/regex/reparse logic is not.
- Restore Less evaluation only through the completed direct Less root and the
  canonical AST evaluator. Imports remain typed facts plus plugin/Context
  resolution, never parser-host resolution.
- Finish SCSS direct construction and measure it against Dart Sass on matched
  parser work once correctness is proven.

## Completion evidence

For a dialect: no legacy parser entry or builder remains reachable; the public
root is the actual grammar root; AST-shape tests cover its supported families;
and runtime-boundary verification is clean. For integration: fresh dependency
builds, core tests, Jess production spine ratchet, and the Less corpus pass.
Performance claims require a matched before/after measurement.
