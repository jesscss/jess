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
  frame-clearing output is now carried on the explicit eval context state
  before being written to runtime output, so state construction no longer
  mutates the runtime map as a side effect. The next at-rule work should split
  body registration/eval responsibilities enough to delete the remaining
  derived body surface, not revisit leaf at-rules or re-add registration facts
  to render state.
- At-rule body eval now separates nestable body registration prep into
  `AtRuleBodyEvalPrepState`; `evalBodyNode(...)` consumes prepared body state
  instead of open-coding prepare/push/register setup. Static root-only body
  at-rules may source-render inside otherwise static rulesets only when
  hoist/collapse behavior is inactive. When hoist is active, root-only body
  at-rules are hoisted in their sibling position: earlier root-only at-rules
  can emit before the containing ruleset body, and later root-only at-rules
  emit after already-rendered declarations.
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
  render/resolve at the same time.
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
- Reference render still uses `evalNode(context)` and then native rendering of
  the resolved node for containers, declaration/runtime-binding values, and
  rules-like values. Scalar source-free fallback render now has a text-only
  finalization path that avoids public result metadata; declaration and
  variable lookup scalar leaves now use that same text-only path during render.
  Runtime-binding scalars still need their own proof.
- Mixin output slot metadata can map placement output children back to their
  source body child with `getMixinOutputSourceChild(...)`, and can collect
  mapped source children in output order with `getMixinOutputSourceChildren(...)`.
  Lookup still searches owned output children; the source map is for
  diagnostics/order/visibility proof, not a replacement search surface. Slot
  attachment validates source order/output ownership and indexes
  output-child-to-source lookup directly.
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
- A `MixinOutputSlot` type now exists as an explicit compatibility record on
  generated mixin-output `Rules` wrappers. Slot-aware helpers cover
  `isMixinOutput` / visibility checks in `Rules`, `Reference`, serializer
  gating, and registry child-search. Registry lookup keeps entry visibility,
  node visibility, optional candidates, and targeted mixin-output access as
  distinct helper concepts; do not collapse them back into one coalesced
  visibility check.
- `MixinOutputSlot.childSegments` records the canonical source child and, when
  the ordered output position exists, the owned output child for that
  placement. Lookup still must not switch to source segments blindly; output
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
`copy-leaves: 31`, `clone-leaves: 0`, module-context count `376`,
eval-context count `28`, prepare-registration count `2`, resolve-context count
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
  `.set()` helper use, broad clone-leaves helpers, and temporary append
  placement state.
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

## Recent Pass History

Keep this table short. Add the newest row at the top. `#1` is the latest pass.
Move old detail to git history or a dedicated perf log if we need a deeper
trend.

| # | Focus | Main result |
| --- | --- | --- |
| 1 | At-rule eval record / scalar declaration text / static var body | Added the first explicit at-rule body eval record around the remaining derived frame. Reference render now text-only finalizes reusable declaration/variable scalar leaves. Mixin slot source-child collection uses the direct source map. Static rulesets source-render invisible variable children without prep/eval. |
| 2 | Assignment render prep / scalar reference text / slot lookup | Declaration assignment render keeps authored values parented while normalizing `+:`, `&,:`, `&_:`, and `?:` for render. Scalar fallback reference render avoids public result metadata. Mixin output slots now index output-child-to-source lookup. |
| 3 | Declaration render prep / mixin slot guard / queue audit | Declaration render prep now uses read-only source-backed registration state instead of copying name/value/important parts. Mixin output slot attachment validates source segment order and output child ownership. |
| 4 | At-rule result state / hoist-order proof / mixin mapping guard | At-rule body eval results now carry evaluated body/output facts explicitly into render/resolve state. Hoist-active static body at-rules are proven to bypass source-direct ruleset render while preserving in-place sibling order. |
| 5 | Static root-only at-rule source render / mixin source mapping | Nestable at-rule body registration prep now flows through `AtRuleBodyEvalPrepState`; static root-only body at-rules can source-render in static rulesets when hoist/collapse is inactive. |
| 6 | At-rule frame-state split / selector collapse helper | Root-hoist frame-clearing output now lives on explicit body eval state until consumed; selector collapse family shares `ownCollapsedSourceChild(...)`. |
| 7 | At-rule explicit body runner / fallback list reuse | Removed the pending at-rule eval-frame `WeakMap`; direct body render now passes explicit eval state into the body runner. Source-free static fallback `List` values now reuse the inert list container. |

## Metrics Snapshot

Static audit is useful for regression detection, not proof of speed. Hot-path
timing is noisy; compare multiple adjacent runs before calling a change faster
or slower.

Latest static audit:

| `new-node` | `derive` | `with-surface` | `copy-leaves` | `clone-leaves` | module | eval | prepare | resolve |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 304 | 30 | 41 | 31 | 0 | 376 | 28 | 2 | 0 |

Recent hot-path medians. `#1` is the latest pass.

| # | Pass | `functions` | `import-ref` | `mixins-guards` | `extend` | `media` | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | At-rule eval record / scalar declaration text / static var body | 22.44ms | 29.12ms | 31.99ms | 15.73ms | 7.68ms | structural pass; slower than prior sample for several fixtures and still noisy, no speedup claim |
| 2 | Assignment render prep / scalar reference text / slot lookup | 19.62ms | 25.52ms | 29.38ms | 15.18ms | 6.98ms | faster sample but high noise on several fixtures; structural wins are narrower assignment/reference/slot surfaces |
| 3 | Declaration render prep / mixin slot guard / queue audit | 22.01ms | 28.75ms | 34.57ms | 16.28ms | 8.05ms | source-backed declaration render copies removed; mixed/noisy timing, no broad speedup claim |
| 4 | At-rule result state / hoist-order proof / mixin mapping guard | 21.81ms | 29.61ms | 34.87ms | 18.41ms | 9.65ms | proof/state split pass; noisy sample, no speedup claim |
| 5 | Static root-only at-rule source render / mixin source mapping | 21.05ms | 26.87ms | 31.45ms | 15.49ms | 7.89ms | one static audit count removed; timing is within adjacent noisy band, no broad speedup claim |
| 6 | At-rule frame-state split / selector collapse helper | 21.20ms | 28.46ms | 31.84ms | 16.76ms | 7.71ms | structural cleanup; no confirmed speedup |
| 7 | At-rule explicit body runner / fallback list reuse | 20.32ms | 26.58ms | 30.74ms | 15.67ms | 8.13ms | similar to adjacent samples; structural win is one fewer eval-context surface, not a proven hot-path speedup |

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
- Reference render still shares public result ownership for containers and
  rules-like values. Source-free scalar fallback render is text-only now, but
  declaration/runtime-binding scalar references need separate proof before they
  can skip public result metadata.
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

1. **Move one at-rule body eval responsibility out of the derived frame.**

   - Goal: use `AtRuleBodyEvalRecord` to carry one concrete body eval fact that
     currently lives on the derived eval frame. Do not delete the frame until
     body registration, frame stack, layer/extend state, and public result
     ownership are all accounted for.
   - Required proof: dynamic body render, public `resolve(...)`, source
     prelude/body parentage, thrown/rejected cleanup, and no runtime-map side
     effects.

2. **Extend reference text-only finalization to runtime-binding scalars.**

   - Goal: declaration/variable lookup scalar leaves now skip public result
     metadata during render. Try the same only for runtime-binding scalar leaves.
     Keep containers/rules-like values owned and keep public `resolve(...)`
     unchanged.
   - Required proof: source containers canonical, async live slots restore
     context, scalar leaf parentage unchanged, and rules-like refs still own
     shallow public results.

3. **Shrink declaration assignment temporary expression ownership.**

   - Goal: the current assignment render path owns temporary expression inputs
     to preserve source parentage. Reuse source-free scalar inputs directly only
     if the temporary expression can avoid adopting them or the leaf is already
     explicitly reusable.
   - Required proof: `+:`, `&,:`, `&_:`, `?:`, custom values, contextual
     `!important`, source value parentage, and render-buffer parity.

4. **Add one mixin-output slot fact without changing lookup ownership.**

   - Goal: `sourceByOutput` now supports direct child and source-child-list
     diagnostics. Add the next slot fact only if it removes a real scan or
     duplicated visibility/order proof, while lookup still searches owned output
     children.
   - Required proof: targeted property/mixin lookup, nested mixin scopes, direct
     comments, reference gates, source body order, and repeated placement.

5. **Prototype ampersand append/template placement state if tests prove it.**

   - Goal: the design shape is documented. Build a tiny record only if existing
     append/template tests prove a selector wrapper copy can be replaced without
     losing top-level selector text, validation facts, hoist/root markers, or
     source parentage.
   - Required proof: complex parent ampersands, nested selector lists, append
     versus hoist behavior, template validation, and generated output
     ownership.

6. **Expand source-direct ruleset render only with another static no-effect body shape.**

   - Goal: static declaration/comment/leaf-at-rule/invisible-var bodies already
     source-render. Add exactly one more static body shape only if it has no
     registration, extend, hoist, nil-selector, or frame effects.
   - Required proof: source body parentage, nested output parity, fixture subset,
     and no source-direct render for dynamic/hoisted bodies.

7. **Measure and record after the next materialization or lookup reduction.**

   - Goal: use `measure:less:hotpath:record` after the next real deletion or
     lookup reduction so trend history captures the checkpoint, not just a
     one-off console sample.
   - Required proof: recorded JSONL row, readable table update, static audit,
     and note about expected versus observed impact.

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
