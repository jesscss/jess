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
- Base `Node.render(context)` is direct source serialization. Nodes with
  context-dependent output choose local evaluated output and serialize through
  shared print state.
- `Reference.render(...)` now renders the locally evaluated referenced node
  through that node's native render path, including async referenced values; it
  does not source-serialize the resolved value as a completed output surface.
- `AtRule.render(...)` no longer uses the generic source-output render bridge.
  It evaluates a derived at-rule surface, then writes that at-rule through the
  at-rule/ruleset serializer with active render print state.
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
  results now render through that node's native render path; the
  declaration-local source-output fallback helper is gone.
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
  use native streaming or `renderSourceOutput(...)`.
- Remaining `renderSourceOutput(...)` sites are classified:
  - base `Node.render(...)` is source serialization infrastructure;
  - `renderResolvedOutput(...)` is the narrow adapter for a caller that has
    already chosen an evaluated output node and needs native render delegation
    when that output is not the source node;
  - named wrapper bridge surfaces have been removed; do not add another helper
    family around these two source/resolved-output roles.
- Render helper placement remains in `tree/util/render-buffer.ts` because the
  helper depends only on context, print state, and buffer shapes. Do not move it
  into a node module that would require importing evaluated node classes.
- Current production `renderSourceOutput(...)` call sites are: base
  `Node.render(...)` and the internal same-node fallback inside
  `renderResolvedOutput(...)`.
- Final expression-like helper audit is complete: keep
  `renderResolvedOutput(...)` as the single local-eval output adapter. It exists
  only to delegate different resolved nodes to their native render path and to
  fall back to source syntax when evaluation stays on the same finalized
  surface.
- Resolved-output helper import audit is current: remaining production callers
  are expression/wrapper/selector/import-style nodes that perform local
  eval/resolve before choosing output. `Call` has its own local
  `renderEvaluatedCallOutput(...)` helper and no longer shares this name.
- Expression-like native delegation regression audit is current: direct string
  render and buffer render for expression/wrapper nodes choose the same locally
  evaluated output, including async expression-like cases covered by
  `node-render-buffer.test.ts`.
- Base source render helper boundary audit is complete: keep
  `renderSourceOutput(...)` only for source-owned syntax and explicit
  source-output fallbacks, not generic evaluated output serialization.
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
  overrides because they inherit from context-dependent `Rules`; both now
  delegate explicitly to base `Node.render(...)` instead of calling
  `renderSourceOutput(...)` directly.
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
- Function-call cleanup keeps plain positional JS args canonical. Metadata
  functions keep one owned raw/callback arg-list surface because `this.rawArgs`
  is a documented mutable runtime API; `Call` no longer creates a second
  pre-copy before `callWithContext(...)`.
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
| `Rules.render(...)` source roots | Unevaluated `Rules` still derive before eval so source trees are not mutated. Already evaluated roots now render directly. | Prove whether public compile always reaches render with an evaluated root; if yes, keep unevaluated render as compatibility only. |
| `AtRule.render(...)` | Derives an at-rule surface, evaluates it, then calls `serializeRulesContainer(...)` with active render print state. | Split required body/prelude mutation from direct container streaming. |
| `Ruleset.render(...)` | Runs `prepareRegistration(...)` + `evalNode(...)`; evaluated rulesets call `serializeRulesContainer(...)` directly, nil-selector output delegates to body render. | Prove which generated selector/body surfaces are semantic and which are only serializer carriers. |
| `Declaration.render(...)` | Prepares/evals a declaration surface; true non-declaration outputs delegate to native render. | Reduce `withValue(...)` / `withImportant(...)` eval surfaces where semantic state permits. |
| Function/mixin argument metadata | Metadata-backed calls keep one owned raw/callback argument surface for mutable user-code APIs. | Keep this surface only for documented mutation APIs; plain calls should remain direct. |
| Generated selector/output ownership | Extend, `:is(...)`, pseudo args, framed ampersands, and ruleset headers still create owned placement surfaces in focused cases. | Remove only with parentage/visibility/output tests. |

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
source render site only.

## Immediate Queue

This is a pop queue. Keep at least seven concrete items here. If the top item
is completed, remove it and promote or split enough backlog work to keep the
queue full. If an item is too broad to complete in one checkpoint, replace it
with the smallest honest next checkpoint and move the broader theme to the
backlog below.

1. **Generated selector/output ownership reduction.**
   - Goal: audit generated selector placement, extend output, `:is(...)`,
     pseudo args, framed ampersands, and ruleset headers for avoidable owned
     output surfaces.
   - Required proof: parentage/visibility/output tests for each removed or kept
     surface.

2. **Function/mixin argument surface reduction.**
   - Goal: keep metadata-backed raw/callback arg ownership only where user-code
     mutation semantics require it, and ensure plain calls do not pre-copy or
     clone argument trees.
   - Required proof: focused `Call` / define-function / mixin tests and
     node-copy frontier scan.

3. **Helper bridge deletion pass.**
   - Goal: remove or narrow `renderSourceOutput(...)`,
     `renderResolvedOutput(...)`, `renderNonDeclarationOutput(...)`, and local
     wrapper helpers once their remaining callers have been reduced or proven.
   - Required proof: helper call-site scans plus focused direct/buffer render
     parity tests.

4. **Unevaluated `Rules.render(...)` compatibility audit.**
   - Goal: decide whether unevaluated root/body render still needs to derive
     before eval, or whether all production callers can render only evaluated
     rules.
   - Required proof: public output API call graph plus focused root/body render
     tests.

5. **Declaration eval `with*` surface reduction.**
   - Goal: reduce `Declaration.evalNode(...)` `withValue(...)` /
     `withImportant(...)` surfaces where the evaluated value can be streamed or
     represented as narrow runtime state instead of another declaration node.
   - Required proof: focused declaration merge/interpolation/custom-property
     tests plus node-creation audit before/after output.

6. **At-rule/ruleset derived surface proof.**
   - Goal: now that the container helper is gone, prove which remaining
     at-rule/ruleset derived surfaces are mutation isolation versus serializer
     carriers, then reduce only the latter.
   - Required proof: focused at-rule/ruleset/nesting tests, node-creation audit
     before/after, and parentage checks for any removed surface.

7. **Resolved-output helper caller audit.**
   - Goal: inspect the remaining `renderResolvedOutput(...)` callers and split
     them into same-surface source syntax, native delegation, or removable
     wrapper cases.
   - Required proof: helper call-site scan and focused direct/buffer parity
     tests for any changed node family.

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
