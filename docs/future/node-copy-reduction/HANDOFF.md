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
  Nested `@layer` name state also lives on the invocation record before
  registration consumes it; nested layer lookup now walks active records, not
  eval-frame/context-state layer facts. Root-only body frame cleanup also
  lives on the invocation record; context state keeps stack lengths only.
- At-rule body eval registration state also owns the nestable-body
  `pushedExtendRoot` fact that final registration consumes. Keep moving
  body-registration facts into invocation-local state before trying to delete
  the remaining derived body frame.
- At-rule body eval now stores prepared body state on the invocation
  `AtRuleBodyEvalRecord` and builds registration state at the record boundary.
  The body walker receives `AtRuleBodyRegistrationState` directly instead of
  open-coding prepared-body storage plus registration construction, so the
  body-to-eval/final-rules/pushed-extend-root path is one step less dependent
  on the derived eval frame.
- At-rule body eval frame push/pop, layer-name extraction, async rejection
  cleanup, ruleset-frame restoration, and extend-root stack cleanup now run
  through a single invocation runner. Direct body render uses the canonical
  source at-rule as the frame and stores visibility/prelude/body/output facts
  on the invocation record. Public body `resolve(...)` now also evaluates with
  the canonical source at-rule as the invocation frame and constructs the owned
  public result only at the result-adapter boundary. Plain static body rules
  render directly without an owned body eval target through the shared
  `canRenderStaticRulesDirectly(...)` predicate used by `Rules.render(...)`;
  static invisible variable declarations are included in that direct rule.
  Static root-only declaration/comment bodies also use that path when
  hoist/frame facts are side state. Dynamic, nestable-registration, and
  non-plain body rules still own a body `Rules` eval target so source children
  are not evaluated or reparented.
- The remaining body at-rule isolation surface is still real: direct render
  still needs a smaller owned body-eval target for dynamic or
  registration-bearing bodies, and public `resolve(...)` still returns an owned
  result at-rule as its API contract. The public result is no longer the body
  eval helper receiver.
- At-rule body state design checkpoint: the replacement record should be
  invocation-local, not another runtime `WeakMap` model. It must carry the
  source at-rule, an owned public result frame only when public `resolve(...)`
  needs one, evaluated prelude output, body-to-eval/final-rules pairing,
  visibility, layer name, extend-root stack marker, and final hoist/root output
  facts. Frame-clearing cleanup is already record-owned. Render may consume
  that into `AtRuleBodyRenderState`; public resolve may consume it into an
  owned at-rule result. The record must not become AST v2 or store generic
  child output.
- At-rule body eval has an explicit `AtRuleBodyEvalRecord` around each body
  invocation. This is a staging surface only: it centralizes source, eval
  frame or render frame, owned body rules when needed, evaluated prelude,
  visibility, and eval context state so deletion work can move one
  responsibility at a time. Direct render no longer writes prelude, evaluated
  body, visibility, output, or layer-name registration facts to the source
  at-rule. Public `resolve(...)` also disables invocation writes, evaluates
  with the source frame, and keeps public result output owned by the result
  adapter. Body result finalization now reads only invocation/context state; it
  no longer falls back to `AtRuleBodyRuntimeState`. The remaining runtime map
  is for evaluated-node render APIs such as rules/header/frame/hoist access,
  not body-result scratch.
- At-rule body eval output facts for hoist frames and hoist-to-root now stay in
  invocation/runtime state during eval. Direct eval no longer writes
  `frames`/`hoistToRoot` onto the canonical at-rule just to preserve body
  render output. Direct render no longer needs a copied at-rule frame, and
  plain static body rules avoid body eval entirely. Public resolve still owns a
  result node. The remaining eval-state flag is named `writeRuntimeState`; do
  not reintroduce "write to node" wording unless the code really writes node
  fields.
- At-rule body eval no longer keeps an active context-state stack for nested
  layer lookup. Active invocation records carry the canonical source at-rule
  and layer name; this removed the old context-state mirror.
- Dynamic call fallback render/resolve now evaluates through `CallEvalState`
  without constructing a copied fallback `Call` surface. The state carries
  name, args, content, caller, mark-important, and rules-like variable lookup
  facts. Finalized fallback CSS call syntax is built at one boundary using
  state args. Already-evaluated finalized call output is marked before native
  render so optional fallback calls do not re-enter name evaluation.
  `evalFromState(...)` now runs inside the shared call-frame helper, so stack
  and caller restoration are centralized for ordinary dynamic calls, mixin
  collection calls, stylesheet functions, JS functions, and fallback paths.
  Render-only optional JS failure fallback for non-metadata functions now emits
  finalized fallback syntax as text instead of owning a fallback `Call` result.
  Public `resolve(...)` still owns the fallback `Call`, and metadata/rawArgs
  failure remains an owned user-code API boundary.
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
  inert output when every child is already a reusable leaf. Static
  source-backed fallback containers can render text-only without applying
  public result metadata. Dynamic fallback `List`/`Sequence` render now skips
  the pre-copy of the source container and streams resolved children through
  native container syntax. Public fallback results still own source-backed
  containers; rules-like outputs still own result surfaces.
- Static fallback, declaration-reference, direct-reference, and
  runtime-binding containers can render as text-only output without applying
  public result metadata when every child is already a reusable leaf. `List`
  and `Sequence` have focused text-only render proofs for fallback,
  declaration, runtime-binding, source-backed fallback, source-backed
  declaration reference, and source-backed direct-index paths, including
  object direct-index hits. Runtime-binding render can now skip the
  source-backed container copy/eval step when the binding value is already a
  static text-only render value. Dynamic containers, public `resolve(...)`,
  and `default()` guard containers still own result surfaces. Public
  direct-target `resolve(...)` remains an owned-result boundary for containers;
  render is the text-only path.
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
  can render as text-only containers when children are reusable leaves. The
  public-owned predicate and the render-only predicate stay separate on
  purpose: public result APIs must not reuse source-backed containers. Fallback
  render and rules-like preserve paths now restore reference-stack state.
  Dynamic containers, rules-like values, and public result APIs still own
  output surfaces. Rules-like reference preservation is now one explicit
  helper family: `Rules`, `Collection`, `Mixin`, and `Ruleset` outputs are
  shallow owned reference surfaces, not text-only render containers. Future
  reduction needs to keep moving lookup/callable facts into explicit records
  before removing these surfaces. The current
  `RulesLikeReferencePreservationRecord` carries the source-node fact beside
  the shallow owned public/callable surface.
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
  plus the selector bit library and proven wrapper-omission fact. Direct
  generated selector-list args can omit the wrapper, and evaluated dynamic
  args that become selector or selector-list output now use the same placement
  override. Nested unknown pseudo argument output is covered as a text/metadata
  boundary: generated placement text can stay narrow while selector metadata
  stays wrapper-owned. The unused `argText` placement fact and the standalone
  wrapper-omission side map are gone; the owned generated pseudo wrapper still
  exists because selector parentage/visibility/extend metadata have not been
  split into placement state. It must not grow into a selector AST replacement;
  add another fact only with selector-shape evidence.
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
  template-merge mode, hoist fact, template parts, selector bit library, final
  result pointer, and final result text. Template replacement selectors/text
  are derived locally at the merge boundary, not stored on placement state.
  Proven suffix templates such as `&-theme` use structured
  `appendSelector(...)` output, so complex selector-list parents keep selector
  metadata and source parentage instead of flattening through one
  `BasicSelector` string. It does not replace generated selector output; it is
  a staging point for proving which generated facts can move out of selector
  wrappers.
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
  behavior. The slot now carries explicit `rulesVisibility` state through
  `getMixinOutputRulesVisibility(...)`, and lookup visibility helpers consult
  that slot fact before falling back to wrapper options. The slot also carries
  generated-output `referenceMode` state through
  `getMixinOutputReferenceMode(...)`; callers should not repeat wrapper option
  cleanup after `attachMixinOutputSlot(...)`. Mixin-output rule-index
  assignment is also behind a slot helper, but lookup still searches owned
  output children. The next slot record must carry those facts before deleting
  a real generated `Rules` wrapper responsibility; source child segments alone
  are diagnostic/order metadata.
- Mixin-output slots now also carry a snapshot of placement output children
  and expose `getMixinOutputPlacementChildren(...)`. This is intentionally
  record state beside the owned wrapper, not a replacement search surface:
  lookup/render still use the owned output children. Rule index assignment now
  reads through `getMixinOutputRuleIndex(...)`, so source-order indexes are a
  slot-owned fact instead of a raw child-index convention.
- Mixin-output slots also record the output scope frame via
  `getMixinOutputScopeFrame(...)`, and source-child collection now walks the
  slot's placement-child snapshot instead of the live wrapper value array.
  This keeps moving wrapper facts into the slot record while preserving the
  invariant that owned output children remain the render/lookup surface.
- Derived mixin `Rules` surface construction is now a top-level helper family
  instead of a local function inside the long mixin-eval body. Empty output,
  outer wrapper, and mixin-output wrapper call sites still create the same
  surfaces, but the ownership boundary is named and ready for the next
  reduction attempt.
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
- Import placement now has focused nested source-free scalar proof: the nested
  ruleset/declaration placement remains owned so first-use eval cannot adopt
  canonical source nodes, while source-free scalar leaves stay canonical.
  The first-use placement wrapper now has an `ImportPlacementState` record that
  maps owned placement children back to canonical source children across eval
  replacement surfaces. Cache-hit reference imports also have proof that
  per-import visibility and `referenceMode` stay on the import placement
  wrapper instead of mutating the cached source rules.
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
- Unguarded static nil-selector source streaming is now locked for declaration,
  comment, invisible variable, and nil child bodies. Nested rulesets, guarded
  nil selectors, and registration-sensitive bodies remain on owned-body paths.
- Dynamic nil-selector bodies remain an owned-body boundary. A focused proof
  covers variable lookup inside a nil-selector body: output is correct, source
  body render is not called, and canonical body parentage is preserved.
- Callable `Rules` construction is split into named unlocked and owned helper
  paths, and those helpers now live outside the long mixin-eval body.
  Detached/static callable rules can still use the unlocked wrapper;
  ruleset-as-mixin and dynamic callable rules use the owned child-placement
  path because child parentage and lookup indexes remain semantic.
- `Dimension.operate(...)` and `Color.operate(...)` now share
  `finalizeOperationResult(...)` for public operation-result inheritance. The
  helper is deliberately metadata-only: it does not reduce constructor count,
  but it makes future operation result narrowing one boundary instead of two
  local ad hoc patterns.
- Metadata `rawArgs` remains an owned mutable `List` API boundary, but
  source-free scalar leaves inside copied metadata args are still reusable.
  The focused proof now covers the owned sequence surface and scalar-leaf reuse
  in the same metadata JS call.
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
- Queue items must stay backlog-driven and surface-sized. A pass may choose a
  whole helper family, node family, or eval/render surface; if only a tiny
  slice is safe, document the broader inventory and the semantic blocker that
  prevented the family-wide change. Do not refill the queue with passive audit
  chores. Each new item must chip away at one backlog lane by attempting a
  concrete code reduction, adding a focused blocker proof that narrows the
  lane, or splitting a broad lane into the next implementation-sized state
  record/prototype.
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
| Generated selector/output ownership | Extend, `:is(...)`, pseudo args, framed ampersands, selector collapse, and ruleset headers still create owned placement surfaces in focused cases; ruleset header composition has one shared cache/compose path. | Keep unless new parentage/visibility/output tests prove a specific placement is carrier-only.                                             |
| Mutation helpers                    | `inherit(...)`, `set(...)`, `derive*`, and shallow wrappers still exist as local ownership tools.                                                                                     | Remove or narrow helper use where a side-state record or direct render output can carry the same semantics without mutating source nodes. |

## Node-Creation Hotspots

Run `pnpm run audit:node-creation` before and after a node-creation reduction
checkpoint. The script ranks likely runtime surfaces; it is not a gate.

Current top files by static surface count:

1. `packages/core/src/tree/rules.ts`
2. `packages/core/src/tree/import-style.ts`
3. `packages/core/src/tree/at-rule.ts`
4. `packages/core/src/tree/dimension.ts`
5. `packages/core/src/tree/declaration.ts`
6. `packages/core/src/tree/reference.ts`
7. `packages/core/src/tree/ruleset.ts`
8. `packages/core/src/tree/call.ts`
9. `packages/core/src/tree/ampersand.ts`
10. `packages/core/src/tree/mixin.ts`
11. `packages/core/src/tree/control.ts`
12. `packages/core/src/tree/sequence.ts`

Current top surface kinds: `new` node construction, `with*` output surfaces,
`derive*` / `.derive(...)` surfaces, and `copyWithReusableLeaves(...)`.
Latest audit: `new-node: 293`, `derive: 30`, `with-surface: 41`,
`copy-leaves: 30`, `clone-leaves: 0`, module-context count `394`,
eval-context count `0`, prepare-registration count `0`, resolve-context count
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
- Optional JS failure fallback render now emits non-metadata fallback call
  syntax as text. Public `resolve(...)` still owns the fallback `Call`, and
  metadata rawArgs/callback failure remains owned.
- Dynamic reference fallback container render now skips the pre-copy of the
  source `List`/`Sequence` and no longer materializes a replacement container
  just to serialize changed children. Public fallback resolve remains owned.
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
  public reference metadata. Focused fallback, declaration-reference,
  direct-index, and runtime-binding proofs cover source-backed containers
  during render only. Dynamic fallback render skips source pre-copy and streams
  changed children through native container syntax. Rules-like, default-guard,
  and public resolve containers still own result surfaces.
- Plain static rules-body direct-render detection is now shared between
  `Rules.render(...)` and `AtRule.render(...)`, so comments, nil children,
  ordinary static declarations, and static invisible variable declarations have
  one safety rule. Root-only static body at-rules also use that path when hoist
  facts are side state. Public at-rule resolve visibility is proven to stay on
  the owned result for dynamic empty/effect-only bodies while source visibility
  and body parentage stay canonical.
- Dynamic `List.render(...)` and `Sequence.render(...)` now stream resolved
  child arrays through native container syntax instead of materializing
  replacement containers. Public `resolve(...)` still owns result containers.
  Bool helper allocations are intentionally kept at public-result boundaries:
  guard/default render is text-only, but `paren(default()).resolve(...)` and
  `cast(boolean)` return fresh mutable `Bool` nodes.
- Dynamic `Paren.render(...)` now wraps evaluated child output directly instead
  of materializing a replacement `Paren`. Dynamic `Operation.render(...)`
  streams evaluated operands directly when math must remain operation syntax.
  Public `resolve(...)` still owns those result surfaces, and arithmetic that
  produces a real numeric/dimension value still creates that value.
- Dynamic `Url.render(...)`, `Block.render(...)`, and `Quoted.render(...)` now
  split wrapper syntax from public result ownership: render resolves the child
  value and writes local wrapper syntax without calling the private
  `withValue(...)` materializer, while public `resolve(...)` still returns an
  owned result where needed. `Interpolated.render(...)` now resolves
  replacements and writes scalar replacement text directly without creating
  the public generic `Any` result. Focused tests cover flat buffers, source
  parentage, and the no-materializer render proofs.
- `Negative.render(...)` now renders simple resolved dimensions by writing the
  negated scalar syntax directly instead of creating an operated result node.
  Compound dimension and non-dimension negatives still fall back to the public
  operation path.
- `Expression.render(...)` now delegates list/sequence children to their child
  render surfaces directly, so those containers do not go through the
  expression eval wrapper just to print resolved output. Scalar/async
  expression children still use the public eval result. `QueryCondition.render(...)`
  now owns its resolved query syntax instead of inheriting the generic
  `Sequence.render(...)` path.
- `JsExpression.render(...)` now writes primitive JS results directly for
  render-only output instead of casting them to public wrapper nodes. Public
  `evalNode(...)`/`resolve(...)` still cast results for API compatibility, and
  non-primitive render results still fall back through public node rendering.
- `Extend.render(...)` and `ExtendList.render(...)` now run their invisible
  side effects without calling public `evalNode(...)`. Public `Extend.evalNode(...)`
  still returns a `Nil` result and public `ExtendList.evalNode(...)` still
  returns the container surface.
- `Condition.render(...)`, `Collection.render(...)`, and `RawRules.render(...)`
  were audited and kept on their current direct/grouped render paths. Compound
  `Negative.render(...)` preserve-mode units are now documented by focused
  proof as a durable public operation boundary.
- Broader `JsExpression.render(...)` proof now covers number, boolean,
  null/undefined, async primitive, and non-primitive fallback results.
  `Log.render(...)` now runs invisible diagnostic side effects directly
  without public `evalNode(...)`, matching the extend render split. Public
  invisible-effect APIs still return fresh `Nil` nodes through the shared
  `createPublicNil(...)` helper.
- `Reference.render(...)` can render the proven dynamic `JsExpression`
  fallback scalar path text-only without copying or evaluating the fallback as
  a public result node. Dynamic containers and rules-like references remain
  public ownership boundaries.
- Parser-to-core ampersand prefix/mid-template fixtures now lock the current
  parsed Less behavior under collapse mode. Color operation and metadata
  `callWithContext(...)` microbenchmarks exist as smaller probes before API or
  operation-allocation changes.
- Ampersand parentless/invisible public eval results now use
  `createPublicNil(...)`, reducing remaining eval-context allocation sites.
  Parsed default-guard mixin output now has focused proof that guard render
  does not stringify public `Bool` output. JS object expression results are
  intentionally kept on the public `JsObject` wrapper render path.
- Generated selector metadata, rules-like reference placement, first-use import
  placement, `AtRule`/`Declaration` adapter inheritance, remaining
  `.withValue(...)` surfaces, broader dynamic fallback leaves, and
  `Dimension.operate(...)` finalizers were re-audited in this pass and kept as
  real public result or placement boundaries until narrower state exists.
- Default guard public `Bool` creation now uses `createPublicBool(...)`, keeping
  fresh mutable public results while removing the direct `DefaultGuard.evalNode`
  allocation site. Parsed negated `default()` mixin output now has focused proof
  for the non-default suppression path without stringifying public `Bool`
  output.
- Generated pseudo omission state now lives as declared placement state on the
  produced pseudo node instead of an external `WeakMap` override. `AtRule`
  derived-result metadata now goes through one explicit finalizer, and
  `Dimension.operate(...)` result inheritance now goes through a shared
  public-result finalizer. These are boundary-clarity changes, not semantic
  rewrites.
- `Condition`, `Paren(default())`, and boolean primitive `cast(...)` public
  results now use `createPublicBool(...)`, leaving the helper as the only
  direct `Bool` constructor site under `packages/core/src/tree`. Parsed
  ambiguous `default()` guard pairs now have focused proof for the required
  public matching error.
- Generated pseudo placement omission state now survives `clone(...)`, closing
  the first follow-up gap from making that state explicit. `Declaration`
  public result adapters now use an explicit metadata finalizer, matching the
  `AtRule` shape, and the dimension-to-color bridge is isolated in a named
  public-result helper.
- `Any` custom-property fragments remain source/static render output; focused
  proof covers direct render without result inheritance. `Dimension.operate(...)`
  still needs public node results for arithmetic source metadata and preserve
  mode compound units. Color, rules-like reference, first-use import,
  generated selector, ampersand prefix/mid-template, `AtRule`/`Declaration`
  adapter inheritance, fallback reference, and metadata rawArgs surfaces were
  audited in this pass and kept as real boundaries.
- Ruleset failed-guard public eval output and selector empty-collapse eval
  output now create inherited `Nil` results through `createPublicNil(...)`.
  This keeps the fresh public result and guard cleanup surfaces while removing
  direct `Nil` constructor sites from those eval paths.
- The remaining eval-context allocation list is now ten sites: ampersand
  selector-list/append/suffix placement, call `!important` output, control and
  import error construction, selector `withComponents(...)` surfaces,
  selector-list flattening, and generated pseudo placement. These are
  currently public output, error, or selector-placement boundaries.
- Parsed `default()` ambiguity is covered by focused less-parser guard
  fixtures plus the changed Less compatibility baseline; no broader fixture
  was added in this pass. Generated pseudo placement clone state, rules-like
  reference placement, first-use import placement, declaration finalizers,
  remaining materializers, dynamic fallback scalar frontier, color ops, and
  rawArgs were re-audited and kept on their existing boundaries.
- Ampersand append/template eval now routes selector-list template output,
  generated suffix ampersands, append errors, and parentless public `Nil`
  results through named helpers. `Call.makeImportant(...)` creates its
  contextual `!important` flag through a public-result helper, and generated
  pseudo eval output uses a named placement constructor. These are explicit
  ownership boundaries, not text-only rewrites.
- The remaining eval-context allocation list is now five sites: two error
  constructors (`$while` overflow and missing import source getter) plus three
  selector placement surfaces (`ComplexSelector.withComponents(...)`,
  `CompoundSelector.withComponents(...)`, and
  `SelectorList.withSelectors(...)`). Those selector surfaces still own
  reordered/flattened output to preserve child parentage, selector-bit
  libraries, and generated `:is(...)` semantics.
- Rules-like reference placement, first-use import placement, declaration
  metadata finalization, `.withValue(...)` / `withResolvedValue(...)` public
  result families, dynamic fallback scalar expansion, color-operation probes,
  and metadata rawArgs were audited in this pass and kept on their existing
  boundaries. No import/color/rawArgs microbenchmark was repeated because no
  corresponding semantic path changed.
- Selector eval placement constructors now run through named finalizers:
  `ComplexSelector.createEvaluatedComponentSurface(...)`,
  `CompoundSelector.createEvaluatedComponentSurface(...)`, and
  `SelectorList.createEvaluatedSelectorListSurface(...)`. Loop/import error
  construction also moved behind small throwing helpers. The eval,
  prepare-registration, and resolve allocation frontier is now zero in the
  static audit; remaining counted construction is module-context ownership.
- Declaration metadata finalizers, public `List`/`Sequence`/`Paren` and wrapper
  `.withValue(...)` families, rules-like reference placement, first-use import
  placement, import timing, color-operation probes, and rawArgs probes were
  audited again in this pass and left as current boundaries unless a focused
  semantic change lands beside them.
- `Rules` module-context construction, first-use import placement,
  rules-like reference placement, declaration adapters, public
  `List`/`Sequence`/`Paren`/wrapper materializers, at-rule body state,
  dimension/color operation result surfaces, call dynamic/rawArgs state, and
  ampersand append/template placement were re-audited as a full queue pass.
  Existing focused tests intentionally guard these surfaces as current
  ownership or public-result boundaries. No import/color/rawArgs microbenchmark
  was repeated because no corresponding semantic path changed, and no code was
  changed solely to hide static audit categories.
- Mixin-output wrappers, `Rules.derive(...)`, first-use import placement,
  compose cache-hit wrappers, direct nested rules-like references, fallback
  reference containers, declaration assignment inputs, contextual important,
  at-rule body records, ruleset dynamic body isolation, dimension preserve
  mode, color finalization, metadata rawArgs, ampersand prefix/mid-template
  output, and import-reference timing were audited as a full queue pass. The
  closest safe rawArgs experiment is already true for source-free scalar leaves:
  the owned metadata list remains, but childless scalar leaves are not cloned.
  No production code changed because the reducible-looking surfaces are still
  carrying parentage, lookup, visibility, raw mutable API, or public-result
  facts.
- Mixin-output slot lookup state, callable `Rules` placement helpers, first-use
  import/comment placement, import postlude and compose wrappers, rules-like
  reference direct render, direct-index predicates, declaration merge and
  contextual-important adapters, at-rule body registration records,
  nil-selector ruleset render, color operation finalizers, rawArgs, and color
  measurement triggers were audited as a full queue pass. No production code
  changed: the slot already owns the lookup-only policy and source/order maps,
  `createCallableRulesSurface(...)` is still a single helper because its
  current branches are semantic ownership choices, first-use imports still need
  owned children before eval, compose/postlude wrappers carry option/output
  families, and the measurement-only items had no adjacent semantic change.
- The backlog-driven queue now has two production movements and two focused
  blocker proofs. Unguarded static nil-selector rulesets stream their body
  directly from source `Rules.render(...)`, preserving output parity with a
  tiny newline adapter instead of copying/evaling an owned body. Generated
  mixin-output fallback frames are now explicit `MixinOutputSlot` facts before
  being applied to the output scope frame. `Rules.derive(...)` now has focused
  proof that empty scope frames are dropped while fallback frames survive, and
  first-use source-free scalar declaration imports now have a dedicated proof
  that placement-owned declaration children are still required while scalar
  leaves can stay canonical.

## Recent Pass History

Keep this table short. Add the newest row at the top. `#1` is the latest pass.
Move old detail to git history or a dedicated perf log if we need a deeper
trend.

| # | Focus | Main result |
| --- | --- | --- |
| 1 | Full 15 queue pass: slot/import/reference placement records | `MixinOutputSlot` now owns generated-output `referenceMode` state and lookup visibility survives detached wrapper options; first-use import placement has a source-child mapping record that survives eval replacement surfaces; rules-like reference surfaces now carry explicit preservation metadata. Empty mixin output, import option/postlude state, public direct-index resolve, declaration adapters, at-rule cleanup, rawArgs, and generated selector state remain queued as concrete backlog lanes. Static `new-node` is 296 because the new `Map`/`WeakMap` state carriers are counted by the audit. |
| 2 | Full 15 queue pass: slot visibility, derived surface extraction, import placement proofs | `MixinOutputSlot` now owns visibility state through `getMixinOutputRulesVisibility(...)`; derived mixin `Rules` surface construction moved to a top-level helper family; nested source-free scalar import placement and cache-hit reference visibility are locked by focused proofs. Rules-like references, public direct-index resolve, declaration adapters, at-rule cleanup, rawArgs, and generated selectors remain real queued boundaries. Static `new-node` stayed 293. |
| 3 | Full 15 queue pass: slot scope state, callable extraction, nil/rawArgs blockers | `MixinOutputSlot` now owns output scope-frame state and source-child collection reads the placement-child snapshot; callable `Rules` unlocked/owned helpers moved out of the long mixin-eval body; dynamic nil-selector bodies and metadata `rawArgs` have focused blocker proofs while preserving scalar-leaf reuse. Import placement, rules-like references, declaration adapters, at-rule cleanup, and generated-selector lanes remain queued as focused prototypes. Static `new-node` stayed 293. |
| 4 | Full 15 queue pass: slot placement state, callable split, nil-selector proof, and operation finalizer | `MixinOutputSlot` now owns placement-child snapshots and rule-index lookup helpers while keeping output children as the lookup/render surface; callable `Rules` construction is split into named unlocked/owned helpers; static nil-selector comment/invisible-var/nil bodies are locked on source streaming; dimension/color operation results share `finalizeOperationResult(...)`. Import placement, rules-like reference, direct-index public resolve, declaration adapter, at-rule cleanup, rawArgs, and generated-selector lanes remain queued as focused prototypes. Static `new-node` stayed 293. |
| 5 | Full 15 queue pass: backlog-driven placement/state prototypes | Unguarded static nil-selector bodies now stream directly from source without owned body eval; mixin-output fallback frames are slot-owned facts; `Rules.derive(...)` empty-frame/fallback-frame behavior and first-use source-free scalar import placement are locked by focused proofs. Import postlude/cache-hit, rules-like reference, direct-index public resolve, declaration merge/important, at-rule cleanup, color finalizer, and rawArgs items remain backlog lanes with sharper next prototypes. Static `new-node` stayed 293. |
| 6 | Full 15 queue pass: slot/import/reference boundary audit | Mixin-output lookup records, callable `Rules` surfaces, first-use import/comment placement, import postlude, compose wrappers, rules-like references, direct-index predicates, declaration merge/contextual-important paths, at-rule records, nil-selector rulesets, color finalizers, rawArgs, and measurement triggers were audited. Existing slot/import/reference/declaration/at-rule/ruleset tests prove the current boundaries; no semantic code change or measurement rerun was warranted. Static `new-node` stayed 293. |
| 7 | Full 15 queue pass: placement-record blockers and rawArgs audit | Mixin output, `Rules.derive(...)`, first-use import, compose cache-hit, rules-like reference, declaration assignment, contextual important, at-rule/ruleset body, dimension/color operation, rawArgs, ampersand template, and import timing items were audited. Existing focused tests prove the current blockers; source-free scalar rawArgs already avoid leaf clones while preserving the owned mutable list. Static `new-node` stayed 293. |
| 8 | Full 15 queue pass: module-context boundary audit | `Rules`, import placement, rules-like references, declaration adapters, public materializers, at-rule body state, dimension/color operations, call dynamic/rawArgs state, and ampersand placement were audited and kept as current ownership/public-result boundaries. Focused surface tests and full changed baseline passed; static `new-node` stayed 293 with zero eval/prepare/resolve contexts. |
| 9 | Full 15 queue pass: eval/prepare allocation frontier closure | Complex, compound, and selector-list eval result surfaces now route through named selector finalizers, while loop/import error construction is helper-owned. The eval, prepare-registration, and resolve allocation frontier is zero; declaration finalizers, public materializers, rules-like references, first-use imports, import timing, color probes, and rawArgs probes were audited and kept. Static `new-node` dropped to 293. |
| 10 | Full 15 queue pass: ampersand/pseudo/call helper ownership | Ampersand selector-list template output, generated suffix ampersands, append errors, and parentless Nil outputs now route through named helper/finalizer boundaries; contextual call `!important` and generated pseudo eval output do the same. Rules-like references, first-use imports, selector `with*` placement, declaration finalizers, materializers, dynamic fallback, color, and rawArgs were audited and kept. Static `new-node` stayed 294 while eval contexts dropped to 5. |

## Metrics Snapshot

Static audit is useful for regression detection, not proof of speed. Hot-path
timing rows are descriptive samples, not verdicts. Do not call a change faster
or slower from one row, especially when relative standard deviation is high;
look for repeated adjacent runs with the same direction before treating a
performance change as real.

Latest static audit:

| `new-node` | `derive` | `with-surface` | `copy-leaves` | `clone-leaves` | module | eval | prepare | resolve |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 296 | 30 | 41 | 30 | 0 | 397 | 0 | 0 | 0 |

Recent hot-path medians. `#1` is the latest pass.

| # | Pass | `functions` | `import-ref` | `mixins-guards` | `extend` | `media` | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Full 15 queue pass: slot/import/reference placement records | 22.28ms | 27.41ms | 32.93ms | 16.31ms | 7.49ms | includes slot reference-mode state, import placement source mapping, and rules-like preservation metadata; RSD 14.0%-26.5%, so no speed claim |
| 2 | Full 15 queue pass: slot visibility, derived surface extraction, import placement proofs | 68.48ms | 111.36ms | 40.41ms | 16.91ms | 8.21ms | plugin build ran immediately before measurement and rows were very noisy, especially `functions`/`import-ref`; RSD 12.1%-51.1%, so no speed claim |
| 3 | Full 15 queue pass: slot scope state, callable extraction, nil/rawArgs blockers | 22.01ms | 28.81ms | 31.62ms | 15.62ms | 7.39ms | includes slot scope-frame state, callable helper extraction, dynamic nil-selector blocker proof, and rawArgs scalar-reuse proof; RSD 8.6%-19.0%, so no speed claim |
| 4 | Full 15 queue pass: slot placement state, callable split, nil-selector proof, and operation finalizer | 21.53ms | 30.25ms | 33.38ms | 15.96ms | 7.92ms | includes slot placement-child/rule-index state, callable helper split, static nil-selector comment/invisible-var proof, and shared operation finalizer; RSD 8.4%-19.9%, so no speed claim |
| 5 | Full 15 queue pass: backlog-driven placement/state prototypes | 21.89ms | 29.74ms | 32.55ms | 15.41ms | 8.06ms | includes nil-selector direct source streaming and slot-owned fallback metadata; `functions` RSD 23.3% and `media` RSD 26.7%, so no speed claim |
| 6 | Full 15 queue pass: slot/import/reference boundary audit | 20.36ms | 26.53ms | 32.24ms | 16.11ms | 7.87ms | read-only row after auditing current slot/import/reference/declaration/at-rule boundaries with no production semantic change; `mixins-guards` RSD was 53.6% and other rows stayed noisy, so no speed claim |
| 7 | Full 15 queue pass: placement-record blockers and rawArgs audit | 20.12ms | 28.09ms | 31.00ms | 16.63ms | 8.05ms | read-only row after auditing placement-record blockers and rawArgs scalar reuse with no code semantic change; `extend` had 92.8% RSD and other rows stayed noisy, so no speed claim |
| 8 | Full 15 queue pass: module-context boundary audit | 21.69ms | 28.27ms | 31.23ms | 18.19ms | 7.91ms | read-only row after auditing current module-context boundaries with no code semantic change; RSD stayed 12.8%-31.6%, so no speed claim |
| 9 | Full 15 queue pass: eval/prepare allocation frontier closure | 22.32ms | 29.56ms | 31.91ms | 15.92ms | 7.35ms | read-only row after moving selector placement and loop/import error construction out of eval/prepare contexts; RSD stayed 8.9%-16.9%, so no speed claim |
| 10 | Full 15 queue pass: ampersand/pseudo/call helper ownership | 20.65ms | 25.30ms | 30.29ms | 17.80ms | 6.82ms | read-only row after helper-owned ampersand, call important, and generated pseudo placement constructors; `mixins-guards` RSD was 22.2% and `functions`/`import-ref`/`media` stayed high, so no speed claim |

Targeted timing notes from prior adjacent benchmark passes:

- Import-reference focused repeat: 26.46ms median over 90 iterations, with
  19.5% RSD; keep treating import timing as noisy until repeated beside an
  import-facing change.
- Color fixtures: `operations` 1.11ms median, `comprehensive` 2.65ms,
  `basic` 1.11ms with high RSD on all rows; do not use this as a color
  allocation verdict.
- Metadata/plugin-heavy fixtures: `plugin` 6.00ms median,
  `plugin-preeval` 1.13ms, `functions` 19.87ms with very high RSD on the
  plugin rows; rawArgs ownership remains an API-boundary question, not a
  measured hot spot yet.
- `callWithContext(...)` rawArgs microbenchmark:
  latest adjacent repeat was `plain positional` 0.0003ms median and
  `metadata rawArgs` 0.0022ms median over 750 iterations. This isolates
  API-boundary overhead better than plugin-heavy
  fixtures, but it is still a microbenchmark rather than a stylesheet verdict.
- `Color.operate(...)` microbenchmark: latest adjacent repeat was dimension
  add 0.0006ms median and color add 0.0006ms median over 1500 iterations. Use
  this script for adjacent color operation changes instead of the noisier full
  color fixture group.

Measurement commands:

- `pnpm run measure:less:hotpath` is read-only. It uses 30 measured iterations,
  3 warmups, and prints median/mean/p75/p90/min/max plus relative standard
  deviation.
- `pnpm run measure:less:hotpath:record -- --note "short reason"` appends
  structured fixture records to
  `docs/future/node-copy-reduction/less-hotpath-history.jsonl` and compares the
  current run against the latest saved record for each fixture.
- `node scripts/measure-callwithcontext-rawargs.mjs [iterations]` isolates
  plain positional versus metadata/rawArgs `callWithContext(...)` overhead.
- `node scripts/measure-color-operation.mjs [iterations]` isolates
  `Color.operate(...)` dimension and color operations.
- Use `--json` or `--jsonl` for scripts, `--compare <file>` for an explicit
  baseline file, and `--threshold 0.08` to control the noise band. Keep this
  handoff as the readable summary, not the metrics database.

## Durable Blockers

- Body at-rule render cannot simply eval the source at-rule because body
  registration prep can mutate the body `Rules` surface and extend/layer
  registration keys.
- First-use plain imports cannot simply use a shallow wrapper around canonical
  source children. `Rules.eval(...)` can adopt/evaluate those children and
  mutate source parentage, so import-local child ownership remains required
  until an explicit placement record carries the needed parent/runtime facts.
- Ruleset-as-mixin child copies protect complex parent ampersands and nested
  array-path ruleset mixin calls until a smaller placement state carries that
  selector-parent context.
- Reference render still shares public result ownership for dynamic
  containers, public `resolve(...)`, and rules-like values. Static
  fallback/declaration/direct/runtime-binding list and sequence containers can
  render text-only when their children are reusable leaves, including the
  focused source-backed fallback, declaration-reference, runtime-binding, and
  direct-index cases. The only dynamic fallback scalar text-only case is the
  focused `JsExpression` fallback proof; do not extend that to other dynamic
  leaves or any rules-like containers without ownership proof.
- Ampersand append/template output remains generated selector output, not just
  carrier metadata. The current placement state carries source/parent/output
  selector, append/template parts, hoist/root placement facts,
  selector-bit/library facts, and final result text. Replacement selectors/text
  are local merge facts, and suffix templates now preserve structure through
  `appendSelector(...)`; prefix/mid-template forms still flatten by text until
  focused proof says a structured model is correct. Parsed collapse-mode
  prefix/mid-template output intentionally stays on the current parser-to-core
  semantics while hand-built core fixtures cover distribution behavior. It must
  not grow into a parallel selector AST.
- Empty rest / `@arguments` binding placeholders preserve current Less
  behavior. Do not delete them unless the behavior is explicitly changed.

## Immediate Queue

This is a pop queue. Keep at least fifteen concrete items here. A normal
handoff round should complete all fifteen queued items unless the user
explicitly asks for a smaller slice. When an item is completed, remove it and
add or promote enough work to leave the queue full for the next round. If an
item is too broad, replace it with the smallest honest next checkpoint and move
the broader theme to the backlog. A full queue run is not finished until the
code/docs changes are verified, committed, and pushed to the current branch.

Queue items must be surface-sized, not line-sized. Prefer a whole node family,
helper family, or eval/render surface with inventory, implementation, focused
proof, audit delta, and documented blockers. Only split smaller after the
inventory proves a real semantic blocker; do not create timid items like
"delete one helper call" when a whole `.set()` / `inherit()` / `derive*`
family can be audited and reduced.

When refilling this queue, pull directly from the Backlog lanes below. A good
queue item names:

- the backlog lane it advances;
- the concrete production surface or test fixture it will touch;
- the expected result if the idea works (deleted wrapper, narrower state
  record, fewer module-context constructors, or faster measured eval/render);
- the blocker proof to add if the idea fails.

Avoid items whose only deliverable is "audit and document" unless they are the
first inventory step for a still-unknown backlog lane. At this point, most
lanes are known enough that the next item should be a prototype or reduction
attempt with focused tests.

1. **Mixin output slots: route one targeted callable lookup through slot state.**

   Backlog lane: mixin output slots. Slot helpers now own visibility and
   `referenceMode` facts even when wrapper options are detached. Try routing
   one real targeted callable lookup through the slot's visibility/reference
   helpers while still searching owned output children. Failure should prove
   the remaining scope/frame dependency that keeps lookup on the wrapper.

2. **Mixin output slots: prototype no-param placement child state.**

   Backlog lane: mixin output slots. Start with a no-param/no-guard mixin body
   that emits one declaration or nested ruleset. Try carrying evaluated
   placement-child metadata in the slot before final wrapper adoption. Failure
   should identify which rule index, parent, or frame fact still exists only on
   the owned output child.

3. **Mutation helpers: reduce empty mixin output surface construction.**

   Backlog lane: mutation-helper reduction. Derived mixin surface creation is
   top-level now; try replacing the empty-output `Rules` surface with a
   smaller helper/result record. Success deletes one `derive(...)` use; failure
   records the inherited source/options/scope fact that still requires a Rules
   wrapper.

4. **Mutation helpers: align import `deriveRulesSurface(...)` with the shared helper family.**

   Backlog lane: mutation-helper reduction. Import placement has its own
   derived-surface helper. Extract or align it with the named Rules-surface
   helper family only if source location, function registry, scope reset, and
   source-node preservation semantics stay covered by focused tests.

5. **Import placement: extend source mapping to nested placement children.**

   Backlog lane: import placement state. The first-use wrapper maps top-level
   owned placement children back to canonical source children. Try extending
   that record to one nested declaration child, without replacing the owned
   nested placement. Failure should prove which nested eval/adoption fact still
   needs the wrapper tree.

6. **Import placement: move cache-hit reference visibility into explicit state.**

   Backlog lane: import placement state. Cache-hit reference visibility is
   isolated from cached source rules. Try storing the per-import
   `referenceMode`/visibility facts on placement state before applying wrapper
   options. Failure should prove which render/lookup consumer still requires
   wrapper options as the source of truth.

7. **Import placement: split nested postlude wrapper ordering into state.**

   Backlog lane: import placement state. Existing postlude proofs cover inline
   and evaluated import wrappers. Move one `@media` or `@layer` postlude order
   fact into placement state while preserving wrapper order, source parentage,
   and CSS output.

8. **Rules-like references: route one callable lookup fact through preservation state.**

   Backlog lane: rules-like/reference result state. Source metadata now has an
   explicit preservation record beside the shallow owned surface. Try moving
   one callable lookup/source lookup consumer to that record instead of reading
   `sourceNode` directly. Failure should add the focused callable lookup proof.

9. **Reference ownership: retry public direct-index source-free container narrowing.**

   Backlog lane: rules-like/reference result state. Public direct-index
   resolve remains owned for containers. Try a frozen inert source-free
   `List`/`Sequence` result only for reusable leaves; if mutability or parent
   expectations break, add the focused blocker proof.

10. **Declaration state: prototype list-merge coalescing adapter state.**

   Backlog lane: declaration/operation result state. Start with nested
   `&,:`/`+_:` merge output. Move source order, placeholder cleanup, or
   separator choice into a small adapter record before mutating the declaration
   output. Failure should prove which part still depends on mutation.

11. **Declaration state: extract contextual-important finalizer helper.**

   Backlog lane: declaration/operation result state. Contextual important
   render already avoids materializing a flag node. Extract the public/render
   finalization boundary so source-free scalar important output and owned
   public results are explicit separate paths.

12. **At-rule body state: split async cleanup from `AtRuleBodyEvalRecord` restoration.**

   Backlog lane: at-rule and ruleset body state. Frame, extend-root, and
   ruleset restoration are record-owned. Try isolating async rejection cleanup
   as a record cleanup marker. Failure should add a focused async proof.

13. **Ruleset body state: prototype one dynamic nil-selector scalar side-state.**

   Backlog lane: at-rule and ruleset body state. Variable-backed nil selectors
   are an owned-body blocker. Try a smaller dynamic scalar shape, such as
   operation output that does not require declaration lookup, and either carry
   it as side state or lock the exact owned-body requirement.

14. **Dynamic call state: introduce rawArgs placement metadata beside the owned List.**

   Backlog lane: dynamic call state. Preserve mutable `this.rawArgs`. Add the
   smallest placement/source bookkeeping record beside the owned List while
   keeping scalar leaf reuse and failure isolation intact.

15. **Generated selector state: move one generated `:is()` omission fact into declared state.**

   Backlog lane: generated selector state. Generated pseudo placement already
   has clone/output proofs. Move one omission or keyset fact into declared
   state only with parentage, visibility, extend metadata, and output proof.


## Backlog

This backlog is not a someday list. It is the source of future queue items.
When the immediate queue is refilled, pull from these lanes and name the lane
in the queue item. Every lane should keep producing implementation-sized
prototypes until it is either complete or blocked by a focused proof.

- **Mutation-helper reduction.** Reduce `inherit(...)`, `set(...)`,
  `derive*`, and shallow wrapper construction in hot eval/render paths. The
  goal is not to ban them as APIs; it is to stop relying on helper-driven
  mutation as the normal eval/render strategy.

  Next queue shapes:
  - reduce one `.derive(...)` family whose children are empty or already
    placement-owned;
  - move one metadata/fallback/scope fact out of a wrapper and into explicit
    state;
  - add a focused blocker proof only when the whole helper family cannot move.

- **Mixin output slots.** Replace generated mixin `Rules` wrappers
  incrementally. The slot must eventually carry source body, evaluated
  placement children, scope frame, visibility/reference gates, rule index, and
  caller fallback.

  Next queue shapes:
  - move one fallback/scope/index fact into `MixinOutputSlot`;
  - prototype one no-param/no-guard placement child state while keeping the
    output wrapper;
  - prove one lookup family can read slot placement state without reading
    canonical source children as live output.

- **Import placement state.** Replace import-local child/wrapper ownership only
  after placement records can preserve source parentage, first-use eval
  adoption, postlude nesting, visibility options, reference/multiple dedupe,
  and cache-hit option differences.

  Next queue shapes:
  - prototype one source-free scalar first-use placement;
  - move one compose cache-hit option family into side state;
  - split postlude order/source-map facts from final `Rules` wrapper ownership.

- **Rules-like/reference result state.** Keep public `resolve(...)` ownership,
  but keep reducing render-only ownership for references, direct-index hits,
  and rules-like values when text or placement state is enough.

  Next queue shapes:
  - prototype render-only placement for variable-held `Rules`;
  - narrow one public direct-index source-free container case if mutability
    allows it;
  - add focused blocker proof for callable lookup/reference-stack cleanup when
    a rules-like wrapper cannot move.

- **At-rule and ruleset body state.** Delete remaining body isolation surfaces
  only after invocation-local records can carry body output, registration,
  root-hoist/frame facts, layer/extend state, nil-selector output, and source
  parentage.

  Next queue shapes:
  - move one registration cleanup/stack marker from eval frame to invocation
    record;
  - expand static direct streaming for one ruleset/nil-selector body family;
  - prove the smallest dynamic body case that still requires owned body rules.

- **Declaration/operation result state.** Keep public result APIs mutable, but
  narrow assignment, merge, contextual-important, dimension/color operation,
  and metadata-finalizer surfaces where render-only state or result adapters
  can carry the same semantics.

  Next queue shapes:
  - move one declaration merge family into adapter state;
  - reduce one source-free contextual-important public output path;
  - narrow duplicated dimension/color finalizer behavior only with focused
    operation tests and adjacent measurement.

- **Dynamic call state.** Replace remaining copied dynamic-call surfaces with a
  state record that preserves evaluated/fallback name, evaluated args/content,
  owned raw args when required, caller pointer, and parent/source safety.

  Next queue shapes:
  - narrow metadata `rawArgs` ownership without weakening mutation isolation;
  - split fallback call content/name state from public result construction;
  - measure rawArgs only beside a production placement change.

- **Generated selector state.** Replace placement-owned selector wrappers only
  when a small side-state record can preserve source parentage, visibility,
  extend metadata, selector-bit library, hoist/root placement, and composed
  header cache without becoming AST v2.

  Next queue shapes:
  - move one generated-pseudo or ampersand placement fact into declared state;
  - reduce one selector `withComponents(...)` / `withSelectors(...)` family;
  - add blocker proof for prefix/mid-template output when structured selector
    state is not correct.

- **Typed node structural frontier.** Continue splitting `tsc --noEmit`
  failures by node-family shape when it directly helps runtime cleanup. Do not
  spend queue slots on typing cleanup unless it unlocks one of the runtime
  lanes above.

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

For a full 15-item queue run, step 6 is mandatory: after verification, create a
coherent commit that includes the production/test/handoff changes for that
queue run and push it to the branch's tracked remote. If the worktree contains
unrelated user changes, either leave them unstaged or stop and record why the
queue-run commit could not be made.

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
