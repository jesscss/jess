# Registry Redesign — Handoff

This file is the current high-level roadmap for the registry/runtime redesign.
It is not an operational queue.

Older April 2026 benchmark audits, proposal text, and investigation ticket
drafts are archived under `docs/_archive/future-performance-2026-04-13/`.
Use those only for archaeology; do not treat their dated "current system" notes
as active guidance.

For active execution, prefer:

1. `AGENTS.md`
2. `docs/future/node-copy-reduction/README.md`
3. `docs/future/node-copy-reduction/HANDOFF.md`
4. `docs/future/pre-eval-elimination.md`

Do not recreate the retired task registry, task loop, or auto-loop machinery
from older notes. Work from current code, focused tests, and the small active
handoffs above.

## Current Status

The old failure buckets were removed because they described past recovery work
as if it were current state. For the current baseline and exact verification
commands, run the active handoff checks in `docs/future/node-copy-reduction/`
and the relevant focused tests for the code being changed.

## Architecture Direction

The long-running refactor is still pointed at the same destination:

- one canonical source tree
- lookup state carried by explicit `ScopeFrame` / registry surfaces, not copied
  provenance
- node-local evaluation state shrinking over time
- render/eval moving toward one source-order walk with a temporary output
  buffer, not a retained evaluated AST
- cloning and materialization treated as debt unless a focused test proves a
  semantic ownership boundary

Useful rule of thumb: if a pass does not make the source tree lighter, remove
routine copying, or move output closer to session-owned render state, it is
probably not advancing this refactor.

## Track Summary

### Track 1A — Lookup And Binding Transport

Closed.

The live path no longer depends on wrapper-inserted declaration nodes for mixin
params, rest params, `$for` iteration variables, or `@arguments`. Runtime lookup
uses explicit frame/binding state and fast indexed lookup surfaces.

Keep closed unless a focused code path proves variable/mixin lookup has fallen
back to declaration-shaped transport again.

### Track 1B — Canonical-Tree Convergence

Closed.

Mixin, import, loop, and callable surfaces were audited and converted away from
fork-era provenance transport. Remaining wrapper surfaces are semantic ownership
boundaries: import boundaries, postludes, invocation result containers, loop
iteration surfaces, and output containers that carry real scope or placement
state.

Keep closed unless evidence shows a surviving wrapper exists only to fake
placement-local state.

### Track 1C — Eval / Render API Convergence

Closed.

Direct `render(context)` / `resolve(context)` ownership exists across leaf,
value, expression, selector, declaration, ruleset, import, and control-flow
surfaces that previously fell through generic source-node eval stamping.

Raw `return this.evalNode(context)` is not automatically a bug. Several classes
intentionally delegate directly to their node-specific eval body to avoid the
generic `Node.evalStatic(...)` stamping path. Reopen Track 1C only with a
focused failing test or code path showing direct `render(context)` /
`resolve(context)` still stamps a canonical source node.

### Track 2 — Node Shape: Direct Instance Fields

Open, not active.

Goal: replace the current `value` proxy/object pattern with direct typed fields
on node classes where that meaningfully reduces allocation and makes ownership
clearer.

Do not start this as a broad mechanical rewrite. The next useful pass should
begin with one node family, focused tests, and a migration rule for parser and
Less-compat call sites.

### Track 3 — Less-Compat Adapter Layer

Mostly closed.

The proxy-to-adapter switch has landed. Revisit after Track 2 changes the core
node API; until then, avoid adapter churn unless it fixes a concrete API bug or
removes stale field-mapping glue.

### Track 4 — TriviaMap Cleanup

Closed for the earlier parser-side pre/post ownership cleanup.

The current contract is:

- each parsed file owns one `TriviaMap`
- `before` and `after` are lookup directions around an offset, not trivia kinds
  or ownership labels
- skipped-token runs can be indexed from neighboring offsets but are consumed
  once by the active print state
- direct rule-body block comments are `Comment` children
- inline/value/selector comments and whitespace stay in `TriviaMap`
- moved/evaluated/copied nodes must not preserve copied source-offset trivia as
  if they still lived at their authored position

Future trivia work should be a focused serializer or AST-shape slice, backed by
tests. Do not move trivia back onto nodes.

### Track 5 — Pre-Eval Elimination / Buffered Render

Open and active after the current node-copy cleanup frontier.

Target shape:

- a source-order render/eval walk
- local identity prep where lookup requires it
- static registration before child output
- narrow fixed-point retries only for proven blockers
- typed render-buffer segments for delayed finalization
- no broad priority queue as the normal renderer
- no AST v2 hidden inside the render buffer

The buffer is temporary output state. Add a segment only when delayed
finalization is real: selector extension, reference visibility, hoisting, merge
declarations, or a concrete pending lookup. If output can be written as strings
in flat mode, it should stay strings.

Current implementation state:

- `packages/core/src/tree/util/render-buffer.ts` defines the initial
  `RenderBuffer` / segment types and helpers. Buffer selection now knows all
  currently named delayed-output families: extends, reference imports, hoists,
  merges, and pending refs.
- Flat-buffer bridging exists for many simple nodes.
- Segmented buffers can still accept finalized string output. A delayed parent
  segment is not permission to retain child node structure when a child can
  already render to a string.
- Segmented rendering is not integrated into structural nodes yet.
- Extend collection still uses AST/runtime-side machinery rather than a render
  side table.
- Reference visibility, selector finalization, and hoist/merge finalization are
  still post-step work.

## Active Todo List

Use this list as the roadmap after the current node-copy frontier check is
clean:

1. Keep reducing routine `clone()` / defensive copy boundaries where focused
   tests prove the source tree stays canonical.
2. Keep `sourceNode` on semantic provenance surfaces only: import/reference
   identity, selector keyset/library inheritance, sourcemap/trivia mapping, and
   focused recursion/lookup identity. Production `sourceParent` transport is
   gone; do not reintroduce it.
3. Reduce writer preview scaffolding. Production `OutputWriter.capture()` use
   is retired outside the writer implementation; remaining broad usage is
   `mark()` / `getSince()` local serializer windows plus the real
   `Rules._emitRulesBody(...)` preview path. Do not remove that path without
   focused ruleset/at-rule/trivia/sourcemap tests.
4. Implement the first structural `RenderBuffer` integration only where a node
   has a proven delayed-output need.
5. Move extend collection toward render-pass side-table population.
6. Implement a pure post-step for selector finalization, extend application,
   and reference visibility.
7. Migrate `extend-roots.ts` reachability logic toward a pure
   `ExtendRoot x ExtendRoot` predicate usable by the post-step.
8. Remove base-class `preEval` / generic eval stamping / compatibility
    serialization bridges only after node-level replacements and parity
    coverage prove they are unused.

## Guardrails

- Preserve Jess behavior unless a behavior change is explicitly chosen.
- Do not weaken Less fixtures or core tests to make refactors look complete.
- Do not add broad abstractions without multiple node-shape proofs.
- Do not use `sourceNode` to smuggle invocation scope, and do not reintroduce
  `sourceParent` transport.
- Do not reintroduce wrapper `VarDeclaration` insertion for lookup transport.
- Keep docs short enough to read at startup; move old debugging archaeology to
  archive or git history instead of keeping it in active handoffs.

## Useful Verification

Run the smallest focused test while iterating, then the nearest broader proof.
For handoff-level claims, use:

```sh
pnpm run verify:baseline
```

For core-only refactors, add focused package-local tests and usually run:

```sh
pnpm --filter ./packages/core test -- --run
pnpm --filter ./packages/core exec tsc -p tsconfig.build.json --noEmit
```
