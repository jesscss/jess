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
  instead of assigning `node.value.rules = finalRules`. Direct render now
  serializes body at-rule output from `AtRuleBodyState` fields rather than the
  materialized output at-rule shape, then restores source prelude/body/hoist
  state immediately after printing. The old `evaluatedPreludeForBody` bridge
  is gone; body render relies on the evaluated prelude already carried in
  `AtRuleBodyState` / derived body-eval input.
- Dynamic call fallback render/resolve now evaluates through `CallEvalState`
  without constructing a copied fallback `Call` surface. The state carries
  name, args, content, caller, mark-important, and rules-like variable lookup
  facts. Finalized fallback CSS call syntax is built at one boundary using
  state args. Already-evaluated finalized call output is marked before native
  render so optional fallback calls do not re-enter name evaluation.
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
- A `MixinOutputSlot` type now exists as an explicit compatibility record on
  generated mixin-output `Rules` wrappers. Slot-aware helpers cover
  `isMixinOutput` / visibility checks in `Rules`, `Reference`, serializer
  gating, and registry child-search. Registry lookup keeps entry visibility,
  node visibility, optional candidates, and targeted mixin-output access as
  distinct helper concepts; do not collapse them back into one coalesced
  visibility check.
- The next `MixinOutputSlot` boundary was audited. Direct comment children
  cannot move into the slot as a loose side list because mixin output must
  preserve source order among comments, declarations, nested rules, and lookup
  visibility gates. The current owned output child surface is still the
  smallest honest model until a slot can carry ordered child segments plus rule
  index, scope frame, reference gates, and targeted lookup behavior.
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
`copy-leaves: 31`, `clone-leaves: 0`, module-context count `375`,
eval-context count `29`, prepare-registration count `2`, resolve-context count
`0`. The clone-leaves frontier is zero; remaining work is reducing owned
placement copies/state carriers, not hiding deep clone behind another helper.

## Completed Queue Pass

- Deep copy/clone frontiers are clean. The latest pass removed the remaining
  `cloneChildrenWithReusableLeaves(...)` site from callable mixin output; tests
  still prove repeated comments, leaky/non-leaky lookup, reference gating, and
  source body parentage.
- Render/eval state seams now exist for `Rules`, `AtRule`, `Call`,
  `Declaration`, generated pseudo placement, import placement, and mixin output
  slots. These are transitional state carriers, not a second AST.
- Declaration registration prep, body at-rule render/resolve, generated
  ampersand selectors, and state-mutating loop iteration prep still carry real
  ownership or public-result semantics. The queue below names the next splits;
  do not delete those wrappers by pattern.
- The old `preEval()` phase, the old `preEvaluated` flag, direct public
  `Rules.resolve(...)` wrapper derivation, dynamic call fallback surface eval,
  final at-rule body mutation, production `.set()` helper use, and broad
  clone-leaves helpers are already done. Look in git history for details if
  needed; do not re-expand this section with stale status prose.
- Earlier pass: `Rules` now has separate source/render body emission entrypoints,
  declaration registration normalization runs through
  `DeclarationRegistrationState` instead of prep-time `.derive()`, and callable
  mixin output helpers now describe owned placement surfaces rather than clones.
  Body at-rule and ampersand generated-selector wrappers were re-audited and
  still need the state splits below before deletion.
- Earlier pass: direct `Declaration.render(...)` now evaluates through
  `DeclarationRenderState` instead of materializing a prepared declaration
  surface. Public `resolve(...)` still materializes a node result. The audit's
  raw `new-node` count rose because this adds explicit state/fallback render
  helpers; the hot-path `derive`, `copy-leaves`, `clone-leaves`,
  `eval-context`, and `resolve-context` counts did not regress.
- Earlier pass: declaration render-only empty merge fallback now reuses the
  existing empty placeholder node instead of allocating a fresh `Nil`. This
  drops the raw audit to `new-node: 303` / module-context `376`; no hot
  eval/resolve/copy/clone count regressed.
- Earlier pass: declaration render-only multi-item merge fallback now emits
  list syntax from the existing merged items instead of constructing a
  temporary `List`. `List` owns the shared syntax helper, so this is not a
  second list serializer. The raw audit is now `new-node: 302` /
  module-context `375`.
- Earlier pass: `OutputWriter.preview(...)` is now the required awaitable
  primitive for a native Rules render walker. The name stays simple; overloads
  preserve sync return paths and only return a Promise when the callback does.
  Direct body at-rule render evaluates prelude into body state before
  evaluating the output surface, so it does not re-evaluate or mutate the
  source prelude. Declaration render carries contextual `!important` as render
  text instead of materializing a synthetic flag node. The raw audit remains
  `new-node: 302` / module-context `375`.
- Earlier pass: `_emitRenderRulesBody(...)` is now split from source body
  serialization and walks children through native `render(...)` in render
  mode. The walker remains sync when children are sync and becomes awaitable
  only when a child render does. Source `toString()` / `toTrimmedString()`
  still use the synchronous source serializer. Focused Rules/control/at-rule/
  ruleset tests cover dynamic declarations, controls, nested containers,
  fragment behavior, source parentage, and unchanged source serialization. The
  raw audit remains `new-node: 302` / module-context `375`.
- Earlier pass: direct body at-rule render now prints from `AtRuleBodyState`
  fields (`evaluatedPrelude`, `evaluatedBody`, `hoistToRoot`, and `frames`)
  instead of serializing the evaluated output at-rule object. Public
  `resolve(...)` still returns the owned output at-rule. Focused at-rule/rules
  tests cover dynamic body render, buffer render, source parentage, source
  render-state restoration, and root/hoist behavior. The raw audit remains
  `new-node: 302` / module-context `375`.
- Latest pass: direct unevaluated `Rules.render(...)` no longer calls
  `this.derive().eval(context)`. Document/root renders still eval the source
  root when no root context exists, then restore the incoming render context
  after serialization; fragments render from canonical source rules with
  render-local context and restore that context afterward. The render walker
  now captures returned native child strings when a child does not write into
  the active writer, and `$while` state-mutating iteration render syncs live
  slots before emitting the body. Focused rules/control/at-rule/ruleset/
  reference/render-buffer tests are green. Latest audit: `new-node: 303`,
  `derive: 30`, `with-surface: 41`, `copy-leaves: 31`.
- Latest pass: `$while` render no longer prepares the whole iteration surface
  for ordinary static-name variable mutations. It updates the loop
  `ScopeFrame` live slots directly before body render, then streams the body
  through `Rules.render(...)`. The focused control suite is green and the
  render-buffer frontier remains at two native control iteration render sites.
- Latest measurement pass used built JS artifacts after `@jesscss/plugin-js`
  was rebuilt, with 10 warm iterations per fixture:
  `functions.less` median 25.46ms, `import-reference.less` median 30.19ms,
  `mixins-guards.less` median 31.00ms, `extend-chaining.less` median 20.12ms,
  and `media.less` median 8.54ms. The next broad deletion should prefer mixin
  guard/output or import-reference behavior over media formatting unless a
  regression points elsewhere.
- Latest queue pass added `pnpm run measure:less:hotpath` so real Less fixture
  timing is repeatable. Its first checked run reported `functions.less`
  median 25.72ms, `import-reference.less` median 30.76ms,
  `mixins-guards.less` median 31.61ms, `extend-chaining.less` median 19.79ms,
  and `media.less` median 8.90ms.
- Latest queue pass narrowed `$while` mutation prep again: ordinary dynamic
  variable names now update loop live slots directly once the name evaluates to
  `Any`. Assignments with declaration semantics (`assign`, `setDefined`,
  `throwIfDefined`) still fall back to registration prep.
- Latest queue pass audited the at-rule and ampersand queue items. Body
  at-rule render cannot simply eval the source at-rule without an owned body
  surface because body registration prep can mutate the body `Rules` surface
  and extend/layer registration keys. Ampersand append/template state still has
  no second proven carrier-only fact beyond `hoistToRoot`; selector wrappers
  currently carry real selector semantics.
- Latest queue pass split body at-rule state naming so the direct-render side
  carries an `evalFrame`, and public `resolve(...)` owns the returned-node
  materialization boundary. It also made mixin parameter recursion signatures
  lazy: ordinary parameter binding now keeps live-slot state without building a
  `List` recursion key unless recursion/default-guard handling needs it.
- Latest queue pass re-tested ruleset-as-mixin child ownership. Reusing static
  ruleset body children breaks the complex parent-ampersand / nested array-path
  ruleset mixin fixture, so those child copies remain semantic until a smaller
  ordered placement state can carry that selector-parent context. Hot-path
  timing after this pass: `functions.less` median 26.07ms,
  `import-reference.less` median 31.08ms, `mixins-guards.less` median 31.69ms,
  `extend-chaining.less` median 19.75ms, and `media.less` median 8.56ms.
- Latest queue pass retired `AmpersandAppendPlacementState`; append/hoist output
  now marks the selector directly because no second state fact was proven. Body
  at-rule eval now routes prelude writes, evaluated body storage, and frame
  restore through `AtRuleBodyEvalContextState`, leaving one named seam for the
  next materialization split. Focused mixin tests re-confirmed parameter
  containers and ruleset-as-mixin child copies are still semantic without a new
  placement/slot model. Static audit stayed `new-node: 304`, `derive: 30`,
  `with-surface: 41`, `copy-leaves: 31`. Hot-path timing: `functions.less`
  median 24.79ms, `import-reference.less` median 32.81ms,
  `mixins-guards.less` median 31.88ms, `extend-chaining.less` median 19.43ms,
  and `media.less` median 8.27ms.
- Latest queue pass split body at-rule render state from public resolve
  materialization. `AtRuleBodyState` is now render-only and no longer carries
  the private `evalFrame`; public `resolve(...)` consumes `AtRuleBodyEvalResult`
  directly and returns the owned evaluated at-rule only at that boundary.
  Focused `Reference` ownership tests re-confirmed that source-free scalar
  leaves are reusable but value containers must still be copied before eval to
  keep source values canonical. Static audit stayed `new-node: 304`,
  `derive: 30`, `with-surface: 41`, `copy-leaves: 31`. Hot-path timing was
  noisy/slower than the previous sample: `functions.less` median 26.86ms,
  `import-reference.less` median 42.54ms, `mixins-guards.less` median 34.63ms,
  `extend-chaining.less` median 20.28ms, and `media.less` median 8.58ms; do
  not treat this pass as a runtime speed win.
- Latest queue pass moved body at-rule evaluated prelude lookup into side
  state. Direct render/resolve preload the evaluated prelude on a WeakMap
  instead of assigning it into the temporary derived eval frame before body eval;
  public `eval()` and `resolve(...)` still materialize the owned at-rule prelude
  at their public result boundaries. `getHeaderString(...)` and layer-name
  extraction read the active evaluated prelude side state. Static audit is now
  `new-node: 305`, `derive: 30`, `with-surface: 41`, `copy-leaves: 31`; the
  one-count `new-node` increase is a module-level WeakMap state carrier, not a
  runtime AST node. Hot-path timing: `functions.less` median 26.26ms,
  `import-reference.less` median 29.81ms, `mixins-guards.less` median 32.33ms,
  `extend-chaining.less` median 19.26ms, and `media.less` median 7.98ms.
- Latest queue pass moved body at-rule hoist/frame output facts into side
  state and then collapsed the parallel at-rule body WeakMaps into one small
  `AtRuleBodyRuntimeState`. Direct body render now installs evaluated prelude,
  evaluated body, and hoist/frame facts on render-local side state instead of
  mutating the source at-rule's `hoistToRoot` / `frames`; public `eval()` still
  materializes the public result fields where the API expects them. Added a
  regression proving direct body render leaves source hoist/frame fields
  untouched. Static audit is now `new-node: 303`, `derive: 30`,
  `with-surface: 41`, `copy-leaves: 31`; the module-level state carrier count
  dropped back after map collapse. Hot-path timing: `functions.less` median
  25.89ms, `import-reference.less` median 30.14ms, `mixins-guards.less` median
  30.98ms, `extend-chaining.less` median 18.58ms, and `media.less` median
  7.79ms.

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

1. **Replace mixin parameter container copies only with a real slot model.**

   - Goal: recursion signatures are now lazy. Continue through
     `cloneBoundValue(...)` only if a binding slot can preserve repeated-call
     isolation without owning the container. Focused tests already prove
     pseudo args, calc operands, interpolated names, selector containers,
     parens, quoted values, sequences, declarations, rest params, and at-rule
     preludes must stay isolated across repeated calls.
   - Required proof: guard scope, named args, default params, rest params,
     repeated mixin calls, leaky/non-leaky lookup, source parentage, focused
     perf rerun, and frontier scans.

2. **Split ruleset-as-mixin child ownership with selector-parent placement state.**

   - Goal: a blind static-body reuse breaks complex parent ampersands and
     nested array-path ruleset mixin calls. Do not retry raw child reuse; design
     the smallest ordered placement state that can carry selector-parent context
     before testing declaration-only or selector-free body reuse.
   - Required proof: repeated mixin comments, nested rules, variable lookup,
     reference gates, targeted lookup, source parentage, focused perf rerun,
     and no clone frontier regression.

3. **Design a narrow `ReferenceResultState` before deleting container copies.**

   - Goal: focused tests prove current reference container copies protect source
     values during eval. Do not delete them by pattern; first design a result
     state that can carry reference metadata without reparenting the canonical
     value container.
   - Required proof: variable/declaration/fallback containers stay canonical,
     source-free scalar leaves remain uncopied, rules-like references preserve
     shallow owned surfaces, and no clone/copy frontier regression.

4. **Audit at-rule public-result ownership copies.**

   - Goal: `ownName(...)`, `ownNode(...)`, and `ownRules(...)` still protect
     public `resolve(...)` materialization. Audit them as a family and remove
     only copies that are render-only or scalar-result carrier copies.
   - Required proof: static leaf identity, dynamic prelude/body resolve,
     nested at-rule parentage, root-hoist/layer registration, and
     `audit:node-creation`.

5. **Compare Less hot-path timing after the next real deletion.**

   - Goal: run `pnpm run measure:less:hotpath` after the next real deletion and
     compare the same five fixtures against the latest numbers above before
     claiming runtime progress.
   - Required proof: command output, before/after numbers, chosen surface, and
     why the change should affect real stylesheet eval/render.

6. **Audit at-rule render-local prelude materialization.**

   - Goal: direct body render now uses runtime state for evaluated preludes, but
     `setAtRuleBodyEvalPrelude(...)` still writes public `eval()` output into
     the node value. Confirm whether render/resolve can share a cleaner public
     materialization boundary without breaking direct `eval()` semantics.
   - Required proof: async prelude eval, direct render, public `eval()`,
     public `resolve(...)`, layer-name lookup, and source prelude parentage.

7. **Audit at-rule body runtime-state lifetime.**

   - Goal: `AtRuleBodyRuntimeState` is intentionally small. Check that entries
     are only used for evaluated/rendering at-rule bodies and do not become a
     general AST-v2 storage bin.
   - Required proof: inventory of writers/readers, no stale render-local facts
     after direct render, unchanged collapse output, and updated queue/backlog
     if another state fact is proposed.

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
