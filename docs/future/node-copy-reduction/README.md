# Node Copy Reduction

This folder is the active handoff for reducing and, where possible,
eliminating routine node copying during eval. Keep it small enough to read at
startup. Open [HANDOFF.md](./HANDOFF.md) first for current status, the
immediate queue, and verification. This README is the architecture contract.
Older per-file completion logs live in
`docs/_archive/node-copy-reduction/README-2026-05-12.md`.

## Direction

- Keep one canonical source tree as the default model.
- Prefer lazy per-placement runtime state over routine copied or cloned trees.
- Do not treat `copy()` / `clone()` as the future evaluation model.
- Use shallow wrapper owners only when they carry real local scope, registry,
  import/reference, merge, generated selector placement, or output ownership.
- Keep render state ownership explicit. Fresh render traversals reset
  context-owned print state; nested render adapters reuse active
  writer/frame/trivia state through `prepareRenderPrintState(...)`.
- Treat deep clone, broad materialization, and wrapper growth as debt unless a
  focused test proves a semantic ownership boundary.
- Fix structural ownership bugs where they are created, not by filtering output
  later.
- Static resolve fast paths are acceptable only when the node is already fully
  canonical and the fast path preserves that node's existing resolve contract.
  Add focused tests that prove child resolution is skipped; do not use
  `F_STATIC` to skip dynamic binding, evaluation, registration, or output
  ownership work.

The target compile path is not "eval creates a complete output tree, then
serialize that tree". Evaluation should move semantic state forward and
rendering should emit through contextual resolution, with small owned output
surfaces only where a rule, scope, import/reference, merge, or generated
selector placement truly needs one.

## Current State

- Public CSS output APIs (`render(...)`, `renderString(...)`,
  `renderToResult(...)`, and `safeRender(...)`) use the awaited eval/render
  path. `safeCompile(...)` remains the explicit tree-surface compatibility API.
- The compiler render phase writes the evaluated root through a flat render
  buffer and finalizes that buffer. Production render paths must not call
  `renderNodeToBuffer(...)`, `renderNodeToWriter(...)`, or
  `renderNodeToString(...)`; those helpers are test/utility bridges only and
  are not re-exported from the `@jesscss/core` package root. The root package
  may expose only the flat buffer constructor/finalizer and their types used
  by the Jess compiler render phase.
- `preRenderVisitor` is the direct hook name for visitors that run after
  evaluation and before serialization. `postEvalVisitor` remains a compatibility
  alias for older plugin callers.
- The public `preEval()` phase and the old `preEvaluated` node flag are gone.
  Runtime registration setup is tracked as `registrationPrepared`; do not add
  new eval behavior that depends on a hidden tree-wide preparation pass.
- The render-buffer frontier is not a per-node status list anymore. The
  important current facts are that the production bridge scan is green and
  that `$for` / `$while` stream each loop iteration through node render methods.
  The render-buffer and materialization frontier scans cover production `src`
  files across packages, not just `packages/core`.
- `Rules.render(...)` owns the root serializer exception locally. The generic
  eval-output and root-aware eval-output helpers have been removed from the
  render-buffer utility layer.
- The node-copy frontier scan is green for deep copy/clone and ordinary
  production `.copy()` calls outside infrastructure. `$for` and `$while`
  iteration eval surfaces reuse direct body children from the canonical body;
  frozen non-static placement nodes re-evaluate instead of retaining a
  per-placement eval stamp. The scan ignores BitSet `.clone()` calls because
  those are immutable selector-index data, not AST ownership surfaces. New
  copy/clone sites must prove an ownership need before they land.
- `pnpm run verify:baseline` is the broad output gate. It covers core, the CSS
  parsers, the Less fixture corpus, the less-compat plugin suite, and the
  frontier, package-export, and node-constructor metadata scans. `--changed`
  may narrow package work, but changes to the gate scripts or root dependency
  metadata intentionally run the full baseline. It includes local unstaged and
  staged changes, not only committed branch diff. The pre-push gate uses the
  same root-gate rules; any non-blocking upstream TODO report is generated
  under `.cursor/PREPUSH_CHECK_TODOS.md`, ignored by git, and removed again
  after a clean upstream run.
- `$if`, `$for`, and `$while` do not render by materializing a control-node
  wrapper first. `$if` renders only the selected branch output; `$for` and
  `$while` render per iteration through direct `Rules.render(...)` calls.
  Direct-string control render uses one local flat-buffer adapter so it stays
  aligned with buffer output. `$while` carries loop-body variable mutation in a
  small live `ScopeFrame`, not in a full output tree. `$for` and `$while` reuse
  both static and dynamic direct body children without reparenting the
  canonical body.
- The base `Node.render(context)` implementation is the inherited
  static/source serializer. It does not call `resolve()` or serialize an
  evaluated wrapper. Nodes whose output depends on context must override
  `render(...)`, choose the evaluated value locally, and serialize that value
  through the same print-state machinery. Expression-like native render
  overloads must also await async child resolution instead of falling back to
  authored syntax; direct string render and buffer render should choose the
  same evaluated value. Static or source-only nodes should use the base render
  path instead of reimplementing local string/buffer branching.
- Context shadow state is intentionally small runtime state, not an output
  tree substitute. Keep `ScopeFrame.liveSlotsByName` for mixin params,
  `@arguments`, loop counters, and `$while` mutation; keep
  `ScopeFrame.fallbackFrame` for caller fallback/leaky body lookup; keep
  `Context.rulesContext` as the active lexical/eval scope pointer. These are
  the mechanisms that let evaluation avoid rewriting parent pointers or
  cloning caller/loop body trees. Remaining cleanup should shrink redundant
  save/restore plumbing or broad context mutation, not remove the frame model.

## Remaining Architecture Work

The remaining work is not "add a buffer overload to every class." It is to
remove the places where eval still creates broad output surfaces merely so a
later serializer can walk them.

These are architectural seams, not a live ordered queue. Use
[HANDOFF.md](./HANDOFF.md) for the current order of work.

1. **Loop eval surfaces**: direct loop-body child copying is no longer the
   active frontier. Keep the existing render, static-child, dynamic-child, and
   scalar-leaf guards green while reducing any remaining loop output surfaces.
2. **Generated selector/output ownership**: selector expansion, extend output,
   and direct comment children may still need owned placement surfaces. Reduce
   these with parentage, visibility, and extend-output tests; do not collapse
   them by pattern.
3. **Function/mixin argument surfaces**: metadata-backed functions still need
   copied raw-argument ownership for `this.rawArgs`, `this.args()`,
   preprocessing, lazy params, validation, and `@arguments`-style behavior.
   Plain functions should keep receiving positional args directly.
4. **Context shadow state**: the frame model is a kept part of the target
   architecture. Audit this seam for redundant save/restore, stale aliases, or
   overly broad context mutation; do not replace `liveSlotsByName`,
   `fallbackFrame`, or `rulesContext` with copied nodes.
5. **Control render surfaces**: `$for` / `$while` stream generated iteration
   rules through direct `Rules.render(...)` calls. `$if` selected branches use
   branch `Rules.render(context)` for trimmed block output. Remaining work is
   about eval-only output wrappers, not adding another control render helper.

## Guardrails

- Base `Node.copy()` / `Node.clone()`, keyset copies, bitset copies, reusable
  leaf helpers, and test-only clones are infrastructure, not automatic wins.
- `.value` is still the right shape for scalar and list/container nodes. Future
  direct-field cleanup is only for record-shaped nodes where named fields would
  reduce real indirection or ownership confusion; do not turn it into a broad
  `.value` removal pass.
- `prepareRenderPrintState(...)` is the central adapter for active writer,
  frame, and trivia state. Do not add local writer/frame/trivia reset heuristics.
- Buffer render helpers must serialize through a detached writer and only
  append the final text to the target buffer; they must not mutate or add a
  writer on caller-owned print options passed in from a render-to-string
  adapter.
- Shared render-buffer helpers must stay narrow:
  - `writeRenderText(...)` writes already-rendered text.
  - `writeRenderTextResult(...)` writes maybe-async rendered text.
  - `prepareBufferPrintState(...)` preserves render state while working from a
    shallow detached options object before anything writes into a render
    buffer.
  - `renderNoOutputEffect(...)` evaluates invisible side-effect output and
    intentionally emits nothing through either string or buffer render.
- These helpers describe the current serializer boundary, not a desired
  long-term abstraction family. Do not add new wrapper layers around them;
  prefer shrinking or deleting helpers when the surrounding render path no
  longer needs them.
- Invisible registration or side-effect nodes should stay invisible unless a
  focused output test proves a real render seam.
- If a red only appears in `packages/jess/test/less/all-less.test.ts`, prefer a
  parser-accurate focused core repro first when practical.

## Useful Commands

```sh
pnpm run verify:node-copy-frontier
pnpm run verify:render-buffer-frontier
pnpm run verify:materialization-frontier
pnpm run verify:package-exports
pnpm run verify:node-constructor-metadata
pnpm run test:less:test-data
pnpm --filter ./packages/jess-plugin-less-compat test
pnpm run verify:baseline
pnpm run verify:baseline -- --changed
```

`verify:materialization-frontier` guards against direct eval/resolve output
being serialized as a completed tree surface. If it trips, either shrink that
path into contextual render output or document the remaining ownership need in
this handoff before allowing it.

## Working Rule

Pick one narrow production seam, prove it with the closest focused test, then
run the smallest broader verification that covers the affected behavior. Do not
add architecture or status documents that mostly describe absent machinery.

Use [HANDOFF.md](./HANDOFF.md) for the current execution checklist.
