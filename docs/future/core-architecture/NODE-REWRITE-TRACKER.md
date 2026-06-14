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
- [ ] `Ruleset`: source-direct eligibility and bare-ampersand selector-list
  checks use straight loops instead of callback predicates. Render sync-path
  helper closures are lifted out of `render(...)`, and ampersand composition
  uses indexed loops/pre-sized arrays instead of `slice(...)`, spread merge,
  and push-spread flattening. Header compose ampersand counting uses a straight
  character loop instead of `valueOf().match(...)` array allocation. Eliminate
  or isolate `getHeaderString(...)` capture for hot frame render/comparison
  paths.
- [ ] `Declaration`: public syntax boundary exists for callers, non-custom
  declaration children now write through direct syntax hooks, and custom
  fallback function assembly uses straight loops. Render assignment and custom
  interpolated replacement eval plus render/resolve/registration branches now
  rely on `MaybePromise` narrowing instead of local promise/node casts.
  Multiline value formatting and custom fallback leading whitespace now use
  character scans instead of regex `match(...)` arrays, and custom interpolated
  render replacement evaluation uses an indexed loop instead of
  `replacements.entries()`.
  Custom-property raw source,
  duplicate-comparison/materialization, and merge-state boundaries remain.
- [x] `Any` / `Keyword` / `Anonymous`: move scalar token emission to generic
  `writeSyntax`; compare-time `Any` coercion uses the shared compare
  normalizer instead of a per-call local closure.
- [x] `Dimension` / `Num`: numeric/unit emission uses one scalar serializer
  shared by `writeSyntax(...)` and public string output; audit regex/unit
  formatting and operation paths.
- [x] `Color`: scalar/string-backed color emission uses one serializer for
  `writeSyntax(...)` and public string output; preserved node-backed color
  branch stays explicit.
- [x] `PseudoSelector`: direct writer hook, child writer, and inline selector
  list argument writer exist; generated selector-list normalization no longer
  captures/restores a temporary argument string, and evaluated pseudo args use
  `MaybePromise` narrowing instead of local node/promise casts.
- [ ] `Sequence`: direct writer hook exists; no-trivia source children and
  custom-property raw source children use `writeSyntax(...)`, and nil children
  are skipped by the writer instead of materializing replacement arrays. Static
  flat-buffer render writes syntax directly with one writer mark, and
  render/eval branches use `MaybePromise` narrowing. Async-capable dynamic
  render no longer allocates per-call nested rest functions or a local
  render-node closure on the sync path. Boundary separator checks now use
  numeric character tests, an indexed trivia scan, and one shared spacer
  predicate instead of regex/callback probes, and compare-time `Any` coercion
  uses the shared whitespace normalizer. Trivia-backed
  child-boundary emission still uses `toString(...)`.
- [x] `Quoted`: direct quoted/interpolated emission; child node syntax uses
  `writeSyntax(...)` with no public `toTrimmedString(...)` transport, and
  render/eval value selection relies on `MaybePromise` narrowing instead of
  local assertions.
- [ ] `List`: direct item writer exists; no-trivia item emission uses
  `writeSyntax(...)`, and static flat-buffer render writes syntax directly with
  one writer mark; render/eval branches use `MaybePromise` narrowing.
  Async-capable dynamic render no longer allocates a local render-node closure
  or nested rest function on the sync path, and the public iterator no longer
  uses a generator wrapper. Compare-time `Any` coercion uses the shared compare
  normalizer instead of a per-call local closure. Trivia-backed item emission still uses
  `toString(...)`, and dynamic render still captures string output before
  buffer writes.
- [ ] `QueryCondition`: direct condition syntax writer exists, source/static
  children use `writeSyntax(...)` instead of public `toString(...)`, static
  flat-buffer render writes syntax directly with one writer mark, static child
  probe traffic is cut, and dynamic render now uses a straight sync loop with
  an async rest method only after a thenable is observed. Dynamic child render
  still has a localized writer-mark fallback until child render contracts are
  fully direct.
- [x] `Operation`: direct operand/operator writer; source and render operands
  avoid public string transport.
- [x] `Paren`: direct wrapper writer, child syntax transport, list path, and
  render wrapper branch narrowing.
- [x] `Block`: direct `{...}` writer and render path; no-trivia child syntax
  avoids public string transport while source-trivia mode remains explicit;
  child render/eval uses `evalImmediateSync(...)` for non-async values and thenable
  narrowing for async values.
- [x] `Url`: direct `url(...)` writer plus no-trivia context/non-context child
  syntax transport; child render/eval uses `evalImmediateSync(...)` for non-async
  values and thenable narrowing for async values. Context-normalization
  mark/replace path remains queued.
- [x] `Negative`: direct negative-prefix writer, child writer, and render path;
  non-async child render/eval uses `evalImmediateSync(...)`.
- [x] `Bool`: scalar writer.
- [x] `Nil`: confirm no writer/capture work remains; singleton/scalar audit.
- [x] `Comment`: direct comment writer and visibility path.
- [x] `Range`: direct range writer.
- [x] `Rest`: direct rest writer.
- [x] `DefaultGuard`: direct guard writer.
- [x] `Condition`: direct guard/comparison writer, operand writer, and eval
  result path; guard operand branches use `MaybePromise` narrowing.
- [x] `Extend`: direct extend writer; side-effect eval branch uses
  `MaybePromise` narrowing. Audit selector comparison/string keys.

Current hard leftovers after the broad hook sweep:

- `Rules`, `Ruleset`, `Declaration`, `AtRule`, `Call`, `Reference`,
  `QueryCondition`, `Interpolated`, `Mixin`, and `Ampersand`
  still own meaningful render/eval string-transport or branch-heavy paths.
- Shared utility cleanup: `cast([...])` and cloning/reusable-leaf helpers now
  use straight indexed loops instead of `.map(...)`, `.some(...)`, and metadata
  spread copies. `canReuseLeaf(...)` now trusts `F_HAS_NODE_CHILD` instead of
  recursively rediscovering child nodes, and `Node.set(null, ...)` refreshes
  that bit on whole-value replacement. Callable `@arguments` binding now marks
  unadopted child contents with `F_HAS_NODE_CHILD` and skips the intermediate
  flatten array when no rest `Sequence` is present. Callable rest parameter
  matching no longer materializes a rest-only arg array during candidate
  matching; it carries the original args plus a start offset into the lazy rest
  binding/signature helpers. This does not complete any node family; it removes
  callback/crawl/allocation scaffolding from existing cast/copy/binding
  ownership boundaries.
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
  value/name public-string transport in render, and interpolation/value
  branches use `MaybePromise` narrowing instead of local assertions.
- [ ] `Ampersand`: direct source writer exists; append/template placement no
  longer stores dead selector text arrays, no longer splits template strings
  into `templateParts`, no longer uses selector-list iterator/spread
  flattening, no longer copies selector-list parents into temporary replacement
  arrays, and no longer does `toTrimmedString().includes(',')` before scanning
  raw scalar comma selectors. Append placement state now carries only the
  facts it reads, and BasicSelector append avoids generic `Reflect.construct`.
  Structural selector replacement, raw fallback string assembly, and non-basic
  generic class construction remain.
- [ ] `Interpolated`: direct source writer exists, public `replace(...)` no
  longer uses regex callback scaffolding, and live writer replacement emission
  uses `writeSyntax(...)` plus the existing trim window instead of public
  `toTrimmedString(...)` transport. Cold replacement string assembly,
  selector/generic materialization, and replacement arrays remain.
- [x] `InterpolatedSelector`: direct selector writer, cheap kind checks, and
  `MaybePromise` narrowing in eval/resolve/render branches.
- [x] `Reference`: direct unresolved reference writer; keep eval/render result
  emission out of public string APIs.
- [ ] `Call`: direct source syntax writer exists, empty string-name source calls
  return their known source token without writer readback, explicit empty arg
  lists skip render/source argument mark windows, node-valued call names in
  finalized/plain call syntax write directly instead of using public
  `toTrimmedString(...)`, and evaluated call args/content now use
  `writeSyntax(...)` instead of public string transport. Direct
  `Rules`/`Collection` callable render/eval paths now call
  `evaluateCallableCollection(...)` without constructing a one-entry
  `MixinCollection` wrapper. CSS-call arg serialization now uses a straight
  sync loop plus one async continuation instead of per-call nested recursive
  closure helpers, content eval/write shares the same node-local writer
  helper, and plain/finalized call rendering no longer allocates per-call
  finish closures. Remaining work is split callable output value selection,
  `evalArgNodes(...)` copy pressure, whole-call mark/readback, async/helper
  ladders, and repeated eval.
- [x] `Func`: direct function signature/body writer, including name/params, if
  public syntax remains necessary. Stylesheet function calls now invoke
  `evaluateCallableCollection(...)` directly instead of allocating a
  one-entry `MixinCollection` wrapper.
- [ ] `Mixin`: direct source syntax/guard writer exists, and interpolated-name
  derivation no longer allocates conditional object-spread fragments for
  optional `name`/`params`/`guard`. Audit guard/default/body copy interactions
  and callable candidate output.
- [x] `MixinCollection`: live callable-value handoff wrapper. Immediate
  same-turn eval wrappers in `Call`/`Func` are cut, focused tests prove the
  remaining direct callable handoff still exists outside `rules.ts`, and no
  source writer should be invented for this cold wrapper.
- [ ] `Rules`: direct braced source writer exists and public `toBraced(...)`
  is now a cold wrapper; isolate root public source serializer, frame header
  comparison, imports, and duplicate declaration materialization.
- [x] `RawRules`: direct raw body writer.
- [x] `Collection`: live wrapper with direct braced source writer; broader
  wrapper necessity remains out of scope for this source-writer pass.
- [ ] `AtRule`: direct source writer exists, and header name/prelude capture
  writes child syntax directly instead of routing through public `toString(...)`.
  Remove remaining custom eval/render branch ladders where state already
  carries kind. Body eval/registration async branches now use `MaybePromise`
  narrowing, render sync-path helper closures are lifted out of `render(...)`,
  and leaf render no longer allocates a local render-node closure.
- [ ] `StyleImport`: direct import/render writer and placement state; no
  first-use copied rules surfaces on render-only paths. Placement-state
  bookkeeping no longer stores a redundant top-level `Map`, unused preservation
  flag, or defensive recursive `Set`, but first-use child copies still remain.
- [x] `JsImport`: live parser-owned syntax node for Jess/SCSS JS module
  imports; keep direct source writer.
- [x] `JsExpression`: live explicit JS eval node; backtick source wrapper
  returns the known scalar token directly. Do not spend deeper render/source
  polish here unless the JS eval feature itself is redesigned.
- [x] `JsArray`: no Less/SCSS/Jess parser production and `cast([...])` creates
  `List`, not `JsArray`; focused host/reference tests prove it is still a
  public explicit host wrapper for direct indexed `Reference` targets. Keep it
  cold and do not invent source serialization; removal would be a dedicated
  API-breaking host-wrapper pass.
- [x] `JsObject`: live host-object/index wrapper because `cast(plainObject)`
  creates `JsObject` and indexed references read properties from it. Keep cold;
  do not invent source serialization.
- [x] `JsFunction`: live function-registry host wrapper used by plugins,
  language service, and call/reference execution. Keep cold; do not invent
  source serialization.
- [x] `Expression`: direct child writer; render uses `evalImmediateSync(...)` for
  non-async scalar children and `MaybePromise` narrowing in eval/resolve.
  Audit wrapper necessity remains.
- [x] `CustomDeclaration`: audited after `Declaration`. It inherits the
  declaration writer/render staging and only wraps eval with `context.inCustom`
  state; focused declaration tests prove custom declaration resolve/render
  output and streaming behavior.
- [x] `VarDeclaration`: local writer probe removed; preserve binding semantics.
  Broader declaration body staging remains on `Declaration`.
- [x] `For`: direct source syntax writer exists, range-bound closure removed,
  async-generator entry iteration is gone, per-entry tuple arrays are gone,
  constructor binding adoption is direct, eval no longer allocates a local
  `run` closure, and render path already emits body output directly. Remaining
  owned iteration `Rules` surfaces are semantic placement/eval state, not
  render/string transport; focused tests prove no `Rules.clone`, scalar leaf
  reuse, canonical body parenting, live loop bindings, and render/eval output
  alignment.
- [x] `While`: direct source syntax writer exists; render path already emits
  body output directly, the state-mutation probe uses a straight loop, and
  public render no longer allocates the control string wrapper callback. Eval
  no longer allocates a local `run` closure, and eval/render no longer allocate
  a rules-context callback wrapper. Remaining state/iteration `Rules` surfaces
  are semantic placement/eval state, not render/string transport; focused tests
  prove no `Rules.clone`, scalar leaf reuse, canonical body parenting,
  stateful loop render/eval alignment, and rules-context restoration on throw.
- [x] `If`: direct source syntax writer exists, branch serialization avoids
  rest-array allocation, selected branch buffer render passes the existing
  `RenderBuffer` through to `Rules.render(...)` instead of staging through a
  detached rules string, public render no longer allocates the control string
  wrapper callback, and eval no longer allocates a local `run` closure.
- [x] `Log`: side-effect render path stays direct; redundant public
  `toString(...)` override removed while cold empty `toTrimmedString(...)`
  remains.

| Node | File | Base/family | Status | Rewrite notes |
| --- | --- | --- | --- | --- |
| Ampersand | `packages/core/src/tree/ampersand.ts` | `SimpleSelector` | partial | Direct source writer exists; append/template placement no longer stores dead selector text arrays, no longer splits template strings into `templateParts`, selector-list template flattening uses indexed loops instead of iterator/spread, placement state carries only live facts, and BasicSelector append avoids generic `Reflect.construct`. Remaining debt is structural selector replacement, raw string assembly, and non-basic generic construction. |
| Anonymous | `packages/core/src/tree/any.ts` | `Any` | writeSyntax hook complete | Scalar emission uses `Any.writeSyntax`; compare-time text normalization now shares the internal compare utility. |
| Any | `packages/core/src/tree/any.ts` | `Node` | writeSyntax hook complete | Scalar emission has a direct writer; compare-time text normalization now shares the internal compare utility; string conversion and numeric regex decisions remain. |
| AtRule | `packages/core/src/tree/at-rule.ts` | `Node` | partial | Direct source writer exists; header name/prelude capture writes child syntax directly instead of public `toString(...)`; prelude boundary trivia is emitted explicitly; body eval/registration async branches use `MaybePromise` narrowing; and sync/leaf render no longer allocates local render/result helper closures. High priority: remaining custom eval/import/render branches, body-state staging, and header capture boundary. |
| AttributeSelector | `packages/core/src/tree/selector-attr.ts` | `SimpleSelector` | direct child writer complete | Attribute parts write directly through child `writeSyntax(...)`; cold private source-string wrapper removed; interpolation eval/render branches use `MaybePromise` narrowing. ValueOf construction and render capture remain. |
| BasicSelector | `packages/core/src/tree/selector-basic.ts` | `SimpleSelector` | writeSyntax complete | Direct source spelling emits authored `value`; kind checks use first-character tests, `valueOf()` remains normalized key text, and standalone eval now carries the existing selector-bit library from context. |
| Block | `packages/core/src/tree/block.ts` | `Node` | writeSyntax hook complete | Bracket emission writes directly; no-trivia child syntax avoids public `toString(...)`, while trivia mode keeps source serialization for authored inner comments/spacing. Render/eval use `evalImmediateSync(...)` for non-async child values and thenable narrowing for async values. Render still captures for string/buffer return. |
| Bool | `packages/core/src/tree/bool.ts` | `Node` | scalar wrapper complete | Scalar writer complete; public `toTrimmedString(...)` writes the known token directly with no writer readback. |
| Call | `packages/core/src/tree/call.ts` | `Node` | partial | Source syntax writer exists, public call source stringification uses child `writeSyntax(...)`, empty string-name calls return their known source token without writer readback, zero-arg and explicit-empty-arg render/source serialization no longer opens writer mark/trim windows, node-valued names plus evaluated args/content in finalized/plain call syntax write directly instead of public `toTrimmedString(...)`, direct `Rules`/`Collection` callable render/eval paths call `evaluateCallableCollection(...)` without constructing a one-entry `MixinCollection` wrapper, CSS-call arg serialization uses a straight sync loop plus one async continuation instead of per-call nested recursive closure helpers, plain/finalized render no longer allocates per-call finish closures, and sync evaluated syntax uses `evalImmediateSync(...)` instead of public `evalSync(...)` materialization. High priority remains for callable output, `evalArgNodes(...)` copy pressure, whole-call mark/readback, async path, helper ladders, and repeated eval. |
| Collection | `packages/core/src/tree/collection.ts` | `Rules` | direct braced writer complete | Live wrapper; `writeSyntax(...)` writes braced rules directly and public `toTrimmedString(...)` is the cold capture boundary. Broader wrapper necessity remains separate. |
| Color | `packages/core/src/tree/color.ts` | `Node` | scalar serializer complete | Scalar/string-backed color emission uses one serializer for `writeSyntax(...)` and public string output with no writer readback; preserved node-backed color syntax still writes the child directly; hex serialization uses a straight loop instead of callback-array joining; broader conversion internals remain. |
| Combinator | `packages/core/src/tree/combinator.ts` | `Selector` | scalar wrapper complete | Scalar selector writer avoids selector base punt, and public `toTrimmedString(...)` writes the known token directly with no writer readback. |
| Comment | `packages/core/src/tree/comment.ts` | `Node` | writeSyntax hook complete | Comment text writes directly; visibility/render behavior remains the inherited direct scalar path. |
| ComplexSelector | `packages/core/src/tree/selector-complex.ts` | `Selector` | writeSyntax complete | Selector component emission uses direct `writeSyntax` with the dead non-selector fallback branch removed, cold private source-string wrapper is gone, and component eval/resolve uses `MaybePromise` narrowing; broader valueOf, malformed repair, and metadata audit remains. |
| CompoundSelector | `packages/core/src/tree/selector-compound.ts` | `Selector` | writeSyntax complete | Component emission uses `writeSyntax`, cold private source-string wrapper is gone, and component eval/resolve uses `MaybePromise` narrowing; broader valueOf classification and allocation-array audit remains. |
| Condition | `packages/core/src/tree/condition.ts` | `Node` | direct operand writer complete | Source condition syntax writes directly through operand `writeSyntax(...)`; bool result materialization audit remains. |
| CustomDeclaration | `packages/core/src/tree/declaration-custom.ts` | `Declaration` | inherited staging audited | Inherits `Declaration` writer/render staging and only wraps eval with `context.inCustom`; focused declaration tests cover custom declaration resolve/render output and streaming behavior. |
| Declaration | `packages/core/src/tree/declaration.ts` | `Node` | partial | `writeSyntax(...)` now gives containers a direct declaration syntax boundary, non-custom name/value/important children use direct writers instead of public string transport, custom fallback function assembly uses loops instead of filter/map/join arrays, source-free assignment reuse uses a straight loop, render/resolve/registration/eval branches use thenable narrowing instead of local promise/node casts, multiline formatting avoids regex match arrays, and custom interpolated render replacement evaluation uses an indexed loop instead of `entries()`. High priority remains for custom property raw-source branches, merge state, internal mark/replace, and materialization. |
| DefaultGuard | `packages/core/src/tree/default-guard.ts` | `Node` | scalar wrapper complete | Scalar guard writer complete; public source string writes the known `default` token directly with no writer readback. |
| Dimension | `packages/core/src/tree/dimension.ts` | `Node` | scalar serializer complete | Number/unit emission uses one scalar serializer for `writeSyntax(...)` and public string output with no writer readback; preserve-mode compound unit serialization uses a straight loop instead of `map(...).join(...)`; regex/unit conversion and operation paths remain. |
| Expression | `packages/core/src/tree/expression.ts` | `Node` | direct child writer complete | Wrapper syntax writes directly and now calls child `writeSyntax(...)` instead of public `toString(...)`; eval/resolve rely on thenable narrowing, and scalar render uses `evalImmediateSync(...)` when the child is not may-async. Wrapper necessity remains. |
| Extend | `packages/core/src/tree/extend.ts` | `Node` | writeSyntax hook complete | Extend syntax and selector/target child syntax write directly with no local public string wrapper; selector valueOf and resolved selector state remain. |
| ExtendList | `packages/core/src/tree/extend-list.ts` | `Node` | writeSyntax hook complete | List wrapper writes through base child writer plus semicolon; public wrapper existence remains. |
| For | `packages/core/src/tree/control.ts` | `Node` | partial | Source syntax writer exists, pattern/iterable children use direct writers, range-bound closure is gone, async-generator entry iteration is replaced by a direct visitor, per-entry tuple arrays are gone, constructor binding adoption is direct, and child-copy list building uses a pre-sized loop instead of `.map(...)`. Loop state/body surface and async branch audit remain. |
| Func | `packages/core/src/tree/function.ts` | `Node` | direct child writer complete | Public function syntax writes directly through name/params and body braced writer; function calls now invoke `evaluateCallableCollection(...)` directly instead of allocating a one-entry `MixinCollection` wrapper. |
| If | `packages/core/src/tree/control.ts` | `Node` | partial | Source syntax writer exists, condition children use direct writers, branch serialization avoids rest-array allocation, selected branch buffer render uses the existing `RenderBuffer` instead of a detached rules string, and public render no longer allocates the control string wrapper callback. Eval/body surface audit remains. |
| Interpolated | `packages/core/src/tree/interpolated.ts` | `Node` | partial | Direct source writer exists, public `replace(...)` uses a plain placeholder loop instead of regex callback scaffolding, live writer replacement emission uses `writeSyntax(...)` instead of public `toTrimmedString(...)` transport, and replacement plus selector/generic eval/resolve paths use thenable narrowing instead of local node/promise casts; high-priority selector eval, generic materialization, cold replacement capture, and replacement arrays remain. |
| InterpolatedSelector | `packages/core/src/tree/selector-interpolated.ts` | `SimpleSelector` | direct writer/kind check complete | Source syntax writes directly through `Interpolated.writeSyntax(...)`; `isClass`/`isId`/`isTag` use first-character checks instead of regex, and eval/render selector output uses `MaybePromise` narrowing. |
| JsArray | `packages/core/src/tree/js-array.ts` | `Node` | cold host wrapper audited | No Less/SCSS/Jess parser constructs it, `cast([...])` creates `List`, and explicit host/reference tests still use it for direct indexed targets. Keep cold; remove only in a dedicated API-breaking host-wrapper pass. |
| JsExpression | `packages/core/src/tree/js-expr.ts` | `Node` | scalar wrapper complete | Backtick source syntax writes the known scalar token directly with no writer readback; JS eval path remains. Skip deeper polish unless JS eval support is being redesigned. |
| JsFunction | `packages/core/src/tree/js-function.ts` | `Node` | live host wrapper | Function registry/plugins/language service/call/reference paths consume it. Keep cold; no arbitrary source writer. |
| JsImport | `packages/core/src/tree/import-js.ts` | `Node` | live parser node | Jess `@-use/@-from` and SCSS `@use "sass:*"` construct it; import syntax writes directly and path child uses `writeSyntax(...)`. |
| JsObject | `packages/core/src/tree/js-object.ts` | `Node` | live host wrapper | `cast(plainObject)` creates it and indexed references read properties from it. Keep cold; no arbitrary source writer. |
| Keyword | `packages/core/src/tree/any.ts` | `Any` | writeSyntax hook complete | Scalar emission uses `Any.writeSyntax`; compare-time text normalization now shares the internal compare utility. |
| List | `packages/core/src/tree/list.ts` | `Node` | partial | Direct item writer exists, no-trivia items avoid public `toString(...)`, static flat-buffer render writes syntax directly with one writer mark, cached `valueOf()` uses a plain loop instead of callback-array joining, render/eval item branches use `MaybePromise` narrowing, async-capable dynamic render no longer allocates local closure/rest scaffolding on the sync path, `[Symbol.iterator]` returns the array iterator directly instead of using a generator wrapper, and compare-time `Any` coercion uses the shared compare normalizer. Trivia-backed item emission, dynamic render string capture before buffer writes, and eval/render item-loop audit remain. |
| Log | `packages/core/src/tree/log.ts` | `Node` | complete | Empty source writer complete, redundant `toString(...)` override removed, and side-effect eval/render path is direct with `MaybePromise` narrowing. |
| Mixin | `packages/core/src/tree/mixin.ts` | `Node` | partial | Source syntax writer exists and name/params/guard use direct child writers; interpolated-name derivation now builds the owned value object directly instead of allocating conditional spread fragments; high priority remains for guard/default/body copy and callable candidate output. |
| MixinCollection | `packages/core/src/tree/util/callable-collection.ts` | `Node` | cold handoff audited | Live callable-value handoff wrapper; immediate eval-only wrappers in `Call`/`Func` are cut, and focused tests prove the remaining public value surface is the direct callable handoff outside `rules.ts`. No source writer should be invented. |
| Negative | `packages/core/src/tree/negative.ts` | `Node` | partial scalar wrapper complete | Prefix syntax writes directly, simple dimension source/render output writes known scalar text with no writer readback, arbitrary child syntax still calls child `writeSyntax(...)`, and non-async child render/eval uses `evalImmediateSync(...)`. Unit/text classification remains. |
| Nil | `packages/core/src/tree/nil.ts` | `Node` | writeSyntax hook complete | Empty writer complete; singleton/scalar allocation remains. |
| Num | `packages/core/src/tree/number.ts` | `Dimension` | scalar serializer complete | Inherits `Dimension` scalar serialization; operation paths remain. |
| Operation | `packages/core/src/tree/operation.ts` | `Node` | partial | Source operator syntax and operands write directly with no public `toString(...)`; render/eval operand branches use `MaybePromise` narrowing, no longer allocate per-call local operand/finalizer/render-combine closures, and non-preserve arithmetic no longer pays useless `try/catch { throw error }` wrappers. Arithmetic eval `withOperands(...)` copy pressure and preserve-mode calc fallback ownership remain high priority. |
| Paren | `packages/core/src/tree/paren.ts` | `Node` | writeSyntax hook complete | Wrapper syntax and child source syntax write directly through `writeSyntax(...)`; render wrapper branch uses `MaybePromise` narrowing. Guard/string conversion render audit remains. |
| PseudoSelector | `packages/core/src/tree/selector-pseudo.ts` | `SimpleSelector` | writeSyntax complete | Direct writer hook and child arg writer exist, generated keyset omission is fixed, cold private source-string wrapper is gone, selector-list args now write inline without capture/replace/restore, and eval arg handling uses thenable narrowing instead of local node/promise casts. Eval arg materialization remains separate. |
| QueryCondition | `packages/core/src/tree/query-condition.ts` | `Sequence` | partial | Source/static child syntax now uses `writeSyntax(...)` instead of public `toString(...)`, static flat-buffer render writes syntax directly with one writer mark, static child render avoids writer-mark probes, render branches use `MaybePromise` narrowing, and dynamic render no longer allocates local closure/rest scaffolding on the sync path. Dynamic child render keeps one localized mark fallback because child render may write or return until downstream contracts are direct. |
| Quoted | `packages/core/src/tree/quoted.ts` | `Node` | partial scalar wrapper complete | Literal quoted source syntax writes the known scalar token directly with no writer readback; node/interpolated quoted values stay on the existing writer boundary, child node syntax writes directly, and render/eval value branches use `MaybePromise` narrowing. |
| Range | `packages/core/src/tree/range.ts` | `Node` | writeSyntax hook complete | Range syntax and bound child syntax write directly with no local public string wrapper. |
| RawRules | `packages/core/src/tree/rules-raw.ts` | `Rules` | direct braced writer complete | Raw body/braced loops use indexed loops, no-trivia children call `writeSyntax(...)`, and trivia-backed children keep `toString(...)` for exact whitespace/comment preservation. Broader Rules audit remains. |
| Reference | `packages/core/src/tree/reference.ts` | `Node` | in progress | Passes 1-14 deleted alias predicates, result/fallback/materialization wrapper helpers, the useless `evalNode(...)` Promise wrapper, direct render closures, option spread helpers, scope-array walker, runtime-key IIFE, small `findVarDeclarationFast(...)` result/IIFE allocations, duplicate fallback/copy/static-return branches, callable surface rechecks, raw lookup sync-path closure/IIFE setup, main eval lookup closure setup, static declaration public-resolve copy/inherit for non-important/non-merged containers, per-call `findVarDeclarationFast(...)` helper closure allocation for bucket selection/candidate ordering/deferred dynamic-name promotion, reference-value evaluator options-object allocation, the declaration evaluator argument-object wrapper, runtime-binding sync evaluator closure setup, the rules-reference lookup executor closure, render-only dynamic declaration/runtime binding post-eval copy+inherit, the per-call `findVarWithinScopeSurface(...)` recursive helper allocation inside `findVarDeclarationFast(...)`, the per-call `searchChain(...)` closure inside `lookupRuntimeVarBinding(...)`, runtime-binding/declaration reference sync finalizer closures, key-normalization/direct-index raw-target local closures, mixin/ruleset materialization finalizer closure, merged-assign collector closure, and calc slash finalizer closure; heavy lookup helper bodies now live in `packages/core/src/tree/util/reference-lookup.ts` instead of the node file; unresolved reference source serialization now has a direct `writeSyntax(...)` path, and target/key source children no longer route through public `toString(...)`. Remaining: rules-like surfaces, public value materialization, merged assign normalization, and key conversion. |
| Rest | `packages/core/src/tree/rest.ts` | `Node` | partial scalar wrapper complete | String/empty rest syntax writes the known source token directly with no writer readback; node-valued rest stays on the existing child writer boundary. Wrapper necessity remains. |
| Rules | `packages/core/src/tree/rules.ts` | `Node` | partial | Direct braced source writer exists, public `toBraced(...)` is cold, and registration/source-order eval async branches use `MaybePromise` narrowing; high priority remains for body eval/render, imports, placement state, merge output, and root serializer capture. |
| Ruleset | `packages/core/src/tree/ruleset.ts` | `Node` | partial | Source-direct eligibility and bare-ampersand selector-list checks use straight loops with short-circuit tests, guard/body eval branches use `MaybePromise` narrowing, sync render no longer allocates local render/eval helper closures, ampersand composition uses loops/pre-sized arrays instead of `slice(...)`, spread merge, and push-spread flattening, and header compose ampersand counting no longer allocates a regex match array. High priority remains for `getHeaderString(...)` capture, deeper selector composition, body prep, wrappers, and render branches. |
| Selector | `packages/core/src/tree/selector.ts` | `Node` | writeSyntax complete | Selector-family writer hook exists; broader metadata and keyset invalidation audit remains. |
| SelectorCapture | `packages/core/src/tree/selector-capture.ts` | `Node` | child/buffer staging complete | Capture syntax writes directly through child `writeSyntax(...)`, cold private source-string wrapper is gone, and resolved buffer render delegates to the child buffer renderer instead of rendering to string then writing that string. Audit whether capture node should exist after render rewrite. |
| SelectorList | `packages/core/src/tree/selector-list.ts` | `Selector` | writeSyntax complete | List item emission uses `writeSyntax`, cold private source-string wrapper is gone, and selector eval/resolve uses `MaybePromise` narrowing; flattening, temporary arrays, and valueOf joins remain queued. |
| Sequence | `packages/core/src/tree/sequence.ts` | `Node` | partial | Direct sequence writer exists; no-trivia and custom-property raw source children use `writeSyntax(...)`; nil children are skipped in the writer so static render no longer materializes a filtered replacement array; static flat-buffer render writes syntax directly with one writer mark; render/eval branches use `MaybePromise` narrowing; async-capable dynamic render no longer allocates local render-node/rest closures on the sync path; boundary separator checks now use numeric character tests, an indexed trivia scan, and one shared spacer predicate instead of regex/callback probes; compare-time `Any` coercion uses the shared whitespace normalizer. Trivia-backed child `toString` transport and broader dynamic render capture remain until boundary-trivia emission is made explicit. |
| SimpleSelector | `packages/core/src/tree/selector-simple.ts` | `Selector` | queued | Audit base class necessity and branches. |
| StyleImport | `packages/core/src/tree/import-style.ts` | `Node` | queued | High priority: first-use placement copies and derived rules surfaces. |
| Url | `packages/core/src/tree/url.ts` | `Node` | writeSyntax hook complete | URL wrapper and no-trivia child syntax write directly in source and context modes; render/eval use `evalImmediateSync(...)` for non-async child values and thenable narrowing for async values. Render/context normalization still uses localized mark/replace and remains queued. |
| VarDeclaration | `packages/core/src/tree/declaration-var.ts` | `Declaration` | partial scalar wrapper complete | Bare parameter vars with nil defaults write the known `$name` token with no writer readback. General variable prefix syntax writes directly, but declaration body path remains. |
| While | `packages/core/src/tree/control.ts` | `Node` | partial | Source syntax writer exists, condition uses direct writer, state-mutation probing uses a straight loop instead of `.some(...)`, and public render no longer allocates the control string wrapper callback. Loop state/body surface and async branch audit remain. |
