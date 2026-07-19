# Core Architecture Handoff

Start here, then read only the lane document that owns the work. This file is a
router and a set of durable constraints, not a rolling log. Historical session
state and rejected experiments are preserved in
[`archive/HANDOFF-history-2026-07-18.md`](./archive/HANDOFF-history-2026-07-18.md).

## Current target

Make AST v2 the one canonical core representation. Parser grammar reductions
emit its exact plain discriminated data directly (with optional type-only
contracts from `@jesscss/core/ast`); they do not call a runtime factory layer.
The transitional `parse-host`, `BuilderHost`, bridge builders, and legacy
runtime recognizers are deleted rather than relocated. Internal consumers that
still expect old shapes may go red during this cutover and are then repaired or
removed.

## Router

| Work | Read first | Evidence / gate |
| --- | --- | --- |
| AST-v2 canonicalization, parser construction, parse-host deletion | [`AST-REORG-EXECUTION.md`](./AST-REORG-EXECUTION.md) | direct parser AST construction; no host/bridge survives |
| Core eval/render behavior | [`AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md`](./AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md) | focused core tests, then full core suite |
| Parser recognizer debt and interpolation structure | [`GRAMMAR-RELOCATION-DESIGN.md`](./GRAMMAR-RELOCATION-DESIGN.md) | parser-runtime boundary verifier plus parser tests |
| Allocation, lookup, traversal, copying, eval/render cuts | [`CORE-CLEANUP.md`](./CORE-CLEANUP.md) | focused proof, aggressive review, measured A/B where performance is claimed |
| Patch-shape review | [`AGGRESSIVE-CUTTING-REVIEW.md`](./AGGRESSIVE-CUTTING-REVIEW.md) | `pnpm run verify:aggressive-cutting-review` |
| Stable runtime model | [`UNIFIED-EVAL-EMIT-DESIGN.md`](./UNIFIED-EVAL-EMIT-DESIGN.md) | design reference only; do not treat old rollout sequencing as a blocker |
| External behavior decisions | [`DESIGN-DECISIONS.md`](./DESIGN-DECISIONS.md), [`V5-OUTPUT-SEMANTICS.md`](./V5-OUTPUT-SEMANTICS.md) | fixture and end-to-end output evidence |

## Non-negotiable architecture rules

- The grammar reduction in each dialect parser owns AST construction. It emits
  exact local AST literals; do not add a runtime factory module, `BuilderHost`,
  `ParseHost`, generic action registry, dispatch host, artifact callback ABI,
  or compatibility shim. Core constructors are optional programmatic
  conveniences, never the parser construction contract.
- `packages/css-parser`, `packages/less-parser`, `packages/scss-parser`, and
  `packages/jess-parser` may recognize syntax only through Parseman grammar
  combinators and macro-compiled output. Handwritten runtime regexes, scanners,
  `charCodeAt` loops, source splitting, interpolation sniffing, and reparsing are
  prohibited.
- Imports are typed facts from the first parse. Loading another source permits
  parsing that source once; it never permits a variable-sniff pass, source splice,
  or second parse of already-read text.
- Interpolation is structured grammar (`many(choice(...))` or a stricter typed
  equivalent), including quoted strings, import targets, at-rule preludes,
  selectors, property names, values, and paths.
- Public operation names describe the stable operation: `parse`, `build`,
  `render`, `Document`, `RenderOptions`. Do not retain or introduce migration or
  dialect-name aliases as an API pattern.
- Keep one canonical source tree, placement-local runtime state, sparse patches,
  and direct rendering. Do not normalize cloning, materialization, recursive
  rediscovery, or error allocation as ordinary hot-path control flow.
- Fix invalid node relationships where they are created. Do not use `as any` or
  attach ad-hoc runtime properties to evade AST invariants.

## Completion gates

1. A parser/canonical-AST change starts with its smallest focused parser and core
   behavior tests, then runs the parser-runtime boundary verifier when recognition
   code changes.
2. A core eval/render/lookup/traversal/copying change runs
   `pnpm run verify:aggressive-cutting-review` before commit, plus the focused and
   package gates appropriate to the touched family.
3. Integration does not advance `dev` red: build dependencies before consumers,
   make core tests green, run the Jess production spine ratchet, then run the Less
   corpus byte-identically after compiled outputs are fresh.
4. AST-v2 / parser-host deletion is accepted only when construction is direct,
   host imports are gone, and migrated behavior coverage exercises public dialect
   render seams or core behavior—not a bridge.
5. SCSS performance work starts only after the AST and parser runtime boundary
   gates are satisfied; compare fresh, equivalent benchmark runs against Dart Sass.
6. Before a final integration merge, run an adversarial review and close every
   issue or record a concrete recommended change.

## Documentation ownership

- `HANDOFF.md` stays short: current target, router, immutable laws, and gates.
- `CORE-CLEANUP.md` contains the bounded live core queue and current doc-maintenance
  result. It is not a chronicle.
- The `archive/` directory preserves completed plans, old status snapshots,
  rejected experiments, and drained queue history. Historical facts remain
  discoverable there and through git history; they are not active instructions.

See [`archive/README.md`](./archive/README.md) for the archive index.

## Aggressive Cutting Self-Prosecution

- Architecture surface: `@jesscss/css-parser/ast` is a closed opt-in direct AST-v2 pilot. Its Parseman reductions create plain `Root`, `Rule`, selector, and `Comment` literals directly; it imports neither a parse host nor any legacy builder or bridge.
- Separation/duplication: the pilot is deliberately outside `cssGrammar` and all dialect composition. It proves the direct construction contract without preserving a callback ABI or changing the existing functional path.
- Cumulative node weight: the new path creates only canonical child arrays required by its selected subset; it adds no side map, wrapper, legacy node, or metadata mutation.
- New traversal: none. The result shaper validates the direct root once; rendering uses the existing AST serializer with no bridge conversion.
- New node/materialization: cold, opt-in parser output only. Existing benchmark/render paths do not instantiate the pilot grammar.
- Render path: no existing render branch changed; the focused test renders the direct root through the AST serializer.
- Helper/API surface: one public subpath operation, `parseCssToAst`; no `parseCssFn` alias, `FunctionalParseHost`, `BuilderHost`, action map, or compatibility facade is retained.
- Metadata mutations: none.
- Review-flagged diff tokens: `[array helper]` `filter` creates only the direct root/body child arrays of the caller-selected pilot; `[materialized array/object]` canonical literal/result objects are cold opt-in parse output and failure diagnostics; `[node construction]` and `[routine error control]` are one impossible-after-grammar invariant throw when a required selector is absent, never routine recovery. No existing benchmark path gains either allocation or branch.
- Hot-path cost contracts:
```json
[
  {"id":"css-direct-ast-public-entry","verdict":"accepted","costDelta":"neutral","why":"The public result shaper is opt-in and not on the benchmark render route.","dangerTokensJustification":"The failure array is cold diagnostic data; the success result is the public API shape, and neither changes the existing parser or renderer.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}},
  {"id":"css-direct-ast-closed-grammar","verdict":"accepted","costDelta":"neutral","why":"The selected grammar is isolated from cssGrammar and all dialect composition.","dangerTokensJustification":"The filtered arrays are the canonical Root and Rule children only for explicit pilot callers; benchmark parsing does not enter this grammar.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}}
]
```
- Evidence: direct construction + render test, full CSS parser suite, CSS build, parser-boundary verification, package-export verification, and `git diff --check` pass. Full cross-dialect macro gate remains baseline-red in Less/SCSS/Jess because their pre-existing compose inputs are not build-resolvable.
- Verdict: accepted.
