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

## Direct-root cutover order

The parser work has one real composition gate: a leaf dialect grammar must be
able to macro-fuse imported, recognition-only shared syntax while retaining its
own local direct-constructor reductions. It must not serialize local builders,
relax direct-builder capture validation, or create a reusable builder artifact.
Once that leaf-only fusion exists, move in this order: complete direct CSS
families; build Less/SCSS/Jess dialect reductions over shared syntax; add a
plugin-owned Less document loader over typed `ImportAtRule` facts; then replace
the Jess legacy root and atomically delete legacy `StyleImport`, `Context`
resolver/getTree methods, and generic core plugin filesystem/parser hooks.
Core never receives a resolver callback or owns module/filesystem policy.

## Aggressive Cutting Self-Prosecution

- Latest pass: extend the private CSS direct-AST value family with calc-only
  arithmetic, calc parentheses, and grammar-owned importance.
- Architecture surface: `cssAstGrammar` remains test-only; public CSS parsing
  remains CST-only. Construction stays in parser-local reductions with core node
  constructors, with no host, bridge, resolver, reparse, or public entry.
- Separation/duplication: CSS arithmetic is structural only within `calc()`;
  bare value parentheses, binary `%`, malformed calc, and unspaced sum operators
  are rejected by grammar rather than recovered in a reducer.
- Cumulative node weight: only exact direct-AST `Operation` and `Paren` facts
  for the private test seam; no production parser route constructs them.
- New traversal: `foldOperation` walks one already-captured alternating child
  list to build left-associative calc operations. It does not walk source/tree
  state and is cold because the grammar has zero production importers.
- New node/materialization: parser reductions construct the exact operation and
  parenthesis nodes required by the direct AST; no post-parse conversion exists.
- Render path: unchanged; serializer is invoked only by focused proof.
- Helper/API surface: one grammar-local `foldOperation`, unexported.
- Metadata mutations: none.
- Review-flagged diff tokens: the local bounded loop and impossible-child
  `Error` guards run only after Parseman has structurally recognized a complete
  calc reduction; malformed calc is rejected before any reducer runs.
- Hot-path cost contracts:
  ```json
  [{"id":"css-private-direct-ast-family","verdict":"accepted","privateReachability":{"productionImporters":0,"publicExports":0,"buildEntries":0,"coldConstructionOnly":true},"why":"The calc reductions and their bounded child loop are reachable only from focused private CSS AST tests; no public parse/eval/render entry imports this grammar."}]
  ```
- Evidence: focused malformed/spacing/operator rejection and AST-shape tests,
  CSS package tests/build, parser-runtime boundary verifier, and adversarial review.
- Verdict: accepted cold direct-construction slice; no performance claim.

- Prior pass: delete the dead extend-prefilter runtime toggle and private AST
  barrel, while replacing the lost host-era prefilter proof with direct AST cases.
- Architecture surface: no public/runtime toggle, host, bridge, or full-scan
  reference path remains. The always-on candidate prefilter and prune are the
  sole extend implementation. AST tests import their owning leaf modules; the
  public construction surface remains `@jesscss/core/ast`.
- Separation/duplication: deletes an alternate test-only control path instead
  of retaining it as a compatibility seam. The direct AST test cases exercise
  canonical constructors and serializer output only.
- Cumulative node weight: decreases by the private barrel; runtime AST node
  vocabulary is unchanged.
- New traversal: none. The deletion removes the mutable branch around the
  existing prefilter and candidate-set admission; direct tests only construct
  small canonical roots.
- New node/materialization: none in production. Test roots/selectors are direct
  constructor input only.
- Render path: unchanged except that it no longer reads a mutable global to
  choose an unreachable full-scan branch.
- Helper/API surface: decreases: `setExtendPrefilterEnabled`,
  `isExtendPrefilterEnabled`, their global flag, and the private AST barrel are
  deleted. No replacement helper is introduced.
- Metadata mutations: none.
- Review-flagged diff tokens: candidate-set and branch scans already existed;
  this pass deletes their mutable gate and adds no runtime loop, allocation,
  map, clone, or error-control path.
- Hot-path cost contracts:
  ```json
  [{"id":"ast-extend-prefilter-toggle-deletion","verdict":"accepted","costDelta":"decrease","why":"Deletes an uncalled mutable toggle, its alternate full-scan gate, and the private barrel while retaining the existing production candidate admission. Direct AST regressions cover its former risk shapes; no speed claim is made.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}},{"id":"ast-evaluator-stale-adapter-comment-deletion","verdict":"accepted","costDelta":"neutral","why":"Comment-only removal of stale adapter terminology; no evaluator code path changes.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}},{"id":"ast-extend-public-toggle-export-deletion","verdict":"accepted","costDelta":"decrease","why":"Deletes the uncalled toggle export; live compute operation remains unchanged.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}}]
  ```
- Evidence: direct AST extend cases cover partial graft, nested own-extend plus
  descendant candidate closure, media reachability, and structured interpolation;
  full AST tests, core build, and package-export verification pass.
- Verdict: accepted deletion; the old host-era differential suite is not restored.

- Prior pass: delete unreachable AST-v2 `StyleImport` machinery and propagate direct `PropRef` importance through ordinary and merged declarations.
- Architecture surface: `ImportAtRule` remains the parser-owned typed import fact. No parser, test, public entry, or production caller constructs AST-v2 `StyleImport`; it existed only in its own union/factory/registry and serializer branches. `PropRef` retains the existing property lookup and declaration emit paths.
- Separation/duplication: deletes the duplicate AST import representation only; legacy `tree/StyleImport`, `Context`, `Rules`, plugin resolution, and import realization remain for the later direct dialect-Root plus plugin-owned IO cutover. The property accessor carries the source declaration's existing boolean through the existing ordinary sink or merged scalar; it adds neither inline bytes nor a second evaluator route.
- Cumulative node weight: decreases by one unreachable discriminant/factory and its serializer-only branches. The property lookup's already-existing result object receives one primitive boolean.
- New traversal: none; deletion removes the root-level import-hoist recursive walk. Property lookup keeps its existing reverse frame scan.
- New node/materialization: none.
- Render path: only the live typed `ImportAtRule` path remains. Ordinary declarations retain their existing importance sink; merged declarations save, clear, read, and restore the existing `mergeImportant` scalar for each member.
- Helper/API surface: decreases: `styleImport`, `emitHoistedImports`, `collectHoistedImports`, and `emitStyleImport` are deleted.
- Metadata mutations: none.
- Review-flagged diff tokens: none; the combined slice adds no allocation, traversal, map, clone, or error-control path.
- Hot-path cost contracts:
  ```json
  [{"id":"ast-merge-importance-signal","verdict":"accepted","costDelta":"neutral","why":"The already-admitted declaration-merge loop carries one importance bit on its existing emit context instead of allocating a per-member sink. It repairs the ordinary declaration contract for Important values reached through a variable; it makes no speed claim.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}},{"id":"ast-dead-style-import-deletion","verdict":"accepted","costDelta":"decrease","why":"No parser, test, public entry, or production caller constructs AST-v2 StyleImport. Removing its union members, root hoist prewalk, root branch, and emit helpers leaves the live typed ImportAtRule path intact while deleting an unreachable node vocabulary and serializer work.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}},{"id":"ast-property-accessor-importance-signal","verdict":"accepted","costDelta":"neutral","why":"The existing property-declaration lookup carries the source flag into the pre-existing ordinary/merge importance state. It adds no traversal, node, helper, map, or alternate value path and makes no speed claim.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}}]
  ```
- Evidence: static AST-v2 call-site search, direct AST tests for `ImportAtRule`, property-accessor ordinary and merged output, the core AST suite, and core build.
- Verdict: accepted deletion plus correctness repair; import realization remains a plugin-owned cutover.

- Earlier pass: private CSS direct-AST value, typed `@import`, non-import statement, `@layer`, and structured `@keyframes` block at-rule families; plus private Less direct-AST keyword and `VarRef` values for top-level and ruleset-local variable declarations and ordinary declarations.
- Architecture surface: `packages/css-parser/src/ast/grammar.ts` remains private: `packages/css-parser/src/index.ts`, `cst-css.ts`, and `grammar.ts` neither import nor export `cssAstGrammar`; `package.json` has no subpath targeting it and `tsdown.config.ts` has no entry for it. The sole current importer is `packages/css-parser/test/ast-grammar.test.ts`. No existing parse, eval, or render route reaches it.
- Less architecture surface: `packages/less-parser/src/ast/grammar.ts` is likewise private: no Less public entry, CST grammar, package subpath, or tsdown entry imports or exports `lessAstGrammar`; the focused AST test runs it directly. Its former `src/ast/parse.ts` test bridge is deleted.
- Separation/duplication: this extends parser-local Parseman construction with quoted, `url(...)`, generic function-call, typed `@import`, non-import statement at-rule, structured `@layer`, and structured `@keyframes` reductions using core node constructors only. CSS `@import` accepts grammar-built static quoted/`url(...)` targets and balanced CSS tail segments into `ImportAtRule`; it performs no resolution, source reparse, or fallback lowering. `@keyframes` has an explicit keyframe-selector grammar (`from`, `to`, or percent) and declaration-only rule bodies; it does not reuse a general CSS selector/ruleset path. `@layer` and keyframe block bodies admit comments and their valid child rule shape only; nested at-rules are deliberately outside this slice. It creates no host, action registry, bridge, conversion pass, public pilot, or fallback.
- Cumulative node weight: source AST nodes exist only for an explicit run of this development grammar; the current public CSS CST path creates none of them.
- New traversal: [loop/traversal] `complexSegments` and the keyframe selector-list reduction make one bounded pass over already-captured children of one grammar reduction. The value family uses only Parseman's already-captured child arrays. Neither path walks a source tree or runs in any live parse/render route.
- New node/materialization: [node construction] reductions call existing core constructors for the exact AST nodes they own. [materialized array/object] and [array spread/materialization] are the parser-owned child arrays and constructor argument list required to represent selector/value structure, reachable only from the private test seam. Quoted bodies are grammar segments, and URL/function arguments are passed through as constructed child values; no source text is split or reparsed.
- Render path: unchanged. `serialize` appears only in the focused proof; public render does not import this grammar.
- Helper/API surface: [array helper] filters are reduction-local type selection over Parseman's captured children. There is no exported helper or runtime callback surface.
- Metadata mutations: none.
- Review-flagged diff tokens: [loop/traversal], [array helper], [array spread/materialization], [node construction], [routine error control], and [materialized array/object] are all private grammar construction checks. The `Error` branches reject impossible malformed reduction children and are not routine parse control flow; recognition itself remains Parseman combinators.
- Hot-path cost contracts:
  ```json
  [{"id":"css-private-direct-ast-family","verdict":"accepted","privateReachability":{"productionImporters":0,"publicExports":0,"buildEntries":0,"coldConstructionOnly":true},"why":"Current static reachability is zero from CSS production source and artifacts: no public parse/CST/eval/render entry imports or exports cssAstGrammar, package.json has no subpath targeting it, and tsdown has no build entry. Its bounded child scans and allocations occur only when the focused development test directly runs CssAstDocument; no benchmark or runtime-speed claim is made."},{"id":"less-private-direct-ast-family","verdict":"accepted","privateReachability":{"productionImporters":0,"publicExports":0,"buildEntries":0,"coldConstructionOnly":true},"why":"Current static reachability is zero from Less production source and artifacts: no public parse/CST/eval/render entry imports or exports lessAstGrammar, package.json has no subpath targeting it, and tsdown has no build entry. Its bounded reductions and allocations occur only when the focused development test directly runs LessAstDocument; no benchmark or runtime-speed claim is made."}]
  ```
- Evidence: focused source-to-AST-to-serialize tests, CSS and Less package builds/tests, parser runtime boundary verification, and the private-reachability registry check.
- Verdict: accepted as an unreachable development construction slice; wiring a public parser root requires a new reachability and runtime cost review.

### Less direct variable facts

- Pass detail: private Less direct-AST keyword and `VarRef` values for top-level and ruleset-local variable declarations and ordinary declarations.
- Architecture surface: `packages/less-parser/src/ast/grammar.ts` remains private: `packages/less-parser/src/index.ts`, `cst.ts`, and `grammar.ts` neither import nor export `lessAstGrammar`; `package.json` has no subpath targeting it and `tsdown.config.ts` has no entry for it. The focused AST test is the only current importer.
- Separation/duplication: the Parseman reductions construct `Keyword`, `VarRef`, `VarDeclaration`, `Declaration`, and `Quoted` through core constructors. They do not introduce a host, action registry, bridge, compatibility parser, resolver, or source reparse. The existing closed `@import` fact subset remains private and unchanged; it is not a public import path and does no resolution.
- Cumulative node weight: source AST nodes exist only for an explicit test run of this development grammar; public Less CST parsing creates none of them.
- New traversal: the existing bounded ruleset-body child pass now admits already-constructed variable declaration children. It does not walk a source tree or run in a live parse/render route.
- New node/materialization: [node construction] parser reductions call core constructors for the exact AST values they own. [materialized array/object] is the existing parser-owned body list needed to represent a rule, reachable only from the private test seam.
- Render path: unchanged; the test calls the canonical AST serializer only after the private grammar has made the Root. No public renderer imports this grammar.
- Helper/API surface: `isValueNode` and `requireValueNode` are private reduction guards; no helper is exported and no callback surface is added.
- Metadata mutations: none.
- Review-flagged diff tokens: [node construction], [materialized array/object], and the `TypeError` branch reject impossible malformed reduction children rather than implementing ordinary parser control flow. Recognition remains Parseman combinators.
- Hot-path cost contracts:
  ```json
  [{"id":"less-private-direct-ast-family","verdict":"accepted","privateReachability":{"productionImporters":0,"publicExports":0,"buildEntries":0,"coldConstructionOnly":true},"why":"Static reachability is zero from Less production source and artifacts: no public parse/CST/eval/render entry imports or exports lessAstGrammar, package.json has no subpath targeting it, and tsdown has no build entry. Its bounded reductions and allocations occur only when the focused development test directly runs LessAstDocument; no benchmark or runtime-speed claim is made."}]
  ```
- Evidence: focused parse-to-AST-to-canonical-serialize test, Less package build, parser runtime boundary verification, and the private-reachability registry check.
- Verdict: accepted as an unreachable development construction slice; a public Less parser root needs a new reachability and runtime cost review.

### Declaration-merge importance propagation

- Prior pass: declaration-merge importance propagation.
- Architecture surface: `mergeFold` carries an importance signal through the existing AST evaluator; no parser, host, bridge, or compatibility surface changed.
- Separation/duplication: the merge path reuses the ordinary declaration importance contract rather than introducing a second value evaluator or render route.
- Cumulative node weight: none; the signal is one boolean on the existing emit context.
- New traversal: none.
- New node/materialization: none; the merge-only signal is one boolean on the existing emit context, preserving the ordinary declaration contract when a value reaches `Important` through a variable.
- Render path: merged declaration output remains direct string emission; the change only records the existing value-evaluation signal before writing the one merged line.
- Helper/API surface: none.
- Metadata mutations: none.
- Review-flagged diff tokens: none; the repair adds no allocation, traversal, map, clone, or error-control path.
- Hot-path cost contracts:
  ```json
  [{"id":"ast-merge-importance-signal","verdict":"accepted","costDelta":"neutral","why":"The already-admitted declaration-merge loop carries one importance bit on its existing emit context instead of allocating a per-member sink. It repairs the ordinary declaration contract for Important values reached through a variable; it makes no speed claim.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}}]
  ```
- Evidence: `packages/core/src/ast/__tests__/declaration-merge-direct-acceptance.test.ts` (including reset across a later merge group and ordinary declaration), the direct core AST suite, and the benchmark output oracle recorded above.
- Verdict: accepted correctness repair; no performance claim.
