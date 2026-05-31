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
  public result metadata. Dynamic fallback `List`/`Sequence` render can skip
  the pre-copy of the source container and let native container render own only
  the evaluated render output when children change. Public fallback results
  still own source-backed containers; rules-like outputs still own result
  surfaces.
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
  reduction needs an explicit placement record for lookup/callable/source-node
  facts before removing these surfaces.
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
| Generated selector/output ownership | Extend, `:is(...)`, pseudo args, framed ampersands, selector collapse, and ruleset headers still create owned placement surfaces in focused cases; ruleset header composition has one shared cache/compose path. | Keep unless new parentage/visibility/output tests prove a specific placement is carrier-only.                                             |
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
`copy-leaves: 30`, `clone-leaves: 0`, module-context count `384`,
eval-context count `23`, prepare-registration count `2`, resolve-context count
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
  source `List`/`Sequence`. Dynamic child resolution may still create an owned
  render-local output container; public fallback resolve remains owned.
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
  during render only. Dynamic fallback render skips source pre-copy but still
  owns render-local output when children resolve differently. Rules-like,
  default-guard, and public resolve containers still own result surfaces.
- Plain static rules-body direct-render detection is now shared between
  `Rules.render(...)` and `AtRule.render(...)`, so comments, nil children,
  ordinary static declarations, and static invisible variable declarations have
  one safety rule. Root-only static body at-rules also use that path when hoist
  facts are side state. Public at-rule resolve visibility is proven to stay on
  the owned result for dynamic empty/effect-only bodies while source visibility
  and body parentage stay canonical.

## Recent Pass History

Keep this table short. Add the newest row at the top. `#1` is the latest pass.
Move old detail to git history or a dedicated perf log if we need a deeper
trend.

| # | Focus | Main result |
| --- | --- | --- |
| 1 | Full queue pop: centralized ruleset header composition | Serializer frame-stack composition now calls `Ruleset.composeHeaderSelector(...)` instead of carrying a parallel cache/generated-pseudo composition path. Focused proof covers ruleset headers, generated pseudos, nesting collapse, and extend integration; static counts stayed flat. |
| 2 | Full queue pop: structured ampersand template suffix merge | `&-suffix` template merge now uses structured `appendSelector(...)` output where proven, so complex selector-list parents keep selector-bit metadata and source parentage. Template replacement selectors/text no longer live on ampersand placement state. Focused ampersand/at-rule/extend proof stayed green; static counts stayed flat with helper context shifted out of `evalNode`. |
| 3 | Full queue pop: generated pseudo placement override | The queue head was completed and the 15-item queue was refreshed. Generated `:is(...)` wrapper omission now lives in the generated pseudo placement override path instead of a standalone side map. Focused proof covers evaluated selector args, wrapper omission, source parentage, selector-bit metadata, existing nested unknown pseudo output, and generated extend behavior. Static counts stayed flat. |
| 4 | Full queue pop: rules-like reference preservation family | Rules-like reference preservation is centralized in one helper family, with the public/callable surface explicitly separated from list/sequence text-only render containers. Focused reference proof covers render of a rules-like variable reference through a shallow owned surface with zero `Rules.clone()` calls and canonical source parentage. Static counts stayed flat. |
| 5 | Full queue pop: dynamic fallback container render pre-copy | Dynamic reference fallback `List`/`Sequence` render now skips pre-copying the source container and lets native container render own output only when dynamic children resolve differently; public fallback resolve remains owned. Focused reference proof covers a source-backed dynamic fallback list with zero source-list copy calls, canonical source parentage, and one render-local output inherit. Default-guard/declaration suites stayed green. Static counts stayed flat. |
| 6 | Full queue pop: root-only static at-rule body render | Static root-only at-rule bodies can now source-render even when hoist/frame side state exists, so a hoisted `@font-face` with a static declaration body skips the owned `Rules` eval target while source body parentage and source at-rule fields stay canonical. Focused at-rule proof, neighboring ruleset/render-buffer suites, audit, and hot-path measurement stayed green/noisy. Static counts stayed flat because this is a runtime branch reduction. |
| 7 | Full queue pop: optional JS failure fallback render text | Render-only optional JS failure fallback for non-metadata JS functions now returns finalized fallback syntax text instead of deriving a fallback `Call` node; public resolve still owns the fallback `Call`, metadata/rawArgs failure remains owned, and focused proof covers two render passes with zero `deriveCall` plus one public resolve with one owned result. Reference/default-guard focused suites stayed green. Static counts stayed flat. |

## Metrics Snapshot

Static audit is useful for regression detection, not proof of speed. Hot-path
timing rows are descriptive samples, not verdicts. Do not call a change faster
or slower from one row, especially when relative standard deviation is high;
look for repeated adjacent runs with the same direction before treating a
performance change as real.

Latest static audit:

| `new-node` | `derive` | `with-surface` | `copy-leaves` | `clone-leaves` | module | eval | prepare | resolve |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 308 | 30 | 41 | 30 | 0 | 384 | 23 | 2 | 0 |

Recent hot-path medians. `#1` is the latest pass.

| # | Pass | `functions` | `import-ref` | `mixins-guards` | `extend` | `media` | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Full queue pop: centralized ruleset header composition | 22.24ms | 30.16ms | 33.38ms | 19.35ms | 8.00ms | saved row had suspicious slower `extend` versus the prior saved row, but an immediate read-only repeat was 22.21/29.06/34.15/16.94/8.46ms with high `extend`/`media` RSD; keep watching, no speed claim |
| 2 | Full queue pop: structured ampersand template suffix merge | 21.83ms | 28.57ms | 32.30ms | 16.08ms | 8.70ms | pre-change read-only sample was globally noisy/slow at 28.84/32.33/34.68/21.08/15.60ms; saved media is +12.4% vs prior saved row but much lower than pre-change, so keep watching/no speed claim |
| 3 | Full queue pop: generated pseudo placement override | 21.15ms | 28.30ms | 31.41ms | 16.14ms | 7.74ms | pre-change read-only sample was globally noisy and slow at 24.23/31.28/43.07/24.45/12.31ms; saved row returned near the earlier band, so do not claim speed, but the media spike did not repeat |
| 4 | Full queue pop: rules-like reference preservation family | 21.96ms | 28.60ms | 33.08ms | 16.04ms | 9.93ms | pre-change read-only sample was 31.11/30.65/34.40/16.40/9.78ms, so the high media baseline existed before this pass; saved media was +8.7% against prior saved row with 25.0% RSD, suspicious/noisy and worth watching |
| 5 | Full queue pop: dynamic fallback container render pre-copy | 22.32ms | 27.99ms | 32.80ms | 16.08ms | 9.13ms | mixed descriptive sample: `mixins-guards` compared faster and `media` slower while other fixtures were noise; do not claim speed without adjacent repeats |
| 6 | Full queue pop: root-only static at-rule body render | 21.96ms | 29.63ms | 35.81ms | 16.50ms | 8.39ms | saved sample was noise for every fixture; `import-ref` stayed near 30ms instead of repeating the prior 34ms concern, but high RSD keeps this descriptive only |
| 7 | Full queue pop: optional JS failure fallback render text | 21.88ms | 29.88ms | 34.89ms | 16.95ms | 8.66ms | saved sample had high RSD on `import-ref`/`mixins-guards`; `import-ref` no longer repeated the prior 34ms concern in this sample, but treat as descriptive/no speed claim |

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
  focused source-backed fallback, declaration-reference, runtime-binding, and
  direct-index cases. Do not extend that to dynamic or rules-like containers
  without ownership proof.
- Ampersand append/template output remains generated selector output, not just
  carrier metadata. The current placement state carries source/parent/output
  selector, append/template parts, hoist/root placement facts,
  selector-bit/library facts, and final result text. Replacement selectors/text
  are local merge facts, and suffix templates now preserve structure through
  `appendSelector(...)`; prefix/mid-template forms still flatten by text until
  focused proof says a structured model is correct. It must not grow into a
  parallel selector AST.
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

1. **Reduce import-style first-use placement for non-mutating plain imports.**

   Target non-reference, non-multiple, no-`with`, cache-stable imports. Keep
   once/cache/source-map behavior intact and measure because speed decides the
   import surface.

2. **Decide inline import raw text streaming with source-map/postlude proof.**

   Inline imports still allocate `Any(source)`. Replace only if raw text,
   postlude wrapping, and source-map/public output behavior can stream
   directly.

3. **Reduce declaration custom-property interpolation state only.**

   Custom properties must preserve authored raw value text after the colon
   except evaluated interpolation. Target the interpolation path, not raw value
   spacing normalization.

4. **Keep or remove fresh guard/condition `Bool` with public mutability proof.**

   Render is text-only. Public eval/resolve returns fresh `Bool`; only reduce
   this if returned-node mutability, parentage, and source ownership are
   explicitly proven safe.

5. **Reduce public at-rule result allocation only for proven no-op body resolves.**

   Public body `resolve(...)` now allocates its result after body eval. A
   future pass may return the source only for truly no-op dynamic body resolves,
   but must prove public mutability, visibility, prelude/body identity, and
   runtime-state behavior before removing the owned API result.

6. **Reduce remaining at-rule runtime-map writes only at evaluated-node boundaries.**

   Body result finalization no longer reads the runtime map. Inventory runtime
   writes and keep them only where evaluated-node render APIs consume them:
   `getRenderRules()`, `getHeaderString()`, frame/hoist state, scoped render,
   and public evaluated node serialization. Do not remove a write used by those
   APIs just because body direct render no longer needs it.

7. **Recheck static direct-body render performance on import-reference.**

   Static invisible var body render is correct, but the first two hot-path
   samples kept `import-reference.less` around 34ms. Before expanding this
   predicate further, repeat measurement adjacent to the next import/at-rule
   pass and tighten or revert the direct path if the slowdown holds under a
   cleaner baseline.

8. **Reduce optional JS success render output only with single-invocation proof.**

   Failure render no longer owns a fallback `Call` for non-metadata JS. Success
   output still flows through normal node output because returned nodes may
   carry ownership, important, rules-like, or scalar semantics. Reduce only if
   one render path can finalize text without duplicating user-code invocation
   or weakening returned-node semantics.

9. **Shrink non-static at-rule body render below an owned `Rules` eval target.**

   Static root-only declaration/comment bodies now source-render even with
   hoist side state. Remaining at-rule body ownership is dynamic,
   nestable-registration, collapse/hoist with non-plain children, or other
   non-plain body shapes. Reduce only one of those families at a time with
   parentage, visibility, layer/extend registration, output proof, and
   hot-path measurement.

10. **Reduce dynamic declaration/reference containers below render-local output ownership.**

   Dynamic fallback render now skips the source pre-copy, but native
   `List`/`Sequence` render still owns a render-local output container when
   children resolve differently. Reduce only if container rendering can stream
   resolved children without building a replacement container and without
   changing public `resolve(...)`, assignment merges, default guards, or
   rules-like reference semantics.

11. **Reduce rules-like reference surfaces only with placement-state proof.**

   Rules-like reference preservation is centralized but still owns a shallow
   surface. Reduce it only when a placement record can carry lookup/callable
   identity, source-node parentage, visibility, reference-stack cleanup, and
   nested mixin-ruleset behavior without reusing mutable source nodes.

12. **Watch media hot-path drift beside the next runtime change.**

   `media.less` was already high in the pre-change read-only sample and stayed
   high in the saved row. Repeat measurement adjacent to the next selector,
   at-rule, or import runtime change and treat repeated high media medians as a
   real investigation target, not a one-row verdict.

13. **Reduce generated pseudo wrapper only after visibility/extend placement state.**

   Wrapper omission is now placement state, but the generated pseudo wrapper
   still owns parentage, visibility, selector-bit metadata, extend metadata,
   and composed selector text. Do not remove the wrapper until one of those
   facts moves into a small placement record with focused selector, extend,
   and nested pseudo proof.

14. **Reduce remaining ampersand template flattening only with prefix/general-template proof.**

   Structured `&-suffix` templates now keep selector metadata through
   `appendSelector(...)`. Other template shapes still flatten to
   `BasicSelector` text because prefix/mid-template semantics are text-based.
   Reduce only with focused prefix/general-template output, parentage,
   selector-bit, extend, hoist, and raw comma-string proof.

15. **Reduce ruleset header composition ownership only with selector-state proof.**

   Header cache/compose logic now has one shared path, but generated selector
   headers still depend on owned selector output for visibility, extend
   metadata, composed selector text, and parentage. Reduce only after a small
   selector placement-state record can carry those facts without another AST.


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
