# tree2 Demolition — Ranked Remaining-Debt Kill-List

> **Historical audit evidence — not a current work queue.** This sweep uses a
> retired tree2/bridge framing. Its individual observations require fresh
> validation before use; do not infer a host, bridge, or alternate parser path
> from it. The current public architecture is direct dialect `parse() ->
> Stylesheet` construction.

> **Provenance.** Produced by a 17-agent adversarial review of the CURRENT `packages/core/src/ast/`
> engine (2026-07-16): 8 read-only per-module museum-bar reviewers → 8 independent verifiers
> (every finding re-checked against actual code + parser, SUSPECT-WRONG flips recorded) → 1 synthesis
> pass. 74 verified findings across 8 modules. This is the durable record of that sweep; the ephemeral
> workflow output was `wxk9btmgm` / run `wf_9a0c2f40-329`.

Synthesized against `TREE2-CONSTITUTION.md` (P0 parser-owns-structure → P1 delete-bridge → P2 no-verbatim-port → P3 real-names → P4 DRY → P5 complexity-gate → P6 byte-identity-floor). Ordering follows the owner mandate: **P0 byte-re-derivation → dead code → DRY → smell**, with the clean REJECT list at the end (do not touch).

Every item below is drawn from a CONFIRMED or PLAUSIBLE finding; SUSPECT-WRONG/REJECTED entries are quarantined in the last section.

---

## TIER 0 — P0 byte-re-derivation, structure available NOW (do first)

These re-scan bytes to rebuild structure the parser already emits as a consumable field. The keystone violations. No grammar work needed — the delete is unblocked today.

| # | Site | Action | Parser structure that replaces it | Size | Risk |
|---|------|--------|-----------------------------------|------|------|
| 0.1 | `parse-host/host-context.ts:163` (`declParts`) + `actions/variables.ts:44` (charCode `0x40` strip) | **re-derive-from-parser** | `VarDeclaration` name = `lessVar` leaf `children[0]` (`grammar.ts:128-133`), bare name = `leaf.value.slice(1)`; value already taken via `wholeValueNode`. No parser gap. | ~15 LOC | Low — structure present, `declParts`' only other live consumer is the already-dead `declaration-static` (see 1.5) |
| 0.2 | `actions/custom-props.ts:145` merge marker via `namePart.endsWith('+_')/'+'` (L143-144) | **re-derive-from-parser** | Declaration production isolates the optional `+_`/`+` **merge leaf** as a structured child (`grammar.ts:442`). | ~5 LOC | Low |
| 0.3 | `actions/custom-props.ts:145` + `:67` (`stripImportantBytes`) `!important` regex | **re-derive-from-parser (gated on a 1-line grammar wrap)** | `important = sequence('!','important')` is matched positionally at `grammar.ts:107/442`. **Verifier conflict:** one pass says it surfaces as a child, another says it is a bare literal sequence NOT wrapped in `node('Important',…)` so no consumable field exists yet. **Resolve before deleting**: confirm/add the `node('Important',…)` wrap, then read the child. | ~8 LOC + maybe 1 grammar line | Medium — the regex `$`-anchor is not as fragile as first flagged (quoted values end in `"`), so no urgency; do the merge marker (0.2) now, gate `important` on confirming the node |
| 0.4 | `value-operate.ts:113` `CALC_WRAP_RE` + `:139` Guard 1 `calcInner` | **re-derive-from-parser (authored calc only)** | `calc(...)` is a `FunctionCall{name:'calc', args:[Operation…]}` (`grammar.ts:766`, math tree `calcProduct/calcSum`). Detect `kind===FunctionCall && name.toLowerCase()==='calc'` at `serialize.ts` Operation-eval (L357-370) and splice `args` bytes **before** it collapses to a keyword. | ~30 LOC across two guards | Medium — **partial delete only**: the computed preserve-mode unit-clash fallback (`value-operate.ts:166`) has no parser node; that string path stays until a structured-calc value kind exists. Same root cause for both L113 and L139 — fix once. Note the retiring adapter `parse-host/value-eval.ts:216-219` shares the regex, so it self-drops with task #10. |

**Ordering/collision:** 0.4 edits `serialize.ts` Operation-eval — coordinate with the `serialize.ts` cluster in Tier 1/3. 0.1–0.3 are `parse-host/` local and independent.

---

## TIER 0b — P0 byte-re-derivation, GATED on grammar/parser work (keep as interim, do NOT delete standalone)

The smell is real (the banned regex class ships), but the structured field does **not exist yet**. These are gap-not-laziness. Each is unblocked by a specific parser task; deleting now would be a correctness regression. Listed so they are tracked, not lost.

| Site | Interim code | Unblocked by |
|------|--------------|--------------|
| `actions/custom-props.ts:47` + `:46` `@{}` tokenizer `/@\{\s*([^}]+?)\s*\}/g` | `interpFromString` re-tokenizes `@{}` | **Task #6** — grammar emits structured `Interp` leaf for custom-prop names/values (currently `@`=content, `{base}`=`cpCurly` group, no clean interp leaf) |
| `actions/at-rules.ts:95` (`@@name` L97, `@name` L100), `:73` (`@{}`) | 3 prelude regexes | **TODO(tier-b)** — grammar splits opaque `atPrelude = scanTo(...)` leaf (`grammar.ts:819`) into structured leaves |
| `literal-tag.ts:85/87` `NUM_RE` `dimensionFromString` (+ NaN path) | Re-splits number/unit from bytes | **Finding #1** — make the `Numeric` leaf emit `Kind.Dimension` (value/unit already modeled on `Dimension` class `nodes.ts:48-56`); NaN path vanishes with it. Do NOT add a defensive throw (speculative slowdown). |
| `literal-tag.ts:120` `QUOTE_RE` in `materializeLiteral` | Re-tokenizes quote+inner from `Any`-tagged bytes | **Task #6** — structured `Quoted` leaf carrying `quote + inner value` (grammar `Quoted = string \| Node[]`) |
| `native/list-helper.ts:45/103` `topLevelSplit`/`coerceListItems` split branch | Byte-splits a flattened keyword back into a list | **Task #6/#10** — parse-host builds value-assembly so `@l: a b c` is a real `List` node (today stored as single `t2.word` at `variables.ts:45`) |
| `actions/comments.ts:136` `scanTrailingBlockComments` (charCode `/* */`, `//`) | Hand-tokenizes stylesheet **end-of-source** trivia only | **TODO(A0.2)** — thread end-of-source trivia onto the Stylesheet node in `dispatch-host` (root log drops it; ruleset trailing comments already come from the log) |
| `actions/charset.ts:75` import-prelude byte-slice | Re-slices between keyword-leaf end and `;`-leaf start | Dedicated **import family** consuming the (already structured) `ImportAtRuleStatement` children (`grammar.ts:887-889`) |
| `actions/value-expr.ts:152` comma-list-in-paren `betweenBytes(open,close)` | Source-slices paren body verbatim | A comma-list-in-paren value node (children already present in `args.children`, just discarded) |
| `actions/interp.ts:91` `wholeValueNode` `sliceSpan(...) === valueBytes` | String-compare for whole-value coverage | Threading value-region start/end **offsets** to callers (they pass trimmed strings today) → span-coverage arithmetic |
| `parse-host/import.ts:168` `collectFileVars` **full second parse** per interpolated-import file + literal-only mini-resolver | `parseLessFn(readFileSync(...))` + hand-fold | Drive interpolated-import-path resolution from **engine scope** (`collectVars`/`ScopeFrame`), not a re-parse. Blast radius narrower than flagged — only fires for interpolated `@import "@{x}"` (gated at L342), not plain imports. Bigger refactor (P0+P5). |

---

## TIER 1 — Dead code (delete; no consumer, or superseded at runtime)

| # | Site | Action | Evidence | Size | Risk |
|---|------|--------|----------|------|------|
| 1.1 | `nodes.ts:557` `rawInline` factory | **delete now** | 0 callers anywhere | tiny | None |
| 1.2 | `extend.ts:168` `prefixDescendant` | **delete, inline `cloneBranch(child)`** at call site L160 | Empty `if`-body; wrapper is a pure clone (`cloneSeg`≡`cloneBranch` per-seg) | ~10 LOC | Low |
| 1.3 | `actions/declaration-static.ts` (whole module, `:34`) | **delete module** (drop import+spread from `actions/index.ts`, README mention) | Registers `'Declaration'` before `CUSTOM_PROPS_ACTIONS` which also registers it; dispatch Map is later-wins → never runs. `wholeValueNode`/`declParts` deps stay used elsewhere. | ~40 LOC | Low |
| 1.4 | `parse-host/import.ts:275` `ImportFlags.css` field + `if (flags.css) return true;` in `isCssPassthrough` (L293) | **delete field + branch** | CSS imports diverted to `AtRuleStatement` at parse (`builders.ts:2309/2372`) before `importOptions` built; `type` only ever `'less'`, `css` never written → both arms permanently false | ~5 LOC | Low |
| 1.5 | `parse-host/host-context.ts:111` `args.fields` | **drop from `BuildArgs` (L112) + action-call object (`dispatch-host` L81); KEEP the positional `fields` param in `build()` signature** (parseman passes it positionally before span/rawChildren/triviaLog) | grep: zero reads of `args.fields` across `ast/` | ~5 LOC | Low — must keep positional slot for parseman arg-alignment |
| 1.6 | `serialize.ts:1682` `composeStats` + `ComposeStats` type (`:1667`) | **move to test-only harness module** (out of the hot module) | Exported via `ast/index.ts` but every caller is under `parse-host/__tests__`; re-implements the eval walk purely to count ops → drift risk vs `emit-walk` | ~95 LOC | Low — no shipping importer |
| 1.7 | `nodes.ts:521` lowercase factories `dim`/`mapAccessor`/`detachedCall`/`detachedRuleset`/`mixinCall`/`decl` | **relocate to a test helper** (don't inline `new`) | All callers in `__tests__` (`decl`=1664, `dim`=19, `mixinCall`=8; `mapAccessor`/`detachedCall`/`detachedRuleset` only in the deletion-slated `bridge.ts`) | moderate churn | Low — relocate to avoid 1664-call churn |
| 1.8 | `nodes.ts:47` `Dimension` node class + `dim()` + `serialize.ts:309/340` defensive branches | **delete** | Unreachable in render path — `value-leaf.ts:56` stamps `Numeric` as `Word`+`LiteralTag.Dimension`; no builder emits `Kind.Dimension`; `literal-tag.ts:135` documents it never reaches there | ~30 LOC | Low — **couples with Tier 0b #1**: reintroduced by the measured dense-`Dimension{value,unit}` reshape (`value-leaf.ts:25`). Delete now, rebuild leaner then. |
| 1.9 | `serialize.ts:359` (+ `:287-288`, `:293`, `:499-504`) `!e.ev` no-evaluator lane | **make evaluator a required arg, delete `!e.ev` branches** | Second do-no-math lane reachable only from tests calling `serialize(root)` without an evaluator = the "no permanent eval fallback" shape | ~30 LOC | Deferrable (nothing ships this module yet) but must not survive cutover; if a byte-faithful no-eval mode is genuinely wanted, document it, don't leave it implicit |

**Collision:** 1.6 + 1.9 both edit `serialize.ts`; 1.7 + 1.8 both edit `nodes.ts` — batch each file.

---

## TIER 2 — Dead-but-owner-reserved (KEEP; do not delete)

- `literal-tag.ts:58` `LIT_ALREADY_MINIMAL = 1<<3` — inert today (masked off by `LIT_TAG_MASK 0b111`), but **owner-sanctioned** reserve-the-bit-now per `compress-already-minimal-bit`. Keep.
- `literal-tag.ts:39` `LiteralTag.Num` (`=1`, `@deprecated` alias of `Dimension`) — **delete only WITH the legacy adapter (task #10)**; still live-referenced at `parse-host/value-eval.ts:153`. Not standalone-deletable. Update the JSDoc (it names `bridge.ts`/`tree2-frontend` files that no longer exist).
- `serialize-value.ts:28` `OutputMode.Compressed` param — dead today but **committed compress mode-branch**; keep the enum, at most drop the `void mode` no-ops.

---

## TIER 3 — DRY (P4): collapse to one implementation

| # | Concept | Copies to collapse | Action |
|---|---------|--------------------|--------|
| 3.1 | Value-literal regexes `NUM_RE`/`HEX_RE`/`QUOTE_RE` | `literal-tag.ts:60-62` ≡ `parse-host/value-eval.ts:50-52` (dies w/ adapter) ; `native/color.ts:8` HEX variant ; `poc-dense-value.test.ts:23` (test-local) | Consolidate survivors to one home |
| 3.2 | `HEX_RE` / hex predicate | `native/color.ts:8` vs `literal-tag.ts:61` (already shares `parseHex`) | Export a shared `isHex`, route color.ts through it |
| 3.3 | `interpFromString` (`@{}` tokenizer) | `at-rules.ts:72` ≡ `custom-props.ts:46` (bodies identical, only `/u` flag differs) | Move ONE shared copy beside `interpFromLeaves` in `interp.ts` — **do while the gap persists** (interim code, still DRY it) |
| 3.4 | `clamp` | `serialize-value.ts:47` ≡ `value-factory.ts:36` `clamp01` (byte-identical; value-factory already imports serialize-value) | Export serialize-value's, drop the twin, pick one honest name (`clamp01` is misleading for a 2-arg `[0,max]` clamp) |
| 3.5 | `@`-sigil re-emission | `serialize.ts:316,318,343,345,381` all hardcode `` `@${name}` `` in a nominally dialect-agnostic evaluator (VarRef stores bare name; sigil dropped at parse) | Collapse to one `unresolvedRef(name)→Value` helper. **Separate owner question:** silent `@name` re-emit on resolve-miss may mask a should-throw unresolved-var error — flag, don't decide. (Now settled by `v5-resolve-failure-is-eval-error-unless-optional`: strict miss → throw; delete the re-emit.) |
| 3.6 | `rawSpan` + local `interface Span` | `selector.ts:44` ≡ `extend.ts:48` (each shadows exported `host-context` `Span`, mutable-vs-readonly drift) | Import shared `Span` + one `rawSpan` helper |
| 3.7 | contribs-map construction | `extend.ts:627-630` ≡ `extend.ts:1057-1061` (verbatim) | Extract `buildContribs(instructions)` |
| 3.8 | `AnyNode`/`isNode`/`nodeType` reflection helpers | `import.ts:64-70` ≡ `__tests__/bridge.ts:52-63` (`nodeType`≡`typeOf`) | Hoist to one location (note: `import.ts` is currently consumed ONLY by the bridge reference) |

Risk across Tier 3: Low, behavior-preserving. Byte-identity gate covers all.

---

## TIER 4 — Simplify / smell (P3/P5/P6), low-to-medium value

| # | Site | Action |
|---|------|--------|
| 4.1 | `value-factory.ts:61,73,96,110,121` | **simplify** — each allocates node with `bytes:''` then spreads into `{...n, bytes:serialize(n)}`; serializers read only typed fields. Compute bytes to a local, emit ONE literal. Halves allocs on operated-value hot path. **Measure before landing** (predict-perf-first rule). |
| 4.2 | `serialize.ts:1168` `emitAtRuleStatementRaw` `replace(/^\s+/u,'')` | **delete regex** — sole producer `buildAtRuleStatement` already stores `prelude.trim()` (`charset.ts:66/78`); the per-emit strip is pure dead re-scan |
| 4.3 | `value-expr.ts:186` `\|\| sliceSpan(..., {start, end:start})` | **simplify** — start===end always yields `''`; dead no-op masquerading as name-recovery. Drop the `\|\|`. |
| 4.4 | `parse-host/import.ts:273` `io?.multiple===true \|\| io?.once===false` | **simplify (low)** — parser always emits both; `once===false` fully covers. Reduce to `io?.once===false` (or leave as belt-and-suspenders). |
| 4.5 | `nodes.ts:179` `defFrame: object \| null` + `as Frame` casts at `serialize.ts:467,967` | **simplify (typing)** — change to `Frame \| null` (type-only import), drop the casts. Write-once closure capture itself is fine. |
| 4.6 | `nodes.ts:243/290` `canonical`/`hasInterp`/`hasAmpersand` + 6 private memo slots | **simplify (design cleanup, not urgent)** — move to free functions over the node (per external-treeshake mandate); give the per-selector memo a build-side home. All 5 reads in `serialize.ts:190,552,561,574,598`. |
| 4.7 | `serialize.ts:13` header doc | **rewrite** — "interned-string primitive" (no such primitive exists) and the "deferred rungs" list are false (guards/extend/@media/imports/map-accessors all implemented). Keep the accurate `no cloneForPlacement` sentence. |
| 4.8 | `value-eval.ts:20-21`, `value-operate.ts:123` + doc headers of all 6 value files | **fix stale paths** — cite `tree2-frontend/value-eval.ts` / `tree2/native-evaluator.ts` which no longer exist on disk; real paths are `parse-host/value-eval.ts` and `native-evaluator.ts` |
| 4.9 | `extend.ts:1` (×6), `guard.ts` (×6), `mixin-dispatch.ts:2,5` | **scrub stale `tree2`/`bridge` comments** — assert a module boundary ("under tree2/", "bridged tree2 root") that no longer exists post-`ast/` reorg |
| 4.10 | `mixin-dispatch.ts:48` `bindArgs` | **simplify (low)** — drop from `ast/index.ts:37` public re-export (keep in-file `export` for its unit test); it's an internal test seam, not API |
| 4.11 | `host-context.ts:261` `SELECTOR_EXTENDS` module-global WeakMap | **optional** — move onto `BuildContext` (already threaded per-parse) to remove ambient state. Correct today (keyed on unique per-parse nodes, can't leak). |
| 4.12 | `host-context.ts` (whole file) | **optional cohesion split** — trivia-log decode + decl/selector byte-splitters into own modules; keep `BuildContext`/`BuildArgs` contract. `declParts`/`selectorText` partly disappear once 0.1 lands. |
| 4.13 | `value-operate.ts` comment markers ("Port of Color.operate", "Byte-level port of unwrapCalcOperand"), `serialize-value`/`value-factory` "ported" notes | **reword (P2, opportunistic)** — describe behavior/spec, not dying-code lineage. Two self-resolve when 0.4 lands. |
| 4.14 | `import.ts:64` (`AnyNode` reflection dispatch) | **altitude (P3, not a bug)** — switch on parser's typed node classes instead of `type ?? constructor?.name` string reflection. Bigger; resolves when `import.ts` stops serving the bridge. |

---

## CLEAN REJECTS — do NOT touch (SUSPECT-WRONG or leanest-correct-already)

| Site | Why it's already correct |
|------|--------------------------|
| `literal-tag.ts:138` `tagForWord` num/hex/bool/color branches | Reached ONLY for genuinely untagged/synthetic Words (Url leaves, computed splits) where **no parse tag exists**. Not hot-path duplication. Stripping = correctness regression. |
| `literal-tag.ts:60` (2nd finding) "narrow `sniffLiteral` to computed-only" | 3 live consumers: `serialize.ts:314`, `native-evaluator.ts:43`, `QUOTE_RE` in `materializeLiteral:120`. The "only survivor" claim is false; dropping it kills the untagged path. |
| `literal-tag.ts:64` `parseHex` vs `tree/color.ts` | The hard `tree2 → !../tree` module boundary **mandates** the boundary-clean copy; unifying is prohibited by design. Dup dies with legacy `tree/`. |
| `serialize.ts:575` ampersand structural splice | `&` is a substring of `Simple.text` (incl. fused `&-foo`), not a discrete token — no positions to splice. `split('&').join(parent)` handles bare+fused uniformly; a splice is strictly more code for identical output. |
| `serialize.ts:406` `stripOuterQuotes` | interp/VarIndirect intentionally take the byte-fast path and never materialize a typed `Quoted`; the decision-to-strip is *already* structural (`unquote` flag L399). Consulting a typed Quoted would force materialization on the hot path. |
| `serialize.ts:651` resolved-`!important` sniff | Guards against a *value* resolving to bytes ending `!important` — a byte-level fact with no node to flag. Structural `Declaration.important` can't cover it. Leave until a value-tag design lands. |
| `serialize.ts:1211` `isBubbleable`/`isCharset` toLowerCase | Per-at-rule (rare), not in profile; leanest correct form at this frequency. |
| `value-operate.ts:150` Guard 2 keyword passthrough | Un-operable operand → joined bytes IS the terminal representation (Less verbatim-preserve contract), not reconstruction of discarded structure. |
| `value-operate.ts:172` "Guard" naming | "Guard" is correct Less domain terminology for these value-leaf constructs; renaming = style churn. |
| `guard.ts:72` `truth` byte compare `=== 'true'` | One uniform correct check across all 7 ValueObj kinds; a kind-switch would ADD arms for identical behavior. |
| `extend.ts:192` `branchHasAmp`/`substituteAmp` string split | Forced upstream — neither extend IR nor parser `Compound` carries `&` as a discrete token (`hasAmpersand` itself re-scans). Fix belongs to the parser, not this module. |
| `native/list-helper.ts:96` "byte-faithful port" comments | Annotations on genuine numeric algorithm ports (minMax/mixColors/getLuma), not byte-derivation code. Doc-pass, not code review. |
| `native/escape.ts:10` `variadic:true` mislabel | Real but harmless; the "fix" (a `wantsCtx` variant) ADDS a third dispatch branch — cuts against the minimal-mechanism ladder. |
| `mixin-dispatch.ts:92` pattern-match byte compare | Genuine Less evaluated-value equality inside the declared `Value` seam, not structure re-derivation. (Asymmetry vs typed guard compare is an owner-glance-only note.) |
| `dispatch-host.ts:42` empty `getWarnings`/`getErrors`/etc. | `FunctionalParseHost` interface obligations, not dead code. `root` fallback is a defensible secondary path. |
| `import.ts:295/131/273` `isCssPassthrough` / `fillInterpTemplate` split / redundant `multiple` | Genuine post-interpolation classification / sanctioned consumption of the `Interpolated{source,replacements}` contract — the parser can't pre-classify interpolation-resolved specifiers. Keep. |

---

## Recommended execution order (collision-safe)

1. **Tier 0 (0.1, 0.2, 0.4)** — highest-value P0, structure available. `parse-host/` and `serialize.ts` Operation-eval. Resolve the 0.3 verifier conflict (is `important` a consumable child?) before touching it.
2. **Tier 1 dead code**, batched per file: `nodes.ts` (1.7+1.8), `serialize.ts` (1.6+1.9), then the standalone deletes (1.1, 1.2, 1.3, 1.4, 1.5).
3. **Tier 3 DRY** — mechanical, byte-gated; do `serialize.ts` sigil (3.5) in the same `serialize.ts` batch as step 2.
4. **Tier 4 simplify** — `value-factory.ts` alloc (4.1) needs a perf measurement; the doc/comment scrubs (4.7–4.9, 4.13) are free and can ride any commit.
5. **Tier 0b** stays as tracked interim debt — each unblocks only when its named grammar/parser task (Task #6, tier-b, A0.2, import-family, task #10) lands. Do NOT delete standalone.

**Cross-cutting collision note:** `serialize.ts` is touched by 0.4, 1.6, 1.9, 3.5, 4.2, 4.7 — sequence as one atomic sweep. `nodes.ts` by 1.7, 1.8, 4.5, 4.6. `literal-tag.ts` by 3.1 and (deferred) Tier 0b/2 items. `custom-props.ts:145` by 0.2+0.3 (same line, do together). Per the constitution's governance clause, run the rename/reorg (P3) **after** this content demolition so we don't rename files slated for deletion.

**Note on the node-model migration:** the unified plain-data + `type:'Dimension'` reshape (`ast-v2-unified-node-model`) supersedes several Tier 1 `nodes.ts` items (1.7, 1.8) and Tier 4 typing items (4.5, 4.6) — those become part of that migration rather than standalone edits. Sequence the whole `nodes.ts` cluster behind it.
