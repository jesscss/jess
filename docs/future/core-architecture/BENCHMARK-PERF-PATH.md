# Shortest path to a realistic byte-identical `benchmark.less` → CSS perf number through AST‑v2 (`ast/`)

> READ-ONLY survey, base `origin/dev` (@ `53e9db8dd`, advancing under an in-flight
> fns Stage F). All file:line citations are on `origin/dev`. No source edited.
> **Bottom line up front:** the shortest path is **NOT "just add a harness."**
> `benchmark.less` cannot render end-to-end through `ast/` today — it depends on
> feature families the `ast/` engine has explicitly **not built** (detached
> rulesets, namespace/accessor dispatch, and `@import (reference)`), and there is
> no whole-document production driver wiring `ast/` into a render at all. The
> "2 empty imports" are a red herring.

---

## 1. What renders `benchmark.less` → CSS today?

**The legacy `tree/` engine — `ast/` is not in any production path.**

Call chain (production `.less` render):
- `Compiler.render(filePath)` → `prepareInputTree` (parse to a legacy `Rules` tree
  via `@jesscss/less-parser` + `jess-plugin-less`) → `renderTree` →
  `tree.render(context, buffer, printOptions)` — `packages/jess/src/index.ts:1418`
  (`renderTree` at `:1320`, `render` at `:1417`).
- `tree.render` is the legacy `tree/` node render. Extend/import-free "spine-eligible"
  roots take the interim single-pass **spine** (`tree/util/emit-walk.ts`
  `renderRootViaSpine`, gated by `isSpineEligibleRoot`); everything else takes the
  full legacy eval. Both live under `tree/`, **not** `ast/`.

`ast/` is **entirely test-only**:
- Core's public API (`packages/core/src/index.ts:11`) re-exports `./tree/index.js`,
  never `./ast/`. `packages/core/package.json` has **no `./ast` export subpath**
  (only `.` and `./value`).
- Zero non-test importers of `ast/` exist anywhere in `packages/` (grep for
  `core/ast` / `../ast` outside `ast/` itself returns nothing).
- `jess-plugin-less/src/index.ts` never references `ast/`, `buildEvaluator`, or
  `serialize` — it feeds the legacy tree.

So the fns-plan characterization ("AST-v2 render is test-only; the plugin renders
legacy") is **correct and current**.

Note for the interim spine specifically: `benchmark.less` has two **top-level
`@import`** statements (`benchmark.less:3986-3987`), and `isSpineEligibleRoot`
rejects top-level `@import` (and `:extend`) roots — see the authoritative comment
in `renderTree`, `packages/jess/src/index.ts:1333-1340`. So even the legacy
fast-path spine does **not** engage for `benchmark.less`; it renders through full
legacy eval.

## 2. Why does `benchmark.less` throw `UnsupportedShape import:unresolved`?

Two independent facts, and the second dominates:

**(a) The `import:unresolved` throw itself is a harness path-resolution artifact,
not an engine gap.** `resolveLessPath` (`ast/parse-host/import.ts:297`) does
`path.resolve(fromDir, spec)` + `fs.statSync(...).isFile()`. The two targets are
**0-byte but real files**, and `statSync().isFile()` is `true` for an empty file —
so an empty import is *not* the problem. `fromDir` is `path.dirname(fromFilePath)`
or `process.cwd()` when `fromFilePath` is undefined (`import.ts:346`). When the
bridge/census harness bridges a source string without threading the file's
absolute path, `fromDir` falls back to `process.cwd()`, the relative specifier
`"benchmark-import-target.less"` doesn't resolve there, and `resolveLessPath`
returns `null` → `unsupported('import:unresolved', spec)` (`import.ts:358/368`).
Thread the real `fromFilePath` and this specific throw disappears; a
"benchmark.less minus the 2 empty imports" fixture is output-equivalent (the
targets contribute no statements and no output — empty body, and the second is
`(reference)`), which is why a prior agent used that trim.

**(b) It does not matter, because `benchmark.less` needs feature families `ast/`
has not built.** Verified usages in `benchmark.less`:
- **Detached rulesets** — defined `@media-mobile: { … }` (`:4195`, `:4201`, `:4207`)
  and **called** `@media-mobile();` (`:4220`, `:4225`, `:4230`). Roadmap:
  Detached rulesets = **NEEDS-DESIGN, no code** (`TREE2-DEFINITIVE-REWRITE-COVERAGE-AND-ROADMAP.md:105`).
- **Namespace / accessor dispatch** — `#theme > .mixin();` (`:2530`, `:2537`; 10
  such calls). Roadmap: Namespaces/accessors = **NEEDS-DESIGN, dispatch is
  flat-name only** (`…ROADMAP.md:107`).
- **`@import (reference)`** (`benchmark.less:3987`) — roadmap: reference mode =
  **NOTYET, raises `UnsupportedShape`** (`…ROADMAP.md:103`).
- **Merge `+`/`+_`** — ~10 occurrences; roadmap NEEDS-DESIGN (`…ROADMAP.md:106`).

(Escaping `~"…"` and Less map access `@map[@key]` were **false-positive** grep
hits — the `"~"` strings and `[type="text"]`/`[class*=…]` CSS attribute selectors
— so those two are **not** blockers for this file.)

**Conclusion:** rendering `benchmark.less` end-to-end through `ast/` requires (at
minimum) detached rulesets + namespace/accessor dispatch + `@import (reference)` +
merge, *plus* a whole-document driver (below). It is **not** an empty-import or
harness fix.

## 3. Is the BRIDGE (double-build) in the render hot path, or only the oracle?

**Only the test oracle.** There are two ways into `ast/`, and the double-build one
is already quarantined:

- `ast/parse-host/__tests__/bridge.ts` — `parse → legacy Rules tree → rebuild as
  ast nodes`. This is the double-build "disease" named by the constitution, and it
  already lives **under `__tests__/`** (P1 "delete the bridge / survive only as a
  quarantined test-time oracle" is effectively done as isolation). It is used only
  by the census + byte-identity suites.
- `ast/parse-host/dispatch-host.ts:103` `parseToAst(input, entry, host)` — the
  **P0/P1-clean** path: parser output → `ast/` nodes **directly** via the
  `parse-host/actions/*` build host, no legacy `Rules` intermediate. This is the
  shipping-shape front end, but its only callers today are the per-family
  `*-host-byte-identity.test.ts` suites.

Neither is wired into `Compiler`/`jess-plugin-less`, so **the production
`.less`→CSS path builds the tree exactly once, on the legacy `tree/` side, and
`ast/` is not built at all.** Therefore bridge deletion is **orthogonal** to
getting a realistic number — a realistic `ast/` number must be taken through
`parseToAst` (the direct build host), not the bridge. The bridge is a
correctness-oracle concern, not a perf-path prerequisite.

## 4. The trusted byte-identity ORACLE

The `ast/` engine is gated byte-identical against the **legacy `tree/` render with
the real Less fns registry**, via `ast/parse-host/__tests__/oracle.ts`
`renderRealOracle` — it constructs a `Context`, registers `@jesscss/fns` onto the
root exactly as the less plugin does (`root.setFunctionBinding(name, new
JsFunction(...))`), then `renderNodeToString(root, ctx, {collapseNesting:true})`.

Oracle policy (owner, `…ROADMAP.md:` "Oracle policy" section): the *ultimate*
oracle is **intended Jess v5 output** — the owner-maintained top-level `.css`
goldens and less.js `alpha`-branch output (NOT Less 4.x; 4.x/Sass are behavior
references only). The legacy `tree/` render is a **valid proxy** for intended-v5
**only where it agrees** with those goldens. For a *perf* number the pragmatic gate
is: `serialize(parseToAst(benchmark.less))` **byte-identical to
`renderRealOracle(parseLessFn(benchmark.less).tree)`**, and separately confirm that
legacy render byte-matches the owner `.css`/alpha golden for this file. There is no
committed `benchmark.css` v5 golden for the full file today (the
`packages/jess/benchmark/benchmark.css` present is 123 bytes — a stale/partial
stub, not the full output).

## 5. Existing perf harness

- **Legacy-vs-4.x, real `benchmark.less`, exists:** `scripts/profile-less-benchmark.mjs`
  drives `new Compiler({plugins:[lessPlugin(), lessCompatPlugin()]}).render(benchmarkFile)`
  (`:232/:238`) — i.e. the **legacy** path. Sibling scripts:
  `measure-less-hotpath.mjs`, `compare-less-parse-render-env.mjs`,
  `prove-less-benchmark-no-deno.mjs` (real Less 4.x via the `less@^4.6.3`
  devDependency for the 4.x baseline). These produce the ~235ms-vs-~33.5ms legacy
  number. **None of them route through `ast/`.**
- **`ast/`-vs-legacy timing harness:** only
  `ast/parse-host/__tests__/harness/__tests__/race.test.ts` — and it is
  **SYNTHETIC** (generated flat/comp/mixin shapes via `harness/generate.ts`),
  gated behind `TREE2_RACE=1`, with a warmup+N-median+heap methodology already in
  place. Its own header says *"STILL SYNTHETIC — real `benchmark.less` is a later
  gate."* So the methodology exists; the **real-fixture, byte-gated `ast/` lane
  does not.**

**Missing to produce the owner's number:** (a) an `ast/` engine that covers
`benchmark.less`'s features (§2); (b) a whole-document `parseToAst` driver +
`serialize`/`evaluator` wire-up that emits full CSS for the file; (c) a harness
that times *that* against Less 4.x on the same fixture, same worktree, warmup +
N-median, with a byte-identity gate to `renderRealOracle` (and to the v5 golden).

## 6. Concrete ordered task list (origin/dev → realistic byte-identical number)

Legend: **HARD** = strict prerequisite for the number · **PAR** = parallelizable ·
Gate = what proves it.

| # | Task | Unblocks | Type | Size | Gate |
|---|------|----------|------|------|------|
| T1 | **Whole-document `parseToAst` driver** for a full `.less` stylesheet (today only per-family fragments + the bridge exercise the engine end-to-end). Confirm `serialize` + `buildEvaluator(makeBuiltinRegistry())` emit full-file CSS. | Any real-file `ast/` render at all | **HARD** | S–M | `serialize(parseToAst(f))` byte == `renderRealOracle` on the covered corpus |
| T2 | **Detached rulesets** in `ast/` (define + call). | benchmark.less (`@media-mobile()` etc.) | **HARD** | M | byte-identity vs oracle on detached-ruleset fixtures |
| T3 | **Namespace / accessor dispatch** (`#theme > .mixin()`), beyond flat-name. | benchmark.less (10 calls) | **HARD** | M | byte-identity on namespace fixtures |
| T4 | **`@import (reference)`** (+ thread real `fromFilePath`; the plain `import:unresolved` throw dies with the path fix). | benchmark.less import line; kills the observed throw | **HARD** | S–M | byte-identity on import-reference fixtures |
| T5 | **Merge `+`/`+_`** (v5 last-occurrence anchor). | benchmark.less merges | **HARD (for THIS file)** | M | byte-identity vs owner v5 intent |
| T6 | **Confirm remaining benchmark.less feature coverage** — run `parseToAst`+`serialize` over the (import-trimmed) file, enumerate every residual `UnsupportedShape`, close each. Guards/mixins/value-ops/functions/at-rules are already BUILT (rungs 5,7,8,9). | the actual gap set, empirically | **HARD** | zero `UnsupportedShape` on benchmark.less |
| T7 | **fns Stage F (in-flight)** — convert the last ~11 Less fns to AST‑v2 value shape in `@jesscss/fns` (`FNS-PACKAGE-MIGRATION-SPEC §S6`; HEAD `53e9db8dd` = "get-unit … partial"). Only matters if benchmark.less calls an unconverted fn; core→fns wiring (`makeBuiltinRegistry`→`builtinLessFns`) already landed (Stage D/E). | correct fn eval for any unconverted fn used | **PAR** (HARD only if benchmark.less hits one) | S each | per-fn differential + byte-identity |
| T8 | **Real-fixture `ast/` perf harness** — extend the `race.test.ts` methodology (warmup + N-median + same-worktree toggle + heap) to time `serialize(parseToAst(benchmark.less))` vs Less 4.x (`less@^4.6.3`) on the same file, with a **byte-identity gate to `renderRealOracle`** (and to the committed v5 golden) as a hard precondition to reporting. | **the number** | **HARD** (last) | byte-gate green → emit ms |
| T9 | **Commit a full-file v5 `benchmark.css` golden** (current 123-byte file is a stub). Produce from legacy render, owner-reviewed against less.js `alpha`. | trustworthy correctness anchor | **PAR** (needed before the number is "trusted") | S | owner review vs alpha |

**Not needed for the number (do not over-build):**
- **P1 bridge deletion** (`__tests__/bridge.ts`) — orthogonal; it's the test
  oracle, not the perf path. The perf number is taken through `parseToAst`, which
  never touches the bridge. (Still worth doing for the constitution, just not a
  blocker here.)
- **`collapseNesting:false` nested-emit** (`…ROADMAP.md:130`) — the 4.x-comparable
  perf number uses the **flattened** (`collapseNesting:true`) form, which `ast/`
  already emits and which matches the 4.x baseline. Nested-emit is a correctness
  roadmap item, not a perf-number prerequisite.
- **Escaping `~"…"` / Less map access** — not used by benchmark.less (§2); skip for
  this file.
- **Plugin/production wiring of `ast/` into `Compiler`/`jess-plugin-less`** — NOT
  required to *measure* the engine. A standalone harness driving `parseToAst` +
  `serialize` gives the apples-to-apples number without the full front-end swap.
  (Production adoption is the eventual cutover, but decoupled from getting the
  number.)

### Critical-path summary

`T1 → {T2, T3, T4, T5 in parallel} → T6 (close residual gaps) → T8 (measure)`, with
`T7`/`T9` alongside. The number is gated behind **feature completion for
benchmark.less's construct set**, not behind bridge deletion, nested-emit, or a
production plugin swap. The realist read: this is **feature work (T2–T6), not a
weekend harness** — but it is also **much narrower than "finish the whole
cutover"** (SCSS, `.jess`, live bindings, sourcemap identity, plugin API, nested
emit are all out of scope for the number).
