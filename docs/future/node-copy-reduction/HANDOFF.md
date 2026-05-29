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
  pairing on invocation context state before public output writes. This is a
  staging step toward deleting the derived body frame, not a new render-state
  model.
- At-rule body eval registration state also owns the nestable-body
  `pushedExtendRoot` fact that final registration consumes. Keep moving
  body-registration facts into invocation-local state before trying to delete
  the remaining derived body frame.
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
  frame-clearing cleanup, layer name, extend-root stack marker, and final
  hoist/root output facts. Render may consume that into
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
  safety. Source-backed or dynamic arg containers still own an eval target when
  preserving source parents.
- Reference fallback values now reuse source-free static `List` containers as
  inert output when every child is already a reusable leaf. Dynamic fallback
  containers, source-backed declaration/variable containers, and rules-like
  outputs still own result surfaces.
- Source-free static fallback, declaration-reference, direct-reference, and
  runtime-binding containers can render as text-only output without applying
  public result metadata. `List` and `Sequence` now have focused text-only
  render proofs for fallback, declaration, and runtime-binding paths.
  Source-backed containers, dynamic containers, public `resolve(...)`, and
  `default()` guard containers still own result surfaces. Direct-reference
  sequence values still need broader shape proof before becoming a general
  text-only target, but direct index targets that resolve to list/sequence
  containers no longer trigger the mixin namespace redirect.
- Direct `index` lookups whose target resolves to a `List` or `Sequence` no
  longer reinterpret that target text as a mixin-ruleset key before lookup.
  They stay on the direct-target path and can fall back normally. This only
  narrows the ambiguous namespace redirect; it does not make lists/sequences
  general property maps.
- Reference render still uses `evalNode(context)` and then native rendering of
  the resolved node for containers, declaration/runtime-binding values, and
  rules-like values. Scalar source-free fallback render now has a text-only
  finalization path that avoids public result metadata; declaration and
  variable lookup scalar leaves now use that same text-only path during render,
  runtime-binding scalar leaves do too, and source-free static runtime-binding
  and direct-reference lists can render as text-only containers. Fallback render and rules-like
  preserve paths now restore reference-stack state. Source-backed containers,
  dynamic containers, rules-like values, and public result APIs still own
  output surfaces.
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
  plus the proven single-selector-list wrapper omission flag for placement
  rendering and must not grow into a selector AST replacement. A queue pass
  found no second proven fact yet; add one only with selector-shape evidence.
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
  child-search. Registry lookup keeps entry visibility, node visibility,
  optional candidates, and mixin-output lookup policy as distinct helper
  concepts; do not collapse them back into one coalesced visibility check.
  Use `canEnterRulesEntryForLookup(...)` for entry traversal decisions, because
  the lookup supplies the type/target policy. Use `canEnterMixinOutputForLookup(...)`
  only for the narrower generated-output ambient/target gate.
- `MixinOutputSlot.childSegments` records the canonical source child and, when
  the ordered output position exists, the owned output child for that
  placement. The slot also carries whether ambient lookup may enter the
  wrapper. Lookup still must not switch to source segments blindly; output
  children are the scope/frame-bearing surface. Slot attachment now owns
  `referenceMode` clearing for generated output wrappers, so wrapper call sites
  should not repeat that option write after `attachMixinOutputSlot(...)`.
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
  behavior. The next slot record must carry those facts before deleting a real
  generated `Rules` wrapper responsibility; source child segments alone are
  diagnostic/order metadata.
- Ruleset-as-mixin child ownership was re-audited against complex parent
  ampersands and nested array-path lookups. Source-free scalar leaves are
  already reused, but output children for ruleset-as-mixin calls still need
  ownership because collapse/nesting and lookup depend on placement parentage,
  hoist/root output, indexes, and scope state. A future reduction needs a
  placement record for one proven path, not another direct source-child search.
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
`copy-leaves: 29`, `clone-leaves: 0`, module-context count `379`,
eval-context count `27`, prepare-registration count `2`, resolve-context count
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
  inert output for reference resolve/render. Source-backed, dynamic,
  rules-like, and default-guard containers still own result surfaces.

## Recent Pass History

Keep this table short. Add the newest row at the top. `#1` is the latest pass.
Move old detail to git history or a dedicated perf log if we need a deeper
trend.

| # | Focus | Main result |
| --- | --- | --- |
| 1 | Direct-target guard / slot fact / state naming | Direct index targets that resolve to `List`/`Sequence` no longer redirect through mixin namespace lookup; mixin-output `referenceMode` clearing moved into `attachMixinOutputSlot(...)`; at-rule eval-state naming now reflects runtime side state instead of node-field writes; selector/ruleset ownership blockers remain documented. |
| 2 | At-rule output facts / sequence text / fallback args | At-rule body hoist frames no longer mutate the canonical at-rule during eval; source-free reference `Sequence` paths render text-only for runtime/declaration lookups; static fallback call arg containers avoid copies; selector, mixin-output, and ruleset-as-mixin audits documented current ownership blockers. |
| 3 | Body resolve / nil guard / assignment sequence / lookup proof | Public at-rule resolve skips render-frame prelude writes; guarded nil selectors render through owned guard/body output; merged sequence assignment output streams from state; ampersand state owns input item facts; mixin-output lookup tests prove type/target-specific traversal; source-free fallback `Sequence` is inert reference output. |
| 4 | Layer state / lookup policy / text containers / nil body | At-rule layer-name registration moved out of extend-root scratch into invocation state; lookup entry gates are lookup-owned; source-free direct-reference and declaration assignment containers avoid owned result copies; ampersand placement carries item text/count; simple nil-selector render skips wrapper prep and evaluates an owned body directly. |
| 5 | Registration facts / runtime containers / slot gates | At-rule body registration state owns the pushed-extend-root fact; source-free runtime-binding `List` containers render text-only while `default()` and public resolve stay owned; ampersand placement state carries final result text; registry/reference child searches use entry-aware mixin-output gating. |
| 6 | Public adapter / reference leak / placement cleanup | Public at-rule body resolve goes through an explicit result adapter; runtime-binding containers have a default-guard proof and fixed reference-stack cleanup; ampersand placement state owns the final result pointer; mixin-output entry search uses slot gating. |
| 7 | State-first at-rule/reference/slot pass | At-rule body result finalization prefers invocation state over eval-frame runtime scratch. Declaration-reference source-free `List` containers render text-only, while runtime/direct containers stay owned after a caught `default()` regression. |

## Metrics Snapshot

Static audit is useful for regression detection, not proof of speed. Hot-path
timing rows are descriptive samples, not verdicts. Do not call a change faster
or slower from one row, especially when relative standard deviation is high;
look for repeated adjacent runs with the same direction before treating a
performance change as real.

Latest static audit:

| `new-node` | `derive` | `with-surface` | `copy-leaves` | `clone-leaves` | module | eval | prepare | resolve |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 308 | 30 | 41 | 29 | 0 | 379 | 27 | 2 | 0 |

Recent hot-path medians. `#1` is the latest pass.

| # | Pass | `functions` | `import-ref` | `mixins-guards` | `extend` | `media` | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Direct-target guard / slot fact / state naming | 21.70ms | 29.14ms | 33.26ms | 16.12ms | 7.87ms | mostly noise versus #2; media compares faster but RSD is 24.2%, so treat as descriptive only |
| 2 | At-rule output facts / sequence text / fallback args | 22.95ms | 29.04ms | 33.12ms | 16.07ms | 8.86ms | media compares slower to #3, but the preceding read-only run was 8.13ms and RSD is high; treat this as descriptive/noisy, not a regression claim |
| 3 | Body resolve / nil guard / assignment sequence / lookup proof | 21.53ms | 28.68ms | 32.12ms | 15.43ms | 7.53ms | slower than #4, but the preceding read-only run was similar; RSD remains high and static counts are near-flat, so treat as descriptive only |
| 4 | Layer state / lookup policy / text containers / nil body | 18.27ms | 22.52ms | 27.40ms | 13.99ms | 6.09ms | recorded after read-only run; all medians compare faster than prior saved row, but RSD remains high, so treat as descriptive only |
| 5 | Registration facts / runtime containers / slot gates | 21.62ms | 28.90ms | 32.34ms | 15.52ms | 7.95ms | recorded after read-only run; mostly noise versus #6, media lower but high RSD; no speed claim |
| 6 | Public adapter / reference leak / placement cleanup | 20.95ms | 27.39ms | 33.16ms | 15.68ms | 8.86ms | recorded after a read-only repeat; functions/import noise-better, extend faster, media slower, RSD high; no speed claim |
| 7 | State-first at-rule/reference/slot pass | 21.64ms | 28.66ms | 32.23ms | 18.99ms | 7.65ms | descriptive sample only; later adjacent runs moved mixed directions, so this row is not evidence of a regression |

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
- Reference render still shares public result ownership for source-backed
  containers, dynamic containers, public `resolve(...)`, and rules-like values.
  Source-free scalar fallback/declaration/variable/runtime-binding render and
  source-free static runtime-binding list render are text-only now; do not
  extend that to broader containers without ownership proof.
- Ampersand append/template output remains generated selector output, not just
  carrier metadata. A future placement state must carry the source ampersand,
  source parent selector, append/template string, validated replacement text or
  selector-list items, hoist/root placement facts, selector-bit/library facts,
  and final selector text. It must not grow into a parallel selector AST.
- Empty rest / `@arguments` binding placeholders preserve current Less
  behavior. Do not delete them unless the behavior is explicitly changed.

## Immediate Queue

This is a pop queue. Keep at least seven concrete items here. When the top item
is completed, remove it and add or promote enough work to keep the queue full.
If an item is too broad, replace it with the smallest honest next checkpoint
and move the broader theme to the backlog.

Queue items must be surface-sized, not line-sized. Prefer a whole node family,
helper family, or eval/render surface with inventory, implementation, focused
proof, audit delta, and documented blockers. Only split smaller after the
inventory proves a real semantic blocker; do not create timid items like
"delete one helper call" when a whole `.set()` / `inherit()` / `derive*`
family can be audited and reduced.

1. **Move at-rule body registration state off the eval frame.**

   - Goal: move one concrete registration fact still read through the derived
     body eval frame into `AtRuleBodyEvalRecord` or its context state.
   - Required proof: nested `@layer`/`@media`, same-name layer extends,
     root-hoist sibling order, async/throw cleanup, public resolve ownership,
     and source body parentage.

2. **Clarify direct-target container semantics.**

   - Goal: prove the intended behavior for direct `index` lookups on `List`,
     `Sequence`, `JsArray`, `JsObject`, and `Rules`, then narrow or document
     the direct-target lookup table.
   - Required proof: direct lookup fallback, numeric index behavior,
     quoted/unquoted keys, public `resolve(...)` ownership, stack cleanup, and
     no accidental mixin namespace redirect.

3. **Narrow dynamic fallback call content ownership.**

   - Goal: audit fallback calls with `contentNode` and decide whether content
     can share the same source-free static inert-container rule as args.
   - Required proof: optional CSS calls with content, async content render,
     JS metadata raw args, caller restoration, important flags, and
     source-backed content parentage.

4. **Prototype one generated-pseudo placement-state field.**

   - Goal: add exactly one proven fact to `GeneratedPseudoPlacementState`, or
     document why generated pseudo output still needs the owned pseudo wrapper.
   - Required proof: `:is(...)`, unknown pseudo args, nested pseudos, selector
     bit metadata, extend matching, source parentage, and output parity.

5. **Continue mixin-output slot fact migration.**

   - Goal: move another wrapper option/fact into `MixinOutputSlot` only if the
     helper can own it for every attach site.
   - Required proof: ordered comments/declarations/rules, targeted lookups,
     scope frame, caller fallback, rule indexes, repeated placements,
     `referenceMode` clearing, and serializer gating.

6. **Revisit ruleset-as-mixin child copying with one candidate path.**

   - Goal: pick one ruleset-as-mixin output path and either avoid child copying
     with placement state or write down the exact missing state field.
   - Required proof: complex parent ampersands, nested array-path lookups,
     hoist/root output, source parentage, scope/frame state, and focused copy
     counts.

7. **Re-run hot-path measurement after the next structural change.**

   - Goal: current timing remains noisy. Record again only after code or
     measurement-method changes, with the read-only run kept separate from the
     saved run.
   - Required proof: static audit, read-only hot-path run, saved hot-path row,
     concise table update, and no speed/regression claim from a single noisy
     sample.

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
