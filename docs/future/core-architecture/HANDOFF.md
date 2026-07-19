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

## Context and plugin dispatch invariant

`Context` remains the canonical per-render coordination and state object. It
keeps options, diagnostics, caches, per-file state, eval/render frames, and the
installed plugin chain. Its import and parse methods are not duplicate
resolvers: `_getPath` dispatches active-plugin `expandImport`/`resolve`, then
resolver and locator plugins; `getTree` dispatches plugin `getSource` and
`safeParse`; `parseString` dispatches the selected parser plugin; `getModule`
dispatches the selected/lazily loaded module plugin.

AST cutover changes the document type carried through those same calls from
legacy `Rules` to canonical AST `Root` (or an explicit canonical document
result). It preserves Context diagnostics, cache, session, plugin ordering, and
visitor/lifecycle coordination. It does not introduce a separate loader,
resolver callback, or replacement dispatch topology.

Normalize the retained parser-plugin contract while doing so: today
`findParserPlugin` accepts either `parse` or `safeParse`, while `getTree`
requires `safeParse` and `parseString` requires `parse`. The AST result contract
must make that distinction explicit or adapt one form to the other through the
same Context dispatcher; it must not add a second parse path.

Candidates for removal are only:

- `Rules`-specific result types, caches, root assignment, and legacy-tree
  adaptation inside the retained Context methods;
- `StyleImport`/legacy `Rules` placement and evaluation behavior after a
  canonical AST consumer preserves its tested semantics through Context;
- a path proven to bypass the Context-to-plugin chain, such as the independent
  filesystem fallback in `packages/fns/src/util/file-resolution.ts`.

`Context.readBinary` and JSON decoding in `getModule` are current explicit
core byte/module capabilities after plugin resolution, not evidence that
`_getPath`, `getTree`, `resolveImportPath`, `parseString`, or `getModule` should
be deleted. Decide their long-term capability ownership deliberately.

## Direct-root cutover order

The parser work has one real composition gate: a leaf dialect grammar must be
able to macro-fuse imported, recognition-only shared syntax while retaining its
own local direct-constructor reductions. It must not serialize local builders,
relax direct-builder capture validation, or create a reusable builder artifact.
That leaf-only fusion now proves the first private CSS extraction: imported
recognition-only property/keyword terminals fuse into local direct AST
reductions with their token values intact. Continue in this dependency order:

1. Complete all four parser families (CSS, Less, SCSS, Jess) as direct AST v2
   `Root` parsers.
2. Update each plugin to consume its parser's `Root` while preserving the
   existing Context-to-plugin dispatch topology and plugin-specific semantics.
3. Update the Jess package integration/render route to use those AST-consuming
   plugins, then delete only legacy tree-specific realization such as
   `StyleImport` and any proven duplicate filesystem/module implementation.

`Context._getPath`, `getTree`, `resolveImportPath`, `parseString`, and module
loading are retained coordination/capability seams. In step 2, migrate only the
parser/document result path (`getTree`, `parseString`, plugin parse contracts,
and document caches) from legacy `Rules` to AST `Root`. Retain resolution and
raw-byte/JSON/module capabilities unchanged unless a later dedicated audit
decides their ownership; do not replace or delete the dispatch path while parser
closure is still in progress.

## Aggressive Cutting Self-Prosecution

- Latest pass: extend the private Less direct-AST value family with static
  dimensions, colors, URLs, simple calls, spaced values, and comma lists.
- Architecture surface: parser-local reductions call canonical AST constructors
  directly. Shared numeric terminals are macro-fused recognition only. There is
  no CST conversion, bridge, host, Context/plugin change, runtime scanner, or
  source reparse.
- Separation/duplication: numbers/units are shared byte-for-byte production CSS
  terminals and `noTrivia` preserves glued-unit semantics. Outer list separators
  capture authored comma/whitespace bytes. Calls reject separators the current
  AST cannot represent; static URLs use the production URL body grammar while
  explicitly rejecting direct-unimplemented dynamic `@` forms.
- Cumulative node weight: cold private AST values only; no public Less parser,
  evaluator, or renderer reaches this grammar.
- New traversal: none beyond completed-child reduction handling.
- New node/materialization: [node construction] creates exact Dimension, Color,
  Url, FunctionCall, SpacedValue, and List facts. [materialized array/object]
  is the parser-owned child/separator collection required by those facts.
- Render path: unchanged and unreachable from production.
- Helper/API surface: no public helper or parser operation added.
- Metadata mutations: none.
- Review-flagged diff tokens: [node construction] and [materialized array/object]
  are cold parser construction; [array helper] maps already-recognized fields to
  one AST value/list. [loop/traversal], [array spread/materialization], and
  [routine error control] are not added.
- Hot-path cost contracts:
  ```json
  [{"id":"less-private-direct-ast-family","verdict":"accepted","privateReachability":{"productionImporters":0,"publicExports":0,"buildEntries":0,"coldConstructionOnly":true},"why":"The static value family is macro-fused into the source-private Less grammar and is reachable only from focused tests."}]
  ```
- Evidence: production-terminal parity checks; focused AST/macro tests; strict
  type check; Less build; parser-boundary verifier; adversarial review.
- Verdict: accepted cold direct construction; dynamic/interpolation forms remain
  explicit parser work rather than fallback lowering.

- Latest pass: extend the private SCSS direct-AST grammar with static simple
  rules, declarations, dimensions, and exact CSS color literals.
- Architecture surface: parser-local reductions construct canonical Rule,
  Declaration, Dimension, and Color facts from shared recognition-only numeric
  leaves and local SCSS/CSS lexical terminals. No CST reuse, host, bridge,
  resolver, loader, Context/plugin integration, scanner, or reparse is added.
- Separation/duplication: numeric terminals come from the shared production CSS
  recognition artifact; the color terminal exactly admits only 3/4/6/8 hex
  digits with a negative hex lookahead. Interpolation, nested rules, compound
  values, `!default`, and importance remain rejected rather than flattened.
- Cumulative node weight: zero production importers; all construction is in
  focused source-private SCSS grammar tests.
- New traversal: [loop/traversal] only the cold parser-local completed-child
  pass needed to make the Root/Rule body; it does not walk runtime/source state.
- New node/materialization: [node construction] exact AST facts for recognized
  literals/rules only. [materialized array/object] is the required cold body
  list supplied to Root/Rule constructors.
- Render path: unchanged and unreachable from this private grammar.
- Helper/API surface: no public parser operation or plugin API added.
- Metadata mutations: none.
- Review-flagged diff tokens: [loop/traversal], [node construction], and
  [materialized array/object] are cold parser construction. [routine error
  control] rejects impossible completed reductions only. [array helper] and
  [array spread/materialization] are not added.
- Hot-path cost contracts:
  ```json
  [{"id":"scss-private-direct-ast-family","verdict":"accepted","privateReachability":{"productionImporters":0,"publicExports":0,"buildEntries":0,"coldConstructionOnly":true},"why":"The static SCSS rule/declaration family is source-private and has no public parser/eval/render importer."}]
  ```
- Evidence: exact 3/4/6/8-digit color matrix including 5/7-digit rejection;
  focused AST/macro tests; package build; parser-boundary verifier; adversarial
  review and re-review.
- Verdict: accepted cold direct construction; no production or speed claim.

- Latest pass: add shared CSS-production numeric/dimension recognition and use
  it in the source-private Jess direct-AST grammar.
- Architecture surface: the internal artifact carries macro-static number and
  unit terminals only. Jess directly constructs canonical `Dimension` facts;
  there is no CST reuse, host, bridge, resolver, loader, or Context/plugin
  integration.
- Separation/duplication: the terminals are byte-for-byte existing production
  CSS grammar facts, not a new CSS AST subset. Jess uses `noTrivia` around the
  number/unit pair, so units remain glued to their number and whitespace cannot
  be silently accepted.
- Cumulative node weight: zero production importers; `Dimension` construction
  occurs only in focused source-private Jess grammar tests.
- New traversal: none.
- New node/materialization: [node construction] one exact parser-local
  `Dimension` per successfully recognized literal. [materialized array/object]
  none beyond existing macro grammar structure.
- Render path: unchanged and unreachable from this private grammar.
- Helper/API surface: no exported parser operation or artifact API is added.
- Metadata mutations: none.
- Review-flagged diff tokens: [node construction] is cold parser-local AST
  construction. [loop/traversal], [array helper], [array
  spread/materialization], and [routine error control] are not added.
- Hot-path cost contracts:
  ```json
  [{"id":"jess-private-direct-ast-family","verdict":"accepted","privateReachability":{"productionImporters":0,"publicExports":0,"buildEntries":0,"coldConstructionOnly":true},"why":"The shared numeric terminal macro-fuses into the source-private Jess grammar; no public parser, evaluator, or renderer imports it."}]
  ```
- Evidence: byte-for-byte terminal comparison against production CSS grammar;
  exponent/bare/percent acceptance and whitespace/adjacent-expression rejection;
  macro-output proof, build, parser-boundary verifier, adversarial review.
- Verdict: accepted cold recognition de-duplication; no production or speed
  claim.

- Latest pass: extend the private Less direct-AST import fact with typed static
  options, quoted/static `url(...)` targets, and a grammar-proven static tail.
- Architecture surface: parser-local reductions construct `ImportAtRule`,
  `List`, `Url`, `Quoted`, and `Any` directly. The tail is assembled only from
  successful recursive grammar captures; there is no source slicing, reparse,
  resolver, loader, host, or bridge. `Context` remains the canonical
  eval/render and plugin-coordination state; this private parser does not
  alter that existing dispatch path.
- Separation/duplication: options and targets are explicit grammar facts.
  Recursive static tail structure rejects interpolation, malformed or mismatched
  delimiters, unclosed quotes, and extra closers before an `Any` is constructed.
  `noTrivia` preserves bytes inside a quoted tail fragment without changing
  whitespace ownership between import terms.
- Cumulative node weight: cold private AST nodes only; no public Less parse,
  eval, or render importer reaches this grammar.
- New traversal: [loop/traversal] recursive grammar recognition and the local
  child pass operate only on the completed reduction in focused tests; neither
  walks source/tree/runtime state.
- New node/materialization: [node construction] constructs exact typed import
  facts. [materialized array/object] is the parser-owned option/tail child
  collection required by those facts, cold behind the private test seam.
- Render path: unchanged and unreachable from production.
- Helper/API surface: no exported helper, plugin callback, or resolver added.
- Metadata mutations: none.
- Review-flagged diff tokens: [loop/traversal], [node construction], and
  [materialized array/object] are limited to cold parser-local construction.
  [array helper] maps grammar-produced static fragments/options into the exact
  `Any`/`List` constructor payloads and joins them once; it runs only in the
  private parse reduction. [routine error control] rejects impossible completed
  children only. [array spread/materialization] is not added.
- Hot-path cost contracts:
  ```json
  [{"id":"less-private-direct-ast-family","verdict":"accepted","privateReachability":{"productionImporters":0,"publicExports":0,"buildEntries":0,"coldConstructionOnly":true},"why":"The typed static import facts are macro-fused into the existing source-private Less grammar; only focused tests import it, so recursive tail construction has no production parser/eval/render reachability."}]
  ```
- Evidence: strict Less type check; focused AST/macro tests; package build;
  parser-boundary verifier; broad static-tail rejection matrix; two adversarial
  reviews plus the quoted-tail preservation re-review.
- Verdict: accepted cold typed-import construction; migrating the existing
  Context/plugin path to canonical AST results remains separate work.

- Latest pass: add a source-private Jess direct-AST construction starter for
  closed `$` variable declaration/reference facts.
- Architecture surface: focused tests macro-transform this source directly;
  it is excluded from Jess build entries and package exports. Reductions call
  canonical AST constructors with no CST reuse, bridge, host, resolver, loader,
  or runtime scanner.
- Separation/duplication: Jess owns its unescaped `$` name terminal. The closed
  starter deliberately rejects quoted backslashes and `$!name`, instead of
  constructing false escaped/semantic facts. Shared CSS keyword recognition is
  input-only and never overridden by the local reduction map.
- Cumulative node weight: zero production importers; source nodes exist only in
  focused direct-grammar proof.
- New traversal: [loop/traversal] the grammar-local Root-body pass walks only
  already-recognized declaration children in the cold test seam.
- New node/materialization: [node construction] reductions construct only the
  exact Root, VarDeclaration, VarRef, Keyword, and Quoted facts. [materialized
  array/object] is the required cold Root child list.
- Render path: unchanged and unreachable from this source-private grammar.
- Helper/API surface: no public helper, build entry, or operation is added.
- Metadata mutations: none.
- Review-flagged diff tokens: [loop/traversal], [node construction], and
  [materialized array/object] are cold parser-local construction. [routine
  error control] rejects impossible completed reductions only. [array helper]
  and [array spread/materialization] are not added.
- Hot-path cost contracts:
  ```json
  [{"id":"jess-private-direct-ast-family","verdict":"accepted","privateReachability":{"productionImporters":0,"publicExports":0,"buildEntries":0,"coldConstructionOnly":true},"why":"The Jess AST starter is source-private: it is absent from build entries and package exports and runs only in focused macro/AST tests."}]
  ```
- Evidence: focused direct AST/macro tests, explicit type check, clean package
  build with no `lib/ast` artifact, parser-boundary verifier, and adversarial
  review.
- Verdict: accepted private construction proof; no production behavior or
  performance claim.

- Latest pass: add a private, macro-compiled SCSS direct-AST construction
  starter for closed `$` variable declaration and reference facts.
- Architecture surface: the grammar directly calls canonical AST constructors
  and is emitted only as a non-exported private artifact for build proof. It
  has no public parser route, CST reuse, bridge, host, resolver, or loader.
- Separation/duplication: SCSS `$` names are parser-local exact unescaped
  grammar facts; shared CSS keyword values retain their existing escape syntax.
  Quoted chunks are parser-local so `#{…}` is rejected until typed interpolation
  segments exist. No source scanning, text reparse, or post-parse interpolation
  detection occurs.
- Cumulative node weight: source nodes exist only in focused direct-grammar
  tests; zero public parser/eval/render importers reach this grammar.
- New traversal: [loop/traversal] the existing grammar-local child pass builds
  one Root body from already-recognized variable declarations; it is cold and
  does not walk source or runtime state.
- New node/materialization: [node construction] reductions construct only
  Root, VarDeclaration, VarRef, Keyword, and Quoted nodes required by the
  recognized fact. [materialized array/object] is the required Root child list,
  cold behind the private test seam.
- Render path: unchanged and unreachable from this private grammar.
- Helper/API surface: no public helper or operation; direct reductions only.
- Metadata mutations: none.
- Review-flagged diff tokens: [loop/traversal], [node construction], and
  [materialized array/object] are limited to the cold parser-local reductions.
  [routine error control] only rejects impossible completed reduction children;
  it is not ordinary parse control flow. [array helper] and [array
  spread/materialization] are not added.
- Hot-path cost contracts:
  ```json
  [{"id":"scss-private-direct-ast-family","verdict":"accepted","privateReachability":{"productionImporters":0,"publicExports":0,"buildEntries":0,"coldConstructionOnly":true},"why":"The SCSS AST grammar is macro-compiled for build proof but is absent from exports and every public parser/eval/render entry. Its direct reductions run only in focused tests."}]
  ```
- Evidence: direct AST acceptance/rejection cases including unescaped `$` names,
  quoted interpolation rejection, macro-output proof, no-emit type check,
  package build, parser-boundary verifier, and two adversarial reviews.
- Verdict: accepted private construction proof; no production behavior or
  performance claim.

- Latest pass: move the private CSS direct-AST basic-selector terminal into
  the private shared recognition artifact and remove the stale external
  support-file reference from the private-grammar cost registry.
- Architecture surface: `CssAstSyntaxSimple` is a macro-static recognizer.
  `CssAstSimple` remains a parser-local direct constructor reduction. The
  fused grammar has no runtime artifact import or `composeLeaf` call. Typed
  import facts remain parser output; plugin code owns their resolution, loading,
  and caching when a production root exists.
- Separation/duplication: removes the byte-identical local CSS simple-selector
  regex. The artifact has no builders, callbacks, AST/CST values, resolver, or
  public export. It changes neither selector vocabulary nor plugin behavior.
- Cumulative node weight: none; the existing private reduction constructs the
  same `Simple` node from the same terminal value.
- New traversal: none.
- New node/materialization: none beyond the existing parser-local `Simple`
  construction in the cold direct-AST test seam.
- Render path: unchanged and unreachable from public CSS parse/render entries.
- Helper/API surface: decreases by one local recognizer; no public helper or
  bridge is added.
- Metadata mutations: none.
- Review-flagged diff tokens: [loop/traversal], [array helper], [array
  spread/materialization], [node construction], [routine error control], and
  [materialized array/object] are existing private direct-AST reduction code
  re-read because the grammar file changed; this slice adds none. Existing
  loops and allocations remain cold Parseman-child reduction work, and existing
  `Error` guards reject impossible completed reductions rather than control
  normal parsing. The local rules type now describes only local reductions,
  not imported terminals.
- Hot-path cost contracts:
  ```json
  [{"id":"css-private-direct-ast-family","verdict":"accepted","privateReachability":{"productionImporters":0,"publicExports":0,"buildEntries":0,"coldConstructionOnly":true},"why":"The selector terminal is macro-fused into the existing private CSS AST grammar. No public parser, evaluator, or renderer imports that grammar; no runtime composition or artifact import remains."}]
  ```
- Evidence: byte-identical terminal transfer; selector acceptance/rejection
  cases; macro-output proof; CSS type check, build, focused AST/CST tests,
  parser-boundary verifier; adversarial review.
- Verdict: accepted cold recognition de-duplication and registry cleanup; no
  performance claim.

- Latest pass: move the private Less direct-AST grammar's existing restricted
  identifier and quoted leaves to the private shared recognition artifact.
- Architecture surface: `lessAstGrammar` remains terminal/private/test-only;
  its direct constructors remain local. The shared artifact contains only
  macro-static terminals, no builder, callback, AST/CST, resolver, or export
  from a public package.
- Separation/duplication: removes four local Less lexical regex leaves without
  inheriting broader CSS terminals. `lessBareIdentifier` and unescaped quoted
  bodies are byte-for-byte the previous closed subset and are selected explicitly.
- Cumulative node weight: none; parser-local reductions construct the same
  canonical nodes from the same terminal values.
- New traversal: none.
- New node/materialization: none beyond existing parser reductions. The added
  `LessAstRules` type is compile-time only.
- Render path: unchanged and unreachable from production parse/render entries.
- Helper/API surface: no public helper; one private artifact subpath only.
- Metadata mutations: none.
- Review-flagged diff tokens: [materialized array/object] the type declaration
  is erased at build time; no runtime object, loop, map, clone, or error path
  is added.
- Hot-path cost contracts:
  ```json
  [{"id":"less-private-direct-ast-family","verdict":"accepted","privateReachability":{"productionImporters":0,"publicExports":0,"buildEntries":0,"coldConstructionOnly":true},"why":"The shared terminal artifact and the Less leaf grammar are macro-fused only in focused private AST tests; no public parser/eval/render entry reaches either direct AST reduction."}]
  ```
- Evidence: exact terminal acceptance/rejection matrix, Less AST/macro tests,
  internal artifact and Less builds, parser-boundary verifier, adversarial review.
- Verdict: accepted cold recognition de-duplication; no performance claim.

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
- Separation/duplication: deletes the duplicate AST import representation only; legacy `tree/StyleImport`, `Context`, `Rules`, plugin resolution, and import realization remain for the later direct dialect-Root plus Context-to-plugin canonical-AST cutover. The Context dispatcher and valid plugin hooks are retained and migrated; only proven duplicate core I/O or legacy-tree result adaptation is removed. The property accessor carries the source declaration's existing boolean through the existing ordinary sink or merged scalar; it adds neither inline bytes nor a second evaluator route.
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
