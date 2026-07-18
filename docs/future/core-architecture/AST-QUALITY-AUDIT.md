# `ast/` Exhaustive Quality Audit + Burn-Down

Synthesis of 36 per-file reviews (one reviewer per file) plus 5 cross-file coherence lenses.

- **Total findings: 375** (327 per-file + 48 coherence).
- Scope: `packages/core/src/ast/**` (35 real files + 1 non-existent path) plus one out-of-tree layering finding in `packages/core/src/jess-error.ts`.
- Intended-design framing per `TREE2-CONSTITUTION.md`: **P0** parser-owns-structure (core never re-derives structure from bytes), **P1** delete-bridge, **P2** no-verbatim-port, **P3** real-names (kill `tree2`), **P4** DRY, **P5** complexity-gate, **P6** byte-identity floor.

**Collision warning:** `serialize.ts`, the value engine (`value-*.ts`, `evaluator.ts`, `serialize-value.ts`, `literal-tag.ts`), and `parse-host/**` are under active benchmark/value-path work. Every item touching those MUST sequence *after* the in-flight edits land. Docs/rename-only edits are safe anytime. Marked per-item below.

---

## 1. Per-file verdict table

Verdict legend: **clean** (nothing structural) · **trim** (rename + local cleanups) · **decompose** (split into modules) · **rewrite** (approach is wrong; parser gap or dead file).

| # | File | LOC | Findings | Verdict | One-line |
|---|------|-----|----------|---------|----------|
| 1 | `serialize.ts` | 1882 | 18 | **decompose** | 6–9 subsystems fused; split scope/value-fold/selector-compose/emit-flat/emit-nested/emit-atrule; composeStats is test-only. |
| 2 | `extend.ts` | 1066 | 13 | **decompose** | 6 concerns + a private selector IR that shadows/forks `nodes.ts` + re-implements serialize.ts compose. |
| 3 | `nodes.ts` | 563 | 12 | **decompose** | types + factories + mutating memo cache on "plain-data" nodes; split into types/factories/selector-canonical. |
| 4 | `node.ts` | 102 | 11 | **trim** | 3 hand-maintained parallel type lists (no exhaustiveness gate); t2 remnants; `renderCombinator` misplaced. |
| 5 | `index.ts` | 61 | 8 | **rewrite** | Barrel has ZERO importers; either delete or make consumers actually use it. |
| 6 | `literal-tag.ts` | 204 | 10 | **trim** | dead `makeDimension` import, vestigial `escaped`, `parseHex` dup of tree/color.ts, enum gap. |
| 7 | `value-eval.ts` | 193 | 7 | **trim** | phantom `unitMode:'canonicalize'` diverges from canonical `UnitMode`; 37-line stale header. |
| 8 | `value-operate.ts` | 238 | 16 | **decompose** | `typeCheck` belongs elsewhere; calc regex byte-rederivation; exceptions-as-branching; dead `calcInner` export. |
| 9 | `value-factory.ts` | 124 | 10 | **trim** | 4 dead exports (`unitOf`/`makeBool`/`makeNil`/`makeList`); double-alloc spread idiom ×5. |
| 10 | `serialize-value.ts` | 211 | 12 | **decompose** | 75 lines of colorspace math + duplicated `round`; speculative `OutputMode`/Compressed hook. |
| 11 | `value-units.ts` | 46 | 6 | **trim** | phantom-consumer header; case-sensitive unit lookup risk; recomputed divisor. |
| 12 | `value-dispatch.ts` | 75 | 3 | **trim** | register/lookup case asymmetry (silent miss); has+dispatch double lookup; bind() alloc. |
| 13 | `evaluator.ts` | 58 | 7 | **trim** | `verbatimArgs` dup of serializeValue join; unknown-fn reconstructs bytes; dead `_modes`. |
| 14 | `mixin-dispatch.ts` | 200 | 6 | **trim** | redundant `filledByName` Set; `CallArg` circular type; space-join drops arg separators. |
| 15 | `guard.ts` | 103 | 7 | **trim** | ⚠ behavior: byte-truthiness `.bytes.trim()==='true'`; eager (non-short-circuit) and/or; misplaced `ValueResolver`. |
| 16 | `at-rule.ts` | 52 | 4 | **trim** | t2/legacy-tree doc remnants; 26-line comment for 25 lines of code. |
| 17 | `color-names.ts` | 33 | 4 | **trim** | byte-identical dup of tree/util/color-names.ts; unify via boundary-safe re-export. |
| 18 | `functions/types.ts` | 72 | 4 | **trim** | inert required `params` on VariadicSpec; over-exported member interfaces; 40/72 lines JSDoc. |
| 19 | `parse-host/import.ts` | 405 | 11 | **decompose** | 6 concerns incl. a whole cross-file literal-var evaluator; `t2` alias; colliding `isNode`; harness-only. |
| 20 | `parse-host/host-context.ts` | 287 | 13 | **decompose** | grab-bag of 6 concerns; `declParts` byte-splits declarations (P0); `__t2*` brand fields; trivia dup. |
| 21 | `parse-host/dispatch-host.ts` | 148 | 20 | **trim** | mostly t2 remnants + unknown-then-cast ceremony; hand-redeclared parseman result type; dead `fields`. |
| 22 | `parse-host/actions/index.ts` | 53 | 5 | **trim** | dead `export *` barrel re-export; duplicated "add a family" prose; t2/bridge framing. |
| 23 | `parse-host/actions/value-expr.ts` | 219 | 10 | **trim** | t2 alias; `parenBounds`/`betweenBytes` byte-rederivation of parens; comma-list collapsed to `word(bytes)`. |
| 24 | `parse-host/actions/value-leaf.ts` | 102 | 14 | **trim** | t2-heavy; speculative `tagOf` callback (all 4 sites constant); `leafValue` dup ×5. |
| 25 | `parse-host/actions/comments.ts` | 211 | 9 | **rewrite** | `scanTrailingBlockComments` hand-rolls a byte tokenizer (P0); needs dispatch-host trivia fix. |
| 26 | `parse-host/actions/mixins-def.ts` | 196 | 11 | **trim** | t2 alias ×13; `namedArgValue`/brace-scan byte-rederivation; cryptic F-codes; returns `unknown`. |
| 27 | `parse-host/actions/mixin-call.ts` | 0 | 1 | **n/a** | File does not exist; prospective only. Nothing to review — real dispatch lives in `mixin-dispatch.ts`. |
| 28 | `parse-host/actions/selector.ts` | 166 | 8 | **trim** | t2 alias ×25 + `__t2extend`; segment→complex/compound dup; `as Combinator` weak casts. |
| 29 | `parse-host/actions/selector-interp.ts` | 37 | 6 | **trim** | t2 alias; bridge-anchored doc; dead `unquote` param path. |
| 30 | `parse-host/actions/custom-props.ts` | 165 | 15 | **rewrite** | `@{}` regex (P0 keystone), `interpFromString` dup, `!important`/merge/`;` byte-scans; needs grammar structure. |
| 31 | `parse-host/actions/at-rules.ts` | 126 | 8 | **rewrite** | 3 prelude byte-regexes (P0); dup `interpFromString`; ships misparse for `@media @{q}` — needs Tier-B grammar. |
| 32 | `parse-host/actions/extend.ts` | 108 | 6 | **trim** | `ALL_FLAG` regex + src.slice re-derives `all`/`!all` (P0); t2 alias + `__t2extendTarget`; bridge doc. |
| 33 | `parse-host/actions/interp.ts` | 92 | 5 | **trim** | t2 alias; `Leaf`/`isLeaf` dup ×5 (hoist to host-context); bridge-anchored doc. |
| 34 | `parse-host/actions/charset.ts` | 86 | 8 | **trim** | misnamed (models whole statement-form family); `@import` byte-slice fallback (P0); `leafSpan` dup of `rawSpan`. |
| 35 | `parse-host/actions/variables.ts` | 68 | 12 | **trim** | t2 alias-heavy; `declParts` byte-split + `@`-sigil re-strip (P0); `as ValueNode` unchecked downcast. |
| 36 | `parse-host/actions/ruleset.ts` | 66 | 7 | **trim** | t2 alias + `__t2extend`; `selectorText` byte-slice fallback (P0); redundant `as Statement[]` casts. |

**Cross-cutting layering (out of `ast/`):** `packages/core/src/jess-error.ts` (939 LOC, 4 coherence findings) — **decompose/relayer**: hand-rolls OSC-8 hyperlinks + a chalk code-frame renderer that duplicate `linecraft` (already a `packages/jess` dep); core exports terminal-escape helpers to the CLI (inverted layering). Dead `toString()` renderer with no src caller.

---

## 2. Ranked burn-down (highest value first, grouped by theme)

Columns: **file:line** · **action** · **size** · **behavior-risk** · **collides w/ in-flight** · **mechanical vs owner-call**.

### (a) Rule violations — `as any` / unchecked `any`-adjacent downcasts
The repo forbids `as any`; none found spelled literally. These are the nearest violations (unchecked structural downcasts / byte-derived `any`-shaped reads) — treat as the hard-rule tier.

| file:line | action | size | risk | collides | call |
|---|---|---|---|---|---|
| `host-context.ts:176` | `declParts` re-derives declaration STRUCTURE from bytes (strip `;`, split on first `:`) — P0 keystone violation | L | med (name/value split) | ✅ parse-host | owner (needs parser child spans) |
| `variables.ts:45` | `node as t2.ValueNode` unchecked downcast from base `Node` (no guard) | M | med | ✅ parse-host | mechanical (type `wholeValueNode` → `ValueNode\|null`) |
| `custom-props.ts:85` (`any-violation`) | `@{}` decl name/value split from bytes | M | med | ✅ parse-host | owner (grammar) |
| `value-expr.ts:153` | comma-list paren body discarded → `word(betweenBytes(...))` (structured value collapsed to bytes) | M | med | ✅ parse-host | owner |
| `charset.ts:56` | `@import` prelude `src.slice(kwEnd,semi).trim()` reconstructs structure | M | med | ✅ parse-host | owner (import family) |
| `selector.ts:115` | `text as Combinator` / `' ' as Combinator` weak (Set membership ≠ narrowing) | S | low | ✅ parse-host | mechanical (`readonly Combinator[]` tuple) |

### (b) `tree2` / `t2` elimination (P3 — declared done, never executed)
The single largest mechanical theme: **170 `t2.X` accesses across 19 source files**, ~89 `tree2` doc mentions, `__t2*` runtime brand fields, stale `../tree2` boundary paths, and a runtime error string.

| file:line | action | size | risk | collides | call |
|---|---|---|---|---|---|
| **all `parse-host/**` + engine files** | `import * as t2` → `import * as ast`; rewrite every `t2.` → `ast.` (word-boundary safe) | L | none | ✅ (touches parse-host/serialize) | mechanical |
| `host-context.ts:154/243/258` (+ readers selector.ts:108, extend.ts:85, ruleset.ts:52) | rename brand fields `__t2ph`→`__ph`, `__t2extend`→`__extend`, `__t2extendTarget`→`__extendTarget` (+ `in` guards) | S | none | ✅ | mechanical |
| `host-context.ts:201` | fix runtime error string `'tree2-host: unrecognized selector shape'` → `'ast-host: ...'` | S | none | ✅ | mechanical |
| **all headers/JSDoc** (index/node/nodes/value-eval/serialize-value/value-operate/value-units/value-factory/color-names/at-rule/host-context/dispatch-host/import + actions/README) | `tree2`→`ast`; drop `../tree2`, `bridge`, `POC`, `front-end`, `legacy renderer`, `adapter`, `head-to-head harness` framing | L | none | doc-only (safe anytime) | mechanical |
| `nodes.ts:522` | migrate `concat` callers (at-rules.ts:111, bridge.ts:281) to `sequence`, delete alias | S | none | ✅ | mechanical |
| `literal-tag.ts:39` | delete `Num=1` alias once bridge test drops it; scrub `tree2-frontend` ref | S | none | ✅ | owner (test dep) |

### (c) Reinvented deps + inverted layering (linecraft, chalk)
| file:line | action | size | risk | collides | call |
|---|---|---|---|---|---|
| `jess-error.ts:627` | delete `toString()` code-frame renderer + `codeFrame*`/`buildLineStarts`/`getLine` — dead, dup of linecraft `CodeDebug`; no src caller | L | low (dead) | ⚠ error path | owner |
| `jess-error.ts:371` | delete `osc8`/`oscLink`/`supportsLinks`/`linkFor`; CLI calls linecraft `fileLink()` instead of importing `oscLink` from core | M | low | ⚠ CLI import | owner (fix inverted layer) |
| `jess-error.ts:3` | drop `chalk` import from core once renderer gone | S | none | ⚠ | mechanical (after above) |
| `jess-error.ts:405` | remove `trail`/`prettyLabel` path-shortening (CodeDebug/baseDir owns it) | S | none | ⚠ | owner |

### (d) One-problem-N-solutions canonicalizations (P4 DRY)
| concern | sites | action | size | collides | call |
|---|---|---|---|---|---|
| `@{...}` → `Interp` built **3 ways** | `interp.ts:47` (correct, structural) vs `at-rules.ts:72` + `custom-props.ts:46` (byte regex) | route all through `interpFromLeaves`; delete both `interpFromString` regex copies | M | ✅ parse-host | owner (grammar gap) |
| Selector composition engine **twice** | `serialize.ts:648–711` vs `extend.ts:147` (`parentToken`/`composeOne`/`compose`) — **already divergent** (`:is()` wrap vs bare join) | one selector-compose module over one representation | L | ✅ serialize | owner |
| Private selector IR shadows `nodes.ts` | `extend.ts:44` (`Simple`/`Compound` collide with nodes.ts exports) | fold into node model or share; at minimum rename to kill collision | L | — | owner |
| Selector→text serialized twice | `nodes.ts:217/267` vs `extend.ts:68/73/79` (`branchText` etc., verbatim leading-combinator trim) | shared renderer parameterized over segment source | M | ✅ | owner |
| list/args separator→glue map (`,`→`, `, `/`→` / `) **×4** | `serialize-value.ts:207`, `evaluator.ts:22`, `serialize.ts:612`, `serialize.ts:1211` | single `sepGlue(sep)` in value domain | S | ✅ | mechanical |
| Dimension bytes rule **diverges** across 3 build sites | `serialize.ts:418/449` (raw), `literal-tag.ts:113/146` (verbatim), `serialize-value.ts:130` (rounded) | funnel through `makeDimension`/`dimensionFromParse`; one home decides raw-vs-rounded | M | ✅ | owner (byte-identity risk) |
| Inline value-object literals bypass factory | `serialize.ts:394/401/620`, `literal-tag.ts:124/162` (Keyword/List/Quoted) | use `makeKeyword`/`makeList`/`makeQuoted` (add verbatim-bytes overload) | M | ✅ | mechanical |
| Quoted detect/strip/wrap **×5** | `serialize.ts:516`, `literal-tag.ts:117/124`, `value-leaf.ts:86`, `serialize-value.ts:191`, `evaluator.ts:32` | tiny quoted-string util (`isQuoted`/`unquoteOne`/`quoteWrap`/`innerText`) | S | ✅ | mechanical |
| `declParts` `;`-strip + `:`-split | `host-context.ts:178` + `custom-props.ts:86` | one shared helper (until parser owns spans) | S | ✅ | mechanical |
| `Leaf`/`isLeaf` parseman-leaf primitive **×5** | `interp.ts:22/28`, `charset.ts:32`, `value-expr.ts:50`, `value-leaf.ts:40`, `serialize.ts:795` | hoist one to `host-context.ts` | M | ✅ | mechanical |
| `rawSpan`/`leafSpan`/inline `{span?}` cast | `host-context.ts:24` vs `charset.ts:42`, comments.ts:166, value-leaf.ts, interp.ts:90 | import `rawSpan` everywhere | S | ✅ | mechanical |
| `round()` duplicated | `serialize-value.ts:34` vs `tree/util/round.ts` | delete copy; both import shared leaf util | M | ✅ | owner (boundary) |
| `parseHex`/`namedColor`/hsl-rgb kernels dup tree/ | `literal-tag.ts:90`, `color-names.ts:28`, `serialize-value.ts:52/75` | collapse when tree/ deleted (P1); track as twins | L | — | owner (post-P1) |
| 3 parallel type lists, no exhaustiveness gate | `node.ts:47/68/85` | `NodeType = Node['type']` + `satisfies Record<NodeType,true>` | M | doc/type | mechanical |
| trivia classification dup | `host-context.ts:52` vs css-parser CST builder | shared trivia accessor or typed trivia records | M | ✅ | owner |
| `Span`/`CommentRange`/inline `{start,end}` — 3 names | `host-context.ts:18/62/91` | reuse `Span`; delete others | S | ✅ | mechanical |
| colliding `isNode` (two semantics, one `ast` surface) | `import.ts:66` vs `node.ts:95` | rename raw-node one → `isRawNode`/`nodeType`→`rawNodeType` | M | ✅ | mechanical |
| color-channel derivation split | `serialize-value.ts` vs `value-factory.ts` | consolidate into `ast/color.ts` | M | ✅ | owner |

### (e) Ugly / byte-rederivation regexes (P0 keystone — highest correctness stakes)
Parser already isolates this structure; core re-tokenizing it from bytes is both a P0 violation and, for the at-rule/custom-prop preludes, **ships incorrect behavior today** (`@media @{q}` misparses).

| file:line | action | size | risk | collides | call |
|---|---|---|---|---|---|
| `at-rules.ts:95` `parsePreludeValue` | 3 regexes (`@@`, `@{`, `@name`) re-tokenize prelude — **misparses interpolated preludes** | L | **HIGH (wrong output)** | ✅ | owner (Tier-B grammar) |
| `custom-props.ts:47` `@{...}` regex | re-tokenizes custom-prop interpolation | L | **HIGH** | ✅ | owner (grammar) |
| `comments.ts:136` `scanTrailingBlockComments` | hand-rolled byte tokenizer for trailing comments (author's own TODO) | M | med | ✅ | owner (dispatch-host trivia) |
| `host-context.ts:91` `rulesetBodyWindow` | brace-hunt to reconstruct body span | M | med | ✅ | owner |
| `at-rules.ts:62` `atRuleHead` | naive `indexOf('{')` mis-splits `{` inside quoted prelude | M | med | ✅ | owner |
| `value-expr.ts:114` `parenBounds`/`betweenBytes` | re-scan for `(`/`)`, slice paren body | L | med | ✅ | owner |
| `mixins-def.ts:119/179` | `namedArgValue` byte-slice + brace-scan for def-vs-call | M | med | ✅ | owner |
| `custom-props.ts:143/67` | `!important` / merge `+`/`+_` detected by byte-scan | M | med | ✅ | owner |
| `extend.ts:43` `ALL_FLAG` | `all`/`!all` re-derived from bytes | M | low | ✅ | owner |
| `charset.ts:56` / `variables.ts:42` / `ruleset.ts:27` | src.slice fallbacks for import/decl/selector | M | med | ✅ | owner |
| `value-operate.ts:113` `CALC_WRAP_RE` | greedy `[\s\S]*` calc unwrap — **justified** (synthetic bytes, no parse origin) | L | low | ✅ | keep (document) |
| `literal-tag.ts:86/94`, `serialize.ts:761`, `value-operate.ts:113` | **justified** synthetic-string regexes — keep | S | none | — | keep |
| `literal-tag.ts:191`, `custom-props.ts:141`, `serialize.ts:1289`, `import.ts:290` | trivial: `trimStart`/`trimEnd`/redundant ident guard/dead `flags` | S | low (`import.ts:290` = dead `(css)` flag never honored) | — | mechanical |

### (f) Monster-file decompositions (P5) — sequence carefully
| file | action | size | collides | call |
|---|---|---|---|---|
| `serialize.ts` (1882) | split → `scope.ts` / `value-fold.ts` / `selector-compose.ts` / `mixin-expand.ts` / `emit-flat.ts` / `emit-nested.ts` / `emit-atrule.ts`; thin orchestrator remains | L | ✅ **MUST land after benchmark/value-path edits** | owner |
| `extend.ts` (1066) | split → `extend/{selector-ir,match,plan,solve,nested,compact,index}.ts` | L | — (but shares compose w/ serialize) | owner |
| `nodes.ts` (563) | split → `nodes/{types,factories,selector-canonical}.ts`; move mutating memo cache out of "plain-data" nodes | L | ✅ | owner |
| `host-context.ts` (287) | split → `spans.ts` / `trivia.ts` / `extend-markers.ts`; keep only BuildContext contract | L | ✅ | owner |
| `import.ts` (405) | split → `import/{specifier,var-scope,flags,resolve}.ts`; rename raw-node helpers | L | ✅ (harness-only today) | owner |
| `value-operate.ts` (238) | move `typeCheck` → predicates/functions module; keep operate/compare | M | ✅ | owner |
| `serialize-value.ts` (211) | move colorspace math → `ast/color.ts` | L | ✅ | owner |
| `ast/` root layout | group into `value/`, `emit/`, `extend/` subfolders (mirror the exemplary `parse-host/actions/`) | L | ✅ | owner |
| `serialize.ts:1803` `composeStats` | move to `__tests__/compose-stats.ts` — 80 lines of test-only parallel-walk instrumentation in the prod serializer | M | ✅ | owner |

### (g) Dead code
| file:line | action | size | call |
|---|---|---|---|
| `index.ts` (whole) | delete barrel — **zero importers** (or redirect value.ts through it) | S | owner |
| `value-factory.ts:25/117/119/121` | delete `unitOf`/`makeBool`/`makeNil`/`makeList` (no callers) | S | mechanical (confirm no pending fns caller) |
| `literal-tag.ts:19` | delete unused `makeDimension` import | S | mechanical |
| `literal-tag.ts:79` | `LIT_ALREADY_MINIMAL` reserved/unused — owner-sanctioned; keep only if reservation is load-bearing | S | owner |
| `value-operate.ts:125` | `calcInner` export unused externally → module-private | S | mechanical |
| `host-context.ts:161/227` | delete `isPlaceholder` (0 callers) + host-context copy of `isRawArgList` (dup of mixins-def) | S | mechanical |
| `nodes.ts:237` | `compoundHasAmpersand` exported, no external caller → module-local | S | mechanical |
| `evaluator.ts:51/54` | drop dead `_modes` param from compare/typeCheck interface slots | S | mechanical |
| `serialize-value.ts:52/204` | `hslToRgb` needless export; `v.bytes ?? ''` (Nil.bytes non-optional) | S | mechanical |
| `dispatch-host.ts:75` | `fields` param never forwarded | S | mechanical |
| `comments.ts:182` | `Math.max(span.end, src.length)` is a no-op | S | mechanical |
| `import.ts:316` + helpers | `resolveImportStatements`/`isNode`/`nodeType` — only test caller (harness scaffolding) | M | owner |
| `mixin-dispatch.ts:69` | redundant `filledByName` Set ≡ `named` | S | mechanical |
| `actions/index.ts:24` | dead `export *` barrel re-export (0 importers) | S | mechanical |

### (h) Bloat / over-abstraction / speculative machinery
| file:line | action | size | call |
|---|---|---|---|
| `serialize-value.ts:28` | delete `OutputMode`/`mode` param + Compressed hook (threaded, `void`-ed ×2, never branches) — YAGNI until compress lands | M | owner |
| `value-eval.ts:53` | measure-or-document the eager `bytes` cache on every ValueObj (duplicates `serializeValue`, ignores OutputMode) | M | owner |
| `nodes.ts:208` | mutable `_canon`/`_hasInterp`/`_hasAmp` memo on plain-data interfaces — move to WeakMap in serialize.ts or prove the win | L | owner |
| `serialize.ts:467` | delete `!e.ev` no-evaluator fallback branches (permanent-fallback shape forbidden) unless a real no-eval caller exists | M | owner |
| `serialize.ts:1347/1647/1750` | extract `withRewind(e, fn)` — snapshot/rewind idiom hand-duplicated ×3 | M | owner (after decompose) |
| `serialize.ts:1595` / `:1346` | unify `emitNestedLeaf`≈`emitLeaf` and `emitNestedAtRuleBlock`≈`emitAtRuleBlock` (near-verbatim dups) | M | owner |
| `value-leaf.ts:48` | drop speculative `tagOf:(bytes)=>...` callback — all 4 sites return a constant | S | mechanical |
| `functions/types.ts:64` | make `params` optional (inert on VariadicSpec); un-export member interfaces | S | mechanical |
| `value-factory.ts:63` | mutate-in-place instead of build-then-spread (halves allocs) ×5 | S | mechanical (measure) |
| `value-dispatch.ts:60` | fix register/lookup case asymmetry (silent miss); fold has+dispatch into one `lookup` | S | mechanical (⚠ silent-miss risk) |
| `extend.ts:578` | remove `let prefilterEnabled` global + exported test-only setter | S | owner |
| `extend.ts:657` | `runFixpoint`/`applyInstruction` re-serialize whole list every round — track change via boolean | M | owner |
| `at-rule.ts` / `variables.ts` / `functions/types.ts` headers | trim oversized JSDoc (40–50% of file) | S | mechanical |

---

## 3. Execution order (batched to avoid stomping; respects serialize.ts / value / parse-host collisions)

**Guiding rule:** the benchmark/value-path work owns `serialize.ts`, the value engine, and `parse-host/**`. Anything touching those waits for a green landing signal. Batch by file so no two agents edit the same file. One agent per file (or per tight file-group) per wave.

### Wave 0 — Doc-only, zero-collision (safe **now**, parallel, any number of agents)
- Sweep `tree2`→`ast` / `T2`→`AST` in **all headers & JSDoc** across `ast/**` + `parse-host/actions/README.md`. Doc bytes only — cannot collide with logic edits. (theme b, doc subset)
- Trim oversized JSDoc: `at-rule.ts`, `functions/types.ts`, `variables.ts`, `node.ts:75`.
- Correct stale claims: `node.ts:75` "frozen", `value-units.ts:3` phantom consumers, `literal-tag.ts:72` "0-6"/`Quoted=7", `value-operate.ts:175` EPSILON comment.

### Wave 1 — Out-of-tree layering (no `ast/` file touched; parallel with Wave 0)
- `jess-error.ts` relayer: delete `toString()` renderer + frame helpers, delete OSC-8 helpers, repoint `packages/jess/src/diagnostics.ts` to linecraft `fileLink()`/`CodeDebug`, drop `chalk` import. Single agent (touches core + jess). (theme c)

### Wave 2 — Pure dead-code deletion (mechanical, one agent per file, after confirming no pending fns caller)
Independent files, run in parallel:
- `value-factory.ts` (4 dead exports + alloc idiom), `literal-tag.ts` (dead import), `value-operate.ts` (un-export `calcInner`), `nodes.ts` (`compoundHasAmpersand` local), `evaluator.ts` (`_modes`), `serialize-value.ts` (dead exports/`?? ''`), `dispatch-host.ts` (`fields`), `comments.ts` (`Math.max` no-op), `mixin-dispatch.ts` (`filledByName`), `actions/index.ts` (dead barrel).
- `index.ts`: **owner decision** — delete barrel vs. wire consumers through it. Blocks nothing; do first if deleting.
- `host-context.ts` dead `isPlaceholder`/`isRawArgList` — defer into Wave 5 (same file as decompose).

### Wave 3 — `t2`→`ast` identifier rename (the 170-access mechanical sweep)
**Must run as ONE coordinated batch** (word-boundary `t2.`→`ast.` + import rename) because it spans 19 files and any parallel logic edit in those files would conflict. Do it as a single atomic commit across `parse-host/**` + engine files, plus `__t2*` brand-field rename (host-context defs + 3 readers) and the `host-context.ts:201` error string. **Sequence after Wave 2** (fewer symbols to touch) and **before** the decomposition waves (so splits start from clean names). Coordinate with benchmark owners — this touches serialize.ts and parse-host.

### Wave 4 — Local canonicalizations that DON'T restructure files (after Wave 3, coordinate on shared touch-points)
Group so each agent owns disjoint files:
- **Value-domain group** (one agent): `sepGlue` helper, quoted-string util, inline-literal→factory, dimension-bytes home, `round` dedup — spans `serialize.ts` + `serialize-value.ts` + `value-factory.ts` + `literal-tag.ts` + `evaluator.ts`. High collision with benchmark work → **gate on value-path landing**.
- **parse-host leaf/span group** (one agent): hoist `Leaf`/`isLeaf` + `rawSpan` + `Span` unification to host-context; rename colliding `isNode`. Spans host-context + all actions → **gate on parse-host landing**, run before Wave 5 host-context split.
- **node type-list gate** (one agent): `node.ts` exhaustiveness (`NodeType = Node['type']` + `satisfies`). Isolated.
- `color-names.ts` / `value-units.ts` / `value-dispatch.ts` / `functions/types.ts`: independent trims, parallel.

### Wave 5 — Behavior fixes (need tests + byte-identity gate; owner-reviewed)
- `guard.ts`: byte-truthiness → typed `Bool.value`/`Keyword.text`; short-circuit `and`/`or`; move `ValueResolver` out. ⚠ semantics change — gate on guard tests.
- `value-eval.ts:160`: replace phantom `unitMode:'canonicalize'` with canonical `UnitMode` import. ⚠ mode-flow correctness.
- `value-dispatch.ts:60`: fix register/lookup case asymmetry (silent-miss bug).
- `import.ts:290`: honor or delete the `(css)` flag (currently never honored).

### Wave 6 — Parser-gap / P0 byte-rederivation (biggest correctness wins; **owner + grammar work**, sequence LAST)
These require grammar changes in the parser layer + re-consumption in `ast/`; several **ship incorrect output today**. Do after parse-host stabilizes. Suggested order by risk:
1. **at-rule prelude structure** (`at-rules.ts` 3 regexes — fixes `@media @{q}` misparse) + **custom-prop interpolation** (`custom-props.ts` `@{}`), canonicalizing all `@{}` builders onto `interpFromLeaves`. (Tier-B grammar spec already exists.)
2. Declaration name/value spans → retire `declParts` byte-split (`host-context.ts`, `variables.ts`, `custom-props.ts`).
3. Trailing-comment trivia threading → delete `scanTrailingBlockComments` (`comments.ts` + dispatch-host).
4. Structured parens/mixin-def/extend-flag/import/selector fallbacks (`value-expr.ts`, `mixins-def.ts`, `extend.ts`, `charset.ts`, `ruleset.ts`).

### Wave 7 — Monster-file decompositions (last; each is a single-file-owning agent, serialized against benchmark work)
Order by collision-safety:
1. `extend.ts` → `extend/` subfolder (shares compose logic w/ serialize but is otherwise isolated; do the shared selector-compose extraction here jointly).
2. `nodes.ts` → `nodes/{types,factories,selector-canonical}.ts`.
3. `host-context.ts` → `spans/trivia/extend-markers` (after Wave 4 leaf/span group).
4. `import.ts` → `import/` subfolder.
5. `serialize.ts` → 7-module split + move `composeStats` to `__tests__/`. **HARD GATE: only after all benchmark/value-path edits land.** This is the highest-collision file in the tree.
6. `value-operate.ts` (`typeCheck` out) + `serialize-value.ts` (color math out) + top-level `value/`/`emit/`/`extend/` folder grouping.

**Between every wave:** rebuild `@jesscss/core` `lib/`, run the parse-host per-family byte-identity suites + `all-less`, and gate on byte-identity (P6). No wave lands red.

---

## Appendix — finding tally

| Theme | Count (approx) |
|---|---|
| t2/tree2 remnants (a+brand+doc) | ~110 |
| byte-rederivation / ugly regex (P0) | ~30 |
| DRY canonicalizations | ~25 |
| dead code | ~20 |
| bloat / over-abstraction | ~35 |
| weird-shape / casts | ~40 |
| incoherence (cross-file) | ~30 |
| reinvented-dep / layering | ~10 |
| decomposition (monster files) | 9 files |
| **Per-file findings** | **327** |
| **Coherence-lens findings** | **48** |
| **TOTAL** | **375** |
