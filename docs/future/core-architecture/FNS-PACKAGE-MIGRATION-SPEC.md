# Fns → `@jesscss/fns` Package Migration Spec

> Status: DESIGN SURVEY (read-only). No code moved. This spec precedes an
> adversarial review; nothing here is committed engineering until that review.
>
> Owner decision driving this doc: **fn implementations must live in
> `@jesscss/fns` (`packages/fns/`), not in core.** Core ships ZERO fns and owns
> only a registration seam; the consumer registers the built-in set into core
> (the way `jess-plugin-less` already registers things today). The recent AST-v2
> ("native") fn set landing *inside* core (`packages/core/src/ast/native/`) was an
> interim seam step in the **wrong location** — the right seam, wrong package.
>
> Relevant memory: `retire-legacy-value-adapter` ("we OWN `fns/` → CONVERT it to
> the arena / AST-v2 value shape, don't adapt around it; converge to ONE shape,
> gate native ≡ adapter byte-identical") and `ast-v2-unified-node-model`.

---

## 0. Ground truth (surveyed 2026-07-16, branch `work/less-compat-bridge-fix`)

Several premises in the task framing do **not** match this branch. Recording the
real state first, because the migration plan keys on it.

| Task framing said | Actual on this branch |
| --- | --- |
| Fns live in `core/src/ast/functions/**` | They live in **`core/src/ast/native/**`**. The `native/`→`functions/` rename is NOT on this branch. |
| Registered via `createFnRegistry` / `FN_LIST` in `value-dispatch.ts` | There is **no `FnRegistry` / `createFnRegistry`** anywhere. The AST-v2 fn set is a **static compiled table** `NATIVE_FN_LIST` (in `native/index.ts`) that `value-dispatch.ts` turns into a `Map` at module load. No runtime registration seam exists yet. |
| Adapter is `buildAdapterEvaluator` | The adapter's export is **`buildEvaluator`** in `core/src/ast/parse-host/value-eval.ts`. The native counterpart is **`buildNativeEvaluator`** in `core/src/ast/native-evaluator.ts`. |
| ~50 Less fns remain to convert | For the **Less** scope only **11** remain (see §1). The "~50" figure counts the entirely-unconverted **Sass** set, which is a **non-goal** (memory `perf-gap-is-parser-and-allocation`: "SCSS = NON-GOAL"). |

Two dependency facts are the crux of everything downstream:

1. **`packages/fns` depends on `@jesscss/core`** (`package.json`: `"@jesscss/core": "workspace:*"`). All **126** non-test fns source files `import … from '@jesscss/core'` and construct **legacy tree nodes** (`new Color({...})`, `new Dimension({...})`, `defineFunction`, `Context`, `.operate`, `.inherit`). None are in the AST-v2 value shape. So today the edge is **fns → core**.

2. **Core has an undeclared reverse edge into fns.** `core/src/ast/parse-host/value-eval.ts` does `import * as lessFunctions from '@jesscss/fns'` — but `packages/core/package.json` does **not** list `@jesscss/fns` as a dependency. This is a phantom/undeclared dependency that only works because pnpm hoists the workspace. It creates a **latent core ⇄ fns cycle today**, tolerated only because that file (the adapter / differential oracle) is transitional and slated for deletion (retire-legacy-value-adapter, task #10).

The migration's north star: end with a **single-direction edge fns → core (types + value-factory only)**, no consumer-invisible default registration inside core, and the phantom core → fns edge deleted with the adapter.

---

## 1. Inventory & gap

### 1a. What is already converted to the AST-v2 value domain

The AST-v2 fn bodies live in `core/src/ast/native/` — **68 fn modules** (excluding
`index.ts`, `types.ts`, and the shared helpers `color-helper.ts`,
`color-ctor-helper.ts`, `math-helper.ts`, `list-helper.ts`). They are pure
value-domain code: they import only engine value modules
(`../value-eval.js` types, `../value-factory.js` constructors,
`./color-helper.js`, `./math-helper.js`, `../serialize-value.js`,
`../value-units.js`, `../literal-tag.js`, `../color-names.js`) — **never `../tree`,
never `defineFunction`, never `Context`.**

Converted (68): `abs acos alpha argb asin atan average blue ceil color contrast
convert cos darken desaturate difference e escape exclusion extract fade fadein
fadeout floor format green greyscale hardlight hsl hsla hsv hsva hsvhue
hsvsaturation hsvvalue hue length lighten lightness luma luminance max min mix
mod multiply negation overlay percentage pi pow range red replace rgb rgba round
saturate saturation screen shade sin softlight spin sqrt tan tint unit`.

Every one of these has a legacy twin in `packages/fns/src/less/`. There are **zero
native-only fns** (`comm -23` is empty) — the AST-v2 set is a strict subset of the
Less fns.

### 1b. The Less delta (still legacy-only)

`packages/fns/src/less/` has **79** fn modules. The **11** with no AST-v2 twin:

```
data-uri  each  get-unit  iif  image-height  image-size  image-width
isdefined  isruleset  logical  svg-gradient
```

These are exactly the classes the differential test scopes out as **Tier-C** (file
IO: `data-uri`, `image-*`, `svg-gradient`) and **control-flow / ruleset-kind**
(`iif`, `each`, `isdefined`, `isruleset`, `logical`, `get-unit`). They need
capabilities the current `NativeCtx` deliberately omits (file info, a ruleset
value-kind, lazy thunks). See `native/types.ts` — `NativeCtx` carries only
`{ modes, stringify }` and its JSDoc explicitly defers the IO bit "with the Tier-C
wave, not speculatively."

### 1c. The Sass set (out of scope)

`packages/fns/src/sass/**` is ~60 modules (`list/`, `map/`, `math/`, `string/`,
color wrappers, `shared/`), all legacy shape, **none** converted. Sass is a
non-goal for the alpha; this migration neither converts nor deletes it. It does,
however, ride along with the package move (it already lives in `packages/fns`), so
the boundary decision in §3 must not *break* it even though we don't convert it.

### 1d. Gap summary

| Bucket | Count | State |
| --- | --- | --- |
| Less fns converted to AST-v2 (in `core/ast/native/`) | 68 | AST-v2 shape, in the wrong package (core) |
| Less fns still legacy-only (`fns/less/`) | 11 | legacy tree shape; Tier-C / control-flow |
| Sass fns (`fns/sass/`) | ~60 | legacy tree shape; **out of scope** |
| Native-only fns (in core but not fns) | 0 | — |

The **primary migration payload is those 68 already-converted modules**: they must
**relocate from `core/ast/native/` to `packages/fns/`** unchanged in behaviour,
byte-identical in output. The 11 remaining Less fns are a *subsequent* conversion
wave that happens **in `packages/fns` directly** (converted where they land, not
converted-in-core-then-moved).

---

## 2. Target module boundary (end state)

```
┌─────────────────────────────────────────────────────────────────────┐
│  @jesscss/core                                                        │
│                                                                       │
│   ast/value-eval.ts        ← value-domain TYPES (Dimension/Color/…)   │
│   ast/value-factory.ts     ← value CONSTRUCTORS (makeDimension/…)     │
│   ast/value-operate.ts     ← operate/compare/typeCheck                │
│   ast/serialize-value.ts   ← free value serializer                    │
│   ast/value-units.ts       ← unit table/convert                       │
│   ast/color-names.ts       ← name→rgb table                           │
│   ast/literal-tag.ts       ← materialize/sniff                        │
│                                                                       │
│   ast/fn-registry.ts  (NEW)  ← FnRegistry + createFnRegistry seam.    │
│                               Ships EMPTY. Registers NOTHING.         │
│   native-evaluator.ts        ← calls registry.dispatch(name,…),       │
│                               NOT a compiled-in table.                │
│                                                                       │
│   (core has NO fn bodies, NO @jesscss/fns dependency)                 │
└───────────────▲───────────────────────────────────────────▲──────────┘
                │ import type + value-factory (runtime)      │ import
                │ (single direction: fns → core)             │ registry seam
┌───────────────┴──────────────────┐              ┌──────────┴────────────┐
│  @jesscss/fns                     │              │  consumer (plugin/CLI)│
│   less/*.ts   (68 moved + 11 new) │              │  registers builtins   │
│   builtins.ts (NEW): the FN_LIST  │─────────────▶│  into core's registry │
│   sass/*.ts   (untouched, legacy) │  exported    │  at bootstrap         │
└───────────────────────────────────┘  fn list     └───────────────────────┘
```

### 2a. Core's seam surface

Core exposes (from `ast/index.ts`, re-exported at the package root):

- `interface FnRegistry` — the runtime table: `register(fn: NativeFn)`,
  `registerAll(fns: readonly NativeFn[])`, `has(name): boolean`,
  `dispatch(name, list, ctx): ValueObj`.
- `createFnRegistry(): FnRegistry` — returns an **empty** registry.
- The value-domain public types + constructors fns need to author bodies
  (`NativeFn`, `FnSpec`, `ParamSpec`, `Kind`, `NativeCtx`, `ValueObj` and its
  members, `makeDimension`/`makeColor*`/`makeQuoted`/`makeKeyword`/`makeList`/…,
  plus the helpers the 68 bodies use — see §3).

`buildNativeEvaluator` gains a parameter: `buildNativeEvaluator(registry:
FnRegistry)`. Its `call` path becomes
`registry.has(name) ? registry.dispatch(name, args, ctx) : verbatim`. The current
hard-coded `NATIVE_FN_LIST → Map` in `value-dispatch.ts` is deleted; `dispatchNative`/
`hasNativeFn` become methods on the registry object (same `bind`-by-kind logic,
same throwing semantics — moved, not rewritten).

### 2b. Where the default built-in registration lives (the load-bearing decision)

Requirement: `less` / `.less` rendering must get its fns with **zero user wiring**,
yet core must register **nothing** by default and must not depend on
`@jesscss/fns`.

**Resolution — the consumer's render entry owns default registration.** Concretely,
the same place that already registers legacy fns today:
`jess-plugin-less/src/index.ts` `_registerFunctions()`. Today that iterates
`Object.entries(lessFunctions)` and calls
`tree.setFunctionBinding(name, new JsFunction(...))` (the *legacy* eval path). In
the end state it instead does:

```ts
import { builtinLessFns } from '@jesscss/fns';        // the AST-v2 FN_LIST
const registry = createFnRegistry();
registry.registerAll(builtinLessFns);
// hand `registry` to the serialize()/evaluator construction
```

So **`@jesscss/fns` exports the built-in list** (`builtinLessFns`, the successor of
`NATIVE_FN_LIST`), and **the plugin (the consumer) is what calls `registerAll`**.
The plugin already `import * as lessFunctions from '@jesscss/fns'` and already owns
the render options plumbing (`mathMode`/`unitMode`/`collapseNesting`/…), so it is
the natural and pre-existing seam. This keeps core fn-free while `.less` users get
the full set automatically because they always go through the plugin.

**Rejected alternative — a default set inside core.** Having core import
`@jesscss/fns` to pre-populate the registry re-creates the core → fns edge (a
runtime cycle, since fns → core for value types). Explicitly forbidden by the owner
decision ("core must ship ZERO fns"). Not done.

**Open sub-question for the reviewer:** whether a *third, thin* convenience package
(e.g. `@jesscss/fns/less-preset` or the existing `jess` CLI entry) should host the
`createFnRegistry().registerAll(builtinLessFns)` one-liner so both the plugin and
any direct-`@jesscss/core` embedder share it. Recommendation: **no new package** —
the plugin is the single blessed `.less` entry; a direct-core embedder is an
advanced user who wires the registry explicitly (which is the whole point of the
seam). Flagged, not decided.

---

## 3. The value-domain conversion contract (the crux: no cycle)

The 68 moved bodies must **produce AST-v2 value objects** without dragging core
into a cycle. Break it into what crosses the boundary and in which direction.

### 3a. What fns need from core, and whether it's a runtime edge

The 68 native modules import, in order of frequency:

| Imported from core | Kind | Runtime or type-only? |
| --- | --- | --- |
| `value-eval.js` (`ValueObj`, `Dimension`, `Color`, `EvalModes`, `List`, …) | types | **type-only** (erased) |
| `native/types.js` (`NativeFn`, `FnSpec`, `NativeCtx`, `Kind`) | types | **type-only** (erased) |
| `value-factory.js` (`makeDimension`, `makeColor*`, `makeKeyword`, `numOf`, `colorHsl`, …) | constructors | **runtime** |
| `native/color-helper.js`, `math-helper.js`, `list-helper.js`, `color-ctor-helper.js` | helpers | **runtime** (these move WITH the fns) |
| `serialize-value.js` | serializer | **runtime** |
| `value-units.js` | unit table | **runtime** |
| `literal-tag.js` | materialize | **runtime** |
| `color-names.js` | name→rgb table | **runtime** |

The `native/*-helper.js` files are fn-private and **relocate into `@jesscss/fns`
alongside the bodies** — they stop being a boundary crossing entirely. What remains
as a genuine **runtime** fns → core edge is the *engine value substrate*:
`value-factory`, `serialize-value`, `value-units`, `literal-tag`, `color-names`,
and the `value-eval`/`value-operate` runtime bits (`operate`, `emitValue`).

### 3b. Dependency direction: fns → core, single edge, no cycle

**Proposal: keep the value substrate in core; fns depends on core for it; core never
imports fns.**

- fns → core is **already** the declared edge (`fns/package.json` →
  `@jesscss/core`). We are *keeping* its direction, just changing *what* is imported
  (AST-v2 value substrate instead of legacy `Color`/`Dimension`/`defineFunction`).
- core → fns must be **eliminated**: it exists **only** in the adapter
  (`parse-host/value-eval.ts`), which is deleted in task #10. Once deleted, and once
  the `NATIVE_FN_LIST` table is gone from `value-dispatch.ts`, **core has no import
  of `@jesscss/fns` at all** — the phantom dependency is gone and there is no cycle.
- The registry seam does **not** invert this: `createFnRegistry()` returns an empty
  object; the *consumer* pushes fns in. Core references `NativeFn` only as a **type**
  (erased). No runtime core → fns edge is created by the seam.

**Why not move the value types to a shared `@jesscss/value` package?** That is the
textbook cycle-breaker, but it is **not needed here** and it is **premature**:

1. The edge is already one-directional once the adapter dies; there is nothing to
   break.
2. The value substrate (`value-factory`, `serialize-value`, `value-units`,
   `literal-tag`, `value-operate`) is **deeply co-evolving** with the in-flight
   literal-tag P0 and node-model unification (§4). Extracting it to its own package
   mid-flight would freeze an interface that is actively churning and multiply the
   rebase surface. Defer any extraction until after those land — and only if a
   second consumer of the value types materializes.
3. Owner ladder (`feedback-ponytail-minimal-code-ladder`, "best code is the code you
   never wrote"): a new package is the heaviest possible answer to a
   direction-of-one-edge question that a **type-only import + adapter deletion**
   already answers.

**Recommendation:** fns imports the value substrate from `@jesscss/core` via a
**narrow, stable sub-path** (e.g. `@jesscss/core/value` mapped to `ast/value-*` +
`literal-tag` + `color-names`) so the fns → core contract is a small named surface,
not "reach anywhere into core." Type-only imports use `import type` so they are
provably erased (verifiable with `--verbatimModuleSyntax` / `isolatedModules`, both
already implied by the tsdown build). This is the single reviewer-critical
interface; it must be minimal and append-only.

### 3c. The `NativeFn` authoring contract stays identical

A fn in `@jesscss/fns` after the move looks **exactly** like `native/lighten.ts`
does today — a self-describing object, no `defineFunction`, no `Context`:

```ts
import { hslAdjust } from './color-helper.js';   // now fns-local
import type { NativeFn } from '@jesscss/core/value';
export const lighten: NativeFn = {
  name: 'lighten',
  params: [{ kinds: ['color'] }, { kinds: ['dimension'] }, { kinds: ['keyword','quoted'], optional: true }],
  body: hslAdjust(2, 1),
};
```

The contract is: **bodies operate on already-materialized `ValueObj`s and return a
`ValueObj`, using core's `make*` constructors** — no legacy nodes, no `.operate`,
no `.render`. This is precisely the shape the 68 modules already have, which is why
the move is a *relocation*, not a rewrite.

---

## 4. Migration sequence (rebase-friendly, byte-identity-gated)

Keyed on stable symbols (`buildNativeEvaluator`, `NATIVE_FN_LIST`,
`native-value-differential.test.ts`), sequenced against the two in-flight tracks
this must not collide with:

- **literal-tag P0** (`VALUE-LITERAL-TAG-SPEC.md`, `ast/literal-tag.ts`) — touches
  the value materialization path fns consume.
- **node-model unification** (`UNIFIED-NODE-MODEL-SPEC.md`, `ast-v2-unified-node-model`)
  — flips value discriminants from lowercase `kind: 'dimension'` to
  `type: 'Dimension'`. This rewrites **every** `params: [{ kinds: ['color'] }]` and
  every `v.kind === 'quoted'` check in all 68 bodies.

**Ordering rule: do NOT move fns across the node-model flip.** If the 68 bodies move
to `packages/fns` *before* the flip, the flip then has to chase them into another
package (double the churn, cross-package rebase). If they move *after*, they move
once, already in final shape. So:

| Step | Action | Gate |
| --- | --- | --- |
| **S0** | Land literal-tag P0 and the node-model unification **in core** while the 68 bodies still live in `core/ast/native/` (single package = cheapest rebase). | existing byte-identity suites stay green |
| **S1** | Introduce `FnRegistry` + `createFnRegistry` in core (`ast/fn-registry.ts`); make `buildNativeEvaluator(registry)` take it; keep a temporary in-core `createFnRegistry().registerAll(NATIVE_FN_LIST)` shim so nothing else changes yet. **Pure seam refactor, fns still in core.** | `native-value-differential.test.ts` byte-identical (native ≡ adapter); all `*-byte-identity.test.ts` green |
| **S2** | Add `@jesscss/core/value` export sub-path (the narrow substrate surface from §3b). No behaviour change. | typecheck; substrate is `import type` where possible |
| **S3** | **Relocate** the 68 bodies + their private helpers (`color-helper`, `math-helper`, `list-helper`, `color-ctor-helper`) from `core/ast/native/` into `packages/fns/src/less/` (replacing the legacy twins), rewriting their imports to `@jesscss/core/value`. Export `builtinLessFns` (successor to `NATIVE_FN_LIST`) from `@jesscss/fns`. | `native-value-differential.test.ts` **moves to fns or imports the moved set**, still byte-identical; per-fn tests in `fns/src/less/__tests__` green |
| **S4** | Switch the consumer: `jess-plugin-less` `_registerFunctions` builds a `createFnRegistry().registerAll(builtinLessFns)` and threads the registry into the AST-v2 render path (replacing legacy `setFunctionBinding` for the fns the AST path now owns). | plugin + `jess/test/less/**` byte-identical to goldens |
| **S5** | Delete the in-core shim (S1), the `NATIVE_FN_LIST` table, and — jointly with task #10 — the adapter `parse-host/value-eval.ts`, removing the phantom core → fns import. | full workspace build (`pnpm -r build`); all-less suite non-regressing |
| **S6** | Convert the **11** remaining Less fns (`data-uri`, `iif`, `each`, `isdefined`, `isruleset`, `logical`, `get-unit`, `image-*`, `svg-gradient`) **in `packages/fns` directly**, extending `NativeCtx` with the Tier-C IO/ruleset capabilities as each wave needs (per `native/types.ts` deferral note). | new differential cases per fn; adapter-if-still-present or Less-4.x oracle |

Each step is independently landable and byte-identity-gated; no step requires two
packages to change in the same commit except S4 (consumer switch), which is the
natural cutover point. **No `as any`** anywhere (memory: ABSOLUTE rule); the seam is
typed with `NativeFn`/`FnRegistry`, and the substrate crossing is `import type`.

---

## 5. Downstream blast radius (feeds task #12's migration map)

Importers that break or must change, grouped by edge:

**A. Core internal — the fn table & dispatch (deleted/moved):**
- `core/src/ast/value-dispatch.ts` — `NATIVE_FN_LIST` import + `TABLE` construction removed; `dispatchNative`/`hasNativeFn`/`bind` migrate to `FnRegistry`.
- `core/src/ast/native/index.ts` — deleted (its `NATIVE_FN_LIST` becomes `builtinLessFns` in fns).
- `core/src/ast/native/*.ts` (68 bodies + 4 helpers) — relocate to `packages/fns`.
- `core/src/ast/native-evaluator.ts` — `buildNativeEvaluator` gains the `registry` param; drops `dispatchNative`/`hasNativeFn` imports.
- `core/src/ast/index.ts` — stops re-exporting `dispatchNative`/`hasNativeFn`; starts exporting `FnRegistry`/`createFnRegistry` and the `/value` substrate surface.

**B. Every test that constructs an evaluator** (must pass a populated registry):
- `native-value-differential.test.ts`, `native-value-perf.test.ts`,
  `r4-byte-identity.test.ts`, `census.test.ts`, `value-byte-identity.test.ts`,
  `guard-byte-identity.test.ts`, `nested-byte-identity.test.ts`,
  `nested-census.test.ts`, `import-*-byte-identity.test.ts`,
  `atrule-*-byte-identity.test.ts`, `extend-byte-identity.test.ts`,
  `extend-prefilter-soundness.test.ts`, `selector-interp-host-byte-identity.test.ts`,
  and the `*-race.test.ts` perf tests. All currently call `buildNativeEvaluator()`
  with no args — they become `buildNativeEvaluator(registryWithBuiltins)`. A tiny
  test helper (`makeBuiltinRegistry()`) absorbs the churn.

**C. The adapter edge (deleted with task #10):**
- `core/src/ast/parse-host/value-eval.ts` — the phantom `import * as lessFunctions from '@jesscss/fns'`; `buildFnTable`, `callWithContext` glue. Deleting this removes the only core → fns runtime import.

**D. Consumer registration:**
- `jess-plugin-less/src/index.ts` `_registerFunctions` — switches from legacy `setFunctionBinding(new JsFunction(...))` to `createFnRegistry().registerAll(builtinLessFns)` for the AST-v2 path.
- `packages/jess` CLI (if it constructs evaluators directly) — verify it goes through the plugin; if it builds an evaluator itself, it must populate a registry.

**E. Package manifests:**
- `packages/core/package.json` — must **not** gain `@jesscss/fns` (confirm the phantom stays gone). Export map gains `./value`.
- `packages/fns/package.json` — keeps `@jesscss/core`; may add the `/value` subpath usage; drops nothing.

**F. `@jesscss/fns` legacy consumers still on the tree shape:**
- `jess-plugin-less` legacy path, language-service, and any test importing `Color`/`Dimension` *from fns re-exports*. The Sass set stays legacy, so `@jesscss/fns`'s root export must continue to surface the legacy fns until Sass converts — i.e. **`builtinLessFns` is an ADDITIONAL export, not a replacement**, during the transition.

---

## 6. Adversarial self-check

### 6a. Top-3 ways this introduces a dependency cycle

1. **Default registration sneaks back into core.** The single biggest trap: making
   `.less` "just work" by having core import `@jesscss/fns` to auto-register. That
   re-forges core → fns while fns → core stays, = cycle, and violates the owner
   decision. **Avoided by §2b:** the *consumer* (`jess-plugin-less`) registers;
   core's `createFnRegistry()` ships empty; core references `NativeFn` as a type
   only.
2. **The `/value` substrate imports leak a runtime value from a core module that
   itself imports fns.** If any file reachable from `@jesscss/core/value` imports
   `@jesscss/fns` (even transitively via the not-yet-deleted adapter), fns → core →
   fns is a runtime cycle. **Avoided by §4 S5 ordering:** the substrate surface is
   value-domain-only (verified: `value-factory`/`serialize-value`/`value-units`/
   `literal-tag`/`color-names`/`value-operate` import no fns), and the adapter (the
   only current core → fns edge) is deleted before or with the fns move. A grep gate
   (`@jesscss/fns` must not appear in any file reachable from the `/value` entry)
   enforces it.
3. **Type-only import silently becomes a value import.** `import { NativeFn }`
   instead of `import type { NativeFn }` would emit a runtime import and, if it ever
   resolves into a fns module, cycle. **Avoided:** `import type` for all substrate
   *types*; `isolatedModules`/`verbatimModuleSyntax` in the build make a non-erasable
   type import a compile error.

### 6b. Top-3 ways this regresses perf (extra hot-path indirection)

1. **Registry `Map` lookup replacing a module-scope `Map`.** Today `TABLE` is a
   module-level `Map` built once; a per-render `createFnRegistry()` could rebuild it
   per compile. **Avoided:** the consumer builds **one** registry per plugin
   instance (like `_registerFunctions` runs once per tree today), not per call;
   `dispatch` is the same `Map.get` + `bind`-by-kind it is now. Same O(1) lookup,
   same object shape.
2. **A cross-package call boundary defeats an inliner / adds a megamorphic call
   site.** Moving bodies to another package could, in principle, change how the JIT
   sees `body(...)`. **Avoided:** the bodies are the *same functions* invoked the
   *same way* (`spec.body(...args)`); ESM cross-package is still a monomorphic call
   to a concrete function reference held in the registry map — no dynamic dispatch
   added. Guard with `native-value-perf.test.ts` / the `*-race.test.ts` (measured,
   not reasoned — memory `feedback-no-defensive-slowdowns`,
   `feedback-perf-claims-need-controlled-measurement`: same-worktree toggle, warmup,
   N-median, byte-identical).
3. **Registry populated lazily / re-checked per call.** A `has(name)` that walks or
   a registry populated on first call would tax the hot path. **Avoided:** eager
   `registerAll` at bootstrap; `has` is `Map.has`. Verbatim-unknown path unchanged.

### 6c. Top-3 ways this breaks byte-identity

1. **A body's private helper is subtly different after the move** (e.g. rounding
   epsilon in `math-helper`, hsl-carry in `color-helper`). **Avoided:** helpers
   **move verbatim** with the bodies (relocation, not reimplementation); the
   `native-value-differential.test.ts` corpus (adapter = oracle) gates every step,
   and per-fn `fns/src/less/__tests__` gate the fn semantics.
2. **The node-model flip (`kind`→`type`) is applied to the moved copy but not the
   oracle, or vice versa.** Divergent discriminants → silent kind-mismatch → wrong
   branch → wrong bytes. **Avoided by §4 ordering:** the flip lands in **core, before
   the move (S0)**, so there is exactly one copy to flip; the move (S3) carries the
   already-flipped bodies.
3. **The consumer registers a *different* set than the differential test asserts**
   (plugin registers legacy `setFunctionBinding` fns for names the AST path also
   claims, so a name resolves to the wrong impl). **Avoided:** S4 switches the
   plugin's AST-v2 path to the registry as a unit; `jess/test/less/**` goldens are
   the backstop, and the transition keeps `builtinLessFns` additive so no name is
   served by two impls at once. If a name is genuinely ambiguous (a converted fn vs
   a still-legacy Tier-C fn), the registry wins for converted names and falls
   through to verbatim/legacy only for the 11 unconverted ones.

---

## 7. Reviewer decision points (surface before code moves)

1. **§2b:** consumer-owned default registration in `jess-plugin-less` — confirm no
   third preset package. (Recommendation: no new package.)
2. **§3b:** keep the value substrate in core behind a narrow `@jesscss/core/value`
   subpath vs extract a `@jesscss/value` package. (Recommendation: keep in core;
   defer extraction until after literal-tag P0 + node-model unification, and only if
   a second consumer appears.)
3. **§4:** the "flip before move" ordering (S0 before S3) — confirm the node-model
   unification lands in core first, so the 68 bodies move exactly once.
4. **§5F:** `builtinLessFns` is additive to the existing legacy `@jesscss/fns` root
   export until Sass converts — confirm the dual-export transition window.
