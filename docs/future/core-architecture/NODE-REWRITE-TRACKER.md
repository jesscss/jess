# Node Rewrite Tracker

This tracker owns the node-by-node cleanup program. The rule is simple: when
the chat/session chooses the serialization or `writeSyntax` focus and the
user asks to continue or run the full queue, keep working autonomously across
the open rows. Finish a bounded cut, prove output with focused unit tests,
update docs, commit/push, then immediately continue to the next highest-value
open row. Stop only when all rows are complete, a real semantic blocker
appears, the repo becomes unsafe, or the remaining work is explicitly
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

## Focus Contract

This file owns serialization rewrite progress. Do not move this queue into
`HANDOFF.md`, and do not rewrite `HANDOFF.md` merely to switch focus between
serialization and binding branches. `FOCII.md` owns the goal-settable focus
prompt; this file is the serialization source of truth for row status,
contracts, completion gates, and historical partial statuses.

## `writeSyntax` / Render / String Queue

Audit snapshot: 2026-06-08 source scan after selector `writeSyntax` pass.
Only selector-family syntax transport has been cut so far. A checkbox means the
node has been reviewed specifically for this contract, not merely that one
helper changed.

When this focus is selected, finish unfinished node/family serialization
rows across the repo before selecting any other serialization cleanup. A full
autonomous run should close one or more whole rows whenever possible: direct
`writeSyntax(...)`, direct `render(...)` emission after value selection, cold
public string wrappers only, and removal or documented isolation of render-only
`mark/getSince`, writer capture/readback, detached writers, temporary syntax
arrays, and public string transport. Selector/equality cleanup, binding-index
work, lookup redesign, copy/materialization cleanup, benchmark tuning, and
generic smell sweeps are not separate queue candidates inside a selected
serialization pass.

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
  checks use straight loops instead of callback predicates. Direct
  `selector`/`rules`/`guard`/`selectorBeforeExtend` fields and static
  `childKeys` now own runtime reads and semantic mutation points, including
  eval, registration prep, header composition, serialize helpers, and
  extend-root selector replacement. Render sync-path helper closures are lifted
  out of `render(...)`, and ampersand composition uses indexed loops/pre-sized
  arrays instead of `slice(...)`, spread merge, and push-spread flattening.
  Header compose ampersand counting uses a straight character loop instead of
  `valueOf().match(...)` array allocation. Serializer flattening/hoisted-frame
  setup now uses indexed loops and existing frame arrays instead of callback
  scans, visible-child temp arrays, filtered frame arrays, spread frame arrays,
  and `queue.shift()`; transparent visible-child flattening and hoisted
  tree-frame reset now compact/walk existing arrays instead of allocating
  filter results. Hoisted parent header emission writes selector syntax
  directly instead of public selector string transport. Duplicate declaration
  handling now pre-renders only repeated properties instead of every
  declaration in the visible render list.
  `getHeaderString(...)` now writes the concrete selector through direct
  `writeSyntax(...)` without a defensive public `toTrimmedString(...)`
  fallback branch, captures header selector text with a detached writer instead
  of marking/getting/restoring the caller writer, and trims trailing selector
  whitespace through that writer window instead of regex post-processing the
  captured selector text. Generic leaf container serialization now writes
  detached syntax through child `writeSyntax(...)` instead of previewing public
  `toTrimmedString(...)` on the caller writer, and leaf at-rules now ride a
  direct `AtRule.writeSyntax(...)` source path instead of the base
  `writeSyntax(...) -> toTrimmedString(...)` fallback. `Ruleset.writeSyntax(...)`
  now also owns container serialization directly instead of falling through the
  base public wrapper path. No-trivia ruleset frame opens in
  `serializeRulesContainer(...)` now write headers directly through
  `Ruleset.writeHeader(...)` instead of transporting the active render path
  through `getHeaderString(...)`; comparable-header reads and comment/trivia
  normalization paths stay detached.
  Eliminate or isolate `getHeaderString(...)` capture for hot frame
  render/comparison paths.
- [ ] `Declaration`: public syntax boundary exists for callers, non-custom
  declaration children now write through direct syntax hooks, and raw custom
  function assembly uses straight loops. Render assignment and custom
  interpolated replacement eval plus render/resolve/registration branches now
  rely on `MaybePromise` narrowing instead of local promise/node casts, with
  narrowed declaration render-assignment/custom-interpolated thenables calling
  `.then(...)` directly instead of `Promise.resolve(...)` wrappers.
  Multiline value formatting and custom fallback leading whitespace now use
  character scans instead of regex `match(...)` arrays, and custom interpolated
  render replacement evaluation uses an indexed loop instead of
  `replacements.entries()`. `writeSyntax(...)` now uses a declaration-local
  direct writer method, buffer render uses that writer through a detached
  prepared writer instead of the cold `declValueTrimmedString(...)` wrapper,
  scalar custom-property values without terminal newline normalization write
  directly without a value mark/readback window, and merge-adapter render state
  no longer carries the stale `value` field. Source-free assignment input reuse
  now checks child leaf reuse with an indexed loop instead of a callback
  predicate. Plain writer-only `writeSyntax(...)` calls for synthetic scalar
  declaration leaves now emit direct `name` / assign / value / `!important`
  text without the outer declaration mark/readback window, while context-backed
  render/string normalization stays on the existing declaration formatting
  boundary. Exact declaration-reference `!important` transport now carries the
  real source flag leaf through public declaration finalization instead of
  synthesizing a replacement node, and callable-ruleset merged declaration
  coalescing no longer replays already-carried merge history across
  mixin-output `Rules` wrappers.
  Custom-property raw source,
  duplicate-comparison/materialization, and merge-state boundaries remain.
- [x] `Any` / `Keyword` / `Anonymous`: scalar token emission is owned by
  concrete `writeSyntax(...)`; compare-time `Any` coercion uses the shared
  compare normalizer instead of a per-call local closure, and fallback
  comparison reads the owned scalar `Any.value` instead of serializing the left
  token through public `toString(...)`.
- [x] `Dimension` / `Num`: numeric/unit emission uses one scalar serializer
  shared by `writeSyntax(...)` and public string output; audit regex/unit
  formatting and operation paths.
- [x] `Color`: scalar/string-backed color emission uses one serializer for
  `writeSyntax(...)` and public string output; preserved node-backed color
  branch stays explicit.
- [x] `PseudoSelector`: direct writer hook, child writer, and inline selector
  list argument writer exist; direct `name`, `arg`, and generated placement
  fields with static `childKeys` now own runtime reads, generated extend
  placement writes the direct arg field with adoption/cache invalidation, public
  clone uses a concrete constructor, reusable-leaf copies read the direct pseudo
  fields instead of stale constructor payload, generated selector-list
  normalization no longer captures/restores a temporary argument string, and
  evaluated pseudo args use `MaybePromise` narrowing instead of local
  node/promise casts.
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
  probe traffic is cut for scalar children, exact base `Paren` children, and
  exact nested `QueryCondition` children. Exact `Condition` children now use
  the same direct source syntax contract, and exact `Operation` children now
  use their owned `writeSyntax(...)` path instead of the static compatibility
  readback; subclasses/custom condition/operation syntax stay on the
  compatibility readback path. Dynamic render now uses a straight sync loop
  with an async
  rest method only after a thenable is observed. Async-capable dynamic render now keeps
  class-contract static siblings on direct syntax emission even when another
  child is async, and the remaining dynamic compatibility checks
  `hasContentSince(mark)` instead of opening a second `mark()` just to test
  whether the child wrote. Dynamic child render still has a localized
  active-writer recovery path for instance-owned/custom render overrides until
  child render contracts are fully direct; custom `Paren` subclasses stay on
  the static compatibility readback path. Covered built-in dynamic `Operation`,
  `Condition`, base `Paren`, and nested `QueryCondition` children now trust
  their own returned render text instead of paying the localized
  `getSince(...)` recovery path that remains for custom/instance-owned
  writers. The
  dynamic render loop no longer allocates a per-call child-render closure or
  nested async rest function, the dead post-static render branch check is
  gone, covered dynamic query returns now carry local text through the
  sync/async loop instead of returning the whole current writer or shared-
  buffer contents via `toString()`, and static compatibility-lane render now uses a
  query-local mark window instead of returning the whole prepared writer state
  when exact direct text is unavailable.
- [x] `Operation`: direct `writeSyntax(...)` operand/operator writer; source
  and render operands avoid public string transport.
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
  `QueryCondition`, `Mixin`, and `Ampersand`
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
  addition assembly no longer uses derived-container plus result-array
  `push(...)` staging, but copied output ownership remains part of the separate
  addition/copy row in this tracker; do not reopen public render
  string-return compatibility unless the `RenderBufferNode.render(...)` API
  changes.
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
- [x] `AttributeSelector`: direct attribute writer and child writer; direct
  `name`/`op`/`attributeValue`/`mod` fields with static `childKeys` now own
  runtime reads, Less-compat adapter reads, and eval replacement output; avoid
  value/name public-string transport in render, and interpolation/value
  branches use `MaybePromise` narrowing instead of local assertions.
- [ ] `Ampersand`: direct source writer now exists in live code and public
  `toTrimmedString(...)` is a cold wrapper around it; collapse-mode parent
  selector emission now uses direct `writeSyntax(...)` instead of public
  `toString(...)`; append/template placement no longer stores dead selector text
  arrays, no longer splits template strings
  into `templateParts`, no longer uses selector-list iterator/spread
  flattening, no longer copies selector-list parents into temporary replacement
  arrays, no longer does `toTrimmedString().includes(',')` before scanning
  raw scalar comma selectors, and no longer snapshots unused input/result
  selector strings during append placement. Append placement state now carries
  only the facts it reads, BasicSelector append avoids generic
  `Reflect.construct`, and
  non-basic string-valued simple selectors now reject suffix append before
  generic construction. Merge-template ident checks now use direct character
  codes instead of regex, and template replacement uses the existing `&` scan
  instead of `replaceAll(...)`. Exact BasicSelector merge-template replacement
  and raw comma splitting now read the owned scalar value text instead of
  public `toTrimmedString(...)` transport or a writer mark/readback window
  around selector syntax. Non-basic template replacement captures selector text
  through direct `writeSyntax(...)` instead of public `toTrimmedString(...)`.
  Structural selector replacement and broader raw fallback string assembly remain.
- [x] `Interpolated`: direct source writer exists, public `replace(...)` no
  longer uses regex callback scaffolding, and live writer replacement emission
  uses `writeSyntax(...)` plus the existing trim window instead of public
  `toTrimmedString(...)` transport. Whole-selector interpolation and embedded
  selector replacement assembly with owned scalar token replacements
  (`Any`/`Anonymous`/`Keyword`) now build selector text from direct scalar text
  instead of public `toTrimmedString(...)`. Embedded selector-list replacement
  wrapping still uses the generated `PseudoSelector` semantic wrapper, but now
  writes that wrapper through `writeSyntax(...)` instead of public
  `PseudoSelector.toTrimmedString(...)`. Public `replace(...)` now writes
  non-scalar replacements through direct `writeSyntax(...)` on its cold string
  boundary instead of calling public replacement `toTrimmedString(...)`.
  Generic `Any` materialization writes evaluated replacements directly instead
  of calling public `Interpolated.toTrimmedString(...)` on itself, and compound
  selector interpolation scans simple selector tokens directly instead of using
  regex `match(...)` plus a token array. Remaining selector ownership semantics
  are not a public string-transport blocker for this row.
  Whole and embedded non-scalar selector assembly now use the same direct
  replacement writer instead of public replacement `toTrimmedString(...)`.
- [x] `InterpolatedSelector`: direct selector writer, cheap kind checks, and
  `MaybePromise` narrowing in eval/resolve/render branches.
- [x] `Reference`: direct unresolved reference writer; keep eval/render result
  emission out of public string APIs.
- [ ] `Call`: direct source syntax writer exists, empty string-name source calls
  return their known source token without writer readback, explicit empty arg
  lists skip render/source argument mark windows, direct source writing skips
  empty-args trim marks, plain empty string-name render calls write and return
  the known call text without a whole-call mark/readback,
  node-valued call names in
  public source syntax and finalized/plain call syntax, including evaluated
  CSS-call names, write directly instead of using public `toString(...)` /
  `toTrimmedString(...)`, and evaluated call args/content now use
  `writeSyntax(...)` instead of public string transport. Direct
  `Rules`/`Collection` callable render/eval paths now call
  `evaluateCallableCollection(...)` without constructing a one-entry
  `MixinCollection` wrapper. CSS-call arg serialization now uses a straight
  sync loop plus one async continuation instead of per-call nested recursive
  closure helpers, content eval/write shares the same node-local writer
  helper, public source `toTrimmedString(...)` now delegates to
  `writeSyntax(...)` instead of duplicating call source assembly, and
  plain/finalized call rendering no longer allocates per-call finish closures.
  Unknown render-side name/content syntax now uses detached child writers
  instead of caller-writer mark/readback transport, and custom arg fallback
  transport now trims detached child text locally instead of opening
  caller-writer trim/readback windows, so custom fallback names/args/content no
  longer pay whole-call or per-arg slice recovery just to return text.
  Calc render now distinguishes direct/buffer reduction from explicit-writer
  exact syntax: plain and buffer calc render evaluate operation args instead of
  taking the exact-text shortcut, while explicit writer rendering still keeps
  the exact operation syntax path that the call serialization tests cover.
  Dynamic finalized calc names now also establish calc frames before rendering
  args, so one-eval dynamic calc names normalize like direct calc render.
  Plain/evaluated CSS-call buffer render reuses the buffer
  writer mark for the whole-call readback instead of nesting a second
  call-level mark. Scalar-contract args (`Num`, `Dimension`, `Color`, `Bool`,
  `Any`, `Anonymous`, `Keyword`) now skip per-argument trim marks and immediate
  eval calls when no trivia is active and base `Node.eval` is intact.
  Stylesheet `Func` calls now pass source args into the callable binding
  surface directly instead of building a pre-evaluated replacement `List`, and
  both stylesheet `Func` evaluation and detached `Rules`/`Collection` call
  render/eval paths now use `evaluateCallableCollection(...)` directly instead
  of routing through a one-entry `MixinCollection` wrapper/eval surface.
  Exact string-name finalized fallback calls with empty args and no content
  write the known `name()`/important text directly without call-level writer
  mark/readback. Plain and finalized render paths now carry a string-only text
  state for known
  scalar/no-trivia args and content, including async scalar resolutions, so
  covered paths return known text without whole-call writer readback. Non-exact
  custom fallback args/content now also feed that same local return state by
  appending their child-local emitted slice after fallback syntax writes,
  instead of dropping back to whole-call readback; those paths still keep the
  localized child mark/readback needed to recover the trimmed emitted slice.
  `evalArgNodes(...)` now takes a straight sync path for non-async args whose
  base `Node.eval` contract is intact, keeps custom sync eval overrides on
  their existing public-override path, and only switches to an async rest
  continuation after the first thenable appears.
  Repeated callable output value selection now runs through one node-local
  finalization path that owns node-result eval, optional `markImportant`
  application, single-rule `Rules` collapse, and `markCallOutput(...)`
  handoff instead of duplicating that ladder across dynamic JS/callable
  branches.
  Render-only finalized optional-call evaluation now tells `evalArgNodes(...)`
  not to own same-identity arg results, so source-free static arg containers
  are no longer reconstructed just to stringify finalized optional-call syntax;
  when
  every evaluated arg stays identity-equal on that render-only path,
  `evalArgNodes(...)` now reuses the original arg `List` surface instead of
  wrapping the same nodes in a replacement list that would re-parent them.
  Remaining work is split
  `evalArgNodes(...)` copy pressure for calc/finalized CSS-call syntax paths,
  non-scalar/custom/trivia arg trim marks, remaining async/helper stack, and
  repeated eval.
- [x] `Func`: direct function signature/body writer, including name/params, if
  public syntax remains necessary. Stylesheet function calls now invoke
  `evaluateCallableCollection(...)` directly instead of allocating a
  one-entry `MixinCollection` wrapper.
- [ ] `Mixin`: direct source syntax/guard writer exists, public
  `toTrimmedString(...)` is now a cold wrapper around `writeSyntax(...)`,
  source name/params/guard emission no longer routes through public string
  conversion, and interpolated-name derivation no longer allocates conditional
  object-spread fragments or a per-call `withName` closure for optional
  `name`/`params`/`guard`. Mixin body source emission now calls
  `Rules.writeBraced(...)` directly instead of public `Rules.toBraced(...)`.
  Audit guard/default/body copy interactions and callable candidate output.
- [x] `MixinCollection`: live callable-value handoff wrapper. Immediate
  same-turn eval wrappers in `Call`/`Func` are cut, focused tests prove the
  remaining direct callable handoff still exists outside `rules.ts`, and no
  source writer should be invented for this cold wrapper.
- [ ] `Rules`: direct braced source writer exists and public `toBraced(...)`
  is now a cold wrapper; hoisted parent selector headers write selector syntax
  directly instead of calling parent selector public `toString(...)`; root
  charset now writes directly into the active writer, and root comment/import
  hoisting writes detached child syntax directly instead of calling public
  child string wrappers; Mixin, Func, Collection, If, For,
  and While source writers now call the void `writeBraced(...)` path directly
  instead of ignoring public `toBraced(...)` return strings, and static
  child registration prep now calls narrowed thenables directly instead of
  wrapping them with `Promise.resolve(...)`. Detached child `Rules` body
  transport inside container serialization now writes through
  `Rules.writeSyntax(...)` instead of the public `toTrimmedString(...)`
  wrapper, and root render/string plus render-buffer document output now use
  the internal `_toDocumentString(...)` boundary instead of routing
  `@charset` / top-import ordering through public `Rules.toString(...)`;
  isolate
  remaining frame header comparison, imports, and
  duplicate declaration materialization.
- [x] `RawRules`: direct raw body writer.
- [x] `Collection`: live wrapper with direct braced source writer; broader
  wrapper necessity remains out of scope for this source-writer pass.
- [ ] `AtRule`: direct source writer exists, and `getHeaderString(...)` header
  name/prelude capture writes child syntax directly instead of routing through
  public `toString(...)`; header fragment emission no longer allocates local
  helper/callback closures inside `getHeaderString(...)`, and leaf/header
  whitespace checks use direct character scans instead of regex
  trim/replace/probe paths. Header fragments and dynamic leaf render read
  exact `Any`/`Anonymous`/`Keyword` name/prelude text directly when eligible
  instead of opening detached-writer or leaf syntax mark/get/restore windows.
  Source leaf `writeSyntax(...)` now owns leaf header emission directly instead
  of falling through the base `writeSyntax(...) -> toTrimmedString(...)`
  wrapper, so container serialization no longer previews public at-rule string
  output for leaf children. Non-leaf `writeSyntax(...)` now also delegates
  straight to `serializeRulesContainer(...)` instead of routing through public
  `toTrimmedString(...)`. Repeated frame comparison now uses
  `getComparableHeaderString(...)` instead of full
  `getHeaderString(..., true)` output, comment-bearing name-to-prelude
  boundary trivia is emitted explicitly before detached prelude text so
  interstitial comments no longer depend on the prelude serializer to
  rediscover them, and no-trivia frame opens now write directly through
  `AtRule.writeHeader(...)` instead of transporting container header output
  through `getHeaderString(...)`. Nested `@layer` registration now derives
  layer identity and parent-layer matching through owned syntax text instead of
  public `toTrimmedString(...)` / `toString(...)` transport while composing
  `parent.child` names from invocation records.
  Remove remaining custom eval/render branch ladders where state already
  carries kind. Body eval/registration async branches now use `MaybePromise`
  narrowing, body eval entry points no longer wrap direct eval calls or
  async continuations with no-op catch/rethrow scaffolding, narrowed
  at-rule async name/prelude/body continuations no longer wrap already-thenable
  values with `Promise.resolve(...)`, render sync-path helper closures are
  lifted out of `render(...)`, and leaf render no longer allocates a local
  render-node closure.
- [x] `StyleImport`: direct import/render writer and placement state; no
  first-use copied rules surfaces on render-only paths. Placement-state
  bookkeeping no longer stores a redundant top-level `Map`, unused preservation
  flag, or defensive recursive `Set`, but first-use child copies still remain.
- [x] `JsImport`: live parser-owned syntax node for Jess/SCSS JS module
  imports; direct `path`/`imports` fields preserve parser context. Keep direct
  source writer.
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
| Ampersand | `packages/core/src/tree/ampersand.ts` | `SimpleSelector` | partial | Direct source writer exists in live code and public `toTrimmedString(...)` is a cold wrapper around it; leaf `childKeys = null`, parser constructor tree-context preservation, and direct readonly `appendValue` reads are in place; collapse-mode parent selector emission now uses direct `writeSyntax(...)` instead of public `toString(...)`; append/template placement no longer stores dead selector text arrays, no longer snapshots unused input/result selector strings, no longer splits template strings into `templateParts`, selector-list template flattening uses indexed loops instead of iterator/spread, placement state carries only live facts, BasicSelector append avoids generic `Reflect.construct`, non-basic string-valued simple selectors reject suffix append before generic construction, non-BasicSelector template replacement captures selector text through direct `writeSyntax(...)` instead of public `toTrimmedString(...)`, exact BasicSelector template replacement and raw comma splitting read owned scalar text without public `toTrimmedString(...)` or writer mark/readback, single leading suffix templates try structural `appendSelector(...)` before raw replacement text, merge-template ident checks use direct character codes instead of regex, template replacement uses the existing `&` scan instead of `replaceAll(...)`, and append/template selector-list, compound, complex, comma-split raw selector, and replacement assembly now use indexed loops instead of callback `map(...)` staging. Remaining debt is broader raw string assembly and structural selector replacement. |
| Anonymous | `packages/core/src/tree/any.ts` | `Any` | scalar render complete | Inherits `Any` scalar emission: source, public capture, and render write owned text directly with no inherited render-buffer mark window. |
| Any | `packages/core/src/tree/any.ts` | `Node` | scalar render complete | Scalar emission has a concrete direct writer, public capture writes owned text directly, and render writes direct string/buffer output without inherited base mark/readback; compare-time text normalization now shares the internal compare utility; string conversion and numeric regex decisions remain. |
| AtRule | `packages/core/src/tree/at-rule.ts` | `Node` | partial | Direct source writer exists; `getHeaderString(...)` header name/prelude capture writes child syntax directly instead of public `toString(...)`; exact `Any`/`Anonymous`/`Keyword` header fragments read owned scalar text directly instead of allocating a detached writer, while comment-bearing header fragments stay on the detached writer path; dynamic leaf name/prelude capture writes child syntax directly instead of public `toString(...)`; exact `Any`/`Anonymous`/`Keyword` dynamic leaf name/prelude pieces read owned scalar text directly when no trivia is active instead of opening a leaf syntax mark/get/restore window; source leaf `writeSyntax(...)` now owns leaf header emission directly instead of falling through the base `writeSyntax(...) -> toTrimmedString(...)` wrapper, and no-trivia comment-free leaf headers now stay off `getHeaderString(...)` entirely: scalar leaves emit directly through that writer path, while non-scalar no-trivia leaves capture owned child syntax through detached leaf writers instead of localized caller-writer capture or detached header-string transport. Serializer leaf output now also trusts `AtRule.writeSyntax(...)` instead of calling `getHeaderString(...)` itself, so container serialization no longer previews public at-rule string output for leaf children. Non-leaf `writeSyntax(...)` now also delegates straight to `serializeRulesContainer(...)` instead of routing through public `toTrimmedString(...)`; repeated frame comparison now reads `getComparableHeaderString(...)` instead of formatting full comment-free headers through `getHeaderString(..., true)`; no-trivia frame opens now write directly through `AtRule.writeHeader(...)` instead of transporting container header output through `getHeaderString(...)`; comment-bearing header name/prelude, post-prelude comment trivia, and dynamic leaf name/prelude string boundaries use detached writers instead of caller-writer mark/getSince/restore rollback; `getHeaderString(...)` comment-bearing header fragments use detached writers instead of marking/getSince/restoring the caller writer; name-to-prelude boundary trivia is emitted explicitly before detached prelude output so interstitial comments are preserved; nested `@layer` registration now derives layer identity and parent-layer matching through owned syntax text instead of public `toTrimmedString(...)` / `toString(...)` transport while composing `parent.child` names from invocation records; body eval/registration async branches use `MaybePromise` narrowing; render dispatch now routes evaluated at-rules, owned body-state records, and leaf-render records through node-private methods instead of rebuilding local helper closures on each `render(...)` call; scalar no-trivia header name/prelude assembly skips writer readback entirely; no-trivia headers skip the post-prelude writer probe; `valueOf()` reads the name value key instead of public name `toString(...)`, with focused test coverage; nested `@layer` body registration reads at-rule name value identity instead of public name stringification while walking active parent layer records; `evalNode(...)` no longer wraps body eval with no-op catch/rethrow scaffolding; narrowed async name/prelude/body continuations call `.then(...)` directly instead of wrapping already-thenable values with `Promise.resolve(...)`, leaving no `Promise.resolve(...)` calls in `at-rule.ts`; the root-only hoisted-parent frame scan now runs only when root bubbling can observe it and reads hoisted body rules through direct `.rules`; leaf/header whitespace checks use direct character scans instead of regex `trim()`/`replace()` probes; prelude/post spacing no longer concatenates a temporary string only to test trailing whitespace; body eval result finishing is lifted out of per-call nested closure scaffolding; import-queue matching and Less-compat adapters read direct `name`/`prelude`/`rules` fields; and evaluated render-buffer output opens the prepared-writer mark only for shared flat buffers that can consume it, so segmented/non-shared buffer renders skip the dead outer mark. High priority: remaining custom eval/import/render branches and body-state staging. |
| AttributeSelector | `packages/core/src/tree/selector-attr.ts` | `SimpleSelector` | scalar wrapper partial | Attribute parts write directly through child `writeSyntax(...)`; direct `name`/`op`/`attributeValue`/`mod` fields with static `childKeys` own runtime reads, Less-compat adapter reads, and eval replacement output; direct eval returns an owned replacement selector when name/value children change instead of relying on generic base eval to mutate the stale constructor payload; bare string-name attributes and common scalar non-bare forms (`Any` and simple `Quoted` values, including resolved scalar variable values) write/buffer known text without writer readback; raw `@{...}` attribute interpolation uses one direct token parser instead of duplicate regex `match(...)` paths in eval and resolve; `valueOf()` uses node value semantics for node-valued names instead of public `toTrimmedString()` transport; cold private source-string wrapper removed; interpolation eval/render branches use `MaybePromise` narrowing. Non-scalar render capture remains. |
| BasicSelector | `packages/core/src/tree/selector-basic.ts` | `SimpleSelector` | writeSyntax complete | Direct source spelling emits authored `value`; leaf `childKeys = null` and parser constructor tree-context preservation are in place; kind checks use first-character tests, `valueOf()` remains normalized key text, and standalone eval now carries the existing selector-bit library from context. |
| Block | `packages/core/src/tree/block.ts` | `Node` | scalar wrapper partial | Bracket emission writes directly; parser-provided tree context is preserved at construction and carried through owned `withValue(...)` replacements; nil and `Any` block source/render paths write known delimiter/content text without writer readback; scalar `Any` flat-buffer render now skips print-state setup and writes the known wrapper text directly after value selection; child syntax avoids public `toString(...)` in both no-trivia and trivia-backed modes by using direct source-trivia emission; non-scalar buffer render writes syntax directly under the existing outer buffer mark instead of nesting the cold `renderBlockSyntax(...)` helper mark/readback. Render/eval use `evalImmediateSync(...)` for non-async child values and thenable narrowing for async values. Non-scalar public string-return render still captures at the cold helper boundary. |
| Bool | `packages/core/src/tree/bool.ts` | `Node` | scalar render complete | Scalar writer complete; public `toTrimmedString(...)` and render write the known token directly with no writer readback or inherited render-buffer mark window. |
| Call | `packages/core/src/tree/call.ts` | `Node` | partial | Source syntax writer exists, parser-provided tree context is preserved at construction and carried through calc/finalized dynamic output constructors, public call source stringification now delegates to `writeSyntax(...)` and child `writeSyntax(...)`, empty string-name calls return their known source/render token without writer readback or buffer mark setup, zero-arg and explicit-empty-arg render/source serialization no longer opens writer mark/trim windows, exact no-trivia scalar/list/sequence/escaped-paren source calls now also carry known source text directly in `toTrimmedString(...)` instead of routing the covered path through whole-call `writeSyntax(...)` readback, and `writeSyntax(...)` itself now writes covered exact no-trivia names, args, and content directly instead of opening the inner args mark/trim path or routing covered content through generic child writers. No-trivia custom/non-exact source args now also write directly item-by-item through that same arg loop instead of dropping to `args.writeSyntax(...)` plus an inner arg-list mark/trim window, and the trivia-bearing source arg path now also stays item-owned with explicit separator trivia emission instead of routing through `List.writeSyntax(...)` plus a trim boundary. Node-valued names plus evaluated args/content in finalized/plain call syntax write directly instead of public `toTrimmedString(...)`, direct `Rules`/`Collection` callable render/eval paths call `evaluateCallableCollection(...)` without constructing a one-entry `MixinCollection` wrapper or routing through `MixinCollection.prototype.evalCall`, CSS-call arg rendering now uses one writer-owned indexed loop with one async continuation after the first thenable instead of a recursive string-return ladder, rendered args no longer return/read back a discarded inner args string, plain/finalized render now call that void arg writer directly instead of threading the discarded args text through the caller, and custom rendered CSS-call args, names, and content now write through the active caller writer while recovering their local return text from the same emitted chunk range instead of rendering into a detached `OutputWriter` and then copying trimmed text back in. Exact no-trivia rendered scalar args and content (`Any`/`Keyword`/`Anonymous`, `Bool`, `Num`, string-backed `Color`, exact `Dimension`, exact `Quoted`, exact `Operation`, exact `Negative`, and exact `QueryCondition`, including covered async scalar resolutions after eval) now write known text directly and keep covered plain/finalized render returns off the whole-call readback path, exact scalar-descended rendered `List`/`Sequence` args now also carry known text directly so covered normal and escaped call renders stay off both the per-arg trim-mark path and the whole-call readback boundary, and the known source/render text helpers for exact `List`, `Sequence`, and `QueryCondition` children now build that text with straight string assembly instead of temporary `parts` arrays plus `join(...)` staging. Exact rendered `Paren` values now also ride that known-text path so covered non-escaped paren args and content avoid whole-call readback, plain evaluated scalar name nodes now also stay on that known-text path instead of forcing the old `writeSyntax(...)` plus whole-call readback branch, shared flat-buffer call render now reuses the active writer when one already targets the buffer so covered plain and finalized call output streams as `name`, `(`, args, and `)` pieces instead of writing one whole rendered string back into the buffer after the fact, plain/evaluated CSS-call buffer render reuses the buffer writer mark for the whole-call readback instead of nesting a second call-level mark, and plain/finalized call render now keeps a local return string alive even after exact-text coverage falls cold by appending child-local emitted slices instead of returning `w.getSince(mark)` for the whole call. Dynamic target resolution for optional fallback render, optional fallback eval, and dynamic render now lives in one node-private resolver instead of being re-spelled at each branch site, and the string-versus-node dynamic render handoff now flows through one node-private emit helper instead of repeating the same shared-writer ladder at each return. Scalar-contract args skip per-argument trim marks and immediate eval calls when no trivia is active and base `Node.eval` is intact, scalar-contract checks use direct type tags instead of generic `isNode(...)` classification, the known evaluated scalar writer now includes no-trivia `Color` args so color CSS-call args do not drop to the per-arg trim mark/readback path, escaped paren args whose evaluated inner node is an exact `List`/`Sequence` syntax surface now write directly without the old inner trim mark/readback boundary, stylesheet `Func` calls pass the source arg list directly to the callable binding evaluator instead of constructing a pre-evaluated replacement `List`, and stylesheet `Func` body evaluation now also uses `evaluateCallableCollection(...)` directly instead of routing through a one-entry `MixinCollection` wrapper/eval surface. Exact string-name finalized optional-call syntax with empty args and no content writes known text directly without a call-level mark/readback, no-trivia numeric/bool/color/token comma source arg lists write directly without the inner trim mark/readback, exact `QueryCondition` content now also stays on the known source path, and `evalArgNodes(...)` now takes a direct sync `evalNode(...)` path for non-async args when the base `Node.eval` contract is intact, keeps custom sync overrides on their public override path, and only switches to an async continuation after the first thenable while preserving calc-frame cleanup. High priority remains for callable output, remaining `evalArgNodes(...)` copy ownership in calc/finalized optional-call syntax paths, non-scalar/custom/trivia render direct-shape gaps outside the semantic optional-call path, async path outside exact scalar carry, and repeated eval beyond the new shared dynamic helper surfaces. |
| Collection | `packages/core/src/tree/collection.ts` | `Rules` | direct braced writer complete | Live wrapper; `writeSyntax(...)` writes braced rules through `Rules.writeBraced(...)` directly and public `toTrimmedString(...)` is the cold capture boundary. Broader wrapper necessity remains separate. |
| Color | `packages/core/src/tree/color.ts` | `Node` | scalar render complete | Scalar/string-backed color emission uses one serializer for `writeSyntax(...)`, public string output, and render with no writer readback or inherited render-buffer mark window; preserved node-backed color syntax still writes the child directly and falls back for render. Hex serialization uses a straight loop instead of callback-array joining; broader conversion internals remain. |
| Combinator | `packages/core/src/tree/combinator.ts` | `Selector` | scalar render complete | Scalar selector writer avoids selector base punt, leaf `childKeys = null` and parser constructor tree-context preservation are in place, and public `toTrimmedString(...)` plus render write the known token directly with no writer readback or inherited render-buffer mark window. |
| Comment | `packages/core/src/tree/comment.ts` | `Node` | scalar wrapper complete | Comment text writes directly in source, public capture, and render paths with no writer readback; parser-provided tree context is preserved at construction and carried through existing cold placement-copy paths; line-comment visibility still suppresses render unless `fullRender` is set. |
| ComplexSelector | `packages/core/src/tree/selector-complex.ts` | `Selector` | writeSyntax complete | Selector component emission uses direct `writeSyntax` with the dead non-selector fallback branch removed, cold private source-string wrapper is gone, component eval/resolve uses `MaybePromise` narrowing, and changed eval/resolve component surfaces construct `ComplexSelector` directly instead of generic `Reflect.construct(...)`; broader valueOf, malformed repair, and metadata audit remains. |
| CompoundSelector | `packages/core/src/tree/selector-compound.ts` | `Selector` | writeSyntax complete | Component emission uses `writeSyntax`, cold private source-string wrapper is gone, component eval/resolve uses `MaybePromise` narrowing, and changed eval/resolve component surfaces construct `CompoundSelector` directly instead of generic `Reflect.construct(...)`; broader valueOf classification and allocation-array audit remains. |
| Condition | `packages/core/src/tree/condition.ts` | `Node` | direct operand writer complete | Source condition syntax writes directly through operand `writeSyntax(...)`, public `toTrimmedString(...)` now reuses that emitted syntax through active-writer tail capture instead of rebuilding text via child `toTrimmedString()` transport, and parser-provided tree context is preserved at construction; bool result materialization audit remains. |
| CustomDeclaration | `packages/core/src/tree/declaration-custom.ts` | `Declaration` | inherited staging audited | Inherits `Declaration` writer/render staging and only wraps eval with `context.inCustom`; focused declaration tests cover custom declaration resolve/render output, direct buffer syntax, and streaming behavior. |
| Declaration | `packages/core/src/tree/declaration.ts` | `Node` | partial | `writeSyntax(...)` now gives containers a direct declaration syntax boundary through a declaration-local writer method and no longer opens the outer declaration mark/readback that only cold string-return callers need, non-custom name/value/important children use direct writers instead of public string transport, simple no-trivia property names and important flags write known text directly without local trim marks, raw custom-property scalar values without declaration-terminator line breaks write directly without the custom value mark/replace/readback normalization boundary, custom-property terminal newline detection/trimming uses character scans instead of regex match/replace, buffer renders write declaration syntax through a detached prepared writer instead of the cold `declValueTrimmedString(...)` helper, the serialize-helper detached declaration boundary now writes declarations through `writeSyntax(...)` into its own writer instead of previewing or routing through public `toTrimmedString(...)`, duplicate-declaration comparison pre-render now writes repeated declarations through `writeSyntax(...)` into its detached writer instead of routing through public `toTrimmedString(...)`, duplicate-declaration comparison now reuses the shared scratch emitted-trivia helper instead of allocating its own per-declaration trivia set, and duplicate-declaration emission no longer carries prerendered output/trivia maps forward after comparison, so surviving declarations render once on the normal emission path instead of reusing cached detached output, raw custom function assembly uses loops instead of filter/map/join arrays and writes detached custom-call children through `writeSyntax(...)`, merge-list and merge-sequence render spacing now both write directly through the active declaration writer instead of reopening inner value normalization windows, source-free assignment reuse uses a straight loop, render/resolve/registration/eval branches use thenable narrowing instead of local promise/node casts, render-assignment and custom-interpolated replacement chains call `.then(...)` directly after narrowing instead of wrapping already-thenable values with `Promise.resolve(...)`, render-assignment merge adapter state no longer carries the unused stale `value` field, assignment normalization and eval value state now mutate the existing state object directly instead of using local setter closures and shadow state variables, multiline formatting avoids regex match arrays, and custom interpolated render replacement evaluation uses an indexed loop instead of `entries()`. High priority remains for raw-source custom property branches, remaining duplicate-comparison/materialization policy, broader merge output state, the remaining non-custom value normalization boundary outside the covered merge-adapter paths, and public materialization. |
| DefaultGuard | `packages/core/src/tree/default-guard.ts` | `Node` | scalar wrapper complete | Scalar guard writer complete; public source string writes the known `default` token directly, and render writes the resolved boolean text to the supplied writer or buffer with no `Bool` materialization or writer readback. |
| Dimension | `packages/core/src/tree/dimension.ts` | `Node` | scalar render complete | Number/unit emission uses one scalar serializer for `writeSyntax(...)`, public string output, and render with no writer readback or inherited render-buffer mark window; parser-provided tree context is preserved at construction; preserve-mode compound unit serialization uses a straight loop; regex/unit conversion and operation paths remain. |
| Expression | `packages/core/src/tree/expression.ts` | `Node` | direct child writer complete | Parser-provided tree context is preserved at construction; wrapper syntax writes directly and now calls child `writeSyntax(...)` instead of public `toString(...)`; eval/resolve rely on thenable narrowing, and scalar render uses `evalImmediateSync(...)` when the child is not may-async. Wrapper necessity remains. |
| Extend | `packages/core/src/tree/extend.ts` | `Node` | writeSyntax/effect boundary complete | Parser-provided tree context is preserved at construction; Extend syntax and selector/target child syntax write directly with no local public string wrapper; invisible render runs the direct `runEffect(...)` boundary. Selector valueOf and resolved selector state remain. |
| ExtendList | `packages/core/src/tree/extend-list.ts` | `Node` | writeSyntax/effect boundary complete | List wrapper writes through base child writer plus semicolon, parser-provided tree context is preserved at construction, and render walks child extend effects directly with a sync-first loop instead of `serialForEach(...)` plus child public render. Public wrapper existence remains. |
| For | `packages/core/src/tree/control.ts` | `Node` | partial | Source syntax writer exists as `writeSyntax(...)`; public `toTrimmedString(...)` delegates to that writer, pattern/iterable/range-bound children use direct writers instead of public `toString(...)` transport, range-bound per-call closure setup is gone, parser-provided tree context is preserved at construction, async-generator entry iteration is replaced by a direct visitor, per-entry tuple arrays are gone, constructor binding adoption is direct, child-copy list building uses a pre-sized loop instead of `.map(...)`, shared control body render awaits the native `Rules.render(...)` result directly instead of wrapping it in `Promise.resolve(...)`, and shared callable-entry resolution reads `Mixin.rules`/`Ruleset.rules` directly after concrete narrowing. Loop state/body surface and async branch audit remain. |
| Func | `packages/core/src/tree/function.ts` | `Node` | direct child writer complete | Public function syntax writes directly through name/params and `Rules.writeBraced(...)`, parser-provided tree context is preserved at construction, and function calls now invoke `evaluateCallableCollection(...)` directly instead of allocating a one-entry `MixinCollection` wrapper. |
| If | `packages/core/src/tree/control.ts` | `Node` | partial | Source syntax writer exists as `writeSyntax(...)`; public `toTrimmedString(...)` delegates to that writer, condition children use direct writers instead of public `toString(...)` transport, parser-provided tree context is preserved at construction, branch serialization avoids rest-array allocation, selected branch buffer render uses the existing `RenderBuffer` instead of a detached rules string, public render no longer allocates the control string wrapper callback, shared control body render awaits the native `Rules.render(...)` result directly instead of wrapping it in `Promise.resolve(...)`, and shared callable-entry resolution reads `Mixin.rules`/`Ruleset.rules` directly after concrete narrowing. Eval/body surface audit remains. |
| Interpolated | `packages/core/src/tree/interpolated.ts` | `Node` | string transport complete | Parser-provided tree context is preserved at construction and carried through evaluated replacement surfaces; runtime paths read direct `source`/`replacements` fields instead of reopening the constructor payload; direct source writer exists; public `replace(...)` uses a plain placeholder loop instead of regex callback scaffolding; live writer replacement emission uses `writeSyntax(...)` instead of public `toTrimmedString(...)` transport; rendered scalar replacements write owned token text directly without a local trim mark; render buffer output reuses the outer render mark instead of taking an inner mark/readback just to return emitted text; replacement plus selector/generic eval/resolve paths use thenable narrowing instead of local node/promise casts; eval/resolve replacement arrays are allocated lazily only after a replacement changes; whole-selector plus embedded selector interpolation with owned scalar token replacements now builds selector text directly instead of calling public `toTrimmedString(...)`; public `replace(...)` also reads owned scalar token text directly for those replacements; generic `Any` materialization writes evaluated replacements directly instead of calling public `Interpolated.toTrimmedString(...)` on itself and now builds generic text without routing through `writeWithReplacements(...)` mark/readback capture; embedded selector-list wrappers now write generated `:is(...)` text directly instead of materializing a generated `PseudoSelector` only to serialize it; public `replace(...)` writes non-scalar replacements through direct `writeSyntax(...)` instead of public replacement `toTrimmedString(...)`; whole/embedded non-scalar selector assembly also uses that direct replacement writer; and compound selector interpolation scans simple selector tokens directly instead of using regex `match(...)`, a token array, and a pre-sized selector array. Remaining selector ownership semantics are outside this string-transport row. |
| InterpolatedSelector | `packages/core/src/tree/selector-interpolated.ts` | `SimpleSelector` | direct writer/kind check complete | Source syntax writes directly through `Interpolated.writeSyntax(...)`; `isClass`/`isId`/`isTag` use first-character checks instead of regex, and eval/render selector output uses `MaybePromise` narrowing. |
| JsArray | `packages/core/src/tree/js-array.ts` | `Node` | cold host wrapper audited | No Less/SCSS/Jess parser constructs it, `cast([...])` creates `List`, and explicit host/reference tests still use it for direct indexed targets. Keep cold; remove only in a dedicated API-breaking host-wrapper pass. |
| JsExpression | `packages/core/src/tree/js-expr.ts` | `Node` | scalar wrapper complete | Backtick source syntax writes the known scalar token directly with no writer readback; JS eval path remains. Skip deeper polish unless JS eval support is being redesigned. |
| JsFunction | `packages/core/src/tree/js-function.ts` | `Node` | live host wrapper | Function registry/plugins/language service/call/reference paths consume it. Keep cold; no arbitrary source writer. |
| JsImport | `packages/core/src/tree/import-js.ts` | `Node` | live parser node | Jess `@-use/@-from` and SCSS `@use "sass:*"` construct it; import syntax writes directly, the path child uses `writeSyntax(...)`, parser context is preserved at construction, and scalar import specifier metadata stays out of `childKeys`. |
| JsObject | `packages/core/src/tree/js-object.ts` | `Node` | live host wrapper | `cast(plainObject)` creates it and indexed references read properties from it. Keep cold; no arbitrary source writer. |
| Keyword | `packages/core/src/tree/any.ts` | `Any` | scalar render complete | Inherits `Any` scalar emission: source, public capture, and render write owned text directly with no inherited render-buffer mark window. |
| List | `packages/core/src/tree/list.ts` | `Node` | render/string boundary complete | Direct item writer exists, empty source/render paths return known empty output without writer readback or buffer mark setup, no-trivia and active-trivia items avoid public `toString(...)`, static flat-buffer render writes syntax directly with one writer mark, dynamic buffer render reuses the direct-render mark instead of nesting an outer buffer mark/readback window, cached `valueOf()` uses a plain loop instead of callback-array joining, render/eval item branches use `MaybePromise` narrowing, async-capable dynamic render no longer allocates local closure/rest scaffolding on the sync path, `[Symbol.iterator]` returns the array iterator directly instead of using a generator wrapper, compare-time `Any` coercion uses the shared compare normalizer plus direct list syntax instead of public list `toString(...)`, addition output arrays are final-sized instead of derived and then pushed into, and the remaining render string return is the documented public `RenderBufferNode.render(...)` boundary. Remaining addition/copy ownership is the copied output boundary, not helper/mutation staging. |
| Log | `packages/core/src/tree/log.ts` | `Node` | complete | Empty source writer complete, direct `level`/`message` fields with static `childKeys` own runtime reads, parser constructor tree-context preservation is in place, redundant `toString(...)` override removed, and side-effect eval/render path is direct with `MaybePromise` narrowing. |
| Mixin | `packages/core/src/tree/mixin.ts` | `Node` | partial | Parser-provided tree context is preserved at construction and carried through interpolated-name registration wrappers and callable output copies; source syntax writer exists, public `toTrimmedString(...)` is now a cold wrapper around `writeSyntax(...)`, and name/params/guard use direct child writers instead of public string conversion; mixin body source syntax calls `Rules.writeBraced(...)` directly instead of public `Rules.toBraced(...)`; interpolated-name derivation now builds the owned value object directly instead of allocating conditional spread fragments and uses a method boundary instead of a per-call `withName` closure; callable helper reads use direct `name`/`params`/`rules`/`guard` fields for real Mixin nodes with explicit concrete union narrowing while preserving synthetic callable-record payloads, and focused callable/fns tests now use that accessor/direct-field surface instead of restating `value.*` reads; callable output copying constructs Mixin output surfaces from direct fields instead of stale constructor payload; callable default signatures are typed as the actual call signature rather than only `List`; callable finalization reuses an already-attached single-output mixin slot when source rules, output rules, and ambient lookup policy match instead of rebuilding child segments/maps/placement arrays; interpolated mixin registration now evaluates the dynamic name before deriving the replacement wrapper so the wrapper owns the final `Any` name directly instead of copying and replacing the interpolated name subtree; and callable candidate state no longer performs a redundant Mixin-only parent assignment on the owned output rules immediately before candidate-parent adoption. High priority remains for guard/default/body copy and broader callable candidate output. |
| MixinCollection | `packages/core/src/tree/util/callable-collection.ts` | `Node` | cold handoff audited | Live callable-value handoff wrapper; immediate eval-only wrappers in `Call`/`Func` are cut, and focused tests prove the remaining public value surface is the direct callable handoff outside `rules.ts`. No source writer should be invented. |
| Negative | `packages/core/src/tree/negative.ts` | `Node` | partial scalar wrapper complete | Prefix syntax writes directly, parser-provided tree context is preserved at construction, simple dimension source/render output writes known scalar text with no writer readback, scalar dimension flat-buffer render skips print-state setup and writes the known text directly, simple source-owned and resolved `Any` output writes `-value` directly without child render or operation transport, arbitrary child syntax still calls child `writeSyntax(...)`, and non-async child render/eval uses `evalImmediateSync(...)`. Public resolve of resolved `Any` materializes one scalar `Any('-value')` node. Unit/text classification remains. |
| Nil | `packages/core/src/tree/nil.ts` | `Node` | writeSyntax hook complete | Empty writer complete; singleton/scalar allocation remains. |
| Node | `packages/core/src/tree/node-base.ts` | `Node` | base source render complete | Base `writeSyntax(...)` and `toTrimmedString(...)` write child syntax directly; inherited no-trivia `renderSource(...)` now writes through `writeSyntax(...)` directly instead of routing through public `toTrimmedString(...)`. Custom `toTrimmedString(...)` overrides and active source-trivia rendering remain compatibility/source-preservation boundaries. |
| Num | `packages/core/src/tree/number.ts` | `Dimension` | scalar serializer complete | Inherits `Dimension` scalar serialization and parser-provided tree-context preservation; operation paths remain. |
| Operation | `packages/core/src/tree/operation.ts` | `Node` | partial | Source operator syntax and operands write directly through an owned `writeSyntax(...)` with no public `toString(...)` or public string readback bridge; parser-provided tree context is preserved at construction and carried through owned `withOperands(...)` materialization; render/eval operand branches use `MaybePromise` narrowing, non-async operands use `evalImmediateSync(...)` instead of public `eval(...)`, per-call local operand/finalizer/render-combine closures are gone, non-preserve arithmetic no longer pays useless `try/catch { throw error }` wrappers, preserved-operation flat-buffer render no longer leaks intermediate operand text into caller-supplied explicit writers, preserved-operation direct render with an explicit writer now strips that writer before child renders and writes the final combined operation text once instead of letting child output leak without the operator boundary, public `withOperands(...)` materialization owns unchanged source operands instead of reusing source-free scalar leaves as output operands, and preserve-mode calc fallback always uses that owned operation boundary before marking fallback operands evaluated. Broader arithmetic/list materialization remains high priority. |
| Paren | `packages/core/src/tree/paren.ts` | `Node` | scalar wrapper partial | Parser-provided tree context is preserved at construction and carried through owned `withValue(...)` replacements; empty/nil and no-trivia source-owned or resolved `Any` paren source/render paths write known wrapper text without child render transport or writer readback; wrapper syntax and child source syntax write directly through `writeSyntax(...)`, and the dead pre-writer child `toString(...)` helper plus dead non-`Node` string-coercion branches are gone; dynamic wrapped render writes only the final wrapped string to explicit writers/buffers instead of letting child intermediate render text leak into the writer; resolved synchronous non-scalar child render now streams flat-buffer output as open delimiter, child output, and close delimiter instead of writing a wrapped child string back to the buffer; render wrapper branch uses `MaybePromise` narrowing; and escaped semicolon-list public eval/resolve normalization now returns direct comma text as `Any` instead of materializing a replacement `List` surface with inherited source state. The remaining mark/readback is the shared `renderListValueSyntax(...)` string boundary and should move only with shared List string-return contracts. Segmented/async non-scalar child render and remaining capture audit remain. |
| PseudoSelector | `packages/core/src/tree/selector-pseudo.ts` | `SimpleSelector` | writeSyntax complete | Direct writer hook and child arg writer exist, direct `name`/`arg`/generated placement fields with static `childKeys` own runtime reads and generated extend placement mutation, generated keyset omission is fixed, cold private source-string wrapper is gone, selector-list args now write inline without capture/replace/restore through an explicit selector-node guard, public clone uses a concrete constructor, reusable-leaf copies read direct pseudo fields instead of stale constructor payload, and eval arg handling uses thenable narrowing instead of local node/promise casts. Eval arg materialization remains separate. |
| QueryCondition | `packages/core/src/tree/query-condition.ts` | `Sequence` | partial | Source/static child syntax now uses `writeSyntax(...)` instead of public `toString(...)`, exact no-trivia scalar, `Condition`, `Operation`, base `Paren`, and nested `QueryCondition` source children now also carry direct source text through `toTrimmedString(...)` instead of always paying the outer query-condition `mark()/getSince()` wrapper, and covered static no-trivia query renders now also return that exact text directly instead of reading whole writer/buffer state through `toString()` on the static path, while shared flat buffers still stream segmented child output, direct static flat-buffer render avoids top-level mark/readback for direct scalar children, and static custom/subclass compatibility-lane queries now recover local output from the active writer tail instead of opening a whole-query `mark()/getSince()` boundary after writing the full condition. Static class-contract child render avoids writer-mark probes in sync and async-capable dynamic render, static custom/subclass compatibility-lane children now snapshot plain writer position instead of opening an inner child mark/readback just to detect whether `writeSyntax(...)` emitted anything, and dynamic child probes now also snapshot plain writer positions instead of opening real `mark()` boundaries when they only need local emitted-text semantics. Static child contract checks no longer call `Object.getPrototypeOf(...)` and instead use explicit owned scalar type/prototype contracts, exact base `Paren`, nested `QueryCondition`, exact `Condition`, exact `Operation`, and exact dynamic scalar children (`Any`/`Anonymous`/`Keyword`, `Dimension`/`Num`, `Bool`, and string-backed `Color`) now use the same direct source/static-or-trusted-render contract while subclasses/custom syntax stay on the localized compatibility lane, render branches use `MaybePromise` narrowing, dynamic render carries returned text locally instead of reading back the whole query, per-call dynamic child/rest closures have been lifted into node-private methods, the dead post-static render branch check is gone, and child boundary spacing writes the literal boundary directly instead of calling a one-line helper. Per-instance/custom dynamic child render and static async custom child render now both keep localized active-writer recovery paths instead of reopening `getSince(...)` readback, because focused tests prove child render may return-only text or write different text than it returns; a shared dynamic-buffer single-mark cut was rejected because those child probes still own semantic detection. |
| Quoted | `packages/core/src/tree/quoted.ts` | `Node` | partial scalar wrapper complete | Parser-provided tree context is preserved at construction and carried through owned `withValue(...)` replacements; literal non-escaped quoted source/render syntax writes or buffers the known scalar token directly with no writer readback; non-escaped `Any` source/render values write the quote/value/quote pieces directly with no writer readback; escaped literal render writes final raw text to explicit writers and keeps buffer output out of those writers; compare fallback uses `valueOf()` instead of public `toString()` transport; interpolated and non-`Any` node values stay on the existing cold `renderQuotedSyntax(...)` string boundary, child node syntax writes directly, and render/eval value branches use `MaybePromise` narrowing. |
| Range | `packages/core/src/tree/range.ts` | `Node` | scalar wrapper complete | Range syntax and bound child syntax write directly with no local public string wrapper; simple `Any`/non-compound `Dimension` bounds render/source string directly without writer mark/readback. Non-scalar or trivia-backed bounds stay on the existing writer fallback. |
| RawRules | `packages/core/src/tree/rules-raw.ts` | `Rules` | direct braced writer complete | Raw body/braced loops use indexed loops, and children call direct `writeSyntax(...)` or source-trivia emission instead of public `toString(...)`. Broader Rules audit remains. |
| Reference | `packages/core/src/tree/reference.ts` | `Node` | in progress | Passes 1-15 deleted alias predicates, result/fallback/materialization wrapper helpers, the useless `evalNode(...)` Promise wrapper, direct render closures, option spread helpers, scope-array walker, runtime-key IIFE, small `findVarDeclarationFast(...)` result/IIFE allocations, duplicate fallback/copy/static-return branches, callable surface rechecks, raw lookup sync-path closure/IIFE setup, main eval lookup closure setup, static declaration public-resolve copy/inherit for non-important/non-merged containers, per-call `findVarDeclarationFast(...)` helper closure allocation for bucket selection/candidate ordering/deferred dynamic-name promotion, reference-value evaluator options-object allocation, the declaration evaluator argument-object wrapper, runtime-binding sync evaluator closure setup, the rules-reference lookup executor closure, render-only dynamic declaration/runtime binding post-eval copy+inherit, the per-call `findVarWithinScopeSurface(...)` recursive helper allocation inside `findVarDeclarationFast(...)`, the per-call `searchChain(...)` closure inside `lookupRuntimeVarBinding(...)`, runtime-binding/declaration reference sync finalizer closures, key-normalization/direct-index raw-target local closures, mixin/ruleset materialization finalizer closure, merged-assign collector closure, and calc slash finalizer closure; heavy lookup helper bodies now live in `packages/core/src/tree/util/reference-lookup.ts` instead of the node file; unresolved reference source serialization now has a direct `writeSyntax(...)` path; public source `toTrimmedString(...)` now reuses `writeSyntax(...)` directly and the private string-preview wrapper is gone; target/key source children no longer route through public `toString(...)`; array-valued syntax keys write each owned key segment directly instead of concatenating a temporary string; exact `Any`/`Quoted`/numeric/color key normalization now reads owned scalar fields before falling back to generic node stringification, so exact key nodes no longer pay public `valueOf()` transport just to choose a lookup lane; already-normalized static merged declaration values now reuse the evaluated merged container directly during public resolve instead of forcing an extra merged-reference normalization/materialization pass, while nested-list/placeholder merge cleanup stays on the existing normalization path; already-final dynamic merged declaration values now also reuse the evaluated merged container directly after eval instead of forcing a final normalize-plus-inherit public wrapper when the merged output is already in final shape; preserved rules-like public surfaces now materialize as descriptor-cloned shallow shells instead of rerunning node constructors against canonical child payloads, so preserving `Rules`/`Collection`/`Mixin`/`Ruleset` values no longer re-adopts canonical children just to carry public lookup/source metadata; mixin/ruleset public materialization splits the concrete branches and reads direct `.rules` fields instead of a stale shared payload shape; buffer render strips explicit writers before resolved child renders so child intermediate text does not leak into caller writers; and parser/derived constructor paths now carry tree context while focused interpolation tests read direct `key` fields. Remaining: broader public value materialization and deeper merged assign normalization beyond the already-final merged list/placeholder cutoff. |
| Rest | `packages/core/src/tree/rest.ts` | `Node` | scalar wrapper complete | Parser-provided tree context is preserved at construction; string/empty/`Any` rest syntax writes the known source token directly with no writer readback in public capture, non-buffer render, and render-buffer paths; scalar buffer render writes the known token straight to the requested buffer without prepared-writer mark/readback setup. `Any` names read owned scalar text directly instead of public `toString(...)` or `valueOf()` transport. Arbitrary node-valued rest stays on the existing child writer fallback boundary. Wrapper necessity remains. |
| Rules | `packages/core/src/tree/rules.ts` | `Node` | partial | Direct braced source writer exists as `writeBraced(...)`, public `toBraced(...)` is cold, and source writers for Mixin, Func, Collection, If, For, and While now call the void braced writer instead of ignoring public `toBraced(...)` return strings; registration/source-order eval async branches use `MaybePromise` narrowing, public source `toTrimmedString(...)` now reuses `writeSyntax(...)` directly instead of duplicating the visible/full-render guard and source-body emitter call, root-owned `@charset` output writes the context-owned scalar charset syntax directly into the active writer instead of public `toTrimmedString(...)` transport or a detached-writer shuttle, root imports and leading comments before root imports now write direct syntax in detached-writer branches instead of public `toString(...)`/`toTrimmedString(...)` transport, top-import detection and prelude evaluation read/write direct `AtRule.name`/`AtRule.prelude` fields with adoption at the direct mutation point, the leading-comment suppression list is allocated only when comments are actually suppressed, source-mode non-container leaf rules now call `writeSyntax(...)` directly instead of public `toTrimmedString(...)` transport, source-mode child `Rules` wrappers emit `_emitSourceRulesBody(...)` directly instead of public `toTrimmedString(...)` preview transport, child `Rules` wrapper emission detection now uses a plain writer-position snapshot instead of a wrapper-local `mark()` plus `hasContentSince(...)` / `restore(...)` probe, child `Ruleset`/`AtRule` container emission detection now also uses a plain writer-position snapshot instead of a container-local `mark()` plus `hasContentSince(...)` probe, detached child `Rules` container serialization now writes through `Rules.writeSyntax(...)` instead of the public `toTrimmedString(...)` wrapper, and nested child `Rules` serialization inside `serializeRulesContainer(...)` now also writes straight through the active writer instead of previewing a detached child body string first. Render-mode child `Rules` wrappers emit `_emitRenderRulesBody(...)` directly instead of `writer.preview(...)` around public `render(...)` transport, root render/string and render-buffer document output now use the internal `_toDocumentString(...)` boundary instead of routing `@charset` / top-import ordering through public `Rules.toString(...)`, static declaration registration prep calls `.then(...)` directly after narrowing instead of wrapping already-thenable prepared nodes with `Promise.resolve(...)`, callable namespace lookup reads direct `Mixin`/`Ruleset` child fields for real node entries, direct declaration/callable invalidation uses concrete `Declaration`/`VarDeclaration`/`Mixin`/`Ruleset`/`Rules`/`StyleImport` guards instead of combined bitmask reads where direct fields are needed, hoisted parent selector headers write selector syntax directly instead of calling parent selector public `toString(...)` into the detached header writer, call-produced declaration-only rule ordering mutates the already-owned array contents instead of reassigning the readonly `value` field, and `Rules.render(..., buffer)` now reuses the requested flat buffer writer with prepared writeback so shared-writer buffer renders avoid appending a second whole rules body while preserving any returned-text suffix. High priority remains for broader body render, container indentation capture, placement state, merge output, duplicate declaration materialization, and remaining root serializer capture. |
| Ruleset | `packages/core/src/tree/ruleset.ts` | `Node` | partial | Source-direct eligibility and bare-ampersand selector-list checks use straight loops with short-circuit tests, direct `selector`/`rules`/`guard`/`selectorBeforeExtend` fields with static `childKeys` now own runtime reads and semantic mutation points, guard/static-child branches use concrete node guards where node-specific fields are read, guard/body eval branches use `MaybePromise` narrowing, sync render no longer allocates local render/eval helper closures, public source `toTrimmedString(...)` now reuses `writeSyntax(...)` directly instead of duplicating the hoist/reference-mode guard and container serializer call, ampersand composition uses loops/pre-sized arrays instead of `slice(...)`, spread merge, and push-spread flattening, header compose ampersand counting no longer allocates a regex match array, `getHeaderString(...)` no longer writes selector syntax into the caller writer and rolls it back with mark/getSince/restore, its concrete selector syntax path no longer has a defensive public `toTrimmedString(...)` fallback branch, header selector trimming now stays on the detached writer but snapshots plain writer position instead of opening a real mark/readback probe just to trim trailing whitespace and test whether anything wrote, header rollback for empty selectors now also snapshots plain writer position instead of spending a real `mark()` before indentation and `writeHeaderSelector(...)`, serializer frame-header comparison now uses a commentless comparable selector key plus a direct hoisted-parent comparable header helper instead of routing the hot compare path through full `getHeaderString(..., true)` formatting, generic container leaf serialization now writes detached child syntax through `writeSyntax(...)` instead of previewing public `toTrimmedString(...)` on the caller writer, leaf `Rules` wrappers inside `serializeRulesContainer(...)` now stay on that same active-writer path instead of previewing a detached child body string first, and `writeSyntax(...)` now owns ruleset container serialization directly instead of falling through the base public wrapper path; serializer flattening/hoisted-frame setup no longer allocates visible-child/filter arrays, spread leaf-frame arrays, filtered at-rule frame arrays, or queue-shift scans, duplicate declaration handling now pre-renders only repeated properties instead of every declaration in the visible render list, duplicate declaration caches/reverse pre-render scans are skipped entirely when no property repeats, registration calls `selector.eval(context)` directly instead of through a private selector identity helper, and evaluated render-buffer output opens the prepared-writer mark only for shared flat buffers that can consume it, so segmented/non-shared buffer renders skip the dead outer mark. High priority remains for deeper selector composition, body prep, direct container writer splitting, wrappers, and render branches. |
| Selector | `packages/core/src/tree/selector.ts` | `Node` | writeSyntax complete | Selector-family writer hook exists; broader metadata and keyset invalidation audit remains. |
| SelectorCapture | `packages/core/src/tree/selector-capture.ts` | `Node` | child/buffer staging complete | Capture syntax writes directly through child `writeSyntax(...)`, parser-provided tree context is preserved at construction, cold private source-string wrapper is gone, and resolved buffer render delegates to the child buffer renderer instead of rendering to string then writing that string. Audit whether capture node should exist after render rewrite. |
| SelectorList | `packages/core/src/tree/selector-list.ts` | `Selector` | partial writer complete | List item emission uses `writeSyntax`, cold private source-string wrapper is gone, public `toTrimmedString(...)` now reuses `writeSyntax(...)` directly instead of a separate string-preview helper, selector eval/resolve uses `MaybePromise` narrowing, `writeSyntax(...)` emits top-level `:is(...)` selector-list expansions/reference-filtered candidates directly instead of building a temporary flattened selector array, changed eval/resolve selector-list surfaces construct `SelectorList` directly instead of using generic `Reflect.construct(...)`, and unchanged multi-selector eval/resolve now returns the source list without allocating an evaluated selector array unless single-item collapse, flattening, or a changed selector requires finalization. Remaining: valueOf joins and flattening outside direct writer paths. |
| Sequence | `packages/core/src/tree/sequence.ts` | `Node` | render/string boundary complete | Direct sequence writer exists; empty source/render paths return known empty output without writer readback or buffer mark setup; no-trivia, active-trivia, and custom-property raw source children use `writeSyntax(...)`; nil children are skipped in the writer so static render no longer materializes a filtered replacement array; static flat-buffer render writes syntax directly with one writer mark; dynamic buffer render reuses the direct-render mark instead of nesting an outer buffer mark/readback window; render/eval branches use `MaybePromise` narrowing; async-capable dynamic render no longer allocates local render-node/rest closures on the sync path; boundary separator checks now use numeric character tests, an indexed trivia scan, and one shared spacer predicate instead of regex/callback probes; compare-time `Any` coercion uses the shared whitespace normalizer plus direct sequence syntax instead of public sequence `toString(...)`, addition output arrays are final-sized instead of derived and then pushed into, and the remaining render string return is the documented public `RenderBufferNode.render(...)` boundary. Remaining addition/copy ownership is the copied output boundary, not helper/mutation staging. |
| SimpleSelector | `packages/core/src/tree/selector-simple.ts` | `Selector` | base resolve audit complete | Base class remains: `resolve(context)` intentionally calls `evalNode(context)` directly, while inherited `Node.resolve(...)` would enter the public eval ownership path. No direct writer body needed here; subclasses own syntax. |
| StyleImport | `packages/core/src/tree/import-style.ts` | `Node` | placement audit complete | Parser-provided tree context is preserved at construction, sync render no longer allocates a local finalizer closure, and invalidation paths read direct import fields after concrete narrowing. First-use placement copies and derived `Rules` surfaces were audited and kept as semantic placement state: focused tests require owned placement children and source-child mapping. Do not remove them as a convenience-copy cut without a replacement placement-state model. |
| Url | `packages/core/src/tree/url.ts` | `Node` | scalar render readback cut | URL wrapper and child syntax write directly in source and context modes; trivia-backed child emission uses direct source-trivia syntax instead of public `toString(...)`; render/eval use `evalImmediateSync(...)` for non-async child values and thenable narrowing for async values. Scalar `Any` render/context normalization now writes or buffers normalized `url(...)` directly after value selection with no prepared writer setup, writer mark/getSince/replace, or writer-to-buffer copy; simple non-escaped quoted URL values use the same direct flat-buffer text path; non-scalar buffer render writes syntax directly under the existing outer buffer mark instead of nesting the cold `renderUrlSyntax(...)` helper mark/readback; non-scalar normalization still uses a localized replacement boundary. |
| VarDeclaration | `packages/core/src/tree/declaration-var.ts` | `Declaration` | scalar wrapper complete | `writeSyntax(...)` now owns the variable `$` prefix and bare-parameter syntax; bare parameter vars with nil defaults write the known `$name` token with no writer readback, and bare parameter name syntax uses owned `Any.value` or child `writeSyntax(...)` instead of public `String(name)` transport. General declaration body syntax still delegates to the shared `Declaration` body writer after the variable prefix. |
| While | `packages/core/src/tree/control.ts` | `Node` | partial | Source syntax writer exists as `writeSyntax(...)`; public `toTrimmedString(...)` delegates to that writer, condition syntax uses direct writer calls instead of public `toString(...)` transport, parser-provided tree context is preserved at construction, state-mutation probing uses a straight loop instead of `.some(...)`, public render no longer allocates the control string wrapper callback, shared control body render awaits the native `Rules.render(...)` result directly instead of wrapping it in `Promise.resolve(...)`, and shared callable-entry resolution reads `Mixin.rules`/`Ruleset.rules` directly after concrete narrowing. Loop state/body surface and async branch audit remain. |
