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
- Use `F_STATIC` resolve fast paths only for canonical, already-static nodes
  whose resolve contract is unchanged by returning early. Prove each one with a
  focused test that makes child resolution fail if it is accidentally called.
- When a red only appears in `packages/jess/test/less/all-less.test.ts`, prefer
  a parser-accurate focused core repro first when practical.
- Update these docs only when the active frontier or rule set changes.

## Current State

- `pnpm run verify:baseline`, `pnpm run verify:node-copy-frontier`,
  `pnpm run verify:render-buffer-frontier`, and
  `pnpm run verify:materialization-frontier` are the active truth checks.
  The broad baseline includes core, parser, Less fixture, less-compat,
  frontier, package-export, and node-constructor metadata coverage;
  changed-only mode intentionally runs the full baseline when verifier scripts
  or root dependency metadata changed. Changed-only mode includes local
  unstaged and staged files as well as committed branch diff. The pre-push
  gate shares the same root-gate rules; its generated upstream TODO report is
  ignored by git and removed after a clean upstream run.
- Public CSS output goes through eval/render: `render(...)`,
  `renderString(...)`, `renderToResult(...)`, and `safeRender(...)`.
  `safeCompile(...)` remains the compatibility/debug API for callers that need
  a tree surface.
- The public `preEval()` method and the old `preEvaluated` flag are removed.
  Registration identity setup is explicit through `prepareRegistration()` and
  tracked with `registrationPrepared`.
- The compiler render phase writes through `Rules.render(...)` into a flat
  render buffer. Production code should not call `renderNodeToBuffer(...)`,
  `renderNodeToWriter(...)`, or `renderNodeToString(...)`.
- `$if`, `$for`, and `$while` avoid control-wrapper materialization in buffer
  render. `$if` renders only the selected branch output; `$for` and `$while`
  render per iteration. `$while` loop-body variable mutation is carried in a
  live `ScopeFrame` surface between iterations, not in a full output tree.
- The base `Node.render(context)` implementation is a direct source serializer,
  not a resolve/eval-then-serialize fallback. Context-dependent nodes must
  override `render(...)`, choose the evaluated value locally, and serialize that
  value through the shared print-state machinery. If local child resolution is
  async, the native direct render path should await that chosen value rather
  than serialize source syntax while the buffer path emits evaluated output.
  Static or source-only direct `Node` subclasses should inherit base render
  instead of keeping local source-string/buffer branches.
- `$while` currently has explicit focused guards for native buffer rendering,
  no `Rules.clone()` loop-body surface, and no scalar leaf copy/clone inside
  per-iteration body copies. `$for` and `$while` reuse static and dynamic direct
  body children from the canonical body without reparenting them; frozen
  non-static placement nodes re-evaluate instead of retaining a per-placement
  eval stamp.
- The stateful loop parity guard intentionally checks that native render and
  eval serialization stay aligned. It does not bless or change the exact
  same-iteration `$while` mutation timing; settle that as a runtime semantics
  change before changing expectations.
- The old per-node render-buffer checklist is done enough to be history. Do not
  re-create it. The useful question now is whether a seam still materializes an
  output tree when it could stream or use smaller contextual state.

## Next Seams

1. **Keep copy/clone pressure low.**
   - A new production `.copy()` or `.clone()` site is a regression unless it
     carries explicit scope, registry, import/reference, merge, generated
     selector placement, or output ownership.
   - Reusable-leaf helpers are acceptable only for containers that still prove
     they need an owned surface.
   - The node-copy frontier intentionally ignores BitSet `.clone()` calls;
     those are selector-index data copies, not AST ownership copies.
2. **Replace loop eval surfaces without losing semantics.**
   - `$for` and `$while` no longer copy direct loop-body children into the
     iteration eval surface. The next win is to shrink any remaining owned loop
     output surfaces while preserving per-iteration scope, rule visibility, and
     `$while` mutation.
   - Keep `verify:render-buffer-frontier` and the focused control tests green
     while changing this.
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
   - `Context.rulesContext`, `ScopeFrame.fallbackFrame`, loop live slots, and
     similar state are acceptable only when they model live scope or placement
     better than copied nodes.

## Render-Buffer Rules

- Keep `prepareRenderPrintState(...)` as the only bridge for active writer,
  frame, and trivia state.
- Buffer render helpers must use a detached writer and only append the
  finished text to the target buffer; render-to-string bridges may pass a
  writer for surrounding state, but buffer render must not mutate it.
- Keep shared helpers small:
  - `writeRenderText(...)` writes already-rendered text.
  - `writeRenderTextResult(...)` writes maybe-async rendered text.
  - `prepareBufferPrintState(...)` preserves render state while detaching
    caller-owned writers before anything writes into a render buffer.
  - `renderNoOutputEffect(...)` evaluates invisible side-effect output and
    intentionally emits nothing through either string or buffer render.
  - `renderChosenOutput(...)` routes an already-chosen evaluated node through
    direct string or buffer render overloads without letting individual node
    classes duplicate promise/buffer branching.
  - helper-local chosen-output string/write functions only remove promise and
    buffer branching from node classes.
  - `writeRootAwareChosenOutput(...)` only preserves the `Rules` root
    serializer exception while writing an already-chosen output node.
- Treat `renderChosenOutput(...)` as transitional overload plumbing. It is
  acceptable for current node render overloads, but chosen-output string/write
  branching should stay helper-local unless a focused test proves another real
  boundary.
- Keep `$for` / `$while` iteration rendering centralized through
  `renderIterationRules(...)` in `control.ts`. The frontier verifier expects
  one native control iteration render site; update the verifier only when the
  loop render model itself changes.
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
