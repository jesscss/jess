# Node Copy Reduction — Handoff

## Open This First

This is the live queue for the eval/render/copy refactor. Keep it short enough
that the next agent can read it at startup and act without replaying weeks of
completed work.

Use [README.md](./README.md) for architecture rules. Use this file for current
truth, the immediate pop queue, and verification.

## Current Truth

- The project priority is the fastest practical tree evaluation/render for
  real-world Less stylesheets. The current strategy is complete single-pass
  eval/render with the smallest honest node-creation shape. Regression audits
  support that strategy; they do not replace real stylesheet performance work.
  Memory reduction is second to speed. Object-count reduction is only useful
  when it improves runtime speed, memory pressure, or canonical-tree ownership.
  For mixins and imports, "smallest honest shape" means the fastest placement
  model that preserves Less semantics, not merely the fewest wrapper objects in
  a static count.
- Public CSS output APIs use awaited eval/render. `safeCompile(...)` remains
  the explicit tree-surface compatibility/debug API.
- Public `preEval()` and the old `preEvaluated` flag are gone. Registration
  setup is explicit through `prepareRegistration()` and
  `registrationPrepared`.
- The compiler render phase writes through `Rules.render(...)` into a flat
  buffer. `renderNodeToBuffer(...)`, `renderNodeToWriter(...)`, and
  `renderNodeToString(...)` are internal/test bridges only.
- Base `Node.render(context)` is direct source serialization. Nodes with
  context-dependent output choose local evaluated output and serialize through
  `renderSource(...)` / `renderOutput(...)` or native container syntax.
- The old generic output bridges are gone:
  `renderEvalOutput(...)`, `writeRootAwareEvalOutput(...)`,
  `renderChosenOutput(...)`, `renderSourceOutput(...)`, and
  `renderResolvedOutput(...)`.
- `$if`, `$for`, and `$while` avoid materializing control-wrapper output before
  buffer render. `$for` and `$while` stream iterations through direct
  `Rules.render(...)` calls and carry loop mutation through live `ScopeFrame`
  state.
- Context shadow state is intentional runtime state:
  `ScopeFrame.liveSlotsByName`, `ScopeFrame.fallbackFrame`, and
  `Context.rulesContext` remain part of the target model.
- The node-copy frontier is clean for deep copy/clone and ordinary production
  `.copy()` outside infrastructure. New copy/clone/inherit sites must prove a
  real ownership boundary.
- The current selector-collapse fix proves the mutation-helper rule: when
  `CompoundSelector` or `ComplexSelector` collapses to one surviving source
  child, output must own that child before inheriting container metadata.
  Calling `inherit(...)` on the canonical source child is a source-tree
  mutation bug. `ownCollapsedSourceChild(...)` is the shared helper for that
  family rule; do not inline it back into individual selector classes.
- Metadata-backed JS functions still keep exactly one owned raw/callback arg
  surface because `this.rawArgs` is mutable user-code API. Plain positional JS
  calls pass args directly.
- At-rule direct unevaluated render compatibility is documented, not deleted:
  the remaining derived at-rule surface isolates dynamic name/prelude
  evaluation, body registration/eval mutation, root-only frame clearing, and
  nested extend-root registration from the canonical source at-rule. The next
  at-rule work must split those responsibilities before removing the surface.
- At-rule prelude-only direct render is split for leaf at-rules: dynamic leaf
  names/preludes now evaluate into `AtRuleLeafState` for direct and buffer
  render without invoking `AtRule.eval(...)`. Dynamic leaf `resolve(...)` still
  owns public result-node creation. Body/root-hoist at-rules stay on the
  existing isolation surface, but direct render routes through an explicit body
  eval runner and then through `AtRuleBodyRenderState`. Body runtime facts live
  in `AtRuleBodyRuntimeState` instead of source value mutation. Body render
  state is now render-only; nestable-body registration facts are eval-frame
  state and are not stored in the render runtime map. Direct body-render
  prelude output is now runtime side state only: public resolve/eval may still
  write evaluated preludes onto their result node, but compatibility direct
  render must not write that prelude onto the render eval-frame. Direct
  body-render hoist/frame output is also runtime side state only; public
  eval/resolve may still write those facts onto their result node. Root-hoist
  frame-clearing output, evaluated body output, and render output facts are now
  carried on explicit eval context state before public eval/resolve writes them
  to runtime/node output, so body eval no longer uses the runtime map as the
  primary scratch record. The next at-rule work should split body
  registration/eval responsibilities enough to delete the remaining derived
  body surface, not revisit leaf at-rules or re-add registration facts to
  render state.
- At-rule body eval now separates nestable body registration prep into
  `AtRuleBodyEvalPrepState`; `evalBodyNode(...)` consumes prepared body state
  instead of open-coding prepare/push/register setup. Static root-only body
  at-rules may source-render inside otherwise static rulesets only when
  hoist/collapse behavior is inactive. When hoist is active, root-only body
  at-rules are hoisted in their sibling position: earlier root-only at-rules
  can emit before the containing ruleset body, and later root-only at-rules
  emit after already-rendered declarations.
- At-rule body eval now stores the body-to-eval/final-rules registration
  pairing and the evaluated body output on the invocation
  `AtRuleBodyEvalRecord` before public output writes. This is a staging step
  toward deleting the derived body frame, not a new render-state model.
  Nested `@layer` name state also writes through the invocation record before
  registration consumes it; the active context state only mirrors it for
  stack lookup while nested layers are being evaluated. Root-only body frame
  cleanup now also lives on the invocation record; context state keeps stack
  lengths and active lookup facts only.
- At-rule body eval registration state also owns the nestable-body
  `pushedExtendRoot` fact that final registration consumes. Keep moving
  body-registration facts into invocation-local state before trying to delete
  the remaining derived body frame.
- At-rule body eval now stores prepared body state on the invocation
  `AtRuleBodyEvalRecord` before building the registration record. Registration
  construction reads that prepared state from the record instead of open-coded
  local destructuring, so the body-to-eval/final-rules/pushed-extend-root path
  is one step less dependent on the derived eval frame.
- At-rule body eval frame push/pop, layer-name extraction, async rejection
  cleanup, ruleset-frame restoration, and extend-root stack cleanup now run
  through a single invocation runner. `evalBodyNode(...)` still uses a derived
  body eval frame, but it no longer open-codes the frame lifecycle. The body
  eval receiver is now the canonical source plus the invocation record; the
  derived frame is an eval target carried by the record, not the method
  receiver for body helpers.
- The remaining direct body-render at-rule isolation surface is still real:
  `evalBodyResult(...)` derives an eval frame because `evalBodyNode(...)`
  pushes/pops frames, prepares body registration, may attach extend/layer
  registration to the body, and public `resolve(...)` still needs an owned
  result node. The next deletion attempt needs a state record that can carry
  those body registration effects without reparenting or mutating source rules.
- At-rule body state design checkpoint: the replacement record should be
  invocation-local, not another runtime `WeakMap` model. It must carry the
  source at-rule, an owned public result frame only when public `resolve(...)`
  needs one, evaluated prelude output, body-to-eval/final-rules pairing,
  layer name, extend-root stack marker, and final hoist/root output facts.
  Frame-clearing cleanup is already record-owned. Render may consume that into
  `AtRuleBodyRenderState`; public resolve may consume it into an owned at-rule
  result. The record must not become AST v2 or store generic child output.
- At-rule body eval now has an explicit `AtRuleBodyEvalRecord` around the
  remaining derived eval frame. This is a staging surface only: it centralizes
  source, eval frame, evaluated prelude, and eval context state so the next
  deletion can move one responsibility out of the frame instead of reworking
  render/resolve at the same time. Evaluated body preludes now live on that
  eval context state during body eval; direct render no longer writes prelude,
  evaluated body, output, or layer-name registration facts to the eval-frame
  runtime map just to avoid duplicate render work. Public `resolve(...)` also
  skips render-frame prelude writes and keeps public result output owned by the
  result adapter. Body result finalization now reads invocation state before
  eval-frame runtime scratch, so the remaining runtime map is a
  compatibility/public-result bridge rather than the primary body result
  carrier.
- At-rule body eval output facts for hoist frames and hoist-to-root now stay in
  invocation/runtime state during eval. Direct eval no longer writes
  `frames`/`hoistToRoot` onto the canonical at-rule just to preserve body
  render output. The remaining derived body frame is still real because body
  registration, frame push/pop, layer/extend registration, and public
  result-node ownership have not all moved into the invocation record. The
  remaining eval-state flag is named `writeRuntimeState`; do not reintroduce
  "write to node" wording unless the code really writes node fields.
- At-rule body eval context state now carries the canonical source at-rule.
  Nested `@layer` parent-name lookup reads that source body instead of the
  derived eval frame, so one more registration fact is off the frame identity.
  The derived body frame still exists for body registration/eval ownership.
- Dynamic call fallback render/resolve now evaluates through `CallEvalState`
  without constructing a copied fallback `Call` surface. The state carries
  name, args, content, caller, mark-important, and rules-like variable lookup
  facts. Finalized fallback CSS call syntax is built at one boundary using
  state args. Already-evaluated finalized call output is marked before native
  render so optional fallback calls do not re-enter name evaluation.
  `evalFromState(...)` now runs inside the shared call-frame helper, so stack
  and caller restoration are centralized for ordinary dynamic calls, mixin
  collection calls, stylesheet functions, JS functions, and fallback paths.
- Dynamic optional fallback call args now reuse source-free static `List` and
  `Sequence` containers instead of copying them solely for source-parent
  safety. Source-free static fallback call content is also reused as inert
  frozen output. Source-backed or dynamic arg/content containers still own an
  eval target when preserving source parents. Fallback call content now has a
  tiny `CallContentPlacementState`; it records source content, whether static
  source content was reused, and selected output content only. It must not
  become a parallel call/body AST. Direct render of CSS-style optional
  fallback calls now emits finalized call syntax from state for source-backed
  content, no-content calls, and contextual `!important` output instead of
  deriving a fallback `Call` or owning output content; public `resolve(...)`
  still owns source-backed and dynamic content output. Dynamic
  source-free fallback content still owns a frozen output container before
  public result serialization; the direct-render reuse path is intentionally
  narrower.
- Reference fallback values now reuse source-free static `List` containers as
  inert output when every child is already a reusable leaf. Dynamic fallback
  containers, public result APIs, and rules-like outputs still own result
  surfaces.
- Static fallback, declaration-reference, direct-reference, and
  runtime-binding containers can render as text-only output without applying
  public result metadata when every child is already a reusable leaf. `List`
  and `Sequence` have focused text-only render proofs for fallback,
  declaration, runtime-binding, source-backed declaration reference, and
  source-backed direct-index paths. Dynamic containers, public
  `resolve(...)`, and `default()` guard containers still own result surfaces.
  Public direct-target `resolve(...)` remains an owned-result boundary for
  containers; render is the text-only path.
- Direct `index` lookups whose target resolves to a `List` or `Sequence` no
  longer reinterpret that target text as a mixin-ruleset key before lookup.
  Direct `index` lookups whose explicit target resolves to `JsArray`,
  `JsObject`, or `Rules` also stay on the direct-target path. This only
  narrows the ambiguous namespace redirect; it does not make lists/sequences
  general property maps. Render has scalar and source-free container proof for
  direct `JsArray` and `JsObject` hits without applying public reference
  metadata; public container resolve remains owned.
- Reference render still uses `evalNode(context)` and then native rendering of
  the resolved node for dynamic containers, declaration/runtime-binding values,
  and rules-like values. Scalar source-free fallback render now has a
  text-only finalization path that avoids public result metadata; declaration
  and variable lookup scalar leaves now use that same text-only path during
  render, runtime-binding scalar leaves do too, and static fallback,
  declaration-reference, direct-reference, and runtime-binding lists/sequences
  can render as text-only containers when children are reusable leaves.
  Fallback render and rules-like preserve paths now restore reference-stack
  state. Dynamic containers, rules-like values, and public result APIs still
  own output surfaces.
- Mixin output slot metadata can map placement output children back to their
  source body child with `getMixinOutputSourceChild(...)`, and can collect
  mapped source children in output order with `getMixinOutputSourceChildren(...)`.
  It can also map source children to placement output children with
  `getMixinOutputChildForSource(...)`, and map output children to source-order
  indexes with `getMixinOutputSourceIndex(...)`.
  Lookup still searches owned output children; the source map is for
  diagnostics/order/visibility proof, not a replacement search surface. Slot
  attachment validates source order/output ownership, indexes both
  output-child-to-source and source-child-to-output lookup directly, and
  multi-child output wrappers now assign lookup indexes from the slot source
  map after placement children are attached.
  Focused tests cover source child order, direct comment source segments, and
  repeated placements mapping back to the same source body without sharing
  owned output children.
- Mixin output source identity is now a slot helper responsibility through
  `markMixinOutputSource(...)`; wrapper call sites should not hand-roll
  `sourceNode` stamping. Caller fallback wiring for generated mixin output now
  also goes through `assignMixinOutputFallbackFrame(...)` instead of direct
  scope-frame mutation at call sites. Ruleset-as-mixin output now carries a
  `rulesetPlacement` record inside the slot with source rules, output rules,
  ordered child segments, and output-child-to-source-index lookup. That source
  index map is shared with the parent slot, not recomputed for the placement
  record. The record is intentionally small: it proves mapped order and
  ownership without replacing output children or scope/frame state.
- Direct unevaluated `Rules.render(...)` now routes through `RulesRenderState`
  before final string/buffer emission. True root renders with no established
  `context.root` evaluate the source root directly, not a derived wrapper,
  because document-level output still needs root ordering, hoists, controls,
  and extends. Fragment renders set up render-local context on the canonical
  source rules and restore it after emission. Plain static rule-leaf bodies
  still serialize the canonical source rules without deriving/evaling,
  matching the identity side of static `Rules.resolve(context)` while
  preserving root/fragment separator behavior. Do not blindly route static
  `Rules.resolve(...)` through that state: static resolve is
  identity-preserving, while static direct render still has body-fragment
  serializer semantics.
- Generated `:is(...)` pseudo rendering now has a
  `GeneratedPseudoPlacementState` prototype. It carries only source/name/arg
  plus the selector bit library and proven single-selector-list wrapper
  omission flag.
  Direct generated selector list args can omit the wrapper, and evaluated
  dynamic args that become selector-list output now use the same omission
  proof. Nested unknown pseudo argument output is covered as a text/metadata
  boundary: generated placement text can stay narrow while selector metadata
  stays wrapper-owned. The unused `argText` placement fact is gone; the owned
  generated pseudo wrapper still exists because selector
  parentage/visibility/extend metadata have not been split into placement
  state. It must not grow into a selector AST replacement; add another fact
  only with selector-shape evidence.
- Selector mutation-helper inventory was rechecked across
  `CompoundSelector`, `ComplexSelector`, `SelectorList`, and generated pseudos.
  `withComponents(...)` / `withSelectors(...)` still own unchanged source
  children when evaluation changes a container, and collapse still needs
  `ownCollapsedSourceChild(...)` to avoid mutating canonical source children.
  The single generated-pseudo `inherit(...)` is tied to evaluated pseudo arg
  output and selector-bit metadata. Do not delete these helpers by pattern; the
  next honest reduction is a selector placement-state record that carries
  parentage, visibility, extend metadata, selector bit library, hoist/root
  placement, and composed selector text.
- Ampersand append/template evaluation now has a tiny
  `AmpersandAppendPlacementState` prototype. It currently carries only source,
  selected parent/output selector, input selector item text/count, append text,
  template-merge mode, hoist fact, template parts, template replacement
  selectors/text, selector bit library, final result pointer, and final result
  text. It does not replace generated selector output; it is a staging point
  for proving which generated facts can move out of selector wrappers.
- A `MixinOutputSlot` type now exists as an explicit compatibility record on
  generated mixin-output `Rules` wrappers. Slot-aware helpers cover
  mixin-output identity, ambient versus targeted lookup policy, visibility
  checks in `Rules`, `Reference`, serializer gating, and registry
  child-search. The old `isMixinOutput` option is gone; mixin-output identity
  and ambient lookup policy live on the slot. Registry lookup keeps entry
  visibility, node visibility, optional candidates, and mixin-output lookup
  policy as distinct helper concepts; do not collapse them back into one
  coalesced visibility check. Use `canEnterRulesEntryForLookup(...)` for entry
  traversal decisions, because the lookup supplies the type/target policy. Use
  `canEnterMixinOutputForLookup(...)` only for the narrower generated-output
  ambient/target gate.
- `MixinOutputSlot.childSegments` records the canonical source child and, when
  the ordered output position exists, the owned output child for that
  placement. The slot also carries whether ambient lookup may enter the
  wrapper. Lookup still must not switch to source segments blindly; output
  children are the scope/frame-bearing surface. Slot attachment now owns
  `referenceMode` clearing for generated output wrappers; the old recursive
  `clearReferenceModeForMixinOutput(...)` pass was dead scaffolding and is
  gone. Wrapper call sites should not repeat reference-mode cleanup after
  `attachMixinOutputSlot(...)`.
- `attachMixinOutputSlot(...)` also owns generated-output source identity.
  Call sites should not pair it with a separate `markMixinOutputSource(...)`
  ritual. Detached generated output caller fallback wiring can also be passed
  through slot attachment; ordinary mixin body fallback still remains earlier
  because guards/body eval need that fallback before an output slot exists.
  Serializer ancestry checks for restricted generated output now go through
  `isFromRestrictedMixinOutput(...)`, so serializer code does not
  open-code the slot/source-chain rule. Duplicate-declaration preservation for
  restricted generated output now goes through
  `keepsDuplicateMixinOutputDeclaration(...)`, keeping that serializer
  policy with the slot facts it depends on.
- The next `MixinOutputSlot` boundary was audited. Direct comment children
  cannot move into the slot as a loose side list because mixin output must
  preserve source order among comments, declarations, nested rules, and lookup
  visibility gates. Targeted callable lookup also cannot read source-child
  segments as the actual search surface yet: nested mixin scope tests prove the
  owned output children carry scope/frame semantics that source children do not.
  The current owned output child surface remains the smallest honest model
  until the slot can carry ordered child segments, evaluated placement children,
  rule index, scope frame, reference gates, and targeted lookup behavior.
- Mixin-output wrapper replacement requirements were re-inventoried. The
  wrapper is still the active scope/frame-bearing output surface for ordered
  comments, declarations, nested rules, targeted callable lookup, repeated
  placements, rule indexes, `referenceMode` clearing, and caller fallback
  behavior. The slot no longer stores a stale `rulesVisibility` snapshot; rule
  visibility stays on the actual output `Rules` surface until that whole
  responsibility moves. Mixin-output rule-index assignment is now behind a slot
  helper, but lookup still searches owned output children. The next slot
  record must carry those facts before deleting a real generated `Rules`
  wrapper responsibility; source child segments alone are diagnostic/order
  metadata.
- Ruleset-as-mixin child ownership was re-audited against complex parent
  ampersands and nested array-path lookups. Source-free scalar leaves are
  already reused, but output children for ruleset-as-mixin calls still need
  ownership because collapse/nesting and lookup depend on placement parentage,
  hoist/root output, indexes, and scope state. A future reduction needs a
  richer placement record for one proven path, not another direct source-child
  search. The simple declaration placement proof now locks that in: the output
  declaration is owned by the output `Rules`, source declaration parentage stays
  canonical, and reusable scalar leaves remain source-owned. Nested rules and
  direct comment children are also covered by slot mapping proof, and the first
  `rulesetPlacement` record preserves full mapped source order while output
  children remain owned.
- Ruleset render materialization was re-audited. Source selector and source
  body parentage stay canonical during direct render/resolve. Unevaluated
  rulesets now own the body `Rules` surface when registration/eval would
  otherwise reuse the canonical source body. This is an intentional
  source-safety ownership boundary, not a speed win. Do not remove it until a
  side state can carry evaluated body output and frame/extend registration
  without reparenting source body rules.
- Plain static non-nil rulesets with static declaration/comment bodies render
  directly from the source tree. They do not prepare registration, evaluate a
  ruleset surface, or own a body surface just to print authored CSS. Dynamic
  rulesets, nil selectors, guards, nested rules, extends, and body output that
  needs registration/eval still use the owned body path.
- Guarded nil-selector rulesets now share the direct owned-body render path:
  the guard is evaluated on an owned guard copy, source guard/body parentage is
  preserved, and failed guards return `Nil` without wrapper registration prep.
- That source-direct ruleset path also covers static leaf at-rule children.
  Body at-rules with nested rules are still excluded because they can carry
  registration, nesting, hoist, layer, and extend semantics.
- That source-direct ruleset path also covers static invisible `VarDeclaration`
  children, which serialize as no output and do not require registration/eval
  work when the surrounding static body is only being rendered.
- A follow-up audit found no additional static no-effect ruleset body shape to
  add by pattern. Invisible `Extend`, `Mixin`, `Log`, import, and control nodes
  still have registration, frame, diagnostic, lookup, or eval effects.
- A dynamic ruleset proof found that declaration bodies with interpolated
  values can source-render without body registration prep while keeping source
  selector/body parentage canonical. That is not a general dynamic-body
  side-state deletion. Nested output, guards, nil selectors, hoists, extends,
  and bodies that need registration still require the owned body surface.
- A guarded nested ruleset proof confirmed a real dynamic ruleset blocker:
  source body parentage stays canonical and output parity is preserved, but the
  guarded/nested path is not a safe source-direct render target yet. Treat it as
  a side-state design target, not as a pattern deletion.
- Nil-selector ruleset render is now split for the simple no-guard case: it
  evaluates an owned body directly instead of deriving a wrapper ruleset, while
  preserving source body parentage and avoiding source body render/registration
  calls. Guarded or registration-sensitive nil-selector bodies remain an
  owned-body side-state target.
- When Less fixture expectations intentionally diverge from Less 4 output,
  preserve the old Less expectation under the matching `legacy/` expectation
  path before changing the active Jess expectation.
- The broad proof queue has been processed. Current conclusions:
  at-rule bodies/root-hoist now carry final body output as side-state, but the
  full surface still needs prelude/body/root-hoist responsibilities split;
  mixin output wrappers are the current output-slot stand-in; dynamic-call
  fallback no longer uses a copied `Call` surface, but dynamic-name ownership
  still needs a narrower rule;
  direct unevaluated `Rules.render(...)` no longer derives a wrapper tree;
  generated selector ownership is semantic until a placement-state record
  carries visibility/extend/composed-header facts; mutation-helper cleanup
  should attack one helper family or node surface at a time, not one call site.
- Remaining broad typecheck red is separate typed-node structural debt. Do not
  let it displace runtime node-creation reduction unless it directly unlocks a
  copy/materialization deletion.
- Queue items must stay surface-sized. A pass may choose a whole helper
  family, node family, or eval/render surface; if only a tiny slice is safe,
  document the broader inventory and the semantic blocker that prevented the
  family-wide change.
- Current helper-family inventory is intentionally broad: roughly 189
  `.inherit(...)` sites, 55 `derive*` / `.derive(...)` sites, and 56
  reusable-leaf copy/clone sites under `packages/core/src/tree`. Treat those
  as ownership-boundary audits, not one-call cleanup chores.

## Remaining Node-Creation Surfaces

| Surface                             | Current shape                                                                                                                                                                         | Next proof                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Rules.render(...)` source roots    | Public compile renders already evaluated roots. Direct unevaluated root render evals the source root when no root context exists; direct fragments render from source with render-local context and no derived wrapper. | Keep reducing fragment/root state without losing charset/import ordering, controls, registration prep, separators, or source parentage.   |
| `AtRule.render(...)`                | Reuses evaluated/prepared/static at-rule surfaces when available. Dynamic leaf render uses local name/prelude state; direct dynamic body/root-hoist render still derives before eval, but final body, prelude, hoist, and frame output are side-state and the body eval runner takes explicit state. | Split body registration/eval responsibilities enough to delete the remaining isolation surface.                                          |
| `Ruleset.render(...)`               | Reuses evaluated/prepared ruleset surfaces. Plain static non-nil declaration/comment/leaf-at-rule bodies render from source without prep/eval. Other unevaluated rulesets still prepare/eval an isolated surface; the body surface is owned when needed to keep the canonical source body parented to the source ruleset. | Expand direct source render only for proven static body shapes, then replace the owned dynamic body surface only when side state can carry body output, frame/extend registration, nil-selector output, and source parentage. |
| `Declaration.render(...)`           | Plain declaration render uses render-only registration state. Assignment render owns temporary expression inputs to preserve source parentage, but does not materialize a prepared declaration surface. Contextual important is render-only; custom values and merge/assignment normalization still constrain broader deletion. | Keep narrowing assignment/custom state without changing public `prepareRegistration(...)` / `resolve(...)` ownership.                    |
| Function/mixin args                 | Plain JS calls pass direct args. Metadata calls keep one owned `rawArgs` surface.                                                                                                     | Keep guarding the split; do not add another copied source-call surface.                                                                   |
| Generated selector/output ownership | Extend, `:is(...)`, pseudo args, framed ampersands, selector collapse, and ruleset headers still create owned placement surfaces in focused cases.                                    | Keep unless new parentage/visibility/output tests prove a specific placement is carrier-only.                                             |
| Mutation helpers                    | `inherit(...)`, `set(...)`, `derive*`, and shallow wrappers still exist as local ownership tools.                                                                                     | Remove or narrow helper use where a side-state record or direct render output can carry the same semantics without mutating source nodes. |

## Node-Creation Hotspots

Run `pnpm run audit:node-creation` before and after a node-creation reduction
checkpoint. The script ranks likely runtime surfaces; it is not a gate.

Current top files by static surface count:

1. `packages/core/src/tree/rules.ts`
2. `packages/core/src/tree/declaration.ts`
3. `packages/core/src/tree/import-style.ts`
4. `packages/core/src/tree/dimension.ts`
5. `packages/core/src/tree/at-rule.ts`
6. `packages/core/src/tree/reference.ts`
7. `packages/core/src/tree/ampersand.ts`
8. `packages/core/src/tree/call.ts`
9. `packages/core/src/tree/ruleset.ts`

Current top surface kinds: `new` node construction, `with*` output surfaces,
`derive*` / `.derive(...)` surfaces, and `copyWithReusableLeaves(...)`.
Latest audit: `new-node: 308`, `derive: 30`, `with-surface: 41`,
`copy-leaves: 30`, `clone-leaves: 0`, module-context count `381`,
eval-context count `26`, prepare-registration count `2`, resolve-context count
`0`. The clone-leaves frontier is zero; remaining work is reducing owned
placement copies/state carriers, not hiding deep clone behind another helper.

## Completed Work Summary

- Deep copy/clone frontiers are clean. The clone-leaves frontier is zero; the
  remaining work is reducing owned placement copies/state carriers.
- Render/eval state seams now exist for `Rules`, `AtRule`, `Call`,
  `Declaration`, generated pseudo placement, import placement, and mixin output
  slots. These are transitional state carriers, not a second AST.
- Removed/retired surfaces include public `preEval()`, the old
  `preEvaluated` flag, direct public `Rules.resolve(...)` wrapper derivation,
  dynamic call fallback surface eval, final at-rule body mutation, production
  `.set()` helper use, and broad clone-leaves helpers.
- Direct render now uses native render paths for root/fragments, control
  iterations, body at-rules, calls, declarations, and references where proven.
  Public `resolve(...)` still materializes node results where that is the API
  contract.
- Declaration registration prep, body at-rule render/resolve, generated
  selectors, reference result ownership, ruleset-as-mixin children, and
  state-mutating loop iteration prep still carry real ownership or public-result
  semantics. Do not delete those wrappers by pattern.
- `Declaration.render(...)` now prepares declaration registration state without
  copying source-backed name/value/important parts. Public
  `prepareRegistration(...)` and `resolve(...)` still own result surfaces.
- Declaration assignment render prep owns only temporary assignment-expression
  inputs that need a parent. It keeps authored declaration values parented to
  the source declaration across `+:`, `&,:`, `&_:`, and `?:` render, while
  public registration/resolve still materialize owned result surfaces. Merged
  list and space-sequence output can now stream from assignment state without
  constructing temporary `List`/`Sequence` printer surfaces.
- Runtime-binding reference containers now have a focused default-guard proof
  and restore `referenceStack` on the owned output path. They are still not a
  text-only container target because `default()` needs live callable context.
- Source-free static fallback `List` and `Sequence` containers are reusable
  inert output for reference resolve/render. Direct index lookups that hit
  static list/sequence containers can also render text-only without applying
  public reference metadata. Focused declaration-reference and direct-index
  proofs cover source-backed static containers during render only. Dynamic,
  rules-like, default-guard, and public resolve containers still own result
  surfaces.

## Recent Pass History

Keep this table short. Add the newest row at the top. `#1` is the latest pass.
Move old detail to git history or a dedicated perf log if we need a deeper
trend.

| # | Focus | Main result |
| --- | --- | --- |
| 1 | Full queue pop: reference text containers / pseudo state | The 15-item queue was processed and replaced. Source-backed static declaration-reference and direct-index `List` containers now render text-only without copying or inheriting the source container; public resolve/fallback ownership remains narrow. Generated pseudo placement no longer carries unused `argText`, and the hallucinated `??` condition test is gone. At-rule/import/guard/control/scalar items were audited and left as real blockers, not fake-deleted. |
| 2 | Full queue pop: fallback syntax / queue refresh | The 15-item queue was processed and replaced with sharper next surfaces. No-content and contextual-`!important` CSS optional fallback calls now render finalized syntax from `CallEvalState` without deriving a fallback `Call`; optional JS calls still fall through to the JS execution path. Static audit stayed unchanged; saved/read-only hot-path rows were noise-band samples except noisy `media`. |
| 3 | Full queue pop: fallback content render syntax | The 15-item queue was processed and replaced with the next 15 surfaces. Source-backed optional fallback call content now renders from `CallEvalState` syntax without deriving a fallback `Call` or owning output content; public resolve still owns source-backed/dynamic content. Static audit stayed unchanged; hot-path rows were noise-band samples. |
| 4 | Slot duplicate policy / metrics | Duplicate-declaration preservation for restricted generated mixin output moved behind `keepsDuplicateMixinOutputDeclaration(...)`, with the existing ancestry proof extended to cover the policy. Static audit stayed unchanged; saved/read-only hot-path rows were mixed and still descriptive only. |
| 5 | Slot serializer gate / queue refresh / metrics | Mixin-output restricted ancestry detection moved from `serialize-helper.ts` into `isFromRestrictedMixinOutput(...)` with a focused mixin proof. The rest of the queue was re-audited against current blockers; no broad at-rule, fallback-call, selector, import, guard, control, or scalar deletion was taken without new semantic proof. |
| 6 | Full queue pop: at-rule receiver / slot fallback / import wording | The previous 15-item queue was processed. Code changes narrowed at-rule body eval to the source plus invocation record, moved detached generated-output fallback wiring into `attachMixinOutputSlot(...)`, and removed stale import clone wording. The rest of the queue was re-audited against existing focused proofs and replaced with narrower next surfaces rather than left stale. |
| 7 | At-rule runner / mixin slot identity / scalar cleanup | At-rule body frame push/pop and async cleanup now run through an invocation runner; `attachMixinOutputSlot(...)` owns generated-output source identity; the stale import deep-clone comment is gone; dimension unit lookup uses one shared map; negative eval reuses a constant `-1` dimension; unused `Condition.getBool(...)` allocation path was removed. |

## Metrics Snapshot

Static audit is useful for regression detection, not proof of speed. Hot-path
timing rows are descriptive samples, not verdicts. Do not call a change faster
or slower from one row, especially when relative standard deviation is high;
look for repeated adjacent runs with the same direction before treating a
performance change as real.

Latest static audit:

| `new-node` | `derive` | `with-surface` | `copy-leaves` | `clone-leaves` | module | eval | prepare | resolve |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 308 | 30 | 41 | 30 | 0 | 381 | 26 | 2 | 0 |

Recent hot-path medians. `#1` is the latest pass.

| # | Pass | `functions` | `import-ref` | `mixins-guards` | `extend` | `media` | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Full queue pop: reference text containers / pseudo state | 21.53ms | 28.99ms | 31.94ms | 15.63ms | 8.92ms | read-only sample was 21.21/28.99/31.92/15.42/7.57ms; saved comparison was noise except `media` at 20.0% slower with 22.1% RSD, so treat as descriptive only |
| 2 | Full queue pop: fallback syntax / queue refresh | 21.40ms | 27.59ms | 30.66ms | 15.44ms | 7.43ms | read-only sample was 21.45/27.24/31.36/15.19/7.44ms; saved comparison was noise except `media` at 8.1% slower with 19.7% RSD, so treat as descriptive only |
| 3 | Full queue pop: fallback content render syntax | 20.32ms | 26.49ms | 31.21ms | 14.74ms | 6.88ms | read-only sample was 21.42/26.71/30.40/18.06/8.87ms with high `extend` variance; saved comparison was inside the noise band for every fixture, so treat as descriptive only |
| 4 | Slot duplicate policy / metrics | 21.42ms | 27.35ms | 32.11ms | 15.49ms | 7.31ms | read-only sample was 21.17/28.68/34.11/16.48/7.63ms; saved comparison had import-ref/media faster and the rest noise, but the previous saved row was noisy, so treat as descriptive only |
| 5 | Slot serializer gate / queue refresh / metrics | 22.38ms | 31.85ms | 33.53ms | 15.95ms | 8.92ms | read-only sample was 22.82/31.92/33.43/16.05/8.68ms; saved comparison was mostly slower but import-ref RSD was 69.7% and media RSD 19.0%, so treat as descriptive only |
| 6 | Full queue pop: at-rule receiver / slot fallback / import wording | 20.45ms | 25.87ms | 30.37ms | 15.25ms | 7.16ms | read-only sample was 20.72/27.09/30.12/15.74/7.46ms; saved comparison versus prior row is inside noise band, so treat as descriptive only |
| 7 | At-rule runner / mixin slot identity / scalar cleanup | 20.73ms | 26.26ms | 30.65ms | 14.84ms | 7.20ms | read-only sample was 20.63/27.56/31.15/15.00/7.18ms; saved comparison versus prior row is inside noise band, so treat as descriptive only |

Measurement commands:

- `pnpm run measure:less:hotpath` is read-only. It uses 30 measured iterations,
  3 warmups, and prints median/mean/p75/p90/min/max plus relative standard
  deviation.
- `pnpm run measure:less:hotpath:record -- --note "short reason"` appends
  structured fixture records to
  `docs/future/node-copy-reduction/less-hotpath-history.jsonl` and compares the
  current run against the latest saved record for each fixture.
- Use `--json` or `--jsonl` for scripts, `--compare <file>` for an explicit
  baseline file, and `--threshold 0.08` to control the noise band. Keep this
  handoff as the readable summary, not the metrics database.

## Durable Blockers

- Body at-rule render cannot simply eval the source at-rule because body
  registration prep can mutate the body `Rules` surface and extend/layer
  registration keys.
- Ruleset-as-mixin child copies protect complex parent ampersands and nested
  array-path ruleset mixin calls until a smaller placement state carries that
  selector-parent context.
- Reference render still shares public result ownership for dynamic
  containers, public `resolve(...)`, and rules-like values. Static
  fallback/declaration/direct/runtime-binding list and sequence containers can
  render text-only when their children are reusable leaves, including the
  focused source-backed declaration-reference and direct-index cases. Do not
  extend that to dynamic or rules-like containers without ownership proof.
- Ampersand append/template output remains generated selector output, not just
  carrier metadata. A future placement state must carry the source ampersand,
  source parent selector, append/template string, validated replacement text or
  selector-list items, hoist/root placement facts, selector-bit/library facts,
  and final selector text. It must not grow into a parallel selector AST.
- Empty rest / `@arguments` binding placeholders preserve current Less
  behavior. Do not delete them unless the behavior is explicitly changed.

## Immediate Queue

This is a pop queue. Keep at least fifteen concrete items here. A normal
handoff round should complete all fifteen queued items unless the user
explicitly asks for a smaller slice. When an item is completed, remove it and
add or promote enough work to leave the queue full for the next round. If an
item is too broad, replace it with the smallest honest next checkpoint and move
the broader theme to the backlog.

Queue items must be surface-sized, not line-sized. Prefer a whole node family,
helper family, or eval/render surface with inventory, implementation, focused
proof, audit delta, and documented blockers. Only split smaller after the
inventory proves a real semantic blocker; do not create timid items like
"delete one helper call" when a whole `.set()` / `inherit()` / `derive*`
family can be audited and reduced.

1. **Split one at-rule body registration fact from the derived frame.**

   Start with same-name nested layer registration or body-to-eval/final-rules
   lookup, because the previous queue proved the remaining body frame is still
   a real eval target. Add a focused parentage test and keep public
   `resolve(...)` owned.

2. **Design the at-rule public-result adapter around the invocation record.**

   Inventory which public result fields still require an owned at-rule result
   and which can be read from `AtRuleBodyEvalRecord`. Implement only the first
   field move that avoids using the public result as an eval helper receiver.

3. **Audit optional JS fallback call failure output as a family.**

   Cover optional JS failures, metadata failures, raw args, caller restoration,
   and finalized CSS fallback syntax together. Reduce a copied call surface
   only if user-code call counts and raw/callback arg ownership stay proven.

4. **Extend reference text-only render to one more source-backed family.**

   Candidate surfaces are runtime-binding containers without `default()` or
   direct object hits whose values are static `List`/`Sequence` leaves. Keep
   public fallback/resolve owned and document any dynamic/rules-like blocker.

5. **Audit reference text-only predicates for one unified render predicate.**

   The current split between public ownership and render-only reuse is
   intentional. Simplify names or structure only if it makes that boundary
   clearer without letting public APIs reuse source-backed containers.

6. **Reduce generated pseudo wrapper responsibility only with metadata proof.**

   Do not add another placement fact by guess. Pick one focused selector case
   and either move visibility/keyset/composed-text responsibility into a small
   record or document why the wrapper is still the honest owner.

7. **Audit ampersand append/template placement as a whole selector surface.**

   Test complex parent selectors, template merge, hoist/root placement, and
   selector-bit metadata together. Remove wrapper work only if final selector
   text and parentage can be carried without a generated selector AST.

8. **Trim ruleset header/carrier rendering only where cache facts moved.**

   Re-check frame-header cache, generated pseudo headers, and TriviaMap-owned
   comments. Delete stale source/header plumbing only where no parse/render
   boundary remains.

9. **Reduce import-style first-use placement for one fast path.**

   Target non-reference, non-multiple, cache-stable imports first. Keep
   reference/once/multiple/source-map semantics intact and measure because
   speed, not object count alone, decides this surface.

10. **Decide inline import source streaming with postlude proof.**

   Inline imports currently allocate `Any(source)`. Replace it only if raw
   loaded text plus postlude wrapping and source-map behavior can stream
   directly without changing public output.

11. **Reduce declaration custom-property state while preserving raw value text.**

   Custom properties must serialize the authored value as-is after the colon
   except evaluated interpolation. Reduce state only around that invariant and
   avoid source-slice comparison tricks.

12. **Decide fresh `Bool` public result ownership for guards and conditions.**

   Render is already text-only. Public eval/resolve still returns fresh
   `Bool`; keep or reduce that boundary based on returned-node mutability and
   parent/source ownership proof.

13. **Audit control-node generated rule surfaces for no-output controls.**

   `$if`, `$for`, and `$while` stream render output. Remove only pure
   no-output/public marker surfaces; loop mutation, visibility, and public
   eval results remain semantic.

14. **Run an operation-family wrapper pass with real Less math fixtures.**

   Work by family, not by isolated allocation: strict units, color math,
   slash/calc preservation, modulo/division, and math-mode behavior must all
   stay covered before reducing `Operation`/`Dimension` wrappers.

15. **Run the next measured structural pass after the next real reduction.**

   Pair the reduction with focused tests, static audit, read-only hot-path, and
   saved hot-path record. Update this table without calling one noisy row a
   win or regression.

## Backlog

- **Mutation-helper reduction.** Audit `inherit(...)`, `set(...)`,
  `derive*`, and shallow wrapper construction in hot eval/render paths. The
  goal is not to ban them as APIs; it is to stop relying on helper-driven
  mutation as the normal eval/render strategy.
- **Generated selector state.** Replace placement-owned selector wrappers only
  when a small side-state record can preserve source parentage, visibility,
  extend metadata, selector-bit library, hoist/root placement, and composed
  header cache without becoming AST v2.
- **Mixin output slots.** Replace generated mixin `Rules` wrappers only when a
  slot record can carry source body, evaluated placement children, scope frame,
  visibility/reference gates, rule index, and caller fallback.
- **Dynamic call state.** Replace remaining copied dynamic-call surfaces with a
  state record that preserves evaluated/fallback name, evaluated args/content,
  owned raw args when required, caller pointer, and parent/source safety.
- **Typed node structural frontier.** Continue splitting `tsc --noEmit`
  failures by node-family shape when it directly helps runtime cleanup.

## Verification

Use the nearest focused test while iterating. Before claiming a handoff-level
status change, run:

```sh
pnpm run verify:node-copy-frontier
pnpm run verify:render-buffer-frontier
pnpm run verify:materialization-frontier
pnpm run verify:package-exports
pnpm run measure:less:hotpath
pnpm run verify:baseline -- --changed
```

Use the full baseline when a change touches root gates, package metadata,
shared verifier scripts, or broad render/eval contracts:

```sh
pnpm run verify:baseline
```

## Checkpoint Rule

A checkpoint is one coherent code or docs change with verification. If a seam
is too large, finish the smallest honest slice that leaves the repo and this
handoff more truthful than before.

For each checkpoint:

1. Read relevant source and focused tests before editing.
2. Make the smallest behavior-preserving change.
3. Run focused proof first.
4. Run the nearest broader verification.
5. Update this handoff if current truth or the immediate queue changed.
6. Commit and push when clean.

## Stop Conditions

Stop and ask before inventing semantics when:

- a fixture conflicts with documented Jess behavior;
- a wrapper seems removable but carries scope, import/reference, selector
  placement, or delayed-output state;
- a red appears only in `packages/jess/test/less/all-less.test.ts` and there is
  no focused parser/core repro yet;
- fixing a frontier requires broad new helper families instead of deleting or
  narrowing existing machinery.

## Do Not Resurrect

- checked-in task registries or unattended task loops
- stage trackers that mostly describe absent machinery
- broad "current dirty diff" notes copied from an old session
- long completed-work narratives in this file
- fixture-expectation changes that are not tied to an explicit Jess behavior
  decision
