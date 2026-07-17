# Non-Engine Bloat Inventory (ranked kill-list)

READ-ONLY sweep of everything the `ast/` engine museum reviews did **not** cover:
`packages/core/src/**` outside `ast/` and `tree/`, plus the other packages' `src/`
(`jess` CLI, `jess-plugin-less`, `jess-plugin-less-compat`, `jess-plugin-scss`, `fns`,
`style-resolver`, `config`, `awaitable-pipe`, `_shared`). Generated `lib/`,
`node_modules`, test files, and `.ts` grammar sources are excluded.

Base: `origin/dev` @ `29a5b7883`. No code was edited.

**Signal being hunted:** the `jess-error.ts` pattern — a file that mixes many unrelated
concerns (class + data + renderers + types + adapters + factories) and grew silently past
review. Ranking is by **concern-density and egregiousness**, not raw LOC. A 400-line file
that is one cohesive concern is fine; a 200-line file that is five concerns is not.

Context: a dead-code sweep already landed on dev (`b353224bc` — deleted the dead `Visitor`
class runtime, `conversions.ts` memoize ceremony, dead `jess-error` dedupe set, dup type
decls). That commit is the right *spirit*; this list is the structural decomposition work it
did not touch.

---

## Rank 1 — `packages/jess-plugin-less-compat/src/plugin.ts` — 1428 LOC — WORST OFFENDER

**One class (`LessCompatPlugin`, lines 174–1422) ≈ 1250 lines**, and inside it a **single
`get visitor()` getter spanning lines 455–1422 (~970 lines)** — one closure that builds the
entire Less.js-compat visitor pipeline inline. This is the most egregious concern-pileup in
the whole non-engine surface, and no review has ever opened it.

Concerns crammed into the one class:
1. Post-processor execution (`runPostProcessors`, 218).
2. Mutable plugin state — current file path + context (`setCurrentFilePath`, `setContext`, 234–252).
3. Jess-function binding registry construction (`createJessFunctionBindingRegistry`, 254).
4. `@plugin` directive detection by **hand-walking the tree with a depth counter**
   (`sourceMayContainPluginDirective`/`treeContainsPluginDirective`/`warnForPluginDirective`/
   `markPluginDirectiveInvisible`, 277–347) — a bespoke recursive tree scan that duplicates
   what a visitor already does.
5. Deno-based Less-plugin file loading (`registerDenoLessPluginFunctions`,
   `loadLessPluginFileWithDeno`, 349–402).
6. Root-function registration (`registerRootFunctions`, `beforeEvalVisitorForTree`, 403–444).
7. Static Less-plugin filtering (`filterLessPlugins`, 445).
8. The 970-line `visitor` closure (455–1422): visitor-instance collection, plugin-manager /
   mock-Less wiring, dynamic visitor insertion mid-iteration, `WeakMap` cache — an entire
   subsystem masquerading as a property getter.

**Gold-plating / smells:** `52` occurrences of `any` (`: any`, `<any>`, `any[]`) — this file
is effectively untyped despite the repo's ABSOLUTE no-`as any` rule; the giant getter rebuilds
`lessVisitorInstances` and re-derives plugin wiring on every access; the hand-rolled
depth-capped tree walk (#4) is exactly the "core re-derives structure from a bespoke walk"
anti-pattern.

**Lean target:** promote the `visitor` getter body to a dedicated module
(`less-compat-visitor-pipeline.ts`) built once and cached, not rebuilt in a getter. Split the
`@plugin`-directive detection (#4) and Deno loading (#5) into their own files. Replace the
`any` sea with the structural guards already established in `transform/*` (the repo recently
did `as-any → structural type guards` in the bridge adapters — same treatment applies here).

**Est. reduction:** file drops to ~250–350 LOC of orchestration; ~900 lines relocate into
3–4 focused modules; net LOC roughly flat but concern-count per file goes 8 → ~2.

**Behavior risk:** HIGH — this is the live Less.js-compat contract (the one external contract
per project memory). Any decomposition must gate on the less-compat bridge byte-identity suite.

**Mechanical vs owner call:** OWNER CALL. Big surface, external contract, needs a dedicated
plan + byte-identity gate before touching.

---

## Rank 2 — `packages/jess/src/index.ts` — 1727 LOC — largest file in scope

The CLI/`Compiler` entry point. It is a genuine god-file: a top-of-module pile of free
functions across **at least six unrelated concerns**, then a `Compiler` class (528–1727,
~1200 lines) with ~20 methods.

Distinct concerns living in one file:
1. **Config assembly** — `createBaseConfig`, `arrayConcatCustomizer`, `stableStringify`,
   `isObjectRecord`/`isPluginInterface` guards, Less-variable-override rendering
   (`normalizeLessVariableName`/`renderLessVariableOverrides`/`getLessVariableOverrides`/
   `prepareRootLessSource`), search-path derivation (142–231).
2. **Trivia / comment handling** — `CommentRange`, `commentAwareTrivia`, `adoptSourceTrivia`
   (231–316). A parser-adjacent concern that has no business in the CLI orchestrator.
3. **Profiling subsystem** — `isProfileEnabled`, `nowMs`, `getMemorySnapshot`,
   `diffMemorySnapshot`, `createRenderProfile`, `measureProfileSync`, `measureProfileAsync`,
   `finalizeRenderProfile`, plus `ProfileMemorySnapshot`/`RenderProfile` types (94–423).
   ~130 lines of `JESS_PROFILE`-gated instrumentation — a self-contained module.
4. **Module/consumer resolution** — `createConsumerRequire`, `resolveFromConsumer`,
   `resolveFromJessPackage`, `resolvePackageImportEntry`, `resolveJsReadRoot`,
   `getConsumerResolutionBaseDir` (423–528). Node resolution machinery, another module.
5. **JS-plugin proxying** — `createJsPluginProxy` (812), `buildPlugins` (884).
6. **The public API** — `createContext`, `compile`, `render`, `renderString`,
   `renderToResult`, `safeCompile`, `safeRender`, `dispose`, plus pre-render/import-visitor
   hooks (`hasPreRenderVisitor`/`applyPreRenderVisitors`/`attachImportVisitorHook`).

**Gold-plating:** `stableStringify` + `arrayConcatCustomizer` are hand-rolled config-merge
plumbing (lodash-merge-style customizer) that likely predates a real config module; the
profiling block is elaborate for something gated behind one env var.

**Lean target:** extract `profiling.ts` (#3), `consumer-resolution.ts` (#4),
`config-assembly.ts` (#1), and move trivia handling (#2) to where the parser/trivia code
lives. `Compiler` keeps only the render/compile API + plugin wiring.

**Est. reduction:** ~500–650 lines relocate into 4 modules; `index.ts` lands ~1000–1100 LOC
and, more importantly, one concern (the compile pipeline) instead of six.

**Behavior risk:** MEDIUM — public CLI API; extractions are mostly move-only but the config
merge + resolution paths are load-bearing. Gate on the jess less-test harness.

**Mechanical vs owner call:** MOSTLY MECHANICAL move-extraction, but sequence it — owner
should confirm the module split boundaries.

---

## Rank 3 — `packages/core/src/context.ts` — 1209 LOC — the core god-object

`TreeContext` (278–326, small) + `Context` (328–1209, ~880 lines, ~40 members). `Context` is
the classic god-object: it is the eval context, the import loader, the warnings sink, the
scope-stack holder, and the option resolver all at once.

Concerns:
1. **Option resolution** — `ContextOptions`/`ResolvedOptions`/`OPTION_DEFAULTS`/
   `resolveOptions`/`setOption` (73–223, 372).
2. **Warnings & deprecation finalization** — `warn`, `warnDeprecation`, `finalizeWarnings`
   (434–635, ~200 lines). This is a substantial, self-contained subsystem that duplicates the
   *domain* of `warnings.ts` — the finalization/dedup/suppression logic should live with the
   warnings config resolver, not inline in the context.
3. **Scope-stack bookkeeping** — a long parade of getters/push-pops: `searchScope`,
   `selectorAnalysis`, `classMap`, `printState`, `callMap`, `callStack`, `referenceStack`,
   `importScope`/`pushImportScope`/`popImportScope`, `pushReference`/`popReference`,
   `hasImportantSource`/`pushImportantSource`/`popImportantSource` (659–801). Roughly a dozen
   parallel stacks — a `ScopeState` helper's worth of state manually inlined.
4. **Import / module loading** — `getTree`, `resolveImportPath`, `readBinary`, `parseString`,
   `getModule`, `findParserPlugin` (953–1179). File I/O + parser dispatch, a distinct
   subsystem.
5. **Misc eval helpers** — `hashClass`, `shouldOperate`, `registerSpineVisitor`,
   `generateId`/`idChars` (1179+, 250, 635).

**Lean target:** lift warnings finalization (#2) into `warnings.ts`/a `warning-sink.ts`; move
import/module loading (#4) into `import-loader.ts`; collapse the dozen scope stacks (#3) into
a `ScopeState` object the context delegates to. `Context` becomes a thin coordinator over
those.

**Est. reduction:** ~400–500 lines relocate; concern-count 5 → ~2. Also removes the
warnings-domain duplication between this file and `warnings.ts`.

**Behavior risk:** HIGH — `Context` is threaded through the entire eval/spine path. This is
the most load-bearing file in the list. Decompose incrementally, one subsystem at a time.

**Mechanical vs owner call:** OWNER CALL — architectural, touches the hottest object in the
engine; needs a plan and per-subsystem gating.

---

## Rank 4 — `packages/core/src/define-function.ts` — 1084 LOC — hand-rolled runtime type system

More cohesive than the top three (it is "define + dispatch a runtime function"), but it is a
**hand-rolled runtime type-validation + argument-marshalling engine** with heavy speculative
type-level generality. It earns rank 4 on gold-plating, not concern-scatter.

Breakdown:
- **~180 lines of type-level generic machinery** (83–260): `GetArgType`, `GetParamType`,
  `GetBaseRecordType`, `GetOptionalRecordType`, `GetRecordType`, `GetPositionalTypes`,
  `ValidateFunctionSignature`, `DefineFunctionCallable`, `DefinedFunction`. Elaborate
  compile-time inference whose payoff is authoring DX for a fixed, internal set of builtins —
  classic speculative generality.
- **Runtime argument marshalling** (531–926): `parseArgumentsToRecord`,
  `applyDefaultsAndValidate`, `buildPositionalArgs`, `parseCallWithContextArgs`,
  `createThunk` — a bespoke named/positional/rest/optional argument binder.
- **Runtime type validation** (926–1084): `validateArguments`, `validateArgumentIfNeeded`,
  `validateValue`, `isValidType` — a mini type-checker re-implementing `instanceof`/typeof
  dispatch against `ArgType` unions.

**Gold-plating verdict:** the type-level block is the prime candidate to cut/simplify — it is
inference ceremony for internal callers. The runtime marshalling is largely *necessary* (the
fns need named-arg + rest + thunk support), but `validateValue`/`isValidType` re-derive a
type-guard dispatch that overlaps with `conversions.ts` and could be data-driven.

**Lean target:** collapse the generic machinery to the minimum inference callers actually rely
on; split runtime marshalling (`arg-binding.ts`) from validation (`arg-validation.ts`) so the
file stops being three engines in a trench coat.

**Est. reduction:** ~150–250 LOC from trimming the type block; the rest is a move-split (net
LOC flat, concern-count 3 → 1-per-file).

**Behavior risk:** MEDIUM — every builtin fn dispatches through here; validation edge cases
(optional/rest/thunk) are subtle. Gate on the full fns suite.

**Mechanical vs owner call:** OWNER CALL on the type-machinery trim (DX trade-off); the
runtime move-split is mechanical.

---

## Rank 5 — `packages/core/src/jess-error.ts` — 939 LOC — **IN-PROGRESS** (the exemplar)

The file that motivated this sweep, and the textbook case: **seven concerns in one module**,
grown silently from 2023 to 939 lines across 34 commits with no review catching it.

Concerns crammed in:
1. **Types / data model** — `JessErrorCode` union, `ErrorDiagnostic`, `WarningDiagnostic`,
   `JessErrorInit`, `Template`, phase/severity types (11–163).
2. **Message templates** — the `TEMPLATES` map + `interpolate` + code-set + display overrides
   (176–328). A data table.
3. **Parser-error adaptation** — `recognitionToken`, `isLexerError`, `errorMessage`,
   `lexerTokenText`, `getErrorFromParser` (349–890). Chevrotain/lexer adapter.
4. **Terminal-fancy rendering** — `osc8`/`oscLink`/`supportsLinks`/`linkFor` OSC-8 hyperlink
   machinery + `trail`/`prettyLabel` path formatting (371–416). Terminal-fanciness.
5. **Code-frame rendering** — `buildLineStarts`, `extractRelevantLines`, `ensureLineStarts`,
   `getLine`, `codeFrameFromFile`, `lineColAt` (163–559). A source-frame renderer.
6. **The `JessError` class** (563–679).
7. **Factories + adapters** — `makeJessError`, `makeJessErrorFromDiagnostic`, the `ERR`/`WARN`
   builder tables, `toDiagnostic` (683–915).

**Lean target (already scoped on the `trim/jess-error` branch):** split into
`jess-error-codes.ts` (types + TEMPLATES + overrides), `jess-error-parser.ts` (parser/lexer
adaptation), `code-frame.ts` (line-starts + frame rendering + OSC-8 links), and a slim
`jess-error.ts` (class + factories). The dev commit `b353224bc` already removed the dead
`emit()`/`resetDedupe()`/`_seen` dedupe set from here.

**Status:** IN-PROGRESS — a `trim/jess-error` branch exists for this decomposition. Left in the
list as the canonical example of the pattern the reviews missed.

**Behavior risk:** LOW–MEDIUM — mostly move-extraction; the OSC-8/terminal detection is the
only runtime-behavior-bearing part.

---

## Rank 6 — `packages/jess-plugin-less-compat/src/less-compat-structures.ts` — 564 LOC

Four unrelated exports in one file:
1. `LessVisitor` class (12–195).
2. `LessPluginManager` class (195–284).
3. `LessTreeConstructors` — a large `Record<string, any>` of Less tree-node constructors
   (284–532, ~250 lines of data).
4. `createLessMock` factory (532–564).

Not a god-class, but a grab-bag: a visitor, a plugin manager, a constructor registry, and a
mock factory have no reason to co-habit. The `LessTreeConstructors` record is `any`-typed
data that belongs in its own `less-tree-constructors.ts`.

**Lean target:** one file per export (`less-visitor.ts`, `less-plugin-manager.ts`,
`less-tree-constructors.ts`, `less-mock.ts`). Pure move; net LOC flat.

**Behavior risk:** LOW–MEDIUM — less-compat contract, but move-only. Gate on bridge
byte-identity.

**Mechanical vs owner call:** MECHANICAL, but same external-contract caution as Rank 1.

---

## Checked and cleared (cohesive — leave alone)

These are large-ish but each is **one concern**; size is inherent, not bloat:

- `packages/core/src/warnings.ts` (207) — warnings/errors config normalize + match + summary.
  Cohesive. (Note: it is the *natural home* for the warnings-finalization block currently
  stranded in `context.ts` — see Rank 3.)
- `packages/jess/src/diagnostics.ts` (283) — tiered diagnostic output rendering. Cohesive set
  of renderers for one job.
- `packages/awaitable-pipe/src/pipe.ts` (287) — `pipe`/`safePipe` with typed overloads. The
  overload ladder is inherent ceremony for a typed variadic pipe, not bloat.
- `packages/fns/src/util/relative-color.ts` (377) — relative-color-syntax channel evaluation.
  One cohesive color subsystem.
- `packages/config/src/types.ts` (430) — pure type/interface declarations. Cohesive.
- `packages/core/src/plugin.ts` (303), `packages/config/src/options.ts` (206) — single-concern.

---

## Summary ranking

| # | File | LOC | Concerns | Verdict | Risk | Action |
|---|------|-----|----------|---------|------|--------|
| 1 | jess-plugin-less-compat/src/plugin.ts | 1428 | ~8 (970-line `visitor` getter, 52×`any`) | Decompose | HIGH | Owner call |
| 2 | jess/src/index.ts | 1727 | 6 (profiling, resolution, trivia, config, JS-proxy, API) | Decompose | MED | Mostly mechanical |
| 3 | core/src/context.ts | 1209 | 5 (options, warnings-finalize, scope-stacks, imports, helpers) | Decompose | HIGH | Owner call |
| 4 | core/src/define-function.ts | 1084 | 3 + heavy type ceremony | Trim + split | MED | Owner call (type trim) |
| 5 | core/src/jess-error.ts | 939 | 7 | Decompose | LOW-MED | **IN-PROGRESS** (`trim/jess-error`) |
| 6 | jess-plugin-less-compat/src/less-compat-structures.ts | 564 | 4 | Split 1-per-export | LOW-MED | Mechanical |

**Headline the reviews missed:** the two worst non-engine offenders — `plugin.ts` (a
970-line getter) and `jess/index.ts` (six modules fused into the CLI entry) — are *larger and
more concern-scattered than `jess-error.ts`*, and neither was ever opened by the `ast/`-focused
sweeps. `context.ts` is the most load-bearing of the pile. Fix order should follow risk, not
size: land the mechanical wins (Rank 2, 5, 6) first, then plan the two HIGH-risk external/core
god-objects (Rank 1, 3) with byte-identity gates.
