# Node Copy Reduction — Handoff

## Start Here

Read this file and [README.md](./README.md). This folder is intentionally small:
it is for current direction and next seams, not a historical pass log.

## Rules

- Preserve Jess behavior.
- Work from repo evidence first.
- Prefer small, verifiable production changes.
- Do not weaken tests or fixture expectations to make migration work look done.
- Reduce and, where possible, eliminate copy/clone from normal eval flow.
- Keep pushing compile toward contextual resolve/render emission, not a full
  evaluated-tree materialization followed by whole-tree serialization.
- Improving a legacy copy path is only a stopgap when callers still require an
  owned surface today.
- Keep semantic wrapper surfaces when they carry real scope, registry,
  import/reference, merge, or output ownership.
- Keep render bridge state ownership centralized. Fresh render traversals reset
  context-owned print state; nested bridges reuse active writer/frame/trivia
  state through `prepareRenderPrintState(...)`.
- Treat `Context.rulesContext`, `ScopeFrame.fallbackFrame`, deep clone, and
  materialization as suspect surfaces, not automatic bugs.
- When a red only appears in `packages/jess/test/less/all-less.test.ts`, prefer
  a parser-accurate focused core repro first when practical.
- Update these docs only when the active frontier or rule set changes.

## Current Evidence

- `pnpm run verify:baseline` is green for core, parsers, and
  `packages/jess/test/less/all-less.test.ts`.
- `packages/jess/test/less/all-less.test.ts` now renders through
  `Compiler.renderToResult(...)`, so the fixture baseline exercises the awaited
  eval/render API instead of compiling a tree and then calling
  `tree.toString({ context })` in the test harness.
- The remaining Less helper tests that compare generated CSS now call public
  render APIs (`render(...)`, `renderString(...)`, or `renderToResult(...)`)
  instead of compiling a tree and manually serializing it.
- Active public compiler coverage now proves `render(...)`, `renderString(...)`,
  and `renderToResult(...)` preserve root-owned output such as first charset,
  hoisted CSS imports, and final newline behavior through the render bridge.
- `packages/core/src/tree/util/render-buffer.ts` has focused coverage for both
  direct root rendering and the case where the source root resolves to an owned
  root surface; the root serializer exception should stay limited to that
  identity-backed case.
- `pnpm run verify:node-copy-frontier` reports no production deep
  copy/clone-style frontier outside clone infrastructure.
- The same frontier check now also fails on ordinary production `.copy()`
  callers outside the base `Node.copy()` API/infrastructure.
- `packages/core/src/tree/util/extend-walk.ts` is whole-file lint-clean.
- `packages/core/src/tree/util/extend.ts` no longer has the deep `.copy(true)`
  generated-output frontier and no longer uses generic `selector.copy()` for
  complex ampersand boundary replacement.
- The remaining ordinary copy helpers should be audited by ownership purpose,
  not by treating every local copy boundary as the same kind of bug.

## Current Frontier

- Continue reducing ordinary `.copy()` / `.clone()` usage from normal eval flow,
  but only after proving the caller does not need an owned eval/output surface.
- Prefer explicit derived wrappers or lazy runtime state when a wrapper needs
  local scope, registry, import/reference, merge, or output ownership.
- Use the shared reusable-leaf helpers only when a container still proves it
  needs an owned surface and childless source-free scalar leaves do not need
  copies.
- Keep direct comment children preserved per generated output placement until
  the AST/comment ownership model explicitly changes.
- Treat selector expansion and extend-generated selector output as generated
  output ownership, not as the same class as shallow-wrapper replacement.
- The preserve-rules-like call parent repair in `packages/core/src/tree/call.ts`
  is still active. Removing it makes non-leaky detached-ruleset calls see caller
  variables, so do not delete it without replacing that lexical-parent behavior.
- `Node.render(context)` still has a legacy synchronous fallback for direct sync
  callers. Top-level compile APIs and flat render buffers use the explicit
  async render bridge. Plain CSS call buffers still need their local
  arg/content renderer so async child failures keep calc-frame cleanup instead
  of falling back to source text. New render bridges should share
  `prepareRenderPrintState(...)` instead of adding local writer/frame/trivia
  reuse heuristics.
- The Jess compiler awaits its render phase, and plugin `postEvalVisitor`
  remains the public compatibility hook name, but internally that phase is
  treated as pre-render: visitors run after eval and before serialization.

## Work Loop

1. Pick one production seam from [README.md](./README.md).
2. Read the relevant source and focused tests before editing.
3. Make the smallest behavior-preserving change.
4. Run the focused proof first.
5. Run the nearest broader verification.
6. Commit and push when the checkpoint is clean.

## Do Not Resurrect

- checked-in task registries or unattended task loops
- stage trackers that mostly describe absent machinery
- broad "current dirty diff" notes copied from an old session
- fixture-expectation changes that are not tied to an explicit Jess behavior
  decision
