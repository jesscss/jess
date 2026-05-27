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
  mutation bug.
- Metadata-backed JS functions still keep exactly one owned raw/callback arg
  surface because `this.rawArgs` is mutable user-code API. Plain positional JS
  calls pass args directly.
- At-rule direct unevaluated render compatibility is documented, not deleted:
  the remaining derived at-rule surface isolates dynamic name/prelude
  evaluation, body registration/eval mutation, root-only frame clearing, and
  nested extend-root registration from the canonical source at-rule. The next
  at-rule work must split those responsibilities before removing the surface.
- At-rule prelude-only direct render is split for leaf at-rules: dynamic leaf
  names/preludes now evaluate into local render state for direct and buffer
  render without invoking `AtRule.eval(...)`. Dynamic leaf `resolve(...)` now
  uses an explicit leaf-only owned result instead of the generic at-rule
  derive surface. Body/root-hoist at-rules stay on the existing isolation
  surface, but direct render now routes through an `AtRuleBodyState` record so
  registration/extend-root facts have a named place to split next. Dynamic
  body `resolve(context)` also routes through that state seam. Nestable body
  extend-root finalization now passes through `AtRuleBodyRegistrationState`
  rather than loose local parameters, and that registration state is now
  recoverable through render/resolve body state. Final evaluated body output is
  stored as render state and serialized through `AtRule.getRenderRules()`
  instead of assigning `node.value.rules = finalRules`.
- Dynamic call fallback render/resolve now evaluates through `CallEvalState`
  without constructing a copied fallback `Call` surface. The state carries
  name, args, content, caller, mark-important, and rules-like variable lookup
  facts. Finalized fallback CSS call syntax is built at one boundary using
  state args. Already-evaluated finalized call output is marked before native
  render so optional fallback calls do not re-enter name evaluation.
- Direct unevaluated `Rules.render(...)` now routes through `RulesRenderState`
  before final string/buffer emission. Plain static rule-leaf bodies now
  serialize the canonical source rules without deriving/evaling, matching the
  identity side of static `Rules.resolve(context)` while preserving
  root/fragment separator behavior. Broader static Rules can still need
  rules-level eval for nesting, hoists, controls, and declaration merges, so
  they stay on the compatibility surface. Do not blindly route static
  `Rules.resolve(...)` through that state: static resolve is
  identity-preserving, while static direct render still has body-fragment
  serializer semantics.
- Generated `:is(...)` pseudo rendering now has a
  `GeneratedPseudoPlacementState` prototype. It carries only source/name/arg
  plus the proven single-selector-list wrapper omission flag for placement
  rendering and must not grow into a selector AST replacement. A queue pass
  found no second proven fact yet; add one only with selector-shape evidence.
- A `MixinOutputSlot` type now exists as an explicit compatibility record on
  generated mixin-output `Rules` wrappers. Slot-aware helpers cover
  `isMixinOutput` / visibility checks in `Rules`, `Reference`, serializer
  gating, and registry child-search. Registry lookup keeps entry visibility,
  node visibility, optional candidates, and targeted mixin-output access as
  distinct helper concepts; do not collapse them back into one coalesced
  visibility check.
- The broad proof queue has been processed. Current conclusions:
  at-rule bodies/root-hoist now carry final body output as side-state, but the
  full surface still needs prelude/body/root-hoist responsibilities split;
  mixin output wrappers are the current output-slot stand-in; dynamic-call
  fallback no longer uses a copied `Call` surface, but dynamic-name ownership
  still needs a narrower rule;
  direct unevaluated `Rules.render(...)` is a compatibility fragment path;
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
| `Rules.render(...)` source roots    | Public compile renders already evaluated roots. Direct unevaluated `Rules.render(...)` still derives before eval for compatibility/direct node tests.                                 | Keep the compatibility path isolated; prove any narrowing preserves fragment separators, registration prep, and source parentage.         |
| `AtRule.render(...)`                | Reuses evaluated/prepared/static at-rule surfaces when available. Dynamic leaf render uses local name/prelude state; direct dynamic body/root-hoist render still derives before eval, but final body output is side-state rather than `value.rules` mutation. | Split the remaining prelude/body/root-hoist responsibilities before deleting the isolation surface.                                       |
| `Ruleset.render(...)`               | Reuses evaluated/prepared ruleset surfaces. Unevaluated rulesets still prepare/eval an isolated surface; nil-selector output delegates to body render.                                | Prove which generated selector/body surfaces are semantic and which are serializer carriers.                                              |
| `Declaration.render(...)`           | Prepares/evals one isolated declaration surface for assignment/name/value/important mutation.                                                                                         | Keep source isolation unless a concrete side-state model replaces preparation mutation.                                                   |
| Function/mixin args                 | Plain JS calls pass direct args. Metadata calls keep one owned `rawArgs` surface.                                                                                                     | Keep guarding the split; do not add another copied source-call surface.                                                                   |
| Generated selector/output ownership | Extend, `:is(...)`, pseudo args, framed ampersands, selector collapse, and ruleset headers still create owned placement surfaces in focused cases.                                    | Keep unless new parentage/visibility/output tests prove a specific placement is carrier-only.                                             |
| Mutation helpers                    | `inherit(...)`, `set(...)`, `derive*`, and shallow wrappers still exist as local ownership tools.                                                                                     | Remove or narrow helper use where a side-state record or direct render output can carry the same semantics without mutating source nodes. |

## Node-Creation Hotspots

Run `pnpm run audit:node-creation` before and after a node-creation reduction
checkpoint. The script ranks likely runtime surfaces; it is not a gate.

Current top files by static surface count:

1. `packages/core/src/tree/rules.ts`
2. `packages/core/src/tree/call.ts`
3. `packages/core/src/tree/declaration.ts`
4. `packages/core/src/tree/dimension.ts`
5. `packages/core/src/tree/import-style.ts`
6. `packages/core/src/tree/at-rule.ts`
7. `packages/core/src/tree/reference.ts`
8. `packages/core/src/tree/ampersand.ts`
9. `packages/core/src/tree/ruleset.ts`

Current top surface kinds: `new` node construction, `with*` output surfaces,
`derive*` / `.derive(...)` surfaces, and `copyWithReusableLeaves(...)`.
Latest audit: `new-node: 297`, `derive: 35`, `with-surface: 40`,
`copy-leaves: 32`, `clone-leaves: 2`, module-context count `366`,
eval-context count `37`, resolve-context count `1`. The module count includes
module-level state records such as the at-rule body `WeakMap`s; use the
eval-context count for hot-path movement.
Current working audit after the latest selector/call pass: `new-node: 298`,
`derive: 34`, `with-surface: 40`, `copy-leaves: 31`, `clone-leaves: 2`,
module-context count `365`, eval-context count `37`, resolve-context count
`1`. The new node sighting is the selector-list owned-collapse proof; the
derive/copy drops are from deleting the dynamic call broad name-copy helper.

## Completed Queue Pass

- At-rule body/root-hoist proof is done. Focused coverage now includes direct
  and buffer render for a dynamic body while proving the canonical prelude/body
  remain parented to the source at-rule and unevaluated. Existing root-only
  frame-clearing and nested extend-root tests remain the semantic blockers for
  deleting the body/root-hoist surface.
- Mixin output-slot proof is done. Existing tests cover repeated placement,
  leaky/targeted lookup behavior, no source body reparenting, and no source
  `Rules` root clone. The wrapper is still carrying real placement state, so
  the next step is extracting an explicit slot record, not moving source body
  children into another tree.
- Dynamic call content/rules-like proof is done. Plain CSS content render is
  already direct; metadata calls already use one owned raw-args surface; the
  remaining fallback path now enters through `CallEvalState`, which still
  carries a compatibility `Call` surface until fallback name/args/content and
  rules-like lookup state are fully split.
- Rules fragment proof is done. Direct unevaluated `Rules.render(...)` remains
  a compatibility body-fragment path; public compiler output enters through an
  evaluated root and flat buffer.
- Selector pseudo proof is done. `:is(...)` and unknown pseudo args have source
  serializer, parser-shape, direct render, buffer render, and extend matching
  coverage. Generated pseudo placement still needs owned/stateful output.
- Mutation-helper proof is done. The collapsed selector source-child bug
  establishes the rule: never `inherit(...)` onto a canonical child. Each
  remaining helper deletion needs focused parentage/eval-state output proof.
- Leaf at-rule resolve proof is done. Dynamic leaf render is local; dynamic
  leaf `resolve(...)` still returns an owned `AtRule` node to preserve the
  public resolve contract without reparenting source name/prelude children.
- Dynamic leaf at-rule resolve narrowing is done. The remaining at-rule derive
  surface is body/root-hoist direct render and dynamic body resolve.
- Initial mixin-output slot extraction is done. The helpers cover the simple
  rules/reference/serializer gates and now include the separate registry
  visibility concepts needed for child search.
- Registry slot-aware lookup extraction is done. The registry path now uses
  helpers that preserve entry-vs-node visibility, public-vs-optional
  candidate handling, targeted mixin-output lookup, and compound-prefix
  reference behavior.
- Mixin-output wrappers now carry an explicit `mixinOutputSlot` record. The
  wrapper remains the compatibility carrier, but read helpers prefer slot
  state so the next work can move more facts off ad hoc node options.
- Initial `AtRuleBodyState` is done. Direct at-rule body render now returns a
  state record around the compatibility output surface, and final body output
  has moved out of `value.rules` mutation. The remaining work is to split the
  derived at-rule isolation surface itself.
- Initial `CallEvalState` is done. Dynamic fallback render/resolve no longer
  calls `deriveResolveSurface().eval(...)`, and state-owned variable names can
  carry `preserveRulesLike` without a second reference derivation.
- Initial `RulesRenderState` is done. Direct unevaluated rules render has an
  explicit root/fragment state wrapper while preserving existing separator
  behavior.
- Generated pseudo placement-state prototype is done. The generated `:is(...)`
  serializer special case now routes through a tiny placement state object
  with no parallel selector tree.
- Call finalized fallback syntax extraction is done. Optional JS failure
  output, optional non-function fallback output, and generic non-function
  dynamic call output now construct finalized CSS call syntax through one
  `CallEvalState` boundary without eagerly copying args/content for state-only
  paths.
- Rules-like variable call lookup-state extraction is done. The ordinary
  `Call.evalNode(...)` variable-call branch now evaluates the state-owned
  preserve-rules-like name instead of deriving that reference inline.
- Generated pseudo placement state now carries its first proven placement fact:
  generated `:is(...)` can omit its wrapper when a selector-list argument
  serializes to a single selector.
- At-rule nestable-body registration finalization is deduplicated. The
  register/take-layer/register-inner/push-pop sequence now has one helper,
  which is the next seam for moving registration off the evaluated output
  at-rule.
- Dynamic at-rule body resolve is narrowed. It now routes through
  `AtRuleBodyState` instead of directly calling
  `this.deriveAtRule(this.value).eval(context)`, reducing the resolve-context
  derive count.
- Node `.set()` helper family reduction is done for the unblocked production
  eval/render/registration surfaces in `Ruleset`, `Mixin`, `StyleImport`,
  `Rules`, `Declaration`, `AtRule`, and selector extend replacement.
  Remaining production hits are the base `Node.set(...)` API itself and
  Maps/BitSets/`Reflect.set` index/parent internals; remaining direct
  `Node.set(...)` calls are tests.
- At-rule body state extraction is done for final body output. Nestable-body
  registration has `AtRuleBodyRegistrationState` carrying `bodyToEval`,
  `finalRules`, parent extend root, and layer name; `AtRuleBodyState` can
  recover that registration state after eval. Final evaluated body output is
  stored outside `value.rules`, and the serializer now calls
  `AtRule.getRenderRules()` so source/body ownership stays stable. The
  remaining at-rule surface is the derived isolation wrapper for prelude/body
  eval, root-only frame clearing, and extend-root setup.
- Declaration render/resolve state extraction is started. `Declaration.render`
  and `Declaration.resolve` now share `DeclarationEvalState`, keeping
  custom-property raw value serialization and merge/important behavior behind
  one explicit seam. The state now carries output name/value/important/nil
  facts, but the declaration still derives for registration/eval mutation.
- Call fallback state extraction continued. `CallEvalState` now carries
  name/args/content instead of making finalized fallback syntax read args from
  `source.value`. The remaining `state.surface.eval(context)` path is still a
  compatibility evaluator.
- Call fallback queue item was audited. The remaining `CallEvalState.surface`
  path is not a rename target: it protects dynamic fallback name/args/content
  evaluation from mutating source containers. Removing it needs a direct
  evaluator that takes state-owned name/args/content, not `this.value`.
- Rules render-state queue item was audited. Routing `Rules.resolve(...)`
  through `RulesRenderState` breaks static body-fragment render semantics, so
  the next Rules work must split static identity resolve from direct
  body-fragment serialization before deleting the compatibility surface.
- Plain static direct `Rules.render(...)` narrowing is done. Plain declaration
  leaf roots/fragments now render from the canonical source Rules without
  deriving/evaling, and focused coverage proves root output, fragment string
  trimming, buffer separator preservation, no derive/eval calls, loop-body
  reuse without registration prep, source child parentage, and unchanged
  static resolve behavior. Broader static Rules still eval when they may carry
  nesting, hoists, controls, or declaration merges. Audit counts are unchanged
  because this narrows a runtime branch rather than deleting the remaining
  compatibility derive site.
- Generated pseudo placement queue item was audited. The only proven fact is
  still single-selector-list wrapper omission for generated `:is(...)`. No
  visibility, extend metadata, or composed-header fact should be added until a
  focused selector-shape test proves it belongs in placement state.
- Generated pseudo placement metadata proof is done. Focused tests now cover
  the current placement fact directly: generated `:is(...)` omits its wrapper
  only when a selector-list argument renders as one selector, while authored
  `:is(...)`, generated multi-selector output, source serializers, direct
  render, buffer render, and extend matching stay on existing AST semantics.
  The existing wrapper-omission fact is now retained when pseudo arg eval
  collapses a single selector list to its one selector. No visibility, extend
  metadata, or composed-header fact was added because those remain AST-owned by
  current evidence. The audit gains one module-level `WeakMap`/state entry and
  one `new-node` sighting in `selector-pseudo.ts`; eval-context count is
  unchanged.
- Import clone-leaves queue item was audited. The remaining first-use import
  clone preserves direct comment children for repeated import placements;
  `copyWithReusableLeaves(...)` intentionally nils comments, so this stays
  until import placement/comment state exists.
- `inherit(...)` helper-family audit was scoped. The largest cluster is
  selector extend/placement code, where most uses construct owned generated
  selector output. Do not count those as carrier-only without focused
  parentage and output tests for a whole selector family.
- Dynamic call fallback surface deletion is done. `Call.evalState(...)` now
  evaluates the `CallEvalState` directly instead of deriving a copied `Call`
  and invoking `.eval(context)` on it. The focused call suite proves optional
  fallback output, metadata/rawArgs isolation, source args parentage,
  referenced JS functions, strict-unit fallback behavior, and finalized call
  render without source-call eval. The audit dropped `call.ts` from 24 to 18
  static surfaces, `derive` from 36 to 35, `copy-leaves` from 35 to 32, and
  eval-context surfaces from 45 to 37.
- At-rule final body mutation deletion is done. `AtRule.evalNode(...)` now
  stores evaluated `finalRules` in at-rule body render state instead of
  assigning `node.value.rules = finalRules`; `getHeaderString(...)` and
  `serializeRulesContainer(...)` read the active body via
  `AtRule.getRenderRules()`. Focused coverage proves dynamic direct render,
  segmented-buffer render, root-only frame clearing, layer/extend-root
  behavior, import/reference at-rule interactions, and a structural invariant
  that `value.rules` remains the owned source/eval body while rendered output
  uses the evaluated body state. The audit gains one module-level `WeakMap`
  entry but keeps eval-context surfaces unchanged.
- Selector-list single-result collapse ownership is fixed. `SelectorList`
  now uses the same owned-collapse rule as compound/complex selectors, so
  resolving a single selector-list result under `:is(...)` no longer returns
  or reparents the canonical source child.
- Dynamic call broad name-copying is removed. Plain and metadata dynamic
  function probes now use `CallEvalState.name`; only rules-like variable
  references still get the narrow owned preserve-rules-like reference.
- The import/comment clone-leaves site, declaration derive surface, at-rule
  body/root-hoist surface, and non-static `Rules.render(...)` compatibility
  surface were re-audited. Focused tests prove they still carry real behavior;
  the next queue splits those responsibilities instead of deleting wrappers by
  pattern.

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

1. **Move declaration eval mutation into `DeclarationEvalState`.**

   - Goal: replace the current `ensureEvalSurface()` mutation path with state
     fields for evaluated value, important flag, and nil output, then construct
     an owned declaration only at the public `resolve(...)` boundary.
   - Required proof: custom property raw/no-space output, property merge,
     important propagation, declaration-name interpolation, nil output, and
     source parentage.

2. **Prototype import placement/comment state before deleting clone-leaves.**

   - Goal: create a small import-local placement record that carries direct
     comment children and import-site parent/root facts. Only then replace the
     first-use `cloneChildrenWithReusableLeaves(...)` site.
   - Required proof: repeated import direct comments, reference/multiple
     parent chains, imported mixin/ruleset lookup, compose/reference parity,
     and `clone-leaves` audit delta.

3. **Split at-rule body eval isolation from root-hoist frame clearing.**

   - Goal: keep `AtRuleBodyState`, but move root-only frame clearing into a
     named state helper so body eval isolation and hoist frame behavior can be
     reduced independently.
   - Required proof: root-only keyframes/font-face, nested media in mixins,
     layer names, extend chaining across at-rules, source body parentage, and
     Less media/import fixtures.

4. **Split at-rule dynamic prelude evaluation from body wrapper ownership.**

   - Goal: for dynamic body at-rules, reuse the leaf prelude render/resolve
     state path before entering body evaluation, so the remaining wrapper is
     only about body/root-hoist ownership.
   - Required proof: dynamic prelude variables, async prelude failure cleanup,
     nested media in mixins, source prelude parentage, and at-rule render
     buffer parity.

5. **Extract a non-static `Rules.render(...)` compatibility state.**

   - Goal: give direct non-static render a state record for registration prep
     and body-fragment serialization without routing public `Rules.resolve(...)`
     through render semantics.
   - Required proof: dynamic declarations, control nodes, registration retry,
     direct root/fragment render, buffer parity, source child parentage, and
     unchanged `safeCompile(...)` tree-surface behavior.

6. **Narrow public `Rules.resolve(...)` owned-wrapper use.**

   - Goal: classify which non-static resolve calls need a full owned `Rules`
     wrapper versus a prepared/evaluated state handoff, then remove only the
     carrier-only branch.
   - Required proof: static identity resolve, registration-prepared resolve,
     dynamic declaration resolve, nested rule lookup, source parentage, and no
     change to direct render fragment semantics.

7. **Audit ampersand append generated-selector ownership as a family.**

   - Goal: classify append/template output in `ampersand.ts` as semantic
     generated selector owners versus serializer carriers. Do not add placement
     state unless it carries proven visibility, extend, or composed-header
     facts.
   - Required proof: appended ampersands, selector lists, interpolation
     replacements, extend matching, generated `:is(...)`, source parentage,
     direct/buffer render parity, and audit delta or explicit blocker.

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
