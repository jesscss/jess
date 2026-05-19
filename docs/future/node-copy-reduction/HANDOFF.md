# Node Copy Reduction — Handoff

## Start Here

Read this file and [README.md](./README.md). This folder is intentionally small:
it is for the current direction and next seams, not a historical pass log.

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
  import/reference, merge, generated selector placement, or output ownership.
- Keep render bridge state ownership centralized. Fresh render traversals reset
  context-owned print state; nested bridges reuse active writer/frame/trivia
  state through `prepareRenderPrintState(...)`.
- Treat `Context.rulesContext`, `ScopeFrame.fallbackFrame`, deep clone, and
  materialization as suspect surfaces, not automatic bugs.
- When a red only appears in `packages/jess/test/less/all-less.test.ts`, prefer
  a parser-accurate focused core repro first when practical.
- Update these docs only when the active frontier or rule set changes.

## Current State

- `pnpm run verify:baseline`, `pnpm run verify:node-copy-frontier`,
  `pnpm run verify:render-buffer-frontier`, and
  `pnpm run verify:materialization-frontier` are the active truth checks.
- Public CSS output goes through eval/render: `render(...)`,
  `renderString(...)`, `renderToResult(...)`, and `safeRender(...)`.
  `safeCompile(...)` remains the compatibility/debug API for callers that need
  a tree surface.
- The compiler render phase writes through `Rules.render(...)` into a flat
  render buffer. Production code should not call `renderNodeToBuffer(...)`,
  `renderNodeToWriter(...)`, or `renderNodeToString(...)`.
- `$if`, `$for`, and `$while` avoid control-wrapper materialization in buffer
  render. `$if` renders only the selected branch output; `$for` and `$while`
  render per iteration. Direct sync `render(context)` remains source syntax for
  compatibility.
- The old per-node render-buffer checklist is done enough to be history. Do not
  re-create it. The useful question now is whether a seam still materializes an
  output tree when it could stream or use smaller contextual state.

## Next Seams

1. **Audit remaining materialization boundaries.**
   - `pnpm run verify:materialization-frontier` names the current expected
     sync compatibility seams.
   - Convert only when the node can stream children or keep a smaller owned
     surface without changing scope, registration, async, selector, or trivia
     behavior.
2. **Keep copy/clone pressure low.**
   - A new production `.copy()` or `.clone()` site is a regression unless it
     carries explicit scope, registry, import/reference, merge, generated
     selector placement, or output ownership.
   - Reusable-leaf helpers are acceptable only for containers that still prove
     they need an owned surface.
3. **Reduce generated-output ownership carefully.**
   - Selector expansion, extend output, direct comment children, and root
     `Rules` serializer behavior are special because they produce placement
     output. Change them only with parentage, visibility, and output-order tests.
4. **Preserve function/mixin raw argument contracts.**
   - Metadata-backed functions may need copied raw args for `this.rawArgs`,
     `this.args()`, preprocessing, lazy params, validation, and
     `@arguments`-style behavior.
   - Plain functions should keep receiving positional args directly.
5. **Audit context shadow state.**
   - `Context.rulesContext`, `ScopeFrame.fallbackFrame`, and similar state are
     acceptable only when they model live scope or placement better than copied
     nodes.

## Render-Buffer Rules

- Keep `prepareRenderPrintState(...)` as the only bridge for active writer,
  frame, and trivia state.
- Keep shared helpers small:
  - `writeRenderText(...)` writes already-rendered text.
  - `writeRenderedOutput(...)` writes an already-chosen evaluated node.
  - `writeMaybeRenderedOutput(...)` removes promise plumbing only.
  - root-aware helpers only preserve the `Rules` root serializer exception.
- Do not add native buffer render to invisible or compile-time side-effect
  nodes unless a focused test proves a real output seam.
- Tests may use `renderNodeToString(...)`, but production render code should
  call node render methods directly.

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
