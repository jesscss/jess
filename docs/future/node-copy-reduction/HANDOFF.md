# Node Copy Reduction — Handoff

## Open This First

This is the live status and next-work page for the eval/render/copy refactor.
Keep it current enough that an agent can open this file, see where the repo is,
and pick the next honest checkpoint without rebuilding weeks of context.

Use [README.md](./README.md) for the architecture rules. Use this file for the
current state, immediate queue, and verification commands.

## Status Snapshot

- Public CSS output APIs use awaited eval/render; `safeCompile(...)` remains
  the explicit tree-surface compatibility/debug API.
- Public `preEval()` and the old `preEvaluated` flag are gone. Registration
  setup is explicit through `prepareRegistration()` and `registrationPrepared`.
- The compiler render phase writes through `Rules.render(...)` into a flat
  buffer. `renderNodeToBuffer(...)`, `renderNodeToWriter(...)`, and
  `renderNodeToString(...)` are internal/test bridges only.
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
- Evaluated at-rule/ruleset container output shares
  `renderRulesContainerOutput(...)`; this is a narrow serializer adapter, not a
  second render abstraction family.
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
- Plain CSS `Call.render(...)` awaits async direct `calc(...)` arguments
  without the old broad source fallback. Nested `calc(...)` direct and buffer
  render now share the same evaluated normalization path used by Less output.
- Dynamic non-string `Call.render(...)` names evaluate locally, then render the
  evaluated result through that result's native render path. Already-evaluated
  fallback calls are treated as finalized call syntax so optional CSS-function
  fallback output does not re-evaluate the fallback name.
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
  - expression-like nodes still on it are the remaining concrete cleanup
    queue;
  - `renderResolvedOutput(...)` is the narrow adapter for a caller that has
    already chosen an evaluated output node and needs native render delegation
    when that output is not the source node;
  - named wrapper bridge surfaces have been removed; do not add another helper
    family around these two source/resolved-output roles.
- Plain source-only `Comment` nodes use inherited base render; source-only
  subclasses should not keep local render overrides unless they inherit from a
  context-dependent base like `Rules`. Base render owns the same
  invisible/full-render gate as source serialization.
- `Collection` and `RawRules` are the remaining intentional source-only
  overrides because they inherit from context-dependent `Rules`; both now
  delegate explicitly to base `Node.render(...)` instead of calling
  `renderSourceOutput(...)` directly.
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

## Immediate Queue

This is a pop queue. Keep at least seven concrete items here. If the top item
is completed, remove it and promote or split enough backlog work to keep the
queue full. If an item is too broad to complete in one checkpoint, replace it
with the smallest honest next checkpoint and move the broader theme to the
backlog below.

1. **Render helper import-boundary audit.**
   - Goal: confirm helper placement avoids circular runtime imports as
     source-output bridges are removed or renamed.
   - Required proof: package build plus updated handoff if any placement rule is
     discovered.

2. **Declaration render bridge audit.**
   - Goal: inspect `Declaration.render(...)` after custom-property raw-value
     cleanup and decide whether it still needs `renderSourceOutput(...)` or can
     emit through a declaration-native writer path.
   - Required proof: focused declaration tests plus materialization frontier.

3. **Base source render helper boundary audit.**
   - Goal: confirm `renderSourceOutput(...)` still belongs in the base
     source-serialization path after shrinkable evaluated surfaces are removed.
   - Required proof: focused node-render-buffer coverage plus updated handoff.

4. **Negative/Condition/DefaultGuard render bridge audit.**
   - Goal: inspect the remaining small wrapper render paths and decide whether
     each can use native local syntax or should stay on a renamed expression
     output helper.
   - Required proof: focused negative/condition/default-guard tests plus
     materialization frontier.

5. **Selector/interpolated render bridge audit.**
   - Goal: inspect selector-valued and interpolated string render paths that
     still use `renderSourceOutput(...)` after local eval/resolve, without
     confusing selector payload output with generic expression output.
   - Required proof: focused selector/interpolated tests plus render-buffer
     frontier.

6. **JsExpression/import-style render bridge audit.**
   - Goal: inspect JS expression and import-style render surfaces that still
     use the source-output helper, and separate true evaluated syntax from
     source-only import/reference boundaries.
   - Required proof: focused js-expr/import-style tests plus materialization
     frontier.

7. **Base source subclasses audit.**
   - Goal: scan remaining source-only subclasses for local render overrides or
     helper imports that should collapse to inherited source render.
   - Required proof: node-render-buffer coverage plus frontier scans.

## Backlog

These are remaining architecture themes, not immediate queue items. Promote
one only after turning it into a concrete checkpoint.

No backlog items are currently promoted beyond the immediate queue. Add a new
theme here only after the current queue item is completed or split.

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
