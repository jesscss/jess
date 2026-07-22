# Core Cleanup Burndown — Current Work

## Completed cuts

The core parser-construction host, action-list machinery, bridge renderer, and
parser-side legacy builder entries are gone. Functional parser compatibility
routes are also deleted. These are not pending cleanup items and must not be
reintroduced to repair a caller.

Core's AST package owns canonical AST data, constructors, evaluation, and
serialization. Dialects own grammar recognition and direct AST construction.
`Context` remains the core coordination/state boundary: it dispatches import
expansion, resolution, location, source loading, parsing, and plugin module
import to plugins. It also currently provides explicit core raw-byte and JSON
utilities after plugin path resolution; their capability ownership is a
separate decision. The AST cutover updates the parser/document path from legacy
`Rules` results to canonical AST documents; it does not delete or replace
Context dispatch. Only a call path proven to bypass or duplicate that chain is
a removal candidate.

## Remaining closure work

- Give all four dialects complete direct canonical-AST `Stylesheet` parsers through
  their public package `parse()` APIs. Earlier unexported grammar work is
  incomplete implementation, not a valid architecture or completion claim.
- Only after parser closure, migrate each plugin to consume its parser's Stylesheet
  through the retained Context/plugin dispatch path. Only after plugin closure,
  migrate the Jess package integration/render route.
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
builds, core tests, Jess AST-v2 production-route ratchet, and the Less corpus pass.
Performance claims require a matched before/after measurement.
