# Parser and AST Performance Ideas

## Measurement discipline

Measure the built dialect package on a named fixture with fixed warm-up and
sample count. Separate parse, canonical-AST construction, evaluation, and CSS
emission. Match input and requested work when comparing with Dart Sass; a
transform or serialization pipeline is not a parser comparison.

## Parser candidates

- Use Parseman first sets, shared-prefix factoring, and small grammar lookahead
  to remove profiled speculative descent.
- Keep interpolation, imports, values, selectors, and at-rule structure in the
  grammar so no later byte scan is needed.
- Avoid runtime scanner/regex/string reparse helpers in parser packages; move
  recognition into grammar combinators or delete the obsolete path.
- Retain trivia only where a CST/AST consumer demonstrably uses it.
- Benchmark macro-compiled grammar output against an identical fixture and
  check generated artifacts before claiming an optimization applies to release
  builds.

## AST/eval candidates

- Keep one canonical source tree and lazy placement state; avoid routine clones,
  materialization, side maps, and rediscovery walks.
- Rendering should write strings directly. Evaluation should not create nodes
  solely for immediate serialization.
- Prefer construction-time facts over later source/parent/selector discovery.
- Use profiles before changing hot code. Object-count reduction is evidence only
  when it explains lower measured time or memory.

## Gates

Any candidate needs focused behavior proof and a matched benchmark. At an
integration boundary rebuild dependencies, run core tests, the Jess AST-v2
production-route ratchet, and the Less corpus. SCSS-vs-Dart-Sass claims require matched
syntax coverage and a recorded median; otherwise report them as unmeasured.
