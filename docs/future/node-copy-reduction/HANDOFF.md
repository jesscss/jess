# Node Copy Reduction — Handoff

## Open This First

This is the live status and next-work page for the eval/render/copy refactor.
Keep it current enough that an agent can open this file, see where the repo is,
and pick the next honest checkpoint without rebuilding weeks of context.

Use [README.md](./README.md) for the architecture rules. Use this file for the
current state, immediate queue, and verification commands.

## Status Snapshot

- Top priority is complete single-pass eval/render with the smallest honest
  node-creation shape. Regression audits are supporting work; do not let them
  displace checkpoints that prove, shrink, or delete remaining materialized
  output surfaces, wrapper owners, copy/clone paths, or helper bridges.
- Public CSS output APIs use awaited eval/render; `safeCompile(...)` remains
  the explicit tree-surface compatibility/debug API.
- Public `preEval()` and the old `preEvaluated` flag are gone. Registration
  setup is explicit through `prepareRegistration()` and `registrationPrepared`.
- The compiler render phase writes through `Rules.render(...)` into a flat
  buffer. `renderNodeToBuffer(...)`, `renderNodeToWriter(...)`, and
  `renderNodeToString(...)` are internal/test bridges only.
- `Rules.render(...)` no longer derives a second root surface when called on an
  already evaluated `Rules` node. That keeps the public compile path from
  paying for a duplicate evaluated root before buffer serialization.
- `Rules.render(...)` also reuses registration-prepared roots instead of
  deriving again before eval. Direct unevaluated `Rules.render(...)` remains the
  isolated compatibility path that derives before eval.
- `Rules.render(...)` now names that branch as `evalForRender(...)`, so the
  direct unevaluated derive path is explicitly compatibility/debug behavior.
  Public compiler render APIs still prove they enter `Rules.render(...)` with
  evaluated roots.
- Public render APIs now have focused coverage proving `Compiler.render(...)`,
  `renderString(...)`, and `renderToResult(...)` enter `Rules.render(...)` with
  an already evaluated root. Unevaluated `Rules.render(...)` remains a
  compatibility/test path, not the production compile shape.
- Base `Node.render(context)` is direct source serialization. Nodes with
  context-dependent output choose local evaluated output and serialize through
  shared print state.
- `Reference.render(...)` now renders the locally evaluated referenced node
  through that node's native render path, including async referenced values; it
  does not source-serialize the resolved value as a completed output surface.
- `AtRule.render(...)` no longer uses the generic source-output render bridge.
  It evaluates a derived at-rule surface, then writes that at-rule through the
  at-rule/ruleset serializer with active render print state.
- `AtRule.render(...)` now reuses an already evaluated at-rule directly and
  uses a registration-prepared at-rule surface when available. The remaining
  direct unevaluated render path still derives before eval for compatibility.
- `Ruleset.render(...)` no longer uses the generic source-output render bridge.
  It serializes evaluated rulesets through container output and delegates
  nil-selector body output to native `Rules.render(...)`.
- `Ruleset.render(...)` reuses already evaluated rulesets and
  registration-prepared ruleset surfaces. Direct unevaluated render still
  prepares/evals an isolated ruleset surface.
- Ruleset generated body/selector carrier audit is current. The remaining
  ruleset prep/generated surfaces are semantic: `ownSelector` preserves
  source selector parentage while extend/header metadata owns an isolated
  selector, child `Rules` registration reuses the body surface intentionally,
  and header/composed-selector caches stay render-local. Do not collapse these
  into source selectors without a generated-selector state model.
- Nil-selector ruleset render has focused coverage proving the evaluated body
  is rendered through native `Rules.render(...)` for direct and buffer output.
- Evaluated at-rule/ruleset render no longer goes through
  `renderRulesContainerOutput(...)`; that helper is gone. The two container
  nodes call `serializeRulesContainer(...)` directly with active render print
  state, so the remaining work is the actual derived container surface, not a
  wrapper abstraction.
- `Block.render(...)` and `List.render(...)` no longer use the generic
  source-output bridge. They resolve local child values, then serialize through
  their own block/list syntax printers with active render print state.
- `Sequence.render(...)` no longer uses the generic source-output bridge for
  resolved sequence surfaces. Resolved sequences serialize through sequence
  syntax; resolved non-sequence values delegate to that value's native render
  path.
- `Expression.render(...)` and `Operation.render(...)` now use
  `renderResolvedOutput(...)` after local eval/resolve so non-self evaluated
  outputs can use native render while stable self-output remains source syntax.
- `Paren.render(...)`, `Quoted.render(...)`, and `Url.render(...)` use the
  same resolved-output path after wrapper-local value resolution.
- `Negative.render(...)`, `Condition.render(...)`, and
  `DefaultGuard.render(...)` also use `renderResolvedOutput(...)` after local
  evaluation.
- Plain CSS `Call.render(...)` awaits async direct `calc(...)` arguments
  without the old broad source fallback. Nested `calc(...)` direct and buffer
  render now share the same evaluated normalization path used by Less output.
- Dynamic non-string `Call.render(...)` names evaluate locally, then render the
  evaluated result through that result's native render path. Already-evaluated
  fallback calls are treated as finalized call syntax so optional CSS-function
  fallback output does not re-evaluate the fallback name.
- `Call`'s local dynamic-call output helper is named
  `renderEvaluatedCallOutput(...)` so it does not read as the shared
  `renderResolvedOutput(...)` adapter. Keep it local unless call output starts
  sharing behavior with other node families.
- Call dynamic output regression audit is current:
  `renderEvaluatedCallOutput(...)` remains local to `Call`, focused call tests
  cover direct/buffer dynamic non-string output, and optional fallback calls use
  native call output instead of a generic source bridge.
- Dynamic `Call.render(...)` buffer output delegates the caller buffer directly
  to the evaluated output node. It no longer renders the evaluated node to a
  string and then writes that string into the buffer.
- Call dynamic resolve-surface audit is current. `deriveResolveSurface()` still
  protects referenced JS function calls, optional fallback calls, content-node
  calls, and rules-like variable calls from mutating source name/args/parentage;
  focused tests prove source args stay canonical and fallback output is derived
  without cloning the source call. The stale unsafe assertion in
  `Call.resolve(...)` is gone.
- `JsExpression.render(...)` and `StyleImport.render(...)` now use
  `renderResolvedOutput(...)` after local evaluation instead of treating the
  evaluated result as source output.
- `Declaration.render(...)` evaluates/prepares declaration state locally and
  writes evaluated declaration syntax directly. True non-declaration eval
  results now render through that node's native render path. `VarDeclaration`
  eval results intentionally use base source serialization so parameter vars
  keep `$name` syntax; the declaration-local source-output fallback helper is
  gone.
- Declaration eval no longer has separate `withValue(...)` and
  `withImportant(...)` declaration-copy surfaces. Eval uses one lazy derived
  declaration surface only when mutation is needed, then updates that surface
  through canonical `set(...)` adoption.
- Declaration preparation derivation audit is current. The remaining
  `prepareRegistration(...)` derivation is required isolation: registration
  prep normalizes assignment/name lookup state, while render/resolve must leave
  the canonical source declaration unprepared and unevaluated.
- Declaration prep state model follow-up is closed for now. The focused
  assignment/source-isolation tests still require one derived declaration prep
  surface because assignment normalization rewrites value/name/options while the
  source declaration and its value subtree stay unprepared. Reopen only with a
  concrete side-state model for prepared name/assignment data.
- `Selector.render(...)`, `Interpolated.render(...)`, and
  `InterpolatedSelector.render(...)` now use `renderResolvedOutput(...)` after
  their selector/string-specific local resolution.
- `SelectorCapture.render(...)` resolves the selector payload locally and
  renders that selector through its native render path instead of the generic
  source-output bridge.
- `packages/core/src/define-function.ts` focused lint debt is clean. Future
  function argument-surface work should not reintroduce unsafe metadata casts
  or unused validation paths.
- `renderEvalOutput(...)`, `writeRootAwareEvalOutput(...)`, and
  `renderChosenOutput(...)` are gone. Current local eval/resolve render paths
  use native streaming or native source serialization.
- Remaining `renderSourceOutput(...)` sites are classified:
  - `renderSourceOutput(...)` is private to `tree/util/render-buffer.ts`;
  - `renderResolvedOutput(...)` is the narrow adapter for a caller that has
    already chosen an evaluated output node and needs native render delegation
    when that output is not the source node;
  - named wrapper bridge surfaces have been removed; do not add another helper
    family around these two source/resolved-output roles.
- Render helper placement remains in `tree/util/render-buffer.ts` because the
  helper depends only on context, print state, and buffer shapes. Do not move it
  into a node module that would require importing evaluated node classes.
- Current production `renderSourceOutput(...)` call sites are private to
  `tree/util/render-buffer.ts`: the internal same-node fallback inside
  `renderResolvedOutput(...)`. Base `Node.render(...)` owns source
  serialization directly.
- Final expression-like helper audit is complete: keep
  `renderResolvedOutput(...)` as the single local-eval output adapter. It exists
  only to delegate different resolved nodes to their native render path and to
  fall back to source syntax when evaluation stays on the same finalized
  surface.
- Resolved-output helper import audit is current: remaining production callers
  are expression/wrapper/selector/import-style nodes that perform local
  eval/resolve before choosing output. `Call` has its own local
  `renderEvaluatedCallOutput(...)` helper and no longer shares this name.
- Resolved-output remaining caller audit is current. `JsExpression.render(...)`
  and `StyleImport.render(...)` now delegate evaluated output directly to the
  chosen node's native render path. The remaining production
  `renderResolvedOutput(...)` callers are syntax-preserving wrappers/selectors
  that may return themselves and therefore still need the same-surface source
  fallback unless a smaller same-node branch replaces the helper.
- `DefaultGuard.render(...)` and `Condition.render(...)` no longer use
  `renderResolvedOutput(...)`; they always choose a `Bool`, so render delegates
  directly to that native output node.
- `Negative.render(...)` and `Expression.render(...)` no longer use
  `renderResolvedOutput(...)`; both choose evaluated child/result nodes and
  delegate directly to those nodes' native render paths.
- Expression-like native delegation regression audit is current: direct string
  render and buffer render for expression/wrapper nodes choose the same locally
  evaluated output, including async expression-like cases covered by
  `node-render-buffer.test.ts`.
- Base source render helper boundary audit is complete: base `Node.render(...)`
  owns source serialization directly; `renderSourceOutput(...)` is no longer a
  public helper surface.
- Base source subclasses audit is complete: no redundant source-only subclass
  render override remains. `Comment`, `Any`, `Anonymous`, `Nil`, and `Rest`
  use inherited base source render; `Combinator` rides the selector render path.
  `Collection` and `RawRules` intentionally opt back into base render because
  they inherit from context-dependent `Rules`.
- Plain source-only `Comment` nodes use inherited base render; source-only
  subclasses should not keep local render overrides unless they inherit from a
  context-dependent base like `Rules`. Base render owns the same
  invisible/full-render gate as source serialization.
- `Collection` and `RawRules` are the remaining intentional source-only
  overrides because they inherit from context-dependent `Rules`; both delegate
  explicitly to base `Node.render(...)`.
- Context-dependent source override regression audit is current:
  `Collection` and `RawRules` are still the only source-only subclasses that
  use `Node.prototype.render.call(...)` to opt out of inherited `Rules.render`.
- Invisible side-effect nodes share `renderInvisibleEffect(...)`; the old
  no-output helper split is gone.
- `$if`, `$for`, and `$while` avoid materializing control-wrapper output before
  buffer render. `$for` and `$while` stream per iteration through direct
  `Rules.render(...)` calls.
- Control direct-string render uses one local flat-buffer adapter so direct
  output keeps the same per-iteration newline behavior as buffer output.
- `Rules.render(context)` keeps the root CSS-document newline but trims one
  trailing rule separator for non-root direct string fragments; buffer render
  preserves the full emitted fragment text for aggregation.
- `$if` selected-branch render now calls branch `Rules.render(context)` for the
  trimmed branch block and writes that text into the caller buffer; it no
  longer explicitly evals the branch and serializes the completed output.
- Unmatched `$if` eval output now uses the same generated empty `Rules`
  surface as empty loop output; it does not inherit source control-node state.
- Loop state is frame-backed: `$while` mutation uses a live `ScopeFrame`, and
  `$for` / `$while` reuse canonical direct body children without reparenting.
- Loop eval output grouping wrappers are generated containers. They do not
  inherit source location/options or copy function registries. Runtime
  iteration/state surfaces still preserve function registries because they
  participate in lookup while rendering/evaluating the body.
- `$for` loop-body registration prep is lazy and only runs once an iteration
  exists. Empty `$for` output and false `$while` output do not prepare unused
  body declarations.
- Context shadow state is intentional runtime state:
  `ScopeFrame.liveSlotsByName`, `ScopeFrame.fallbackFrame`, and
  `Context.rulesContext` remain the kept model.
- Recent scope/context cleanup is consolidated across `$while`, `AtRule`,
  `Reference`, mixin calls, and `Rules` registration/eval. Do not re-expand
  duplicated save/restore scaffolding without a focused failing test.
- Ordinary temporary `rulesContext` switches share `tree/util/context.ts`;
  manual restore callbacks remain only where a larger custom flow needs them.
- Node-copy, render-buffer, and materialization frontier scans cover production
  package `src` trees across the monorepo. The node-copy frontier is clean for
  deep copy/clone and ordinary production `.copy()` outside infrastructure.
- Generated selector/output ownership has focused guards for extend,
  `:is(...)`, pseudo args, framed ampersands, and ruleset headers. Keep owned
  placement surfaces only where parentage/visibility tests prove they are
  semantic.
- Generated selector/output ownership audit is current. The remaining owned
  selector placements are not just serializer carriers: they preserve source
  parentage while generated wrappers own their children. Existing focused
  guards cover implicit `:is(...)` ampersands, framed ampersands,
  extend-boundary output, pseudo args, and ruleset headers.
- Selector constructor ownership audit is current. `SelectorList`,
  `ComplexSelector`, `CompoundSelector`, and attribute/pseudo selector output
  still need owned changed surfaces so resolved selector render does not
  reparent unchanged canonical selector children.
- Selector ownership model follow-up is current. A shared helper would only
  hide the same ownership decision today; the next real reduction requires a
  different generated-selector state model that preserves canonical source
  parentage without per-constructor child ownership.
- Selector generated-state design checkpoint is current. The target is a small
  side-state record beside a canonical selector, carrying only per-placement
  evaluated children, visibility/extend metadata, selector-bit library,
  hoist/root placement, and composed-header cache. It must not become AST v2 or
  reparent source selector leaves. Until that model exists, the constructor
  ownership copies remain the safe boundary.
- Function-call cleanup keeps plain positional JS args canonical. Metadata
  functions keep one owned raw/callback arg-list surface because `this.rawArgs`
  is a documented mutable runtime API; `Call` no longer creates a second
  pre-copy before `callWithContext(...)`.
- Function/mixin argument-surface audit is current. Plain positional JS
  function calls pass their argument containers directly. Metadata-backed
  functions keep one owned `rawArgs` list because `this.rawArgs` is mutable
  user-code API surface; focused tests prove both sides of that split.
- Mixin argument binding audit is current. Param/default/rest/`@arguments`
  binding uses live `ScopeFrame` slots and `cloneBoundValue(...)` only owns
  non-reusable bound values; focused tests cover scalar reuse, container
  ownership, rest expansion, `@arguments`, and declaration-lookup bypass.
- Mixin output wrapper audit is current. The remaining derived `Rules` surfaces
  in mixin output are semantic runtime owners, not plain serializer carriers:
  they carry lookup visibility, mixin-output gating, reference-mode clearing,
  definition/caller `ScopeFrame` chains, guard isolation, and repeated output
  placement without stamping call-site parents onto source bodies. A future
  render-buffer output-slot model may replace some of these wrappers, but do
  not delete them as a local cleanup.
- Mixin output slot design checkpoint is current. The target replacement for
  generated mixin `Rules` wrappers is an output-slot record carrying source
  body, evaluated placement children, scope frame, visibility/reference gates,
  rule index, and caller fallback. It should stream through existing render
  paths and register only per-placement lookup state; it must not become a
  parallel output tree.
- `@charset` output-order handling lives in `Rules` registration prep.
  `Any.prepareRegistration()` is mark-only again.
- Pending declaration-name prep is a narrow lookup-identity retry, not a hidden
  tree-wide pre-eval pass. Pending non-declaration identity prep is a
  source-ordered one-shot pass.
- Package type-debt audit is current: `pnpm --filter @jesscss/core exec tsc
  --noEmit --pretty false` still fails on broad node structural typing debt
  after async render/resolve work. The helper-local `render-buffer.ts` narrowing
  error, less-parser `TreeContext` type imports, less-parser `Negative` value
  import, and one less-parser parser-boundary lint/type slice are fixed;
  remaining red is a separate typed-node frontier, with large buckets in
  define-function tests and selector/sequence structural assignability.

## Remaining Node-Creation Surfaces

This list is the current proof target for single-pass completion. Treat it as
the source of truth for what still needs shrinking or a written semantic reason
to stay.

| Surface | Current shape | Next proof |
| --- | --- | --- |
| `Rules.render(...)` source roots | Public compile renders already evaluated roots; registration-prepared roots are reused. Direct unevaluated `Rules.render(...)` still derives before eval for compatibility/direct node tests. | Keep this compatibility path isolated; do not treat it as the production compile target. |
| `AtRule.render(...)` | Reuses evaluated/prepared at-rule surfaces when available; direct unevaluated render still derives before eval for compatibility. | Split required body/prelude mutation from direct unevaluated compatibility rendering. |
| `Ruleset.render(...)` | Reuses evaluated/prepared ruleset surfaces; unevaluated rulesets still prepare/eval an isolated surface, evaluated rulesets serialize directly, nil-selector output delegates to body render. | Prove which generated selector/body surfaces are semantic and which are only serializer carriers. |
| `Declaration.render(...)` | Prepares/evals one isolated declaration surface for assignment/name prep and value/important mutation; true non-declaration outputs delegate to native render. | Keep source isolation unless a new state model replaces preparation mutation. |
| Function/mixin argument metadata | Plain JS calls pass direct args; metadata-backed calls keep one owned raw/callback argument surface for mutable `this.rawArgs`. | Keep guarding plain direct args and the single metadata-owned surface; do not add another pre-copy. |
| Generated selector/output ownership | Extend, `:is(...)`, pseudo args, framed ampersands, and ruleset headers still create owned placement surfaces in focused, tested cases. | Keep unless new parentage/visibility/output tests prove a specific placement is a carrier only. |

## Node-Creation Hotspots

Run `pnpm run audit:node-creation` before and after a node-creation reduction
checkpoint. The script is intentionally an audit, not a gate: it ranks likely
surfaces so the next pass attacks the largest honest runtime paths first.

Current top files by static surface count:

1. `packages/core/src/tree/rules.ts`
2. `packages/core/src/tree/declaration.ts`
3. `packages/core/src/tree/call.ts`
4. `packages/core/src/tree/import-style.ts`
5. `packages/core/src/tree/dimension.ts`
6. `packages/core/src/tree/at-rule.ts`
7. `packages/core/src/tree/reference.ts`
8. `packages/core/src/tree/ampersand.ts`
9. `packages/core/src/tree/ruleset.ts`

Current top surface kinds: `new` node construction, `with*` output surfaces,
`derive*`/`.derive(...)` surfaces, `copyWithReusableLeaves(...)`, and the
remaining source/resolved output helper calls. The old container output helper
count is now zero; production `source-output` audit count is down to the base
source render site only. Production `resolved-output` audit count is 7 after
removing the Bool-only guard/condition callers, the negative/expression
wrappers, and the direct eval-output `JsExpression` / `StyleImport` callers.

## Immediate Queue

This is a pop queue. Keep at least seven concrete items here. If the top item
is completed, remove it and promote or split enough backlog work to keep the
queue full. If an item is too broad to complete in one checkpoint, replace it
with the smallest honest next checkpoint and move the broader theme to the
backlog below.

1. **Call dynamic state model follow-up.**
   - Goal: replace the remaining call resolve surface only if a smaller state
     object can hold evaluated dynamic name/args/content plus optional fallback
     syntax without reparenting source children.
   - Required proof: current dynamic/fallback JS function tests plus source
     parent assertions.

2. **At-rule direct render compatibility audit.**
   - Goal: classify the remaining unevaluated `AtRule.render(...)` derive path
     the same way as `Rules.render(...)`, separating production evaluated output
     from direct node API compatibility.
   - Required proof: focused at-rule render tests, public compiler render
     coverage when relevant, and a call-site scan.

3. **Declaration prepared-state design checkpoint.**
   - Goal: if declaration prep is revisited, design the smallest side-state
     shape for prepared name/assignment data before touching code.
   - Required proof: source-isolation tests plus merged assignment and custom
     property render tests.

4. **Ruleset generated-state design checkpoint.**
   - Goal: design the smallest state object that could replace `ownSelector`
     metadata copies while preserving source parentage, extend matching, and
     header rendering.
   - Required proof: ruleset header/cache tests plus selector parentage guards.

5. **Syntax-wrapper same-node render branch.**
   - Goal: replace `renderResolvedOutput(...)` for `Paren`, `Quoted`, `Url`,
     `Operation`, `Interpolated`, and selector wrappers only if each node can
     keep its same-node source syntax fallback locally without recursion.
   - Required proof: direct/buffer parity and source-parent tests for every
     changed wrapper family.

6. **Generated selector state spike.**
   - Goal: prototype one non-production helper or failing test that demonstrates
     how generated selector state would preserve source parentage without owned
     child copies.
   - Required proof: no behavior change unless the focused selector parentage
     tests prove the replacement.

7. **Mixin output-slot spike.**
   - Goal: prototype the smallest non-production output-slot type or failing
     test for replacing a generated mixin `Rules` wrapper.
   - Required proof: focused mixin output/guard/caller-fallback tests before any
     behavior change.

## Backlog

These are remaining architecture themes and supporting guard work, not the
current top-priority queue. Promote one only after turning it into a concrete
checkpoint.

- **Regression guard scans.** Keep the recent declaration, source-output,
  resolved-output, context-dependent source override, expression-like
  delegation, and Less parser type-frontier scans available as proof when a
  single-pass checkpoint touches those surfaces.
- **Typed node structural frontier.** Continue splitting the remaining
  `tsc --noEmit` failures by node-family shape, but do not let type cleanup
  displace runtime node-creation reduction unless it directly unlocks a
  materialization/copy deletion.

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

1. Read the relevant source and focused tests before editing.
2. Make the smallest behavior-preserving change.
3. Run focused proof first.
4. Run the nearest broader verification.
5. Update this handoff if the current state or immediate queue changed.
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
- fixture-expectation changes that are not tied to an explicit Jess behavior
  decision
