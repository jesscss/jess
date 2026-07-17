# benchmark.less → `ast/` whole-document render: EMPIRICAL failure inventory

> Measured on `perf/ast-driver` (base `origin/dev` @ `75e324105`). All numbers and
> divergences below come from actually RENDERING `packages/jess/benchmark/benchmark.less`
> through the `ast/` engine (`parseToAst` → `serialize`) and diffing against the
> legacy production render — not from reading the roadmap. Where the empirical
> result contradicts the prior read-only scout (`BENCHMARK-PERF-PATH.md`), it is
> flagged **[CORRECTION]**.

## TL;DR — the picture changed

1. **It renders. It does NOT throw.** The whole-document `ast/` driver renders
   benchmark.less end-to-end with **zero throws** and **zero parse errors**,
   producing 102,849 bytes of CSS. **[CORRECTION]** the scout predicted it "cannot
   render end-to-end … raises `UnsupportedShape`". The direct dispatch host does
   not raise on the unbuilt features — it silently **drops or passes them through
   literally** (unregistered node types resolve to `placeholder(type)` and emit
   nothing). So the gap is a **silent-wrong-output** problem, not a throw.

2. **The dominant gap is NOT the 4 predicted structural features.** The single
   largest divergence is **multi-part / operated declaration-value assembly** — a
   value embedded in a space- or comma-separated list keeps its `@var` and some
   sub-expressions **literal**. This alone accounts for ~250 changed lines.

3. **Every gap is "action-only."** For all of mixin-call, detached-ruleset, and
   namespace-accessor, the **engine (`serialize.ts` + `mixin-dispatch.ts` +
   `nodes.ts`) already supports the node**, and the **parser already emits the
   structure**. What is missing is the `parse-host/actions/*` entry that BUILDS the
   node. Consequence: these can be implemented **in parallel with LOW `serialize.ts`
   collision risk** (they add `actions/*.ts` files; the serializer is untouched).

4. **Two predicted "gaps" are already handled.** **[CORRECTION]** merge `+`/`+_`
   and parenthesized/color math both work in the direct path today.

---

## 1. Render-or-throw result

| Metric | AST-v2 direct (`parseToAst`→`serialize`) | Legacy production oracle |
|---|---|---|
| Throws? | **No** | No |
| Parse errors | **0** | 0 |
| Output bytes | **102,849** | **131,578** |
| Output lines | 5,008 | 7,146 |

The 28.7 KB / 2,138-line shortfall is entirely **un-expanded / un-resolved**
constructs (below). The AST engine emits *less* because it drops mixin/detached/
namespace expansions and leaves some values literal — it never emits *wrong-extra*.

**Driver:** `packages/core/src/ast/parse-host/whole-doc-driver.ts`
(`renderAstFile` / `renderAstDoc`). Boundary-clean: parser + `../index.js`
serialize + dispatch host, zero legacy `../../tree`. Value evaluator injected
(caller supplies the fns registry via the existing `serialize` seam), so the
driver imports zero fns and is reusable as the T8 harness.

**Runner:** `packages/core/src/ast/parse-host/__tests__/bmark-ast-driver.test.ts`
(diagnostic; renders, writes `packages/core/.bmark-ast/ast.css`, times the AST
path). Named `bmark-*` because vitest's `**/*bench*` exclude would otherwise skip
a `benchmark-*` file.

### On the oracle (a real obstacle, documented for the next agent)

Producing a trustworthy legacy oracle for THIS file was non-trivial — three paths
fail, and the working one needs a full build:

- **`renderRealOracle` (source, bare Context, `collapseNesting:true`)** — THROWS
  `TypeError: EMIT contribution collapsed to empty (extender IS a target ancestor)`
  in `tree/extend/emit.ts:176`. Import-stripping benchmark.less makes its root
  **spine-eligible** (`isSpineEligibleRoot` — the code even comments "benchmark.less
  … folds"), so it takes the interim **spine-extend** path, which has a real bug on
  this file's extend section. This is the known "eval-baseline buggy for extend"
  problem — the legacy spine is NOT a usable oracle for benchmark's extends.
- **`renderImportOracle` / any `Compiler` render under vitest** — THROWS
  `TypeError: Cannot read properties of undefined (reading 'tag')` in
  `less-parser/lib/grammar2.js` `unwrapTrivia`. The BUILT less-parser lib's parseman
  node shape collides with the SOURCE parseman under vitest's SSR transform. **This
  also fells the pre-existing `import-byte-identity.test.ts` in a fresh worktree** —
  it is an environment/stale-built-lib issue, not caused by this work.
- **Working oracle** — the **production `Compiler` in a plain node process against
  the BUILT packages**: `oracle-run.mjs` at the repo root. Imports stay present →
  the root is **not** spine-eligible → the legacy **full-eval** path runs (what
  production uses for benchmark.less), dodging the spine bug. Requires a full
  non-docs build (`pnpm --filter '!jess-docs' -r build`). Writes
  `packages/core/.bmark-ast/oracle.css`. Diff the two `.bmark-ast/*.css` offline.

---

## 2. Divergence inventory (construct → feature → evidence)

Diff of `ast.css` vs `oracle.css`: **325 AST-side lines differ** (literal/wrong),
**2,463 oracle-side lines** have no AST counterpart (dropped expansions).

Each construct below was **isolated with a minimal probe** through the direct
driver AND confirmed against the parser's emitted node type.

### G1 — Multi-part / operated declaration-value assembly  ⟵ LARGEST, was under-predicted
- **Symptom:** an `@var` (or some sub-expression) embedded in a space/comma value
  is left literal.
  - `background: @bg url('…') …`  →  oracle `background: #f01 url('…') …`
  - `border-bottom: 1px solid (@bg * 0.66 + @black * 0.33)`  →  oracle `… solid(#a8000b)`
  - `border-top: 5px solid @black`  →  oracle `… solid #000`
  - `color: @white * 0.75 + @accent_colour * 0.25`  →  oracle `#bfbfbf`
- **Probe (isolated):** `@a: red; .x { border: 1px solid @a; }` → AST `border: 1px solid @a;`
  (literal), oracle `border: 1px solid red;`. But `color: @a` (whole value) → `red`
  ✓ and `c: (@a * 0.66)` → `#a8000b` ✓. So the gap is specifically **multi-part
  assembly**, not single-value refs or paren math.
- **Parser structure present?** YES — parser emits a `Reference` node for the
  embedded `@a` (alongside `Numeric`, `NamedColor`).
- **Partial impl?** YES — `actions/value-expr.ts` builds `Operation`/`SpacedValue`,
  and `serialize.ts` resolves `SpacedValue` members. The variables-host test even
  documents this as deliberately deferred: *"a MULTI-part value that mixes a `@var`
  with literals needs the value-assembly family and is intentionally not gated"*.
  The declaration-value path appears to fall back to raw source bytes for these
  mixed values instead of assembling resolvable nodes.
- **Size:** **M–L.** **Design:** SOME — needs the raw-bytes-vs-assembled decision
  nailed to byte-identity (spacing, `solid(...)` gluing).
- **`serialize.ts` collision:** LOW (members already resolve); work is in
  `actions/value-expr.ts` + value-leaf. **HIGH collision on `value-expr.ts`.**
- **Line impact:** ~147 AST lines still carry a literal `@var`; ~106 carry
  unevaluated math.

### G2 — Mixin calls `.mixin()`  (plain AND namespace `#ns > .mixin()`)
- **Symptom:** every mixin call emits nothing. `#container { color: black; .mixin();
  .mixout(); #theme > .mixin(); }` → AST `#container { color: black; }` only; oracle
  expands to ~10 declarations. ~12 `#theme > .mixin()` / `#ns > .borders()` /
  `#util > .clearfix()` accessor calls plus many plain `.mixin()` calls.
- **Probe:** `.m() { p: 1; } .x { .m(); }` → AST `.x {}` (empty); oracle `.x { p: 1; }`.
- **Parser structure present?** YES — parser emits a **`MixinCall`** node (namespace
  form: `MixinCall` + `ComplexSelector` for the `#ns > .m` path).
- **Partial impl?** ENGINE YES / ACTION NO. `serialize.ts:844` already has a
  `case 'MixinCall'`, and `mixin-dispatch.ts` implements full arity/pattern/named/
  guard selection. The mixin **definition** action exists
  (`actions/mixins-def.ts`, `MixinOrQualifiedRule`). What is missing is the
  **`MixinCall` action** (`actions/mixins-def.ts:173` explicitly punts: "statement
  (call) form is the MixinCall family's; leave it to fall through").
- **Size:** **M** (arg binding + scope resolution; namespace-path resolution adds a
  little). **Design:** minimal for plain calls; namespace-path lookup needs a small
  scope-walk decision (verify `mixin-dispatch` resolves a qualified name).
- **`serialize.ts` collision:** LOW — engine consumes `MixinCall` already; the new
  code is an `actions/*` build fn. Namespace-path MAY touch `mixin-dispatch.ts`.

### G3 — Detached rulesets (define `@x: { … }` + call `@x()`)
- **Symptom:** `.mobile-component { @media-mobile(); border: 1px solid #ccc; }` →
  AST keeps only `border`; oracle also emits the 3 detached-ruleset props. 4 defs
  (`@media-mobile`/`@media-desktop`/`@theme-light`/`@theme-dark`), 5 calls.
- **Probe:** `@d: { p: 2; } .x { @d(); }` → AST `.x {}`; oracle `.x { p: 2; }`.
- **Parser structure present?** YES — the def parses as a **`VarDeclaration`** whose
  value is a block; the call parses as a **`VarCall`**.
- **Partial impl?** ENGINE YES / ACTION NO. `nodes.ts` has `DetachedRuleset`
  (`:160`) + `DetachedCall` (`:437`) with factories; `serialize.ts:854` has
  `case 'DetachedCall'` + `expandDetachedCall`. Missing: (a) the `VarDeclaration`
  action recognizing a block body and building a `DetachedRuleset` value; (b) a
  **`VarCall` action** building a `DetachedCall`.
- **Size:** **S–M.** **Design:** minimal (nodes + serialize already define the
  semantics, incl. the def-frame closure).
- **`serialize.ts` collision:** LOW — engine ready; work is `actions/variables.ts`
  (block-body value) + a new `VarCall` build fn.

### G4 — Namespace / accessor dispatch `#ns > .mixin()`
- Folded into **G2**: the parser routes it through `MixinCall` (+ `ComplexSelector`
  path), so it lands the moment the `MixinCall` action resolves a qualified target.
  **[CORRECTION]** the scout listed this as an independent NEEDS-DESIGN family;
  empirically it is the SAME missing action as plain mixin calls, plus a scope-path
  lookup. Map/accessor VALUE forms (`@map[@key]`) have engine support too
  (`serialize.ts:494` `MapAccessor`) and are not used by benchmark.less.

### G5 — `@import` handling on the direct path
- benchmark.less's two top-level `@import`s target **0-byte** files (a plain one +
  a `(reference)` one), so they contribute no output either way. But the direct host
  has **no import action**: it emits the two `@import` lines **verbatim** (~102
  bytes), whereas the oracle resolves+drops them. For a non-empty or `(reference)`
  import with real content, the direct path would **not** resolve/inline it at all —
  import RESOLUTION today lives only on the bridge (`import.ts` `resolveImportStatements`
  is called solely from `__tests__/bridge.ts`), not on the dispatch host.
- **`fromFilePath`/`fromDir` threading:** the driver already accepts + carries
  `filePath`; the trivial `process.cwd()` fallback (`import.ts:346`) is a non-issue
  once an import action is wired to the direct host and threaded the path. That
  wiring (porting `resolveImportStatements` onto a dispatch-host action) is the real
  T4 work; it is **S–M** and **independent of `serialize.ts`**.

### Not a gap (verified working — [CORRECTION] vs scout)
- **Merge `+` / `+_`** — `box-shadow+:` / `transform+_:` / `transition+:` all fold.
  Probe `.x { box-shadow+: a; box-shadow+: b; }` → `box-shadow: a, b;` ✓. Predicted
  NEEDS-DESIGN; already handled.
- **Parenthesized & color math** — `(@a * 0.66)` → `#a8000b` ✓ (the failing cases in
  G1 fail because of multi-part *assembly*, not the math itself).
- **Whole-value single variable** — `color: @a` → resolved ✓.

---

## 3. Implementation-readiness matrix

| Gap | Parser struct? | Engine ready? | Action exists? | Size | Design? | `serialize.ts` collision |
|---|---|---|---|---|---|---|
| G1 multi-part value assembly | YES (`Reference`) | partial (members resolve) | partial (`value-expr`) | M–L | some | LOW (but HIGH on `value-expr.ts`) |
| G2 mixin calls (+ namespace) | YES (`MixinCall`) | YES (`serialize:844`, `mixin-dispatch`) | **NO** | M | low | LOW (maybe `mixin-dispatch.ts`) |
| G3 detached rulesets | YES (`VarDeclaration`+`VarCall`) | YES (`serialize:854`, nodes) | **NO** | S–M | low | LOW |
| G4 namespace accessor | YES (via `MixinCall`) | YES | **NO** (= G2) | (G2) | low | LOW |
| G5 `@import` on direct host | YES | resolution on bridge only | **NO** | S–M | low | LOW |

**Parallelization:** G2, G3, G5 add new `actions/*` build fns and DO NOT touch
`serialize.ts` — they can run concurrently. G1 concentrates in `value-expr.ts`
(serialize untouched) so it also parallelizes against the others, but it is the
single most involved piece and the one most likely to need a design pass on
byte-identity.

---

## 4. Preliminary perf ballpark — DIRECTIONAL ONLY, NOT the number

**These are NOT byte-identical renders and NOT the perf number.** AST-v2 emits
~28 KB LESS than the oracle (all the un-expanded work above), so its time is an
**under-count**; and the two paths are measured in different environments. This is
a smoke signal that the engine is in the right order of magnitude, nothing more.

| Path | What it includes | Env | Median | Min |
|---|---|---|---|---|
| AST-v2 `parseToAst`+`serialize` | parse + build + serialize (misses ~28 KB of expansion) | vitest, SOURCE | **43.9 ms** | 42.1 ms |
| Legacy `Compiler.render` | full production eval + disk read + compiler setup | node, BUILT | **198.2 ms** | 185.6 ms |

Do not read a "4.5×" into this: the AST number will grow as G1–G4 add the missing
expansion work, and the legacy number carries disk+setup the AST loop does not.
The real comparison is the T8 gate: byte-identical AST render vs Less 4.x on the
same fixture, same worktree, warmup + N-median. That is blocked on closing
G1–G4 (+ G5 for correctness of non-empty imports), exactly as the roadmap's
critical path states — but the gap set is **G1–G4 (action-level, mostly
low-design), not "detached + namespace + import-reference + merge"**, and merge is
already done.

---

## 5. Artifacts on this branch

- `packages/core/src/ast/parse-host/__tests__/whole-doc-driver.ts` — the reusable driver (T1 / seed of T8; test-space harness, not a production render path).
- `packages/core/src/ast/parse-host/__tests__/bmark-ast-driver.test.ts` — diagnostic runner.
- `oracle-run.mjs` (repo root) — node-process legacy oracle producer + timing.
- `packages/core/.bmark-ast/{ast.css,oracle.css}` — generated renders for offline diff (git-ignored).
