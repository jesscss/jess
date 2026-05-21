# Node Copy Reduction — Handoff

## Open This First

This is the live status and next-work page for the eval/render/copy refactor.
Keep it current enough that an agent can open this file, see where the repo is,
and pick the next honest checkpoint without rebuilding weeks of context.

Use [README.md](./README.md) for the architecture rules. Use this file for the
current state, immediate queue, and verification commands.

## Status Snapshot

- Public CSS output APIs (`render(...)`, `renderString(...)`,
  `renderToResult(...)`, and `safeRender(...)`) use the awaited eval/render
  path. `safeCompile(...)` remains the explicit compatibility/debug API for
  callers that need a tree surface.
- The public `preEval()` method and old `preEvaluated` flag are gone.
  Registration identity setup is explicit through `prepareRegistration()` and
  tracked by `registrationPrepared`.
- The compiler render phase writes through `Rules.render(...)` into a flat
  render buffer. Production code must not call the bridge helpers
  `renderNodeToBuffer(...)`, `renderNodeToWriter(...)`, or
  `renderNodeToString(...)`; those are internal/test utilities.
- The package-root render-buffer export is intentionally narrow:
  `createRenderBuffer`, `finalizeFlatRenderBuffer`, and their types. Do not
  export bridge helpers from the root package.
- The base `Node.render(context)` implementation is a direct source serializer,
  not a resolve/eval-then-serialize fallback. Context-dependent nodes must
  choose their evaluated output locally and serialize through shared print
  state.
- `$if`, `$for`, and `$while` avoid materializing control-wrapper output before
  buffer render. `$if` renders only the selected branch; `$for` and `$while`
  render per iteration.
- `$while` carries body variable mutation in a live `ScopeFrame`, not in a
  full output tree. Same-iteration mutation visibility is runtime semantics,
  not a copy-reduction cleanup.
- `$for` and `$while` reuse static and dynamic direct body children from the
  canonical body without reparenting them. Frozen non-static placement nodes
  re-evaluate instead of retaining a per-placement eval stamp.
- Render-buffer, materialization, and node-copy frontier scans cover production
  package `src` trees across the monorepo, not only `packages/core`.
- The node-copy frontier is clean for deep copy/clone, loop eval-surface child
  copies, and ordinary production `.copy()` outside infrastructure. BitSet
  `.clone()` calls are ignored because they are selector-index data copies, not
  AST ownership copies.
- Remaining wrapper/helper surfaces are not automatically bugs. Keep a wrapper
  when it carries real scope, registry, import/reference, merge, generated
  selector placement, delayed output, or ownership state.
- Extend registration now shares one generated-selector registration path for
  sync and async selector eval. Parent-list composition, implicit ampersand
  materialization, reference-scope tagging, and document-order capture should
  stay centralized there.
- Generated `:is(...)` wrappers now consume the already-owned selector copies
  produced by validation/decorating instead of copying those selectors a
  second time while building the wrapper argument list.
- `extend-walk.ts` is lint-clean for selector/container ownership assertions.
  Traversal code now uses real selector guards at parent boundaries instead of
  assertion casts when rebuilding compound, complex, pseudo, and list surfaces.

## Immediate Queue

Work these in order unless current code evidence proves a different seam is
hotter.

1. **Generated selector and output ownership.**
   - Goal: reduce owned placement surfaces only where tests prove they are
     bookkeeping, not semantics.
   - Next start in selector-list append paths and boundary-crossing
     finalization. The extend declaration registration branch has been
     centralized, and generated `:is(...)` wrapper construction now has one
     placement-copy step. The walk path is assertion-clean now; do not split
     those ownership paths again.
   - Required proof: focused parentage, visibility, output-order, and extend
     tests plus the frontier checks below.
2. **Context shadow state.**
   - Goal: classify `Context.rulesContext`, `ScopeFrame.fallbackFrame`, loop
     live slots, and related shadow state as keep, shrink, or remove.
   - Keep state that models live scope or placement better than copied nodes.
   - Required proof: focused import/reference/mixin/loop tests plus baseline
     changed mode.
3. **Function and mixin argument ownership.**
   - Goal: keep copied raw args only for metadata-backed contracts that need
     stable authored args.
   - Preserve `this.rawArgs`, `this.args()`, preprocessing, lazy params,
     validation, and `@arguments` behavior where tests prove that contract.
   - Plain functions should receive positional args directly.
4. **Chosen-output helper cleanup.**
   - Goal: shrink helper plumbing without growing an AST-v2 buffer model.
   - `renderChosenOutput(...)` is transitional overload routing for nodes that
     already chose an output node. Do not add semantics to it.
   - Delete or narrow helpers only when a node can directly choose and
     serialize without duplicating promise/buffer branches.
5. **Registration prep shrink.**
   - Goal: keep `prepareRegistration()` for lookup identity only.
   - Do not recreate `preEval()` under another name. Any new registration work
     must be local, explicit, and tied to lookup behavior.

## Verification

Use the nearest focused test while iterating. Before claiming a handoff-level
status change, run:

```sh
pnpm run verify:node-copy-frontier
pnpm run verify:render-buffer-frontier
pnpm run verify:materialization-frontier
pnpm run verify:package-exports
pnpm run verify:baseline -- --changed
```

Use the full baseline when a change touches root gates, package metadata,
shared verifier scripts, or broad render/eval contracts:

```sh
pnpm run verify:baseline
```

## Checkpoint Rule

A checkpoint is one coherent code or docs change with verification. If a seam
is too large, finish the smallest honest slice that leaves the repo and this
handoff more truthful than before.

For each checkpoint:

1. Read the relevant source and focused tests before editing.
2. Make the smallest behavior-preserving change.
3. Run focused proof first.
4. Run the nearest broader verification.
5. Update this handoff if the current state or immediate queue changed.
6. Commit and push when clean.

## Stop Conditions

Stop and ask before inventing semantics when:

- a fixture conflicts with documented Jess behavior;
- a wrapper seems removable but carries scope, import/reference, selector
  placement, or delayed-output state;
- a red appears only in `packages/jess/test/less/all-less.test.ts` and there is
  no focused parser/core repro yet;
- fixing a frontier requires broad new helper families instead of deleting or
  narrowing existing machinery.

## Do Not Resurrect

- checked-in task registries or unattended task loops
- stage trackers that mostly describe absent machinery
- broad "current dirty diff" notes copied from an old session
- fixture-expectation changes that are not tied to an explicit Jess behavior
  decision
