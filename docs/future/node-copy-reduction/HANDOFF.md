# Node Copy Reduction — Handoff

## Open This First

This is the live status and next-work page for the eval/render/copy refactor.
Keep it current enough that an agent can open this file, see where the repo is,
and pick the next honest checkpoint without rebuilding weeks of context.

Use [README.md](./README.md) for the architecture rules. Use this file for the
current state, immediate queue, and verification commands.

## Status Snapshot

- Public CSS output APIs (`render(...)`, `renderString(...)`,
  `renderToResult(...)`, and `safeRender(...)`) use the awaited eval/render
  path. `safeCompile(...)` remains the explicit compatibility/debug API for
  callers that need a tree surface.
- The public `preEval()` method and old `preEvaluated` flag are gone.
  Registration identity setup is explicit through `prepareRegistration()` and
  tracked by `registrationPrepared`.
- The compiler render phase writes through `Rules.render(...)` into a flat
  render buffer. Production code must not call the bridge helpers
  `renderNodeToBuffer(...)`, `renderNodeToWriter(...)`, or
  `renderNodeToString(...)`; those are internal/test utilities.
- The package-root render-buffer export is intentionally narrow:
  `createRenderBuffer`, `finalizeFlatRenderBuffer`, and their types. Do not
  export bridge helpers from the root package.
- The base `Node.render(context)` implementation is a direct source serializer,
  not a resolve/eval-then-serialize fallback. Context-dependent nodes must
  choose their evaluated output locally and serialize through shared print
  state.
- `$if`, `$for`, and `$while` avoid materializing control-wrapper output before
  buffer render. `$if` renders only the selected branch; `$for` and `$while`
  render per iteration.
- `$while` carries body variable mutation in a live `ScopeFrame`, not in a
  full output tree. Same-iteration mutation visibility is runtime semantics,
  not a copy-reduction cleanup.
- `$for` and `$while` reuse static and dynamic direct body children from the
  canonical body without reparenting them. Frozen non-static placement nodes
  re-evaluate instead of retaining a per-placement eval stamp.
- Context shadow state has been classified: `ScopeFrame.liveSlotsByName`,
  `ScopeFrame.fallbackFrame`, and `Context.rulesContext` are kept runtime
  state because they model live scope and caller fallback without copied trees.
  The current known cleanup seams here are covered; do not put this back in the
  immediate queue without a new focused failing test or duplicated production
  restore path.
- `$while` now uses one local rules-context swap/restore helper for eval and
  native render, keeping its live loop state behavior while removing duplicate
  context mutation scaffolding.
- `AtRule` prelude evaluation now has a named scope-lift helper and one local
  rules-context swap/restore path for sync throws, async rejection, and normal
  completion.
- `Reference` runtime-var binding resolution now keeps temporary search-scope
  membership and definition-scope `rulesContext` restore in reference-local
  helpers instead of duplicating cleanup across sync and async branches.
- Mixin call evaluation now uses one rules-local call-context helper for
  caller-scope argument eval, callable-rules output eval, and deferred
  `default()` candidate output eval.
- Mixin call guard/output evaluation now shares one local rules-context
  swap/restore primitive with the call-context helper, with a throw-path test
  proving caller `rulesContext` restoration.
- Render-buffer, materialization, and node-copy frontier scans cover production
  package `src` trees across the monorepo, not only `packages/core`.
- The node-copy frontier is clean for deep copy/clone, loop eval-surface child
  copies, and ordinary production `.copy()` outside infrastructure. BitSet
  `.clone()` calls are ignored because they are selector-index data copies, not
  AST ownership copies.
- Remaining wrapper/helper surfaces are not automatically bugs. Keep a wrapper
  when it carries real scope, registry, import/reference, merge, generated
  selector placement, delayed output, or ownership state.
- Extend registration now shares one generated-selector registration path for
  sync and async selector eval. Parent-list composition, implicit ampersand
  materialization, reference-scope tagging, and document-order capture should
  stay centralized there.
- Generated `:is(...)` wrappers now consume the already-owned selector copies
  produced by validation/decorating instead of copying those selectors a
  second time while building the wrapper argument list.
- `extend-walk.ts` is lint-clean for selector/container ownership assertions.
  Traversal code now uses real selector guards at parent boundaries instead of
  assertion casts when rebuilding compound, complex, pseudo, and list surfaces.
- Pseudo-argument extend appends now use the same owned placement-copy helper
  as selector-list append paths, with a parentage test proving the source
  pseudo arg and extender are not stolen by generated output.
- The walk-and-consume extend path now also copies unchanged `:is(...)`
  alternatives into generated argument lists instead of reparenting source
  alternatives.
- Framed ampersand append now owns unchanged complex-selector components for
  the generated placement, with a parentage test proving source selector
  children stay attached to the frame selector.
- Ruleset header filtering now owns temporary selector copies without generic
  clone calls or source-free leaf adoption; existing header tests prove source
  leaf parent identity stays canonical.
- The generated selector/output ownership audit covered the remaining
  extend-location pseudo argument/list path; focused tests now prove it extends
  output without reparenting the source pseudo argument, selector-list items, or
  extender.
- At-rule body eval now uses one local helper to clear and restore
  `rulesetFrames` for hoisted root-only at-rules, with a focused throw-path
  test proving parent selector frames are restored.
- `Rules` registration/eval now shares one local extend-root stack restore
  helper for registration errors, eval errors, and nested eval completion.
- Plain positional JS function calls now pass canonical argument containers
  directly. Metadata-backed functions still receive an owned argument-list
  surface for `rawArgs`, `this.args()`, preprocessing, lazy params, validation,
  and callback scope anchoring. Optional fallback call output owns evaluated
  fallback args without reparenting source args.
- `DefaultGuard.render(...)` now chooses its local boolean output and writes it
  through direct source-output serialization.
- `@charset` output-order handling now lives in `Rules` registration prep
  instead of `Any.prepareRegistration()`. `Any.prepareRegistration()` is
  mark-only again, while `Rules` explicitly records `context.currentCharset`
  and replaces the source child with `Nil` for output order.
- Pending declaration-name registration prep is documented and named as a
  narrow lookup-identity retry. It exists for dynamic declaration names that
  can be unblocked by another declaration registering a variable identity; it
  is not a hidden tree-wide pre-eval retry.
- Pending non-declaration identity prep is a source-ordered one-shot pass over
  the unresolved nodes themselves. The old unused kind classifier is gone;
  mixin, selector, and style-import identity surfaces are covered by existing
  source-order registration tests.
- `Rules` eval now names registration setup as eval-owned identity prep, not
  as an old pre-eval bridge. Render-buffer fallback tests and comments call
  the resolve-based path an internal adapter, not a production bridge surface.
- Extend utility comments now describe the current walk-and-consume and
  location-based paths without stale "legacy path" language. The parent
  replacement helper uses selector container/node types instead of `any`.
- The old `renderChosenOutput(...)` name is gone from production code, tests,
  frontier messages, and this handoff.
- Simple expression/value wrappers now skip `renderEvalOutput(...)` entirely
  after local eval/resolve: `Negative`, `Expression`, `JsExpression`,
  `Condition`, `Url`, `Quoted`, `Paren`, and `Operation` pass the resulting
  node directly to `renderSourceOutput(...)`.
- Container and selector wrappers now follow the same local eval/resolve plus
  source-output path: `List`, `Sequence`, `Block`, `Interpolated`, `Selector`,
  `SelectorCapture`, and `InterpolatedSelector` no longer use
  `renderEvalOutput(...)`.
- Structural/root-aware render sites now follow the same direct path:
  `AtRule`, `Call`, `Control`, `Declaration`, `ImportStyle`, `Reference`, and
  `Ruleset` no longer use `renderEvalOutput(...)`.
- `renderEvalOutput(...)` and its helper-local string/buffer branches are gone;
  production render paths now either stream natively or perform local
  eval/resolve followed by `renderSourceOutput(...)`.
- `writeRootAwareEvalOutput(...)` is gone. `Rules.render(...)` now keeps the
  root serializer exception local to rules output, so the render-buffer utility
  layer no longer exposes a named eval-output writer.

## Immediate Queue

This is a pop queue. If an item is completed, remove it. If it is too broad to
complete in one checkpoint, replace it with the smallest honest next
checkpoint and move the broader theme to the backlog below.

1. **Control iteration render cleanup: audit `renderIterationRules(...)`.**
   - Goal: prove whether `$for` / `$while` still need one native iteration
     render helper or whether it can collapse into the direct control render
     path without creating per-iteration output trees.
   - Start in `packages/core/src/tree/control.ts`; keep loop state, retry
     semantics, public rule visibility, and existing clone/copy guards.
   - Do not duplicate iteration render branching across individual control
     nodes.
   - Required proof: focused control tests plus render-buffer, materialization,
     and baseline changed-mode verification.

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
