# `packages/core/src/tree/` — cutover surface

Measured on `04e245b5610309472b0879433333bcdb7447bbaa` (`origin/dev`, 2026-07-25).
The recognition package was observed under its current name
`packages/internal-css-recognition` (`@jesscss/internal-css-recognition`); the
rename to `packages/parser-shared` had not landed at this SHA, so every path
below uses the old name. The config package is `styles-config`.

This is an inventory and a sequencing argument for deleting `tree/`. It records
no status and proposes no schedule.

## Method

Export sets were resolved with the TypeScript checker
(`getExportsOfModule`, typescript@5.9.3 from
`node_modules/.pnpm/typescript@5.9.3`) against the source files, not against
`lib/` — this worktree has no `node_modules` and no built `lib/`, so no number
here depends on a build artifact being current. Consumer edges were collected by
parsing every `packages/*/src/**` file with the TS parser and reading real import
and export declarations, so `import type` is distinguished from a value import
and a name is counted where it is *bound*, not where its text appears.

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

### Classification

| class | count | rule |
| --- | --- | --- |
| **dies** | 223 | no external consumer, **or** the only consumer is itself unreachable from any package entry point |
| **survives** | 7 | externally consumed, and `./value` or `./ast` already provides the capability the consumer uses |
| **contested** | 5 | externally consumed from a reachable path, with no v2 counterpart covering the use |

External = `packages/*/src` excluding `core`, excluding `__tests__`/`*.test.ts`.

**Zero tree names are consumed only by tests.** The only public core export in
that category is `RuntimeFunction` (`src/define-function.ts:178`), used at
`packages/fns/src/__tests__/sass-map-functions.test.ts:1` and
`packages/fns/src/sass/__tests__/map-functions.test.ts:1` and nowhere in
production — and it is a `define-function.ts` symbol, not a tree one.

### 1a. survives — 7

A `./value` (`packages/core/src/value.ts`) or `./ast`
(`packages/core/src/ast.ts`) counterpart already exists that covers the
consumer's use. The tree name goes away; the capability does not. In every case
the shape changes from a class instance to plain data plus a factory — a port,
not a design decision.

| name | tree decl | external consumers | v2 counterpart |
| --- | --- | --- | --- |
| `Bool` | `src/tree/bool.ts:6` | `packages/fns/src/sass/map/has-key.ts:10` | `./value` `Bool` (`src/ast/value-eval.ts:162`) + `makeBool` (`src/ast/value-factory.ts:139`) |
| `Collection` | `src/tree/collection.ts:19` | `fns/src/sass/map/{get,has-key,keys,merge,remove,set,values}.ts:9–10` | `./value` `Collection` (`src/ast/value-eval.ts:216`), `makeCollection` (`value-factory.ts:156`), `isCollection`/`collectionEntries`/`collectionKeyIndex` (`src/ast/value-collection.ts:18,27,39`) |
| `Dimension` | `src/tree/dimension.ts:48` | `fns/src/sass/str-index.ts:10`, `str-insert.ts:9`, `str-slice.ts:10` (+ 5 unreachable `fns/src/util/*`) | `./value` `Dimension` (`value-eval.ts:39`) + `makeDimension` (`value-factory.ts:57`) |
| `List` | `src/tree/list.ts:213` | `fns/src/sass/map/keys.ts:9`, `map/values.ts:9` (+ `fns/src/util/relative-color.ts:3`, unreachable) | `./value` `List` (`value-eval.ts:138`) + `makeList` (`value-factory.ts:141`), `groupItems`/`listValueAt` (`src/ast/value-list.ts:30,71`) |
| `LocationInfo` | `src/tree/node-base.ts:112` | `packages/jess/src/output.ts:1` (+ `fns/src/util/relative-color.ts:11`, unreachable) | `./ast` `AstSourceSpan` (`src/ast/provenance.ts:8`) — `Readonly<{start:number;end:number}>`, structurally identical to `LocationInfo` at `node-base.ts:111` |
| `Nil` | `src/tree/nil.ts:18` | `fns/src/sass/map/get.ts:10` | `./value` `Nil` (`value-eval.ts:169`) |
| `Quoted` | `src/tree/quoted.ts:20` | `fns/src/sass/map/keys.ts:9`, `sass/quote.ts:9`, `str-index.ts:10`, `str-insert.ts:9`, `str-slice.ts:10`, `to-lower-case.ts:9`, `to-upper-case.ts:9`, `unique-id.ts:9`, `unquote.ts:9` | `./value` `Quoted` (`value-eval.ts:113`) + `makeQuoted` (`value-factory.ts:130`) |

### 1b. contested — 5

Externally consumed from a path a published entry point reaches, with no v2
counterpart that covers the use. All five have the same consumer set: the seven
`packages/fns/src/sass/map/*.ts` modules.

| name | tree decl | why not covered |
| --- | --- | --- |
| `Any` | `src/tree/any.ts:31` | consumers call `new Any(string)` to wrap a stringified declaration value (`fns/src/sass/map/get.ts:16,21`). `./ast` `Any` (`src/ast/nodes.ts:76`) is a plain-data interface with no constructor and a different role. The value-domain substitute is `makeKeyword` or `makeQuoted` — which one is a semantic choice about what a map value *is*. |
| `Declaration` | `src/tree/declaration.ts:619` | the map fns model a collection entry as a tree `Declaration` and iterate `collection.rules` looking for one (`fns/src/sass/map/get.ts:41–49`). The value domain models an entry as `CollectionEntry` (`src/ast/value-eval.ts:188`), reached through `collectionEntries` — a different data model, not a rename. `./ast` `Declaration` (`nodes.ts:672`) is the *syntactic* declaration, which is a third thing. |
| `N` | `src/tree/node-type.ts:17` | a numeric enum. `./ast`'s discriminant is `NodeType` (`src/ast/node.ts:62`), a **string** union with `AST_NODE_TYPES` (`node.ts:108`). Not an alias. |
| `Node` | `src/tree/node-base.ts:485` | an abstract class used with `instanceof` (`fns/src/sass/map/get.ts:18`) and as the universal value type. `./ast` `Node` (`src/ast/node.ts:86`) is a union type over plain-data interfaces — no runtime identity, so `instanceof` has no translation. `./value`'s equivalent is `ValueGroup`/`ValueObj` (`value-eval.ts:234,226`), a narrower domain. |
| `isNode` | `src/tree/util/is-node.ts:18` | `./ast` exports a same-named `isNode` (`src/ast/node.ts:118`), but it narrows an `./ast` node by string `NodeType`. The tree one narrows a tree `Node` by numeric `N`. Same name, different domain — the collision is a hazard, not a migration path. |

### 1c. dies — 223

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
| `src/tree/any.ts` | 6 | `Anonymous`, `AnyOptions`, `AnyRole`, `Keyword`, `any`, `keyword` |
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

Note `isBracketedList` (`src/tree/util/list-like.ts:40`) and `./value`'s
`isBracketedList` (`src/ast/value-list.ts:21`) are two different exported
functions with one name, reachable from two entry points of the same package.
Same for `sourceSpanOf` (`tree/util/provenance.ts:71` vs `ast/provenance.ts:46`),
`isNode`, `round`, `Block`, `Collection`, `Color`, `Dimension`, `List`, `Quoted`,
`Keyword`, `Bool`, `Nil`, `Any`, `Declaration`, `Sequence`, `Operation`,
`Comment`, `Range`, `Reference`, `SelectorList`, `PseudoSelector`,
`ComplexSelector`, `CompoundSelector`, `SimpleSelector`, `Combinator`,
`Condition`, `AtRuleStatement`, `Node`, `sel`, `spaced`, `block`, `keyword`,
`decl`, `forNode`, `ifNode`, `range`, `color`, `dimension`, `quoted`, `comment`,
`condition`, `pseudo`, `any`.

---

## 2. `Context`

### 2a. `ast/` does not depend on tree, and the Context tether is type-only

Verified independently of the boundary comments: `grep -rn "from '.*tree\|import(.*tree"` over
`packages/core/src/ast/` (excluding `__tests__`) returns **no matches**. There is
no runtime and no type edge from `ast/` into `tree/`.

The direction is in fact the reverse: `packages/core/src/tree/util/round.ts:9`
is `export { round } from '../../ast/round.js'` — legacy tree depends on `ast/`.

`ast/` references `Context` in exactly one place:
`packages/core/src/ast/serialize.ts:127`, and it is `import type`. It is erased
at runtime. **The v2 execution path has no runtime edge to `context.ts` at all,**
and therefore none to tree via Context.

The Context members `ast/` reads are all tree-free:

| member | decl | shape |
| --- | --- | --- |
| `sourceContext` | `context.ts:452` | `SourceContext \| undefined` |
| `options` | `context.ts:391` | `ResolvedOptions` |
| `opts` | `context.ts:340` | option bag |
| `valueEvaluator` | `context.ts:398` | `ValueEvaluator` (`src/ast/value-eval.ts`) |
| `entryFilePath` | `context.ts:438` | `string` |
| `warn` | `context.ts:524` | `(JessError \| WarningDiagnostic, …) => void` |
| `transformUrl` | `context.ts:1011` | `(string, boolean) => string` |
| `withDocument` | `context.ts:984` | over `Stylesheet` (ast) |
| `rememberDocumentBody` | `context.ts:1033` | over `Stylesheet` (ast) |
| `currentSourceOwner` / `withSourceOwner` / `sourceOwnerForBody` | `context.ts:1068,1073,1095` | `object \| null` |
| `loadImport` | `context.ts:1313` | `(string, ImportOptions)` |
| `readBinary` | `context.ts:1347` | `(string) => Promise<Buffer>` |

The six `context.frames` occurrences in `serialize.ts` (lines 1541, 1594, 6614,
6637) are all inside comments describing less@4 behaviour. There is no member
access.

*Interpretation:* the premise that "v2 is clean of tree nodes but not of the
context object carrying tree machinery" holds at the **module-graph** level —
importing `Context` as a value pulls tree in — but not at the **usage** level.
No v2 code path reads a tree-typed Context member. So decomposing Context is a
matter of cutting its own imports, not of renegotiating a contract with `ast/`.

### 2b. Per-import disposition

`context.ts` has ten tree references. **Tree-located** = the symbol happens to
live under `tree/` but its implementation and signature are tree-free; it can be
relocated by moving the file. **Tree-shaped** = it is or operates on tree node
classes; relocating it requires a design decision.

| # | import | site | runtime? | shape | used by v2? |
| --- | --- | --- | --- | --- | --- |
| 1 | `AtRule, Ruleset, Rules, Node, Any, AtRuleStatement, Selector, Nil` | `context.ts:1–10` | no (`import type`) | **tree-shaped** | no |
| 2 | `ExtendRootRegistry` | `context.ts:12` → `tree/util/extend-roots.ts:553`; used `context.ts:709,950` | **yes** | **tree-shaped** — the module imports `ComplexSelector`, `BasicSelector`, `Ruleset`, `Selector`, `PseudoSelector`, `Nil`, `Node` as values (`extend-roots.ts:3–28`) | no |
| 3 | `Operator` | `context.ts:13` → `tree/util/calculate.ts:1`; used `context.ts:1544` | no (`import type`) | **tree-located** — `calculate.ts` has **zero imports**; `Operator` is `'+' \| '-' \| '*' \| '/' \| '%'` | no |
| 4 | `shouldOperateWithMathFrames` | `context.ts:23` → `tree/util/should-operate.ts:31`; used `context.ts:1546` | **yes** | **tree-shaped** — takes `Node` operands, imports `isNode`/`N`/`Node` (`should-operate.ts:3–5`) | no |
| 5 | `Call` | `context.ts:37` → `tree/call.ts:553`; used `context.ts:653,840` | no (`import type`) | **tree-shaped** | no |
| 6 | `CallMap` | `context.ts:38` → `tree/util/recursion-helper.ts:14`; used `context.ts:835,837` | **yes** | **borderline** — its two imports (`Call`, `List`, `recursion-helper.ts:1–2`) are both `import type`, so the runtime class is tree-free; its *type* `CallSignature = List \| string \| undefined` (line 5) is tree-shaped | no |
| 7 | `BitSetLibrary` | `context.ts:39` → `tree/util/bitset.ts:54`; used `context.ts:301,784` | **yes** | **tree-located** — `bitset.ts`'s only import is the `bitset` npm package (line 1) | no |
| 8 | `selectorAnalysisFor`, `SelectorAnalysis` | `context.ts:40` → `tree/util/selector-analysis.ts:254,47`; used `context.ts:791–792` | **yes** | **tree-shaped** — operates on `Selector`, imports `N`/`isNode`/`isCombinator`/`F_VISIBLE` as values (`selector-analysis.ts:19–22`) | no |
| 9 | `PrintOptions` | `context.ts:41` → `tree/util/print.ts:10`; used `context.ts:803` (private field) | no (`import type`) | **tree-shaped** — 20+ of its fields are typed `Ruleset`, `AtRule`, `Selector`, `Nil`, `Rules`, `AtRulePrelude` (`print.ts:12–184`) | no |
| 10 | `SpineMergePlan` | `context.ts:738`, inline `import('./tree/util/spine-merge.js')` | no (type position) | **tree-shaped** | no |

**Tree-located: 2** (`Operator`, `BitSetLibrary`) — plus `CallMap`'s runtime.
Both are pure and move by relocating one file each.
**Tree-shaped: 8.**

Every one of the ten is legacy-eval-only. None is read by the v2 path (§2a).

`packages/core/src/tree/util/provenance.ts` deserves the same note even though
`context.ts` does not import it: it has **zero imports** (verified — `grep -c
"import"` returns 0) and its API is duck-typed over `unknown` and `object`
(`readEvalErrorLocation`, line 177; `stampEvalErrorLocation`, line 159). It is
entirely tree-located despite contributing 13 names to the public surface.

---

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
- `ParamSpec` with `kinds: readonly Kind[] | 'any'` where `Kind = ValueObj['type']`
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
carry the five contested names from §1b. The value substrate they need already
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
`Collection`/`CollectionEntry`, delete `packages/fns/src/util/*` (§1c), and stop
exporting `defineFunction`/`FunctionThis`/`RuntimeFunction`/`conversions` from
the root.
*Consequence for `fns`:* eight string globals and seven map fns start being
registered — an output change (functions that currently fall through to verbatim
would begin resolving). All 21 tree names in §1a–1c lose their consumer.
*Consequence elsewhere:* none. No other package imports the value boundary.
*Cost:* the map port is real work and requires a key-comparison ruling.

**Option 2 — narrow to `./value` but keep the map fns legacy for now.**
Gap A only. Cheap and mechanical, but it leaves `sass/map/*` importing five
contested tree names, which pins `Collection`, `Declaration`, `Node`, `Any`, `N`,
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

Marked **M** (mechanical — a move or a re-point, no behaviour question) or
**S** (semantic — needs a ruling).

| # | step | blocks / blocked by | mark |
| --- | --- | --- | --- |
| 1 | Delete `packages/fns/src/util/{color-output, colorHelper, get-color-func-values, get-luma, mathHelper, number, preserve-hex, raw-color-args, relative-color, to-hsl, to-hsv}.ts` and the one test edge at `fns/src/less/__tests__/luma-luminance-hsv-channels.test.ts:13`. Unreachable from every `fns` entry point (§1c). Kills 9 tree names outright. Blocks nothing, blocked by nothing. | — | **M** |
| 2 | Delete `IParseResult` (`src/types/index.ts:51`) and its `import type { Node }` (line 2). The interface is declared and referenced **nowhere** in the repo — verified across `core`, `jess`, `fns` and all four parsers. Removes one of the six runtime files' tree edges entirely. | — | **M** |
| 3 | Move `tree/util/provenance.ts` (zero imports), `tree/util/calculate.ts` (zero imports) and `tree/util/bitset.ts` (one npm import) out of `tree/`. Pure relocations; 15 public names change file, not meaning. Unblocks step 5's `Operator`/`BitSetLibrary`/`SourceSpan` edges and `error/code-frame.ts:1`. | blocks 5, 6 | **M** |
| 4 | Re-point `packages/fns/src/sass/index.ts:90–97` at `./string/globals.js` (Gap A, §3). Eight lines. **Behaviour changes** — eight Sass string globals begin registering (`registry.ts:24–27`). | — | **M**, output-affecting |
| 5 | Delete the 214 zero-consumer names from the public surface by replacing `src/index.ts:10`'s wildcard with an explicit list of what core actually means to publish. This is what turns every later deletion into a compile error instead of a silent surface change. | needs 3 | **M** |
| 6 | Decompose `Context`: cut imports 3 and 7 (and `CallMap`'s runtime) after step 3; the remaining seven are legacy-eval-only fields (`extendRoots`, `selectorAnalysis`, `_printState`, `caller`/`_callStack`, `frames`, `rulesetFrames`, `extends`, `spineMergePlan`, `shouldOperate`) that leave with the eval path. No v2 path reads any of them (§2a). | needs 3; blocked by nothing else | **M** for 3 and 7; **S** for whether `shouldOperate`'s math-mode semantics need a value-domain home |
| 7 | **The hard one.** Rule on §3 (options 1–4) and execute Gap B — the seven `sass/map/*` modules and the five contested names. Everything else on this list is separable; this is the single step that cannot proceed without an owner decision, and until it lands `Collection`, `Declaration`, `Node`, `Any`, `N`, `isNode` stay in the root barrel and `tree/` cannot go. | blocks 8 | **S** |
| 8 | Delete `tree/`, `conversions.ts`, `define-function.ts`, and the tree branches of `src/index.ts` and `src/context.ts`. | needs 7 | **M** |

Honest summary: **steps 1, 2 and 3 are trivially separable and can land in any
order today.** Step 4 is eight lines but changes emitted CSS. Step 7 is the whole
problem; steps 5, 6 and 8 are bookkeeping once it is settled.

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

6. **Type-only tree imports that vanish at runtime** — `context.ts:1–10` (eight
   node types), `context.ts:37` (`Call`), `context.ts:41` (`PrintOptions`),
   `types/index.ts:2` (`Node`), `error/code-frame.ts:1` is a *value* import so it
   does not qualify. These produce no runtime edge, so a bundler or a
   runtime smoke test will report the boundary as clean while the type surface
   still leaks tree. Conversely they cost nothing to sever.

7. **Duplicated names across `@jesscss/core` entry points.** `isNode`,
   `sourceSpanOf`, `isBracketedList`, `round`, `Dimension`, `Color`, `List`,
   `Quoted`, `Nil`, `Collection`, `Block`, `Node`, `Declaration`, `Any`,
   `Sequence`, `Operation` and ~25 more resolve to *different* symbols depending
   on whether the import came from `@jesscss/core`, `@jesscss/core/ast` or
   `@jesscss/core/value`. Changing an import's subpath while keeping the name
   compiles. `fns` already does both: `Color` is imported as a value from the
   root at `fns/src/util/colorHelper.ts:1` and as a type from `/value` at
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
