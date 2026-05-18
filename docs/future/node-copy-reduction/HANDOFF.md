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
- The Jess compiler render phase now creates a flat render buffer, writes the
  evaluated root through `Rules.render(...)`, and finalizes it with
  `finalizeFlatRenderBuffer(...)`. This is a public output-path seam; it does
  not mean every node has native streaming render behavior yet.
- `safeRender(...)` now owns its eval/render path directly instead of calling
  `safeCompile(...)` and then serializing that compiled tree surface. Keep
  safe diagnostic collection on the render path without restoring the old
  compile-tree handoff.
- Less function helper serialization in `packages/fns` now routes non-raw node
  values through `node.render(context)` when a render context exists. `Quoted`
  and `Any` remain raw value exceptions because Less string/function helpers
  intentionally consume their literal function arguments.
- Compiler coverage proves the compatibility hook named `postEvalVisitor` runs
  after eval and before render serialization, including plain typed visitor
  objects such as `{ declaration(...) { ... } }`, not only objects with a
  generic `visit(...)` method.
- `packages/core/src/tree/util/render-buffer.ts` has focused coverage for both
  direct root rendering and the case where the source root resolves to an owned
  root surface; the root serializer exception should stay limited to that
  identity-backed case.
- Focused core coverage now proves explicit render-buffer output for `Rules`,
  async `JsExpression`, inherited visible `VarDeclaration` output, and
  evaluated `$for` output. The `$for` bridge deliberately does not change
  legacy direct string render, which still returns source syntax for sync
  compatibility.
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
- `callWithContext(...)` skips raw-argument ownership copies for functions that
  do not declare params metadata. Those calls pass positional args directly;
  copied `rawArgs` only exists for metadata-backed functions that expose
  `this.rawArgs`, `this.args()`, preprocessing, lazy params, or validation.
- `List` and `Sequence` addition already have focused coverage for preserving
  source child parentage and reusing childless source-free scalar leaves; do not
  churn those helpers without a new ownership failure.

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
- Production render-buffer paths no longer call `renderNodeToBuffer(...)`,
  `renderNodeToWriter(...)`, or `renderNodeToString(...)`. Treat any new
  production use of those helpers as a regression unless it is backed by a
  focused rule for why the caller cannot use the node's native buffer/eval path.
- Plain CSS `Call` argument/content rendering now uses a call-local active
  writer helper that evals children and serializes into the existing function
  writer while keeping calc-frame cleanup owned by the call renderer.
- `Any`, `Bool`, `Rest`, `Combinator`, `DefaultGuard`, `Dimension`, `Comment`,
  `Range`, `Color`, `RawRules`, `Collection`, and `JsImport` now write buffer
  output directly and have focused tests proving buffer render does not call
  `resolve()`. This is the preferred pattern for visible leaves and
  self-resolving containers/directives that have no contextual eval work or can
  render directly from context.
- `Expression` now evaluates its child directly for explicit buffer render.
  `Negative` now evaluates its operand and writes that evaluated value directly.
  Focused tests prove both bypass public wrapper/child `resolve()` calls while
  keeping evaluated output.
- `Operation`, `Condition`, and `Paren` now use their existing internal
  evaluation/resolution helpers for explicit buffer render. Focused tests prove
  they bypass wrapper `resolve()` while preserving evaluated output.
- `Quoted` and `Url` now use their existing value-resolution helpers for
  explicit buffer render. Focused tests prove they bypass wrapper `resolve()`
  while preserving quoted/url syntax.
- `Interpolated` now uses its existing interpolation-resolution helper for
  explicit buffer render. Focused tests prove it bypasses wrapper `resolve()`
  while preserving resolved replacement output.
- `JsExpression` now evaluates directly for explicit buffer render, and
  `Block` uses its existing value-resolution helper. Focused tests prove both
  bypass wrapper `resolve()` while preserving evaluated output.
- `SelectorCapture` and `InterpolatedSelector` now use their wrapper-local
  resolution helpers for explicit buffer render. Focused tests prove both
  bypass wrapper `resolve()` while preserving selector output.
- `List` and `Sequence` now use their existing value-resolution helpers for
  explicit buffer render. Focused tests prove both bypass wrapper `resolve()`
  while preserving list separators, sequence spacing, and source-trivia
  behavior.
- `Declaration` now uses the normal eval path directly for explicit buffer
  render, preserving declaration registration/eval behavior without calling the
  public `resolve()` wrapper. Focused tests cover ordinary declarations, custom
  declarations, and inherited visible `VarDeclaration` output.
- `AtRule` now uses its existing owned-surface eval path directly for explicit
  buffer render, preserving evaluated preludes and body output without calling
  the public `resolve()` wrapper.
- `Reference` now evaluates directly for explicit buffer render, preserving
  existing lookup semantics without calling the public `resolve()` wrapper.
- `For` keeps direct `render(context)` on source syntax, but explicit buffer
  render now evaluates directly and writes the resulting loop output without
  calling the public `resolve()` wrapper.
- `Call` already streamed plain CSS calls; non-string function/mixin lookup
  calls now use the same derived eval surface directly for explicit buffer
  render instead of calling the public `resolve()` wrapper.
- `Rules` now uses its existing derived eval surface directly for explicit
  buffer render, preserving root `toString()` output for charset/import
  prefixes without calling the public `resolve()` wrapper.
- `Ruleset` now evaluates directly for explicit buffer render and writes the
  evaluated ruleset/rules/nil result without calling the public `resolve()`
  wrapper.
- `Selector` now writes explicit buffer output through an internal
  `resolveForRender(...)` hook. Selector containers and attribute selectors use
  that hook to preserve child selector resolution semantics without calling the
  public `resolve()` wrapper, while simple selector leaves keep the default
  eval-for-output path.
- `StyleImport` now evaluates directly for explicit buffer render and writes
  the resulting rules output without calling the public `resolve()` wrapper.
  Focused coverage preserves import resolution, optional/import-once/reference
  behavior, and async path handling.
- Do not add buffer overloads to invisible registration or compile-time
  side-effect nodes just to make the bridge list longer. `Extend`, `ExtendList`,
  `Mixin`, `Func`, `Log`, and JS host wrapper nodes need caller-specific proof
  before they become render-buffer output surfaces.
- The Jess compiler awaits its render phase, and plugin `postEvalVisitor`
  remains the public compatibility hook name, but internally that phase is
  treated as pre-render: visitors run after eval and before serialization.
  Do not reintroduce a post-string-output visitor phase under this name.

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
