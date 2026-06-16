# Node Rewrite Tracker

This tracker owns the node-by-node cleanup program. The rule is simple: when
the user asks to continue or run the full queue, keep working autonomously
across the open rows. Finish a bounded cut, prove output with focused unit
tests, update docs, commit/push, then immediately continue to the next
highest-value open row. Stop only when all rows are complete, a real semantic
blocker appears, the repo becomes unsafe, or the remaining work is explicitly
benchmark-first design/tradeoff work.

Within each row, prefer structural facts, straight loops, fewer branches, fewer
function calls, and fewer conversions.

Use sub-agents as accelerators for independent evidence, not as unmanaged
editors. Useful assignments include: audit one open row for remaining
string/capture/copy paths, identify focused tests for a node family, compare
two possible direct-render rewrites, or review the current diff against the
aggressive-cutting rules. The primary agent must own the final patch,
verification, docs, commit, push, and continuation.

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

Current focus lock: this queue is the active focus. Finish unfinished
node/family serialization rows across the repo before selecting any other core
architecture work. A full autonomous run should close one or more whole rows
whenever possible: direct `writeSyntax(...)`, direct `render(...)` emission
after value selection, cold public string wrappers only, and removal or
documented isolation of render-only `mark/getSince`, writer capture/readback,
detached writers, temporary syntax arrays, and public string transport.
Selector/equality cleanup, binding-index work, lookup redesign,
copy/materialization cleanup, benchmark tuning, and generic smell sweeps are not
separate queue candidates while this focus is active.

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

Priority comes from the latest broad `benchmark.less` caller-stack evidence
when choosing among unfinished serialization rows. Hot unfinished rows include
`Ruleset.getHeaderString`, declaration duplicate pre-rendering/materialization,
`QueryCondition`, `Call`, `Rules`, `AtRule`, `Reference`, `Mixin`,
`Ampersand`, and `Interpolated`.

- [ ] `Node` base: generic `writeSyntax(options): void` hook exists, and base
  child `toTrimmedString(...)` now uses direct child syntax/source-trivia
  emission instead of public child `toString(...)`. Global base render dispatch
  is deliberately still off until the remaining node overrides are complete; a
  direct flip regressed Paren/root serialization, and `node-render-buffer`
  still proves a source-only adapter compatibility boundary.
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
  character loop instead of `valueOf().match(...)` array allocation. Serializer
  flattening/hoisted-frame setup now uses indexed loops and existing frame
  arrays instead of callback scans, visible-child temp arrays, filtered
  frame arrays, spread frame arrays, and `queue.shift()`. Duplicate declaration
  handling now pre-renders only repeated properties instead of every
  declaration in the visible render list. Eliminate or isolate
  `getHeaderString(...)` capture for hot frame render/comparison paths.
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
  normalizer instead of a per-call local closure, and fallback comparison reads
  the owned scalar `Any.value` instead of serializing the left token through
  public `toString(...)`.
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
- [x] `Sequence`: direct writer hook exists; no-trivia source children and
  custom-property raw source children use `writeSyntax(...)`, and nil children
  are skipped by the writer instead of materializing replacement arrays. Static
  flat-buffer render writes syntax directly with one writer mark, and
  render/eval branches use `MaybePromise` narrowing. Async-capable dynamic
  render no longer allocates per-call nested rest functions or a local
  render-node closure on the sync path. Boundary separator checks now use
  numeric character tests, an indexed trivia scan, and one shared spacer
  predicate instead of regex/callback probes, and compare-time `Any` coercion
  uses the shared whitespace normalizer plus direct `Any.value` reads for the
  right operand. Dynamic buffer render now reuses the direct render mark for
  `writePreparedRenderText(...)` instead of opening an outer buffer mark around
  an inner render readback. Trivia-backed child-boundary emission uses direct
  trivia-aware `writeSyntax(...)` instead of public child `toString(...)`.
  Single-child buffer render no longer leaks child output into an unrelated
  explicit writer before writing the result to the requested render buffer.
  Public render string return compatibility is the documented public
  `RenderBufferNode.render(...)` boundary.
- [x] `Quoted`: direct quoted/interpolated emission; child node syntax uses
  `writeSyntax(...)` with no public `toTrimmedString(...)` transport,
  non-escaped `Any` values use direct scalar wrapper emission, and render/eval
  value selection relies on `MaybePromise` narrowing instead of local
  assertions.
- [x] `List`: direct item writer exists; no-trivia item emission uses
  `writeSyntax(...)`, and static flat-buffer render writes syntax directly with
  one writer mark; render/eval branches use `MaybePromise` narrowing.
  Async-capable dynamic render no longer allocates a local render-node closure
  or nested rest function on the sync path, and the public iterator no longer
  uses a generator wrapper. Compare-time `Any` coercion uses the shared compare
  normalizer plus direct `Any.value` reads for the right operand. Dynamic
  buffer render now reuses the direct render mark for
  `writePreparedRenderText(...)` instead of opening an outer buffer mark around
  an inner render readback. Trivia-backed item emission uses direct
  trivia-aware `writeSyntax(...)` instead of public child `toString(...)`.
  Dynamic render still returns a string as the documented public
  `RenderBufferNode.render(...)` boundary.
- [ ] `QueryCondition`: direct condition syntax writer exists, source/static
  children use `writeSyntax(...)` instead of public `toString(...)`, static
  flat-buffer render writes syntax directly with one writer mark, static child
  probe traffic is cut, and dynamic render now uses a straight sync loop with
  an async rest method only after a thenable is observed. Async-capable dynamic
  render now keeps class-contract static siblings on direct syntax emission even
  when another child is async, and the remaining dynamic fallback checks
  `hasContentSince(mark)` instead of opening a second `mark()` just to test
  whether the child wrote. Dynamic child render still has a localized
  writer-mark fallback for instance-owned/custom render overrides until child
  render contracts are fully direct.
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
- [x] `Range`: direct range writer; simple scalar bounds render without writer
  readback.
- [x] `Rest`: direct rest writer.
- [x] `DefaultGuard`: direct guard writer.
- [x] `Condition`: direct guard/comparison writer, operand writer, and eval
  result path; guard operand branches use `MaybePromise` narrowing.
- [x] `Extend`: direct extend writer; side-effect eval branch uses
  `MaybePromise` narrowing. Recursive selector extend search now carries one
  local path stack through indexed descent instead of allocating child path
  arrays through callback/spread recursion, and selector equality predicates
  now use indexed loops instead of `some(...)`, `every(...)`, `filter(...)`,
  or a temporary numeric-segment array for common selector matching checks.
  Audit selector comparison/string keys.

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
- `Sequence` and `List` are complete for the render/string boundary. Their
  remaining work is the separate addition/copy ownership row in the active
  handoff; do not reopen public render string-return compatibility unless the
  `RenderBufferNode.render(...)` API changes.
- `PseudoSelector` has a writer hook and child writer, its cold private
  source-string wrapper is gone, and generated selector-list normalization now
  writes inline comma-space syntax directly instead of capturing/restoring a
  temporary argument string. The same pass fixed generated `:is(...)`
  required-key metadata to match single-selector-list wrapper omission.
- Selector extend full-search walkers now use one mutable local path stack and
  indexed loops for selector-list, compound, complex, and pseudo-selector
  descent; path arrays are copied only when a match location is stored. This
  does not complete selector equality because value-key matching and factory
  remainder materialization remain.
- Selector equality/classification predicates now avoid callback helper scans
  in `determineExtensionType(...)`, `componentsMatch(...)`,
  `areSelectorArgumentsEquivalent(...)`, and
  `areCompoundSelectorsEquivalent(...)`. This does not complete selector
  equality because value-key matching and factory remainder materialization
  remain.
- Rejected: `trySmallCompoundExtendMatch(...)` subset/remainder factory
  callback removal was tried and reverted after bounded benchmarks showed
  usable regressions on `extend-chaining` and `media`. Do not retry the same
  local loop rewrite without a broader structural change or profile evidence.
  The false assumption was that fewer callback closures/temporary arrays would
  automatically beat V8's existing optimized callback shape; the benchmark
  showed the real cost is broader repeated selector matching/remainder logic.
- [x] `ExtendList`: direct list writer; remove super-string wrapper; render
  runs child extend effects directly instead of public child render.
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
  `toTrimmedString(...)` transport. Whole-selector interpolation and embedded
  selector replacement assembly with owned scalar token replacements
  (`Any`/`Anonymous`/`Keyword`) now build selector text from direct scalar text
  instead of public `toTrimmedString(...)`. Cold replacement string assembly,
  non-scalar selector/generic materialization, and replacement arrays remain.
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
  finish closures. Plain/evaluated CSS-call buffer render reuses the buffer
  writer mark for the whole-call readback instead of nesting a second
  call-level mark. Scalar-contract args (`Num`, `Dimension`, `Color`, `Bool`,
  `Any`, `Anonymous`, `Keyword`) now skip per-argument trim marks and immediate
  eval calls when no trivia is active and base `Node.eval` is intact.
  Stylesheet `Func` calls now pass source args into the callable binding
  surface directly instead of building a pre-evaluated replacement `List`.
  Finalized empty string-name fallback calls write the known `name()`/
  important text directly without call-level writer mark/readback.
  Remaining work is split callable output value selection,
  `evalArgNodes(...)` copy pressure for calc/finalized CSS fallback paths,
  non-scalar/custom/trivia arg trim marks, async/helper ladders, and repeated
  eval.
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
- [x] `StyleImport`: direct import/render writer and placement state; no
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
- [x] `VarDeclaration`: local writer probe removed; preserve binding semantics;
  bare parameter names avoid public string transport.
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
| Ampersand | `packages/core/src/tree/ampersand.ts` | `SimpleSelector` | partial | Direct source writer exists; collapse-mode parent selector emission now uses direct `writeSyntax(...)` instead of public `toString(...)`; append/template placement no longer stores dead selector text arrays, no longer splits template strings into `templateParts`, selector-list template flattening uses indexed loops instead of iterator/spread, placement state carries only live facts, and BasicSelector append avoids generic `Reflect.construct`. Remaining debt is structural selector replacement, raw string assembly, and non-basic generic construction. |
| Anonymous | `packages/core/src/tree/any.ts` | `Any` | scalar render complete | Inherits `Any` scalar emission: source, public capture, and render write owned text directly with no inherited render-buffer mark window. |
| Any | `packages/core/src/tree/any.ts` | `Node` | scalar render complete | Scalar emission has a direct writer, public capture writes owned text directly, and render writes direct string/buffer output without inherited base mark/readback; compare-time text normalization now shares the internal compare utility; string conversion and numeric regex decisions remain. |
| AtRule | `packages/core/src/tree/at-rule.ts` | `Node` | partial | Direct source writer exists; header name/prelude capture writes child syntax directly instead of public `toString(...)`; prelude boundary trivia is emitted explicitly; body eval/registration async branches use `MaybePromise` narrowing; sync/leaf render no longer allocates local render/result helper closures; scalar dynamic leaf name/prelude pieces skip child mark/getSince/restore readback when no trivia is active; scalar no-trivia header name/prelude assembly skips writer readback entirely; no-trivia headers skip the post-prelude writer probe; and `valueOf()` now reads the name value key instead of public name `toString(...)`. High priority: remaining custom eval/import/render branches, body-state staging, and non-scalar header/leaf capture boundaries. |
| AttributeSelector | `packages/core/src/tree/selector-attr.ts` | `SimpleSelector` | scalar wrapper partial | Attribute parts write directly through child `writeSyntax(...)`; bare string-name attributes and common scalar non-bare forms (`Any` and simple `Quoted` values, including resolved scalar variable values) write/buffer known text without writer readback; `valueOf()` uses node value semantics for node-valued names instead of public `toTrimmedString()` transport; cold private source-string wrapper removed; interpolation eval/render branches use `MaybePromise` narrowing. Non-scalar render capture remains. |
| BasicSelector | `packages/core/src/tree/selector-basic.ts` | `SimpleSelector` | writeSyntax complete | Direct source spelling emits authored `value`; kind checks use first-character tests, `valueOf()` remains normalized key text, and standalone eval now carries the existing selector-bit library from context. |
| Block | `packages/core/src/tree/block.ts` | `Node` | scalar wrapper partial | Bracket emission writes directly; nil and `Any` block source/render paths write known delimiter/content text without writer readback; scalar `Any` flat-buffer render now skips print-state setup and writes the known wrapper text directly after value selection; child syntax avoids public `toString(...)` in both no-trivia and trivia-backed modes by using direct source-trivia emission. Render/eval use `evalImmediateSync(...)` for non-async child values and thenable narrowing for async values. Non-scalar render still captures for string/buffer return. |
| Bool | `packages/core/src/tree/bool.ts` | `Node` | scalar render complete | Scalar writer complete; public `toTrimmedString(...)` and render write the known token directly with no writer readback or inherited render-buffer mark window. |
| Call | `packages/core/src/tree/call.ts` | `Node` | partial | Source syntax writer exists, public call source stringification uses child `writeSyntax(...)`, empty string-name calls return their known source/render token without writer readback or buffer mark setup, zero-arg and explicit-empty-arg render/source serialization no longer opens writer mark/trim windows, node-valued names plus evaluated args/content in finalized/plain call syntax write directly instead of public `toTrimmedString(...)`, direct `Rules`/`Collection` callable render/eval paths call `evaluateCallableCollection(...)` without constructing a one-entry `MixinCollection` wrapper, CSS-call arg serialization uses a straight sync loop plus one async continuation instead of per-call nested recursive closure helpers, rendered args no longer return/read back a discarded inner args string, plain/finalized render no longer allocates per-call finish closures, plain/evaluated CSS-call buffer render reuses the buffer writer mark for the whole-call readback instead of nesting a second call-level mark, scalar-contract args skip per-argument trim marks and immediate eval calls when no trivia is active and base `Node.eval` is intact, scalar-contract checks use direct type tags instead of generic `isNode(...)` classification, sync evaluated syntax uses `evalImmediateSync(...)` instead of public `evalSync(...)` materialization, stylesheet `Func` calls pass the source arg list directly to the callable binding evaluator instead of constructing a pre-evaluated replacement `List`, and finalized empty string-name fallback calls write known text directly without a call-level mark/readback. High priority remains for callable output, `evalArgNodes(...)` copy pressure in calc/finalized CSS fallback paths, non-scalar/custom/trivia arg trim marks, async path, helper ladders, and repeated eval. |
| Collection | `packages/core/src/tree/collection.ts` | `Rules` | direct braced writer complete | Live wrapper; `writeSyntax(...)` writes braced rules directly and public `toTrimmedString(...)` is the cold capture boundary. Broader wrapper necessity remains separate. |
| Color | `packages/core/src/tree/color.ts` | `Node` | scalar render complete | Scalar/string-backed color emission uses one serializer for `writeSyntax(...)`, public string output, and render with no writer readback or inherited render-buffer mark window; preserved node-backed color syntax still writes the child directly and falls back for render. Hex serialization uses a straight loop instead of callback-array joining; broader conversion internals remain. |
| Combinator | `packages/core/src/tree/combinator.ts` | `Selector` | scalar render complete | Scalar selector writer avoids selector base punt, and public `toTrimmedString(...)` plus render write the known token directly with no writer readback or inherited render-buffer mark window. |
| Comment | `packages/core/src/tree/comment.ts` | `Node` | scalar wrapper complete | Comment text writes directly in source, public capture, and render paths with no writer readback; line-comment visibility still suppresses render unless `fullRender` is set. |
| ComplexSelector | `packages/core/src/tree/selector-complex.ts` | `Selector` | writeSyntax complete | Selector component emission uses direct `writeSyntax` with the dead non-selector fallback branch removed, cold private source-string wrapper is gone, and component eval/resolve uses `MaybePromise` narrowing; broader valueOf, malformed repair, and metadata audit remains. |
| CompoundSelector | `packages/core/src/tree/selector-compound.ts` | `Selector` | writeSyntax complete | Component emission uses `writeSyntax`, cold private source-string wrapper is gone, and component eval/resolve uses `MaybePromise` narrowing; broader valueOf classification and allocation-array audit remains. |
| Condition | `packages/core/src/tree/condition.ts` | `Node` | direct operand writer complete | Source condition syntax writes directly through operand `writeSyntax(...)`; bool result materialization audit remains. |
| CustomDeclaration | `packages/core/src/tree/declaration-custom.ts` | `Declaration` | inherited staging audited | Inherits `Declaration` writer/render staging and only wraps eval with `context.inCustom`; focused declaration tests cover custom declaration resolve/render output and streaming behavior. |
| Declaration | `packages/core/src/tree/declaration.ts` | `Node` | partial | `writeSyntax(...)` now gives containers a direct declaration syntax boundary, non-custom name/value/important children use direct writers instead of public string transport, custom fallback function assembly uses loops instead of filter/map/join arrays, source-free assignment reuse uses a straight loop, render/resolve/registration/eval branches use thenable narrowing instead of local promise/node casts, multiline formatting avoids regex match arrays, and custom interpolated render replacement evaluation uses an indexed loop instead of `entries()`. High priority remains for custom property raw-source branches, merge state, internal mark/replace, and materialization. |
| DefaultGuard | `packages/core/src/tree/default-guard.ts` | `Node` | scalar wrapper complete | Scalar guard writer complete; public source string writes the known `default` token directly, and render writes the resolved boolean text to the supplied writer or buffer with no `Bool` materialization or writer readback. |
| Dimension | `packages/core/src/tree/dimension.ts` | `Node` | scalar render complete | Number/unit emission uses one scalar serializer for `writeSyntax(...)`, public string output, and render with no writer readback or inherited render-buffer mark window; preserve-mode compound unit serialization uses a straight loop; regex/unit conversion and operation paths remain. |
| Expression | `packages/core/src/tree/expression.ts` | `Node` | direct child writer complete | Wrapper syntax writes directly and now calls child `writeSyntax(...)` instead of public `toString(...)`; eval/resolve rely on thenable narrowing, and scalar render uses `evalImmediateSync(...)` when the child is not may-async. Wrapper necessity remains. |
| Extend | `packages/core/src/tree/extend.ts` | `Node` | writeSyntax/effect boundary complete | Extend syntax and selector/target child syntax write directly with no local public string wrapper; invisible render runs the direct `runEffect(...)` boundary. Selector valueOf and resolved selector state remain. |
| ExtendList | `packages/core/src/tree/extend-list.ts` | `Node` | writeSyntax/effect boundary complete | List wrapper writes through base child writer plus semicolon, and render walks child extend effects directly with a sync-first loop instead of `serialForEach(...)` plus child public render. Public wrapper existence remains. |
| For | `packages/core/src/tree/control.ts` | `Node` | partial | Source syntax writer exists, pattern/iterable children use direct writers, range-bound closure is gone, async-generator entry iteration is replaced by a direct visitor, per-entry tuple arrays are gone, constructor binding adoption is direct, and child-copy list building uses a pre-sized loop instead of `.map(...)`. Loop state/body surface and async branch audit remain. |
| Func | `packages/core/src/tree/function.ts` | `Node` | direct child writer complete | Public function syntax writes directly through name/params and body braced writer; function calls now invoke `evaluateCallableCollection(...)` directly instead of allocating a one-entry `MixinCollection` wrapper. |
| If | `packages/core/src/tree/control.ts` | `Node` | partial | Source syntax writer exists, condition children use direct writers, branch serialization avoids rest-array allocation, selected branch buffer render uses the existing `RenderBuffer` instead of a detached rules string, and public render no longer allocates the control string wrapper callback. Eval/body surface audit remains. |
| Interpolated | `packages/core/src/tree/interpolated.ts` | `Node` | partial | Direct source writer exists, public `replace(...)` uses a plain placeholder loop instead of regex callback scaffolding, live writer replacement emission uses `writeSyntax(...)` instead of public `toTrimmedString(...)` transport, replacement plus selector/generic eval/resolve paths use thenable narrowing instead of local node/promise casts, and whole-selector plus embedded selector interpolation with owned scalar token replacements now builds selector text directly instead of calling public `toTrimmedString(...)`. High-priority non-scalar embedded selector eval, generic materialization, cold replacement capture, and replacement arrays remain. |
| InterpolatedSelector | `packages/core/src/tree/selector-interpolated.ts` | `SimpleSelector` | direct writer/kind check complete | Source syntax writes directly through `Interpolated.writeSyntax(...)`; `isClass`/`isId`/`isTag` use first-character checks instead of regex, and eval/render selector output uses `MaybePromise` narrowing. |
| JsArray | `packages/core/src/tree/js-array.ts` | `Node` | cold host wrapper audited | No Less/SCSS/Jess parser constructs it, `cast([...])` creates `List`, and explicit host/reference tests still use it for direct indexed targets. Keep cold; remove only in a dedicated API-breaking host-wrapper pass. |
| JsExpression | `packages/core/src/tree/js-expr.ts` | `Node` | scalar wrapper complete | Backtick source syntax writes the known scalar token directly with no writer readback; JS eval path remains. Skip deeper polish unless JS eval support is being redesigned. |
| JsFunction | `packages/core/src/tree/js-function.ts` | `Node` | live host wrapper | Function registry/plugins/language service/call/reference paths consume it. Keep cold; no arbitrary source writer. |
| JsImport | `packages/core/src/tree/import-js.ts` | `Node` | live parser node | Jess `@-use/@-from` and SCSS `@use "sass:*"` construct it; import syntax writes directly and path child uses `writeSyntax(...)`. |
| JsObject | `packages/core/src/tree/js-object.ts` | `Node` | live host wrapper | `cast(plainObject)` creates it and indexed references read properties from it. Keep cold; no arbitrary source writer. |
| Keyword | `packages/core/src/tree/any.ts` | `Any` | scalar render complete | Inherits `Any` scalar emission: source, public capture, and render write owned text directly with no inherited render-buffer mark window. |
| List | `packages/core/src/tree/list.ts` | `Node` | render/string boundary complete | Direct item writer exists, empty source/render paths return known empty output without writer readback or buffer mark setup, no-trivia and active-trivia items avoid public `toString(...)`, static flat-buffer render writes syntax directly with one writer mark, dynamic buffer render reuses the direct-render mark instead of nesting an outer buffer mark/readback window, cached `valueOf()` uses a plain loop instead of callback-array joining, render/eval item branches use `MaybePromise` narrowing, async-capable dynamic render no longer allocates local closure/rest scaffolding on the sync path, `[Symbol.iterator]` returns the array iterator directly instead of using a generator wrapper, compare-time `Any` coercion uses the shared compare normalizer plus direct list syntax instead of public list `toString(...)`, and the remaining render string return is the documented public `RenderBufferNode.render(...)` boundary. Addition/copy ownership remains separate. |
| Log | `packages/core/src/tree/log.ts` | `Node` | complete | Empty source writer complete, redundant `toString(...)` override removed, and side-effect eval/render path is direct with `MaybePromise` narrowing. |
| Mixin | `packages/core/src/tree/mixin.ts` | `Node` | partial | Source syntax writer exists and name/params/guard use direct child writers; interpolated-name derivation now builds the owned value object directly instead of allocating conditional spread fragments; high priority remains for guard/default/body copy and callable candidate output. |
| MixinCollection | `packages/core/src/tree/util/callable-collection.ts` | `Node` | cold handoff audited | Live callable-value handoff wrapper; immediate eval-only wrappers in `Call`/`Func` are cut, and focused tests prove the remaining public value surface is the direct callable handoff outside `rules.ts`. No source writer should be invented. |
| Negative | `packages/core/src/tree/negative.ts` | `Node` | partial scalar wrapper complete | Prefix syntax writes directly, simple dimension source/render output writes known scalar text with no writer readback, scalar dimension flat-buffer render skips print-state setup and writes the known text directly, simple `Any` source output writes owned scalar text directly, arbitrary child syntax still calls child `writeSyntax(...)`, and non-async child render/eval uses `evalImmediateSync(...)`. Unit/text classification remains. |
| Nil | `packages/core/src/tree/nil.ts` | `Node` | writeSyntax hook complete | Empty writer complete; singleton/scalar allocation remains. |
| Num | `packages/core/src/tree/number.ts` | `Dimension` | scalar serializer complete | Inherits `Dimension` scalar serialization; operation paths remain. |
| Operation | `packages/core/src/tree/operation.ts` | `Node` | partial | Source operator syntax and operands write directly with no public `toString(...)`; render/eval operand branches use `MaybePromise` narrowing, non-async operands use `evalImmediateSync(...)` instead of public `eval(...)`, per-call local operand/finalizer/render-combine closures are gone, and non-preserve arithmetic no longer pays useless `try/catch { throw error }` wrappers. Arithmetic eval `withOperands(...)` copy pressure and preserve-mode calc fallback ownership remain high priority; deleting `withOperands(...)` source-child copies is blocked until replacement `Operation` materialization can avoid adopting unchanged canonical operands. |
| Paren | `packages/core/src/tree/paren.ts` | `Node` | scalar wrapper partial | Empty/nil and no-trivia `Any` paren source/render paths write known wrapper text without writer readback; wrapper syntax and child source syntax write directly through `writeSyntax(...)`; dynamic wrapped render writes only the final wrapped string to explicit writers/buffers instead of letting child intermediate render text leak into the writer; render wrapper branch uses `MaybePromise` narrowing. Guard/string conversion, escaped semicolon-list normalization, and remaining capture audit remain. |
| PseudoSelector | `packages/core/src/tree/selector-pseudo.ts` | `SimpleSelector` | writeSyntax complete | Direct writer hook and child arg writer exist, generated keyset omission is fixed, cold private source-string wrapper is gone, selector-list args now write inline without capture/replace/restore, and eval arg handling uses thenable narrowing instead of local node/promise casts. Eval arg materialization remains separate. |
| QueryCondition | `packages/core/src/tree/query-condition.ts` | `Sequence` | partial | Source/static child syntax now uses `writeSyntax(...)` instead of public `toString(...)`, static flat-buffer render writes syntax directly with one writer mark, static class-contract child render avoids writer-mark probes in sync and async-capable dynamic render, static child contract checks no longer call `Object.getPrototypeOf(...)` and instead use explicit owned scalar type/prototype contracts, render branches use `MaybePromise` narrowing, and dynamic render no longer allocates local closure/rest scaffolding on the sync path. Per-instance/custom dynamic child render keeps one localized mark fallback because child render may write or return until downstream contracts are direct; a shared dynamic-buffer single-mark cut was rejected because those child probes still own semantic detection. |
| Quoted | `packages/core/src/tree/quoted.ts` | `Node` | partial scalar wrapper complete | Literal non-escaped quoted source/render syntax writes or buffers the known scalar token directly with no writer readback; non-escaped `Any` source/render values write the quote/value/quote pieces directly with no writer readback; escaped literal render writes final raw text to explicit writers and keeps buffer output out of those writers; compare fallback uses `valueOf()` instead of public `toString()` transport; interpolated and non-`Any` node values stay on the existing writer boundary, child node syntax writes directly, and render/eval value branches use `MaybePromise` narrowing. |
| Range | `packages/core/src/tree/range.ts` | `Node` | scalar wrapper complete | Range syntax and bound child syntax write directly with no local public string wrapper; simple `Any`/non-compound `Dimension` bounds render/source string directly without writer mark/readback. Non-scalar or trivia-backed bounds stay on the existing writer fallback. |
| RawRules | `packages/core/src/tree/rules-raw.ts` | `Rules` | direct braced writer complete | Raw body/braced loops use indexed loops, and children call direct `writeSyntax(...)` or source-trivia emission instead of public `toString(...)`. Broader Rules audit remains. |
| Reference | `packages/core/src/tree/reference.ts` | `Node` | in progress | Passes 1-14 deleted alias predicates, result/fallback/materialization wrapper helpers, the useless `evalNode(...)` Promise wrapper, direct render closures, option spread helpers, scope-array walker, runtime-key IIFE, small `findVarDeclarationFast(...)` result/IIFE allocations, duplicate fallback/copy/static-return branches, callable surface rechecks, raw lookup sync-path closure/IIFE setup, main eval lookup closure setup, static declaration public-resolve copy/inherit for non-important/non-merged containers, per-call `findVarDeclarationFast(...)` helper closure allocation for bucket selection/candidate ordering/deferred dynamic-name promotion, reference-value evaluator options-object allocation, the declaration evaluator argument-object wrapper, runtime-binding sync evaluator closure setup, the rules-reference lookup executor closure, render-only dynamic declaration/runtime binding post-eval copy+inherit, the per-call `findVarWithinScopeSurface(...)` recursive helper allocation inside `findVarDeclarationFast(...)`, the per-call `searchChain(...)` closure inside `lookupRuntimeVarBinding(...)`, runtime-binding/declaration reference sync finalizer closures, key-normalization/direct-index raw-target local closures, mixin/ruleset materialization finalizer closure, merged-assign collector closure, and calc slash finalizer closure; heavy lookup helper bodies now live in `packages/core/src/tree/util/reference-lookup.ts` instead of the node file; unresolved reference source serialization now has a direct `writeSyntax(...)` path, and target/key source children no longer route through public `toString(...)`. Remaining: rules-like surfaces, public value materialization, merged assign normalization, and key conversion. |
| Rest | `packages/core/src/tree/rest.ts` | `Node` | scalar wrapper complete | String/empty/`Any` rest syntax writes the known source token directly with no writer readback in public capture and render paths; `Any` names read owned scalar text directly instead of public `toString(...)` or `valueOf()` transport. Arbitrary node-valued rest stays on the existing child writer fallback boundary. Wrapper necessity remains. |
| Rules | `packages/core/src/tree/rules.ts` | `Node` | partial | Direct braced source writer exists, public `toBraced(...)` is cold, and registration/source-order eval async branches use `MaybePromise` narrowing; high priority remains for body eval/render, imports, placement state, merge output, and root serializer capture. |
| Ruleset | `packages/core/src/tree/ruleset.ts` | `Node` | partial | Source-direct eligibility and bare-ampersand selector-list checks use straight loops with short-circuit tests, guard/body eval branches use `MaybePromise` narrowing, sync render no longer allocates local render/eval helper closures, ampersand composition uses loops/pre-sized arrays instead of `slice(...)`, spread merge, and push-spread flattening, header compose ampersand counting no longer allocates a regex match array, serializer flattening/hoisted-frame setup no longer allocates visible-child/filter arrays, spread leaf-frame arrays, filtered at-rule frame arrays, or queue-shift scans, and duplicate declaration handling now pre-renders only repeated properties instead of every declaration in the visible render list. High priority remains for `getHeaderString(...)` capture, same-property duplicate declaration pre-rendering, deeper selector composition, body prep, wrappers, and render branches. |
| Selector | `packages/core/src/tree/selector.ts` | `Node` | writeSyntax complete | Selector-family writer hook exists; broader metadata and keyset invalidation audit remains. |
| SelectorCapture | `packages/core/src/tree/selector-capture.ts` | `Node` | child/buffer staging complete | Capture syntax writes directly through child `writeSyntax(...)`, cold private source-string wrapper is gone, and resolved buffer render delegates to the child buffer renderer instead of rendering to string then writing that string. Audit whether capture node should exist after render rewrite. |
| SelectorList | `packages/core/src/tree/selector-list.ts` | `Selector` | partial writer complete | List item emission uses `writeSyntax`, cold private source-string wrapper is gone, selector eval/resolve uses `MaybePromise` narrowing, and `writeSyntax(...)` emits top-level `:is(...)` selector-list expansions/reference-filtered candidates directly instead of building a temporary flattened selector array. Remaining: valueOf joins, eval/resolve materialization arrays, and flattening outside direct writer paths. |
| Sequence | `packages/core/src/tree/sequence.ts` | `Node` | render/string boundary complete | Direct sequence writer exists; empty source/render paths return known empty output without writer readback or buffer mark setup; no-trivia, active-trivia, and custom-property raw source children use `writeSyntax(...)`; nil children are skipped in the writer so static render no longer materializes a filtered replacement array; static flat-buffer render writes syntax directly with one writer mark; dynamic buffer render reuses the direct-render mark instead of nesting an outer buffer mark/readback window; render/eval branches use `MaybePromise` narrowing; async-capable dynamic render no longer allocates local render-node/rest closures on the sync path; boundary separator checks now use numeric character tests, an indexed trivia scan, and one shared spacer predicate instead of regex/callback probes; compare-time `Any` coercion uses the shared whitespace normalizer plus direct sequence syntax instead of public sequence `toString(...)`, and the remaining render string return is the documented public `RenderBufferNode.render(...)` boundary. Addition/copy ownership remains separate. |
| SimpleSelector | `packages/core/src/tree/selector-simple.ts` | `Selector` | base resolve audit complete | Base class remains: `resolve(context)` intentionally calls `evalNode(context)` directly, while inherited `Node.resolve(...)` would enter the public eval ownership path. No direct writer body needed here; subclasses own syntax. |
| StyleImport | `packages/core/src/tree/import-style.ts` | `Node` | placement audit complete | Sync render no longer allocates a local finalizer closure. First-use placement copies and derived `Rules` surfaces were audited and kept as semantic placement state: focused tests require owned placement children and source-child mapping. Do not remove them as a convenience-copy cut without a replacement placement-state model. |
| Url | `packages/core/src/tree/url.ts` | `Node` | scalar render readback cut | URL wrapper and child syntax write directly in source and context modes; trivia-backed child emission uses direct source-trivia syntax instead of public `toString(...)`; render/eval use `evalImmediateSync(...)` for non-async child values and thenable narrowing for async values. Scalar `Any` render/context normalization now writes or buffers normalized `url(...)` directly after value selection with no prepared writer setup, writer mark/getSince/replace, or writer-to-buffer copy; non-scalar normalization still uses localized fallback readback. |
| VarDeclaration | `packages/core/src/tree/declaration-var.ts` | `Declaration` | scalar wrapper complete | Bare parameter vars with nil defaults write the known `$name` token with no writer readback, and bare parameter name syntax uses owned `Any.value` or child `writeSyntax(...)` instead of public `String(name)` transport. General variable prefix syntax writes directly, but declaration body path remains on `Declaration`. |
| While | `packages/core/src/tree/control.ts` | `Node` | partial | Source syntax writer exists, condition uses direct writer, state-mutation probing uses a straight loop instead of `.some(...)`, and public render no longer allocates the control string wrapper callback. Loop state/body surface and async branch audit remain. |
