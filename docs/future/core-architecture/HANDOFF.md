# Core Architecture Handoff

## Current target

Keep AST v2 as the canonical representation. Parseman grammar reductions create
exact AST data directly; core has no parser construction host, action registry,
bridge, source reparse, or compatibility path.

## Router

| Work | Read first |
| --- | --- |
| Direct parser AST construction and legacy-builder deletion | [`AST-REORG-EXECUTION.md`](./AST-REORG-EXECUTION.md) |
| Parser recognition, interpolation, and scanner cleanup | [`GRAMMAR-RELOCATION-DESIGN.md`](./GRAMMAR-RELOCATION-DESIGN.md) |
| Feature/eval closure | [`AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md`](./AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md) |
| Eval/render allocation, lookup, and traversal cuts | [`CORE-CLEANUP.md`](./CORE-CLEANUP.md) |
| Patch-shape review | [`AGGRESSIVE-CUTTING-REVIEW.md`](./AGGRESSIVE-CUTTING-REVIEW.md) |

The detailed future plans remain active for their grammar, feature/eval,
scanner-cleanup, and performance content. Their former bridge/host sections are
historical evidence only.

## Non-negotiable rules

- Grammar owns recognition and construction. Do not add a parser host, action
  registry, bridge, compatibility alias, source reparse, or fallback path.
- Parser recognition uses Parseman grammar combinators only. Imports and
  interpolation are typed first-parse facts.
- Preserve one canonical tree; do not normalize cloning, materialization,
  rediscovery, or error allocation in hot paths.
- Public operations use stable names such as `parse`, `build`, and `render`.

## Completion gates

Run focused parser/core tests first. Run the parser-runtime boundary verifier
when recognition changes. For eval/render/lookup/traversal/copying changes, run
`pnpm run verify:aggressive-cutting-review` before commit. Final integration
requires fresh builds, core tests, the Jess production spine ratchet, and the
Less corpus.

## Aggressive Cutting Self-Prosecution

- Latest pass: private CSS direct-AST value family.
- Architecture surface: `packages/css-parser/src/ast/grammar.ts` remains private: `packages/css-parser/src/index.ts`, `cst-css.ts`, and `grammar.ts` neither import nor export `cssAstGrammar`; `package.json` has no subpath targeting it and `tsdown.config.ts` has no entry for it. The sole current importer is `packages/css-parser/test/ast-grammar.test.ts`. No existing parse, eval, or render route reaches it.
- Separation/duplication: this extends parser-local Parseman construction with quoted, `url(...)`, and generic function-call reductions using core node constructors only. It creates no host, action registry, bridge, conversion pass, public pilot, or fallback.
- Cumulative node weight: source AST nodes exist only for an explicit run of this development grammar; the current public CSS CST path creates none of them.
- New traversal: [loop/traversal] `complexSegments` makes one bounded pass over the already-captured children of one selector reduction. The value family uses only Parseman's already-captured child arrays. Neither path walks a source tree or runs in any live parse/render route.
- New node/materialization: [node construction] reductions call existing core constructors for the exact AST nodes they own. [materialized array/object] and [array spread/materialization] are the parser-owned child arrays and constructor argument list required to represent selector/value structure, reachable only from the private test seam. Quoted bodies are grammar segments, and URL/function arguments are passed through as constructed child values; no source text is split or reparsed.
- Render path: unchanged. `serialize` appears only in the focused proof; public render does not import this grammar.
- Helper/API surface: [array helper] filters are reduction-local type selection over Parseman's captured children. There is no exported helper or runtime callback surface.
- Metadata mutations: none.
- Review-flagged diff tokens: [loop/traversal], [array helper], [array spread/materialization], [node construction], [routine error control], and [materialized array/object] are all private grammar construction checks. The `Error` branches reject impossible malformed reduction children and are not routine parse control flow; recognition itself remains Parseman combinators.
- Hot-path cost contracts:
  ```json
  [{"id":"css-private-direct-ast-family","verdict":"accepted","privateReachability":{"productionImporters":0,"publicExports":0,"buildEntries":0,"coldConstructionOnly":true},"why":"Current static reachability is zero from CSS production source and artifacts: no public parse/CST/eval/render entry imports or exports cssAstGrammar, package.json has no subpath targeting it, and tsdown has no build entry. Its bounded child scans and allocations occur only when the focused development test directly runs CssAstDocument; no benchmark or runtime-speed claim is made."}]
  ```
- Evidence: focused source-to-AST-to-serialize tests, CSS package build/tests, parser runtime boundary verification, and the private-reachability registry check.
- Verdict: accepted as an unreachable development construction slice; wiring a public parser root requires a new reachability and runtime cost review.
