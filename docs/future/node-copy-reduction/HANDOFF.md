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
- `DefaultGuard.render(...)` and `Condition.render(...)` no longer use
  `renderResolvedOutput(...)`; they always choose a `Bool`, so render delegates
  directly to that native output node.
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
- Function-call cleanup keeps plain positional JS args canonical. Metadata
  functions keep one owned raw/callback arg-list surface because `this.rawArgs`
  is a documented mutable runtime API; `Call` no longer creates a second
  pre-copy before `callWithContext(...)`.
- Function/mixin argument-surface audit is current. Plain positional JS
  function calls pass their argument containers directly. Metadata-backed
  functions keep one owned `rawArgs` list because `this.rawArgs` is mutable
  user-code API surface; focused tests prove both sides of that split.
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
| `Rules.render(...)` source roots | Public compile renders already evaluated roots. Unevaluated `Rules.render(...)` still derives before eval for compatibility/direct node tests. | Keep this compatibility path isolated; do not treat it as the production compile target. |
| `AtRule.render(...)` | Reuses evaluated/prepared at-rule surfaces when available; direct unevaluated render still derives before eval for compatibility. | Split required body/prelude mutation from direct unevaluated compatibility rendering. |
| `Ruleset.render(...)` | Runs `prepareRegistration(...)` + `evalNode(...)`; evaluated rulesets call `serializeRulesContainer(...)` directly, nil-selector output delegates to body render. | Prove which generated selector/body surfaces are semantic and which are only serializer carriers. |
| `Declaration.render(...)` | Prepares/evals one lazy declaration surface when value/important mutation is needed; true non-declaration outputs delegate to native render. | Split remaining declaration preparation derivation from assignment-normalization semantics. |
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
source render site only. Production `resolved-output` audit count is 11 after
removing the Bool-only guard/condition callers.

## Immediate Queue

This is a pop queue. Keep at least seven concrete items here. If the top item
is completed, remove it and promote or split enough backlog work to keep the
queue full. If an item is too broad to complete in one checkpoint, replace it
with the smallest honest next checkpoint and move the broader theme to the
backlog below.

1. **Mixin argument binding surface audit.**
   - Goal: inspect `Rules.evalCall(...)` argument binding, rest params, and
     `@arguments` construction for avoidable copies now that function-call
     surfaces are classified.
   - Required proof: focused mixin argument tests plus node-copy frontier scan.

2. **Call dynamic render surface reduction.**
   - Goal: inspect `Call.deriveResolveSurface()` for dynamic-name render and
     resolve paths, and remove copies that are only protecting source syntax
     when native render can stream the result directly.
   - Required proof: focused call dynamic-name direct/buffer tests and
     source-parent assertions.

3. **Unevaluated `Rules.render(...)` compatibility narrowing.**
   - Goal: keep direct unevaluated `Rules.render(...)` support only where node
     tests or public API compatibility require it, and avoid adding new
     production callers.
   - Required proof: call-site scan plus focused `Rules` render tests.

4. **Declaration preparation derivation audit.**
   - Goal: inspect the remaining `Declaration.prepareRegistration(...)`
     derivation and assignment-normalization node creation, separating required
     lookup identity mutation from output-only carrier surfaces.
   - Required proof: focused assignment merge/conditional assignment tests plus
     node-creation audit before/after output.

5. **Ruleset evaluated render reuse proof.**
   - Goal: mirror the at-rule proof for `Ruleset.render(...)`: already
     evaluated rulesets should serialize the existing surface, while direct
     unevaluated compatibility rendering stays isolated.
   - Required proof: focused ruleset render/buffer tests and call-count guard
     proving evaluated render does not re-enter eval.

6. **Resolved-output wrapper narrowing.**
   - Goal: inspect the remaining wrapper-like helper callers
     (`Negative`, `Expression`, `Paren`, `Quoted`, `Url`, `JsExpression`) and
     remove the adapter only where the evaluated output cannot be the same
     source syntax surface.
   - Required proof: focused direct/buffer parity tests for each changed node
     family and helper call-site scan.

7. **Selector ownership model follow-up.**
   - Goal: design a smaller generated-selector ownership model only if it can
     preserve canonical source child parentage without per-constructor
     copy-with-reusable-leaves scaffolding.
   - Required proof: the existing selector parentage tests plus new tests for
     whichever constructor path changes.

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
