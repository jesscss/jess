# `packages/core/src/tree/` — cutover surface

Measured on `04e245b5610309472b0879433333bcdb7447bbaa` (`origin/dev`, 2026-07-25).
The recognition package was observed under its current name
`packages/internal-css-recognition` (`@jesscss/internal-css-recognition`); the
rename to `packages/parser-shared` had not landed at this SHA, so every path
below uses the old name. The config package is `styles-config`.

This is an inventory and a sequencing argument for deleting `tree/`. It records
no status and proposes no schedule.

**Current status update:** the root `export * from './tree/index.js'` described
below has since been removed. Keep the measured inventory as provenance for the
remaining internal deletion work, but do not treat the historical root-export
counts as the current public `@jesscss/core` surface.

## Method

Three passes, each stated because two of them correct an earlier, wrong version
of this document.

1. **Export sets** — resolved with the TypeScript checker (`getExportsOfModule`,
   typescript@5.9.3) against **source**, not `lib/`; there is no built `lib/` in
   this worktree, so no count here depends on a build artifact being current.
2. **Consumer edges** — every `packages/*/src/**` file parsed with the TS parser,
   reading real import/export declarations, so a name is counted where it is
   *bound*. Then, for each consuming file, **every identifier reference resolved
   to a usage position** — `CONSTRUCT` / `INSTANCEOF` / `CALL` / `MEMBER-READ` /
   `VALUE-REF` / type — because whether the import statement said `import type`
   does **not** tell you whether the use is a runtime use. Property-access names
   and export specifiers were excluded as non-references.
3. **`Context` dependency** — a **runtime-usage audit**, not an import audit
   (§2b): a real program, checker-resolved object types, and each accessed
   member's declared type walked for tree-declared symbols. This one needed
   `node_modules`, so the worktree's was symlinked to the main checkout's for the
   audit and removed afterwards; relative imports still resolved inside the
   worktree, and the pass carries an explicit health check that types actually
   resolved.

Two rules the earlier version broke, now enforced throughout: **classify by
resolved symbol kind, never by name** — a `class` and an `interface` share a name
and differ in the only property that decides whether a consumer breaks — and
**an import audit cannot establish a runtime boundary** (§5.6).

Where a claim is an observation it is cited at `file:line`. Where it is an
interpretation it is labelled as one.

---

## 1. The public surface

`packages/core/src/index.ts:10` is `export * from './tree/index.js'`. That
wildcard resolves to **200 names**. `src/index.ts` additionally re-exports **35**
more names declared under `src/tree/` by explicit `export {}` at lines 41–92.

**235 of `@jesscss/core`'s 319 root exports are declared inside `tree/`** — 74%
of the package's public API by name count.

Nothing in the source distinguishes a deliberate export from one that fell out of
the wildcard. The 35 explicit re-exports are the only names anyone ever wrote
down on purpose, and 33 of them have no external consumer either.

**All 235 are going away.** `tree/` is deleted in full. The question this section
answers is not which names survive — none do — but *what the canonical AST/value
API must provide before each one can go*.

### The axis: what v2 must provide

| bucket | count | rule |
| --- | --- | --- |
| **removable now** | 223 | no consumer, or the only consumers are themselves being deleted |
| **needs a v2 type** | 1 | every consumer use is in type position; an `ast/` interface genuinely suffices |
| **needs a v2 runtime** | 11 | consumers construct it, `instanceof` it, read an enum member off it, or pass it as a value; an interface cannot serve |
| **needs a semantic ruling** | (gates 6 of the 11) | the Sass map key-comparison question |

External = `packages/*/src` excluding `core`, excluding `__tests__`/`*.test.ts`.

**Zero tree names are consumed only by tests.** The only public core export in
that category is `RuntimeFunction` (`src/define-function.ts:178`), used at
`packages/fns/src/__tests__/sass-map-functions.test.ts:1` and
`packages/fns/src/sass/__tests__/map-functions.test.ts:1` and nowhere in
production — and it is a `define-function.ts` symbol, not a tree one.

### How the buckets were decided (and a correction)

An earlier cut of this document classified names by **matching them against
`ast/` and `./value` by name**. That was wrong, and wrong in a way the rest of the
document had already avoided: export *sets* were resolved with the TS checker,
but bucket *membership* was decided on text. A class and an interface of the same
name match on text and differ in the only property that decides whether a
consumer breaks.

Redone by resolved symbol kind. Across the 235:

| resolved kind | n |
| --- | --- |
| `type` | 68 |
| `const` | 56 |
| `function` | 52 |
| `class` | 33 |
| `class` + `interface` (declaration merging) | 19 |
| `enum` | 4 |
| `interface` | 3 |

**45 tree names also exist in `./ast` or `./value`. In 27 of those the tree
symbol is a `class` and every counterpart is an `interface` or a `type`** — that
is *every shared node name*, without exception:

`Any`, `AtRuleStatement`, `Block`, `Bool`, `Collection`, `Color`, `Combinator`,
`Comment`, `ComplexSelector`, `CompoundSelector`, `Condition`, `Declaration`,
`Dimension`, `For`, `If`, `Keyword`, `List`, `Nil`, `Node`, `Operation`,
`PseudoSelector`, `Quoted`, `Range`, `Reference`, `SelectorList`, `Sequence`,
`SimpleSelector`.

The other 18 collisions are `function`/`const` on both sides (`isNode`,
`sourceSpanOf`, `isBracketedList`, `any`, `block`, `color`, `comment`,
`condition`, `decl`, `dimension`, `forNode`, `ifNode`, `keyword`, `list`,
`quoted`, `range`, `sel`, `spaced`) — those exist at runtime in both domains,
though several still denote different things (see §5.7).

*Observation:* **not one tree node class has a runtime counterpart anywhere in
v2.** The tree versions exist at runtime — `new Dimension(...)`,
`x instanceof Dimension`, `type: Quoted` as a param token. The `ast/` and
`./value` versions are erased at compile time.

Bucket membership was then decided **per consumer, per reference**, by parsing
each consuming file and classifying every identifier reference as type-position
or one of `CONSTRUCT` / `INSTANCEOF` / `CALL` / `MEMBER-READ` / `VALUE-REF`,
rather than inferring from whether the import statement said `import type`. That
distinction mattered: `Collection`, `Node`, `Quoted` and `Dimension` are all
imported without `type` **and** used in type position at most sites — but each
has at least one `new` or token site that decides the bucket. Two false-positive
classes were removed from the pass before the counts below: property-access names
(`N.Declaration` is not a reference to an imported `Declaration`) and export
specifiers (`export type { ExtendedFn }` is not a value use).

### 1a. needs a v2 runtime — 11

Every use below is a **runtime** use, cited at `file:line`. The useful column is
the last one.

| name | tree decl | how it is actually used | what v2 must provide |
| --- | --- | --- | --- |
| `Any` | `any.ts:31` (class+interface) | `new Any(str)` — `map/get.ts:16,21`, `map/set.ts:48`, `map/values.ts:15,20` | a factory for "a stringified map value". `./value` already has `makeKeyword` (`value-factory.ts:136`) and `makeQuoted` (:130) — **which one is the ruling**, not a missing primitive |
| `Bool` | `bool.ts:6` (class+interface) | `new Bool(b)` — `map/has-key.ts:50,56,67` | **already provided**: `makeBool` (`value-factory.ts:139`) |
| `Collection` | `collection.ts:19` (class) | `new Collection(...)` — `map/merge.ts:47`, `map/remove.ts:33`, `map/set.ts:64`; as a `defineFunction` param token — `map/get.ts:88`, `has-key.ts:73`, `keys.ts:34`, `values.ts:39`, `merge.ts:53,57`, `remove.ts:39`, `set.ts:70` | **already provided**: `makeCollection` (`value-factory.ts:156`), and `'Collection'` is a member of `Value` (`value-eval.ts`) so `type: 'Collection'` is expressible in a `ParamSpec` |
| `Declaration` | `declaration.ts:619` (class) | `new Declaration(...)` — `map/set.ts:50` | nothing new. `makeCollection` takes `readonly CollectionEntry[]` (`value-factory.ts:156`) and `CollectionEntry` (`value-eval.ts:188`) is a plain `{key, value}` object literal needing no constructor. The blocker is the **model change**, not a missing factory — see the ruling below |
| `Dimension` | `dimension.ts:48` (class+interface) | `new Dimension(...)` — `str-index.ts:27`; `instanceof` — `mathHelper.ts:9,11,22,31,35`, `number.ts:10`, `raw-color-args.ts:7`; param token — `str-insert.ts:63`, `str-slice.ts:102,107` | `makeDimension` (`value-factory.ts:57`) covers construction. `instanceof` has **no** translation — the value domain discriminates on `.type`, so the provision is a kind check, not a class. (All the `instanceof` sites are in `fns/src/util/*`, removed by step 1.) |
| `List` | `list.ts:213` (class+interface) | `new List(...)` — `map/keys.ts:28`, `map/values.ts:33` | **already provided**: `makeList` (`value-factory.ts:141`) |
| `N` | `node-type.ts:17` (enum) | `N.Declaration` / `N.Collection` enum member reads at runtime — `map/{get:43,66; has-key:32,55; keys:23; merge:21,28; remove:26; set:26,41; values:29}` | **missing as a runtime table by design.** `Kind = Value['type']` (`functions/types.ts`) is a *type*, not a runtime enum; `./ast`'s `AST_NODE_TYPES` (`ast/node.ts:108`) is the ast domain, not the value domain. Provision: rewrite consumers to compare `.type` string literals directly unless a real runtime table earns its keep |
| `Nil` | `nil.ts:18` (class+interface) | `new Nil()` — `map/get.ts:61,67,79` | **missing.** `./value` exports `Nil` as a type only (`value-eval.ts:169`); there is no `makeNil` in `value-factory.ts` — verified, the factory block exports `makeDimension`/`makeColorRgb`/`makeColorHsl`/`makeQuoted`/`makeKeyword`/`makeBool`/`makeList`/`makeBlock`/`makeCollection` and nothing else. Provision: a nil constant or factory |
| `Node` | `node-base.ts:485` (class) | `x instanceof Node` — `map/get.ts:18`, `map/values.ts:17`; param token — `map/get.ts:92,96`, `has-key.ts:77,81`, `remove.ts:43`, `set.ts:74,78` | the universal is `ValueGroup`/`Value` (`value-eval.ts`) with `isValueGroup` as the guard. Provision: use `isValueGroup` for runtime validation and `type: 'any'` as the param-token equivalent |
| `Quoted` | `quoted.ts:20` (class+interface) | `new Quoted(s, {quote})` — `map/keys.ts:25`, `quote.ts:21`, `str-insert.ts:49`, `str-slice.ts:28,82,92`, `to-lower-case.ts:16`, `to-upper-case.ts:16`, `unique-id.ts:25`, `unquote.ts:19`; param token — 6 more sites | **already provided**: `makeQuoted` (`value-factory.ts:130`) |
| `isNode` | `util/is-node.ts:18` (function) | `isNode(x, N.Declaration)` — 11 call sites across `map/*` | `./ast`'s same-named `isNode` (`ast/node.ts:118`) narrows **ast** nodes by string `NodeType` — wrong domain. Provision: a value-domain narrow-by-kind helper, **or** drop to `.type ===`. `isCollection` (`value-collection.ts:18`) is the one such helper that exists |

*Interpretation:* four of the eleven (`Bool`, `Collection`, `List`, `Quoted`)
need **nothing new** — the factory already exists and the port is mechanical.
Three (`N`, `Nil`, `isNode`) need a small, uncontroversial addition to `./value`.
Two (`Any`, `Declaration`) are blocked on the ruling below. `Dimension` and
`Node` are mixed: their construction sites are covered, their `instanceof` sites
are not, and every `instanceof` site is in code step 1 deletes.

### 1b. needs a v2 type — 1

| name | tree decl | consumer | what v2 must provide |
| --- | --- | --- | --- |
| `LocationInfo` | `node-base.ts:112` (`type`) | `packages/jess/src/output.ts:1` — pure type position, verified per reference | **already provided**: `./ast` `AstSourceSpan` (`ast/provenance.ts:8`) is `Readonly<{start:number;end:number}>`, structurally identical to `LocationInfo` at `node-base.ts:111` |

`ColorData` (`color.ts:71`) and `ExtendedFn` (`call.ts:532`) are also pure
type-position — `ExtendedFn`'s only occurrence is the re-export specifier at
`fns/src/util/index.ts:4` — but both sit in code step 1 deletes, so they are
counted under *removable now*.

### 1c. needs a semantic ruling — the map key model

One question, gating `Any`, `Declaration`, `Collection`, `Node`, `N` and `isNode`
in the seven `packages/fns/src/sass/map/*.ts` modules.

Those modules model a map entry as a tree `Declaration` and find one by
stringifying `Declaration.name` and comparing (`map/get.ts:41–49` —
`String(node.name.valueOf()) === keyStr`). The value domain models an entry as
`CollectionEntry` (`value-eval.ts:188`), whose `key` is a full `ValueGroup`, and
`Collection`'s own contract says entries are *"ORDERED and key-equality-sensitive,
matching Sass map semantics"* (`value-eval.ts:212–213`) — **without defining the
comparison**. That definition is the ruling: whether `1` and `1px` collide,
whether `"a"` and `a` collide, whether comparison is on `bytes` or on structure.

This is a data-model change, not a rename, and it is the only genuinely semantic
decision in the whole cutover.
### 1d. removable now — 223

**Nine** of these are externally consumed, but *only* from modules inside
`packages/fns/src/util/` that no `@jesscss/fns` entry point reaches. `fns`
publishes `.`, `./less`, `./sass`, `./shared`, `./registry`, `./less/registry`,
`./sass/registry` and `./sass/{color,list,map,math,string}`
(`packages/fns/package.json`). `packages/fns/src/util/index.ts` is not among
them, and it exports only `ExtendedFn` (a type re-export, line 1–4) and
`wrapValidate` (line 24). A grep over all of `packages/fns/src` for imports of
`colorHelper`, `raw-color-args`, `relative-color`, `mathHelper`, `util/number`,
`get-color-func-values`, `preserve-hex`, `color-output`, `get-luma`, `to-hsl`,
`to-hsv` finds exactly one edge, from a test:
`packages/fns/src/less/__tests__/luma-luminance-hsv-channels.test.ts:13`. The
only `../util` / `./util` imports that *are* live are
`packages/fns/src/less/image-helper.ts:4` (`util/image-dimensions.js`) and
`packages/fns/src/less/data-uri.ts:4` (`util/mime.js`) — neither touches tree.

| name | tree decl | sole consumers (all unreachable) |
| --- | --- | --- |
| `Call` | `src/tree/call.ts:553` | `fns/src/util/relative-color.ts:8` |
| `Color` | `src/tree/color.ts:86` | `fns/src/util/{color-output.ts:2, colorHelper.ts:1, get-color-func-values.ts:5, get-luma.ts:1, preserve-hex.ts:1, relative-color.ts:6, to-hsl.ts:1, to-hsv.ts:1}` |
| `ColorData` | `src/tree/color.ts:71` | `fns/src/util/color-output.ts:4` |
| `ColorFormat` | `src/tree/color.ts:18` | `fns/src/util/color-output.ts:3`, `preserve-hex.ts:1` |
| `ExtendedFn` | `src/tree/call.ts:532` | `fns/src/util/index.ts:1` |
| `Num` | `src/tree/number.ts:15` | `fns/src/util/mathHelper.ts:1` |
| `Operation` | `src/tree/operation.ts:66` | `fns/src/util/get-color-func-values.ts:3`, `relative-color.ts:10` |
| `Sequence` | `src/tree/sequence.ts:122` | `fns/src/util/get-color-func-values.ts:6`, `relative-color.ts:4` |
| `sourceSpanOf` | `src/tree/util/provenance.ts:71` | `fns/src/util/relative-color.ts:12` |

*Interpretation:* `packages/fns/src/util/` is the residue of the pre-value-domain
`fns`, kept alive only by its own internal edges. It is a deletion, not a
migration. Confirming that is the cheapest single step in the whole cutover.

The remaining **214** have no external consumer of any kind — production or
test — grouped by declaring file (`*` = reached through an explicit
`export {}` in `src/index.ts`, not the wildcard):

| declaring file | n | names |
| --- | --- | --- |
| `src/tree/ampersand.ts` | 3 | `Ampersand`, `AmpersandValue`, `amp` |
| `src/tree/any.ts` | 5 | `AnyOptions`, `AnyRole`, `Keyword`, `any`, `keyword` |
| `src/tree/at-rule-statement.ts` | 5 | `AtRuleStatement`, `AtRuleStatementField`, `AtRuleStatementName`, `AtRuleStatementValue`, `atrulestatement` |
| `src/tree/at-rule.ts` | 8 | `AtRule`, `AtRuleOptions`, `AtRuleParts`, `AtRulePrelude`, `AtRuleValue`, `NESTABLE_AT_RULES`, `ROOT_ONLY_AT_RULES`, `atrule` |
| `src/tree/block.ts` | 3 | `Block`, `BlockOptions`, `block` |
| `src/tree/bool.ts` | 2 | `bool`, `createPublicBool` |
| `src/tree/call.ts` | 4 | `CallOptions`, `CallValue`, `call`, `isCalcCall` |
| `src/tree/collection.ts` | 1 | `coll` |
| `src/tree/color.ts` | 2 | `ColorOptions`, `color` |
| `src/tree/combinator.ts` | 3 | `Combinator`, `Combinators`, `co` |
| `src/tree/comment.ts` | 3 | `Comment`, `CommentOptions`, `comment` |
| `src/tree/condition.ts` | 5 | `Condition`, `ConditionOperator`, `ConditionOptions`, `ConditionValue`, `condition` |
| `src/tree/control.ts` | 11 | `For`, `ForIterable`, `ForPattern`, `If`, `IfValue`, `StructuredLoopValue`, `While`, `WhileValue`, `forNode`, `ifNode`, `whileNode` |
| `src/tree/declaration-var.ts` | 3 | `VarDeclaration`, `VarDeclarationOptions`, `vardecl` |
| `src/tree/declaration.ts` | 13 | `AssignmentType`, `DeclarationMergeAdapterState`, `DeclarationName`, `DeclarationOptions`, `DeclarationParams`, `DeclarationValue`, `collectDeclarationMergeAdapterItems`, `createDeclarationMergeAdapterState`, `decl`, `declarationNameKey`, `declarationOptionsMerge`, `finalizeContextualImportantPublicState`, `finalizeContextualImportantState` |
| `src/tree/default-guard.ts` | 2 | `DefaultGuard`, `defaultguard` |
| `src/tree/dimension.ts` | 2 | `DimensionValue`, `dimension` |
| `src/tree/expression.ts` | 2 | `Expression`, `expr` |
| `src/tree/extend.ts` | 4 | `Extend`, `ExtendFlag`, `ExtendValue`, `extend` |
| `src/tree/extend/spine-extend.ts` | 4 | `engageExtendLayer*`, `extendLayerCounter*`, `isSpineExtendTopology*`, `treeHasExtend*` |
| `src/tree/function.ts` | 4 | `Func`, `FuncOptions`, `FuncValue`, `fn` |
| `src/tree/interpolated.ts` | 5 | `INTERPOLATION_PLACEHOLDER`, `Interpolated`, `InterpolatedOptions`, `InterpolatedValue`, `interpolated` |
| `src/tree/js-array.ts` | 2 | `JsArray`, `jsarray` |
| `src/tree/js-function.ts` | 2 | `JsFunction`, `jsfunc` |
| `src/tree/js-object.ts` | 2 | `JsObject`, `jsobj` |
| `src/tree/list.ts` | 3 | `ListOptions`, `list`, `renderListValueSyntax` |
| `src/tree/log.ts` | 4 | `Log`, `LogLevel`, `LogValue`, `log` |
| `src/tree/mixin.ts` | 4 | `Mixin`, `MixinOptions`, `MixinValue`, `mixin` |
| `src/tree/negative.ts` | 2 | `Negative`, `negative` |
| `src/tree/nil.ts` | 2 | `createPublicNil`, `nil` |
| `src/tree/node-base.ts` | 4 | `F_HAS_NODE_CHILD`, `F_NON_STATIC`, `F_STATIC`, `F_VISIBLE` |
| `src/tree/number.ts` | 1 | `num` |
| `src/tree/operation.ts` | 2 | `OperationValue`, `op` |
| `src/tree/paren.ts` | 3 | `Paren`, `ParenOptions`, `paren` |
| `src/tree/query-condition.ts` | 2 | `QueryCondition`, `query` |
| `src/tree/quoted.ts` | 2 | `QuotedOptions`, `quoted` |
| `src/tree/range.ts` | 4 | `Range`, `RangeOptions`, `RangeValue`, `range` |
| `src/tree/reference.ts` | 4 | `Reference`, `ReferenceOptions`, `ReferenceValue`, `ref` |
| `src/tree/rules.ts` | 6 | `Rules`, `RulesOptions`, `RulesVisibility`, `hasCarriedMergeOutputSurface`, `resolveRulesetBySelector`, `rules` |
| `src/tree/ruleset.ts` | 3 | `Ruleset`, `RulesetValue`, `ruleset` |
| `src/tree/selector-basic.ts` | 2 | `BasicSelector`, `el` |
| `src/tree/selector-complex.ts` | 7 | `ComplexSelector`, `ComplexSelectorComponent`, `ComplexSelectorValue`, `RelativeSelector`, `isStringCombinator`, `rel`, `sel` |
| `src/tree/selector-compound.ts` | 4 | `CompoundSelector`, `CompoundSelectorComponent`, `compound`, `isStringCompoundSelectorComponent` |
| `src/tree/selector-list.ts` | 11 | `SelectorList`, `SelectorListItem`, `SelectorListLike`, `emitSelectorListItems`, `emitSelectorListLike`, `finishSelectorListSurface`, `isSelectorListLike`, `selectorListItems`, `selectorListValueOf`, `selectorSurfaceValueOf`, `sellist` |
| `src/tree/selector-pseudo.ts` | 5 | `PseudoSelector`, `PseudoSelectorValue`, `createGeneratedIsPseudo`, `is`, `pseudo` |
| `src/tree/selector-simple.ts` | 1 | `SimpleSelector` |
| `src/tree/selector.ts` | 4 | `Selector`, `SelectorLike`, `SelectorValue`, `attachSelectorBitLibrary` |
| `src/tree/sequence.ts` | 3 | `SequenceOptions`, `seq`, `spaced` |
| `src/tree/util/calculate.ts` | 1 | `Operator` |
| `src/tree/util/emit-walk.ts` | 2 | `isSpineEligibleRoot*`, `spineRenderCounter*` |
| `src/tree/util/list-like.ts` | 4 | `ListItems*`, `coerceListItems*`, `getListSeparator*`, `isBracketedList*` |
| `src/tree/util/print.ts` | 1 | `PrintOptions*` |
| `src/tree/util/provenance.ts` | 12 | `SourceSpan*`, `copySourceSpan*`, `fieldSpanAt*`, `fieldSpansOf*`, `isSourceFree*`, `setFieldSpans*`, `setSourceSpan*`, `setValueSpans*`, `spanEndOf*`, `spanStartOf*`, `valueSpanAt*`, `valueSpansOf*` |
| `src/tree/util/render-buffer.ts` | 4 | `FlatRenderBuffer*`, `RenderBuffer*`, `createRenderBuffer*`, `finalizeFlatRenderBuffer*` |
| `src/tree/util/serialize-types.ts` | 2 | `SerializeTypesOptions*`, `serializeTypes*` |
| `src/tree/util/should-operate.ts` | 2 | `MathFrameState*`, `shouldOperateWithMathFrames*` |
| `src/tree/util/trivia.ts` | 2 | `createTriviaMap*`, `makeTrivia*` |

## 2. `Context` — settled: rewrite it tree-free

**Owner decision, settled:** there is one `Context`, and it is tree-free. Not a
narrow interface sliced out of the current class with the tree-carrying remainder
left behind to die with `tree/` — that leaves two Context-shaped things and a
permanent seam between them. One `Context`.

### 2a. Correction: `ast/` runs on a live `Context` instance

An earlier cut of this document claimed the v2 path "has no runtime edge to
`context.ts` at all". **That was wrong, and it was wrong by exactly the mechanism
§5.6 of this document warns about.** The claim came from an import audit;
`ast/serialize.ts:127` is `import type { Context }`, so the *module-graph* edge
is erased — and an import audit therefore reports the boundary clean. The
*dependency* is not erased. A real `Context` instance flows in at runtime:

| site | what it is |
| --- | --- |
| `src/ast/serialize.ts:186` | `context?: Context` — a field of the public `SerializeOptions` |
| `src/ast/serialize.ts:301` | `function importThroughContext(context: Context)` |
| `src/ast/serialize.ts:1215` | `context: Context \| undefined` parameter |
| `src/ast/serialize.ts:1890, 3748, 3780` | `e.context?.sourceContext?.file` |
| `src/ast/serialize.ts:3881` | `e.context?.sourceContext?.plugin?.supportedExtensions?.includes('.less')` |
| `src/ast/serialize.ts:5338` | `options?.context ? importThroughContext(options.context) : undefined` |
| `packages/jess/src/index.ts:1074` | `const context = new Context(contextOptions, plugins)` — the instance's origin |

So `tree/` is loaded in any real v2 render, because `Context` is imported as a
*value* by `jess` and `context.ts` imports tree at lines 12, 23, 38, 39, 40.
**That puts the `Context` rewrite on the critical path, not in the cleanup tail.**

*This is the single most instructive finding in the analysis, and it is worth
stating plainly: the check reported clean because it could not see the failure
mode it was looking for.* The import graph and the object graph are different
graphs.

(The `ast/` → `tree/` finding itself still stands and was verified separately:
`grep -rn "from '.*tree\|import(.*tree"` over `packages/core/src/ast/` excluding
`__tests__` returns **no matches**, and the dependency runs the other way —
`src/tree/util/round.ts:9` is `export { round } from '../../ast/round.js'`.
`ast/` does not depend on tree. It depends on `Context`, which does.)

### 2b. Re-derived by runtime-usage audit, not by imports

Method, since this claim is now load-bearing for the sequencing: a TypeScript
program over all of `packages/core/src/ast/**` (excluding `__tests__`) plus
`src/context.ts`, then a second program over `packages/{jess,jess-plugin-less,
jess-plugin-less-compat,fns}/src/**` with `@jesscss/core` mapped to
`packages/core/src/index.ts`. Every `PropertyAccessExpression` whose **object
type resolves to the `Context` class declared at `src/context.ts`** was
collected, the accessed property's symbol resolved, and its declared type walked
(unions, type arguments, call-signature parameters and returns, depth 6) for any
symbol declared under `src/tree/`.

Health check, because a program that fails to resolve types would report "no
tree" for the wrong reason: `Context`'s class symbol resolved, `Context.sourceContext`
resolved to `SourceContext | undefined`, and **every** member below printed a
concrete declared type — none degraded to `any` or an error type. 67
unresolved-module errors remain (all external packages: `@jesscss/awaitable-pipe`,
`lodash-es`, `color-name`, …); none of them appears in any member type below.
This required `node_modules` to be resolvable, so the worktree's `node_modules`
was symlinked to the main checkout's for the audit and removed afterwards —
relative imports (`context.ts`, `tree/*`, `ast/*`) still resolved inside the
worktree, so no result here comes from the main checkout's sources.

**Context members accessed at runtime from `packages/core/src/ast/` — 14, none tree-typed:**

| member | declared type | tree-typed? |
| --- | --- | --- |
| `sourceContext` | `SourceContext \| undefined` | no |
| `options` | `ResolvedOptions` | no |
| `opts` | `ContextOptions` | no |
| `entryFilePath` | `string` | no |
| `evaluator` | `ValueEvaluator \| undefined` | no |
| `registerValueEvaluator` | `(evaluator: ValueEvaluator) => void` | no |
| `warn` | `(warning: WarningDiagnostic \| JessError, options?: { code?: string }) => void` | no |
| `transformUrl` | `(value: string, quoted: boolean) => string` | no |
| `loadImport` | `(importPath: string, importOptions?: ImportOptions) => Promise<{ node: Stylesheet \| null; triedPaths: string[]; resolvedPath: string } \| undefined>` | no |
| `readBinary` | `(importPath: string) => Promise<Buffer>` | no |
| `withDocument` | `<T>(document: Stylesheet, run: () => T \| Promise<T>) => T \| Promise<T>` | no |
| `rememberDocumentBody` | `(document: Stylesheet, body: object) => void` | no |
| `currentSourceOwner` | `() => object \| null` | no |
| `withSourceOwner` | `<T>(owner: object \| null \| undefined, run: () => T \| Promise<T>) => T \| Promise<T>` | no |
| `sourceOwnerForBody` | `(body: object) => object \| null` | no |

**Context members accessed at runtime from `jess` / plugins / `fns` — 15, none tree-typed:**
`errors`, `warnings`, `finalizeWarnings`, `getPluginModule`, `getTree`,
`parseString`, `resolveImportPath`, `sourceTrees`, `pluginHost`, `plugins`,
`opts`, `readBinary`, `evaluator`, `registerValueEvaluator`, `withDocument`.

Union (four overlap): **24 distinct externally-reachable members, zero
tree-typed.** The constructor is `(opts?: ContextOptions, plugins?: PluginInterface[])`
— both parameters tree-free.

Bodies checked too, not just signatures: **24 of 24** externally-reachable
members have bodies containing no reference to any tree-typed `Context` member
and no reference to any of the 14 tree symbols `context.ts` imports.

### 2c. The size of the rewrite

`Context` declares **106 members**. **33 are tree-typed. Zero of those 33 is
reachable from `ast/`, `jess`, the plugins, or `fns`.**

The 33, with the tree symbols in their declared types:

| member | tree symbols |
| --- | --- |
| `currentCharset` :611 | `Any`, `AnyRole`, `AtRuleStatement` |
| `topImports` :617 | `Node` |
| `rulesContext` :624 · `root` :627 · `treeRoot` :649 · `allRoots` :650 | `Rules` |
| `caller` :653 · `_callStack` :840 · `callStack` :841 | `Call` |
| `spineMixinSurfaceSink` :668 · `spineRootCallEmitFrame` :691 · `rulesEvalStack` :919 · `evaldTrees` :958 | `Rules` |
| `extendRoots` :709 | `ExtendRootRegistry` |
| `spineMergePlan` :738 | `SpineMergePlan`, `Node` |
| `registerEmitVisitor` :747 | `Node` |
| `documentOrderByRuleset` :755 · `rulesetFrames` :809 | `Ruleset` |
| `extends` :761 | `Selector`, `Rules`, `Node` |
| `_searchScope` :770 · `searchScope` :771 | `Node` |
| `selectorBits` :784 | `BitSetLibrary` |
| `selectorAnalysis` :791 | `SelectorAnalysis` |
| `_printState` :803 · `printState` :804 | `PrintOptions` |
| `spineResolvedFrameSelector` :821 | `Ruleset`, `Selector`, `Nil` |
| `frames` :824 | `Ruleset`, `AtRule` |
| `_callMap` :835 · `callMap` :836 | `CallMap` |
| `_importantSourceStack` :902 · `pushImportantSource` :907 · `popImportantSource` :911 | `Any` |
| `shouldOperate` :1544 | `Operator`, `Node` |

*So the honest headline is not "rewrite Context". It is:* **delete 33 members and
10 imports; keep 73, including all 25 the outside world touches; the constructor
already qualifies.** Every deleted member is legacy-eval state that leaves with
the engine. By the evidence this step is **mechanical** — no external caller
loses anything and no v2 behaviour changes.

Two residual notes, both narrow:

- Of the ten tree imports, two are **tree-located**, not tree-shaped: `Operator`
  (`tree/util/calculate.ts:1` — the file has **zero imports**; the type is
  `'+' | '-' | '*' | '/' | '%'`) and `BitSetLibrary` (`tree/util/bitset.ts:54` —
  its only import is the `bitset` npm package). `CallMap`'s runtime is likewise
  tree-free (both its imports at `tree/util/recursion-helper.ts:1–2` are
  `import type`); only its `CallSignature` type is not. The *members* that use
  these are all inside the deleted 33, so Context does not need them relocated —
  but `Operator` is separately public (`src/index.ts:51`), so its home is a
  question for step 3, not for Context.
- `context.ts:738` declares `spineMergePlan` with an inline
  `import('./tree/util/spine-merge.js').SpineMergePlan`. A grep for
  `from '…/tree'` does not see it (§5.5).

`packages/core/src/tree/util/provenance.ts` deserves the same note even though
`context.ts` does not import it: it has **zero imports** and its API is duck-typed
over `unknown` and `object` (`readEvalErrorLocation`, line 177;
`stampEvalErrorLocation`, line 159). It is entirely tree-located despite
contributing 13 names to the public surface.

## 3. The value boundary — a decision, not a recommendation

### What is actually there

`packages/core/src/define-function.ts` and `conversions.ts` are the only
non-`tree/`, non-`context.ts` runtime files that import tree node classes:

- `define-function.ts:3,4,8` — `isNode`, `N`, `List`, `Dimension`
- `conversions.ts:1,2,3` — `Dimension`, `Num`, `Sequence`, `Operation`, `isNode`, `N`

The legacy contract is **constructor-reference-based**. `ArgType` is
`PrimitiveType | Class<any> | AbstractClass<any>` (`define-function.ts:11`); a
param is declared by passing the tree class itself as a runtime value
(`packages/fns/src/sass/quote.ts:27` — `type: Quoted`), and the body's
parameter type is recovered by `InstanceType<T>` (`define-function.ts:105`).
That is exactly why `fns` must import `Dimension` and `Color` as *values*: they
are the type tokens.

`./value` already exposes a complete replacement:

- `defineFunction` (`src/ast/value-dispatch.ts:181`), `createFnRegistry` (line 263)
- `ParamSpec` with `type: Kind | readonly Kind[] | 'any'` where `Kind = Value['type']`
  (`src/ast/functions/types.ts:20,22`) — a **string** discriminant, so a param
  spec carries no constructor reference at all
- `FnSpec`/`PositionalSpec`/`VariadicSpec` (`functions/types.ts:89,102,107`),
  `FnCtx` (line 59), `FnIo` (line 73), `DefinedFunction` (line 167), `Fn` (line 181)
- the value constructors `makeDimension`/`makeColorRgb`/`makeQuoted`/… (`src/ast/value-factory.ts`)

`packages/core/src/ast/functions/types.ts:15` states the boundary explicitly:
*"HARD MODULE BOUNDARY: value domain only — no `../tree`, no legacy nodes."*

### The gap, precisely

Not "`fns` needs `Dimension`". The gap is **fourteen unconverted fn modules**,
and it is smaller than it looks because eight of them already have finished
value-domain twins sitting next to them.

**Gap A — eight Sass string globals that are already ported but not wired.**
`packages/fns/src/sass/index.ts:90–97` exports the *legacy* modules:

```
export { default as unquote }     from './unquote.js';       // :90
export { default as quote }       from './quote.js';         // :91
export { default as toUpperCase } from './to-upper-case.js'; // :92
export { default as toLowerCase } from './to-lower-case.js'; // :93
export { default as uniqueId }    from './unique-id.js';     // :94
export { default as strInsert }   from './str-insert.js';    // :95
export { default as strIndex }    from './str-index.js';     // :96
export { default as strSlice }    from './str-slice.js';     // :97
```

`packages/fns/src/sass/string/globals.ts` already defines every one of these in
the value domain, under the same global names — `quote`, `unquote`,
`toUpperCase`, `toLowerCase`, `uniqueId` re-exported at lines 17–21, and
`strLength`/`strIndex`/`strSlice`/`strInsert` built with `./value`'s
`defineFunction` at lines 24, 31, 40, 50. Gap A is a re-point of eight lines.

**Gap B — seven Sass map functions with no value-domain implementation at all.**
`packages/fns/src/sass/map/{get,set,merge,remove,keys,values,has-key}.ts`. These
carry five of the eleven names from §1a. The value substrate they need already
exists — `Collection` (`src/ast/value-eval.ts:216`), `CollectionEntry` (line
188), `isCollection`/`collectionEntries`/`collectionKeyIndex`
(`src/ast/value-collection.ts:18,27,39`), `makeCollection`
(`src/ast/value-factory.ts:156`). What does not exist is a decision about how a
Sass map key compares in the value domain, which is what `map/get.ts:41–49` is
currently doing by hand against `Declaration.name`.

**None of the fourteen is currently registered.** `packages/fns/src/registry.ts:24–27`:

```ts
function isFn(value: unknown): value is Fn {
  if (typeof value !== 'function') { return false; }
  return 'params' in value && Array.isArray(value.params);
}
```

The legacy factory attaches `options` and `_internal` and never a bare `params`
(`define-function.ts:355–357`). So `fnsOf`/`registryOf` (`registry.ts:31,36`)
skip all fourteen. `packages/fns/src/sass/index.ts:14–17` says so in prose; the
predicate is the actual mechanism.

*Interpretation, flagged as such:* the legacy value boundary is therefore **not
a live external contract**. It is a JavaScript-callable surface with no
registered built-in behind it. `@jesscss/fns/sass` today ships **zero** built-in
string globals and **zero** built-in map functions, while a complete value-domain
implementation of the string ones sits unreferenced in `sass/string/globals.ts`.
That reframes the whole boundary question from "how do we keep `fns` working"
to "what do we want the surface to be", because nothing downstream is currently
getting an implementation from it.

### The options

**Option 1 — narrow the root barrel to `./value`.** Re-point
`sass/index.ts:90–97` at `./string/globals.js`, port the seven map fns onto
`Collection`/`CollectionEntry`, delete `packages/fns/src/util/*` (§1d), and stop
exporting `defineFunction`/`FunctionThis`/`RuntimeFunction`/`conversions` from
the root.
*Consequence for `fns`:* eight string globals and seven map fns start being
registered — an output change (functions that currently fall through to verbatim
would begin resolving). All 21 externally-consumed tree names lose their consumer.
*Consequence elsewhere:* none. No other package imports the value boundary.
*Cost:* the map port is real work and requires a key-comparison ruling.

**Option 2 — narrow to `./value` but keep the map fns legacy for now.**
Gap A only. Cheap and mechanical, but it leaves `sass/map/*` importing five
runtime-required tree names, which pins `Collection`, `Declaration`, `Node`, `Any`, `N`,
`isNode`, `Nil`, `Bool`, `List`, `Quoted`, `Context`, `FunctionThis` and
`defineFunction` in the root barrel — i.e. it does not unblock the deletion.
*Consequence:* the string globals start registering; the map ones still do not.

**Option 3 — delete the seven map fns outright.** They are exported but
unregistered, and `sass/map/index.ts:14–20` is the only thing that reaches them.
*Consequence for `fns`:* `@jesscss/fns/sass/map` becomes an empty module and
`mapGet`/`mapMerge`/… disappear from `@jesscss/fns/sass`. Nothing downstream
imports them (verified: no `packages/*/src` file outside `fns` imports
`@jesscss/fns/sass/map`). Externally this is a no-op today, because none of them
was registered — but it discards work.
*This is the option that makes `tree/` deletable with the least ceremony and the
most thrown away.*

**Option 4 — keep a class-shaped compatibility layer.** Re-implement `Dimension`,
`Quoted`, `Color`, `List`, `Nil`, `Collection`, `Declaration`, `Any`, `Node`
as classes over the value domain, outside `tree/`, so `define-function`'s
`Class<any>` token model survives.
*Consequence:* the deletion proceeds without touching `fns` at all, at the cost
of two permanent parallel value representations and a second `defineFunction`.
Recorded for completeness; it contradicts the standing "no permanent fallback"
direction.

The choice between 1, 2, 3 and 4 is the owner's. It is the only genuinely
semantic decision in the whole cutover.

---

## 4. Extraction order

Marked **M** (mechanical — a move, a deletion, or a re-point, no behaviour
question) or **S** (needs a ruling).

| # | step | blocks / blocked by | mark |
| --- | --- | --- | --- |
| 1 | ✅ Deleted `packages/fns/src/util/{color-output,colorHelper,get-color-func-values,get-luma,mathHelper,number,preserve-hex,raw-color-args,relative-color,to-hsl,to-hsv}.ts` and moved the luma/luminance/hsv tests to root `@jesscss/core` value imports. The remaining `fns/src/util/` files are IO helpers (`image-dimensions`, `mime`), not legacy tree utilities. | — | **M** |
| 2 | ✅ Deleted `IParseResult` from `src/types/index.ts`. It was declared and referenced nowhere outside this tracker; the live file no longer imports Chevrotain solely to describe a dead parser result shape. | — | **M** |
| 3 | Partially complete: relocated generic `calculate`/`Operator` and `BitSetLibrary`/bitset helpers to `src/util/`, and repointed `Context` plus legacy tree consumers. `tree/util/provenance.ts` remains in place: the earlier "zero imports" note is stale; current source has many legacy tree node/span consumers, so moving it is not a blind mechanical cut. | blocks 5 | **M** |
| 4 | **Rewrite `Context` tree-free** (§2, owner-settled). By the runtime-usage audit this is *delete 33 members and the 10 tree imports, keep 73* — every deleted member is legacy-eval state, none of the 33 is reachable from `ast/`, `jess`, the plugins or `fns`, all 25 externally-reachable members are already tree-free in both signature and body, and the constructor already qualifies. **On the critical path**, because a live `Context` instance flows into `ast/serialize.ts` and currently drags `tree/` into every v2 render (§2a). Blocked by nothing: it does not wait on the value boundary, and the legacy engine can keep its state on its own object until it is deleted. | blocks 8; blocks nothing else | **M** |
| 5 | Replace `src/index.ts:10`'s wildcard with an explicit export list. This is what turns every later deletion into a compile error instead of a silent surface change (§5.1). | needs 3 | **M** |
| 6 | Re-point `packages/fns/src/sass/index.ts:90–97` at `./string/globals.js` (Gap A, §3). Eight lines, and it retires 8 of the 14 unconverted fn modules. **Behaviour changes** — eight Sass string globals begin registering (`registry.ts:24–27`), which is the bug in the closing section. | — | **M**, output-affecting |
| 7 | **The hard one.** Rule on §3 (options 1–4) and on the map key model (§1c), then execute Gap B — the seven `sass/map/*` modules. Until it lands, `Any`, `Collection`, `Declaration`, `N`, `Node` and `isNode` stay in the root barrel. Needs `makeNil`, a value-domain kind table or `.type` rewrite, and a narrow-by-kind helper (§1a). | blocks 8 | **S** |
| 8 | Delete `tree/`, `conversions.ts`, `define-function.ts`, and the tree branches of `src/index.ts`. | needs 4 and 7 | **M** |

Honest summary: **steps 1, 2 and 3 are trivially separable and can land in any
order today.** Step 4 sounds like the big one and is not — it is a subtraction
with a measured blast radius of zero external members, and it is the step that
stops `tree/` being loaded on the v2 path. Step 6 is eight lines but changes
emitted CSS. **Step 7 is the only genuinely hard one**, and it is hard for one
reason: the Sass map key model. Everything else is bookkeeping.

---
## 5. What would break silently

Ordered by how quietly it fails.

1. **`export * from './tree/index.js'` (`src/index.ts:10`).** Removing a name
   from the wildcard is not a compile error anywhere — it is a published-API
   change with no declaration site to review. 214 of the 235 names it carries
   have no consumer, and there is no way to tell which of the 21 that do were
   ever intended. Replacing the wildcard with an explicit list (step 5) is the
   only thing that converts this class of change into an error.

2. **`import '../context.js'` (`tree/index.ts:24`).** A bare side-effect import.
   Its own comment (lines 20–23) says *"Load Context before the tree utility
   graph. The legacy tree's module cycle relies on this initialization order."*
   Deleting or reordering `tree/index.ts` removes the only thing forcing that
   order. A module-init-order break surfaces as `undefined` at first use, not as
   a type error.

3. **`Selector.prototype.compare` (`tree/index.ts:96`)**, patched as a side
   effect of loading the barrel, explicitly to dodge a circular dependency
   (comments at lines 83 and 95). Any path that reaches a tree module *without* going
   through `tree/index.ts` gets the unpatched `compare` — wrong selector
   equivalence, correct-looking output, no error. `Node.prototype.nil` and
   `Node.prototype.operate` (`tree/node.ts:24,31`) are the same class of hazard,
   and `attachSelectorBitLibrary` (`tree/selector.ts:63`) is a third install-time
   mutation exported publicly.

4. **`isFn` in `packages/fns/src/registry.ts:24–27`** — a duck-typed structural
   predicate (`'params' in value && Array.isArray(value.params)`) applied to
   `Object.values(dialectIndex)` (`registry.ts:31`). The registry is built by
   iterating a module namespace object, so *adding or removing any export from a
   dialect index silently changes the registered built-in set*, in either
   direction, with no error. This is currently how fourteen fns are excluded
   (§3), and it is how they would be silently included the moment a port lands.
   `Object.defineProperty(result, 'name', …)` (`define-function.ts:361`)
   compounds it: dispatch keys on `fn.name`, which is set imperatively.

5. **Inline `import('…')` type references**, which a `from '.../tree'` grep
   misses entirely: `context.ts:738` (`SpineMergePlan`), `print.ts:70,130,139,184`
   (`Rules`, `SpineMergePlan`, `SpineCondPlan`). Any inventory of tree edges built
   from import-statement grep will undercount.

6. **`import type` erases the module-graph edge, not the dependency.** This is
   the most dangerous entry on the list, and this document walked into it — see
   §2a for the worked instance. `ast/serialize.ts:127` is
   `import type { Context }`, so an import audit of `ast/` reports the tree
   boundary clean; but a live `Context` instance is constructed at
   `packages/jess/src/index.ts:1074` and flows into serialize
   (`serialize.ts:186, 301, 1215, 5338`), and `Context` pulls `tree/` in at
   runtime. **An import-graph audit cannot see an object-graph dependency**, and
   it fails in the reassuring direction: it reports success. The only sound check
   is a usage audit that resolves the type of the object being accessed — which
   is what §2b does, and which found the same 14 members with a second,
   independent method.

   The same erasure hides `context.ts:1–10` (eight node types),
   `context.ts:37` (`Call`), `context.ts:41` (`PrintOptions`) and
   `types/index.ts:2` (`Node`). Those four genuinely produce no runtime edge and
   cost nothing to sever — but that is a conclusion a usage audit has to reach,
   not one an import audit is entitled to assume. (`error/code-frame.ts:1` is a
   *value* import and so is not in this class at all.)

7. **Duplicated names across `@jesscss/core` entry points — and 27 of them are a
   class on one side and an interface on the other.** 45 tree names also exist in
   `./ast` or `./value`; in 27 the tree symbol is a `class` and every counterpart
   is an `interface`/`type` (the full list is in §1). Changing an import's
   subpath while keeping the name **compiles**, and then fails at runtime on the
   first `new X(...)` or `x instanceof X` — or, worse, silently, where the name
   was only ever a `defineFunction` param token. `fns` already imports `Color`
   from both entry points: as a value from the root at
   `fns/src/util/colorHelper.ts:1`, and as a type from `/value` at
   `fns/src/less/color-helper.ts:9`.

8. **`packages/core/src/ast/provenance.ts:20–25`** notes that build tools may
   materialize more than one copy of the AST provenance side table, and works
   around it with a process-global symbol. Deleting `tree/` changes what core's
   root entry pulls in, which changes bundling — so this workaround's premise
   should be re-checked after step 8, not assumed.

### Negative findings (checked, clean)

- No `export * from '@jesscss/core'` anywhere in `packages/*/src` — zero
  wildcard re-exports of core downstream.
- No `import * as X from '@jesscss/core'` namespace imports.
- No default imports and no bare side-effect imports of `@jesscss/core`.
- All downstream core imports use exactly three specifiers: `@jesscss/core`
  (199 bindings), `@jesscss/core/ast` (316), `@jesscss/core/value` (672).
  *Observation:* the migration is already ~83% done by binding count; the root
  barrel is the residue.

---

## Bug found (not fixed)

`packages/fns/src/sass/index.ts:90–97` exports the legacy tree-domain string
globals while finished value-domain implementations of the same eight functions
exist at `packages/fns/src/sass/string/globals.ts:17–21,24,31,40,50`. Because
`registry.ts:24–27` only registers value-domain callables, the effect is that
`@jesscss/fns/sass` registers **no** `quote`, `unquote`, `to-upper-case`,
`to-lower-case`, `unique-id`, `str-insert`, `str-index` or `str-slice` built-in,
despite one being implemented and available. Whether that is a defect or an
intentional hold is an owner call; it is recorded here because it was found
while tracing and is not in scope for this document to change.
