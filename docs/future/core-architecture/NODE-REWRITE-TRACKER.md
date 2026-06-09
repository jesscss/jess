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
- [x] `ComplexSelector`: selector components use `writeSyntax`; raw
  non-selector interpolation fallback remains explicit.
- [x] `SelectorList`: list item emission uses `writeSyntax`, public string
  wrapper owns capture.
- [ ] `Ruleset`: eliminate or isolate `getHeaderString(...)` capture for hot
  frame render/comparison paths.
- [ ] `Declaration`: split `declValueTrimmedString(...)` into direct value
  writer plus cold duplicate-comparison/materialization boundary.
- [x] `Any` / `Keyword` / `Anonymous`: move scalar token emission to generic
  `writeSyntax`; audit `compare(...)` string normalization.
- [x] `Dimension` / `Num`: move numeric/unit emission to `writeSyntax`; audit
  regex/unit formatting and operation paths.
- [x] `Color`: move color emission to `writeSyntax`; isolate formatting and
  keyword/node value branches.
- [ ] `PseudoSelector`: direct writer hook exists; generated selector-list
  normalization still uses a local capture/restore and remains queued.
- [ ] `Sequence`: direct writer hook exists; render and child-boundary emission
  still have `toString(...)`/capture transport to cut.
- [x] `Quoted`: direct quoted/interpolated emission; isolate escaping and
  compare string path.
- [ ] `List`: direct item writer exists; render still captures string output
  before buffer writes in resolved/direct paths.
- [ ] `QueryCondition`: direct condition syntax writer; delete mark comparisons
  used as output probes where possible.
- [x] `Operation`: direct operand/operator writer; render operands without
  public string transport.
- [x] `Paren`: direct wrapper writer and list path.
- [x] `Block`: direct `{...}` writer and render path.
- [x] `Url`: direct `url(...)` writer; replace capture/replace path with direct
  normalized emission where possible.
- [x] `Negative`: direct negative-prefix writer and render path.
- [x] `Bool`: scalar writer.
- [x] `Nil`: confirm no writer/capture work remains; singleton/scalar audit.
- [ ] `Comment`: direct comment writer and visibility path.
- [x] `Range`: direct range writer.
- [x] `Rest`: direct rest writer.
- [x] `DefaultGuard`: direct guard writer.
- [x] `Condition`: direct guard/comparison writer and eval result path.
- [x] `Extend`: direct extend writer; audit selector comparison/string keys.

Current hard leftovers after the broad hook sweep:

- `Rules`, `Ruleset`, `Declaration`, `AtRule`, `Call`, `Reference`,
  `QueryCondition`, `Interpolated`, `Mixin`, `Ampersand`, and control nodes
  still own meaningful render/eval string-transport or branch-heavy paths.
- `Sequence` and `List` have writer hooks, but are not complete until resolved
  render paths stop capturing strings before writing buffers and child emission
  stops routing through public `toString(...)` where direct hooks preserve
  semantics.
- `PseudoSelector` has a writer hook, but generated selector-list normalization
  still uses capture/restore. The same pass fixed generated `:is(...)`
  required-key metadata to match single-selector-list wrapper omission.
- [x] `ExtendList`: direct list writer; remove super-string wrapper.
- [x] `SelectorCapture`: direct capture syntax writer; audit whether node still
  needs to exist.
- [x] `AttributeSelector`: direct attribute writer; avoid value/name
  public-string transport in render.
- [ ] `Ampersand`: direct writer and structural selector replacement; remove
  `map(...toTrimmedString)` string assembly debt.
- [ ] `Interpolated`: direct replacement writer; eliminate replacement
  `toTrimmedString` assembly where structural emission is possible.
- [ ] `InterpolatedSelector`: direct selector writer and kind flags.
- [ ] `Reference`: direct unresolved reference writer; keep eval/render result
  emission out of public string APIs.
- [ ] `Call`: direct fallback call writer; split callable output value
  selection from emission.
- [x] `Func`: direct function signature/body writer if public syntax remains
  necessary.
- [ ] `Mixin`: direct mixin syntax/guard writer; audit guard/default/body copy
  interactions.
- [ ] `MixinCollection`: decide whether public wrapper survives; if yes, direct
  writer only.
- [ ] `Rules`: direct body/root writer; isolate root public source serializer,
  frame header comparison, imports, and duplicate declaration materialization.
- [ ] `RawRules`: direct raw body writer.
- [ ] `Collection`: audit after `Rules`; direct writer only if wrapper remains.
- [ ] `AtRule`: direct header/body writer; remove custom eval/render branch
  ladders where state already carries kind.
- [ ] `StyleImport`: direct import/render writer and placement state; no
  first-use copied rules surfaces on render-only paths.
- [ ] `JsImport`: direct JS import syntax writer if public node remains.
- [ ] `JsExpression`: direct expression writer; eval path isolated.
- [ ] `JsArray`: direct public wrapper writer or remove wrapper.
- [ ] `JsObject`: direct public wrapper writer or remove wrapper.
- [ ] `JsFunction`: direct public wrapper writer or remove wrapper.
- [ ] `Expression`: direct child writer; audit wrapper necessity.
- [ ] `CustomDeclaration`: audit after `Declaration`.
- [ ] `VarDeclaration`: audit after `Declaration`; preserve binding semantics.
- [ ] `For`: direct control syntax writer only for public source API; render
  path should emit body output directly.
- [ ] `While`: direct control syntax writer only for public source API; render
  path should emit body output directly.
- [ ] `If`: direct control syntax writer only for public source API; render path
  should emit selected body output directly.
- [ ] `Log`: confirm side-effect render path stays direct and public strings are
  cold.

| Node | File | Base/family | Status | Rewrite notes |
| --- | --- | --- | --- | --- |
| Ampersand | `packages/core/src/tree/ampersand.ts` | `SimpleSelector` | queued | Replace template text splitting with selector-list structure and placement state. |
| Anonymous | `packages/core/src/tree/any.ts` | `Any` | writeSyntax hook complete | Scalar emission uses `Any.writeSyntax`; broader compare/string normalization remains. |
| Any | `packages/core/src/tree/any.ts` | `Node` | writeSyntax hook complete | Scalar emission has a direct writer; compare/string conversion and numeric regex decisions remain. |
| AtRule | `packages/core/src/tree/at-rule.ts` | `Node` | queued | High priority: reduce custom eval/import/render branches. |
| AttributeSelector | `packages/core/src/tree/selector-attr.ts` | `SimpleSelector` | writeSyntax hook complete | Attribute parts write directly; interpolation eval, valueOf construction, and render capture remain. |
| BasicSelector | `packages/core/src/tree/selector-basic.ts` | `SimpleSelector` | writeSyntax complete | Direct scalar selector emission through `writeSyntax`; broader selector kind flag audit remains. |
| Block | `packages/core/src/tree/block.ts` | `Node` | writeSyntax hook complete | Bracket emission writes directly; render still captures for string/buffer return. |
| Bool | `packages/core/src/tree/bool.ts` | `Node` | writeSyntax hook complete | Scalar writer complete. |
| Call | `packages/core/src/tree/call.ts` | `Node` | queued | High priority: callable output, async path, helper ladders, repeated eval. |
| Collection | `packages/core/src/tree/collection.ts` | `Rules` | queued | Audit wrapper necessity after `Rules`. |
| Color | `packages/core/src/tree/color.ts` | `Node` | writeSyntax hook complete | Color emission writes directly; conversion/string-format internals remain. |
| Combinator | `packages/core/src/tree/combinator.ts` | `Selector` | writeSyntax hook complete | Scalar selector writer avoids selector base punt. |
| Comment | `packages/core/src/tree/comment.ts` | `Node` | queued | Audit line/block branch and direct render. |
| ComplexSelector | `packages/core/src/tree/selector-complex.ts` | `Selector` | writeSyntax complete | Selector component emission uses `writeSyntax`; broader valueOf, malformed repair, and metadata audit remains. |
| CompoundSelector | `packages/core/src/tree/selector-compound.ts` | `Selector` | writeSyntax complete | Component emission uses `writeSyntax`; broader valueOf classification and allocation-array audit remains. |
| Condition | `packages/core/src/tree/condition.ts` | `Node` | writeSyntax hook complete | Source condition syntax writes directly; bool result materialization audit remains. |
| CustomDeclaration | `packages/core/src/tree/declaration-custom.ts` | `Declaration` | queued | Audit custom-property eval/render after `Declaration`. |
| Declaration | `packages/core/src/tree/declaration.ts` | `Node` | queued | High priority: custom property branches, merge state, materialization. |
| DefaultGuard | `packages/core/src/tree/default-guard.ts` | `Node` | writeSyntax hook complete | Scalar guard writer complete. |
| Dimension | `packages/core/src/tree/dimension.ts` | `Node` | writeSyntax hook complete | Number/unit emission writes directly; regex/unit conversion and operation paths remain. |
| Expression | `packages/core/src/tree/expression.ts` | `Node` | writeSyntax hook complete | Wrapper syntax writes directly; child render/eval audit remains. |
| Extend | `packages/core/src/tree/extend.ts` | `Node` | writeSyntax hook complete | Extend syntax writes directly; selector valueOf and resolved selector state remain. |
| ExtendList | `packages/core/src/tree/extend-list.ts` | `Node` | writeSyntax hook complete | List wrapper writes through base child writer plus semicolon; public wrapper existence remains. |
| For | `packages/core/src/tree/control.ts` | `Node` | queued | Audit loop state, body materialization, and async branches. |
| Func | `packages/core/src/tree/function.ts` | `Node` | writeSyntax hook complete | Public function syntax writes directly; function call/eval machinery remains. |
| If | `packages/core/src/tree/control.ts` | `Node` | queued | Audit condition/body materialization and branch count. |
| Interpolated | `packages/core/src/tree/interpolated.ts` | `Node` | queued | High priority: string assembly, selector eval, and replacement arrays. |
| InterpolatedSelector | `packages/core/src/tree/selector-interpolated.ts` | `SimpleSelector` | queued | Replace regex over `valueOf()` with carried selector kind when possible. |
| JsArray | `packages/core/src/tree/js-array.ts` | `Node` | queued | Audit public wrapper necessity. |
| JsExpression | `packages/core/src/tree/js-expr.ts` | `Node` | writeSyntax hook complete | Backtick syntax writes directly; JS eval path remains. |
| JsFunction | `packages/core/src/tree/js-function.ts` | `Node` | queued | Audit wrapper and call integration. |
| JsImport | `packages/core/src/tree/import-js.ts` | `Node` | writeSyntax hook complete | Import syntax writes directly and avoids lazy `options` getter. |
| JsObject | `packages/core/src/tree/js-object.ts` | `Node` | queued | Audit public wrapper necessity. |
| Keyword | `packages/core/src/tree/any.ts` | `Any` | writeSyntax hook complete | Scalar emission uses `Any.writeSyntax`; broader compare/string normalization remains. |
| List | `packages/core/src/tree/list.ts` | `Node` | partial | Direct item writer exists; render still captures string output before buffer writes and eval/render item-loop audit remains. |
| Log | `packages/core/src/tree/log.ts` | `Node` | writeSyntax hook complete | Empty source writer complete; side-effect eval/render path remains. |
| Mixin | `packages/core/src/tree/mixin.ts` | `Node` | queued | High priority: guard/default/body copy and callable candidate output. |
| MixinCollection | `packages/core/src/tree/util/callable-collection.ts` | `Node` | queued | Audit whether this public node wrapper is still necessary. |
| Negative | `packages/core/src/tree/negative.ts` | `Node` | writeSyntax hook complete | Prefix syntax writes directly; unit/text classification remains. |
| Nil | `packages/core/src/tree/nil.ts` | `Node` | writeSyntax hook complete | Empty writer complete; singleton/scalar allocation remains. |
| Num | `packages/core/src/tree/number.ts` | `Dimension` | writeSyntax hook complete | Inherits `Dimension.writeSyntax`; operation paths remain. |
| Operation | `packages/core/src/tree/operation.ts` | `Node` | writeSyntax hook complete | Source operator syntax writes directly; arithmetic eval/calc fallback remains high priority. |
| Paren | `packages/core/src/tree/paren.ts` | `Node` | writeSyntax hook complete | Wrapper syntax writes directly; guard/string conversion render audit remains. |
| PseudoSelector | `packages/core/src/tree/selector-pseudo.ts` | `SimpleSelector` | partial | Direct writer hook exists and generated keyset omission is fixed; generated arg normalization still captures/restores. |
| QueryCondition | `packages/core/src/tree/query-condition.ts` | `Sequence` | queued | Audit after `Sequence`; remove wrapper branches if possible. |
| Quoted | `packages/core/src/tree/quoted.ts` | `Node` | writeSyntax hook complete | Quote syntax writes directly; interpolation/replacement audit remains. |
| Range | `packages/core/src/tree/range.ts` | `Node` | writeSyntax hook complete | Range syntax writes directly. |
| RawRules | `packages/core/src/tree/rules-raw.ts` | `Rules` | writeSyntax hook complete | Raw children and braced output have direct writer hooks; broader Rules audit remains. |
| Reference | `packages/core/src/tree/reference.ts` | `Node` | in progress | Passes 1-10 deleted alias predicates, result/fallback/materialization wrapper helpers, the useless `evalNode(...)` Promise wrapper, direct render closures, option spread helpers, scope-array walker, runtime-key IIFE, small `findVarDeclarationFast(...)` result/IIFE allocations, duplicate fallback/copy/static-return branches, callable surface rechecks, raw lookup sync-path closure/IIFE setup, main eval lookup closure setup, static declaration public-resolve copy/inherit for non-important/non-merged containers, per-call `findVarDeclarationFast(...)` helper closure allocation for bucket selection/candidate ordering/deferred dynamic-name promotion, reference-value evaluator options-object allocation, the declaration evaluator argument-object wrapper, runtime-binding sync evaluator closure setup, the rules-reference lookup executor closure, and render-only dynamic declaration/runtime binding post-eval copy+inherit. Remaining: rules-like surfaces, public value materialization, merged assign normalization, and key conversion. |
| Rest | `packages/core/src/tree/rest.ts` | `Node` | writeSyntax hook complete | Rest syntax writes directly; wrapper necessity remains. |
| Rules | `packages/core/src/tree/rules.ts` | `Node` | queued | High priority: body eval/render, imports, placement state, merge output. |
| Ruleset | `packages/core/src/tree/ruleset.ts` | `Node` | queued | High priority: selector composition, body prep, wrappers, render branches. |
| Selector | `packages/core/src/tree/selector.ts` | `Node` | writeSyntax complete | Selector-family writer hook exists; broader metadata and keyset invalidation audit remains. |
| SelectorCapture | `packages/core/src/tree/selector-capture.ts` | `Node` | writeSyntax hook complete | Capture syntax writes directly; audit whether capture node should exist after render rewrite. |
| SelectorList | `packages/core/src/tree/selector-list.ts` | `Selector` | writeSyntax complete | List item emission uses `writeSyntax`; flattening, temporary arrays, and valueOf joins remain queued. |
| Sequence | `packages/core/src/tree/sequence.ts` | `Node` | partial | Direct sequence writer exists; render still captures and child `toString` transport remains. |
| SimpleSelector | `packages/core/src/tree/selector-simple.ts` | `Selector` | queued | Audit base class necessity and branches. |
| StyleImport | `packages/core/src/tree/import-style.ts` | `Node` | queued | High priority: first-use placement copies and derived rules surfaces. |
| Url | `packages/core/src/tree/url.ts` | `Node` | writeSyntax hook complete | URL syntax writes directly; normalization capture remains. |
| VarDeclaration | `packages/core/src/tree/declaration-var.ts` | `Declaration` | writeSyntax hook complete | Variable prefix syntax writes directly; Declaration body path remains. |
| While | `packages/core/src/tree/control.ts` | `Node` | queued | Audit loop state, body materialization, and async branches. |
