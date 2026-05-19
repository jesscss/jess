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

## Current State

- Public CSS output APIs (`render(...)`, `renderString(...)`,
  `renderToResult(...)`, and `safeRender(...)`) use the awaited eval/render
  path. `safeCompile(...)` remains the explicit tree-surface compatibility API.
- The compiler render phase writes the evaluated root through a flat render
  buffer and finalizes that buffer. Production render paths must not call
  `renderNodeToBuffer(...)`, `renderNodeToWriter(...)`, or
  `renderNodeToString(...)`; those helpers are test/utility bridges only.
- `postEvalVisitor` is still the public compatibility hook name, but the hook
  runs after evaluation and before serialization.
- The render-buffer frontier is not a per-node status list anymore. The
  important current fact is that the production bridge scan is green and direct
  output seams use node-owned eval/render decisions plus shared buffer helpers.
- The node-copy frontier scan is green for deep copy/clone and ordinary
  production `.copy()` calls outside infrastructure. New copy/clone sites must
  prove an ownership need before they land.

## Remaining Architecture Work

The remaining work is not "add a buffer overload to every class." It is to
remove the places where eval still creates broad output surfaces merely so a
later serializer can walk them.

Priority seams:

1. **Legacy direct render fallback**: `Node.render(context)` still has a
   synchronous resolve-then-serialize compatibility fallback. Keep it until the
   public sync callers are audited, but do not route new compiler behavior
   through it.
2. **Loop convergence**: `$if` and `$for` already have explicit buffer eval
   output. `$while` should converge with that model: repeatedly evaluate its
   condition in the live context, emit each successful body pass through the
   render buffer, and stop when the condition becomes false or a bounded
   iteration guard fails. This is closer to `$for` or recursive mixins than to
   a separate semantic problem.
3. **Materialization seams**: find remaining code that resolves/evals a whole
   subtree only to immediately call `toTrimmedString(...)`. Convert only when
   focused tests prove the node can stream children or use a smaller owned
   output surface.
4. **Generated selector/output ownership**: selector expansion, extend output,
   and direct comment children may still need owned placement surfaces. Reduce
   these with parentage, visibility, and extend-output tests; do not collapse
   them by pattern.
5. **Function/mixin argument surfaces**: metadata-backed functions still need
   copied raw-argument ownership for `this.rawArgs`, `this.args()`,
   preprocessing, lazy params, validation, and `@arguments`-style behavior.
   Plain functions should keep receiving positional args directly.
6. **Context shadow state**: `Context.rulesContext`, `ScopeFrame.fallbackFrame`,
   and similar render/eval shadow state are suspect surfaces. Keep them only
   where they express live scope or placement state better than copied nodes.

## Guardrails

- Base `Node.copy()` / `Node.clone()`, keyset copies, bitset copies, reusable
  leaf helpers, and test-only clones are infrastructure, not automatic wins.
- `prepareRenderPrintState(...)` is the central bridge for active writer,
  frame, and trivia state. Do not add local writer/frame/trivia reset heuristics.
- Shared render-buffer helpers must stay narrow:
  - `writeRenderText(...)` writes already-rendered text.
  - `writeRenderedOutput(...)` writes an already-chosen evaluated node.
  - `writeMaybeRenderedOutput(...)` only removes promise plumbing.
  - root-aware helpers only preserve the `Rules` root serializer exception.
- Invisible registration or side-effect nodes should stay invisible unless a
  focused output test proves a real render seam.
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
