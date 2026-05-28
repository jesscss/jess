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
Latest audit: `new-node: 302`, `derive: 31`, `with-surface: 41`,
`copy-leaves: 31`, `clone-leaves: 0`, module-context count `375`,
eval-context count `29`, prepare-registration count `1`, resolve-context count
`0`. The clone-leaves frontier is zero; remaining work is reducing owned
placement copies/state carriers, not hiding deep clone behind another helper.

## Completed Queue Pass

- Deep copy/clone frontiers are clean. The latest pass removed the remaining
  `cloneChildrenWithReusableLeaves(...)` site from callable mixin output; tests
  still prove repeated comments, leaky/non-leaky lookup, reference gating, and
  source body parentage.
- Render/eval state seams now exist for `Rules`, `AtRule`, `Call`,
  `Declaration`, generated pseudo placement, import placement, mixin output
  slots, and ampersand append placement. These are transitional state carriers,
  not a second AST.
- Direct unevaluated `Rules.render(...)`, declaration registration prep, body
  at-rule render/resolve, and generated ampersand selectors still carry real
  ownership or public-result semantics. The queue below names the next splits;
  do not delete those wrappers by pattern.
- The old `preEval()` phase, the old `preEvaluated` flag, direct public
  `Rules.resolve(...)` wrapper derivation, dynamic call fallback surface eval,
  final at-rule body mutation, production `.set()` helper use, and broad
  clone-leaves helpers are already done. Look in git history for details if
  needed; do not re-expand this section with stale status prose.
- Latest pass: `Rules` now has separate source/render body emission entrypoints,
  declaration registration normalization runs through
  `DeclarationRegistrationState` instead of prep-time `.derive()`, and callable
  mixin output helpers now describe owned placement surfaces rather than clones.
  Body at-rule and ampersand generated-selector wrappers were re-audited and
  still need the state splits below before deletion.
- Latest pass: direct `Declaration.render(...)` now evaluates through
  `DeclarationRenderState` instead of materializing a prepared declaration
  surface. Public `resolve(...)` still materializes a node result. The audit's
  raw `new-node` count rose because this adds explicit state/fallback render
  helpers; the hot-path `derive`, `copy-leaves`, `clone-leaves`,
  `eval-context`, and `resolve-context` counts did not regress.
- Latest pass: declaration render-only empty merge fallback now reuses the
  existing empty placeholder node instead of allocating a fresh `Nil`. This
  drops the raw audit to `new-node: 303` / module-context `376`; no hot
  eval/resolve/copy/clone count regressed.
- Latest pass: declaration render-only multi-item merge fallback now emits
  list syntax from the existing merged items instead of constructing a
  temporary `List`. `List` owns the shared syntax helper, so this is not a
  second list serializer. The raw audit is now `new-node: 302` /
  module-context `375`.

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

1. **Make the render Rules body walker async/native.**

   - Goal: split `_emitRenderRulesBody(...)` from the synchronous source
     serializer so render body emission can await native child `render(...)`
     calls for declarations, controls, nested rulesets, and at-rules without
     first creating a compatible output `Rules` tree.
   - Required proof: dynamic declarations, `$if`/`$for`/`$while`, nested
     rulesets/at-rules, root/fragment separators, source parentage, and
     unchanged `toString()`.

2. **Delete the direct unevaluated `Rules.render(...)` derive.**

   - Goal: once the render body walker owns dynamic child evaluation, remove
     the remaining direct-render compatibility `this.derive().eval(context)`
     branch.
   - Required proof: charset/import root output, fragment render, buffer parity,
     registration prep, source parentage, and audit delta.

3. **Design the next honest `MixinOutputSlot` child/state boundary.**

   - Goal: direct comments cannot simply be moved into the slot as a loose list:
     their order relative to evaluated declarations/rules matters. Inventory
     source-order requirements and either move comments plus position metadata
     into slot emission or document why the current owned child surface is still
     the smallest model.
   - Required proof: repeated mixin output comments, leaky/non-leaky lookup,
     targeted lookup, reference gating, parentage, and no clone frontier
     regression.

4. **Move at-rule body prelude evaluation into `AtRuleBodyState`.**

   - Goal: split the prelude part of body at-rule eval into state first,
     leaving body/root-hoist mutation on the existing output at-rule until the
     next checkpoint proves the frame/body split.
   - Required proof: dynamic preludes, root-only frame clearing, nested
     media/mixins, layers, extend chaining, source parentage, and buffer render.

5. **Move at-rule frame/body output facts into `AtRuleBodyState`.**

   - Goal: after prelude state is split, carry hoist/root-frame facts and final
     evaluated body output as state fields so direct render no longer depends
     on materialized output at-rule shape.
   - Required proof: dynamic body render, root-only at-rules, import/reference
     interactions, nested extend roots, and source parentage.

6. **Narrow body at-rule `resolve(...)` materialization.**

   - Goal: construct an output at-rule in `resolve(...)` only when the public
     node result needs owned name/prelude/body fields; keep render-only state
     out of public resolve.
   - Required proof: static identity, dynamic prelude, body output, layer/root
     registration, import/reference interactions, and source parentage.

7. **Promote one proven ampersand append/template fact into placement state.**

   - Goal: move only a tested carrier-only fact from generated append/template
     selector wrappers onto `AmpersandAppendPlacementState` without weakening
     extend matching or generated selector parentage. The latest audit did not
     find a second safe carrier-only fact beyond `hoistToRoot`; source,
     appendValue, and output currently describe the placement but do not replace
     selector semantics.
   - Required proof: appended ampersands, template replacements, selector
     lists, generated `:is(...)`, extend matching, direct/buffer render, and
     source parentage.

8. **Audit declaration render-only `important` flag allocation.**

   - Goal: the remaining render-only declaration allocation is synthesized
     `!important` when a surrounding important source is active. Keep it only if
     a real flag node is needed for trivia/comment emission; otherwise carry
     the important text as render state.
   - Required proof: mixins-important Less fixture subset, direct/buffer
     declaration render, comment trivia before semicolon, source parentage, and
     audit delta.

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
