# Reprofile: REAL Bootstrap 4 on Jess — honest 10× baseline

Date: 2026-07-06
Branch: `work/bootstrap-baseline` (off dev tip `623e1b0b5`)
Node: v24.11.1 · macOS (darwin 25.5.0)

This supersedes prior synthetic-sheet profiles. **Bootstrap DOES compile on
jess.** The earlier "doesn't compile" claim was a build gap: building with
`--filter @jesscss/core styles-config @jesscss/fns jess` omits the plugin set
(`plugin-less`, `plugin-less-compat`, `plugin-js`), so bootstrap's
`@plugin`/backtick JS + Less-compat couldn't run. Building all plugins fixes it.

## 1. What compiled

- **Source**: `bootstrap-less-port@0.3.0` (Bootstrap v4.1.1) at
  `/Users/matthew/git/oss/less.js/node_modules/.pnpm/bootstrap-less-port@0.3.0/node_modules/bootstrap-less-port/less`.
- **Plugin set** (mirrors `bootstrap-min-guard-wall.test.ts`):
  `lessPlugin()`, `jsPlugin({ jsReadRoot: <bsRoot>/plugins, runtimeApi: 'less' })`,
  `lessCompatPlugin()` — driven through `new Compiler({ compile: { plugins: […] } })`
  and `compiler.render(file, { suppressWarnings: true, breakOnError: false })`.
- **Build**: `pnpm -r --no-bail build` (exits 1 only on `jess-plugin` TS5096 —
  irrelevant; `core`, `config`, `fns`, `jess`, `plugin-less`, `plugin-less-compat`,
  `plugin-js` all built cleanly). Clean build, warm renders ~300ms — NOT the ~20× regime.

### Full-entry wall (documented, not a build problem)

The stock `bootstrap.less` entry still hits the milestone-4 wall
`TypeError: Expected mixin guard copy`, thrown inside `_grid` (the 8th `@import`).
Per-component sweep (preamble `_functions`/`_variables`/`_mixins` + one component):

- **29/32 components compile** and emit CSS.
- **3 do not**: `_grid` and `_utilities` hit `Expected mixin guard copy`;
  `_print` emits empty (all rules live inside `@media print`, expected).

This is BETTER than the "~28/35" project note. To get a real, large, complete
compile I profiled the **composite of all 29 passing components** in one render:

```
preamble + @import each of:
_root _reboot _type _images _code _tables _forms _buttons _transitions
_dropdown _button-group _input-group _custom-forms _nav _navbar _card
_breadcrumb _pagination _badge _jumbotron _alert _progress _media
_list-group _close _modal _tooltip _popover _carousel
```

**Output: 94,274 bytes of CSS — a real ~92KB bootstrap sheet, ~90% of the suite.**
Excluded: `_grid`, `_utilities` (mixin-guard-copy wall), `_print` (empty by nature).

## 2. Clean-build phase split — the honest 10× BASELINE

From `JESS_PROFILE=1`, 8 renders, warm medians. In the render path (D3) **eval is
folded into the `render` phase** (render is the sole eval driver); `getTree` is
parse.

| Phase                     | Median (ms) | Share |
|---------------------------|-------------|-------|
| parse (`getTree`)         | 0.44        | 0.1%  |
| prewarmPlugins (one-time) | 27.3        | 8%    |
| **render (= eval + serialize)** | **312.0** | **91.5%** |
| postProcessCss            | 0.01        | ~0%   |
| **TOTAL**                 | **~341**    | 100%  |

Warm render loop (12 iters, isolated from module load): **median 311ms, min 299ms.**

- **Honest 10× baseline: ~300–340ms for a ~92KB bootstrap sheet.** Less 4.x is
  ~49ms, so this is the real ~6–7× on this subset (the ~10× figure is the whole-
  suite target; here we're at ~90% of it and eval-bound).
- **Parse is a non-issue** (0.44ms — imports parse-cache across the sheet).
- The entire cost is **eval + serialize**, and within that eval dominates.

## 3. Top ~20 self-time functions (warm loop, 14,760 samples @ 200µs)

| Self% | Function | Location (core `lib/index.js` unless noted) |
|-------|----------|---------------------------------------------|
| 11.9% | `(idle)` | — event loop / async gaps |
| 5.7%  | `lookupScopeFrameVariable` | scope-frame.ts (variable resolution) |
| 4.4%  | `visit` | node-base tree walker |
| 2.9%  | `(garbage collector)` | — |
| 2.6%  | `spawn` | node — plugin-js child process |
| 2.3%  | `internalModuleStat` | node — module resolution |
| 2.2%  | `(program)` | — |
| 1.7%  | `applyExtendsToSelector` | extend |
| 1.5%  | `isNode` | node type guard |
| 1.2%  | `(anonymous)` | node cjs/loader |
| 1.1%  | `extendSelector` | extend |
| 1.0%  | `_r_value` | **less-parser** — lazy value re-parse during eval |
| 1.0%  | `inherit` | node clone/inherit |
| 0.8%  | `rulesMayContainReferenceImports` | rules.ts (reference-import scan) |
| 0.7%  | `collectSelectorSubtreeValues` | extend |
| 0.7%  | `evalStatic` | eval |
| 0.7%  | `renderHeaderSelectorString` | serialize |
| 0.6%  | `clone` | node clone |
| 0.6%  | `wouldMatchNode` | extend matcher |
| 0.6%  | `runMicrotasks` | node async |

### Self-time bucketed by phase (active-only, idle excluded)

| Bucket | Share |
|--------|-------|
| coreEval (eval machinery) | 50.2% |
| parse productions (`_r_*`, called lazily **during eval**) | 12.4% |
| node_infra (spawn/module-stat/loader — plugin-js child proc) | 10.2% |
| other (core, uncategorized) | 9.2% |
| scope (lookupScopeFrameVariable + friends) | 7.5% |
| extend | 6.3% |
| gc | 3.2% |
| serialize | 0.9% |
| fns | 0.1% |

Note: the 12.4% "parse productions" is NOT parse-phase time — `_r_value` /
`_r_topProduct` are invoked recursively **during eval** (deferred value parsing).
Serialize is nearly free (0.9%); this sheet is overwhelmingly eval-bound.

## 4. Top-3 real-world targets on ACTUAL bootstrap + lens

Bootstrap's hotspot shape differs from the synthetic sheets: it is **eval-bound
with scope-lookup #1**, not extend-led. GC is present but modest (~3%), not the
GC-led profile the synthetic sheets suggested.

1. **`lookupScopeFrameVariable` (5.7% self, ~7.5% w/ helpers) — #1.**
   Parent-chain scope walk with fallback-frame queuing, run on every `@var` read.
   Lens: **necessary, not deletable** — this is core Less variable resolution.
   Not specializable away either (bootstrap leans hard on nested mixin/variable
   scope). The win is **memoization / a faster frame index**: a per-frame
   `Map<name,cell>` is already used, but the *parent walk* + fallback queue
   re-scans ancestors on every miss. Slice: cache negative lookups per (frame,
   name) within an eval pass, or hoist a flattened resolved-scope view for hot
   mixin bodies. → **optimize**, don't delete.

2. **`visit` (4.4% self) — generic node-base tree walker.**
   Called pervasively (eval traversal, extend collection, reference scans). Lens:
   necessary structural traversal; **specializable** — many callers walk to test a
   single predicate (`rulesMayContainReferenceImports`, `collectSelectorSubtreeValues`).
   Slice: precompute/cache a per-`Rules` "contains reference-import surface" bit at
   parse/adopt time so `rulesMayContainReferenceImports` (0.8%) stops re-walking,
   and give extend its own tight iterator instead of the generic visitor. → optimize/specialize.

3. **plugin-js child-process overhead: `spawn` + `internalModuleStat` + cjs loader
   (~6% combined, node_infra 10.2%).** jsPlugin shells out (spawnSync) to evaluate
   backtick/`@plugin` JS, and it recurs **per render** even warm. Lens: this is
   real bootstrap cost but **specializable/removable from the hot path** — bootstrap's
   JS (breakpoint helpers etc.) is pure and could run in-process (a worker or a
   vm context reused across renders) instead of spawning a child each time. → the
   highest-leverage *non-core* slice; ~6% for zero eval-correctness risk.

**Recommended next slice**: attack #1 first — memoize scope-frame variable
lookups (cache negatives + flatten hot mixin-body scopes) within an eval pass.
It's the single largest core hotspot (~7.5% with helpers), purely additive, and
bootstrap is the ideal stress case (deep nested mixin/variable scope). Pair it
with the plugin-js in-process JS eval (#3, ~6%) as an independent, low-risk win.

## 5. Confirmation — the 3 recent fixes HOLD on real bootstrap

All target functions are LOW self-time on the real bootstrap composite:

| Fix area | Function | Self% |
|----------|----------|-------|
| comment-scan | `commentRunsWithinSpan` | 0.00% |
| comment-scan | `entries` | 0.00% |
| extend-visibility | `isSameOrDescendantRoot` | 0.43% |
| extend-matcher | `findChainedExtendsWithSkips` | 0.00% |
| extend-matcher | `wouldExtendChange` | 0.39% |
| extend-matcher | `wouldMatchNode` | 0.62% |

The O(I²)→linear chained-extend matcher fix (`623e1b0b5`) holds: extend as a whole
is only ~6.3% of active time on real bootstrap, and none of the fixed functions
regress into the hot path. Comment-scan is effectively zero.

## Reproduction

Build: `pnpm install && pnpm -r --no-bail build` (ignore `jess-plugin` TS5096).
Harness mirrors `packages/jess/test/less/bootstrap-min-guard-wall.test.ts` plugin
wiring; composite = preamble + the 29 passing components; `JESS_PROFILE=1` for the
phase split and `Profiler` (inspector) sampling @200µs over a warmed 12-render loop
for self-time.
