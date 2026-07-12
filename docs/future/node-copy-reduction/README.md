# Node Copy Reduction

This folder is historical background for the older node-copy-specific phase.
The active eval/render architecture handoff is now
[`docs/future/core-architecture/HANDOFF.md`](../core-architecture/HANDOFF.md).

The old framing was too narrow. Current work optimizes total hot-path cost:
AST nodes, state/tracking objects, `WeakMap` side maps, recursive walks,
function-call overhead, parse/execution size, source parentage, and public API
boundaries. Use this README for context, not as the active queue or completion
contract. Older per-file completion logs live in
`docs/_archive/node-copy-reduction/README-2026-05-12.md`.

## Direction

- Keep one canonical source tree as the default model.
- Treat fastest practical tree evaluation/render for real-world Less
  stylesheets as the project priority. Right now, the working strategy is
  complete single-pass eval/render and minimum honest node creation. A green
  output test is not enough if the path still builds a broad output tree,
  clones routine subtrees, or creates wrapper surfaces that are not required by
  scope, lookup, placement, or user-code mutation semantics.
- Treat memory reduction as second to speed. Object-count reduction is a proxy,
  not the goal: keep or add an object when it makes the hot path faster or
  prevents broader allocation, copying, or lookup work.
- Prefer lazy per-placement runtime state over routine copied or cloned trees.
- Do not treat `copy()` / `clone()` as the future evaluation model.
- Do not treat mutation helpers such as `inherit(...)`, `set(...)`, or derived
  wrapper construction as the future evaluation model either. They are
  transitional ownership tools. Keep them local, prove why each one is needed,
  and prefer replacing broad helper-driven mutation with explicit side state or
  direct render/eval output as the surrounding seam becomes clear.
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
selector placement truly needs one. Remaining work should prove that each kept
surface is necessary and should remove or narrow anything that exists only so a
later serializer can walk it.

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
  render-buffer utility layer. Root direct render keeps the CSS-document final
  newline; non-root direct render trims one trailing rule separator because it
  returns a body fragment. Buffer render preserves the full emitted fragment
  text so loop/control aggregation can concatenate iterations without guessing
  at separators.
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
  canonical body. Empty control output and loop output grouping wrappers are
  generated containers: they do not inherit source location/options or copy
  function registries. Only runtime iteration/state surfaces preserve function
  registries for body lookup. `$for` body registration prep is lazy and does
  not run for empty iterables.
- The base `Node.render(context)` implementation is the inherited
  static/source serializer. It does not call `resolve()` or serialize an
  evaluated wrapper. Nodes whose output depends on context must override
  `render(...)`, choose the evaluated value locally, and serialize that value
  through the protected `renderOutput(...)` / `renderSource(...)` base
  primitives. Expression-like native render
  overloads must also await async child resolution instead of falling back to
  authored syntax; direct string render and buffer render should choose the
  same evaluated value. Static or source-only nodes should use the base render
  path instead of reimplementing local string/buffer branching, except when
  they inherit from a context-dependent base and need to opt back into source
  rendering. Base render owns the normal invisible/full-render source gate;
  invisible side-effect nodes must override when evaluation still needs to run.
- `Collection` and `RawRules` are intentional source-only exceptions because
  they inherit from context-dependent `Rules`; they delegate to base
  `Node.render(...)`.
- `Reference.render(...)` follows that rule by evaluating the reference locally
  and then rendering the referenced node through its native render path,
  including async referenced values. Do not turn references back into "eval
  node, then source-serialize the resolved value" bridges.
- Rules-like references (`Rules`, `Collection`, `Mixin`, and `Ruleset`) are
  not text-only reference containers. They carry callable/public lookup
  surfaces, so render and resolve must preserve them through a shallow owned
  reference surface until a future placement record can carry those facts
  explicitly.
- `SelectorCapture.render(...)` follows the same native resolved-payload rule
  for selector-valued payloads.
- `AtRule.render(...)` still needs a derived evaluated at-rule surface for
  body/root-hoist compatibility, but final evaluated body output is no longer
  carried by assigning `node.value.rules = finalRules`. At-rules expose their
  active render body through `getRenderRules()`, and the rules-container
  serializer uses that method when it needs the body.
- The remaining direct unevaluated `AtRule.render(...)` derived surface is a
  compatibility/debug isolation surface. It currently protects dynamic
  name/prelude evaluation, body eval isolation, root-only frame clearing, and
  nested extend-root registration from mutating the canonical source at-rule.
  Do not delete it until those responsibilities are split into explicit state
  or direct render paths.
- Dynamic leaf at-rule render is the first split: direct and buffer render
  evaluate name/prelude into local render state without evaluating a derived
  at-rule surface. Leaf `resolve(...)` still returns an owned at-rule node;
  body/root-hoist at-rules still use the compatibility isolation surface.
- Plain static direct `Rules.render(...)` is split from the compatibility path:
  rule-leaf bodies serialize the canonical source tree without deriving/evaling.
  Broader static Rules can still carry nesting, hoists, controls, or
  declaration merges, so they stay on the owned eval surface until registration
  prep, body-fragment serialization, and public resolve compatibility are
  separated.
- `AtRule.resolve(...)` returns static at-rules directly. Dynamic at-rules
  still derive before eval so prelude/body mutation does not touch the source.
- `Declaration.render(...)` evaluates through declaration registration/value
  state and writes declaration syntax directly. It does not materialize a
  prepared declaration node for direct render; `resolve(...)` still returns a
  public node result and may materialize one.
- `Ruleset.render(...)` follows the same container-output rule for evaluated
  rulesets. When evaluation returns a `Rules` body instead of a ruleset, it
  delegates to that body's native render path.
- There is no shared at-rule/ruleset render bridge anymore. `AtRule.render(...)`
  and `Ruleset.render(...)` call `serializeRulesContainer(...)` directly with
  active render print state.
- `Block.render(...)` and `List.render(...)` resolve local child values, then
  serialize through their native block/list syntax printers. They do not use
  the generic source-output bridge as a completed-output serializer.
- `Sequence.render(...)` follows the same local-syntax rule for resolved
  sequences, while delegating non-sequence resolved outputs to that node's
  native render path.
- Expression, wrapper, selector, interpolation, and URL render paths choose
  their local output and then call the base `renderOutput(...)` primitive. The
  old resolved-output adapter is gone; do not recreate a generic "resolved
  value, now serialize" bridge outside the node inheritance model.
- Condition/default-guard render is a direct boolean text path. Keep
  `eval()` / `resolve()` returning `Bool` nodes, but do not allocate a `Bool`
  during render just to print `true` or `false`. Default-guard normalization
  should use primitive booleans until a public node-result API requires a fresh
  `Bool`; do not introduce shared singleton `Bool` nodes because node parent
  and runtime flags are mutable. `Paren.render(...)` follows the same render
  rule for direct `default()` values while preserving `Bool` node results for
  eval/resolve.
- Plain CSS calls render their arguments/content natively. Direct and buffer
  `calc(...)` render share the same evaluated argument normalization, including
  nested `calc(...)`; authored source syntax is still available through
  `toString()` / `toTrimmedString()`.
- Dynamic non-string calls render by evaluating `CallEvalState` locally and
  then using the evaluated result's native render path. The old copied
  fallback `Call` surface is gone. Already-evaluated fallback calls are
  finalized syntax, not another name-evaluation request; direct state eval
  marks that output before render so optional CSS fallback calls do not
  recurse into name lookup. Dynamic calls use the base `renderOutput(...)`
  primitive for final output delegation. Preserve-rules-like variable names
  still get a small owned reference state; do not broaden dynamic-name copying
  without focused proof, because broad copied-name state has already caused
  runaway allocation. Metadata functions evaluate params from their owned arg
  surface and rely on `callWithContext(...)` for the single owned `rawArgs`
  list.
- `packages/core/src/define-function.ts` is no longer blocked by unrelated
  focused lint debt. Function argument-surface work should keep metadata access
  typed and avoid rebuilding unused validation paths.
- Context shadow state is intentionally small runtime state, not an output
  tree substitute. Keep `ScopeFrame.liveSlotsByName` for mixin params,
  `@arguments`, loop counters, and `$while` mutation; keep
  `ScopeFrame.fallbackFrame` for caller fallback/leaky body lookup; keep
  `Context.rulesContext` as the active lexical/eval scope pointer. These are
  the mechanisms that let evaluation avoid rewriting parent pointers or
  cloning caller/loop body trees. Remaining cleanup should shrink redundant
  save/restore plumbing or broad context mutation, not remove the frame model.
  Ordinary temporary `rulesContext` switches should use the shared context
  helper; manual restore callbacks are for custom flows that span more than one
  local evaluated operation.

## Remaining Architecture Work

The remaining work is not "add a buffer overload to every class." It is to
remove the places where eval still creates broad output surfaces merely so a
later serializer can walk them.

These are architectural seams, not a live ordered queue. Use
[`../core-architecture/HANDOFF.md`](../core-architecture/HANDOFF.md) for the
current order of work.

1. **Loop eval surfaces**: direct loop-body child copying and source-state /
   function-registry copying on output grouping wrappers are no longer the
   active frontier. Keep the existing render, static-child, dynamic-child,
   scalar-leaf, and registry guards green while reducing any remaining loop
   output surfaces.
2. **Generated selector/output ownership**: selector expansion, extend output,
   and direct comment children may still need owned placement surfaces. Reduce
   these with parentage, visibility, and extend-output tests; do not collapse
   them by pattern.
   The current `GeneratedPseudoPlacementState` is intentionally smaller than
   the possible future model: it carries only source/name/arg plus the proven
   generated `:is(...)` wrapper-omission fact. Visibility, extend metadata, and
   composed-header facts remain AST-owned until focused selector-shape tests
   prove otherwise, but ruleset header composition now has one shared path for
   `getHeaderString(...)` and serializer frame-stack precomputation. Wrapper
   omission now lives as a generated-pseudo placement override when eval
   collapses a generated selector-list or selector arg; it is still placement
   state, not a parallel selector tree. Ampersand
   append/template state is similarly narrow: replacement selectors/text are
   derived locally when needed, and proven suffix templates such as
   `&-theme` use structured selector append output instead of flattening a
   whole complex selector-list parent into one `BasicSelector` string.
   The likely next model is a small generated-selector state object, not a
   new selector AST. It would sit beside a canonical selector node and carry
   only per-placement facts: evaluated replacement children, visibility
   overrides, selector-bit library, extend metadata, hoist/root placement, and
   composed-header cache. It must not own source children, rewrite source
   parentage, or become a second tree. Until that exists, keep the focused
   `SelectorList` / `ComplexSelector` / `CompoundSelector` ownership copies
   that prevent generated selector output from reparenting canonical source
   selector leaves.
   `inherit(...)` on a source child is specifically not an acceptable collapse
   strategy: collapsed output must either be an owned result or a future
   generated-selector state record that can render the canonical child without
   rewriting parent/location/runtime flags.
3. **Function/mixin argument surfaces**: metadata-backed functions still need
   one copied raw-argument ownership surface for `this.rawArgs`,
   `this.args()`, preprocessing, lazy params, validation, and
   `@arguments`-style behavior. That retained surface protects the canonical
   call argument list from user-code mutation through `this.rawArgs`. Plain
   functions should keep receiving positional args directly. Dynamic metadata
   render/resolve already routes through the owned `callWithContext(...)`
   rawArgs list instead of a copied source `Call`; the remaining call work is
   content-node and rules-like/fallback state, not another rawArgs surface.
4. **Context shadow state**: the frame model is a kept part of the target
   architecture. Audit this seam for redundant save/restore, stale aliases, or
   overly broad context mutation; do not replace `liveSlotsByName`,
   `fallbackFrame`, or `rulesContext` with copied nodes.
5. **Control render surfaces**: `$for` / `$while` stream generated iteration
   rules through direct `Rules.render(...)` calls. `$if` selected branches use
   branch `Rules.render(context)` for trimmed block output. Remaining work is
   about eval-only output wrappers, not adding another control render helper.

6. **Mixin output slots**: current mixin output wrappers are generated `Rules`
   owners because they carry lookup visibility, mixin-output gating,
   reference-mode clearing, repeated placement, and definition/caller
   `ScopeFrame` links. A future replacement should be an output-slot record,
   not another tree: source body, evaluated placement children, scope frame,
   visibility gates, reference/import flags, rule index, and caller fallback.
   It should stream its children through `Rules.render(...)`/child render paths
   and register only the lookup state needed for that placement. Do not move
   declarations or selectors into a parallel AST just to avoid constructing a
   `Rules` wrapper.
7. **Dynamic call state**: dynamic calls still derive a call surface to protect
   source name, args, content, and optional fallback syntax while the call
   evaluates referenced functions, rules-like variables, and fallback CSS
   function output. Plain dynamic JS functions without metadata and
   metadata-backed dynamic calls now skip that full copied call/arg surface:
   render/resolve evaluates only an owned dynamic name, then either passes
   source args directly or lets `callWithContext(...)` create the one owned
   rawArgs list. The likely replacement for the remaining paths is a small
   call-eval state record: evaluated name, evaluated args/content, finalized
   fallback name/options, caller pointer, and parent/source preservation flags.
   It must not expose mutable source args to metadata JS functions or reparent
   canonical call children.

## Guardrails

- Base `Node.copy()` / `Node.clone()`, keyset copies, bitset copies, reusable
  leaf helpers, and test-only clones are infrastructure, not automatic wins.
- `inherit(...)` is infrastructure too. It is acceptable when constructing an
  owned output surface that needs source location/options/runtime metadata, but
  it must not be called on a canonical source child just because eval/resolve
  collapsed to that child. If the target object is still part of the source
  tree, own it first or render it through side state.
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
  - `renderInvisibleEffect(...)` evaluates invisible side-effect output and
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

Use [`../core-architecture/HANDOFF.md`](../core-architecture/HANDOFF.md) for
the current execution checklist.
