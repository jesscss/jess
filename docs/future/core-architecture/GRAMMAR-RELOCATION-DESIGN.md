# Grammar Relocation Design

## Current rule

Parser grammar reductions own AST construction. Each dialect calls core node
constructors directly and produces typed facts; core owns AST/eval/serialize
only. No host, builder registry, action map, adapter, or reparse protocol is a
valid replacement for this boundary.

The historical inventory of mechanisms removed during the host cut is not an
execution plan. It is retained only where already archived as history.

## Relocation target vocabulary

For each source shape, choose one of these grammar-owned outcomes:

- a Parseman `regex()` terminal for lexical classification;
- a typed grammar production for a structured syntax family;
- an explicit opaque AST value only when the dialect intentionally preserves
  bytes and no later phase needs structure.

The grammar must not recognize structure and then ask a later stage to split,
scan, or re-parse the same authored bytes.

## Direct-root work order

1. Establish the actual dialect `parse` root and direct `Root` reduction.
2. Construct declarations, values, selectors, rules, variables, mixins,
   at-rules, and import facts with core constructors as their grammar families
   become complete.
3. Make every interpolation-bearing position a typed segment sequence: quoted
   text, import specifier, at-rule prelude, selector, property name, value, and
   path. The parser retains segments; evaluation consumes them without a text
   scan.
4. Parse imports once as typed facts. Context/plugin capabilities may load and
   parse a distinct imported file once, but no consumer re-parses already-read
   source for options, variables, or splice boundaries.
5. Delete obsolete recognition code with the old root; do not retain it as a
   fallback, compatibility entrypoint, or benchmark-only implementation.

## Verification

Each family needs raw AST shape tests in addition to rendered CSS tests.
Exercise nested references, guards/defaults, selector/extend placement,
Less media forms, imports, and interpolation at the grammar boundary. Run the
parser runtime-boundary verifier whenever recognition changes. At dialect
integration boundaries, rebuild dependencies and run core tests, the Jess
production spine ratchet, and the Less corpus.
