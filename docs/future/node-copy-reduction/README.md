# Node Copy Reduction

This folder is the active handoff for reducing and, where possible,
eliminating routine node copying during eval. Keep it small enough to read at
startup. Older per-file completion logs live in
`docs/_archive/node-copy-reduction/README-2026-05-12.md`.

## Direction

- Keep one canonical source tree as the default model.
- Prefer lazy per-placement runtime state over routine copied or cloned trees.
- Do not treat `copy()` / `clone()` as the future evaluation model.
- Use shallow wrapper owners only when they carry real local scope, registry,
  import/reference, merge, generated selector placement, or output ownership.
- Keep render state ownership explicit. Fresh render traversals reset
  context-owned print state; nested render bridges reuse active
  writer/frame/trivia state through `prepareRenderPrintState(...)`.
- Treat deep clone, broad materialization, and wrapper growth as debt unless a
  focused test proves a semantic ownership boundary.
- Fix structural ownership bugs where they are created, not by filtering output
  later.

The target compile path is not "eval creates a complete output tree, then
serialize that tree". Evaluation should move semantic state forward and
rendering should emit through contextual resolution, with small owned output
surfaces only where a rule, scope, import/reference, merge, or generated
selector placement truly needs one.

## Current Evidence

- `packages/jess/test/less/all-less.test.ts` renders through
  `Compiler.renderToResult(...)`, so the Less fixture baseline exercises the
  awaited eval/render API instead of compiling a tree and then calling
  `tree.toString({ context })`.
- `render(...)`, `renderString(...)`, `renderToResult(...)`, and
  `safeRender(...)` all use the eval/render path. `safeCompile(...)` remains a
  compatibility/debug API for callers that explicitly need a tree surface.
- The Jess compiler render phase now creates and finalizes a flat render buffer
  directly. That makes the public compiler output path consume the buffer
  contract instead of treating `renderNodeToString(...)` as its final API.
- `postEvalVisitor` is a compatibility hook name for pre-render visitors:
  compiler tests prove it runs after eval and before serialization.
- Less function helper serialization routes ordinary node values through
  `node.render(context)` when a render context exists. `Quoted` and `Any`
  remain raw-value exceptions because Less helper APIs intentionally consume
  their literal forms.
- The explicit render-buffer bridge now covers ordinary scalar, declaration,
  selector, rules, reference, style import, JS import, raw-rules, async JS
  expression, collection, and evaluated `$for` output seams that have focused
  tests. `VarDeclaration` output is covered through the inherited
  `Declaration` buffer path for visible parameter bindings. This does not mean
  every node should gain a buffer overload: invisible registration or
  side-effect nodes should stay invisible unless a focused output test proves a
  real render seam.
- `pnpm run verify:node-copy-frontier` reports no production deep
  copy/clone-style frontier outside clone infrastructure.
- The same frontier check fails on ordinary production `.copy()` callers
  outside the base node-copy API/infrastructure.
- `callWithContext(...)` now only creates copied raw-argument ownership
  surfaces for functions with params metadata. Ordinary JS functions receive
  positional args directly instead of paying for an unused `rawArgs` copy.

## Current Frontier

The frontier is no longer a broad per-node cleanup log. Choose the next seam by
running the scan, reading the specific source, and proving the ownership move
with focused tests.

Use these rules when deciding whether a remaining copy/clone call is real debt:

- Base `Node.copy()` / `Node.clone()`, `copyWithReusableLeaves(...)`, keyset
  copies, bitset copies, and test-only clones are infrastructure, not normal
  eval-flow wins by themselves.
- Metadata-backed functions still need a copied raw-args surface for
  `this.rawArgs`, `this.args()`, preprocessing, lazy params, validation, and
  `@arguments`-style behavior. Plain functions without metadata do not.
- Generated selector output often needs an owned placement surface; do not
  collapse those copies without tests proving source selector parentage,
  visibility flags, and extend output all stay correct.
- Direct comment children are currently preserved per generated output
  placement. Do not change that without an explicit AST/comment ownership
  decision.
- `Context.rulesContext`, `ScopeFrame.fallbackFrame`, deep clone, and
  materialization are suspect surfaces, not automatic bugs.
- `prepareRenderPrintState(...)` is the central render bridge. New bridges
  should use it instead of adding local writer/frame/trivia reset heuristics.
- Production render paths no longer call `renderNodeToBuffer(...)`,
  `renderNodeToWriter(...)`, or `renderNodeToString(...)`; the Jess compiler
  root calls `Rules.render(...)` directly. The `renderNodeTo*` helpers remain as
  focused utility/test bridges, not production compiler plumbing.
  `renderNodeToString(...)` exercises native buffer render when a node has that
  overload, so render tests should not silently drift back to
  resolve-then-serialize coverage. Keep `pnpm run verify:render-buffer-frontier`
  green before and after touching render-buffer callers.
- Plain CSS `Call` argument/content rendering uses a call-local active writer
  helper that evals child args/content and serializes into the existing
  function writer while preserving calc-frame cleanup. Do not route those child
  surfaces through a public "final string" API name.
- Static/self-resolving buffer renderers such as `Any`, `Bool`, `Rest`,
  `Combinator`, `DefaultGuard`, `Dimension`, `Comment`, `Range`, `Color`, and
  `RawRules`, plus self-resolving container/directive surfaces such as
  `Collection` and `JsImport`, write their own text directly instead of
  resolving first and re-entering the bridge. Prefer that shape when focused
  tests can prove no eval or ownership boundary is being skipped.
- Do not convert evaluating nodes by pattern. Direct buffer output is only safe
  when focused tests prove the path preserves context-sensitive evaluation,
  child resolution, async finalization, registration/visibility effects, and
  selector/rules ownership.
- `Expression` now evaluates its child directly for buffer render, and
  `Negative` evaluates its operand directly before writing the evaluated
  output. Both have focused tests proving buffer render bypasses public
  wrapper/child `resolve()` calls while preserving evaluated output.
- `Operation`, `Condition`, and `Paren` now use their existing internal
  evaluation/resolution helpers for buffer render, so they preserve evaluated
  output without calling the wrapper `resolve()` method.
- `Quoted` and `Url` now use their existing value-resolution helpers for buffer
  render, preserving quoted/url syntax without calling the wrapper `resolve()`
  method.
- `Interpolated` now uses its existing interpolation-resolution helper for
  buffer render, preserving resolved replacement output without calling the
  wrapper `resolve()` method.
- `JsExpression` now evaluates directly for buffer render, and `Block` uses its
  existing value-resolution helper. Focused tests prove both bypass wrapper
  `resolve()` while preserving evaluated output.
- `SelectorCapture` and `InterpolatedSelector` now use their wrapper-local
  resolution helpers for buffer render. Focused tests prove both bypass wrapper
  `resolve()` while preserving selector output.
- `Selector` now writes explicit buffer output through an internal
  `resolveForRender(...)` hook. Selector containers and attribute selectors use
  that hook to preserve child selector resolution semantics without calling the
  public `resolve()` wrapper, while simple selector leaves keep the default
  eval-for-output path.
- `List` and `Sequence` now use their existing value-resolution helpers for
  buffer render. Focused tests prove both bypass wrapper `resolve()` while
  preserving list separators, sequence spacing, and source-trivia behavior.
- `Declaration` now uses the normal eval path directly for buffer render,
  preserving declaration registration/eval behavior without calling the public
  `resolve()` wrapper. Focused tests cover ordinary declarations, custom
  declarations, and inherited visible `VarDeclaration` output.
- `AtRule` now uses its existing owned-surface eval path directly for buffer
  render, preserving evaluated preludes and body output without calling the
  public `resolve()` wrapper.
- `Reference` now evaluates directly for buffer render, preserving existing
  lookup semantics without calling the public `resolve()` wrapper.
- `For` keeps direct `render(context)` on source syntax, but explicit buffer
  render now evaluates directly and writes the resulting loop output without
  calling the public `resolve()` wrapper.
- `Call` already streamed plain CSS calls; non-string function/mixin lookup
  calls now use the same derived eval surface directly for buffer render
  instead of calling the public `resolve()` wrapper.
- `Rules` now uses its existing derived eval surface directly for buffer
  render, preserving root `toString()` output for charset/import prefixes
  without calling the public `resolve()` wrapper.
- `Ruleset` now evaluates directly for buffer render and writes the evaluated
  ruleset/rules/nil result without calling the public `resolve()` wrapper.
- `StyleImport` now evaluates directly for buffer render and writes the
  resulting rules output without calling the public `resolve()` wrapper,
  preserving import resolution, optional/import-once/reference behavior, and
  async path handling.
- Keep direct legacy `render(context)` behavior separate from explicit
  `render(context, buffer)` behavior where the repo still needs that
  compatibility. For example, direct `$for` string render remains source syntax
  while the buffer path emits evaluated loop output.
- If a red only appears in `packages/jess/test/less/all-less.test.ts`, prefer a
  parser-accurate focused core repro first when practical.

## Useful Commands

```sh
pnpm run verify:node-copy-frontier
pnpm run verify:render-buffer-frontier
pnpm run test:less:test-data
pnpm run verify:baseline
```

## Working Rule

Pick one narrow production seam, prove it with the closest focused test, then
run the smallest broader verification that covers the affected behavior. Do not
add architecture or status documents that mostly describe absent machinery.

Use [HANDOFF.md](./HANDOFF.md) for the current execution checklist.
