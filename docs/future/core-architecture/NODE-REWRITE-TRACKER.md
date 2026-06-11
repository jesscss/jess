# Node Rewrite Tracker

This tracker owns the node-by-node cleanup program. The rule is simple: finish
one node rewrite pass at a time, prove output with focused unit tests before and
after, and prefer structural facts, straight loops, fewer branches, fewer
function calls, and fewer conversions.

Do not mark a node complete because one helper changed. A node is complete when
its public render/eval/resolve/value methods have been reviewed for:

- string/render output used as a decision predicate;
- unnecessary node creation, copying, `.inherit(...)`, or metadata mutation;
- array helpers, generators, nested hot closures, tuple arrays, or helper
  ladders;
- repeated conversion through `valueOf()`, `toString()`, regex, `String(...)`,
  `.join(...)`, `.slice(...)`, writer capture, or `getSince(...)`;
- branches that should be parser/adoption/eval flags or direct structural
  checks.

## `writeSyntax` / Render / String Queue

Audit snapshot: 2026-06-08 source scan after selector `writeSyntax` pass.
Only selector-family syntax transport has been cut so far. A checkbox means the
node has been reviewed specifically for this contract, not merely that one
helper changed.

Completion contract for each checkbox:

- direct syntax emission lives in `writeSyntax(options): void` or an equivalent
  node-local private writer method with no returned string;
- public `toString(...)` / `toTrimmedString(...)` are cold wrappers only;
- `render(...)` performs value selection/eval if needed, then writes directly;
- no render-only `mark/getSince`, `capture`, `preview`, string join, temporary
  array, or helper-object transport remains unless documented as a cold/public
  materialization boundary;
- focused tests prove direct render and public string output still match the
  expected behavior for that node.

Priority comes from the latest broad `benchmark.less` caller-stack evidence:
`Ruleset.getHeaderString`, declaration duplicate pre-rendering, `Any.toString`,
`Dimension`/`Num`, `Color`, `PseudoSelector`, `Sequence`, and `Quoted` are the
first measured offenders after the selector pass.

- [ ] `Node` base: generic `writeSyntax(options): void` hook exists. Global
  base render dispatch is deliberately still off until the remaining node
  overrides are complete; a direct flip regressed Paren/root serialization.
- [x] `Selector`: selector-family direct writer hook exists; remaining base
  selector metadata/keyset cleanup is tracked separately.
- [x] `BasicSelector`: direct scalar selector emission through `writeSyntax`.
- [x] `CompoundSelector`: child selector emission uses `writeSyntax`, public
  string wrapper owns capture.
- [x] `ComplexSelector`: selector components use `writeSyntax`, cold private
  source-string wrapper is gone, and raw non-selector interpolation fallback
  remains explicit.
- [x] `SelectorList`: list item emission uses `writeSyntax`, cold private
  source-string wrapper is gone, and public string wrapper owns capture.
- [ ] `Ruleset`: eliminate or isolate `getHeaderString(...)` capture for hot
  frame render/comparison paths.
- [ ] `Declaration`: public syntax boundary exists for callers, but
  `declValueTrimmedString(...)` still needs a direct value writer plus cold
  duplicate-comparison/materialization boundary.
- [x] `Any` / `Keyword` / `Anonymous`: move scalar token emission to generic
  `writeSyntax`; audit `compare(...)` string normalization.
- [x] `Dimension` / `Num`: numeric/unit emission uses one scalar serializer
  shared by `writeSyntax(...)` and public string output; audit regex/unit
  formatting and operation paths.
- [x] `Color`: move color emission to `writeSyntax`; isolate formatting and
  keyword/node value branches.
- [x] `PseudoSelector`: direct writer hook, child writer, and inline selector
  list argument writer exist; generated selector-list normalization no longer
  captures/restores a temporary argument string.
- [ ] `Sequence`: direct writer hook exists; no-trivia source children and
  custom-property raw source children use `writeSyntax(...)`, while
  trivia-backed child-boundary emission still uses `toString(...)`.
- [x] `Quoted`: direct quoted/interpolated emission; child node syntax uses
  `writeSyntax(...)` with no public `toTrimmedString(...)` transport.
- [ ] `List`: direct item writer exists; no-trivia item emission uses
  `writeSyntax(...)`, while trivia-backed item emission still uses
  `toString(...)`. Render still captures string output before buffer writes in
  resolved/direct paths.
- [ ] `QueryCondition`: direct condition syntax writer exists, source/static
  children use `writeSyntax(...)` instead of public `toString(...)`, and static
  child probe traffic is cut; dynamic child render still has a localized
  writer-mark fallback until child render contracts are fully direct.
- [x] `Operation`: direct operand/operator writer; source and render operands
  avoid public string transport.
- [x] `Paren`: direct wrapper writer, child syntax transport, and list path.
- [x] `Block`: direct `{...}` writer and render path; no-trivia child syntax
  avoids public string transport while source-trivia mode remains explicit.
- [x] `Url`: direct `url(...)` writer plus no-trivia context/non-context child
  syntax transport; context-normalization mark/replace path remains queued.
- [x] `Negative`: direct negative-prefix writer, child writer, and render path.
- [x] `Bool`: scalar writer.
- [x] `Nil`: confirm no writer/capture work remains; singleton/scalar audit.
- [x] `Comment`: direct comment writer and visibility path.
- [x] `Range`: direct range writer.
- [x] `Rest`: direct rest writer.
- [x] `DefaultGuard`: direct guard writer.
- [x] `Condition`: direct guard/comparison writer, operand writer, and eval
  result path.
- [x] `Extend`: direct extend writer; audit selector comparison/string keys.

Current hard leftovers after the broad hook sweep:

- `Rules`, `Ruleset`, `Declaration`, `AtRule`, `Call`, `Reference`,
  `QueryCondition`, `Interpolated`, `Mixin`, `Ampersand`, and control nodes
  still own meaningful render/eval string-transport or branch-heavy paths.
- `Sequence` and `List` have writer hooks, but are not complete until resolved
  render paths stop capturing strings before writing buffers and child emission
  stops routing through public `toString(...)` where direct hooks preserve
  semantics. `Sequence` general source children cannot blindly use
  `writeSyntax(...)` yet because boundary trivia currently lives in
  `Node.toString(...)`; a focused test caught the dropped source whitespace.
- `PseudoSelector` has a writer hook and child writer, its cold private
  source-string wrapper is gone, and generated selector-list normalization now
  writes inline comma-space syntax directly instead of capturing/restoring a
  temporary argument string. The same pass fixed generated `:is(...)`
  required-key metadata to match single-selector-list wrapper omission.
- [x] `ExtendList`: direct list writer; remove super-string wrapper.
- [x] `SelectorCapture`: direct capture syntax writer, child writer, and direct
  resolved buffer render; audit whether node still needs to exist.
- [x] `AttributeSelector`: direct attribute writer and child writer; avoid
  value/name public-string transport in render.
- [ ] `Ampersand`: direct source writer exists and local append/template
  callback-array helpers are cut; structural selector replacement still has
  string assembly debt.
- [ ] `Interpolated`: direct source writer exists and public `replace(...)` no
  longer uses regex callback scaffolding, but replacement `toTrimmedString`
  assembly remains where structural emission is possible.
- [x] `InterpolatedSelector`: direct selector writer and cheap kind checks.
- [x] `Reference`: direct unresolved reference writer; keep eval/render result
  emission out of public string APIs.
- [ ] `Call`: direct source syntax writer exists; split callable output value
  selection and evaluated-argument/content emission from capture/string
  transport.
- [x] `Func`: direct function signature/body writer, including name/params, if
  public syntax remains necessary.
- [ ] `Mixin`: direct source syntax/guard writer exists; audit
  guard/default/body copy interactions and callable candidate output.
- [ ] `MixinCollection`: decide whether public wrapper survives; if yes, direct
  writer only.
- [ ] `Rules`: direct braced source writer exists and public `toBraced(...)`
  is now a cold wrapper; isolate root public source serializer, frame header
  comparison, imports, and duplicate declaration materialization.
- [x] `RawRules`: direct raw body writer.
- [x] `Collection`: live wrapper with direct braced source writer; broader
  wrapper necessity remains out of scope for this source-writer pass.
- [ ] `AtRule`: direct header/body writer; remove custom eval/render branch
  ladders where state already carries kind.
- [ ] `StyleImport`: direct import/render writer and placement state; no
  first-use copied rules surfaces on render-only paths.
- [x] `JsImport`: live parser-owned syntax node for Jess/SCSS JS module
  imports; keep direct source writer.
- [x] `JsExpression`: live explicit JS eval node; do not spend render/source
  polish here unless the JS eval feature itself is redesigned.
- [ ] `JsArray`: no Less/SCSS/Jess parser production and `cast([...])` creates
  `List`, not `JsArray`; public explicit host wrapper only. Candidate for a
  dedicated API-breaking removal pass, not a node-polish target.
- [x] `JsObject`: live host-object/index wrapper because `cast(plainObject)`
  creates `JsObject` and indexed references read properties from it. Keep cold;
  do not invent source serialization.
- [x] `JsFunction`: live function-registry host wrapper used by plugins,
  language service, and call/reference execution. Keep cold; do not invent
  source serialization.
- [x] `Expression`: direct child writer; audit wrapper necessity remains.
- [ ] `CustomDeclaration`: audit after `Declaration`.
- [x] `VarDeclaration`: local writer probe removed; preserve binding semantics.
  Broader declaration body staging remains on `Declaration`.
- [ ] `For`: direct source syntax writer exists, range-bound closure removed,
  and render path already emits body output directly; loop state/body surface
  audit remains.
- [ ] `While`: direct source syntax writer exists; render path already emits
  body output directly, but loop state/body surface audit remains.
- [ ] `If`: direct source syntax writer exists and branch serialization avoids
  rest-array allocation; render path already emits selected body output
  directly, but eval/body surface audit remains.
- [x] `Log`: side-effect render path stays direct; redundant public
  `toString(...)` override removed while cold empty `toTrimmedString(...)`
  remains.

| Node | File | Base/family | Status | Rewrite notes |
| --- | --- | --- | --- | --- |
| Ampersand | `packages/core/src/tree/ampersand.ts` | `SimpleSelector` | partial | Direct source writer exists; append/template paths use explicit loops instead of callback-array helpers. Replace remaining template text splitting/string assembly with selector-list structure and placement state. |
| Anonymous | `packages/core/src/tree/any.ts` | `Any` | writeSyntax hook complete | Scalar emission uses `Any.writeSyntax`; broader compare/string normalization remains. |
| Any | `packages/core/src/tree/any.ts` | `Node` | writeSyntax hook complete | Scalar emission has a direct writer; compare/string conversion and numeric regex decisions remain. |
| AtRule | `packages/core/src/tree/at-rule.ts` | `Node` | queued | High priority: reduce custom eval/import/render branches. |
| AttributeSelector | `packages/core/src/tree/selector-attr.ts` | `SimpleSelector` | direct child writer complete | Attribute parts write directly through child `writeSyntax(...)`; cold private source-string wrapper removed. Interpolation eval, valueOf construction, and render capture remain. |
| BasicSelector | `packages/core/src/tree/selector-basic.ts` | `SimpleSelector` | writeSyntax complete | Direct source spelling emits authored `value`; kind checks use first-character tests, `valueOf()` remains normalized key text, and standalone eval now carries the existing selector-bit library from context. |
| Block | `packages/core/src/tree/block.ts` | `Node` | writeSyntax hook complete | Bracket emission writes directly; no-trivia child syntax avoids public `toString(...)`, while trivia mode keeps source serialization for authored inner comments/spacing. Render still captures for string/buffer return. |
| Bool | `packages/core/src/tree/bool.ts` | `Node` | scalar wrapper complete | Scalar writer complete; public `toTrimmedString(...)` writes the known token directly with no writer readback. |
| Call | `packages/core/src/tree/call.ts` | `Node` | partial | Source syntax writer exists and public call source stringification uses child `writeSyntax(...)`; high priority remains for callable output, evaluated arg/content capture, async path, helper ladders, and repeated eval. |
| Collection | `packages/core/src/tree/collection.ts` | `Rules` | direct braced writer complete | Live wrapper; `writeSyntax(...)` writes braced rules directly and public `toTrimmedString(...)` is the cold capture boundary. Broader wrapper necessity remains separate. |
| Color | `packages/core/src/tree/color.ts` | `Node` | writeSyntax hook complete | Color emission and preserved node-backed color syntax write directly; hex serialization uses a straight loop instead of callback-array joining; broader conversion internals remain. |
| Combinator | `packages/core/src/tree/combinator.ts` | `Selector` | scalar wrapper complete | Scalar selector writer avoids selector base punt, and public `toTrimmedString(...)` writes the known token directly with no writer readback. |
| Comment | `packages/core/src/tree/comment.ts` | `Node` | writeSyntax hook complete | Comment text writes directly; visibility/render behavior remains the inherited direct scalar path. |
| ComplexSelector | `packages/core/src/tree/selector-complex.ts` | `Selector` | writeSyntax complete | Selector component emission uses direct `writeSyntax` with the dead non-selector fallback branch removed, and cold private source-string wrapper is gone; broader valueOf, malformed repair, and metadata audit remains. |
| CompoundSelector | `packages/core/src/tree/selector-compound.ts` | `Selector` | writeSyntax complete | Component emission uses `writeSyntax` and cold private source-string wrapper is gone; broader valueOf classification and allocation-array audit remains. |
| Condition | `packages/core/src/tree/condition.ts` | `Node` | direct operand writer complete | Source condition syntax writes directly through operand `writeSyntax(...)`; bool result materialization audit remains. |
| CustomDeclaration | `packages/core/src/tree/declaration-custom.ts` | `Declaration` | queued | Audit custom-property eval/render after `Declaration`. |
| Declaration | `packages/core/src/tree/declaration.ts` | `Node` | partial | `writeSyntax(...)` now gives containers a direct declaration syntax boundary instead of forcing public `toString(...)`; high priority remains for custom property branches, merge state, internal mark/replace, and materialization. |
| DefaultGuard | `packages/core/src/tree/default-guard.ts` | `Node` | scalar wrapper complete | Scalar guard writer complete; public source string writes the known `default` token directly with no writer readback. |
| Dimension | `packages/core/src/tree/dimension.ts` | `Node` | scalar serializer complete | Number/unit emission uses one scalar serializer for `writeSyntax(...)` and public string output with no writer readback; preserve-mode compound unit serialization uses a straight loop instead of `map(...).join(...)`; regex/unit conversion and operation paths remain. |
| Expression | `packages/core/src/tree/expression.ts` | `Node` | direct child writer complete | Wrapper syntax writes directly and now calls child `writeSyntax(...)` instead of public `toString(...)`; child render/eval audit remains. |
| Extend | `packages/core/src/tree/extend.ts` | `Node` | writeSyntax hook complete | Extend syntax and selector/target child syntax write directly with no local public string wrapper; selector valueOf and resolved selector state remain. |
| ExtendList | `packages/core/src/tree/extend-list.ts` | `Node` | writeSyntax hook complete | List wrapper writes through base child writer plus semicolon; public wrapper existence remains. |
| For | `packages/core/src/tree/control.ts` | `Node` | partial | Source syntax writer exists, pattern/iterable children use direct writers, and range-bound closure is gone. Loop state/body surface and async branch audit remain. |
| Func | `packages/core/src/tree/function.ts` | `Node` | direct child writer complete | Public function syntax writes directly through name/params and body braced writer; function call/eval machinery remains. |
| If | `packages/core/src/tree/control.ts` | `Node` | partial | Source syntax writer exists, condition children use direct writers, and branch serialization avoids rest-array allocation. Eval/body surface audit remains. |
| Interpolated | `packages/core/src/tree/interpolated.ts` | `Node` | partial | Direct source writer exists and public `replace(...)` uses a plain placeholder loop instead of regex callback scaffolding; high-priority selector eval, generic materialization, replacement capture, and replacement arrays remain. |
| InterpolatedSelector | `packages/core/src/tree/selector-interpolated.ts` | `SimpleSelector` | direct writer/kind check complete | Source syntax writes directly through `Interpolated.writeSyntax(...)`; `isClass`/`isId`/`isTag` use first-character checks instead of regex. Eval/render still resolve selector output. |
| JsArray | `packages/core/src/tree/js-array.ts` | `Node` | removal candidate | No Less/SCSS/Jess parser constructs it, `cast([...])` creates `List`, and only explicit public API/tests use it. Do not polish; remove only in a dedicated API-breaking host-wrapper pass. |
| JsExpression | `packages/core/src/tree/js-expr.ts` | `Node` | live JS feature | Backtick syntax writes directly; JS eval path remains. Skip polish unless JS eval support is being redesigned. |
| JsFunction | `packages/core/src/tree/js-function.ts` | `Node` | live host wrapper | Function registry/plugins/language service/call/reference paths consume it. Keep cold; no arbitrary source writer. |
| JsImport | `packages/core/src/tree/import-js.ts` | `Node` | live parser node | Jess `@-use/@-from` and SCSS `@use "sass:*"` construct it; import syntax writes directly and path child uses `writeSyntax(...)`. |
| JsObject | `packages/core/src/tree/js-object.ts` | `Node` | live host wrapper | `cast(plainObject)` creates it and indexed references read properties from it. Keep cold; no arbitrary source writer. |
| Keyword | `packages/core/src/tree/any.ts` | `Any` | writeSyntax hook complete | Scalar emission uses `Any.writeSyntax`; broader compare/string normalization remains. |
| List | `packages/core/src/tree/list.ts` | `Node` | partial | Direct item writer exists, no-trivia items avoid public `toString(...)`, and cached `valueOf()` uses a plain loop instead of callback-array joining. Trivia-backed item emission, render string capture before buffer writes, and eval/render item-loop audit remain. |
| Log | `packages/core/src/tree/log.ts` | `Node` | complete | Empty source writer complete, redundant `toString(...)` override removed, and side-effect eval/render path is direct. |
| Mixin | `packages/core/src/tree/mixin.ts` | `Node` | partial | Source syntax writer exists and name/params/guard use direct child writers; high priority remains for guard/default/body copy and callable candidate output. |
| MixinCollection | `packages/core/src/tree/util/callable-collection.ts` | `Node` | queued | Audit whether this public node wrapper is still necessary. |
| Negative | `packages/core/src/tree/negative.ts` | `Node` | direct child writer complete | Prefix syntax writes directly, calls child `writeSyntax(...)`, and cold private source-string wrapper is gone; unit/text classification remains. |
| Nil | `packages/core/src/tree/nil.ts` | `Node` | writeSyntax hook complete | Empty writer complete; singleton/scalar allocation remains. |
| Num | `packages/core/src/tree/number.ts` | `Dimension` | scalar serializer complete | Inherits `Dimension` scalar serialization; operation paths remain. |
| Operation | `packages/core/src/tree/operation.ts` | `Node` | writeSyntax hook complete | Source operator syntax and operands write directly with no public `toString(...)`; arithmetic eval/calc fallback remains high priority. |
| Paren | `packages/core/src/tree/paren.ts` | `Node` | writeSyntax hook complete | Wrapper syntax and child source syntax write directly through `writeSyntax(...)`; guard/string conversion render audit remains. |
| PseudoSelector | `packages/core/src/tree/selector-pseudo.ts` | `SimpleSelector` | writeSyntax complete | Direct writer hook and child arg writer exist, generated keyset omission is fixed, cold private source-string wrapper is gone, and selector-list args now write inline without capture/replace/restore. Eval arg materialization remains separate. |
| QueryCondition | `packages/core/src/tree/query-condition.ts` | `Sequence` | partial | Source/static child syntax now uses `writeSyntax(...)` instead of public `toString(...)`, and static child render avoids writer-mark probes. Dynamic child render keeps one localized mark fallback because child render may write or return until downstream contracts are direct. |
| Quoted | `packages/core/src/tree/quoted.ts` | `Node` | writeSyntax hook complete | Quote syntax and child node syntax write directly; public string wrapper is no longer used for quoted child transport. |
| Range | `packages/core/src/tree/range.ts` | `Node` | writeSyntax hook complete | Range syntax and bound child syntax write directly with no local public string wrapper. |
| RawRules | `packages/core/src/tree/rules-raw.ts` | `Rules` | direct braced writer complete | Raw body/braced loops use indexed loops, no-trivia children call `writeSyntax(...)`, and trivia-backed children keep `toString(...)` for exact whitespace/comment preservation. Broader Rules audit remains. |
| Reference | `packages/core/src/tree/reference.ts` | `Node` | in progress | Passes 1-10 deleted alias predicates, result/fallback/materialization wrapper helpers, the useless `evalNode(...)` Promise wrapper, direct render closures, option spread helpers, scope-array walker, runtime-key IIFE, small `findVarDeclarationFast(...)` result/IIFE allocations, duplicate fallback/copy/static-return branches, callable surface rechecks, raw lookup sync-path closure/IIFE setup, main eval lookup closure setup, static declaration public-resolve copy/inherit for non-important/non-merged containers, per-call `findVarDeclarationFast(...)` helper closure allocation for bucket selection/candidate ordering/deferred dynamic-name promotion, reference-value evaluator options-object allocation, the declaration evaluator argument-object wrapper, runtime-binding sync evaluator closure setup, the rules-reference lookup executor closure, render-only dynamic declaration/runtime binding post-eval copy+inherit, unresolved reference source serialization now has a direct `writeSyntax(...)` path, and target/key source children no longer route through public `toString(...)`. Remaining: rules-like surfaces, public value materialization, merged assign normalization, and key conversion. |
| Rest | `packages/core/src/tree/rest.ts` | `Node` | writeSyntax hook complete | Rest syntax writes directly; wrapper necessity remains. |
| Rules | `packages/core/src/tree/rules.ts` | `Node` | partial | Direct braced source writer exists and public `toBraced(...)` is cold; high priority remains for body eval/render, imports, placement state, merge output, and root serializer capture. |
| Ruleset | `packages/core/src/tree/ruleset.ts` | `Node` | queued | High priority: selector composition, body prep, wrappers, render branches. |
| Selector | `packages/core/src/tree/selector.ts` | `Node` | writeSyntax complete | Selector-family writer hook exists; broader metadata and keyset invalidation audit remains. |
| SelectorCapture | `packages/core/src/tree/selector-capture.ts` | `Node` | child/buffer staging complete | Capture syntax writes directly through child `writeSyntax(...)`, cold private source-string wrapper is gone, and resolved buffer render delegates to the child buffer renderer instead of rendering to string then writing that string. Audit whether capture node should exist after render rewrite. |
| SelectorList | `packages/core/src/tree/selector-list.ts` | `Selector` | writeSyntax complete | List item emission uses `writeSyntax` and cold private source-string wrapper is gone; flattening, temporary arrays, and valueOf joins remain queued. |
| Sequence | `packages/core/src/tree/sequence.ts` | `Node` | partial | Direct sequence writer exists; no-trivia and custom-property raw source children use `writeSyntax(...)`, while trivia-backed child `toString` transport remains until boundary-trivia emission is made explicit. Render still captures. |
| SimpleSelector | `packages/core/src/tree/selector-simple.ts` | `Selector` | queued | Audit base class necessity and branches. |
| StyleImport | `packages/core/src/tree/import-style.ts` | `Node` | queued | High priority: first-use placement copies and derived rules surfaces. |
| Url | `packages/core/src/tree/url.ts` | `Node` | writeSyntax hook complete | URL wrapper and no-trivia child syntax write directly in source and context modes; render/context normalization still uses localized mark/replace and remains queued. |
| VarDeclaration | `packages/core/src/tree/declaration-var.ts` | `Declaration` | local probe removed | Variable prefix syntax writes directly and no longer wraps `declTrimmedString(...)` in a local `mark/getSince` fallback probe. Declaration body path remains. |
| While | `packages/core/src/tree/control.ts` | `Node` | partial | Source syntax writer exists and condition uses direct writer. Loop state/body surface and async branch audit remain. |
