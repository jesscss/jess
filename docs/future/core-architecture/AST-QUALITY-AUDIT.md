# AST Quality Audit — Current Criteria

## Scope

Audit the current `packages/core/src/ast` implementation, not deleted host or
bridge paths. The canonical AST must remain a parser-independent leaf package:
it may define node data, constructors, evaluation, serialization, and shared
value/selector algorithms; it must not own dialect parsing, grammar dispatch,
filesystem access, or compatibility rendering. This package-level boundary does
not prohibit core `Context` (outside `src/ast`) from coordinating installed
plugins for import expansion, resolution, source loading, parsing, and module
import.

## Review criteria

- One canonical node shape per semantic concept; one-payload nodes use `.value`
  except the explicit `Rules.rules` body contract.
- Parser grammar calls typed core constructors directly. Core does not expose a
  callback registry or migration facade for construction.
- Parent/child and source relationships remain structurally valid at creation;
  no post-hoc repair pass, `as any`, or ad-hoc node property is an acceptable
  substitute.
- Evaluation and serialization do not materialize/copy nodes merely to render
  strings. Shallow placement state is preferred where semantics require it.
- Value, selector, extend, mixin, and at-rule representations have one owner;
  duplicated conversion or byte-recovery logic is an audit finding.
- `packages/core/src/ast` stays free of parser/package/plugin imports and I/O.
  `Context` retains the existing plugin dispatch topology; audit its explicit
  byte/module capabilities separately from AST-package purity.

## Audit method

Use current call graphs and focused tests, not historical file counts. For each
finding, name the surviving file, the concrete ownership breach or hot-path
cost, the smallest delete/simplify/correct action, and the behavior proof.
Run `verify:aggressive-cutting-review` for eval/render/lookup/traversal/copy
work. Treat verifier output as a prompt for real evidence, never a reason to
add a ceremonial compatibility layer or false cost contract.
