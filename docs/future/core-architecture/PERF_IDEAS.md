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

## Landed levers

- **Value-piece slash left-factoring (parse, ~-11 ms / ~13% whole-render).**
  `DirectLessValuePiece`/`DirectLessFunctionValuePiece` used to list
  `DirectLessPreservedDivision` (a full `DirectLessTopSum` + REQUIRED slash tail)
  ahead of a bare `DirectLessTopSum`. The two arms share `TopSum`'s first-set, so
  the `choice` is not disjoint and cannot dispatch: every non-slash value (the
  overwhelming majority) parsed a full `TopSum`, failed the slash tail,
  backtracked, and re-parsed `TopSum` from the same position — a redundant full
  value descent per piece. Replaced with a single left-factored
  `DirectLessTopSumMaybeDivision` (`TopSum` once, then an OPTIONAL `many` slash
  tail): a bare value when no slash follows, the identical `SpacedValue` when one
  does. Measured same-worktree interleaved A/B on `benchmark.less`: parse median
  69 → 57.5 ms; whole-render median 84 → 73 ms. Byte-identical render; core
  (3194), less-parser (273), and the Less unit/config corpora unchanged.

- **Value-math `{collapse:true}` (parse, ~-3–4 ms / ~7% of parse).** The AST
  value-math precedence chain builds up to five nested nodes per value
  (`TopSum→TopProduct→MathAtom→MathUnary→ValueAtom`) even for a plain `#fff` with
  no operator. Each level is a single-child pass-through whose build action
  (`foldOperation`/`requireValueNode`) just returns `children[0]`. Adding
  parseman's `{collapse:true}` (a wrapper rule IS its single child) to
  `MathAtom`/`MathUnary`/`MathProduct`/`MathSum`/`TopProduct`/`TopSum` returns the
  child directly when no operator matched (`length===1`), skipping the redundant
  build-action call and node object; the fold still runs when operators are
  present. Byte-safe by construction (single-child fold == identity). NOTE: this
  is NOT the shelved parser-thing precedence-collapse experiment (#7) — that
  removed fold *scaffolding* V8 escape-analyzes away and was measured only on a
  trivial example; this elides whole *nodes* on the real Less value chain, where
  it measures a consistent ~7% parse win (byte-identical; core 3194, less-parser
  273, Less corpora green). NB: parse is ~68% of render and does NOT capture CST
  (`ctx.build===undefined` → grammar build actions run directly); the cost is
  node volume + recognizer descent, not capture.

## Gates

Any candidate needs focused behavior proof and a matched benchmark. At an
integration boundary rebuild dependencies, run core tests, the Jess AST-v2
production-route ratchet, and the Less corpus. SCSS-vs-Dart-Sass claims require matched
syntax coverage and a recorded median; otherwise report them as unmeasured.
