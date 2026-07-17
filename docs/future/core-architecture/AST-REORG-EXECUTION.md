# ast/ Reorg — Execution Checklist

Load this + one phase's slice; execute without re-reading the full plan.
Rationale / proofs / import-evidence / cycle derivation: **see `AST-COLOCATION-REORG-PLAN.md`** (§ refs below).

Two coupled reshapes, ONE principle — *grammar owns structure, builder is a thin reader*:
**(A) Keystone (§0):** `core/ast/parse-host/` collapses OUT of core; node CONSTRUCTION moves to the parser packages. Core exports a LEAF `@jesscss/core/ast` (node defs + factories, zero engine/value runtime); parsers import it and build v2 nodes as the grammar reduces. `FunctionalParseHost` callback + legacy `BuilderHost` (2 targets) die. Peer objective (§0.11): kill `less-parser/src/builders.ts` regex-recovery (~63 sites) — the maintained builder re-parses the grammar's structured output with regex. **(B) In-core family co-location (§1–§7)** of everything that STAYS: engine/value/expr/selector/rule/mixin/at-rule/extend.
End state: package graph strictly **parser → core** (acyclic).

## Sequencing (live state — update as items land)

The whole cleanup wave is gated behind a **byte-identical benchmark oracle** so every
structural cut can prove it changed no output. Order:

1. ✅ **Benchmark number measured** (`fe7c3a789`): ast/ v5 = 55.6 ms median (4.2× faster than legacy tree/ 231 ms; 1.66× the Less.js 4.x 33.5 ms reference). `%()`→`string-format` + `!important` + namespace zero-arg mixin dispatch landed byte-clean.
2. 🔄 **Gap #3 dedup** (task #27, IN FLIGHT): reverse keep-last-by-(name+value) + overload carve-out (`isFromRestrictedMixinOutput`). Last real byte gap (~114 diff lines); collapses the residual to just the ~135 known-correct v5 divergences (trailing-comment indent, `:is()` compaction — DO NOT TOUCH) + ~68 declared-out-of-scope feature gaps (quoted-string interp loop, `+:` merge). Unblocks a stable oracle.
3. 🔄 **Non-engine bloat** (task #25, IN FLIGHT, PARALLEL — outside ast/, no collision): jess-error 1000-line demolition + plugin.ts `any` swarm + context.ts/jess-index.ts god-objects.
4. ⏳ **Tier-B grammar-structuring** (task #6, A0 below — decisions LOCKED: strict `lessInterp`, fix `@keyframes @{n}` inline). HARD PREREQUISITE for the reorg.
5. ⏳ **`builders.ts` leaning** (§0.11) + **co-location reorg** (Phase A→B below): parse-host dissolves, parser imports leaf `@jesscss/core/ast`, families co-locate, monster files split.
6. ⏳ **`t2`/`tree2` remnant elimination** (728 occurrences / 51 files) + `Word` interface resolution — folds into Phase B rewrites.

### Post-stabilization fan-out (owner, 2026-07-17) — ONLY after §2–§6 land and ast/ is stabilized
Once ast/ is clean, a small parallel fan-out is sanctioned:
- **Invalid-test audit:** one agent audits tests that now assert *internal implementation* (shape/private API) rather than real output — CONVERT to output/contract assertions or DELETE. (Aligns with [[feedback-no-sacred-test-expectations]]: internal tests are freely changeable; only the less-compat bridge contract + intended output bytes are fixed.)
- **Perf-opportunity profiling:** one agent profiles the stabilized ast/ (parse+build is ~64% of render, serialize+import ~32%) for further wins and DOCUMENTS them in a new `PERF_IDEAS.md` (Jess doc) — candidates only, each measured before any bet per [[feedback-predict-perf-before-building]].

## LAWS (enforce every step)

- **No regex outside Parseman's `regex()` combinator** (§0.10). Gate: NO ad-hoc `.test/.exec/.match/new RegExp//…/`-literal in builder/action/host/resolve code. `regex()` in `grammar*.ts` is the ONE sanctioned home (may run a real RegExp — fine). Grep MUST be empty per phase.
- **Builders are LEAN** — thin node-assembly over the grammar's already-structured children. Yardstick: if a builder tokenizes/splits/classifies-by-pattern, the grammar UNDER-structured — push work into the grammar, not the builder.
- **Chevrotain (`less-parser/src/productions/*.ts`, `@ts-nocheck`) = COVERAGE + SEMANTICS oracle, NOT a 1:1 structural template.** It confirms which cases must work + what they mean; structure them in Parseman's cleanest CONTEXTUAL idiom (scannerless → finer than Chevrotain's lexer-forced coarseness). Don't copy its node shape; don't under-structure.
- **Byte-identity gate every step** — parse→serialize output byte-for-byte vs bridge oracle across corpus (bridge/census/nested-census/atrule/extend/guard/import/value + whole-doc driver). Any non-identical byte = botched step; fix before advancing. **CAVEAT:** the whole-doc legacy oracle (`oracle-run.mjs`) is NOT ground truth — it has real `&`-expansion bugs on benchmark.less (doubles segments, drops ancestors; ast/ is correct — see the known-262 baseline residual). Gate = **no NEW diff beyond the categorized baseline** (intended-v5 divergences + declared-deferred features + legacy-oracle-bug lines where ast/ already wins), and validate contested selector lines against real Less 4.x (`~/git/worktrees/less.js/`, READ-ONLY), NOT `diff==0`.
- **No `as any`.** Proper guards/types.

## Phases (checklist)

### A0 — Tier-B grammar-structuring (HARD PREREQUISITE; §0.9, §0.11)
Interpolation-bearing families CANNOT relocate until the grammar hands over structure — else the `@media @{q}` misparse crosses the package boundary.
- [ ] In `grammar.ts` (css + less), structure as leaf-split/interpolation nodes mirroring `InterpolatedSelector`, using grammar rules + `regex()` combinators: at-rule prelude, custom-property name/value, import specifier.
- [ ] Same effort covers the `builders.ts` fat offenders (ns-accessor, dimension, prelude, value-token): per shape, Chevrotain `productions/` COVERAGE audit → Parseman contextual `node()` → collapse builder regex.
- [ ] Verify the ns-accessor mixed form `#ns(1,3,{bar:foo}).options[@one](blah)[two]` renders correctly TODAY (add as fixture) before unifying — the bifurcation may hide a latent bug (§0.11 correctness check).
- **GATE:** misparse fixtures (`@media @{q}`, `@keyframes @{name}`, `--@{k}:…`, `@import "@{theme}.less"`) parse into structured children; bucket-(a) regexes unreached (stub them to `throw`, corpus stays green). Per-shape byte-identity.
- **Seq:** non-interpolated families (A2/A3) do NOT wait on A0.

### A1 — Leaf export (§0.3)
- [ ] Add `./ast` subpath to `core/package.json` exports (mirror `./value` exactly).
- [ ] Add `ast: './src/ast.ts'` to `core/tsdown.config.ts` entry.
- [ ] Create `core/src/ast.ts` (NEW leaf barrel, distinct from internal `ast/index.ts`): re-export node layer only (`node.js`, `nodes.js`, `at-rule.js`; post-B splits into per-family `node.js`).
- **GATE:** build + existing suites green (no behavior change; parsers not yet retargeted).

### A2 — css-parser v2 build path (§0.5)
- [ ] Add ast v2 `buildNode` cases (or a v2 `BuilderHost`) in css-parser consuming `@jesscss/core/ast`; add public entry `parseCssToAst`.
- [ ] Move CSS-base construction in (ruleset, selector base, value-leaf/expr base, custom-props, comments, at-rules, charset) reading structured children; any pattern → grammar `regex()`.
- [ ] Interpolation-bearing (`at-rules`, `custom-props`) move only AFTER A0.
- **GATE:** byte-identity harness (now driving parser entry) identical + §0.10 no-regex grep empty over v2 builder/host files.

### A3 — less-parser v2 path + the 3 hard relocations (§0.5, §0.8)
- [ ] Move Less construction: interp, variables, mixins-def/call, value-ops, extend; import-`@{}` after A0.
- [ ] **`:extend` marker protocol — ATOMIC, one commit** (§0.8b): css-parser selector builder's `:extend` recognition + less-parser markers/`selectorExtends` WeakMap/drain. Producer+consumer must not straddle commits.
- [ ] **`import.ts` subsystem → less-parser `resolve-imports`** (§0.8a): `ImportState` threaded through parser entry; `%%`-splice at `import.ts:132` PRESERVED as-is (it's the target shape, not a smell); import fixture corpus moves with it.
- [ ] **trivia/`declParts`/`sliceSpan`** (§0.8c): port span/trivia semantics VERBATIM into v2 build path (same offsets/trim/`%%`/`;`/`:`) — do NOT assume legacy has equivalents.
- **GATE:** byte-identical (incl. moved import corpus) + §0.10 grep empty over v2 builder/host/resolve files. §0.8c move runs FULL census, not just family suite.

### A4 — delete parse-host + retire legacy seam (§0.5, §5)
- [ ] Delete `core/ast/parse-host/` entirely (dispatch-host, host-context, actions, import).
- [ ] Retire legacy `BuilderHost`/`FunctionalParseHost` two-target seam; delete legacy-TREE construction in `builders.ts`.
- [ ] Re-verify `git grep "parseman|css-parser|less-parser"` over `packages/core/src` → EMPTY.
- **GATE:** full corpus byte-identical via relocated harness; package graph acyclic (`parser → core`).
- **Note:** A4 removes only legacy-tree portion; MAINTAINED `builders.ts` re-parse regexes (§0.11) survive and retire shape-by-shape via A0-family grammar-structuring — §0.10 exclusion lifts per shape, reaching empty at last offender.

### Phase B — in-core family co-location (§1, §4). Serial, one executor; shared drains stomp parallel agents.
- [ ] B1 `engine/scope.ts` — extract Frame/lookups FIRST (shared substrate).
- [ ] B2 `value/` — move all value-*/color/round/literal-tag/evaluator/serialize-value/functions; rewrite `value.ts` + `ast/index.ts` + `src/ast.ts`.
- [ ] B3 `expr/` — nodes value-AST slice + serialize eval slice.
- [ ] B4 `selector/` — nodes selector slice + canonical + compose slice.
- [ ] B5 `rule/` — nodes statement slice + merge slice.
- [ ] B6 `mixin/` — nodes mixin slice + mixin-dispatch + guard.
- [ ] B7 `at-rule/` — at-rule node + StyleImport.
- [ ] B8 `extend/` — ExtendInstruction node + barrel → index (KEEP the 6 sub-modules; do NOT 4-way split).
- [ ] B9 `engine/emit.ts` — residual serialize spine; delete emptied `serialize.ts`/`nodes.ts`.
- **GATE:** each step byte-identical vs core engine. Breadcrumbs `{@link ../engine/emit}` on `at-rule/node.ts`, `mixin/node.ts`, `expr/node.ts`. `serialize.ts` drains across B1–B9 (shrinking file, not a barrel).

**Post-reorg (measured, gated, NOT mechanical):** (a) `engine/emit.ts` monomorphic-walker unify (~400 lines paired flat/nested dup; thread `e.collapse`, measure unify-vs-keep byte-identical, RECORD); (b) `provenance.ts` restore (parser writes `setSourceSpan` under gate, measure WeakMap cost); (c) `composeStats`-as-hook design fix.

**Sequence (§7):** ONE quiet-tree window, Phase A THEN B. Land the in-flight mixin-recursion feature FIRST (it edits `mixin-*` + `engine/emit` — the exact surface) or quiesce it; do not interleave.

## Move-map (§1) — source → target

| Source | Target |
|---|---|
| `ast/node.ts`, `ast/index.ts` | unchanged (index = full internal surface; new `src/ast.ts` = leaf) |
| `ast/nodes.ts` (603, SPLIT) | expr/selector/rule/mixin/at-rule/extend `node.ts` (see below) |
| `ast/serialize.ts` (1899, SPLIT) | `engine/{scope,emit}.ts` + `expr/eval.ts` + `selector/compose.ts` + `rule/merge.ts` |
| `ast/at-rule.ts` | `ast/at-rule/node.ts` |
| `ast/serialize-value.ts`, `color.ts`, `color-names.ts`, `round.ts`, `value-units.ts` | `ast/value/{serialize,color,color-names,round,units}.ts` |
| `ast/value-eval.ts` (runtime seam) | `ast/value/seam.ts` |
| `ast/value-factory.ts`, `value-dispatch.ts`, `value-operate.ts` | `ast/value/{factory,dispatch,operate}.ts` |
| `ast/value-guards.ts` (compare/typeCheck) | `ast/value/compare.ts` (rename) |
| `ast/literal-tag.ts`, `evaluator.ts`, `functions/types.ts` | `ast/value/{tag,evaluator,fns/types}.ts` |
| `ast/guard.ts` (mixin cond), `mixin-dispatch.ts` | `ast/mixin/{guard,dispatch}.ts` |
| `ast/extend.ts` (barrel) | `ast/extend/index.ts` (6 sub-modules unchanged) |
| **nodes split:** Word/Dimension/Sequence/Operation/FunctionCall/Paren/Interp/VarRef/VarIndirect/DetachedRuleset/MapAccessor/DetachedCall + ctors | `ast/expr/node.ts` |
| Simple/Compound/Complex/SelectorList + ctors | `ast/selector/node.ts`; canonical consts → `ast/selector/canonical.ts` |
| Declaration/VarDeclaration/Rule/Param/Root/Statement, Comment, RawInline | `ast/rule/node.ts` |
| StyleImport | `ast/at-rule/node.ts` |
| MixinDef/MixinCall/PathSeg | `ast/mixin/node.ts` |
| ExtendInstruction | `ast/extend/node.ts` |
| **RELOCATE to parsers** (`parse-host/actions/*`, not co-located) | css-parser / less-parser (see regex-kill + §0.5) |

## Regex kill-list (§0.7) — buckets: (a) DIES via grammar (blocked on A0, do NOT relocate regex); (b) RELOCATE-AND-CLEAN; (c) DISSOLVES (plumbing)

| Site | Bucket | Grammar structure / disposition that kills it |
|---|---|---|
| `at-rules.ts:42/59` AT_KEYWORD+prelude slice | a | A0: structure `AtRuleBlock` prelude leaf-split like `InterpolatedSelector` |
| `at-rules.ts:73–110` `@{}`/`@name`/`@@name` re-tokenizer (ships `@media @{q}` misparse) | a | A0: grammar emits interp replacements; re-tokenizer + misparse die together |
| `custom-props.ts:52–91` `@{}` name re-tokenizer + `:`/`;` split | a | A0: structure custom-prop name-template + bounded value |
| `import.ts:466` `specifierRaw` `includes('@{')/'@@'` | a | A0: detection reads "is this an `Interpolated` node?" not substring |
| `host-context.ts:176–181` `declParts` `:`/`;` split | a | A0: grammar delivers name+value as bounded children |
| `comments.ts:58,139–150` gap-scan | b | consume parser's structured trivia log (`captureTriviaForNode`), no re-scan |
| `charset.ts:84` slice | b | fold into structured at-rule head (rides A0) |
| `extend.ts:43,70` `ALL_FLAG` | b | consume grammar's `optional(flag)` child (`flag=0`→partial) |
| `import.ts:472/296/483/450` url-unwrap/`.css`/options/keyword | b | resolution-domain classify; move with import subsystem, read structured children |
| `value-leaf.ts:86`, `variables.ts:43/70/88`, `mixin-call.ts:76`, `mixins-def.ts:59–119`, `value-expr.ts:131` | b | read grammar-bounded children; drop sigil strips grammar can label |
| `dispatch-host` (`ParseBuildHost`/`parseToAst`/`run`), `actions/index.ts` ACTION_LIST, `host-context` BuildContext/Args/Fn/Placeholder | c | fold into parser's `buildNode` dispatch + public v2 entry |

## The 3 hard relocations (§0.8) — one-line risk each

- **`import.ts` (631) → less-parser `resolve-imports`:** whole `@import` resolution subsystem (fs re-parse via `parseLessFn`); RISK — `ImportState` must thread through parser entry, `%%`-splice preserved verbatim, import fixture corpus moves + stays byte-identical.
- **`:extend` marker protocol → less-parser (ATOMIC):** WeakMap producer (css-parser selector builder) + consumer (less-parser ruleset drain); RISK — split across commits = mid-migration parse loses extend instructions.
- **trivia/`declParts`/`sliceSpan` → parser v2 path:** exact span/trivia byte semantics; RISK — legacy `buildNode` builds a DIFFERENT tree, don't assume equivalents; port verbatim, gate on FULL census (highest byte-identity risk).

## builders.ts leaning (§0.11) — worst offenders

| Offender | Mode | Grammar change (Chevrotain `productions/` = case oracle → Parseman contextual `node()`) |
|---|---|---|
| Ns-accessor head re-split + path bifurcation (`400` `_buildNsAccessor`; `nsHead` regex vs `GluedParen`/`_tryParseNamespaceRef`) | 1 · bifurcation | ONE recursive `node()` for whole accessor (segments + call-args + `[index]` + `(lookup)`); drop regex head; unify the two paths; node is atomic folding-operand |
| Dimension re-split ×2 (`943`, `2653` `/^(\d+)([a-zA-Z]+|%)?$/`) | 2 · under-structure | grammar emits `Dimension{value,unit}` (number child + unit child) |
| @import prelude re-parse (`2367` quote, `2357/2427/2943` `\bas\s+`) | 2 · under-structure | grammar emits typed prelude leaves (path, `as`-alias, options) — same A0 specifier structuring |
| Value-token re-classify (`2525` singleVarRe, `2533` escapedStrRe, `2564` varAccRe) | 2 · under-structure | grammar emits typed value nodes (`VarRef`/escaped `Quoted`/`VarIndirect`·`MapAccessor`) |
