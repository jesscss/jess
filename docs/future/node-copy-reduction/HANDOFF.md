# Node Copy Reduction — Handoff

## Open This First

This is the live queue for the eval/render/copy refactor. Keep it short enough
that the next agent can read it at startup and act without replaying weeks of
completed work.

Use [README.md](./README.md) for architecture rules. Use this file for current
truth, the immediate pop queue, and verification.

## Current Truth

- Top priority remains complete single-pass eval/render with the smallest
  honest node-creation shape. Regression audits support that goal; they do not
  replace it.
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
  recoverable through render/resolve body state. It still mutates the evaluated
  output at-rule.
- Dynamic call fallback render/resolve now evaluates through `CallEvalState`
  without constructing a copied fallback `Call` surface. The state carries
  name, args, content, caller, mark-important, and rules-like variable lookup
  facts. Finalized fallback CSS call syntax is built at one boundary using
  state args. Already-evaluated finalized call output is marked before native
  render so optional fallback calls do not re-enter name evaluation.
- Direct unevaluated `Rules.render(...)` now routes through `RulesRenderState`
  before final string/buffer emission. It still evaluates an owned Rules
  surface for compatibility, but root/fragment separator behavior is now
  explicit state instead of loose `derive().eval(...)` output. Do not blindly
  route static `Rules.resolve(...)` through that state: static resolve is
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
  at-rule bodies/root-hoist still need explicit state before the full surface
  can be deleted; mixin output wrappers are the current output-slot stand-in;
  remaining dynamic-call fallback paths need a non-`Call` state record;
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
| `AtRule.render(...)`                | Reuses evaluated/prepared/static at-rule surfaces when available. Dynamic leaf render uses local name/prelude state; direct dynamic body/root-hoist render still derives before eval. | Split body/root-hoist/extend-root state before deleting the remaining surface.                                                            |
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
Latest audit: `new-node: 295`, `derive: 35`, `with-surface: 40`,
`copy-leaves: 32`, `clone-leaves: 2`, module-context count `364`,
eval-context count `37`, resolve-context count `1`. The module count includes
module-level state records such as the at-rule registration `WeakMap`; use the
eval-context count for hot-path movement.

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
  state record around the compatibility output surface. The remaining work is
  to move body registration, extend-root bookkeeping, and final render facts
  out of that owned output at-rule.
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
- At-rule body registration state extraction is started. Nestable-body
  registration now has `AtRuleBodyRegistrationState` carrying `bodyToEval`,
  `finalRules`, parent extend root, and layer name. `AtRuleBodyState` can now
  recover that registration state after eval. The output at-rule still
  receives `value.rules = finalRules`, so the next pass must move final body
  selection/rendering off that mutation.
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
- Generated pseudo placement queue item was audited. The only proven fact is
  still single-selector-list wrapper omission for generated `:is(...)`. No
  visibility, extend metadata, or composed-header fact should be added until a
  focused selector-shape test proves it belongs in placement state.
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

1. **Move at-rule final body rendering off output-at-rule mutation.**

   - Goal: make `AtRuleBodyState` carry final body output and registration
     state all the way through direct render/resolve, then serialize from that
     state without assigning `node.value.rules = finalRules` as the only
     carrier.
   - Required proof: nested extend roots, layer names, root-only frame
     clearing, direct/buffer render parity, and source body parentage.

2. **Narrow direct unevaluated `Rules.render(...)` without changing static resolve.**

   - Goal: make `RulesRenderState` able to narrow direct unevaluated render
     without changing `Rules.resolve(context)` identity for static nodes or
     buffer-vs-string separator behavior for fragments.
   - Required proof: static resolve identity, fragment separator trimming,
     flat-buffer separators, registration-prepared roots, and source child
     parentage.

3. **Prove or reject selector placement metadata for generated pseudo output.**

   - Goal: add a focused selector-shape test for one candidate fact
     (visibility, extend metadata, or composed-header cache) and only then move
     that fact into `GeneratedPseudoPlacementState`; if the test shows the
     fact is AST-owned, document that and leave the state small.
   - Required proof: generated `:is(...)`, unknown pseudo args, extend
     matching, source serializers, and direct/buffer render parity.

4. **Reduce one selector-family `inherit(...)` cluster.**

   - Goal: choose one selector family (`CompoundSelector`, `ComplexSelector`,
     `SelectorList`, or generated pseudo extend output), classify every
     `.inherit(...)` use in that family, and remove only carrier-only uses.
   - Required proof: source parentage/eval-state guards for removed surfaces,
     focused output coverage for each touched node family, and audit delta or
     explicit ownership-boundary blocker.

5. **Use `DeclarationEvalState` to remove one declaration derive surface.**

   - Goal: move either assignment normalization or value/important finalization
     onto `DeclarationEvalState` so one current declaration derive path can be
     deleted instead of merely observed.
   - Required proof: custom property no-space value output, property merge,
     important flags, declaration-name interpolation, nil declaration output,
     and source parentage.

6. **Add import placement/comment state and delete the clone-leaves site.**

   - Goal: model first-use import-local placement state, including direct
     comment children, so the remaining `cloneChildrenWithReusableLeaves(...)`
     site can be replaced without dropping repeated import comments.
   - Required proof: import/reference/compose fixture coverage, repeated
     import direct comments, repeated import parentage, imported mixin/ruleset
     lookup, and `clone-leaves` audit delta.

7. **Move dynamic call name copying into a narrower state-owned rule.**

   - Goal: prove which dynamic call names truly need an owned eval node after
     the copied fallback `Call` surface was deleted. Preserve-rules-like
     variable names already use an owned reference; broad `copyWithReusableLeaves`
     for every dynamic name caused runaway allocation in `call.test.ts`.
   - Required proof: optional fallback output, referenced JS functions,
     metadata functions, recursive/detached call names, source name parentage,
     and no OOM/regression in the full call suite.

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
