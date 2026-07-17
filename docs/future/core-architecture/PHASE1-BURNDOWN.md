# Phase-1 "Cleanup to ZERO" Burn-Down

> **Purpose.** The single, provably-complete checklist for the owner mandate: *"clean up ALL
> the cruft in builders and in `ast/` — and I do mean ALL of it — don't leave out anything a
> reviewer flagged."* When every box below is checked, Phase-1 is complete. This doc RECONCILES
> the four review inventories against the **current `origin/dev` tree** (`783342cf5`,
> 2026-07-17) — many counts in the source docs are stale; per-item status here is the truth.
>
> **Source inventories reconciled (nothing they flagged is dropped):**
> `AST-REMAINING-DEBT-KILL-LIST.md` (74 findings, 17-agent review), `AST-QUALITY-AUDIT.md`
> (375 findings, 36 per-file + 5 coherence), `NON-ENGINE-BLOAT-INVENTORY.md` (6 ranks),
> `AST-REORG-EXECUTION.md` + `AST-COLOCATION-REORG-PLAN.md` (the reorg), `NODE-SLIM-FOLLOWONS.md`.
>
> **Oracle:** `TREE2-CONSTITUTION.md` P0–P6. Byte-identity floor (P6) gates every cut.

## In-flight ownership (DO NOT double-count / DO NOT touch)

Three agents are editing source concurrently. Items they own are tagged and **must not be
picked up by a burn-down executor** — they close as a side effect of that agent's landing.

| Tag | Agent scope | Files owned |
|---|---|---|
| **[GRAMMAR]** | Tier-B grammar + builder-leaning + parse-host construction | `less-parser/grammar.ts`, `less-parser/builders.ts`, `css-parser` build path, `core/ast/parse-host/**` |
| **[EXTEND]** | ast/extend engine | `core/ast/extend/**` (already split into `ir/match/plan/solve/compose/emit`) |
| **[SERIALIZE]** | serialize / value-path | `core/ast/serialize.ts` + value engine (`value-*.ts`, `evaluator.ts`, `serialize-value.ts`, `literal-tag.ts`) |

Everything **not** tagged is free for a burn-down executor now (respecting the per-item gate).

---

## Headline reconciliation (what changed since the reviews)

**RESOLVED since the review docs were written** (verified absent/fixed on `783342cf5`):

| Flagged item | Source | Current state |
|---|---|---|
| `declaration-static.ts` dead module (KILL-LIST 1.3) | KILL-LIST | **file deleted** |
| `prefixDescendant` dead wrapper (KILL-LIST 1.2) | KILL-LIST | **gone** (extend refactored into `extend/`) |
| `serialize.ts` `!e.ev` no-evaluator lane (KILL-LIST 1.9, AUDIT h) | both | **gone** — evaluator now required |
| `value-factory` dead exports `unitOf`/`makeBool`/`makeNil`/`makeList` (AUDIT g) | AUDIT | **removed** |
| `literal-tag` dead `makeDimension` import (AUDIT g) | AUDIT | **gone** — `makeDimension` now live in `value-operate.ts` |
| `calcInner` "un-export" (AUDIT g, KILL-LIST) | both | already module-private |
| `OutputMode`/Compressed speculative hook (AUDIT h, KILL-LIST 2) | both | **removed from ast/** |
| `nodes.ts` `rawInline` factory "0 callers" (KILL-LIST 1.1) | KILL-LIST | **now has a live caller** (`import.ts:380`) — NO LONGER DEAD; do not delete |
| `extend.ts` 1066-line monster (AUDIT f, REORG B8) | both | **split** into `extend/{ir,match,plan,solve,compose,emit}.ts` |
| `jess-error.ts` 939-line god-file (NON-ENGINE rank 5) | NON-ENGINE | **45 LOC** — decomposed, rendering moved to CLI linecraft |
| `plugin.ts` 52×`any` swarm (NON-ENGINE rank 1) | NON-ENGINE | **0 `any`** (still 1239 LOC — concern-scatter open, see N-2) |
| `context.ts` last 2 `any` (NON-ENGINE) | NON-ENGINE | **0 `any`** |

**The entire `NON-ENGINE-BLOAT-INVENTORY.md` is now ~mostly historical** — its own banner says so.
The only genuinely-open non-engine items are the concern-scatter decompositions (plugin.ts,
jess/index.ts, context.ts, define-function.ts) which are NOT `ast/`/builders cruft and are
tracked as N-items below at the bottom, plus the ~136-error typecheck burn-down (out of scope).

---

## Cluster 0 — `t2` / `tree2` remnant elimination (P3) — the single largest theme

**Current counts (`packages/core/src/ast/**`, verified):**
- `tree2` mentions: **172** total (**76** outside `__tests__`, mostly doc/JSDoc + one runtime error string + `../tree2` boundary paths).
- `t2.` identifier accesses: **394** total (**211** outside `__tests__` — the `import * as t2` alias).
- `__t2*` runtime brand fields: **12** (host-context defs + readers in selector/extend/ruleset).
- **Combined `t2|tree2` in ast/: 687.**

Per-file (non-test) `t2.`+`tree2` density:

| file (under `ast/`) | count | tag |
|---|---|---|
| `parse-host/import.ts` | 33 | [GRAMMAR] |
| `parse-host/actions/custom-props.ts` | 29 | [GRAMMAR] |
| `parse-host/actions/selector.ts` | 27 | [GRAMMAR] |
| `parse-host/host-context.ts` | 24 | [GRAMMAR] |
| `parse-host/actions/value-expr.ts` | 22 | [GRAMMAR] |
| `parse-host/actions/at-rules.ts` | 20 | [GRAMMAR] |
| `parse-host/actions/guard.ts` | 17 | [GRAMMAR] |
| `parse-host/actions/mixins-def.ts` | 16 | [GRAMMAR] |
| `parse-host/actions/ruleset.ts` | 13 | [GRAMMAR] |
| `parse-host/actions/comments.ts` | 12 | [GRAMMAR] |
| `parse-host/actions/mixin-call.ts` | 10 | [GRAMMAR] |
| `parse-host/dispatch-host.ts` | 10 | [GRAMMAR] |
| `parse-host/actions/extend.ts` | 8 | [GRAMMAR] |
| `parse-host/actions/variables.ts` | 8 | [GRAMMAR] |
| `parse-host/actions/value-leaf.ts` | 8 | [GRAMMAR] |
| `parse-host/actions/interp.ts` | 7 | [GRAMMAR] |
| `node.ts` | 6 | standalone (doc) |
| `parse-host/actions/charset.ts` | 5 | [GRAMMAR] |
| `nodes.ts` | 5 | standalone (doc) |
| `parse-host/actions/selector-interp.ts` | 3 | [GRAMMAR] |
| `at-rule.ts` | 2 | standalone (doc) |
| `parse-host/actions/index.ts` | 1 | [GRAMMAR] |
| `color-names.ts` | 1 | standalone (doc) |

- [ ] **0.a [GRAMMAR]** — All `parse-host/**` `t2`/`tree2`/`__t2*` remnants (**~279 of the 287 non-test hits**). These do NOT need a standalone rename sweep: `parse-host/**` is **deleted wholesale in reorg Phase A4** (construction moves to the parser packages). DONE-criterion: `parse-host/` directory no longer exists → `git grep -nE '\bt2\.|tree2|__t2' packages/core/src/ast/parse-host` returns nothing because the path is gone. **Do NOT hand-rename these — they die with the directory.**
- [ ] **0.b standalone** — Doc-only `tree2`→`ast` scrub in the files that STAY: `node.ts` (6), `nodes.ts` (5), `at-rule.ts` (2), `color-names.ts` (1). Zero collision, safe now. DONE-criterion: `git grep -nE 'tree2|\bt2\b' packages/core/src/ast/{node,nodes,at-rule,color-names}.ts` empty.
- [ ] **0.c [SERIALIZE]** — any `t2`/`tree2` in `serialize.ts`/value files (fold into the value-path landing).
- [ ] **0.d standalone** — runtime error string `'tree2-host: unrecognized selector shape'` → `'ast-host: …'` (lives in `host-context.ts:201`, so subsumed by 0.a).

**GATE for whole cluster:** `git grep -nE 'tree2|\bt2\b|__t2' packages/core/src/ast --include='*.ts'` (excluding `__tests__` bridge fixtures that intentionally reference the compat shape) returns EMPTY.

---

## Cluster 1 — Monster-file decomposition (P5)

Current `ast/` LOC (non-test):

| file | LOC | flagged | tag | target |
|---|---|---|---|---|
| `serialize.ts` | **2091** (grew from 1882) | AUDIT #1, KILL-LIST | [SERIALIZE] | split → `engine/{scope,emit}.ts` + `expr/eval.ts` + `selector/compose.ts` + `rule/merge.ts` (REORG B) |
| `import.ts` | 631 | AUDIT #19 | [GRAMMAR] | relocate to `less-parser/resolve-imports` (REORG §0.8a) |
| `nodes.ts` | **609** (grew from 563) | AUDIT #3 | standalone→[SERIALIZE]-adjacent | split → `expr/selector/rule/mixin/at-rule/extend node.ts` (REORG move-map) |
| `host-context.ts` | 287 | AUDIT #20 | [GRAMMAR] | dissolves into parser (REORG A4) |
| `value-expr.ts` | 260 | AUDIT #23 | [GRAMMAR] | dissolves into parser |
| `custom-props.ts` | 255 | AUDIT #30 | [GRAMMAR] | dissolves into parser |
| `comments.ts` | 211 | AUDIT #25 | [GRAMMAR] | dissolves into parser |
| `literal-tag.ts` | 201 | AUDIT #6 | [SERIALIZE] | → `value/tag.ts` |
| `mixin-dispatch.ts` | 200 | AUDIT #14 | standalone | → `mixin/dispatch.ts` |
| `value-operate.ts` | 165 | AUDIT #8 | [SERIALIZE] | → `value/operate.ts`, move `typeCheck` out |

**Test-only monster:** `parse-host/__tests__/bridge.ts` (**1262 LOC**) — the bridge oracle harness. Reorg-neutral; retire with the bridge test dependency (KILL-LIST 1.7/2 `Num` alias).

- [ ] **1.a [SERIALIZE]** — `serialize.ts` 7-way split (REORG B9). HARD GATE: only after all benchmark/value-path edits land. DONE-criterion: no single `ast/` engine file > ~600 LOC except by owner exception; `composeStats` moved to `__tests__/` (see 3.f).
- [ ] **1.b [GRAMMAR]** — `import.ts` + `host-context.ts` + all `parse-host/actions/*` relocate/dissolve (REORG A2–A4). DONE-criterion: `packages/core/src/ast/parse-host/` deleted; `git grep 'parseman|css-parser|less-parser' packages/core/src` empty.
- [ ] **1.c** — `nodes.ts` split into per-family `node.ts` (REORG B2–B8). Gate: after B-phase substrate (`engine/scope.ts`) lands. DONE-criterion: `nodes.ts` deleted, node defs co-located.
- [ ] **1.d [SERIALIZE]** — value-engine folder grouping (`value/`) + `value-operate` `typeCheck` extraction. DONE-criterion: `ast/value/` subfolder exists per REORG move-map.

**Reorg subfolder state (verified):** only `ast/extend/` exists (DONE by [EXTEND]). `value/`, `emit/`, `engine/`, `expr/`, `selector/`, `rule/`, `mixin/`, `at-rule/` **not yet created** — Phase B outstanding.

---

## Cluster 2 — `builders.ts` leaning + regex-outside-`regex()` law (P0)

**`less-parser/src/builders.ts` = 3281 LOC** (the maintained `BuilderHost`). The LAW: no
ad-hoc `.test/.exec/.match/new RegExp`/regex-literal outside Parseman's `regex()` combinator.

**Current builders.ts regex debt:** **~64 regex-op call sites** (`.test/.exec/.match/matchAll/new RegExp`) + **26 regex-literal definitions** (`= /…/`). Per memory, these are LEGACY `BuilderHost` that dies with legacy retirement; the §0.11 leaning pushes each shape into the grammar.

- [ ] **2.a [GRAMMAR]** — `builders.ts` §0.11 worst offenders (all [GRAMMAR]):
  - ns-accessor head re-split + path bifurcation (`_buildNsAccessor` ~L400) → one recursive `node()`.
  - dimension re-split ×2 (`/^(\d+)([a-zA-Z]+|%)?$/` ~L943, L2653) → grammar `Dimension{value,unit}`.
  - `@import` prelude re-parse (quote L2367, `\bas\s+` L2357/2427/2943) → typed prelude leaves.
  - value-token re-classify (singleVarRe L2525, escapedStrRe L2533, varAccRe L2564) → typed value nodes.
  DONE-criterion: `grep -nE '\.(test|exec|match|matchAll)\(|new RegExp|=\s*/[^/*]' packages/less-parser/src/builders.ts` → EMPTY on the maintained path (legacy-tree portion may remain until A4 deletes it, then also empty).
- [ ] **2.b [GRAMMAR]** — `ast/parse-host` P0 byte-rederivation regexes (the keystone violations; several ship WRONG output today, e.g. `@media @{q}` misparse). Verified sites (17):
  - `at-rules.ts:42/59` `AT_KEYWORD`, `:73/78` `@{}` re-tokenizer, `:97/100/104` `@name`/`@@name` — **HIGH risk (wrong output)**, REORG A0.
  - `custom-props.ts:52/57` `@{}` re-tokenizer, `:227` `!important` regex — REORG A0.
  - `extend.ts:43/70` `ALL_FLAG` `!?all` — consume grammar `optional(flag)` child.
  - `import.ts:296` `.css` test, `:450/508` `IMPORT_KEYWORD_RE`, `:472` `url()` unwrap — resolution-domain, move with import subsystem.
  DONE-criterion: `grep -rnE 'new RegExp|\.(test|exec|match|matchAll)\(|=\s*/[^/*]' packages/core/src/ast/parse-host` → EMPTY (all consume structured grammar children; misparse fixtures `@media @{q}`, `@keyframes @{name}`, `--@{k}:…`, `@import "@{theme}.less"` parse structurally).
- [ ] **2.c [SERIALIZE] / justified** — engine regexes in `value-operate.ts` (`CALC_WRAP_RE` L111 — **justified**, synthetic bytes, no parse origin; KEEP + document) and `literal-tag.ts` (`NUM_RE` L83, `HEX_RE` L84, hex `.match` L91, ident-color L188). Per KILL-LIST reject list these are the untagged/synthetic path — `NUM_RE`/`HEX_RE` collapse only when the `Numeric` leaf emits a structured tag (Tier-0b, Finding #1). DONE-criterion: remaining engine regex is only the documented synthetic-bytes set; each carries a "justified: synthetic string, no parse origin" comment.

**GATE:** the standing law grep — `regex` outside `regex()` on the MAINTAINED path — is EMPTY.

---

## Cluster 3 — Dead code / dead exports (verified still-open only)

| # | site | flagged | status | tag |
|---|---|---|---|---|
| 3.a | `ast/index.ts` barrel — **0 importers** (verified) | AUDIT #5/g | OPEN — delete barrel OR wire `value.ts` through it (owner call) | standalone |
| 3.b | `serialize.ts:45` `composeStats` + `ComposeStats` type — still exported, all callers test-only | KILL-LIST 1.6, AUDIT f | OPEN | [SERIALIZE] |
| 3.c | `literal-tag.ts:36` `LiteralTag.Num = 1` alias | KILL-LIST 2, AUDIT b | OPEN — delete WITH bridge test dep (`Num` still live-referenced by legacy adapter/bridge) | [SERIALIZE] |
| 3.d | `evaluator.ts:52/55` dead `_modes` param on compare/typeCheck | AUDIT g | OPEN | [SERIALIZE] |
| 3.e | `mixin-dispatch.ts:69` redundant `filledByName` Set ≡ `named` | AUDIT #14/g | OPEN | standalone |
| 3.f | `host-context.ts:161` `isPlaceholder` (0 callers) + `:227` `isRawArgList` (dup of mixins-def) | AUDIT g | OPEN — but dies with A4 parse-host deletion | [GRAMMAR] |
| 3.g | `actions/index.ts:24` dead `export * from '../host-context.js'` (0 importers) | AUDIT g | OPEN — dies with A4 | [GRAMMAR] |
| 3.h | `nodes.ts` lowercase test-only factories `dim`/`mapAccessor`/`detachedCall`/`detachedRuleset`/`mixinCall`/`decl` | KILL-LIST 1.7 | OPEN — relocate to test helper (avoid 1664-call `decl` churn) | [SERIALIZE]-adjacent |
| 3.i | `nodes.ts:55` `Dimension` node interface + `value-eval.ts:38` **duplicate** `Dimension` interface | KILL-LIST 1.8, AUDIT d | OPEN — one Dimension home; couples with node-model migration | [SERIALIZE] |
| 3.j | `import.ts:275` `ImportFlags.css` field + `if (flags.css)` branch — permanently false | KILL-LIST 1.4, AUDIT e | OPEN — dies with import relocation | [GRAMMAR] |
| 3.k | `host-context.ts:111` `args.fields` / `dispatch-host` dead `fields` param | KILL-LIST 1.5, AUDIT g | OPEN — dies with A4 | [GRAMMAR] |

- [ ] All 3.a–3.k. DONE-criterion: each symbol has zero non-test references OR is deleted; `[GRAMMAR]`-tagged rows close automatically when `parse-host/` is deleted.

---

## Cluster 4 — DRY canonicalization (P4)

Collapse one-problem-N-solutions duplication. All [SERIALIZE]/[GRAMMAR]-gated where noted.

- [ ] **4.a [GRAMMAR]** — `@{...}`→`Interp` built **3 ways**: `interp.ts:47` (correct/structural) vs `at-rules.ts:73` + `custom-props.ts:52` (byte regex). Route all through `interpFromLeaves`; delete both `interpFromString` regex copies. (Closes with A0 + parse-host deletion.)
- [ ] **4.b [SERIALIZE]+[EXTEND]** — selector-composition engine **twice** & already divergent: `serialize.ts:648–711` (`:is()` wrap) vs `extend/compose.ts` (bare join). One selector-compose module. (extend side already in `extend/compose.ts`; serialize side to converge.)
- [ ] **4.c [SERIALIZE]** — value-domain DRY (KILL-LIST 3.1–3.5, AUDIT d): consolidate `NUM_RE`/`HEX_RE`/`QUOTE_RE`; `clamp`≡`clamp01`; sep→glue map ×4 → one `sepGlue(sep)`; `@`-sigil re-emission ×5 → one `unresolvedRef(name)` helper (strict resolve-miss now **throws** per `v5-resolve-failure-is-eval-error-unless-optional` — delete the silent re-emit); inline value-object literals → factories; quoted detect/strip/wrap ×5 → one util; `round()` dup vs `tree/util/round.ts`.
- [ ] **4.d [GRAMMAR]** — parse-host DRY (dies with A4, but track): `declParts` `;`-strip+`:`-split shared helper; `Leaf`/`isLeaf` ×5 hoist; `rawSpan`/`leafSpan` unify; `Span`/`CommentRange`/inline `{start,end}` → one `Span`; colliding `isNode` (import.ts vs node.ts) → rename `isRawNode`; contribs-map dup (`extend` — now in `extend/`).
- [ ] **4.e standalone** — `node.ts` 3 parallel type lists, no exhaustiveness gate → `NodeType = Node['type']` + `satisfies Record<NodeType,true>`.
- [ ] **4.f post-P1** — `parseHex`/`namedColor`/hsl-rgb kernels + `color-names.ts` dup `tree/` — collapse only when legacy `tree/` deleted (boundary-mandated dup today; KILL-LIST reject list).

---

## Cluster 5 — Simplify / smell / stale-doc (P3/P6, low-risk, mostly free)

- [ ] **5.a standalone (doc-only, safe now)** — stale-path/stale-claim scrubs: `value-eval.ts`/`value-operate.ts` headers cite non-existent `tree2-frontend/`; `serialize.ts:13` header names a non-existent "interned-string primitive" + false "deferred rungs"; `node.ts` "frozen" claim; `value-units.ts` phantom-consumer header; `literal-tag.ts` enum "0-6" comment; oversized JSDoc in `at-rule.ts`/`functions/types.ts`/`variables.ts` (40–50% of file).
- [ ] **5.b [SERIALIZE]** — `value-factory.ts` build-then-spread double-alloc ×5 (KILL-LIST 4.1) — **measure before landing** (predict-perf rule).
- [ ] **5.c [SERIALIZE]** — `serialize.ts` `emitAtRuleStatementRaw` `replace(/^\s+/,'')` dead re-scan (KILL-LIST 4.2); `withRewind(e,fn)` idiom ×3 extract; unify `emitNestedLeaf`≈`emitLeaf` / `emitNestedAtRuleBlock`≈`emitAtRuleBlock`.
- [ ] **5.d [GRAMMAR]** — `value-leaf.ts` speculative `tagOf` callback (4 constant sites); `value-expr.ts:186` dead `|| sliceSpan(start,start)` no-op.
- [ ] **5.e standalone** — `functions/types.ts` make `params` optional (inert on VariadicSpec), un-export member interfaces.
- [ ] **5.f [SERIALIZE]** — `nodes.ts:179` `defFrame: object|null` → `Frame|null` (drop `as Frame` casts at serialize.ts:467/967); mutable `_canon`/`_hasInterp`/`_hasAmp` memo on plain-data interfaces → WeakMap/free-fns (or prove the win).
- [ ] **5.g [SERIALIZE]** — `value-dispatch.ts` register/lookup case asymmetry (silent-miss **bug** — behavior fix, gate on tests); fold `has`+`dispatch` into one `lookup`.
- [ ] **5.h [SERIALIZE]** — `guard.ts` byte-truthiness `.bytes.trim()==='true'` → typed `Bool.value`/`Keyword.text`; short-circuit `and`/`or` (currently eager — behavior fix).
- [ ] **5.i [SERIALIZE]** — `value-eval.ts` phantom `unitMode:'canonicalize'` → canonical `UnitMode` import (mode-flow correctness).

---

## Cluster 6 — `Word` interface resolution (keep / slim / eliminate)

- [ ] **6.a [SERIALIZE]** — `Word` interface (`nodes.ts:47`) + factory (`nodes.ts:512`): **50 non-test uses in `ast/`** (LitFields-threaded). Per `ast-v2-unified-node-model` this is an OPEN keep/slim/eliminate audit — the unified `type:'Dimension'` reshape may absorb it. DONE-criterion: owner decision recorded (keep as leaf-string carrier / slim / fold into node-model migration), and either the interface is gone or a one-line rationale for keeping it sits at its definition. Sequence behind the node-model migration (couples with 3.h/3.i).

---

## Cluster 7 — Tier-0b GATED interim debt (track, do NOT delete standalone)

These are real byte-rederivation smells whose structured replacement **does not exist yet** —
each unblocks only when its named grammar/parser task lands (all [GRAMMAR]). Listed so they are
tracked, not lost (KILL-LIST Tier 0b). Deleting now = correctness regression.

- [ ] `literal-tag.ts` `NUM_RE` `dimensionFromString` — unblocked by `Numeric` leaf emitting a structured dimension tag (Finding #1). No defensive throw on the NaN path (speculative slowdown).
- [ ] `custom-props.ts`/`at-rules.ts` `@{}` tokenizers — Task #6 structured `Interp` leaf.
- [ ] `native/list-helper.ts` `topLevelSplit`/`coerceListItems` byte-split — Task #6/#10 value-assembly `List` node.
- [ ] `comments.ts` `scanTrailingBlockComments` end-of-source trivia — A0.2 dispatch-host trivia threading.
- [ ] `charset.ts` import-prelude byte-slice — import family consuming structured `ImportAtRuleStatement` children.
- [ ] `value-expr.ts` comma-list-in-paren `betweenBytes` — comma-list-in-paren value node.
- [ ] `import.ts:168` `collectFileVars` full second parse per interpolated-import — drive from engine scope, not re-parse (bigger P0+P5 refactor).

DONE-criterion: each closes when its named task lands; none is deleted before then.

---

## KEEP list (verified-correct; do NOT touch)

From KILL-LIST "clean rejects" + AUDIT justified — re-listed so no burn-down agent
mistakes them for cruft: `literal-tag.ts:138` `tagForWord` untagged-path branches;
`literal-tag.ts:64` `parseHex` boundary-clean dup (module-boundary mandated); `serialize.ts:575`
ampersand splice; `serialize.ts:406` `stripOuterQuotes`; `serialize.ts:651` resolved-`!important`
sniff; `value-operate.ts` `CALC_WRAP_RE` (synthetic) + Guard-2 keyword passthrough + "Guard"
naming; `guard.ts:72` `truth` byte compare; `extend` `branchHasAmp`/`substituteAmp` (parser-owned);
`native/list-helper.ts` numeric-algorithm ports; `dispatch-host.ts:42` interface-obligation empties;
`nodes.ts` `rawInline` (NOW has a live caller); `LIT_ALREADY_MINIMAL` reserved bit (owner-sanctioned).

---

## Non-engine follow-ons (OUT of the ast/+builders bar; tracked for completeness only)

Not part of "cruft in builders and ast/", but flagged by NON-ENGINE-BLOAT and still open:

- [ ] **N-1** `jess/src/index.ts` (1727 LOC) — 6 concerns; extract `profiling.ts`/`consumer-resolution.ts`/`config-assembly.ts`/trivia. Mechanical move-split.
- [ ] **N-2** `jess-plugin-less-compat/src/plugin.ts` (1239 LOC, 0 `any` now) — 970-line `visitor` getter → dedicated pipeline module. OWNER CALL, external contract, byte-identity gate.
- [ ] **N-3** `core/src/context.ts` (1227 LOC) — god-object; lift warnings-finalize → `warnings.ts`, import-loader out, collapse scope-stacks. OWNER CALL.
- [ ] **N-4** `core/src/define-function.ts` (1084 LOC) — trim ~180 lines type-level machinery; split marshalling/validation. OWNER CALL.
- [ ] **N-5** `jess-plugin-less-compat/src/less-compat-structures.ts` (564 LOC) — split 1-per-export. Mechanical.
- [ ] **N-6** `jess-error.ts:371` OSC-8/chalk inverted-layering residue — verify fully gone (file now 45 LOC; confirm no core→CLI escape-helper export remains).
- [ ] **N-7** ~136-error `tsc` burn-down (repo builds `--noCheck`) — separate typecheck track.

---

## Node-slim follow-ons (design-decided, sequence AFTER Phase-1 stabilizes — not cruft)

Not cruft; forward reductions gated on post-flip re-profile (from `NODE-SLIM-FOLLOWONS.md`):
- [ ] **NS-1** value-literal type tag (Dimension→Color migration; `VALUE-LITERAL-TAG-SPEC.md`) — after D-EVAL flip + value-heavy re-profile.
- [ ] **NS-2** selector-container nested-arrays — PARKED; gate on extend-match benchmark, own spike.

---

## Provably-complete definition (when is Phase-1 DONE?)

Phase-1 is complete when ALL hold:
1. `git grep -nE 'tree2|\bt2\b|__t2' packages/core/src/ast --include='*.ts'` (ex-`__tests__` bridge fixtures) → EMPTY. **(Cluster 0)**
2. `packages/core/src/ast/parse-host/` deleted; `git grep 'parseman|css-parser|less-parser' packages/core/src` → EMPTY (parser→core acyclic). **(Cluster 1.b, 2.b, 3.f/g/j/k, 4.a/d, 7)**
3. `grep -nE '\.(test|exec|match|matchAll)\(|new RegExp|=\s*/[^/*]'` over `builders.ts` (maintained path) AND over any surviving ast/ engine file → EMPTY except the documented synthetic-bytes set. **(Cluster 2)**
4. No single `ast/` engine file > ~600 LOC without recorded owner exception; `value/`/`engine/`/`expr/`/`selector/`/`rule/`/`mixin/`/`at-rule/` subfolders exist per REORG move-map. **(Cluster 1)**
5. Every Cluster 3 symbol has zero non-test references or is deleted. **(Cluster 3)**
6. `Word` interface: owner keep/slim/eliminate decision recorded. **(Cluster 6)**
7. Byte-identity holds at every step (P6) vs the less.js-`alpha` oracle + ast/ self-consistency baseline.

Clusters 4/5 (DRY/simplify) and 7 (Tier-0b) close incrementally under 1–3; the KEEP list is
excluded by construction. Non-engine N-items and node-slim NS-items are explicitly OUT of the
"builders + ast/" bar and tracked only so nothing is lost.

---

## Tier-B interpolation-structuring — deferred accommodations (retire at reorg A4 / query-prelude split)

Byte re-tokenizers / dual-use accommodations that Tier-B (task #6, phase A0) shapes 1–2
could NOT remove without regressing the less-compat bridge (the one external contract)
or without landing a separate higher-risk shape. Each has a grep-able in-code marker
reconciling 1:1 with the rows below:

```
grep -rn "TODO(tier-b/A4)\|TODO(tier-b/query-prelude)" packages/core/src/ast/parse-host packages/less-parser/src/grammar.ts
```

| # | Marker | File:line | WHAT is left | WHY (which path needs it) | RETIREMENT TRIGGER |
|---|---|---|---|---|---|
| TB-1 | `TODO(tier-b/A4)` | `less-parser/src/grammar.ts` (`customPropInterp`) | cp-NAME kept as ONE regex leaf (not leaf-split like the value) | Legacy BuilderHost (drives less-compat bridge) consumes the single-leaf shape; splitting into `@{…}` leaves regressed the bridge's name emission (`--@{k}` → `--`) — external-contract break | Split into `--`+ident-chunk+isolated `lessInterp` leaves at legacy-BuilderHost retirement (reorg A4) |
| TB-2 | `TODO(tier-b/A4)` | `core/ast/parse-host/actions/custom-props.ts` (`interpFromString`/`declName`) | `@{…}` re-tokenizers for cp-NAME + the regular declaration's interpolated PROPERTY name | (a) cp-NAME: paired with TB-1 (bridge). (b) regular-decl name: `declPropName` is one opaque leaf (separate un-structured shape) | Split `customPropInterp` (TB-1) + `declPropName` + consume via `interpFromRegion`, at reorg A4 |
| TB-3 | `TODO(tier-b/query-prelude)` | `core/ast/parse-host/actions/at-rules.ts` (`AT_KEYWORD`/`parsePreludeValue`/`interpFromString`) | byte re-tokenizers for the QUERY at-rule prelude | `@media`/`@supports`/`@container` deliver their prelude as one opaque `QueryCondition` node → a query's `@var`/`@{…}` is not consumable as leaves. NOT legacy-coupled — grammar-coverage gap | Split the QUERY grammar's prelude into leaves (separate Tier-B shape; §3.4 keeps it committed), then leaf-consume |
| TB-4 | `TODO(tier-b/A4)` | `core/ast/parse-host/import.ts` (`directSpecifier`) | `.includes('@{')/'@@'` SUBSTRING check detecting an interpolated import specifier | Specifier `@{…}` is INSIDE a Quoted string → structuring = §3.3 (changes the SHARED flat `Quoted` the legacy BuilderHost re-tokenizes via `INTERPOLATION_REGEX`/`getInterpolatedNode`) → bridge break. (Substring test, not a regex; direct host defers interpolated imports regardless) | Land §3.3 Quoted structuring after legacy-BuilderHost retirement (reorg A4), then read the path's `Interpolated` node type |
| TB-5 | `TODO(tier-b/A4)` | `core/ast/parse-host/actions/value-leaf.ts` (`quotedInterp`/`quotedLeaf`) | host-side `@{name}` re-tokenizer for interpolation INSIDE a quoted-STRING VALUE (`url: "http://x@{var}/y"`) — builds an `Interp` template (P1). Regex-free (char-scan), STRICT `@{ident}` (nested `@{a-@{b}}` stays partial/literal) | The maintained grammar emits `"…@{…}…"` as ONE opaque `singleStr`/`doubleStr` leaf; the §3.3 `Quoted` grammar split touches the SHARED css `Quoted` the legacy BuilderHost re-tokenizes via `INTERPOLATION_REGEX`/`_buildStringInterpolation` → bridge break, so structuring at the grammar is deferred. Done at the DIRECT host instead (does NOT touch grammar or bridge → bridge byte-identity unaffected by construction; the direct-host oracle now resolves flat string interp) | Same §3.3 `Quoted` grammar split as TB-4 (reorg A4); then consume the structured `Interp` child instead of re-scanning the leaf bytes |

**Landed Tier-B shapes** (not deferred): shape 1 — generic at-rule prelude (regex-free +
`@keyframes @{n}` early-termination bugfix, validated vs real less.js 4.x); shape 2 —
custom-prop VALUE (`@{…}` isolated in grammar + leaf-consumed via `interpFromRegion`);
shape 3 — bare-`@var` at-rule prelude GRACEFUL RECOVERY (`buildGenericBlock`
`isCleanRefToken`): a top-level bare `@var` prelude is a v5 HARD parse error (commit
63663e900), but the malformed-prelude recovery used to synthesize a `VarRef` from the
whole opaque scan region → `variable @… is undefined` at eval (6 differential-oracle
THREW: `container`, `import-reference`, `layer`, `media`, `variables-in-at-rules`,
`permissive-parse`). It now emits the malformed region VERBATIM (parse error already
recorded), so those render (THREW→DIFF) — the DIFF from the 4.x-style golden is the
intended v5 divergence (bare `@var` in a prelude does not resolve; migrate to `@{var}`).

**Pre-existing, NOT introduced by Tier-B interpolation work:**
`core/ast/parse-host/actions/mixins-def.ts` `TODO(tier-b)` — a multi-token space-list mixin
default (`thin dotted`) is not assembled into a `List` (the §3.5 list value-assembly shape,
host value-assembly workstream). Not an interpolation shape, not a regex. Left as-is.
