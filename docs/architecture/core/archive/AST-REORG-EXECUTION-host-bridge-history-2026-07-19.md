# ast/ Reorg — Execution Checklist

Load this + one phase's slice; execute without re-reading the full plan.
Rationale / proofs / import-evidence / cycle derivation: **see `AST-COLOCATION-REORG-PLAN.md`** (§ refs below).

Two coupled reshapes, ONE principle — *grammar owns structure, builder is a thin reader*:
**(A) Completed keystone:** `core/ast/parse-host/`, its action list, and the
test bridge are gone. New construction stays in the parser grammar reduction as
exact AST literals; core owns no construction host. The remaining parser work is
to remove legacy construction and recognition debt without replacing those
deleted seams. **(B) In-core family co-location (§1–§7)** of everything that
stays: engine/value/expr/selector/rule/mixin/at-rule/extend.
End state: package graph strictly **parser → core** (acyclic).

**No replacement host:** do not convert `ParseBuildHost`/`BuilderHost` into a
“v2 host.” Each grammar reduction calls its parser-local construction function
directly, which assembles only already-structured children through
`@jesscss/core/ast` factories. There is no generic callback/dispatch map,
action registry, or second-pass parser in the target architecture.

**Naming law:** every surviving public parser/core API is dialect-neutral and
migration-neutral: `parse`/`build`/`render` a document, never `parseToAst`,
`renderAst`, `parseLess`, or `renderLess`. Package/module location identifies
the dialect. Do not retain a transitional alias after fusion; test-only bridge
names can disappear with the bridge.

## Sequencing (live state — update as items land)

> **Owner override (2026-07-18): canonicalize first.** AST-v2 fusion and removal of
> `parse-host`/`BuilderHost` lead this program; internal consumers of their old shapes are
> not a prerequisite. It is acceptable for those monorepo callers to go red while the single
> `parser → core/ast` path is established. Repair or delete them afterwards from the canonical
> model. Feature/eval work remains required for the final green finish line, but does not gate
> deleting the duplicate construction architecture.

**Execution order:** SCSS P2/P3 separation → dependency-free core AST leaf → direct
grammar-to-AST fusion (CSS + Less) → atomic replacement of the invalid
extend/import/trivia seams with parser-owned facts →
delete `parse-host`, legacy `BuilderHost`, legacy tree construction, and parser runtime
recovery → restore in-scope consumers against AST-v2 → feature/eval closure → final corpus
and performance gates. The older feature-first C1/C2 wording in
`AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md` is historical rationale, not a deletion
gate, until that document is rewritten during the fusion pass.

The whole cleanup wave is gated behind a **byte-identical benchmark reference** so every
structural cut can prove it changed no output. Order:

1. ✅ **Benchmark number measured** (`fe7c3a789`): ast/ v5 = ~50 ms median — **owner: "AMAZING"; perf half of the bar is MET. PROTECT this floor, never regress it.** (4.2× faster than the legacy tree/ engine; strict Less.js-4.x parity was never the target.) `%()`→`string-format` + `!important` + namespace zero-arg mixin dispatch landed byte-clean.

   > **⚠️ REFERENCE REFRAME (owner, 2026-07-17):** the legacy `tree/` Compiler output is **NOT a reference** and hasn't been for months — Jess was mid-transition, output shape never proven. Do NOT gate on "match the legacy output." The v5 output reference is **less.js `alpha`** (`~/git/worktrees/less.js/`, READ-ONLY; :is() compaction etc.); ast/ self-consistency (before/after byte-identity) is the gate for pure refactors. See [[benchmark-reference-buggy-ampersand-expansion]].
2. 🔄 **Gap #3 dedup** (task #27, IN FLIGHT): reverse keep-last-by-(name+value) + overload carve-out (`isFromRestrictedMixinOutput`). Last real byte gap (~114 diff lines); collapses the residual to just the ~135 known-correct v5 divergences (trailing-comment indent, `:is()` compaction — DO NOT TOUCH) + ~68 declared-out-of-scope feature gaps (quoted-string interp loop, `+:` merge). Unblocks a stable reference.
3. 🔄 **Non-engine bloat** (task #25, IN FLIGHT, PARALLEL — outside ast/, no collision): jess-error 1000-line demolition + plugin.ts `any` swarm + context.ts/jess-index.ts god-objects.
4. ⏳ **Tier-B grammar-structuring** (task #6, A0 below — decisions LOCKED: strict `lessInterp`, fix `@keyframes @{n}` inline). It is required before its interpolation-bearing families move, but does **not** block independent direct-AST fusion or deletion of duplicate construction.
5. ⏳ **`builders.ts` leaning** (§0.11) + **co-location reorg** (Phase A→B below): parse-host dissolves, parser imports leaf `@jesscss/core/ast`, families co-locate, monster files split.
6. ⏳ **`t2`/`tree2` remnant elimination** (728 occurrences / 51 files) + `Word` interface resolution — folds into Phase B rewrites.

### Fan-out (owner, 2026-07-17)
- **Perf-opportunity profiling — 🔄 IN FLIGHT NOW (owner: can run anytime, read-only + doc-only, no gating).** One agent profiles ast/ (parse+build ~64% of render, serialize+import ~32%) and DOCUMENTS ranked candidates in a new `PERF_IDEAS.md` — ideas only, each measured/predicted before any bet per [[feedback-predict-perf-before-building]]. Does NOT touch engine/parser source (no collision with Tier-B). Protect the ~50 ms floor.
- **Invalid-test audit — ⏳ AFTER §2–§6 (needs stabilized ast/).** One agent audits tests that assert *internal implementation* (shape/private API) rather than real output — CONVERT to output/contract assertions or DELETE. (Per [[feedback-no-sacred-test-expectations]]: internal tests freely changeable; only the less-compat bridge contract + intended output bytes are fixed.)

## LAWS (enforce every step)

- **Parser runtime boundary:** in all four parser packages, the only surviving scanner or
  regex recognition is Parseman grammar combinators and their macro-generated output.
  Handwritten `RegExp`/regex literals, `.test/.exec/.match`, `charCodeAt` loops, byte
  scanners, and recovery re-parsers are forbidden—not merely discouraged—in parser source.
  `regex()` in `grammar*.ts` is the sanctioned Parseman declaration home. Grep MUST be
  empty for handwritten recognition at every parser-cleanup phase.
- **Builders are LEAN** — thin node-assembly over the grammar's already-structured children. Yardstick: if a builder tokenizes/splits/classifies-by-pattern, the grammar UNDER-structured — push work into the grammar, not the builder.
- **Chevrotain (`less-parser/src/productions/*.ts`, `@ts-nocheck`) = COVERAGE + SEMANTICS reference, NOT a 1:1 structural template.** It confirms which cases must work + what they mean; structure them in Parseman's cleanest CONTEXTUAL idiom (scannerless → finer than Chevrotain's lexer-forced coarseness). Don't copy its node shape; don't under-structure.
- **Behavior gate every step** — preserve the categorized parser/core corpus
  baseline and validate contested output against real Less 4.x; do not revive a
  bridge or test-only conversion as an oracle. The historical differential paths
  named in older sections are evidence only; migrated public parser and core
  behavior tests are the active gate.
- **No `as any`.** Proper guards/types.

## Phases (checklist)

### A0 — Tier-B grammar-structuring (required per affected family; §0.9, §0.11)
Interpolation-bearing families cannot be deleted until the grammar hands over structure — else the `@media @{q}` misparse crosses the package boundary.
- [ ] In `grammar.ts` (css + less), structure as leaf-split/interpolation nodes mirroring `InterpolatedSelector`, using grammar rules + `regex()` combinators: at-rule prelude, custom-property name/value, import specifier.
- [ ] Same effort covers the `builders.ts` fat offenders (ns-accessor, dimension, prelude, value-token): per shape, Chevrotain `productions/` COVERAGE audit → Parseman contextual `node()` → collapse builder regex.
- [ ] Verify the ns-accessor mixed form `#ns(1,3,{bar:foo}).options[@one](blah)[two]` renders correctly TODAY (add as fixture) before unifying — the bifurcation may hide a latent bug (§0.11 correctness check).
- **GATE:** misparse fixtures (`@media @{q}`, `@keyframes @{name}`, `--@{k}:…`, `@import "@{theme}.less"`) parse into structured children; bucket-(a) regexes unreached (stub them to `throw`, corpus stays green). Per-shape byte-identity.
- **Seq:** non-interpolated families (A2/A3) do NOT wait on A0.

### A1 — Leaf export (§0.3)
- [x] Add `./ast` subpath to `core/package.json` exports (mirror `./value` exactly).
- [x] Add `ast: './src/ast.ts'` to `core/tsdown.config.ts` entry.
- [x] Create `core/src/ast.ts` (NEW leaf barrel, distinct from internal `ast/index.ts`): re-export node layer only (`node.js`, `nodes.js`, `at-rule.js`; post-B splits into per-family `node.js`). Landed `6af3d05cb`.
- **GATE:** `@jesscss/core` build, focused AST-entrypoint test, and package-export verification passed.

### A2 — css-parser v2 build path (§0.5)
- [ ] Move CSS grammar reductions to direct parser-local AST-factory calls consuming
  `@jesscss/core/ast`; add the uniform parser entrypoint `parse` (no `buildNode`,
  no v2 `BuilderHost`, and no dialect-suffixed public name).
- [ ] Move CSS-base construction in (ruleset, selector base, value-leaf/expr base, custom-props, comments, at-rules, charset) reading structured children; any pattern → grammar `regex()`.
- [ ] Interpolation-bearing (`at-rules`, `custom-props`) move only AFTER A0.
- **GATE:** parser/canonical-AST behavior coverage and the parser-runtime boundary verifier.

### A3 — Less direct-AST path + the 3 invalid seams to replace (§0.5, §0.8)
- [ ] Move Less grammar reductions to direct parser-local AST-factory calls: interp,
  variables, mixins-def/call, value-ops, extend; import-`@{}` after A0. No generic
  construction host or action-dispatch layer may remain.
- [ ] **`:extend` marker protocol — ATOMIC, one commit** (§0.8b): make the CSS grammar emit an explicit extend fact and let Less consume that fact directly. Delete the producer/consumer marker side-channel and `WeakMap` drain; producer and consumer must change together.
- [ ] **Import resolution** (§0.8a): the Less grammar parses its specifier as typed literal and interpolation segments (normally `many(choice(literalChunk, lessInterp))`) and emits a complete import fact on first parse. The parser resolves that fact. Parsing an imported file happens once as a new source file; delete all variable-sniff, option re-parse, regex shape recognition, and text-splice machinery (`ImportState`, `parseLessFn`, `%%`).
- [ ] **Trivia and declaration bounds** (§0.8c): make grammar spans/trivia/name/value bounds the sole source of truth. Delete `declParts`/`sliceSpan` recovery; prove output/source-map behavior with the full census rather than porting legacy trim or delimiter mechanics.
- **GATE:** parser/canonical-AST behavior coverage, full relevant corpus, and the parser-runtime boundary verifier.

### A4 — completed host/bridge deletion; continue consumer migration (§0.5, §5)
The parser-owned AST-v2 path is the only construction model. Repair or remove
remaining callers against it; do not reconstruct a deleted construction path.
- [x] Deleted `core/ast/parse-host/` entirely with its construction and bridge tests.
- [ ] Retire legacy `BuilderHost`/`FunctionalParseHost` and legacy-TREE construction in
  `builders.ts`; intentionally-red callers are tracked as migration work, not retained through
  a compatibility shim.
- [ ] Repair or delete remaining in-scope consumers directly against the canonical model; no
  old-shape adapter may become permanent architecture.
- [ ] Re-verify `git grep "parseman|css-parser|less-parser"` over `packages/core/src` → EMPTY.
- **GATE:** parser-owned AST construction retains the migrated behavioral corpus; package graph
  is acyclic (`parser → core`). The final integration gate still requires the differential,
  benchmark/bootstrap, core eval, and Jess Less corpus to be green.
- **Note:** A4 removes only legacy-tree portion; MAINTAINED `builders.ts` re-parse regexes (§0.11) survive and retire shape-by-shape via A0-family grammar-structuring — §0.10 exclusion lifts per shape, reaching empty at last offender.
- **Coordination:** retain only dialect grammar work that has a direct parser-local
  reduction owner. The historical W1/action-list sequencing is superseded with
  the deleted action list.

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
| **DELETE AND REPLACE in parsers** (`parse-host/actions/*`, not co-located) | parser-local direct grammar reductions (see regex-kill + §0.5) |

## Regex kill-list (§0.7) — buckets: (a) DIES via grammar; (b) REPLACE WITH GRAMMAR FACTS; (c) DISSOLVES (plumbing)

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
| `import.ts:472/296/483/450` url-unwrap/`.css`/options/keyword | b | grammar emits typed import facts; parser resolution consumes them directly |
| `value-leaf.ts:86`, `variables.ts:43/70/88`, `mixin-call.ts:76`, `mixins-def.ts:59–119`, `value-expr.ts:131` | b | read grammar-bounded children; drop sigil strips grammar can label |
| `dispatch-host` (`ParseBuildHost`/`parseToAst`/`run`), `actions/index.ts` ACTION_LIST, `host-context` BuildContext/Args/Fn/Placeholder | c | delete; grammar reductions call parser-local typed AST factories directly through the uniform public `parse` entry |

## The 3 invalid construction seams to replace (§0.8) — one-line risk each

- **Import construction violation:** the first parse emits complete typed literal/interpolation segments and resolution consumes the resulting fact; RISK — search order, once/multiple/reference semantics, and inline placement must be proven without any variable sniff, string-shape regex, `ImportState`, `parseLessFn`, or `%%` text-splice machinery.
- **`:extend` marker side-channel:** parser emits explicit extend facts; RISK — producer and consumer must change atomically so no transient marker protocol or `WeakMap` drain survives.
- **trivia/`declParts`/`sliceSpan` recovery:** parser owns exact spans/trivia/name/value bounds; RISK — output fidelity needs a full-census proof, not a byte-slicing fallback.

## builders.ts leaning (§0.11) — worst offenders

| Offender | Mode | Grammar change (Chevrotain `productions/` = case reference → Parseman contextual `node()`) |
|---|---|---|
| Ns-accessor head re-split + path bifurcation (`400` `_buildNsAccessor`; `nsHead` regex vs `GluedParen`/`_tryParseNamespaceRef`) | 1 · bifurcation | ONE recursive `node()` for whole accessor (segments + call-args + `[index]` + `(lookup)`); drop regex head; unify the two paths; node is atomic folding-operand |
| Dimension re-split ×2 (`943`, `2653` `/^(\d+)([a-zA-Z]+|%)?$/`) | 2 · under-structure | grammar emits `Dimension{value,unit}` (number child + unit child) |
| @import prelude re-parse (`2367` quote, `2357/2427/2943` `\bas\s+`) | 2 · under-structure | grammar emits typed prelude leaves (path, `as`-alias, options) — same A0 specifier structuring |
| Value-token re-classify (`2525` singleVarRe, `2533` escapedStrRe, `2564` varAccRe) | 2 · under-structure | grammar emits typed value nodes (`VarRef`/escaped `Quoted`/`VarIndirect`·`MapAccessor`) |
