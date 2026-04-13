# Registry Redesign — Handoff

Date: `2026-04-13`
Branch: `dev`
Checkpoint commit: `51291e2f` (`Add registry and benchmark performance audit docs`)

## Work Checklist

### Track 1 — Registry Bypass (Transition Slices)

- [x] Slices 1–4 — mixin params → `RuntimeVarBinding` cells; params bypass declaration registry
- [x] Slice 5 — `varsByName` fast map on `Rules`; lexical variable lookup bypasses declaration registry
- [x] Slice 6 — `ScopeFrame` introduced alongside registry; `buildScopeFrame` / `resolveFrameCell` in `scope-frame.ts`
- [x] Slice 7 — `mixinsByName` fast map on `Rules`; static-named mixin lookup bypasses `MixinRegistry.find`
- [ ] Slice 8 — Route mixin invocation through render model; build frame chain at call time; stop cloning mixin bodies
- [ ] Slice 9 — Delete fork/renderKey system (no remaining callers)
- [ ] Slice 10 — Delete `resolution: 'linear'`; delete generic `DeclarationRegistry` hot path; clean up

### Track 2 — Node Shape: Direct Instance Fields

Replace the current `value = Proxy({ name, value, ... })` pattern with direct typed class fields on each node class (e.g. `decl.name`, `decl.value`). Stable V8 hidden classes, no per-node Proxy allocation, no Proxy intercept cost.

- [ ] Audit all node classes for field shape (`declaration.ts`, `ruleset.ts`, `mixin.ts`, etc.)
- [ ] Migrate fields off `value` proxy to direct class properties with explicit `adopt()` calls
- [ ] Update all call sites in `core`, `fns`, parsers, and plugins to use new field accessors
- [ ] Update `less-compat` adapter layer to map old `value.name` / `value.value` paths to new fields
- [ ] Remove `value` proxy infrastructure from `Node` base class once all subclasses migrated

### Track 3 — Less-Compat Adapter Layer

Replace the transparent `Proxy`-based compat shim with explicit typed adapter classes (e.g. `LessRuleset`, `LessDeclaration`). V8-inlineable getters, no per-node Proxy, explicit API surface.

- [ ] Design adapter class interface for each Less-exposed node type
- [ ] Implement adapter classes (`jess-plugin-less-compat` package)
- [ ] Replace `isLessProxy` / `getJessNodeFromProxy` checks with `instanceof` guards
- [ ] Remove the `Proxy` factory from the compat layer
- [ ] Verify Less compatibility suite still green after switch

### Track 4 — Whitespace / Trivia Token Proposal

Replace `pre`/`post` string fields on nodes with an offset-keyed `FormattingMap`. Static declaration names become plain strings (not `Any` nodes), which simplifies static-vs-dynamic detection in `ScopeFrame` and removes a Proxy allocation per declaration.

- [ ] Finalize `FormattingMap` design (keyed by source offset or node identity)
- [ ] Remove `pre`/`post` from `Node` base class
- [ ] Migrate trivia storage to `FormattingMap` in serialization path
- [ ] Static `name` fields on `VarDeclaration`, `Declaration`, `Mixin` become plain `string` (not `Any`)
- [ ] Update `ScopeFrame` / `varsByName` / `mixinsByName` to key directly on `string` without `.valueOf()` call

### Track 5 — Pre-Eval Elimination

Registry redesign (Track 1) and direct instance fields (Track 2) are prerequisites. Once nodes are pure read-only templates and lookup goes through the frame chain, the two-phase eval+serialize collapses to a single render pass.

- [ ] Eliminate `preEval` phase from `_multiPassPreEval` — frame creation at render time replaces it
- [ ] Collapse `eval` + `toTrimmedString` into a single `render(ctx, buf)` method per node type
- [ ] Remove `evalNode` / `preEval` from node base class once all call sites migrated
- [ ] Verify end-to-end output parity with pre-existing test baselines

## Read This First

### Must Read For This Slice

1. [AGENTS.md](/Users/matthew/git/oss/jess/AGENTS.md)
2. [2026-04-13-registry-redesign-proposal.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-registry-redesign-proposal.md)
3. [2026-04-13-registry-architecture-audit.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-registry-architecture-audit.md)
4. [packages/core/src/tree/rules.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts)
5. [packages/core/src/tree/reference.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/reference.ts)
6. [packages/core/src/tree/__tests__/mixin.test.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/__tests__/mixin.test.ts)

### Background Context Only

Read these only if you need the broader performance story or canonical-tree
constraints behind the current design:

- [2026-04-13-less-benchmark-audit.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-less-benchmark-audit.md)
- [2026-04-13-less-benchmark-investigation-tickets.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-less-benchmark-investigation-tickets.md)
- [docs/future/node-copy-reduction/README.md](/Users/matthew/git/oss/jess/docs/future/node-copy-reduction/README.md)
- [docs/future/node-copy-reduction/HANDOFF.md](/Users/matthew/git/oss/jess/docs/future/node-copy-reduction/HANDOFF.md)

## What Was Started

The first implementation slice targets one specific architectural mistake:

- mixin-call params and `@arguments` were being materialized as `VarDeclaration`
  nodes
- those synthetic declarations were pushed into a wrapper `Rules`
- variable lookup then rediscovered them through generic declaration-registry
  search

That is exactly the wrong shape described in the redesign proposal.

The first cut changed that by making wrapper-scope param values available as
direct runtime bindings instead of wrapper-inserted declaration nodes.

The second cut removed another declaration-shaped transport step:

- mixin matching no longer rewrites matched `Any(role=property)` params into
  fake `VarDeclaration`s
- mixin matching no longer rewrites matched `Rest` params into fake
  `VarDeclaration`s just to carry values forward
- matching now carries:
  - runtime binding records for actual lookup
  - a separate `List<Node>` signature for recursion detection

The third cut removed the copied-and-mutated param list itself:

- mixin matching now reads original param definitions directly
- bound/default/rest values are cloned only for binding/signature payloads
- matching no longer mutates copied param nodes to transport values

The fourth cut removed a now-dead shallow `mixin.copy()` in candidate matching:

- candidate matching no longer makes a shallow mixin copy just to carry
  resolved params
- resolved binding records are keyed directly by the original matched mixin

The fifth cut adds a `varsByName` fast map on `Rules` for direct lexical
`VarDeclaration` lookup, bypassing the full declaration-registry machinery for
the dominant hot case (ordinary contextual variable lookup):

- `Rules.varsByName: Map<string, VarDeclaration[]> | undefined` — `undefined`
  means not yet indexed; an empty `Map` means indexed with no vars
- populated incrementally by `registerNode` as nodes are pushed
- also initialized at the start of `_indexRules()` for scopes that never had
  nodes pushed directly
- reset to `undefined` in `clone()` so cloned scopes re-index fresh
- `findVarDeclarationFast(startRules, name, filter)` in `reference.ts` walks
  `.parent ?? .sourceParent` (same as `findRuntimeVarBinding`), checks
  `varsByName` at each `Rules` scope, bails if any scope is not yet indexed
  (causing the caller to fall through to full registry which warms it up)
- called between the `findRuntimeVarBinding` check and the full `targetRules.find`
  in `performLookup` for `type === 'variable'`
- proof test added: a no-param mixin referencing `@base-color` 3 times asserts
  `declarationHits.length <= 1` — only the first lookup hits the registry; the
  second and third use the fast path

## Files Changed

- [packages/core/src/tree/rules.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts)
- [packages/core/src/tree/reference.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/reference.ts)
- [packages/core/src/tree/__tests__/mixin.test.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/__tests__/mixin.test.ts)

## Current Dirty Diff

### `rules.ts`

Added a lightweight runtime binding mechanism on `Rules`:

- `RuntimeVarBinding`
- `rules.runtimeVarBindings`
- `setRuntimeVarBinding(name, binding)`
- `findRuntimeVarBinding(name)`

Mixin invocation wrapper behavior changed:

- param wrapper scope still exists
- param AST nodes are still preserved for AST/debugging compatibility
- but wrapper params are no longer pushed into `outerRules` as lookupable
  declarations
- instead, wrapper params are registered via `outerRules.setRuntimeVarBinding(...)`
- `@arguments` is also registered as a runtime binding instead of a synthetic
  `VarDeclaration`
- matched `Any(role=property)` params now stay non-declaration-shaped during
  matching
- matched `Rest` params now stay non-declaration-shaped during matching
- recursion detection still gets a stable signature list, but that signature is
  now separate from the runtime binding transport
- matching no longer copies the whole params list before binding
- matching no longer mutates copied param nodes just to carry bound/default
  values
- matching no longer shallow-copies mixin candidates just to associate resolved
  params with them

### `reference.ts`

Variable lookup now checks runtime bindings before declaration lookup, and
then the `varsByName` fast path before the full registry:

- in `performLookup(...)`, variable lookup on `Rules` does:
  1. `targetRules.findRuntimeVarBinding(key)` first (mixin params)
  2. `findVarDeclarationFast(targetRules, key, filter)` second (lexical vars)
  3. full `targetRules.find('declaration', ...)` third (fallback / warm-up)

`findVarDeclarationFast` is a module-level function that:

- walks `.parent ?? .sourceParent` up the scope chain
- checks `scope.varsByName` at each `Rules` node
- returns `undefined` immediately if any scope is not yet indexed (warm-up
  fallback)
- stops at non-classic-import boundaries (same policy as full registry)

Reference evaluation also learned how to evaluate a runtime binding:

- evaluate the bound value
- copy/freeze the result similarly to declaration lookup
- preserve `pre` / `post`
- use `sourceNode` for recursion protection when available

### `mixin.test.ts`

The focused mixin suite was updated to match the new intended model:

- call-time params no longer render as emitted `$var: ...;` declarations
- mixin behavior still resolves those params correctly
- rest params and nested param lookups still work

This is an intentional semantic shift in output visibility for synthetic param
bindings.

## What Passed

Focused core verification is green:

```sh
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
```

That now includes a core-only guardrail proving:

- mixin-call param bindings
- default param bindings
- rest param bindings
- `@arguments`

resolve successfully without hitting `Rules.find('declaration', ...)` for those
names.

After the second slice, this is still green:

```sh
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
```

After the third and fourth slices, this is still green:

```sh
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
```

After the fifth slice, this is still green (34 tests):

```sh
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
```

Workspace dependency build is green:

```sh
pnpm --filter jess... build
```

Direct full benchmark render through the linked Less facade:

```sh
node -e 'const fs=require("node:fs"); const less=require("/Users/matthew/git/oss/less.js/packages/less"); const file="/Users/matthew/git/oss/less.js/packages/less/benchmark/benchmark.less"; const src=fs.readFileSync(file,"utf8"); less.render(src,{filename:file}).then(out=>{console.log("ok", out.css.length)}).catch(err=>{console.error(JSON.stringify({message:err.message, filename:err.filename, line:err.line, column:err.column, extract:err.extract}, null, 2)); process.exit(1);});'
```

Observed result:

- `ok 0` — confirmed pre-existing at clean commit `51291e2f` (before any session
  changes); slices 1–5 neither introduce nor worsen this. Treat as pre-existing
  harness integration debt; investigation is not the next step for this slice.

## What Is Still Broken

The old Less-facade benchmark harness investigation is no longer the primary
next step for this slice.

The redesign work should continue in `core`, with focused proofs and targeted
instrumentation there first.

The performance harness path is still not trustworthy for this slice:

This command currently fails:

```sh
node scripts/profile-less-benchmark.mjs --file=benchmark.less
```

Observed failure:

- `'size' is not defined`

Important narrowing:

- the failure does **not** reproduce in direct `less.render(...)` of the full
  benchmark file
- a tiny imported-mixin default-param repro also works in direct `less.render`
- so this looks like a harness-path mismatch, not a confirmed runtime
  regression in the main render path

## Harness Status

The harness failure is now treated as secondary tooling debt, not the main
driver of the redesign.

What is known:

- full `less.render(...)` of the benchmark file succeeds
- full `less.render(...)` with `math: 'always'` also succeeds
- importing `core`, `less-parser`, or `jess` alone does not reproduce the
  harness failure

So the failure is likely in the instrumentation setup itself, not the first
runtime-binding cut.

## Likely Cause Of The Remaining Failure

The most likely cause is that the profiling harness is exercising a slightly
different execution environment than the main Less facade path:

- different plugin setup
- different compiler entrypoint
- different option surface
- or different import/context plumbing

The current `'size' is not defined` symptom points at imported Less mixin
default-param access, but only in the harness path.

Do **not** assume the runtime-binding cut itself is wrong until the harness path
is made faithful to the real benchmark execution path.

## Next Step

Slices 1–7 complete. Mixin-param, ordinary lexical-variable, and static-named
mixin lookup hot paths all bypass the generic registry machinery.

The remaining smell:

- parsed default params still naturally exist as `VarDeclaration` nodes in the
  AST (not a correctness issue; just a shape mismatch)
- `ScopeFrame` is built and `resolveFrameCell` works, but the frame chain parent
  wiring (call-site lexical chain) is not yet live — that's Slice 8
- `resolution: 'linear'` still exists in `reference.ts` and should eventually be
  deleted (it was a mis-named attempt at call-time contextual lookup) — Slice 10

The next code slice (Slice 8):

1. Wire `ScopeFrame` parent chain at mixin call time (call-site lexical chain,
   not definition-site `.parent` chain).
2. Route mixin body evaluation through the live frame rather than the cloned
   wrapper `Rules`.
3. Remove the `mixin.copy()` / fork path for static-named mixins.
4. Keep verifying with:

   ```sh
   pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
   ```

## Constraints To Preserve

- Keep one canonical `Rules.value` array.
- Do not introduce cloning/materialization as a lookup strategy.
- Do not reintroduce wrapper `VarDeclaration` insertion just to make lookup
  work.
- Preserve the direct render behavior that is currently green.
- Keep the next cut narrow and measurable.

## Useful Commands

Focused test:

```sh
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
```

Build dependency chain:

```sh
pnpm --filter jess... build
```

Direct benchmark render sanity check:

```sh
node -e 'const fs=require("node:fs"); const less=require("/Users/matthew/git/oss/less.js/packages/less"); const file="/Users/matthew/git/oss/less.js/packages/less/benchmark/benchmark.less"; const src=fs.readFileSync(file,"utf8"); less.render(src,{filename:file}).then(out=>{console.log("ok", out.css.length)}).catch(err=>{console.error(JSON.stringify({message:err.message, filename:err.filename, line:err.line, column:err.column, extract:err.extract}, null, 2)); process.exit(1);});'
```

Current failing harness check:

```sh
node scripts/profile-less-benchmark.mjs --file=benchmark.less
```

## Current Worktree State

At the time of this handoff, the uncommitted files are:

- [packages/core/src/tree/rules.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts)
- [packages/core/src/tree/reference.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/reference.ts)
- [packages/core/src/tree/__tests__/mixin.test.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/__tests__/mixin.test.ts)
- [vitest.config.ts](/Users/matthew/git/oss/jess/vitest.config.ts) — `disableConsoleIntercept` (removed in vitest 4) replaced with `onConsoleLog` direct write
- [docs/future/performance/2026-04-13-registry-redesign-handoff.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-registry-redesign-handoff.md)
- [docs/future/performance/2026-04-13-registry-redesign-proposal.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-registry-redesign-proposal.md) — updated with live-binding cell model, fork-free mixin invocation direction, pre-eval-elimination relationship, removal of `linear` as a concept
