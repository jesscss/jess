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
  `renderNodeToString(...)`; those helpers are test/utility bridges only.
- `preRenderVisitor` is the direct hook name for visitors that run after
  evaluation and before serialization. `postEvalVisitor` remains a compatibility
  alias for older plugin callers.
- The render-buffer frontier is not a per-node status list anymore. The
  important current facts are that the production bridge scan is green and
  that `$for` / `$while` stream each loop iteration through node render methods.
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
  `$while` render per iteration. `$while` carries loop-body variable mutation
  in a small live `ScopeFrame`, not in a full output tree. `$while` has focused
  guards for native buffer rendering, no `Rules.clone()` loop-body surface, and
  no direct loop-body child copy/clone inside per-iteration eval surfaces.
  `$for` and `$while` reuse both static and dynamic direct body children without
  reparenting the canonical body. A focused guard keeps stateful `$while`/`$for`
  native render aligned with eval serialization; changing same-iteration
  `$while` mutation visibility is a semantics decision, not a copy-reduction
  cleanup. Direct sync `render(context)` remains source syntax for
  compatibility.

## Remaining Architecture Work

The remaining work is not "add a buffer overload to every class." It is to
remove the places where eval still creates broad output surfaces merely so a
later serializer can walk them.

Priority seams:

1. **Legacy direct render fallback**: `Node.render(context)` still has a
   synchronous resolve-then-serialize compatibility fallback. Keep it until the
   public sync callers are audited, but do not route new compiler behavior
   through it.
2. **Materialization seam**: shrink the expected
   `verify:materialization-frontier` entry only when focused tests prove the
   compatibility path can stream children or use a smaller owned output surface
   without changing scope, registration, async, selector, or trivia behavior.
3. **Loop eval surfaces**: direct loop-body child copying is no longer the
   active frontier. Keep the existing render, static-child, dynamic-child, and
   scalar-leaf guards green while reducing any remaining loop output surfaces.
4. **Generated selector/output ownership**: selector expansion, extend output,
   and direct comment children may still need owned placement surfaces. Reduce
   these with parentage, visibility, and extend-output tests; do not collapse
   them by pattern.
5. **Function/mixin argument surfaces**: metadata-backed functions still need
   copied raw-argument ownership for `this.rawArgs`, `this.args()`,
   preprocessing, lazy params, validation, and `@arguments`-style behavior.
   Plain functions should keep receiving positional args directly.
6. **Context shadow state**: `Context.rulesContext`, `ScopeFrame.fallbackFrame`,
   loop live slots, and similar render/eval shadow state are suspect surfaces.
   Keep them only where they express live scope or placement state better than
   copied nodes.

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
pnpm run verify:materialization-frontier
pnpm run verify:package-exports
pnpm run verify:node-constructor-metadata
pnpm run test:less:test-data
pnpm --filter ./packages/jess-plugin-less-compat test
pnpm run verify:baseline
pnpm run verify:baseline -- --changed
```

## Working Rule

Pick one narrow production seam, prove it with the closest focused test, then
run the smallest broader verification that covers the affected behavior. Do not
add architecture or status documents that mostly describe absent machinery.

Use [HANDOFF.md](./HANDOFF.md) for the current execution checklist.
