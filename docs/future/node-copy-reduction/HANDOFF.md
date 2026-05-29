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
  runtime map just to avoid duplicate render work. Body result finalization now
  reads invocation state before eval-frame runtime scratch, so the remaining
  runtime map is a compatibility/public-result bridge rather than the primary
  body result carrier.
- Dynamic call fallback render/resolve now evaluates through `CallEvalState`
  without constructing a copied fallback `Call` surface. The state carries
  name, args, content, caller, mark-important, and rules-like variable lookup
  facts. Finalized fallback CSS call syntax is built at one boundary using
  state args. Already-evaluated finalized call output is marked before native
  render so optional fallback calls do not re-enter name evaluation.
  `evalFromState(...)` now runs inside the shared call-frame helper, so stack
  and caller restoration are centralized for ordinary dynamic calls, mixin
  collection calls, stylesheet functions, JS functions, and fallback paths.
- Reference fallback values now reuse source-free static `List` containers as
  inert output when every child is already a reusable leaf. Dynamic fallback
  containers, source-backed declaration/variable containers, and rules-like
  outputs still own result surfaces.
- Source-free static fallback and declaration-reference `List` containers can
  now render as text-only output without applying public result metadata.
  Source-free static runtime-binding `List` containers can also render through
  that text-only path. Source-backed containers, dynamic containers, public
  `resolve(...)`, and `default()` guard containers still own result surfaces.
- Reference render still uses `evalNode(context)` and then native rendering of
  the resolved node for containers, declaration/runtime-binding values, and
  rules-like values. Scalar source-free fallback render now has a text-only
  finalization path that avoids public result metadata; declaration and
  variable lookup scalar leaves now use that same text-only path during render,
  runtime-binding scalar leaves do too, and source-free static runtime-binding
  lists can render as text-only containers. Fallback render and rules-like
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
- Ampersand append/template evaluation now has a tiny
  `AmpersandAppendPlacementState` prototype. It currently carries only source,
  selected parent/output selector, append text, template-merge mode, hoist fact,
  template parts, template replacement selectors/text, and selector bit
  library, final result pointer, and final result text. It does not replace
  generated selector output; it is a staging point for proving which generated
  facts can move out of selector wrappers.
- A `MixinOutputSlot` type now exists as an explicit compatibility record on
  generated mixin-output `Rules` wrappers. Slot-aware helpers cover
  mixin-output identity, ambient versus targeted lookup policy, visibility
  checks in `Rules`, `Reference`, serializer gating, and registry
  child-search. Registry lookup keeps entry visibility, node visibility,
  optional candidates, and mixin-output lookup policy as distinct helper
  concepts; do not collapse them back into one coalesced visibility check.
- `MixinOutputSlot.childSegments` records the canonical source child and, when
  the ordered output position exists, the owned output child for that
  placement. The slot also carries whether ambient lookup may enter the
  wrapper. Lookup still must not switch to source segments blindly; output
  children are the scope/frame-bearing surface.
- The next `MixinOutputSlot` boundary was audited. Direct comment children
  cannot move into the slot as a loose side list because mixin output must
  preserve source order among comments, declarations, nested rules, and lookup
  visibility gates. Targeted callable lookup also cannot read source-child
  segments as the actual search surface yet: nested mixin scope tests prove the
  owned output children carry scope/frame semantics that source children do not.
  The current owned output child surface remains the smallest honest model
  until the slot can carry ordered child segments, evaluated placement children,
  rule index, scope frame, reference gates, and targeted lookup behavior.
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
- Nil-selector ruleset render remains an owned-body blocker. It already avoids
  direct source body render and preserves source body parentage, but the body
  output cannot move to side state until nested output and registration effects
  can be carried without mutating the owned eval body.
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
Latest audit: `new-node: 304`, `derive: 30`, `with-surface: 41`,
`copy-leaves: 29`, `clone-leaves: 0`, module-context count `375`,
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
  public registration/resolve still materialize owned result surfaces.
- Runtime-binding reference containers now have a focused default-guard proof
  and restore `referenceStack` on the owned output path. They are still not a
  text-only container target because `default()` needs live callable context.

## Recent Pass History

Keep this table short. Add the newest row at the top. `#1` is the latest pass.
Move old detail to git history or a dedicated perf log if we need a deeper
trend.

| # | Focus | Main result |
| --- | --- | --- |
| 1 | Registration facts / runtime containers / slot gates | At-rule body registration state now owns the pushed-extend-root fact; source-free runtime-binding `List` containers render text-only while `default()` and public resolve stay owned; ampersand placement state carries final result text; remaining registry/reference child searches use entry-aware mixin-output gating; declaration assignment source-free list input and nil-selector owned-body proofs are documented. |
| 2 | Public adapter / reference leak / placement cleanup | Public at-rule body resolve now goes through an explicit result adapter; runtime-binding containers have a default-guard proof and fixed reference-stack cleanup; ampersand placement state owns the final result pointer; mixin-output entry search uses slot gating; declaration assignment copy sites dropped by two; nested nil-selector output remains an owned-body blocker. |
| 3 | State-first at-rule/reference/slot pass | At-rule body result finalization now prefers invocation state over eval-frame runtime scratch. Declaration-reference source-free `List` containers render text-only, while runtime/direct containers stay owned after a caught `default()` regression. Mixin slots carry the targeted-lookup gate without changing entry visibility semantics. Ampersand placement state carries replacement selectors/text. Nil-selector rulesets remain an owned-body blocker. |
| 4 | At-rule registration / reference containers / custom assignment | At-rule body eval records body-registration pairing on invocation context state. Source-free static fallback `List` containers render text-only, reusable reference branches restore stack state, custom property assignment stays raw, mixin slot source indexes use a direct map, ampersand state carries template replacements, and guarded ruleset pass/fail proofs define the owned-body blocker. |
| 5 | Layer state / reference stack / slot indexes | At-rule body eval carries layer-name registration state on invocation context. Rules-like reference preserve paths restore stack state. Declaration assignment state covers contextual important buffers. Mixin slots expose source-order indexes, ampersand state carries template parts, and guarded nested rulesets are documented as a real owned-body blocker. |
| 6 | Body eval context / fallback cleanup / slot indexes | Body-at-rule eval keeps evaluated body/output facts on invocation context state before public output writes. Fallback reference render restores stack state, declaration render carries assignment item state without a temporary sequence for render, mixin output wrappers index children from slot source maps, and ampersand placement state owns template-merge mode. |
| 7 | At-rule prelude state / runtime-binding scalar text / slot maps | Body-at-rule direct render carries evaluated preludes on eval context state instead of the runtime map. Runtime-binding scalar reference render skips public result metadata. Mixin slots map source-to-output directly. Ampersand append has a tiny placement state. No further safe source-direct ruleset body shape was found. |

## Metrics Snapshot

Static audit is useful for regression detection, not proof of speed. Hot-path
timing rows are descriptive samples, not verdicts. Do not call a change faster
or slower from one row, especially when relative standard deviation is high;
look for repeated adjacent runs with the same direction before treating a
performance change as real.

Latest static audit:

| `new-node` | `derive` | `with-surface` | `copy-leaves` | `clone-leaves` | module | eval | prepare | resolve |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 304 | 30 | 41 | 29 | 0 | 375 | 27 | 2 | 0 |

Recent hot-path medians. `#1` is the latest pass.

| # | Pass | `functions` | `import-ref` | `mixins-guards` | `extend` | `media` | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Registration facts / runtime containers / slot gates | 21.62ms | 28.90ms | 32.34ms | 15.52ms | 7.95ms | recorded after read-only run; mostly noise versus #2, media lower but high RSD; no speed claim |
| 2 | Public adapter / reference leak / placement cleanup | 20.95ms | 27.39ms | 33.16ms | 15.68ms | 8.86ms | recorded after a read-only repeat; functions/import noise-better, extend faster, media slower, RSD high; no speed claim |
| 3 | State-first at-rule/reference/slot pass | 21.64ms | 28.66ms | 32.23ms | 18.99ms | 7.65ms | descriptive sample only; later adjacent runs moved mixed directions, so this row is not evidence of a regression |
| 4 | At-rule registration / reference containers / custom assignment | 17.67ms | 23.03ms | 27.20ms | 13.86ms | 6.25ms | all deltas versus #5 are inside the script's noise band; structural wins are state/ownership proof, not claimed speedup |
| 5 | Layer state / reference stack / slot indexes | 18.43ms | 24.60ms | 28.17ms | 13.61ms | 6.33ms | saved row; functions and extend are outside the 8% threshold, other fixture deltas are positive but noisy |
| 6 | Body eval context / fallback cleanup / slot indexes | 20.60ms | 25.77ms | 30.52ms | 14.84ms | 6.81ms | all medians improved versus prior saved row, but each delta is inside the script's noise band |
| 7 | At-rule prelude state / runtime-binding scalar text / slot maps | 21.52ms | 27.03ms | 31.53ms | 15.20ms | 7.12ms | all medians improved versus prior saved row, but each delta is inside the script's noise band |

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

1. **Move at-rule layer-name registration fully into body invocation state.**

   - Goal: `pushedExtendRoot` is state-owned now. Move the next at-rule body
     registration fact, likely layer-name take/store ownership, out of
     eval-frame keyed side effects without changing nested layer extend output.
   - Required proof: nested `@layer`/`@media`, same-name layer extends,
     thrown/rejected cleanup, source body parentage, and no new runtime-map
     scratch writes.

2. **Audit remaining reference container text-only exclusions.**

   - Goal: source-free runtime-binding lists are text-only now. Decide whether
     direct-reference source-free containers can share the same render-only
     path, or document the exact ownership blocker.
   - Required proof: direct container render, public `resolve(...)` ownership,
     `default()` guard containment, async native render, custom property values,
     rules-like preserve paths, and reference-stack cleanup.

3. **Move one more ampersand append selector fact into placement state.**

   - Goal: final result text is state-owned now. Move the next proven fact,
     such as distributed result item texts/count, without replacing generated
     selector output.
   - Required proof: complex parent ampersands, selector lists, template
     distribution, append versus hoist behavior, invalid template errors,
     source parentage, and output parity.

4. **Audit mixin-output child search after entry-gate convergence.**

   - Goal: registry/reference child loops now use entry-aware slot gates.
     Inventory whether any targeted lookup can consume slot child-segment order
     without switching the actual lookup surface from owned output children.
   - Required proof: targeted property lookup, targeted mixin lookup, nested
     mixin scopes, direct comments in order, reference gates, and repeated
     placement.

5. **Audit declaration assignment source-free sequence/container ownership.**

   - Goal: source-free list inputs already avoid copy during render assignment.
     Check the same family for sequence inputs and merged output containers
     before touching source-backed or custom-property assignment values.
   - Required proof: `+:`, `&,:`, `&_:`, `?:`, custom property raw values,
     source parentage, focused copy counts, and static audit delta or blocker.

6. **Prototype nil-selector body render side state.**

   - Goal: nil-selector rulesets still need owned body output. Implement or
     sketch the smallest invocation-local record that can carry evaluated body
     output while preserving source body parentage.
   - Required proof: nil selector output, nested output, source body parentage,
     fixture subset, and no source-direct render where registration/nesting is
     required.

7. **Run the next hot-path measurement only after another code change.**

   - Goal: the latest sample is descriptive and noisy. Avoid metric churn until
     the next structural or measurement-method change.
   - Required proof: read-only run first, record only with a code/method
     reason, compare against the latest rows, and update this table concisely.

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
