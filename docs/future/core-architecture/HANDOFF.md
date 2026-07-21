# Core Architecture Handoff

> **Architecture correction — supersedes every prior “private direct-AST grammar”,
> “development-only AST seam”, or “wire it later” claim in this document and
> linked future plans. Those claims were wrong/hallucinated migration staging,
> not an approved architecture. AST v2 and the deletion work are the public
> architecture: each dialect package's primary `parse()` operation must run
> Parseman reductions directly to canonical `Stylesheet`. CST APIs remain only for
> explicit language-service/document use; no CST-to-AST bridge, host, or
> compatibility route is an acceptable interim production design.

## Current target

Keep AST v2 as the canonical public representation. Parseman grammar reductions
create exact `Stylesheet` data directly through each dialect's public `parse()`
operation; core has no parser construction host, action registry, bridge,
source reparse, or compatibility path.

### Active delivery order

The immediate delivery target is a feature-complete **Less alpha** on that
public architecture. Do not spend the active implementation capacity on new
SCSS or Jess syntax/evaluator slices while the public Less route still lacks
required execution semantics. The other direct parsers remain canonical work,
but Less import execution, evaluator wiring, retained Context/plugin dispatch,
and corpus parity come first; resume the remaining dialect integration only
after those Less-alpha gates are genuinely green.

### Less corpus truthfulness gate

`packages/jess/test/less/all-less.test.ts` currently contains 32 runnable
expected-failure markers. They are **not** approved alpha exclusions: the test
passes when the named fixture fails, so they mask compatibility gaps until they
are removed. The exact, maintained inventory and ranked remediation order are
in [`../../less-v5-alpha-readiness.md`](../../less-v5-alpha-readiness.md).
The five bounded groups are: callable/reference and scope semantics (9);
imports/conditional at-rule execution (6); direct parser/evaluator correctness
(7); URL options (6); and source-map artifacts (4). These add to the test
map's distinct-path count of 32. No expected-failure marker may be described
as out of alpha without an explicit owner decision and release-note policy.
In particular, a missing mixin remains an error; only an ordinary function call
with an optional function reference may fall back to a CSS `Call` when the
lookup misses.

## Active orchestrator goal

Drive the public AST-v2 cutover, Less alpha readiness, Parseman release,
performance recovery, and Jess alpha preparation to verified completion. This
section is the authoritative full-scope companion to the compact task goal.

- All public CSS, Less, SCSS, and Jess `parse()` routes must reduce Parseman
  grammar directly to canonical AST-v2 `Stylesheet`; `Reference` is the typed,
  recursive public reference chain. No bridge, builder/parse host, action
  registry, source reparse, scanner/regex recognizer, compatibility parser, or
  fallback/shim may return.
- Less is the immediate feature-completeness priority. Close real parser,
  evaluator, import, plugin, and corpus gaps through the public route; prove
  the first external prerelease as exactly `less@5.0.0-alpha.1`, including
  built-artifact `lessc` and clean packed-install tests.
- Context remains the one render/session/cache/diagnostic/plugin/import
  coordinator. Retain its plugin-based source, parser, module, path, and
  import dispatch topology while changing carried documents to `Stylesheet`;
  do not replace it with a second loader or resolver.
- Finish public Jess syntax integration through `jess-parser` and
  `plugin-jess`. CSS is a Context-parsed/inlined document route, not a Jess CSS
  compiler merely because a CSS plugin exists. Delete only machinery proven
  unreachable after direct-route coverage; do not manufacture deletion work.
- Prepare and release compatible Parseman `0.28` from its release branch only
  after review, tests, public docs/changelog, and coverage/trace API proof.
  Normal compiler/plugin/CLI parses never enable coverage or trace. Replace
  local Parseman links only with that published version and prove clean install.
- Treat current direct-Less parsing performance as a release concern. Establish
  reproducible generated-bundle/hash baselines and investigate AST allocation,
  grammar choice/backtracking, metadata/trivia/provenance, emitted
  `composeLeaf()` shape, and historical feature equivalence independently.
  Optimize only with semantic/output proof and matched parse plus end-to-end
  measurements; never restore legacy architecture for speed.
- Prepare `jess@2.0.0-alpha.9`: identify its actual publishable runtime closure
  (including the correct CSS and Jess plugin roles), remove runtime `link:` and
  unnecessary internal dependencies, build and pack the candidate, and run
  parser/plugin/Compiler/rollup, Less-alpha, package/API, cutting-review,
  `lessc`, and clean-consumer gates. Validate final `dev`, prepare
  owner-reviewed release notes, then squash-merge it onto `alpha` for the
  release cut; do not ordinary-merge/rebase shared alpha history or publish
  before every gate passes.

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

## Deferred delimiter-container decision

`Paren` is currently the AST-v2 value wrapper for ordinary grouping and Less
`~(...)`.  It is deliberately transparent to typed evaluation, participates in
Less math-mode evaluation, and is rendered differently in ordinary values than
in grammar-owned media/container/supports preludes.  Do not rename it or add a
standalone `Bracket` node as incidental parser work.

The legacy tree already proves the missing delimiter fact: its `Paren` carries
`delimiter: 'paren' | 'square'`, and Sass list functions preserve/read that
metadata for `is-bracketed`, `append`, `join`, and `set-nth`.  AST v2 currently
does not retain it.  The owner is considering a future AST-v2
`Block { delimiter: 'paren' | 'square'; inner: ValueNode; escaped?: true }`
as the one delimiter-preserving value wrapper.  This is a *path-scoped future
design*: `@jesscss/core/ast` may use `Block`, but `@jesscss/core` already exports
the legacy tree `Block` for curly/square opaque blocks, so the AST-v2 symbol must
not be re-exported from the root or silently collide with it.

No cutover is approved.  Until an explicit owner decision, retain AST-v2
`Paren`; keep CSS grid-line brackets out of a new ad-hoc node; and do not add a
compatibility alias/bridge.  A future atomic cutover must update all AST-v2
parser factories, evaluator/serializer context switches, AST tests and public
subpath exports together.  It must preserve existing parenthesized math,
escaped Less emission, and grammar-owned query parentheses, while adding square
delimiter semantics for Sass lists.  Curly statement/ruleset bodies remain
outside this `ValueNode` design.

## Completion gates

Run focused parser/core tests first. Run the parser-runtime boundary verifier
when recognition changes. For eval/render/lookup/traversal/copying changes, run
`pnpm run verify:aggressive-cutting-review` before commit. Final integration
requires fresh builds, core tests, the Jess production spine ratchet, and the
Less corpus.

### Current Less-alpha gate status (2026-07-20)

The public Less route now reaches canonical AST-v2 evaluation and serialization
for direct, non-import documents: the Less plugin calls the public direct parser,
Context carries its `Stylesheet`, its parser/source identity, the typed builtin
evaluator, and resolved dialect options; Jess serializes that document without a
tree bridge or copied execution-option bag. The public proof covers variables, a mixin call,
arithmetic, and `percentage()`. This does **not** yet mean general Less
evaluation is complete: IO capability and an explicit AST-safe plugin lifecycle
remain unwired. `public-api-contract.test.ts` is green. The Less test harness loads the
macro-compiled public parser artifact, not Parseman grammar source, and the
Less-alpha command builds that parser/plugin pair before running integration
tests.

The preserved slash-group path is also public-route green: direct Less grammar
uses a typed `Keyword('/')` separator fact, and AST evaluation retains that fact
as opaque through a later operation in `parens-division` mode (`10px / 2 * 2`,
not a synthetic `calc(...)`). `tests-unit/operations/operations-advanced.less`
passes through the macro-compiled parser → plugin → Context → AST renderer path.

Direct media-query comments now parse as typed output-bearing query values rather
than being swallowed as document trivia or rejected. The focused parser proof is
green. Static root CSS-terminal imports now also use the canonical renderer's
bounded document-prelude rule: first identical import wins and emits ahead of
ordinary rules; Context-loaded stylesheet imports remain source-ordered. The
upstream `at-rules-keyword-comments` fixture is green.

The CSS-grid fixture now passes through the public direct grammar and AST
renderer, including bracketed grid-line atoms and multiline values. The
canonical `SpacedValue` retains grammar-owned separator runs only when they
contain a line break; ordinary inline spacing remains canonical. Existing
`Declaration.valueOnNewLine` records the colon-to-value layout. This is a
general value shape, not a grid-specific raw-value fallback. The upstream
`whitespace` fixture passes through the same shape.

The generic direct at-rule grammar represents `@namespace foo
url(http://...)` as `AtRuleStatement(SpacedValue(Keyword, Url))`, a parenthesized
generic-header group as `Paren`, and Less's historical
`url-prefix(""github.com"")` spelling as an opaque, grammar-owned generic
function argument. None uses a raw-prelude fallback. The
public CSS-3 fixture is byte-identical through the macro-compiled Less parser,
plugin, Context, and AST renderer.

The first root-only import slice now routes typed Less `ImportAtRule` facts
directly through the active Context. Context registers parser/source identity
when each `Stylesheet` enters the session, restores that document's existing
plugin/file scope while it emits, and uses its retained `getTree` dispatcher for
every loaded document. It proves relative/include-path dispatch, recursive
source identity, and that a loaded AST declaration joins the existing frame's
scoped and live lookup state.
`path-resolution.test.ts` is green. This is not the import end state: nested
import placement, CSS/remote/option behavior, once/multiple/reference/optional/
inline semantics, and media-tail wrapping remain real Less-alpha work. Do not
restore the legacy tree importer or pre-load/splice documents outside ordered
render execution.

The immediate Less-alpha task remains the import portion of step 2: retain the
Context-to-plugin result/cache dispatcher while completing its canonical
`Stylesheet` contract and AST import execution. It must not restore the legacy
parser, bridge AST into a tree, or introduce a second resolver/parser path.
Only then may corpus feature failures be ranked.

## Context and plugin dispatch invariant

`Context` remains the canonical per-render coordination and state object. It
keeps options, diagnostics, caches, per-file state, eval/render frames, and the
installed plugin chain. Its import and parse methods are not duplicate
resolvers: `_getPath` dispatches active-plugin `expandImport`/`resolve`, then
resolver and locator plugins; `getTree` dispatches plugin `getSource` and
`safeParse`; `parseString` dispatches the selected parser plugin; `getModule`
dispatches the selected/lazily loaded module plugin.

AST cutover changes the document type carried through those same calls from
legacy `Rules` to canonical AST `Stylesheet` (or an explicit canonical document
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
That leaf-only fusion proves that imported recognition-only property/keyword
terminals fuse into local direct AST reductions with their token values intact.
It is incomplete public-parser implementation, not a private architecture or
completion claim. Continue in this dependency order:

1. Complete all four parser families (CSS, Less, SCSS, Jess) as direct AST v2
   `Stylesheet` parsers.
2. Update each plugin to consume its parser's `Stylesheet` while preserving the
   existing Context-to-plugin dispatch topology and plugin-specific semantics.
3. Update the Jess package integration/render route to use those AST-consuming
   plugins, then delete only legacy tree-specific realization such as
   `StyleImport` and any proven duplicate filesystem/module implementation.

### Canonical loop model

The public AST-v2 `For` contract is defined by the documented Jess
`$for (… of …)` syntax—not by Less `each()`. It is a flexible iteration protocol
in the spirit of JavaScript `for…of`: the source kind (list, collection/map,
range, or a later iterable value) determines the useful entry shape presented to
the authored binding pattern. Its bindings, source-dependent iterable behavior,
and source-order semantics must be named and shaped as Jess concepts. In
particular, do not preserve `valueName`, `keyName`, or `indexName` as the public
canonical node vocabulary merely because legacy Less `each()` used them.

Less `each()` is a compatibility input dialect. The Less parser lowers it into
compatible Jess-shaped loop helpers/patterns at its own boundary; it does not
make Less callback/key/index fields a core AST API. A general `For` rewrite must
preserve the public Jess header contract: `[$key, $value]` means key/value in
that order; the source kind supplies the entry shape. The current legacy tree
instead fills tuple slots positionally as value, key, counter for both comma and
bracket forms. That is a legacy implementation discrepancy to repair during the
general `For` rewrite, not an ambiguity in the public language and not a reason
to expose Less callback/key/index fields. Pin the remaining source-specific
entry shapes against public examples before direct Jess and SCSS parser tests.
Do not mis-lower SCSS tuple bindings to Less map-key/list-index roles while that
work is in progress.

`Context._getPath`, `getTree`, `resolveImportPath`, `parseString`, and module
loading are retained coordination/capability seams. In step 2, migrate only the
parser/document result path (`getTree`, `parseString`, plugin parse contracts,
and document caches) from legacy `Rules` to AST `Stylesheet`. Retain resolution and
raw-byte/JSON/module capabilities unchanged unless a later dedicated audit
decides their ownership; do not replace or delete the dispatch path while parser
closure is still in progress.

## Current parser-closure status

All four dialect packages now expose their stable public `parse()` operation as
a direct Parseman-to-`Stylesheet` route; explicitly named CST/document APIs remain
for language-service consumers. The direct grammars are still incomplete, and
the SCSS plugin still reports `parse/unavailable`; therefore no dialect has
completed feature-complete parser closure, no plugin/Context migration has
begun, and no parser/eval/render benchmark may be claimed. The reductions below
are incomplete implementation toward that public route, not a second
architecture or a completion milestone.

- CSS public `parse()` directly returns `Stylesheet`. The current verified
  closure includes structured selectors and selector-to-block comment trivia,
  declaration-component comments and `!important` trivia, shared exponent
  numbers, `calc()` modulo, balanced query
  functions, conditional blocks, `@page`/margin boxes,
  `@font-feature-values`, typed static `@supports` conditions, generic opaque blocks, `@document`, nested `@scope`,
  and top-versus-nested known-block bodies. The direct public route is checked
  against the existing positive and error CSS fixture corpus. Literal CSS `@import` is now a
  top-level-only `AtRuleStatement`, never an import-resolution fact. Structured
  declaration values now carry scoped function and `var()` fallback components,
  including balanced nested component blocks; malformed or crossed delimiters
  remain rejected by grammar. Valid block comments between `url` and its opening
  delimiter lower to the existing `Url`; malformed URL payloads remain strict.
  This is a bounded value/import slice, not CSS
  feature completion: selector/value closure and corpus differential remain.
- SCSS public `parse()` directly returns `Stylesheet`. Its verified direct
  slices include static selector/comment/conditional structure, ordinary
  structural interpolated simple selectors, structural
  interpolation, complex selectors with typed combinators, static
  attributes/placeholders, selector-valued pseudo arguments, and bounded static
  non-selector pseudo arguments, interpolated
  declaration names, declaration merge modifiers, exact static `@extend`, descriptor-only `@font-face`,
  `@counter-style`, `@property` (including a typed `--custom-property` header),
  static root/nested CSS `@starting-style` and `@layer` blocks with grammar-owned
  static headers,
  root-only static CSS `@charset`, `@namespace`, and `@layer` statements through
  the existing `AtRuleStatement` fact (with Sass `//` comments remaining
  non-emitting trivia),
  static CSS `@scope` blocks through the existing `AtRuleBlock` fact, including
  their existing root, conditional, and declaration-capable nested placements,
  finite CSS `@page` plus margin-box blocks with static headers and
  declaration/comment-only bodies,
  finite `@font-feature-values` blocks with grammar-owned static `Any` headers,
  finite feature sub-blocks, and declaration/comment-only descriptor bodies,
  static CSS `@document`/`@-moz-document` blocks with recursive frame-one bodies,
  quoted/URL `@import` targets (including structural `#{…}` segments within
  quoted targets, quoted `url(...)` targets, and empty `url()` targets), static option lists, a
  bounded typed CSS-emitting `layer`-then-declaration-`supports(...)`-then-
  static media-query tail, an optional
  final variable-declaration semicolon, and unquoted interpolated
  declaration URLs as existing `Url(Interpolation)` facts; unquoted interpolated
  import URLs remain explicitly rejected. It also includes static `@for` endpoints with grammar-owned
  arithmetic,
  static custom-property tokens in typed value positions as existing `Keyword`
  facts (without changing Sass custom-property declaration semantics),
  typed static `@supports` conditions, and static CSS keyframes (including vendor headers, quoted escaped static
  names, typed selector lists, and conditional placement). The additional `@if`
  slice admits literal booleans plus static typed comparisons (`==`, `!=`,
  `>=`, `<=`, `>`, `<`) and grouped boolean structure, including its existing
  reachability inside mixin, `@each`, and `@for` bodies. Its selected bodies
  retain existing variable declarations, mixin definitions/calls, `@each`, and
  `@for` statements in authored order; a selected mixin is available to a later
  sibling through the shared source-order `If` publication model. This does not
  claim Sass bare truthiness, function predicates, comma/list conditions, or
  full Sass scope semantics.
  `@extend !optional` remains rejected until its diagnostic
  semantics have a typed AST field. SCSS media/container
  range queries need ownership redesign rather than flattening into
  `SpacedValue`; `SpacedValue` itself remains an existing undecided
  representation. Static SCSS module directives are a top-level document-prefix
  grammar and use parser-owned classification of unescaped literal paths:
  `@use "sass:name"` rewrites to `ModuleImport` / `@-use
  "#sass/name"`; clear script-module paths (including JSON) become
  `ModuleImport`; stylesheet paths become `StyleImport` / `@-compose`; and
  `@forward` is the existing `StyleImport` with `forward: true`, rendered as
  `@-export`. This is construction only: retained Context/plugin coordination
  still resolves, loads, caches, and evaluates the resulting import facts.
  Escaped or dynamic targets, plus `with`, `show`/`hide`, or prefix
  configuration, remain rejected until their typed/decoded representation exists.
- Less public `parse()` directly returns `Stylesheet`, including its direct
  static mixin subset with literal-pattern/rest parameters, named arguments,
  typed logical guards, corresponding ruleset guards, and typed indirect
  variable (`@@name`) references. Its verified current closure also admits
  escaped ordinary declaration/property identifiers, ordinary `PropertyReference`
  and the current internal `MapAccessor` values
  (pending the owner-reviewed public access-node rename), non-emitting `//` line comments, full
  direct statement bodies in detached-ruleset and `each()` forms (including
  existing typed keyframes and flat static mixin-call iterables/bindings), and
  inline `:extend(...)` rules with the same canonical statement body as an
  ordinary ruleset while retaining authored `ExtendInstruction` placement,
  `*[selector-list]` capture delimiters around its explicit static
  selector-list family (checked against ordinary selectors for that static
  subset; dynamic selector content is rejected only in capture),
  properties, a terminal declaration without a final semicolon, typed static
  `@supports` conditions, static CSS keyframes, lone typed interpolation
  preludes for `@media`, `@supports`, and `@keyframes`, and exact opaque
  UnicodeRange value/list leaves that remain outside arithmetic. Unquoted dynamic URL
  values and Less `@import url(...)` targets retain existing `Url(Interpolation)`
  facts. A lone `@{…}` import tail is likewise a typed `Interpolation`; mixed static/
  dynamic tails remain rejected until their segment model exists. Parser
  construction does not resolve any import fact. Generic at-rule headers
  remain static-only. Those are grammar-owned AST
  construction slices; named CSS colors and `transparent` lower through shared
  recognition to existing typed `Color` values while ordinary identifiers and
  `currentColor` remain non-color keywords. Less
  grammar/evaluation parity remains incomplete.
- Jess public `parse()` directly returns `Stylesheet`, including static
  selectors, semantic `$[…]` selector templates, documented `$for`
  list/range/key-value collection bindings, static unresolved typed
  `StyleImport`/`ModuleImport` facts for documented `@-` imports, and static
  first-class `Apply` facts for documented static ruleset-only selector lists.
  Documented `$ >` named mixin
  arguments lower directly to existing `CallArg { name, value }` facts; they do
  not add a dialect-local call node or binding path. Documented zero-argument
  variable-held callable statements lower directly to existing `VariableCall`
  facts; argument-bearing variable calls remain held until their typed
  argument/binding model exists. CSS `url()` values
  and documented `$[…]` declaration names lower structurally through existing
  `Url` and `Declaration.name: Interpolation` facts rather than raw source text,
  (including structured `$[…]` path segments in ordinary values and CSS
  `@import` targets) as canonical `Url` nodes, typed static `@supports` conditions, media/container
  range-query facts, `@property --name` descriptor blocks, static CSS keyframes,
  and modern CSS slash-separated function components. Existing variable-led
  call expressions remain available within those components; the slash itself
  is not bare Jess arithmetic. The documented lone `@media $(name) { ... }`
  form is a typed interpolation prelude and remains block-only; it does not
  widen generic headers or `@container`.
  Static CSS at-rules are
  carried directly by the existing canonical
  at-rule facts, including terminal static generic CSS opaque blocks through a
  shared recognition-only Parseman artifact. Jess collection literals lower to the canonical
  `DetachedRuleset`, not a CST-shaped map or opaque source fallback. Dynamic
  `$apply` targets remain rejected until `Apply` has a typed dynamic-selector
  model; static `$apply` constructs one `Apply` fact at root, rule, selected
  `$if`, mixin-definition, and `$for` body positions. `Apply` is a core
  ruleset-only, whole-selector, merge-all operation; it is not a dialect render
  policy or an ordinary `MixinCall`. R3 now
  gives `$` live/current and `$$` scoped/final references explicit
  AST lookup facts; normal declarations write both stores, while `?:` and `:=`
  retain their selected lookup/write behavior. `$[$name]` is a live/live
  dynamic variable reference; Less `@@name` remains scoped/scoped. Selected
  `$if` branch declarations now enter both stores only after branch selection;
  they are not globally precollected. Selected `$if` branch mixin definitions
  publish only when the normal source-order walker reaches their definition;
  false-arm definitions stay invisible and publication is activation-local.
  Direct `$if` conditions also carry the existing strict `not`/`and`/`or` guard
  tree, including both adjacent and spaced comparisons; mixin-only guard forms
  remain excluded. Existing direct `MixinCall`, `VariableCall`, `$apply`, and
  `$for` statements execute through the ordinary selected-body walker; imports
  remain held until their ordered plugin/Context model work lands. The remaining
  documented Jess direct-route blockers are canonical AST/evaluator model work,
  not parser-host, Context, or import-resolution work: `$while` has no canonical
  AST/evaluation model; member/dynamic references and module calls need the
  owner-reviewed access/call model; and
  `@-compose` modifiers/configuration plus anonymous mixin/function forms need
  typed source-fact/callable models. Do not paper over any of those forms with
  raw source, a legacy tree, or a parser-side resolver. Do not migrate
  plugins, Context results, or Jess rendering until all four dialects have
  complete public direct-`Stylesheet` parsers.

For the approved parser-only slices above: new node materialization is only
parser-owned canonical AST construction; no eval/render traversal, resolver,
loader, bridge, or new runtime parse path was added. Verification proves
grammar parity and construction only, never speed.

### Audited model gates before further direct-parser admission

These are real AST/evaluator requirements discovered from the current public
grammars. They are not permission to add a raw fallback, a parser-side resolver,
or a legacy-tree port.

- CSS/Less/SCSS/Jess general-enclosed `@supports` conditions (for example
  `selector(.x)` and `(future condition)`) now use the inert, grammar-owned
  `GeneralEnclosed { form: 'function' | 'paren', name, content: Interpolation }`
  fact. `Interpolation` is the publishable public noun (the former `Interp`
  name has no compatibility alias). Its recursive Parseman content admits only
  literal structured bytes and the dialect's explicit interpolation syntax; it
  is not `FunctionCall`, `Paren`, `Any`, or a parser-local raw fallback. The
  serializer keeps a `GeneralEnclosed` segment structurally protected while it
  normalizes surrounding supports syntax, including when authored content has
  private-use Unicode bytes.
- Less static `~"…"` / `~'…'` uses the existing `Quoted.escaped` fact in
  ordinary values, URLs, import targets, guards, generic static at-rule
  headers, and keyframe names; ordinary quoted backslashes do not set that
  flag. Interpolated escaped strings and `~(…)` remain model gates because the
  existing `Interpolation` and `Paren` facts cannot retain their distinct semantics.
  Escaped literals remain excluded from direct `@supports` and query values:
  Less preserves literal `~"…"` spelling in a direct supports condition, while
  the existing escaped `Quoted` serializer emits inner bytes. Do not widen
  either context without a supports/query-specific representation and output
  proof.
- Less attributes with `@{…}` in their name or value now form one complete
  `SimpleSelector.interp: Interpolation` token. The grammar preserves brackets,
  static namespaces, operators, quotes, and modifiers as literal parts and
  retains each variable interpolation in source order. Dynamic namespaces,
  pseudos, and extend headers remain excluded; this is selector-token structure,
  not a generic raw-selector fallback.
- SCSS nested-property outer and leaf names now accept the already-supported
  structural `#{…}` property interpolation and lower directly to ordered
  `Declaration.name` facts, inserting exactly one prefix hyphen. An own value's
  trailing `!important` stays only on that own declaration; generated leaf
  declarations retain their own priority. The body remains declaration-only:
  comments, variables, control flow, recursive nested properties, and
  `@extend` are still held for a truthful delayed-prefix placement model.
- Complete SCSS condition semantics need shared semantic `Boolean` and `Null`
  values and an explicit false/null-only truth predicate distinct from the
  existing Less exact-true predicate. Do not map a Sass comma list to `or`, and
  do not silently reuse Less comparison semantics for Sass operators. Public
  value-node approval and a comparison-policy audit are pending.
- Deferred Less `&:extend(...)` needs `ExtendStatement` retained at its authored
  placement plus a render-local placement plan. `ExtendInstruction` remains the
  correct rule-attached data. The existing static preplan sees only direct rules,
  so direct grammar admission without that execution work would silently no-op.
  Public-name approval is pending.
- SCSS `@use`/`@forward` configuration needs typed config entries and typed
  forward prefix/filter facts. An escaped or dynamic target cannot truthfully be
  classified as `ModuleImport` or `StyleImport` before evaluation; a deferred
  import fact and matching Jess lowering require an owner-reviewed public model.
- SCSS `@at-root` needs a core output-placement statement, not an
  `AtRuleBlock` or synthetic `Rule`. The pending candidate is
  `AtRoot { target: default | selector | filter, body }`, where filter records
  `with`/`without` plus typed names. It retains lexical binding scope while
  selecting an output-placement ancestry; no literal `@at-root` may reach CSS.
  Exact filter vocabulary and selector-anchor behavior require owner approval
  before parser or serializer work.
- Variable-held calls use `VariableCall { target: VariableReference, args:
  CallArg[] }`, replacing `DetachedCall` without an alias. The current Jess and
  Less grammar admits only their existing zero-argument spellings; the node can
  retain arguments, but grammar work must not invent their syntax. `$`/`$$`
  lookup mode remains on the `VariableReference`; named/spread wrapper-argument
  semantics are held until they are defined against a variable holding an
  already-invoked `MixinCall`.
- Non-terminal semicolonless bare Less calls are not a harmless extension of
  the existing `FunctionCall` statement fact: depending on the following
  tokens, Less treats them as a sequence of statements or as a selector prefix.
  The public direct route admits semicolon-terminated calls and one terminal
  call before a block/document boundary; it must not guess at the remaining
  forms or absorb them as raw text. Their complete grammar/eval model remains
  a later direct-parser gap.
- Jess collection access needs a typed `MemberReference` model distinct from
  Less `MapAccessor` and bare `PropertyReference`. All `$[…]` interpolation is
  semantically ambient member access—`$[foo]` variable-member, `$['foo']`
  property-member, `$[$name]` computed variable-member—but the current direct
  AST still encodes those three base-less forms separately as
  `VariableReference`, `PropertyReference`, and `VarIndirect` inside an
  `Interpolation`. The new model must consolidate those partial encodings and
  add left-associated explicit-target access: dot/declaration names,
  variable-member bracket names, property-member quoted names, zero-based
  signed indexes, and computed bracket keys remain distinct typed access forms;
  every `$`/`$$` lookup mode stays on its own `VariableReference`. This records
  syntax, not a decision to port Less:
  `MapAccessor` has one-based indexing, Less variable/property namespaces, and
  a raw-byte fallback, all invalid for Jess. Existing R7 controls dot-member
  ambiguity (the surface must yield exactly one variable/property declaration;
  multiple candidates within either kind or across kinds is an error). A terminal
  `?` converts any member-chain lookup miss to Nil; the enclosing node's ordinary
  Nil-collapse semantics decide the output. JS own-export policy and final
  node/field names require owner approval before parser or evaluator work.
  `$while` is not currently a documented Jess feature; do not
  port its legacy block-frame behavior without first defining its public
  control-flow contract.
- Jess static generic CSS opaque at-rule blocks have an existing terminal
  `OpaqueAtRuleBlock` model. The earlier claim that Parseman cannot macro-fuse
  their structural capture was wrong: imported recognition-only `scanTo` and
  `balanced` artifacts fuse correctly. The failed attempt imported CSS's terminal
  AST-builder grammar instead of a recognition-only artifact. Extract the opaque
  header/body capture into `internal-css-recognition`, then fuse it into Jess's
  local reduction. Do not replace that work with runtime grammar composition, a
  scanner, regex recognition, or source reparse.

### Queued after public parser closure

- Parseman needs a compile-time grammar-family abstraction for the case where
  two direct productions share the same combinator structure but substitute
  different recursive entry rules. A TypeScript helper that calls `node`,
  `sequence`, or `parser` is rejected because it hides that structure from
  macro fusion (`composeLeaf() must macro-fuse; runtime composition is
  forbidden`). Jess selector capture therefore keeps its static and
  interpolation-capable selector families explicit; do not work around this
  with a host, scanner, post-parse validation, or runtime combinator factory.
  A Parseman feature must preserve first sets, recursive rule identity, and
  macro-compiled output while allowing this parameterization.
- Generate and publish a complete Parseman railroad-diagram reference for CSS,
  Less, SCSS, and Jess in the public Docusaurus site (`packages/docs`). This
  must run from each finished public grammar (including reachable rules and
  documented terminals), be regenerated in CI or an explicit docs command, and
  link from the parser-language docs. Do not generate diagrams from today's
  incomplete direct-AST grammars or present them as the language reference.
- Design dialect-to-Jess compiled conversion around opt-in observed
  compilation facts: resolved import/file provenance and actual function-call
  outcomes determine Jess-relative paths and `@-from`/`@-use` dependencies.
  See [`DIALECT-TO-JESS-COMPILED-CONVERSION.md`](../../DIALECT-TO-JESS-COMPILED-CONVERSION.md).
  It must not re-resolve/reparse source or replace Context/plugin dispatch.

## Aggressive Cutting Self-Prosecution

### Current pass: typed interpolated Less extend targets

- **New traversal / materialization:** none. The existing cold extend-selector
  prepass resolves an instruction target in the same rule/frame visit that
  already resolves authored selector interpolation. No second planner pass,
  source scan, node copy, or render-time selector walk was added.
- **New node/materialization:** none. The parser retains `.@{name}` as the
  existing interpolation-backed `SimpleSelector`; the prepass replaces that
  existing selector fact with its resolved text exactly as it already does for
  rule selectors.
- **Render path:** unchanged direct string emission. `computeExtends` receives
  the resolved parser-owned target and retains its existing IR matching path.
- **Selector-template validation:** the existing ampersand composition branch
  rejects a quoted comma-list parent only when it meets a non-leading `&`
  template (for example `.fruit-&`). It adds no scan or traversal: the already
  computed canonical child string and already-carried parent branches supply
  both facts. Ordinary separate selector branches and leading `&` composition
  keep their existing routes.
- **Helper/API surface:** one private complex-selector helper deletes duplicate
  per-compound resolution bookkeeping; no public API, host, bridge, or Context
  surface was added.
- **Metadata mutations:** existing selector memo invalidation only (`_hasInterp`,
  `_hasAmp`, `_canon`); the literal-ampersand rule is preserved.
- **Evidence:** Less public parser 63/63, CSS public parser 13/13, and Jess
  public extend/at-rule compiler tests 7/7. This is correctness evidence only;
  no performance claim is made.

### Current pass: explicit-mixin ruleset placement publication

- **New traversal / materialization:** one direct `for` loop over an explicit
  mixin's already-canonical immediate body records only Rules that were actually
  rendered into child placement frames. Namespace lookup adds one ordered walk
  over those published placement facts after ordinary imported/authored facts.
  This cannot be carried by the existing `Map<Rule, Frame>` alone: the same
  canonical Rule may be placed by more than one mixin activation with different
  live bindings.
- **New node/materialization:** none. `PublishedRulesetPlacement` is tiny
  render-frame semantic state (`Rule` identity plus its existing evaluated
  child `Frame`), never an AST clone, wrapper, mutation, or cached resolver
  result.
- **Render path:** unchanged direct string emission. The fact is created only
  after an explicit mixin body has emitted; it permits a later sibling
  namespaced call to enter that exact activation and use its existing live
  variables/import facts.
- **Helper/API surface:** added private `publishExplicitRulesets`, scoped to
  explicit-mixin nested expansion; ruleset-mixins retain their normal dispatch
  path. No public operation/type changed.
- **Metadata mutations:** only append-only state on the current render Frame;
  no parent/source/frozen metadata changes.
- **Evidence:** focused canonical AST regression covers interpolated `.person`
  placement followed by `.person.sayGender()` and its captured `@gender`;
  public `mixins-interpolated` and all 11 `tests-config/namespacing` fixtures
  pass. This is behavior evidence only; no performance claim is made.

### Current pass: bubble-body async cursor

- **New traversal / materialization:** one existing source-order body loop now
  owns its direct-leaf group and numeric cursor. It replaces the prior outer
  loop plus one `emitBubbleStatement` invocation per child; no `slice`,
  `map`, copied statement array, node, wrapper, or side map is created. A
  continuation is allocated only when `flatten`, a nested at-rule, an import,
  or a selected `$if` body actually returns a promise.
- **New node/materialization:** none. Loaded imports retain their canonical
  `Stylesheet`; the renderer calls the same bubble-body placement routine with
  the importer frame and never copies children or reconstructs source.
- **Render path:** direct leaves accumulate in one shared group and stringify
  once at a real boundary. An async import resumes the same group/index after
  its loaded body completes. The import callback temporarily restores the
  legacy loaded-root placement depth while emitting that body, then restores
  the import statement depth before the cursor continues; the at-rule header
  still owns its braces and empty-block rewind.
- **Helper/API surface:** deleted `emitBubbleStatement`; added no public API.
  The local cursor is necessary to retain an exact source index across an
  asynchronous boundary without sliced tails or per-statement closures.
- **Metadata mutations:** none.
- **Review-flagged diff tokens:** `[loop/traversal]` is this pass's single
  replacement source-order cursor, which deletes the prior outer
  loop/per-statement dispatch pair and is needed to resume at an async source
  index. `[array helper]`, `[array spread/materialization]`, `[node
  construction]`, `[parent/source mutation]`, `[side map/set]`, `[routine
  error control]`, and `[materialized array/object]` are concurrent shared-tree
  work, not this cursor pass: it adds no arrays, nodes, maps, source mutation,
  or routine errors.
- **Evidence:** core build, 22 focused AST import tests (including the promoted
  async duplicate-import regression), focused AST at-rule/mixin/extend suites,
  and public `strict-imports` plus `layer` collapse:false fixtures pass. The
  repository-wide aggressive verifier still reports unrelated concurrent
  shared-diff cost-contract entries; no performance claim has been made.

### Current pass: deferred imported-callable document scope

- **New traversal / materialization:** none. `Context` records one existing
  `TreeContext` against an imported callable's already-shared body-array
  identity when the typed import fact publishes a direct `MixinDef` or `Rule`.
  This is two immediate-child publication loops that already exist (normal
  emission and the intentional extend planner); it does not walk a parsed
  document, rebuild a body, reparse source, or create an emitter ownership map.
- **New node/materialization:** none. The added session-only
  `WeakMap<object, TreeContext>` carries no AST metadata and creates no node,
  wrapper, source-parent link, or resolver result. A synthesized zero-argument
  ruleset mixin reuses `Rule.body`, so the same association covers it without a
  second representation.
- **Render path:** direct and nested mixin/reference execution asks `Context`
  to restore that body owner's existing document scope only while its current
  body callback runs. The returned `MaybePromise` retains the scope through an
  async nested import/read and restores the caller scope in both success and
  error paths. The one proven `walkBody` inline-import branch now returns its
  existing async continuation rather than dropping it; this preserves the
  cursor/order and does not broaden import resolution.
- **Helper/API surface:** `Context.rememberDocumentBody` and
  `Context.withDocumentBody` are narrow session-provenance operations derived
  from the existing document identity table. They add no parser selection,
  filesystem access, module loading, plugin dispatch, host, bridge, or
  compatibility route.
- **Metadata mutations:** none. The AST stays plain canonical source facts;
  all association is weak, session-local, and import-publication-only.
- **Review-flagged diff tokens:** `[side map/set]` is the one required
  `WeakMap<body, TreeContext>` session provenance table; it replaces no lookup
  structure, is consulted only at deferred body entry, and cannot retain an AST
  body. `[loop/traversal]` is the two existing import-publication loops gaining
  a constant-time direct-child association; no descendant traversal is added.
  The inline continuation may allocate the existing sliced remainder only when
  Context IO is actually async; it is necessary to retain the source cursor and
  replaces the prior dropped promise. All other verifier tokens are concurrent
  shared-tree work outside this pass.
- **Lifecycle evidence:** `context-provenance.test.ts` creates exactly two
  Context-registered documents and one deferred body association. It records
  five ordered ownership observations: root entry, imported-body entry,
  imported-body post-`await`, root restoration, and root restoration after a
  rejected `withSourceOwner` activation. The test also proves an unassociated
  body uses the active root owner rather than allocating provenance. This is
  test-local evidence, not a production counter or a performance claim.
- **Evidence:** core and Jess builds pass; 12 Context-backed path-resolution
  tests pass with no unhandled rejection, including explicit imported mixin and
  bare ruleset-as-mixin bodies whose nested `(inline)` reads must use the
  imported directory and then restore the root directory. Public Less parser
  tests pass 67/67 and the Less hotpath corpus completes. `benchmark.less`
  does not activate a deferred imported callable body, so it is not evidence
  for this lifecycle path and no benchmark claim is made.

### Current pass: Less guard equality for emitted keyword values

- **New traversal / materialization:** none. The existing two-operand guard
  comparison adds one constant-time cross-kind equality check before the
  existing per-kind comparator; it allocates no node, array, map, or render
  state.
- **Render path:** unchanged. Guard dispatch receives already-materialized
  values and returns a boolean; it never constructs an output value or scans
  source. The branch is limited to exact emitted-byte equality when one operand
  is the existing `Keyword` materialization of `~"…"` / `e("…")`.
- **Helper/API surface:** none. No node, public type, parser rule, Context
  method, bridge, or compatibility path was added.
- **Metadata mutations:** none.
- **Review-flagged diff tokens:** `[loop/traversal]`, `[array helper]`,
  `[array spread/materialization]`, `[node construction]`, `[side map/set]`,
  `[routine error control]`, and `[materialized array/object]` reported by the
  repository-wide diff verifier belong to concurrent parser/core work in this
  shared dirty tree. This pass adds none of those mechanisms: its only
  production addition is a scalar conditional and immediate boolean return.
- **Evidence:** the core typed comparison regression proves `3 = ~"3"` in both
  directions while `3 != 4`; rebuilt `tests-unit/mixins-guards/mixins-guards.less`
  is byte-identical. No performance claim.

### Current pass: public Less `Stylesheet` dispatch and execution

- **New traversal / materialization:** one bounded root-child scan for static
  CSS-terminal import prelude output; no node materialization. Jess passes
  the parser-owned `Stylesheet` directly to the existing AST serializer; it
  does not construct a `Rules`, bridge, aggregate document, or render-only
  node. The builtin evaluator is assembled once at module initialization and
  retained on the render Context. One `WeakMap` entry per parsed `Stylesheet`
  retains its already-known file/plugin source identity; import entry simply
  switches the existing `treeContext` and restores it. Context's cache widens
  only to hold the parsed document it already coordinates. The renderer performs
  one root-only scan when no caller-supplied import handler owns terminal import
  decisions; it writes already-typed static CSS terminal imports and retains one
  identity set solely to skip their later source positions. It does not resolve,
  load, parse, allocate output nodes, or walk nested/imported documents.
  `SpacedValue` now uses the existing per-part value fold and one existing-size
  output loop to read parser-owned separator bytes; when no newline separator is
  present it takes the same single-space output branch as before. No source scan,
  list re-split, node, or side map is introduced.
- **Render path:** `Rules.render` remains only for legacy documents. A
  `Stylesheet` takes the direct serializer branch under `Context.withDocument`.
  Imports call the retained `Context.getTree` path from that serializer; each
  loaded document enters its Context-owned source scope and restores its
  importer afterward. A Jess-side import callback, pre-flattened import wrapper,
  or AST-to-tree conversion is rejected.
- **Helper/API surface:** one normalized Context parser dispatch selects
  `safeParse` or the legacy throwing wrapper; callers do not acquire another
  parse/load path. `Context.withDocument` replaces two Jess-only AST scope
  helpers and the public renderer's `importDocument` callback; it owns no new
  resolution behavior. The Less plugin directly calls `@jesscss/less-parser.parse`.
  `buildEvaluator` is the existing typed core execution seam, publicly exported
  so Jess can pair it with the `@jesscss/fns` registry without creating a core →
  fns cycle. The public Less test configuration explicitly chooses macro-compiled
  parser output instead of attempting Parseman runtime composition.
- **Metadata mutations:** AST documents set `context.document`; they do not
  overwrite legacy `context.root`, whose meaning remains tied to the old
  evaluator until that runtime is deleted.
- **Evidence:** core and Jess builds pass; focused core AST import/value tests,
  7 public Jess API tests, 4 Context-backed path-resolution tests, and the
  isolated Less operations fixture pass. The public
  evaluator proof covers a variable, mixin, arithmetic, and builtin through the
  Less parser → plugin → Context → Jess route. No performance claim.

### Current pass: R3 live/scoped binding contract

- **New traversal / materialization:** the declaration index is one immutable,
  source-order map per body; live cells and scoped reassignment overlays are
  per activation, as required by `RESOLVER-SHAPE-SPEC.md`. No source rescan,
  parser replay, or render-only node creation occurs.
- **Render path:** variable reads select exactly one store. Live reads never
  fall through to the declaration index; scoped reads never consult live cells.
  A source-order walk activates declarations before later live uses.
- **Helper/API surface:** `VariableReference.lookup`, `VariableDeclaration.write`,
  and `VarIndirect.lookup` are mandatory public AST facts. No defaults, host,
  bridge, callback registry, or dialect-local binding model remains.
- **Evidence:** focused core AST proofs; CSS 98, Less 183, SCSS 134, and Jess 70
  parser tests; package-export, parser-boundary,
  docs, and diff checks. Fresh reviews closed live selector/import activation,
  dynamic-variable lookup mode, glued sigils, and stale public AST assertions.
  No performance claim.

### Current pass: direct Less/SCSS/Jess existing-fact closure

- **New traversal / materialization:** none. Parser reductions construct only
  existing `Interpolation`, `Url`, `ImportAtRule`, `VariableDeclaration`, `If`, and
  `Quoted` facts. No resolver, source scan, reparse, copied node, or temporary
  render node was added.
- **Render path:** one constant-time `Quoted.escaped ? value : src` leaf branch
  emits Less static unquoted strings; it adds no walk, allocation, or helper.
  SCSS/Jess ordinary backslash escapes retain `escaped: false`, so they keep
  their authored quotes. Existing URL/import and typed at-rule serializers
  otherwise evaluate the parser-owned facts. Generic Less at-rule headers use a
  separate static-only grammar because ordinary generic-header rendering does
  not retain parenthesis structure.
- **Helper/API surface:** parser-local grammar productions only; no host,
  bridge, action callback, public compatibility API, or Context change.
- **Review-flagged diff tokens:** `[loop/traversal]`, `[array helper]`,
  `[array spread/materialization]`, `[node construction]`, `[routine error
  control]`, and `[materialized array/object]` are parser-reduction work: they
  run once during Parseman construction and produce the canonical source facts,
  never on the eval/render hot path. The reduction `throw` sites are impossible
  grammar-child invariant failures, never ordinary parse misses or runtime
  control flow. This slice adds no loop, array, node, or throw to rendering.
  `[side map/set]` belongs to the separately documented R3 activation-state
  model above; this slice adds none. The repository-wide
  verifier still reports unrelated shared-diff registry entries, so it is not a
  pass/commit gate result for this uncommitted shared worktree.
- **Literal parent-suffix interpolation:** `&@{suffix}` remains the existing
  `Interpolation`-backed `SimpleSelector`, not a new selector node or parent-transform
  model. `compoundHasAmpersand` reads only literal `Interpolation` segments, never
  resolved references. The existing extend interpolation prepass carries the
  pre-mutation literal-only `_hasAmp` bit across template materialization, so
  a reference resolving to `&` never becomes a parent selector. No planner
  scan, extra traversal, or resolved-reference detection was added.
- **Evidence:** CSS parser 98/98, Less parser 183/183, SCSS parser 134/134,
  Jess parser 70/70, focused core AST acceptance 12/12, focused core import
  placement 7/7, parser-runtime-boundary 0, docs validation, diff check, and
  fresh cross-reviews. The direct Less
  route now also recognizes deprecated glued percent-format calls as the
  existing `%` `FunctionCall`; CST/direct/public parity and a static escaped
  quote argument are covered. The CSS-3 fixture additionally proves the exact
  legacy doubled-quote `url-prefix` argument, structural generic-header parens,
  and multi-token `@supports` feature values. Static CSS `ImportAtRule` facts now retain their
  canonical nested Rule placement in SCSS and Less—including mixin expansion,
  selected control flow, and post-nested-rule ordering—rather than being
  hoisted by the shared serializer. CSS still rejects nested imports and Jess's
  CSS-import spelling remains `AtRuleStatement`. Static SCSS nested properties
  now lower directly to ordered existing declarations, including empty blocks;
  the CST-valid dynamic/control-flow prefix cases remain model gates. Review
  found the generic Less interpolation escape hatch and direct Less now admits
  existing detached-ruleset facts only at its CST-valid binding, mixin-argument,
  parameter-default, and standalone-call positions. Generic declaration values
  and percent-format arguments remain excluded. Legacy raw detached fallback
  bodies remain explicitly CST-only because no typed AST fact can retain their
  payload without a raw/reparse fallback. The generic Less interpolation escape
  hatch is covered for leading, glued, and spaced forms. No performance claim.

### Current pass: direct Jess value/header closure

- **New traversal / materialization:** none. Parseman reductions construct only
  existing `Quoted`, `Url`, `Interpolation`, and at-rule facts; empty `url()` uses the
  existing `Url(Any(''))` representation.
- **Render path:** unchanged. Existing value/at-rule serialization evaluates
  those typed facts; no source reconstruction, resolution, or reparse occurs.
- **Helper/API surface:** two parser-local predicates distinguish a flattened
  header fact from its `@...` token. They keep the documented dynamic media
  spelling block-only rather than adding a host, fallback, or generic header
  path.
- **Evidence:** public Jess parser suite (51 tests), CSS parser suite (96
  tests), parser-runtime-boundary (0), diff check, and two adversarial reviews;
  the reviews found and closed empty `@import url()` and dynamic media-statement
  leakage. No performance claim.

### Current pass: canonical Jess `For`

- **Authority and deleted vocabulary:** the public Jess `$for` documentation is
  the contract. The old AST-v2 `valueName` / `keyName` / `indexName` fields were
  a Less `each()` callback model incorrectly made public; they are deleted.
  `For.binding` now retains the authored Jess single, comma, bracket, or tuple
  pattern. Less `each()` lowers at the Less parser boundary only.
- **New traversal:** `forRangeItems` adds one bounded numeric loop to enumerate
  a typed Jess `Range`; existing `forItems` still enumerates iterable entries.
  This is semantic iteration, not a later rediscovery or reparsing pass. The
  resulting entry array is current serializer control state and is not claimed
  as a performance improvement; compact streaming iteration remains a separate
  performance question.
- **New node/materialization:** `Range` is parser-owned public AST
  materialization with typed bounds, step, and endpoint inclusion flags.
  `ForBinding` is plain public AST data, not a runtime host or side map. No
  nodes are created merely to stringify CSS. A Jess value-position collection
  materializes the already-owned canonical `DetachedRuleset`; it does not add a
  new map node, compatibility tree, or render-time conversion.
- **Render path:** `expandFor` and `expandNestedFor` bind and emit the existing
  `For` body. Bracket bindings use documented key/value order; comma bindings
  use value/key-or-index/counter; tuple bindings destructure typed list entries.
- **Helper/API surface:** `range` and `ForBinding` replace three Less-shaped
  public fields. No BuilderHost, ParseHost, bridge, action registry, scanner,
  or source reparse is introduced.
- **Metadata mutations:** none.
- **Evidence:** public Jess parse/AST/render proof now covers list, range, and
  collection key/value examples from the language documentation; the Jess
  parser suite (44 tests), package build, parser-runtime-boundary check, and
  diff check pass. This establishes semantic shape only; it makes no
  performance claim.

### Current pass: typed `@supports` and general-enclosed conditions

- **Authority and scope:** `@supports` accepts typed static feature conditions,
  logical `not`/`and`/`or`, recursively nested conditions, and
  `GeneralEnclosed` function/parenthesized forms. Its content is a structured
  `Interpolation`, never `Any` or a raw/reparse fallback. Other unsupported
  dynamic forms stay rejected until they have truthful typed models.
- **New traversal:** one bounded recursive serializer walk of a supports
  prelude. It is necessary because ordinary value evaluation transparently
  removes `Paren` around computed operations, while supports parentheses are
  grammatical grouping and must remain in emitted CSS. No source/tree scan,
  reparse, resolver, or side-map lookup is added.
- **New node/materialization:** parser reductions create `GeneralEnclosed` only
  at its public grammar position, plus the existing `Paren`, `Operation`,
  `Keyword`, `SpacedValue`, and leaf facts. No copied node, raw prelude, or
  render-only materialization is added.
- **Render path:** `@supports` writes the grammar-owned condition structure;
  ordinary value serialization is unchanged. This preserves `(display: grid)`
  rather than evaluating it into `display : grid` and losing the parens.
- **Helper/API surface and metadata mutations:** the public AST names are
  `Interpolation`, `GeneralEnclosed`, and `VariableCall`; there are no aliases
  for old `Interp`/`DetachedCall` names. No metadata mutation, host, bridge, or
  compatibility route.
- **Evidence:** direct AST shape, public parse/render, rejection matrix, Less
  package build, and parser-boundary verification. No performance claim or
  benchmark is made.

> **Removed historical staging record.** The former block here made private,
> unreachable, CST-only, or delayed-public-route claims. Those claims were
> wrong and have been deleted rather than retained as planning evidence. The
> current public parse-to-Stylesheet architecture and the sections above and
> below are the only applicable guidance.

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

### Current pass: imported AST extend planning

#### Overlay ingestion stack-safety self-prosecution

- **New traversal:** two indexed loops in `collectPlan` append the existing
  render-local overlay fact arrays. They replace argument spreading, which
  converted a finite imported-loop overlay into one giant call and overflowed
  V8's argument stack at 185,268 subjects. The loops preserve source order and
  are the only pass over those arrays before the existing `mayMatch` pass.
- **New node/materialization:** none. Each loop pushes the existing fact
  reference directly; it creates neither a concatenated array nor a copied
  subject/instruction value.
- **Render path:** planner-only, reached only when extends are admitted; no
  output nodes or strings are produced.
- **Helper/API surface / metadata mutations:** none.
- **Evidence:** direct AST regression ingests 150,000 overlay subjects, above
  V8's spread argument limit. The complete 37-import Bootstrap prefix now
  completes. This is a correctness/stack-safety repair, not a speed claim.

- **New traversal:** `planImportedExtends` is the one cold pre-render import
  traversal, required before `computeExtends` so imported selectors and root
  selectors share one plan. Its `visit` cursor runs statements in source order;
  `collectPlacedExtendFacts` follows `Rule`/`AtRuleBlock` bodies and, only when a
  `For` body can carry an extend, executes the existing `forItems` +
  `bindForEntry` semantics once per item. This is not a render walk: the normal
  `emitImportAtRule`/`emitDocumentStatements` cursor is still the only output
  traversal. The static no-extend direct-AST import path retains its old
  synchronous bypass; Context imports are already MaybePromise-capable and may
  discover imported-only extends.
- **New node/materialization:** none. The deleted `{ ...root, children }` and
  `{ ...atRule, body }` synthetic planner view is gone. Selector facts are small
  extend IR values (`Branch`/`Level`), not AST nodes; no parsed node, statement,
  body array, source metadata, or wrapper is copied or mutated.
- **Placement state / allocations:** one `object` token per actually iterated
  extend-bearing `For` item, stored in a render-session
  `WeakMap<For, readonly object[]>`; one placement projection map is allocated
  only when such a token receives an extend result. The preflight otherwise uses
  its existing import-once `Set`, its existing planned-import `WeakMap`, and
  temporary selector-IR arrays necessary for `computeExtends`. Static documents
  continue to use the original per-rule maps directly: `byPlacement` is null and
  no frame-chain lookup runs.
- **Render path:** `expandFor` and `expandNestedFor` select the pre-issued token
  by the already-existing iteration index and put it on that iteration's lexical
  `Frame`. Extend projection lookup first takes the old direct map; only when
  placement results exist does it walk the bounded parent `Frame` chain to the
  nearest token. It never scans source/AST, resolves imports, or constructs an
  output node merely to stringify.
- **Helper/API surface:** all helpers are file-private (`resolvedExtendBranch`,
  `resolvedExtendLevel`, `bodyMayPlanExtend`, `collectPlacedExtendFacts`, and
  `extendProjection`). No export, compatibility shim, parser host, bridge,
  action registry, or plugin API was added. The old synthetic-root planner path
  was deleted rather than retained beside the typed-fact route.
- **Metadata mutations:** none on AST. `Frame.extendPlacement` and the two weak
  maps are render-session semantic placement state. Existing variable activation
  occurs in the preflight's private planner frame; it never publishes into the
  subsequent render frame.
- **Review-flagged diff tokens:** this pass owns the cold source-order loops in
  `collectPlacedExtendFacts`/`planImportedExtends`, selector-IR arrays, the
  planner-local token array, and `WeakMap` placement projections described
  above. They replace the deleted cloned-root/at-rule planning materialization;
  they are not on a static document's render path. The verifier's remaining
  global danger-token and cost-contract findings cover the concurrently dirty
  parser/core files listed by the command, so they cannot be attributed to this
  narrow pass in the shared worktree.
- **Evidence:** `packages/core/src/ast/__tests__/import-at-rule.test.ts` covers
  two imported loop iterations resolving to `.from-one` and `.from-two` in one
  target group, while retaining sync imports, retry/error diagnostics, and
  reference visibility (24/24). The public parser/compiler fixture
  `packages/jess/test/less/spine-guarded-mixin-forfold.test.ts` proves imported
  Less `each()` interpolated extenders (4/4). Core build passes. No speed claim
  is made; the benchmark below is a non-parity measurement only.

### Current pass: mixin-call empty accessor

- **New traversal:** `lastVarMember` performs two bounded cold-path iterations
  only after a typed `BracketLookup(index: -1)` reaches a mixin-call result
  with no emitted declaration members. It reads the existing ordered callee
  frames and their precomputed `declIndex` keys; that order is the only place
  the conventional final `@return` member exists after normal mixin emission
  intentionally suppresses variable declarations. It does not walk source
  text, parent links, or output nodes.
- **New node/materialization:** none. The accessor retains the parser-owned
  `Reference(MixinCall, BracketLookup(-1))` facts. The fallback returns the
  existing binding/value and frame; it does not clone, mutate, or construct an
  AST node or a placement wrapper.
- **Render path:** unchanged direct serialization. The fallback is evaluator
  lookup state only, reached for a value reference; it does not build output
  nodes or recover/reparse source. Non-empty declaration maps keep the existing
  ordered-list index behavior.
- **Helper/API surface:** one private evaluator helper, `lastVarMember`. It
  closes the missing half of the existing `lookupVarMember` callee-frame path;
  no exported API, host, bridge, parser fallback, or compatibility adapter was
  added.
- **Metadata mutations:** none.
- Review-flagged diff tokens: two nested `for...of` loops are confined to
  the cold empty-bracket mixin-result fallback. They are necessary to preserve
  declared candidate/source order from existing frame facts; no new map, side
  table, or materialized member list is created.
- **Evidence:** direct AST acceptance proves a typed mixin-call plus
  `BracketLookup(-1)` resolves its final local variable. The public Less
  compiler regression proves `.add(10px, 10px)[]` renders `20px`; core build
  and focused tests pass. This is a correctness repair only; no performance
  claim or benchmark is made.

### Current pass: interpolated explicit-mixin rule publication

- **New traversal:** none. The existing `publishExplicitRulesets` loop already
  visits direct `Rule` children of a selected explicit mixin definition. The
  flat `expandCall` now invokes that existing publication seam, matching the
  nested emitter's established behavior; no new lookup walk, selector scan, or
  source traversal was added.
- **New node/materialization:** no AST node/copy/wrapper. A call-specific
  lexical `Frame` is established only when a direct child Rule has not yet been
  flattened. That frame is semantic placement state: a later sibling namespace
  call can see the actual mixin-parameter bindings before the deferred rule
  render closure runs. `flatten` reuses it when it does run, so this moves an
  already-required frame creation earlier rather than creating a second one.
- **Render path:** direct emit stays unchanged. The publication has no output;
  it makes canonical nested Rule facts callable at the same lexical point that
  Less exposes them. No text recovery, reparse, or render-time AST build is
  introduced.
- **Helper/API surface:** no new helper or public API. The repair calls the
  existing private `publishExplicitRulesets` from the flat path; it remains the
  single owner of `publishedRules` placement state.
- **Metadata mutations:** existing render-local `rulePlacements` and
  `publishedRules` only; neither lives on canonical AST nodes. The placement is
  keyed by call frame, preventing an interpolated Rule shared by separate calls
  from leaking parameters across placements.
- Review-flagged diff tokens: no new traversal token. One existing cold
  publication loop now materializes a `Frame` only for an explicit mixin child
  Rule before deferred flattening; this is necessary semantic placement state
  and reused by the renderer.
- **Evidence:** the final public historical interpolated-path source now emits
  `mi-test-d { gender: "Male"; }`; a second public test proves two interpolated
  child rules retain separate `red`/`blue` call frames. Direct core mixin/value
  suites and public Less semantic suites pass. No performance claim or benchmark
  is made.

## Aggressive Cutting Self-Prosecution

- Latest pass: public AST-v2 cutover snapshot commit gate (parser, Context/plugin,
  evaluator, serializer, reference, import, and direct-route work staged together).
- Architecture surface: the staged work replaces public parser output with canonical
  AST-v2 `Stylesheet` and carries that document through the retained Context/plugin
  dispatch and direct serializer. It is not a private grammar, bridge, parser host,
  action registry, source reparse, or fallback route.
- Separation/duplication: grammar reductions own construction; Context retains
  resolution/module/source coordination; evaluator and serializer consume the same
  canonical AST. The staged snapshot intentionally removes Rules-typed public-route
  assumptions rather than retaining an AST-to-tree compatibility path.
- Cumulative node weight: parser construction now allocates canonical public AST
  facts at parse time. Render-local `Frame`, extend-planning IR, and provenance maps
  exist only where a semantic placement/source fact cannot live on the immutable
  source tree. This is a semantic cutover, not a byte-identical refactor and not a
  performance acceptance claim.
- New traversal: parser reductions walk recognized child arrays to construct typed
  nodes; source-order evaluator/serializer loops execute statements; import/extend
  planning performs its documented cold preflight only when the typed admission
  predicate finds an extend-bearing import body. No scanner, source-text pass,
  source reparse, or render-time AST walk was introduced.
- New node/materialization: Parseman reductions construct only canonical AST-v2
  nodes from recognized children. Evaluation does not build nodes merely to
  stringify. The staged `Reference` chain, import facts, `Plugin`, and direct
  dialect grammar nodes replace legacy/callback representations rather than wrap
  them.
- Render path: `Stylesheet` rendering remains direct string emission under the
  active Context document scope. Imports dispatch through `Context.getTree` and
  plugin resolution; they do not pre-splice text, bridge into Rules, or create an
  output-node tree.
- Helper/API surface: added parser-local grammar factories/reducers and private
  evaluator/serializer helpers are the narrow owners of their typed facts. Public
  operations remain `parse`, Context dispatch, and render; no BuilderHost, ParseHost,
  callback/action registry, or parser compatibility alias is added.
- Metadata mutations: canonical AST nodes remain immutable source facts. Parent,
  source-owner, lexical binding, provenance, and extend-placement data are carried
  in documented render/session Frames or Context-owned maps; no post-hoc parent
  restoration or source-tree mutation is used to recover placement.
- Review-flagged diff tokens: [loop/traversal] and [array helper] are Parseman
  reduction child classification plus existing source-order evaluator/planner loops;
  [array spread/materialization] and [materialized array/object] are canonical
  grammar child/result construction and bounded selector/planner facts;
  [node construction] is direct canonical AST construction at parse time;
  [parent/source mutation] is Context/Frame provenance and placement state, not AST
  repair; [side map/set] is render-session Context/extend/provenance state keyed by
  canonical identities; [routine error control] is grammar-child invariant failure
  or exceptional diagnostics, never ordinary parser/evaluator miss control flow.
  The staged snapshot contains several semantic feature changes, so these tokens
  cannot truthfully be treated as a neutral byte-identical change.
- Evidence: focused direct parser/core suites previously cover CSS, Less, SCSS, and
  Jess `parse() -> Stylesheet`; current staged verification independently records
  Less AST grammar 214/214, path resolution 12/12, and the full Bootstrap import
  fixture completing after the extend admission/stack-safety repairs. The remaining
  Less-alpha verifier gaps and full package/release gates are tracked separately;
  this block makes no performance claim.
- Verdict: documentation and ownership review are complete for the staged snapshot;
  cost-contract acceptance remains deliberately unclaimed until each changed
  production surface has a compatible measured or exact structural contract. Do not
  invent a benchmark-byte-identity result for feature-changing parser/evaluator work.

## Parser/codegen evidence audit (2026-07-21; no performance acceptance)

This is a machine-readable evidence record, **not** an aggressive-cutting cost
contract and not a claim that the public parser cutover is performance-neutral.
It exists to prevent three different facts from being conflated: direct AST
construction, disabled runtime coverage/trace, and emitted parser code size or
allocation cost.

```json
{
  "schema": "jess-parser-codegen-audit/v1",
  "status": "semantic-cutover-measured-performance-pending",
  "parseman": "0.28.0",
  "publicRoots": {
    "css": "packages/css-parser/src/index.ts: parse() calls run(CssAstDocument, input, { trivia })",
    "less": "packages/less-parser/src/index.ts: parse() calls run(LessAstDocument, input, { trivia })",
    "scss": "packages/scss-parser/src/index.ts: parse() calls run(ScssAstDocument, input, { trivia })",
    "jess": "packages/jess-parser/src/index.ts: parse() calls run(JessAstDocument, input, { trivia })"
  },
  "normalInstrumentation": {
    "coverage": "off: no public root supplies RunOptions.instrumentation",
    "trace": "off: no public root supplies RunOptions.instrumentation",
    "profile": "off: no public root supplies RunOptions.profile",
    "testOnlyCoverage": "packages/css-parser/test/macro-compiled.test.ts creates a separate Vite transform with grammarCoverage: true and explicitly passes instrumentation"
  },
  "boundaryEvidence": {
    "command": "pnpm run verify:parser-runtime-boundary",
    "result": "0 tracked temporary sites (0 exact ledger sites)"
  },
  "directRouteEvidence": {
    "commands": [
      "pnpm --filter @jesscss/css-parser test -- --run test/public-parse.test.ts test/macro-compiled.test.ts",
      "pnpm --filter @jesscss/less-parser test -- --run test/public-parse.test.ts test/macro-compiled.test.ts",
      "pnpm --filter @jesscss/scss-parser test -- --run test/public-parse.test.ts test/parse-only.test.ts test/ast-macro-compiled.test.ts",
      "pnpm --filter @jesscss/jess-parser test -- --run test/parse-only.test.ts test/macro-compiled-ast.test.ts"
    ],
    "result": "CSS 23 focused tests; Less 67 public-route tests; SCSS and Jess focused macro/direct suites passed in the same audit run"
  },
  "generatedArtifactEvidence": {
    "method": "sha256 and literal-count inspection of current built artifacts",
    "coverageHooks": 0,
    "traceHooks": 0,
    "macroCompositionCalls": 0,
    "internalRecognitionImports": 0,
    "residual": "The generated artifacts still contain optional Parseman profile and CST-host branches. This is not active during ordinary parse(), but it is emitted code and cannot be described as AST-only collector elision or as a neutral performance change."
  },
  "requiredBeforeAcceptance": [
    "Capture an exact generated-artifact baseline after the published Parseman version is rebuilt into all four parser packages.",
    "Measure parse-only and end-to-end compiler phases under one repeatable protocol with identical semantic fixture coverage.",
    "Determine whether profile/CST-host code emission is intentionally retained by Parseman 0.28 or should be removed in a separately reviewed codegen change.",
    "Do not add an aggressive-cutting cost-contract record until the changed owner surface, output identity scope, and measurement are known."
  ]
}
```

### Release-gate attribution (2026-07-21)

### Direct Less built-artifact baseline (2026-07-21; investigation only)

This is the first matching current baseline for the **published-Parseman,
built direct parser**. It is not an A/B and does not establish a regression
against the historical private/source driver.

| Phase | Exact protocol | Current result |
| --- | --- | --- |
| Direct parse | `packages/less-parser/lib/index.js` SHA-256 `52d88a95557a821815d9f15f2d6ab05bbb5c64a55f0189fb97a050d7aea50285` (1,797,831 bytes); `parse(source)` on `packages/jess/benchmark/benchmark.less` (106,802 bytes); Node v24.11.1 arm64; 20 warmups + 3×45 samples | **63.321 ms** median; p25 61.776, p75 64.487, p90 65.386. The returned `Stylesheet` has 677 children; stable JSON snapshot is 957,390 bytes, SHA-256 `2ba996a1c46eb6d77ce8f1748b35d1135848c128104e00f46dadf7e9651c53bd`. |
| Public Compiler | `node scripts/measure-less-hotpath.mjs --fixture packages/jess/benchmark/benchmark.less --iterations 45 --warmup 20 --repeat 3 --trim 0.1 --json`; built `jess`, `plugin-less`, and `plugin-less-compat`; same Node/fixture | **77.492 ms** round-median across 135 samples; p25 76.003, p75 79.580; 4.53% sample RSD / 0.78% round RSD (`usable`). Output is 122,390 bytes, SHA-256 `ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6`. |

The plugin's `safeParse()` calls the same public `@jesscss/less-parser.parse`,
so the two measurements share the canonical frontend. Their difference is not
a phase attribution: the Compiler measurement also includes Context/plugin,
document, evaluation, and rendering work. It does establish that direct parse
is the dominant measured phase on this fixture.

Historical values must not be treated as an A/B: the former 33.65 ms direct-AST
figure was a Vite/source `renderAstFile` partial-driver phase (20 warmups/N=60),
and the 24.42 ms figure was a Parseman 0.27-era built parser floor. Current
grammar imports `composeLeaf` in all four AST frontends; npm packages 0.26.0 and
0.27.1 do not export that symbol, while 0.28.0 does. Therefore the current
grammar cannot produce a valid 0.26/0.27 generated-bundle comparison without
changing the grammar; no such comparison may be reported.

Independent current evidence:

- V8 CPU sampling over 150 direct parses: 75.6% of leaf samples were emitted
  Less reducer functions in the built bundle; GC was 3.6%. This proves generated
  grammar execution dominates parse time, but does **not** identify a particular
  choice/backtrack or AST factory as causal.
- Allocation sampling over 30 direct parses attributes 515,240 of 1,303,176
  sampled bytes to emitted reducer frames. It establishes material allocation
  in the generated parser, not how much is retained canonical AST versus
  transient recognition/capture state; do not call it an AST-allocation result.
- Provenance is not a plausible whole-parser explanation: Less invokes
  `withSourceSpan` at only two grammar reductions. Trivia is a live candidate:
  `run()` always creates `_triviaLog` and the built bundle contains 1,925
  `_triviaLog` references, while public `parse()` discards that result. Its cost
  has not yet been isolated.
- `composeLeaf` is macro-time, not a runtime composition layer: the built bundle
  has no `composeLeaf(` call and normal public parse supplies neither profile nor
  coverage/trace instrumentation. The same bundle still emits optional profile
  (1,685 `_pmProfile`) and CST-host (409 `_parsemanCstOutput`) branches; whether
  their normal-path predicates are material requires a separate generated-code
  A/B, not inference from literal counts.
- Current non-coverage artifacts cannot provide branch/rollback counts: they
  contain no `_grammarTrace` hooks. A same-source coverage-enabled diagnostic
  build is the required next measurement for choice/backtracking; it must remain
  outside normal parser and benchmark routes.

**Next actionable hypothesis:** construct a diagnostic coverage-enabled build
of this exact grammar, collect selected/failure/backtrack counts on the same
fixture, then use the CPU/allocation profile to choose one shared-prefix or
first-set change. Do not optimize AST factories, trivia, or emitted optional
branches until that measurement attributes their cost.

`verify:aggressive-cutting-review` compares the working `dev` tip with
`origin/dev`; this is a 96-commit, 237-file integration delta (+12,490/-40,189
lines), not a small release patch. `6734da512` alone changes 34 production
surfaces. Therefore an accepted whole-snapshot record would be false: direct
grammar reductions, evaluator/serializer semantics, Context document dispatch,
provenance, and extend placement all introduce or replace real runtime work.

The audit must stay split by ownership; changing the verifier base, running only
staged mode, or assigning blanket `neutral-or-negative` contracts would hide the
unreviewed cutover and is rejected.

| Audit family | Current files | Existing behavior evidence | Required acceptance evidence |
| --- | --- | --- | --- |
| Cold exports, diagnostics, and CST-only API cleanup | `ast.ts`, `index.ts`, `value.ts`, `error/{codes,diagnostics}.ts`, CSS README/CST surfaces | package/API tests and public CST tests | Exact cold-path reachability plus a current package/API run; these are the only candidates for narrow neutral contracts. |
| Direct Parseman frontends | CSS/Less `ast/grammar.ts`, parser public entries, shared grammar files | parser AST/public/macro suites; parser-runtime boundary proof | generated-artifact parse-only baseline, rule coverage, and per-family allocation/choice evidence. No legacy-parser timing is a substitute. |
| Canonical engine | `ast/{at-rule,evaluator,mixin-dispatch,value-*.ts,nodes.ts,serialize.ts}`, `context.ts`, `plugin.ts` | direct acceptance, import, mixin, value, Plugin, and public Compiler suites | individual fact-flow/admission contracts for each added state/traversal plus matched parse-render and render measurements where work is hot. |
| Extend/provenance placement | `ast/extend/{ir,plan,emit,solve}.ts`, `ast/provenance.ts` | direct extend cases, imported-loop fixture, Bootstrap completion | admission counters for the imported-extend preflight, projection/overlay allocation proof, and Bootstrap plus benchmark non-regression. |

Current compiler-oracle capture, not an A/B claim: public built-artifact
`benchmark.less`, `collapseNesting: true`, produced 122,390 bytes with SHA-256
`ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6` in both
parse-render and render runs (20 warmups, 45 alternating pairs). It is useful as
the current output anchor only; it does not prove the semantic cutover is
performance-neutral.

### Serializer family audit: leaf emission (2026-07-21; no acceptance claim)

`packages/core/src/ast/serialize.ts` is still one physical file, but it must not
be treated as one cost surface. The current ownership split is:

| Family | Current owner | Boundary |
| --- | --- | --- |
| source-order collection | `emitDocumentStatements`, `emitNestedBody`, `walkBody` | statement order, async cursor, and declaration-group boundaries |
| reference lookup | `resolveReferenceResult` plus typed value/mixin dispatch | resolve a `Reference` chain without a source-text recovery path |
| selector resolution | selector interpolation/composition helpers plus extend planning | selector bytes and placement projection before rule emission |
| import preparation | `prepareBodyPlugins`, `planImportedExtends`, typed import dispatch | document/session facts before their source-order execution |
| leaf emission | `mergeFold`, `emitLeaf`, `emitNestedLeaf` | direct declaration/comment/call/at-rule byte emission |

The bounded audit family is **leaf emission**. It owns a `Leaf` already selected
by the source-order family and emits bytes directly. It must not acquire a
dialect policy, AST copy, output-node materialization, resolver re-walk, or a
second grouping pass. `mergeFold` is admitted only after the existing
`groupHasMerge` scan; ordinary leaves go straight to `emitLeaf`/
`emitNestedLeaf`.

- Behavior evidence: `pnpm --filter @jesscss/core test -- --run
  src/ast/__tests__/declaration-merge-direct-acceptance.test.ts
  src/ast/__tests__/at-rule-direct-acceptance.test.ts
  src/ast/__tests__/opaque-at-rule-block.test.ts
  src/ast/__tests__/import-at-rule.test.ts` — 37 tests passed.
- Current whole-render output anchor: `WARMUP=20 N=45 node
  packages/core/perf/bench-extend.mjs` emitted 122,390 bytes, SHA-256
  `ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6`, median
  74.0 ms (min 69.1, max 82.8). This measures the whole compiler route, **not**
  leaf emission, and is intentionally not a speed claim.

No aggressive-cutting cost-contract record is accepted for this audit: no
leaf-emission machinery was deleted or changed, and a total-render timing cannot
prove a leaf-only cost delta. A future leaf change needs a matched family-local
counter or profiling attribution, the canonical benchmark non-regression
protocol, and byte identity before it may claim neutral/decrease.

## Aggressive Cutting Self-Prosecution

### Current pass: imported extend semantic preflight

- **Architecture surface:** `planImportedExtends` / `bodyMayPlanExtend` in the
  one canonical AST serializer and the selector planner's typed `PlanOverlay`.
  No frontend-specific engine, bridge, parser host, raw source recovery, or
  alternate render route is involved.
- **Separation/duplication:** the profile hook observes facts already produced
  by the sole imported-extend path. It does not create a second planner, import
  resolver, selector representation, or evaluator.
- **Cumulative node weight:** zero canonical AST nodes, copied statements, or
  output nodes. The feature path retains only the pre-existing render-local
  overlay facts and placement tokens required by repeated canonical loop bodies.
- **New traversal:** `planImportedExtends` reads a loaded import's typed body in
  source order. `bodyMayPlanExtend` is intentionally an unbounded, explicit
  statement-stack scan: the import body is only known after Context/plugin
  resolution, so its extend fact cannot be carried by the importer. The scan is
  not a bounded admission probe and must not borrow the `precise` contract kind.
- **New node/materialization:** none. A false body scan never enters
  `collectPlacedExtendFacts`, `collectPlan`, selector-IR construction, overlay
  arrays, or loop-token allocation. A true imported loop creates only the
  existing render-local fact values and one token per concrete iteration; it
  never copies the AST or creates output nodes.
- **Render path:** this is a pre-render semantic fact pass. Ordinary emission
  remains `emitDocumentStatements`; the preflight writes no CSS and does not
  reparse source or perform a second output walk.
- **Helper/API surface:** one module-local, import-time-captured profile counter
  recorder is shared by `plan.ts` and the serializer. It is absent unless a test
  installs `__JESS_EXTEND_PROFILE_COUNTERS__` before loading core; it is not a
  mode, feature switch, Context option, or public API.
- **Metadata mutations:** none on canonical AST. Existing `Frame` placement
  tokens and render-session weak maps remain the sole placement state.
- **Danger-token accounting:** the source-order stack scan, `For` iteration,
  overlay facts, and weak-map tokens are semantic work only after a loaded body
  proves it can carry an extend. The false-path counter proof is specifically
  required because this owner cannot honestly claim a bounded cheap probe or a
  performance improvement.
- **Review-flagged diff tokens:** [loop/traversal] is the typed loaded-body
  preflight and concrete loop iteration; [array helper] and [array
  spread/materialization] are pre-existing selector/overlay fact collection;
  [node construction], [parent/source mutation], and [routine error control]
  have no owned instance here; [side map/set] is the existing render-session
  placement WeakMap; [materialized array/object] is the existing feature-path
  overlay and token state. The remaining matches are concurrently dirty
  AST/parser/evaluator work and are not attributed to this narrow owner.
- **Evidence:** `extend-preflight-contract.test.ts` proves the no-extend false
  path (`collectPlan`, collector, overlay, and loop placements all zero) and a
  two-item imported loop (one import, two concrete placements, two subjects and
  two instructions). `import-at-rule.test.ts` remains 25/25. A built-artifact
  public Compiler A/B against committed `6734da512`, with 20 warmups and 45
  alternating pairs, was byte-identical at 122,390 bytes / SHA-256
  `ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6`.
  Parse-render was 81.476→81.000 ms (26/45) and render was 14.281→14.101 ms
  (24/45). These are instrumentation/noise controls, not a speed or neutrality
  claim.
- Behavior evidence: `extend-preflight-contract.test.ts` exercises both the
  no-feature body and imported-loop feature path; direct parser suites remain
  responsible for their typed `Stylesheet` construction rather than borrowing
  this serializer contract.
- Build evidence: the release build and package-level TypeScript builds are the
  required proof for parser/frontend/public-plumbing edits; they are not runtime
  cost evidence and must be rerun for the assembled alpha candidate.
- Boundary evidence: parser frontend edits require the parser-runtime-boundary
  verifier plus public parser/plugin route tests; Context/public export edits
  require package export and packed-consumer checks. These boundary proofs are
  deliberately separate from the strict evaluator/render/lookup cost ledger.
- Hot-path cost contracts:
  ```json
  [{
    "id":"ast-extend-import-preflight",
    "verdict":"accepted",
    "necessity":{
      "status":"proven",
      "factSource":"A loaded import document's typed Rule, AtRuleBlock, and For bodies are the first authoritative source for whether imported selectors or concrete loop placements can contribute an extend.",
      "rediscovery":"Without the preflight, the renderer would discover imported extend facts after the root extend plan was already computed, losing source-order cross-import placement semantics.",
      "carryForward":"The loaded document body is inspected once in source order; only its existing typed selector facts and one token per concrete extend-bearing loop iteration are carried into the root plan overlay.",
      "whyNotCarried":"The importer cannot carry an arbitrary imported document's extend fact before Context/plugin resolution loads that document; the loaded typed body is the earliest truthful boundary."
    },
    "performanceClaim":"none",
    "why":"A loaded import is resolved during evaluation, so its typed body is the first authoritative source for whether extend planning is necessary. The explicit source-order scan returns before planner, collector, overlay, or loop-placement work on the exercised false path; treating it as a bounded micro-admission would be false.",
    "dangerTokensJustification":"The scan, concrete loop iteration, overlay facts, and placement tokens are semantic source-order work only after a loaded body proves it may carry an extend. The false path records zero collector, overlay, and loop work; the feature path records only the concrete imported-loop facts required by the existing root planner.",
    "falsePath":{"fixture":"extend-preflight-contract:no-extend","counters":{"calls":1,"collectorCalls":0,"overlaySubjects":0,"overlayInstructions":0,"loopPlacements":0}},
    "featurePath":{"fixture":"extend-preflight-contract:imported-loop","counters":{"importsVisited":1,"loopPlacements":2,"overlaySubjects":2}},
    "baseline":{"fixture":"benchmark.less","phase":"parse-render","currentMedianMs":81,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  },
  {
    "id":"ast-evaluator-function-call-boundary",
    "verdict":"accepted",
    "performanceClaim":"none",
    "why":"A FunctionCall that has no registered callable is an optional CSS function and must preserve authored call bytes without a diagnostic. Once a scoped or global callable has been selected, its synchronous or asynchronous rejection is an invocation result, so functionMode—not name resolution—decides preserve-and-warn versus propagation. MixinCall resolution never reaches this boundary.",
    "dangerTokensJustification":"The synchronous success path now creates neither a fallback closure nor a recovery closure. The fallback value is materialized only for an optional miss or a selected-callable failure; Promise.catch allocates only after a genuinely async callable result. This is a semantic policy correction with a structural hot-path deletion, not an A/B speed claim.",
    "cases":["unresolved-optional-function-call","registered-sync-call-failure","registered-async-call-failure"],
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":78.4,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  },
  {
    "id":"ast-value-guard-equality-modes",
    "verdict":"accepted",
    "performanceClaim":"none",
    "why":"Equality mode belongs to typed guard comparison. Less accepts a unitless number against an equal unit magnitude, Sass accepts equal quoted and keyword text while retaining unit distinction, and exact preserves the structural distinction. These choices are compatibility semantics, not parser or function-resolution behavior.",
    "dangerTokensJustification":"The comparison stays one typed value operation with no traversal, collector, AST node, side table, or fallback construction. It may recurse only through an already-materialized List when both operands are Lists; that pre-existing structural comparison is not changed by mode selection. The baseline is output identity only, not a speed claim.",
    "cases":["less-unitless-dimension","sass-quoted-keyword","exact-structural-distinction"],
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":78.4,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  },
  {
    "id":"ast-value-operate-preserve-calc",
    "verdict":"accepted",
    "performanceClaim":"none",
    "why":"Preserve-mode percentage multiplication must remain a calc result instead of inventing a scalar percentage. A later explicit calc or arithmetic operation must compose that result as one valid calc expression; loose mode keeps its Less numeric result. This is arithmetic result policy, not a second evaluator or an import/parser fallback.",
    "dangerTokensJustification":"The percent branch allocates only its required Keyword result. Calc byte inspection and parenthesis handling are an acknowledged transitional value-structure gap: authored calc has typed parser facts upstream, while a computed preserve result currently carries only bytes. This record makes no neutrality claim and does not conceal that remaining re-derivation debt.",
    "cases":["preserve-percentage-product","loose-percentage-product","explicit-calc-composition"],
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":78.4,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  }]
  ```
- **Verdict:** accepted semantic-preflight plus evaluator/value semantic-boundary
  contracts: behavior is proved; benchmark data is an output-identity baseline
  only and makes no performance claim.

### Addendum: nested Less `@media` conjunction (semantic parity, not a cost claim)

`emitAtRuleBlock` now defers a directly nested singleton `@media` group until
after its enclosing media block, then emits the two already-evaluated typed
qualifiers joined in source order. This intentionally changes CSS output to
match Less nesting semantics, so it cannot honestly use a neutral or
byte-identity cost contract. Comma-list media queries remain on the ordinary
nested path: correctness there requires a typed Cartesian product, not a
string split/join shortcut.

- **New traversal:** one deferred-media loop runs only after a mergeable parent
  media body has collected nested singleton media groups; it is required to
  retain source order while placing the child beside its parent.
- **New node/materialization:** no AST nodes, copies, side maps, or reparses.
  The renderer retains a small per-parent deferred-media array only for actual
  nested singleton media groups.
- **Render path:** typed `AtRuleBlock` and typed prelude values remain the sole
  input. Context/import dispatch is unchanged; imported document bodies use
  the existing callback and may participate in an already-open parent scope.
- **Helper/API surface:** one module-local serializer helper; no Context,
  parser, plugin, or public API surface changed.
- **Metadata mutations:** none.
- **Review-flagged diff tokens:** [loop/traversal] emits the deferred sibling
  groups; [materialized array/object] is the bounded feature-only deferred
  group state. Neither occurs on ordinary non-nested at-rules.
- **Evidence:** core direct-AST tests prove ordered conjunction and that a
  comma-list stays nested; public Jess/Less tests prove nested media output and
  typed import-media behavior; core and Jess production builds pass.
- **Verdict:** accepted semantic output correction. No performance, neutrality,
  or whole-corpus byte-identity claim is made.

### Addendum: Less URL transform dispatch (semantic parity, not a cost claim)

`Context.transformUrl` carries the active document's existing source identity
and the render entry identity to that document's parser plugin. The Less
plugin owns `rootpath`, `rewriteUrls`, and `urlArgs` transformation; it does
not resolve, load, scan, or re-parse a URL. Structured `Url` emission retains
quoted versus bare syntax before dispatch.

- **Behavior evidence:** `tests-config/rewrite-urls-all`,
  `rewrite-urls-local`, `rootpath-rewrite-urls-all`, and
  `rootpath-rewrite-urls-local` pass byte-identically through the public Less
  fixture harness, including URLs authored in an imported document. The
  compiler preserves configured native Less-plugin hooks while retaining the
  per-render option-bearing Less adapter.
- **Remaining gap:** `tests-config/static-urls` and `url-args` remain expected
  failures because both first stop at the distinct multiline data-URI grammar
  case. This URL transform pass does not claim to implement that grammar.
- **Cost/gate status:** no performance or neutrality claim. This is not an
  aggressive-cutting cost contract, and the aggregate
  `verify:aggressive-cutting-review` result remains globally red on existing
  evaluator/value/extend/context inventory unrelated to this behavior entry.
