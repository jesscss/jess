# tree2 Demolition Kill-List — Ranked Execution Plan

Grounded in `docs/future/core-architecture/TREE2-CONSTITUTION.md`. Byte-identity is the FLOOR; every action below is anchored to a constitution principle (P0 keystone = re-derivation from bytes; P1 = kill bridge; P2 = kill verbatim ports; P3 = names; P4 = DRY; P5 = complexity).

The single largest lever runs through everything: **the parser trivia log + structured children already exist but are ignored** (`host-context.ts:41` `triviaLog` threaded to every action, read by none). Wiring actions to consume it collapses a whole cluster of P0 findings at once.

---

## TIER 0 — Enabling deletions that unlock the rest (do FIRST)

### A0.1 — Retire the transitional value adapter (`tree2-frontend/value-eval.ts`)
- **Action:** Quarantine `buildEvaluator` as oracle-only (move under `__tests__/`, never imported by shipping), then delete once native fn coverage completes. Shipping seam is `buildNativeEvaluator` (`native-evaluator.ts`), already wired via `tree2/index.ts`.
- **Serves:** P1 (kill bridge), P2, P4. Owner memo `retire-legacy-value-adapter` (2026-07-16).
- **Collapses these findings on deletion:** value-eval.ts calc unwrap (60/70), sniff re-classification (187–214), toLegacy/fromLegacy list asymmetry (135), buildFnTable dup (78), separator glue (274), TypeError control-path (256), dimensionFromString intra-file dup (174), `_rgbChannels` private poke (207), guardCmp byte-compare (300), materialize dup (147 pair), EvaluatorOptions.modes/`_options` dead (91), mathMode/functionMode dead fields (160).
- **Size:** large (removes most of a ~350-line file eventually).
- **Risk:** MEDIUM — it still oracles the ~50 unconverted native fns (`native-evaluator.ts:9-13`). **Do not delete outright today** — quarantine now, delete when native fn coverage lands.
- **Ordering:** Blocks nothing but many dedup actions below simplify to "the surviving native copy is canonical" once this is out of the shipping surface. **The surviving copy must be the CORRECTED one (see A2.x correctness fixes).**

### A0.2 — Wire actions to consume `triviaLog` / structured children (parse-host)
- **Action:** Implement `getLiftedCommentRanges()` / `commentOnlyTriviaForNode` in the tree2 host; have `actions/` read `BuildArgs.triviaLog` instead of re-scanning `ctx.src`.
- **Serves:** P0 keystone. Root enabler.
- **Unlocks:** A1.4 (comments), A1.5 (descendant combinator), and removes the "reserved-unused" smell at `host-context.ts:41`.
- **Size:** medium (new wiring), enables large downstream deletion.
- **Risk:** MEDIUM — requires opting into comment-only capture like the legacy builder.
- **Ordering:** Land BEFORE A1.4/A1.5.

---

## TIER 1 — P0 byte-re-derivation deletions (KEYSTONE, highest impact × confidence)

Each re-derives structure the parser already produced. All CONFIRMED unless noted.

### A1.1 — Delete `@{}`/`@name`/`@@name` source reconstructions
Multiple sites route a decision through rebuilt Less source when the built node carries the answer:
- **serialize.ts:344/346/382/317/319** — `literal(\`@${name}\`)` var-miss / VarIndirect / depth-cap fallbacks. Parser provides `VarRef{name}` / `VarIndirect{nameRef}`. **Also a latent correctness bug:** real Less ERRORS on undefined/cyclic vars (doesn't pass `@name` through), and `@` is dialect-anchored (SCSS/jess use `$`). P4 "@name var-miss ×4".
- **declaration-static.ts:37** — whole-value guard compares built nodes to reconstructed strings (`\`@${only.name}\`===value`, `@@` variant). Replace with span-coverage comparison the parser carries.
- **selector.ts:75** — `simpleFromText → INTERP_RE=/@\{...\}/g`, the exact keystone-banned `@{}` tokenizer. Parser segments `InterpolatedSelector` leaves. (Note: functional grammar's `lessInterp` is currently a flat regex weaker than chevrotain `Interpolated{source,replacements}` — grammar may need to emit structured interpolation; the core-side regex is banned regardless.)
- **bridge.ts:299** — `/@\{\s*([^}]+?)\s*\}/g` in producer path (flagged as still-live P0 violation even though node-model shape at nodes.ts:143 is clean — that finding REJECTED, this producer is not).
- **Serves:** P0, P4. **Size:** medium. **Risk:** MEDIUM (undefined-var behavior change is a real semantic fix — verify against Less error semantics; may need owner nod on error-vs-passthrough). **Ordering:** independent; touches serialize.ts (collides with reorg — do before rename sweep).

### A1.2 — Delete calc string-unwrap (×2)
- **value-operate.ts:142** (`CALC_WRAP_RE`/`calcInner`) + **value-eval.ts:60/70** (byte-identical copy).
- Parser provides structured `calc` `Call{Operation, inCalc}` (less-parser `calcFunction`; css-parser `CalcCall`). Structure is destroyed when the unknown-fn path collapses calc into a `keyword` ValueObj — fix by carrying a calc-kind field so no regex is needed.
- **Serves:** P0 (explicit "rebuilding calc operands by string-unwrapping" ban), P4 "calc string-unwrap ×2". **Size:** small-medium. **Risk:** LOW-MEDIUM (latent greedy-splice on `calc(a) calc(b)`). **Ordering:** value-eval.ts copy dies with A0.1; native copy needs the calc-kind field.

### A1.3 — Delete `declParts` source-split (×2)
- **host-context.ts:89** slices whole declaration span, splits on first `:`. Parser gives `declPropName` leaf + `valueList` child + `important` as distinct rawChildren.
- **poc-tree2-host.ts:38/48/105** — verbatim dup (`declParts`/`selectorText`/`isStatement`), imported ONLY by its own two `__tests__`. **Delete the whole POC.**
- **Serves:** P0, P4 "declParts ×2", P1. **Size:** medium (POC deletion is pure win). **Risk:** LOW. **Ordering:** independent.

### A1.4 — Delete comment re-tokenizer (`actions/comments.ts`)
- **comments.ts:66/12/156/173** — `scanStandalone` hand-rolls a `/* */`+`//` tokenizer over `ctx.src`, a verbatim re-implementation of legacy `_liftStandaloneComments`/`_scanStandaloneComments`/`_sameLine` (css-parser `builders.ts`). Also **ruleset.ts:173** body window via `indexOf('{')`/`lastIndexOf('}')` (can mis-window on `}` in a trailing string).
- Parser captures comments as trivia ranges; `{`/`}` are literal leaves with spans.
- **Serves:** P0, P2, P5 (O(source) re-scan → O(#comments)). **Size:** LARGE (whole file + Ruleset override at comments.ts:162). **Risk:** MEDIUM. **Ordering:** REQUIRES A0.2 first.

### A1.5 — Fix descendant-combinator inference (`selector.ts:74`)
- Infers descendant combinator from a byte gap (`span.start>prevEnd`). **Correctness bug:** a comment between simples (`.a/* */.b` = compound `.a.b`) produces a gap with no whitespace, wrongly split to `.a .b`. Parser marks descendant via WHITESPACE trivia (`hasWhitespaceTriviaAt`).
- **Serves:** P0, correctness-beyond-bytes. **Size:** small. **Risk:** LOW. **Ordering:** REQUIRES A0.2 (whitespace trivia).

### A1.6 — Delete numeric/quoted re-sniff in `literal-tag.ts`
- **127** `leaf('Numeric', tagForWord)` re-runs `NUM_RE` at parse-host to redecide Dimension-vs-Num, discarding numPart/unit children + the CST host's structural split. **73** `dimensionFromString` re-scans a third time at materialize. **109** default case re-detects quotedness via `QUOTE_RE` because `value-leaf.ts:63`/`bridge.ts:624` collapse Quoted → `LIT_ANY`.
- Fix: carry `number`+`unit` fields on the numeric leaf; add a `Quoted` tag (or carry quote+value+escaped). Packed `Kind.Dimension` path already reads fields with no regex — proof the tagged-Word path pays a redundant tax.
- **Also merge:** Num vs Dimension tags — no materializer distinguishes them (92); collapse to one `Numeric` tag.
- **Serves:** P0, P5. **Size:** medium. **Risk:** MEDIUM (escaped-quoted `~"..."` correctness — hardcoded `escaped:false` is a PLAUSIBLE A1 risk). **Ordering:** parse-host change; coordinate with A1.1 selector interp.

### A1.7 — Delete `!important` regex re-derivation (`nodes.ts:356` / bridge `detectMergeImportant`)
- Bridge recovers `important` + merge (`+`/`+_`) by re-slicing + `/!\s*important\s*$/` scan even though the parser tokenizes `!important` (`T.Important`) and merge structurally. Comment admits "the parser drops both from the tree" — that's a **parse-host gap to fix** (carry the token), not a license to byte-scan.
- **Keep:** `valueEndsImportant` at **serialize.ts:657** — REJECTED-as-defect; it fires only for post-eval computed values (var/custom-prop holding `!important`) that the structural flag cannot cover. Leanest correct form.
- **Serves:** P0, P5. **Size:** small-medium. **Risk:** MEDIUM (parse-host token threading). **Ordering:** independent.

### A1.8 — Delete `charset.ts:29` AT_KEYWORD regex + `mixins-def.ts:62` classifyParam
- **charset.ts:29** re-tokenizes `@keyword` from whole-statement span; grammar gives `atKeyword` leaf + `atPrelude` child separately.
- **mixins-def.ts:62** `classifyParam` re-parses each slot (`endsWith('...')`, `indexOf(':')`, `/^@[\w-]+$/`); grammar gives `NamedArg`/`Rest`/`value` nodes. Requires registering `NamedArg`/`Rest` actions (structure exists upstream).
- **Serves:** P0, A3 (hardcoded `@` sigil). **Size:** small each. **Risk:** LOW-MEDIUM. **Ordering:** independent. **Keep** `mixins-def.ts:100` brace-leaf discriminator (REJECTED-as-defect; reads a real grammar literal, is the reliable def-vs-call discriminator).

### A1.9 — Delete `coerceListItems` byte re-tokenizer (`native/list-helper.ts:97`)
- Slices a Keyword's `.text` and re-tokenizes with a hand-rolled paren/quote depth scanner (`topLevelSplit`) to rebuild List structure. Root cause: tree2's own `evalTyped`/`joinBytes` (serialize.ts:324/350) flattens the structured list to keyword bytes — **re-derivable upstream** by materializing a `List` ValueObj in `evalTyped`.
- Related: `hasTopLevelComma`+`topLevelSplit` two-pass (74) collapses to one; quote-escape gap (55) is a symptom.
- **Serves:** P0 keystone, P5. **Size:** medium. **Risk:** MEDIUM (unify the `length`/`extract`/`min`/`max` paths). **Ordering:** requires evalTyped change.

---

## TIER 2 — Correctness-beyond-bytes fixes (CONFIRMED latent bugs; byte-identity can't catch them)

### A2.1 — `@arguments` built from ordered params, not raw positional (`mixin-dispatch.ts:114`)
- **CONFIRMED bug vs less@4.6.3:** `@arguments` = eval'd value of EVERY param slot in param order. tree2 builds from raw `positional` only → named-only calls yield `''`, default-filled slots vanish, mixed calls emit call-order. Build from the ordered `bound` values this function already computes.
- Only covering test is `describe.todo` (mixins.test.ts:265) — byte-identity proves nothing.
- **Serves:** correctness. **Size:** small. **Risk:** LOW (fix), HIGH (bug). **Ordering:** independent, high priority.

### A2.2 — Dimension comparison: reconcile units + `%` (`value-operate.ts:189` / :199)
- **CONFIRMED gap vs legacy `Dimension.compare`:** `nativeGuardCmp` compares bare `.number` → `1cm = 10mm` false, `50% = 0.5` false, `1s > 500ms` false. Legacy normalizes `%`→/100 and converts compatible units. Non-dimension ordered `>`/`<` uses lexical byte compare (199–206) vs legacy `undefined` (incomparable).
- Fix: reuse this file's own `UNIT_TO_GROUP`/`CONVERSIONS` (19–29) + `%` normalization; **requires threading `modes`** (unit reconciliation depends on `unitMode` for strict/preserve throw).
- **This is why `native-evaluator.ts:54` `_modes` must be KEPT** (REJECTED the drop — dropping it bakes in this bug).
- **Serves:** correctness, P4 (unit table dedup — see A3.3). **Size:** medium. **Risk:** MEDIUM. **Ordering:** must land jointly with the guardCmp dedup (A3.7) so the surviving copy is corrected; depends on A3.3 unit-table extract.

### A2.3 — Import interpolated-path vars: last-wins, not first-wins (`import-bridge.ts:196`)
- **CONFIRMED:** `if (lit !== null && !vars.has(name))` keeps FIRST binding; Less is last-declaration-wins. `@x:1; @x:2; @import "@{x}.less"` → `1.less` here vs `2.less` in Less. Repeats at 212, 238.
- **Serves:** correctness. **Size:** small. **Risk:** LOW. **Ordering:** independent. Untested edge (no fixture redefines an interp-path var).

### A2.4 — fadein/fadeout/fade alpha rounding asymmetry (`native/fadein.ts:15`)
- **CONFIRMED byte-visible:** `fadein` rounds `Math.round(a*1e12)/1e12`; `fadeout`/`fade` pass raw → can emit `0.7000000000000001`. Fold into one alpha-delta helper (combine with A3.10 format dedup).
- **Serves:** correctness, P4. **Size:** small. **Risk:** LOW. **Ordering:** independent.

### A2.5 — Import cycle + multiple-import edge cases (`import-bridge.ts:370`, :373)
- **370** raises `UnsupportedShape` on legit cyclic import (A→B→A); Less resolves silently. **373** double-emit: a `(multiple)` import never registers `resolved` (392) so a later `@import "a"` re-emits.
- **Serves:** correctness. **Risk:** LOW-MEDIUM; both are safe deferrals today (census counts, no mis-emit). **Ordering:** defer; PLAUSIBLE on the Less-suppression interaction (373) — **needs owner/Less-source confirmation** before changing.

---

## TIER 3 — P4 DRY collapses (CONFIRMED duplication; one implementation each)

### A3.1 — `renderCombinator` ×3 → one exported helper
- Byte-identical `comb === ' ' ? ' ' : \` ${comb} \`` at **nodes.ts:217, extend.ts:69, serialize.ts:547** (serialize copy carries a `// [R4] mirror` marker). Hoist one exported fn co-located with the `Combinator` type in `node.ts`. Catalogued in P4 (`renderCombinator ×3`).
- **Size:** trivial. **Risk:** NONE. **Ordering:** independent, easy win.

### A3.2 — HSL→RGB selector ×3 → one selector + layered rounding
- **value-operate.ts:45** `rgbUnclamped` (re-inlines full `hslToRgb` body), **value-factory.ts:57** `colorRawRgb`, **serialize-value.ts:100** `colorRgb` (same branch + round/clamp). `colorRawRgb` already exported. Delete `rgbUnclamped`, factor one `hsl-or-stored-rgb` selector, layer round/clamp on top. Catalogued in P4 (`rgbUnclamped vs colorRawRgb`).
- **Also:** `colorRgbRounded` = pure passthrough of `colorRgb` (value-factory.ts:50) — pick ONE name.
- **Size:** small. **Risk:** LOW. **Ordering:** independent.

### A3.3 — Unit conversion table ×3 → one units module
- **value-operate.ts:19** `UNIT_TO_GROUP`+`CONVERSIONS`, **native/convert.ts:6** `CONVERSIONS`, **native/list-helper.ts:114** `UNIT_GROUPS` — identical factors (`px:0.0254/96`, `rad:1/(2π)`, etc.); legacy `tree/dimension.ts` is a third. Extract one boundary-clean units module (group membership + factors) consumed by all.
- **Size:** small. **Risk:** LOW. **Ordering:** **land BEFORE A2.2** (the dimension-compare fix reuses it).

### A3.4 — clamp helpers ×4 → one `clamp(v,max)` + one true `clamp01`
- **value-factory.ts:36** `clamp01(v,max)` (misnamed, `max` always 1 = dead flexibility), **serialize-value.ts:48** `clamp(v,max)`, **color-ctor-helper.ts:12** + **color-helper.ts:13** `clamp01(v)`. Name collision (two-arg vs one-arg `clamp01`). Collapse; drop the always-1 arg.
- **Size:** trivial. **Risk:** LOW (name-collision resolution). **Ordering:** independent.

### A3.5 — `round` ×2 → one shared boundary-clean util
- **serialize-value.ts:35** is a byte-for-byte copy of `tree/util/round.ts`. `../tree` import ban is real → shared util both import (not a second inline).
- **Size:** trivial. **Risk:** LOW. **Ordering:** independent.

### A3.6 — Separator glue ×3 → one join helper
- `sep===',' ? ', ' : sep==='/' ? ' / ' : ' '` at **native-evaluator.ts:24**, **value-eval.ts:274** (unreadable nested-template form), **serialize-value.ts:200** (list case). One shared join helper (`verbatimArgs` differs only in `.bytes` vs `serializeValue` mapping).
- **Size:** small. **Risk:** LOW. **Ordering:** value-eval copy dies with A0.1.

### A3.7 — guardCmp / guardCall dedup (`value-operate.ts:188`)
- `nativeGuardCmp` line-for-line identical to adapter `value-eval.ts:287-308`; `nativeGuardCall` synthetic-list wrapper (guard.ts:89) fabricates dead `sep`/`bytes` — change seam to `readonly ValueObj[]`. **Surviving native copy must be the CORRECTED one from A2.2**, not the incomplete port.
- **Size:** small. **Risk:** MEDIUM (must sequence with A2.2). **Ordering:** joint with A2.2.

### A3.8 — Front-end untyped-node reader ×2 (`import-bridge.ts:63`)
- `AnyNode`/`isNode`/`typeOf` (bridge.ts:53-61) vs `AnyNode`/`isNode`/`nodeType` (import-bridge.ts:64-79) — structurally identical, name drift. P4 (`isNode ×2`). One shared reader.
- **Size:** trivial. **Risk:** LOW. **Ordering:** independent.

### A3.9 — `unquotedText` helper (`native-evaluator.ts:35`)
- `v.kind==='quoted' ? v.value : v.bytes` duplicated at value-operate.ts:228. One helper.
- **Size:** trivial. **Risk:** NONE.

### A3.10 — Color-reformat `bytes:''` idiom ×3 + fade-format ×3
- **contrast.ts:37 / tint.ts:16 / shade.ts:16** — manual `{...out, format, bytes:''}` + `serializeColor` dance bypassing the factory. **fade.ts:14 / fadein.ts:17 / fadeout.ts:16** — identical `preserveHex` + `modernSyntax` decision. One reformat-to-format factory (mirrors `makeColorRgb` self-computing bytes); combine with A2.4.
- **Size:** small. **Risk:** LOW. **Ordering:** independent.

### A3.11 — `lighten`/`darken`/`saturate`/`desaturate` family (`native/lighten.ts:20`)
- Four near-identical ~6-line bodies → `hslAdjust(channel, sign)`. PLAUSIBLE (small, individually readable) — legitimate DRY, no correctness impact. Also `hsl.ts:24` double hue-wrap (normalizeHue already wraps) — pick one owner of the wrap.
- **Size:** small. **Risk:** LOW. **Ordering:** independent.

### A3.12 — `resolveComplex`/`resolveCompound` vs `Compound.canonical()` (`serialize.ts:566`)
- Re-implements the head + leadingComb-trimStart + tail/renderCombinator walk of `canonical()` (nodes.ts:295-309); only delta is frame-aware interp resolution. Unify via an optional token-resolver arg on `canonical()` (static path passes none, keeps `_canon` cache). **Ties into A4.1** (moving canonical off the node).
- **Size:** medium. **Risk:** MEDIUM. **Ordering:** after A4.1 decision.

---

## TIER 4 — Dead code / inert plumbing deletion (CONFIRMED)

| ID | File:line | Delete | Serves |
|---|---|---|---|
| A4.2 | value-eval.ts:160 | `EvalModes.mathMode`+`functionMode` (zero readers; contradicts "math mode is parse-time") + `DEFAULT_MODES` seeds | P2 |
| A4.3 | value-dispatch.ts:55 | `NATIVE_FNS` dead export (no consumer; case-inconsistent with `hasNativeFn`) | P4 |
| A4.4 | value-eval.ts:91 | `EvaluatorOptions.modes` + `_options` (never read) | P2 |
| A4.5 | serialize-value.ts:29 | `OutputMode` + `mode` param (fully inert `void mode`; 3 dead "COMPRESSED HOOK" comments) — YAGNI, owner reserves a PARSE-TIME bit not a serializer mode | P5/YAGNI |
| A4.6 | guard.ts:22 | Non-short-circuit + false async record/replay rationale (evalGuard is sync) | P2 |
| A4.7 | color-ctor-helper.ts:40 | Dead ternary arm `d.number : d.number` | smell |
| A4.8 | serialize.ts:12 | "interned-string primitive" / "interning ceiling" claim — no interning exists (`composeOne` allocates fresh strings). Either implement or delete the claim + stat | P5 (misdescribed cost) |
| A4.9 | guard.ts:79 | Redundant `resolve` FIELD in `GuardEvalDeps` (round-trips a Bool through bytes) — derive truth from `resolveTyped`. **KEEP the `ValueResolver` type** (used by `resolveCaller`) | smell |

- **Size:** mostly trivial. **Risk:** LOW. **Ordering:** independent; A4.5/A4.8 touch serialize files (before reorg).

---

## TIER 5 — P5 perf / structural (defer to perf+extend review, but flagged)

- **A5.1 — mixin arg re-resolution (`mixin-dispatch.ts:155`, :114):** `bindArgs` per candidate recomputes identical caller-frame resolutions; positional args resolved twice within one bindArgs. Hoist each unique call arg to a resolved Word once. **CONFIRMED P5.** Overlaps A2.1.
- **A5.2 — per-placement definition re-scan (`serialize.ts:908`, :1613, :933, :457):** `collectMixins`/`collectVars` re-run on immutable def body every call; Frame cache never survives (fresh Frame per placement). Compute once at def-registration. **CONFIRMED P5.** → the "Minimal lookup model" memo. **Owner-directed lookup work.**
- **A5.3 — Ampersand structural flag (`nodes.ts:267`, :265):** `hasAmpersand` byte-scans `sim.text.includes('&')`; Compound uncached vs Complex cached (asymmetric). Carry `isAmp` bit at parse-host; folds into A4.1.
- **A5.4 — eager `bytes` deferral (`value-eval.ts:47`, `value-factory.ts:62`):** two-allocation `{…,bytes:''}` then spread-copy at every factory. **A4.x half (value-factory.ts:62) is a clean mechanical fix** (compute bytes first, build once — halves per-value alloc). **The deferral half is an OWNER DECISION** (conflicts with `readonly`+projection stance; `nativeOperate`/`guardCmp` read operand `.bytes`).

---

## TIER 6 — Naming + node-model reorg (P3; run LAST, atomically, after content demolition)

### A6.1 — Kill `native*`/`guard*` value-op names
`nativeGuardCmp`→`compare`, `nativeGuardCall`→`callGuard`, `nativeOperate`→`operate` (value-operate.ts:188/215/148); interface `guardCmp`/`guardCall` (value-eval.ts:193). P3 names these verbatim. `native-evaluator.ts:45-58` already re-wraps them 1:1 → prefix carries zero info.

### A6.2 — `Color.format` bare `number` → `ColorFormat` enum
value-eval.ts:71, serialize-value.ts:16-18 (loose consts), value-operate.ts:136 (`?? 1 /* RGB */`). Legacy `tree/color.ts:18-21` enum already exists. Also drop dead `?? HEX` fallback (serialize-value.ts:155 — `format` is required).

### A6.3 — `Color.node` (string) → `sourceText`/`literalSpelling` (value-eval.ts:74). Misleading name for a verbatim-source string.

### A6.4 — Strip rung/phase bracket tags ×38 — `[R4]`/`[R2]`/`[guards]`/`[atrule]`/`[value-literal-tag]`/`[import:inline]` across nodes.ts/node.ts/at-rule.ts/mixin-dispatch.ts. Repo rule "no Phase 1/2/3" + P3.

### A6.5 — Erase verbatim-port markers (P2) — "Ported byte-for-byte from Dimension.operate/Color.operate" (value-operate.ts:1), "Byte-identical port of Color.*" (serialize-value.ts header), "Relocated verbatim from the foundation" (lighten.ts:9), "mirrors the bridge/less plugin" etc. Keep the (re-derived, byte-equivalent) CODE; reword comments to describe the canonical bytes emitted. **One confirmed silent narrowing to fix while here:** `serialize-value.ts:138` `alphaText` hardcodes `'%'` where legacy emits the authored `alphaUnit`.

### A6.6 — Directory/type rename sweep — `tree2`/`tree2-frontend`/`poc-*` → `tree/` + `parse-host/`; actions co-locate with node family. **P3, collision-prone.** Base `Node`+`Kind` enum already correct (keep).

### A6.7 — Move derivation methods off nodes (`nodes.ts:248`) — `Compound.canonical()`/`hasInterp`/`Complex.canonical()`/`hasAmpersand` are methods+memo fields on the data; owner mandate = nodes are pure data, serializer/value-eval are free fns. Move to `serialize.ts` (already home of `resolveComplex`/`resolveCompound`). **Unifies with A3.12, A5.3.**

- **Ordering:** ALL of Tier 6 runs AFTER Tiers 0–4 land (constitution governance: "don't rename files we're about to delete"). Run atomically in one isolated worktree.

---

## REJECTED — do NOT touch (verified clean or would introduce bugs)

| File:line | Why rejected |
|---|---|
| `native/rgba.ts:6`, `hsla.ts` | Cleanly delegate to `makeRgb`/`makeHsl`; shared spec literal is leanest form |
| `serialize-value.ts:168` (hue-wrap) | No reachable divergence (all producers pre-wrap 0-360); suggested fix is a **circular import** |
| `serialize-value.ts:171` (clamp dedup) | Proposed owner `colorHslClamped` would **invert dependency into a cycle** |
| `value-eval.ts:64` (oracle port markers) | Markers sit in the ORACLE whose job IS to delegate to legacy — not shipping-core P2 debt |
| `mixin-dispatch.ts:92` (matchArgs) | Byte-compare IS less@4.6.3's algorithm; no reachable disagreement |
| `mixin-dispatch.ts:129` (value-literal-tag seam) | Accepted lossless value-flatten seam, byte-faithful |
| `mixin-dispatch.ts:82` (evalParams) | **Finding premise factually wrong** — traced Less, tree2 matches (no slot filled twice) |
| `native-evaluator.ts:54` (`_modes`) | **Must KEEP** — needed once A2.2 restores unit reconciliation |
| `at-rule.ts:44` (prelude string) | Intended byte-faithful pass-through; asymmetry vs block prelude justified |
| `nodes.ts:143` (Interp node-model) | Node SHAPE complies with P0 (structured children, no re-scan). Bug is in **producer** bridge.ts:299 → A1.1 |
| `nodes.ts:8` (string compose) | Defensible P5 choice; only ampersand DETECTION (A5.3) needs a flag |
| `ruleset.ts:19` (`selectorText`) | HOT path — `basicSel` is a bare regex leaf, ~76% of compounds unwrap to raw string. Not dead |
| `import-bridge.ts:128` (`fillInterpTemplate`) | Consumes parser `Interpolated` exactly as core engine does; `%%` split IS canonical consumption |
| `import-bridge.ts:299` (extensionless fallback) | Over-permissive but near-impossible to trigger; keep as reviewer recommends |
| `serialize.ts:657` (`valueEndsImportant`) | Fires only for post-eval computed `!important`; structural flag can't cover it |
| `literal-tag.ts:47` (`LIT_ALREADY_MINIMAL`) | **Owner-directed reservation** (compress-already-minimal-bit memo) — keep the dead bit |
| `literal-tag.ts:137` (tagForWord named-color) | Dead for parsed input but legitimate synthetic-Word fallback; only the anchoring comment is smell |
| `serialize.ts:108` (collapseNesting) | Behavior correct (plugin injects v5 default) — **fix the docstring contradiction only** |

---

## OWNER DECISIONS REQUIRED

1. **A1.1 undefined/cyclic var:** confirm Less ERRORS (vs `@name` passthrough) is the intended v5 behavior before deleting the fallback bytes.
2. **A5.4 eager-bytes deferral:** conflicts with `readonly`+projection-not-mutation stance and `nativeOperate` reading `.bytes`. Design call needed (the factory two-alloc fix is safe independent of this).
3. **value-operate.ts:164 normalized spacing:** `makeKeyword(\`${left.bytes} ${op} ${right.bytes}\`)` normalizes to single spaces — confirm this is the intended v5 canonical form (vs source-span-faithful).
4. **serialize.ts:361 evaluator-less mode:** confirm no production caller runs without an injected evaluator; if test-only, delete the `!e.ev` source-rebuild branches.
5. **A2.5 (373) multiple-then-once import:** needs Less-source confirmation of the suppression interaction before changing.

## SEQUENCING SUMMARY

1. **Tier 0** (A0.1 quarantine adapter, A0.2 wire triviaLog) — unlocks everything.
2. **Tier 1** P0 deletions + **Tier 2** correctness (A2.1, A2.3, A2.4 are independent quick wins; A2.2 sequences with A3.3+A3.7).
3. **Tier 3** DRY (A3.1/A3.3/A3.4/A3.5/A3.8 are trivial independent wins).
4. **Tier 4** dead-code deletion (independent).
5. **Tier 5** perf → hand to perf/extend/lookup review.
6. **Tier 6** rename+reorg LAST, atomic, isolated worktree — after all deletions so no renamed-then-deleted churn.

Everything touching `serialize.ts`, `serialize-value.ts`, `nodes.ts` collides with the Tier 6 reorg — land their content deletions BEFORE the rename sweep.