# Parser Optimization Spec — css / less / scss / jess

## Purpose

This is a research queue for the four Parseman parsers after direct canonical-AST
roots exist. Grammar reductions create core AST data with parser-local calls to
node constructors. There is no construction host, action callback surface,
compatibility parser, source reparse, or parser-owned import resolver to tune.

Every item is a separately measured change. Build the affected packages first,
measure the built artifact, and retain an independent reference result for
contested Less or Sass output. A parser optimization must not weaken the
grammar-owned structure contract merely to reduce a benchmark number.

## Non-negotiable parser boundary

- Runtime recognition belongs to Parseman grammar combinators and macro output.
  Handwritten runtime regex/scanners, string splitting, and recovery reparses do
  not belong in parser packages.
- Interpolation, imports, declaration bounds, selector structure, and value
  structure are grammar facts. Import resolution is a Context/plugin capability
  operating on typed import facts after a file has been parsed once.
- Keep the package graph one-way: dialect parser to core AST. Core does not
  import a dialect grammar, parser, plugin, filesystem, or resolver.
- A direct AST root is complete only when it is the dialect's actual `parse`
  entry. Do not publish a closed syntax pilot as a public parse API.

## Highest-value measurements

1. Profile the actual built CSS, Less, SCSS, and Jess roots separately. Report
   fixture size, warm-up, samples, median, and whether parsing includes CST or
   canonical AST construction.
2. Inspect Parseman first sets and macro output before changing a grammar. Favor
   disjoint `choice` arms, shared-prefix factoring, and small grammar lookahead
   when the profile proves speculative descent or dispatch cost.
3. Compare SCSS against Dart Sass on matched parse work and realistic fixtures.
   Do not call a transform/serialization pipeline comparison a parser win.
4. Measure interpolation-dense, selector-heavy, declaration-heavy, and import
   fact fixtures independently; aggregate fixtures hide the decision that is
   actually expensive.

## Candidate queue

- Eliminate failed speculative grammar arms through first-token partitioning.
- Factor common prefixes in selector and value choices when a profile identifies
  repeated descent.
- Keep trivia capture only where the resulting AST/CST consumer needs it.
- Prefer grammar leaves for literal/value categories over later classification.
- Benchmark macro-compiled grammar changes against the interpreted form only to
  understand compiler effects; production claims use the built package.
- For SCSS, find a matched Dart Sass baseline only after the direct root accepts
  the same construct family and produces the same CSS through the canonical AST.

## Landing gate

Run focused parser-shape tests, parser-boundary verification when recognition
changes, the relevant dialect corpus, and a before/after benchmark with the
same fixture and runtime. Core tests, the Jess AST-v2 production-route ratchet, and
the Less corpus remain integration gates. Correctness proof is not a speed
claim; publish the measurement or say performance remains unmeasured.
