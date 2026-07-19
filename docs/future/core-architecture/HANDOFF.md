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

- Architecture surface: this pass deletes `composeStats`/`ComposeStats`, the bridge-only shadow eval/emit walker and public export; removes core's raw package resolver; and adds `@jesscss/css-parser/ast` as a closed direct AST-v2 pilot. Its Parseman reductions create plain `Root`, `Rule`, selector, `Comment`, `Declaration`, and a typed `@charset` `AtRuleStatement` directly; it imports neither a parse host nor any legacy builder or bridge.
- Separation/duplication: the pilot is deliberately outside `cssGrammar` and all dialect composition. It proves the direct construction contract without preserving a callback ABI or changing the existing functional path. Its keyword and quoted types are extracted from the AST leaf's `ValueNode`, never same-named evaluator results. The at-rule slice admits only lowercase `@charset` with an unescaped double-quoted `[A-Za-z0-9._-]+` encoding; generic, raw-prelude, interpolated, escaped, single-quoted, mixed-case, and block at-rules remain rejected. `Context` now sequences plugin resolution only; its `createRequire` bare-module fallback was deleted rather than moved behind core plumbing.
- Cumulative node weight: the new path creates only canonical child arrays required by its selected subset; it adds no side map, wrapper, legacy node, or metadata mutation.
- New traversal: none. The typed grammar reduction is the Root contract; parse failure returns `document: null` and a diagnostic, while successful rendering uses the AST serializer with no bridge conversion. The deleted `composeStats` was a second frame/mixin/selector walk and no replacement exists.
- New node/materialization: cold, opt-in parser output only. Existing benchmark/render paths do not instantiate the pilot grammar.
- Render path: no existing render branch changed; the focused test renders the direct root through the AST serializer.
- Helper/API surface: one public subpath operation, `parse`; no migration-named alias, `parseCssFn` alias, `FunctionalParseHost`, `BuilderHost`, action map, or compatibility facade is retained. `composeStats`/`ComposeStats`, their bridge-only harness hooks, and Context's `looksBareSpecifier`/`tryResolveModule` helpers are deleted.
- Metadata mutations: none.
- Latest micro-cut: `bindArgs` reads the existing `named` map directly; the redundant `filledByName` Set and its preparatory loop are deleted. The focused binding test covers named/default/rest placement and duplicate named last-wins behavior.
- Review-flagged diff tokens: `[loop/traversal]` is a single cold pass over each direct grammar result to validate and collect its canonical statement children; `[array helper]` constructs those arrays only after every grammar-fixed child validates, so malformed Parseman output throws instead of being dropped; `[materialized array/object]` is the cold child-token narrowing helper plus the required direct `Quoted` and `AtRuleStatement` payloads; `[node construction]` and `[routine error control]` are impossible-after-grammar errors at the untyped Parseman capture boundary, never recovery or fallback parsing. No existing benchmark path gains either allocation or branch.
- Hot-path cost contracts:
```json
[
  {"id":"css-direct-ast-public-entry","verdict":"accepted","costDelta":"neutral","why":"The public result shaper is opt-in and not on the benchmark render route.","dangerTokensJustification":"The failure array is cold diagnostic data; the success result is the public API shape, and neither changes the existing parser or renderer.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}},
  {"id":"css-direct-ast-closed-grammar","verdict":"accepted","costDelta":"neutral","why":"The selected grammar is isolated from cssGrammar and all dialect composition.","dangerTokensJustification":"The statement arrays are canonical direct AST children and are built only after each grammar-fixed child validates; malformed Parseman output throws rather than being discarded. The direct @charset Quoted and AtRuleStatement literals are selected AST ownership, not a raw prelude. The token/type guards do not scan, recover, bridge, or fall back for explicit pilot callers; benchmark parsing does not enter this grammar.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}},
  {"id":"ast-compose-stats-shadow-walker-deletion","verdict":"accepted","costDelta":"decrease","why":"Deleted the bridge-only shadow eval and selector traversal; serialize(root) remains unchanged and no instrumentation replaces it.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}},
  {"id":"ast-compose-stats-public-export-deletion","verdict":"accepted","costDelta":"decrease","why":"Removed the bridge-only public export with no replacement branch, allocation, lookup, traversal, or API surface.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}},
  {"id":"import-atrule-terminal-emit","verdict":"accepted","costDelta":"neutral","why":"The unchanged cold typed-import terminal branch does no resolution, reparse, collection, or child walk.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}},
  {"id":"opaque-atrule-block-terminal-emit","verdict":"accepted","costDelta":"neutral","why":"The unchanged opaque at-rule terminal writer writes scalar bytes without child collection or recursive evaluation.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}},
  {"id":"context-plugin-only-module-resolution","verdict":"accepted","costDelta":"decrease","why":"Deleted core's raw bare-module candidate/probe fallback; plugin Context resolution remains the only capability path.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}},
  {"id":"mixin-bindargs-redundant-named-set-deletion","verdict":"accepted","costDelta":"decrease","why":"Deleted a redundant named-parameter Set plus its fixed-parameter prepass; bindArgs queries its existing named Map directly with no new helper, traversal, or materialization.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}}
]
```
- Evidence: direct construction + render test, full CSS parser suite, CSS build, parser-boundary verification, package-export verification, Context/plugin module-resolution tests, and `git diff --check` pass. Full cross-dialect macro gate remains baseline-red in Less/SCSS/Jess because their pre-existing compose inputs are not build-resolvable.
- Verdict: accepted.

- CSS direct-AST declaration expansion.
- Review-flagged diff tokens: `[loop/traversal]`, `[materialized array/object]`, `[node construction]`, and `[routine error control]` are cold Parseman-boundary validation for the opt-in closed grammar. Every selected child is validated; malformed output throws, never becomes a partial AST. This is neither scanner recovery, bridge conversion, nor fallback parsing.
- Hot-path cost contracts:
```json
[
  {"id":"css-direct-ast-closed-grammar","verdict":"accepted","costDelta":"neutral","why":"The selected direct grammar remains isolated from cssGrammar and all dialect composition.","dangerTokensJustification":"Statement arrays are canonical direct AST children only after every grammar-fixed child validates; malformed Parseman output throws and benchmark parsing never enters this grammar.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}}
]
```
- Verdict: accepted.

- Latest pass: closed direct Less AST-v2 plain-import fact pilot.
- Architecture surface: Parseman reductions in `less-parser` construct canonical `Root → ImportAtRule → AstQuoted` literals directly; `AstQuoted` explicitly names the parser-produced AST literal rather than the evaluator-result value type. Core owns neither parser construction nor import resolution.
- Separation/duplication: the pilot imports no parse-host, bridge, legacy builder, `StyleImport`, resolver, file API, or parser re-entry. It is not composed into `lessGrammar` or `LessParser`.
- Cumulative node weight: cold opt-in parse result only; the grammar creates the canonical ImportAtRule fact and no side state, wrapper, legacy node, or metadata mutation.
- New traversal: one cold grammar-output validation loop copies the fixed direct import statements into Root's mutable canonical body. It runs only for explicit `@jesscss/less-parser/ast` calls because Parseman's public runner returns `unknown`; it rejects a broken grammar callback rather than asserting unknown across the public parser boundary.
- New node/materialization: canonical Root child array and literal nodes only for the explicit closed pilot; existing Less parsing and rendering do not instantiate them.
- Render path: untouched; this slice does not serialize, evaluate, load, resolve, or inline imports.
- Helper/API surface: the published `@jesscss/less-parser/ast` subpath exposes one stable `parse` operation and grammar; `AstQuoted` is type-only. The three internal child validators are a typed Parseman-boundary proof, not a resolver, scanner, host, compatibility facade, or reusable dispatch layer.
- Metadata mutations: none.
- Review-flagged diff tokens: `[loop/traversal]` copies and validates only the fixed direct-import child sequence for explicit pilot calls; `[routine error control]` and `[node construction]` create TypeError only when Parseman's own grammar callback violates its fixed child contract, replacing the rejected unsound cast at the public boundary; `[array helper]` joins Parseman's cold expected-token diagnostics only on failure; `[materialized array/object]` is confined to cold canonical AST/result/diagnostic data. No existing hot parser path receives any of them.
- Hot-path cost contracts:
```json
[
  {"id":"less-direct-import-ast-entry","verdict":"accepted","costDelta":"neutral","why":"The result shaper is an isolated opt-in direct parser pilot.","dangerTokensJustification":"Result and error arrays are cold API data, outside the existing parser route.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}},
  {"id":"less-direct-import-ast-grammar","verdict":"accepted","costDelta":"neutral","why":"Grammar reductions construct only the canonical plain-import fact and are not composed into lessGrammar.","dangerTokensJustification":"Literal AST objects are allocated only by explicit pilot callers; no resolver, reparse, or bridge is added.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}},
  {"id":"ast-quoted-literal-type-export","verdict":"accepted","costDelta":"neutral","why":"AstQuoted disambiguates the type-only canonical AST literal from the evaluator result without emitted runtime work.","dangerTokensJustification":"The direct Less pilot alone owns the flagged Root/result objects and child-array copy; AstQuoted is erased type metadata and adds no core runtime work.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}},
  {"id":"css-direct-ast-closed-grammar","verdict":"accepted","costDelta":"neutral","why":"The selected direct grammar remains isolated from cssGrammar and all dialect composition.","dangerTokensJustification":"Statement arrays are canonical direct AST children only after every grammar-fixed child validates; malformed Parseman output throws and benchmark parsing never enters this grammar.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}}
]
```
- Evidence: `pnpm --filter @jesscss/less-parser test -- --run test/direct-ast.test.ts` (2/2), `pnpm --filter @jesscss/core build`, `pnpm --filter @jesscss/less-parser verify:ast-export` (fresh built artifact smoke), parser-boundary scan, aggressive-cutting staged review, and `git diff --check` pass.
- Verdict: accepted.
