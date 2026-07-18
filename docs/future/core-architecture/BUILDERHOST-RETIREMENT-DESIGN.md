# BuilderHost Retirement — reorg-A4 endgame (SPEC, no code this pass)

DESIGN/SCOUT spec. Base: `origin/dev`. Scope: retire the legacy Less **`BuilderHost`**
(`packages/less-parser/src/builders.ts`, `class LessGrammar` + the `BuilderHost`
subclass in `functional-parser.ts`) so the ~34 remaining `builders.ts` regex that the
§0.11 grammar-relocation and #44's `ast/` node reshape provably **cannot reach** —
because they live inside legacy `tree/`-class value constructions and bridge-fed
shapes — are cleared.

This is the sequel that `GRAMMAR-RELOCATION-DESIGN.md` §6 and `VALUE-NODE-MODEL-DESIGN.md`
§0a/CORR-1 both point at without owning: #44 shipped **decoupled** from `builders.ts`
(the value-literal reshape landed in `ast/` only), so the S5 "land WITH #44" plan is
dead — the value-construction regex is now RE-HOMED onto this A4 retirement. This doc is
the owner of that endgame.

Companion specs (do not duplicate — this doc references their inventories):
- `GRAMMAR-RELOCATION-DESIGN.md` — the site-by-site L1–L9 / S1–S6 / S-A4 / S-Q3.3 map.
- `VALUE-NODE-MODEL-DESIGN.md` — the landed `ast/` node set (`Keyword`/`Color`/
  `Quoted`/`Dimension{src}`/`Any`) + constructors these sites bind to.
- `QUOTED-GRAMMAR-STRUCTURING-PLAN.md` — §3.3 `Quoted` structuring (the S-Q3.3 blocker).
- `PHASE1-BURNDOWN.md` — Cluster 2 (builders.ts regex law) + Cluster 7 (parse-host deletion).

---

## 0. The two-producer fact that decides everything

There is **one grammar** — `lessGrammar` (`packages/less-parser/src/grammar.ts`,
Parséman macro-compiled, owns *structure* + leaf *classification*) — driven by **two
independent build hosts**:

| Host | File | Builds | Consumed by |
|---|---|---|---|
| **`ast/` dispatch-host** | `core/src/ast/parse-host/dispatch-host.ts` + `actions/*` | `ast/` **plain-data** nodes (`{type:'Dimension', number, unit, src}`, …) via `t2.dimension/color/quoted/keyword/any` | the `ast/` differential render (`renderAstFile` / whole-doc-driver) — the CORRECTNESS GATE |
| **`BuilderHost`** (this doc's target) | `less-parser/src/builders.ts` (`LessGrammar`) + `functional-parser.ts` (`BuilderHost`, `parseLessFn`) | legacy **`@jesscss/core` `tree/` classes** via `new Dimension(…, loc)` / `new Color(…, loc)` / `new Quoted(…, loc)` | (a) legacy production render (tree/ eval), (b) the less-compat bridge, (c) the `ast/` import sub-parse (`import.ts:182` reads `parsed.tree`) |

**The decisive observation:** the `ast/` dispatch-host already builds the honest typed
value literals from the SAME grammar's leaf classification with **zero regex**.
`actions/value-leaf.ts` reads the grammar's leaf tags (`Numeric` / `Color` /
`NamedColor` / `Keyword` / `Quoted` / `EscapedValue` / `Url`) and the already-split
number/unit leaves, and constructs:

```ts
// value-leaf.ts — regex-free, grammar already classified the leaf
t2.dimension(Number(leaves[0]), leaves[1] ?? '', bytes)  // number, unit, verbatim src
t2.color(bytes)                                          // hex or named
t2.quoted(bytes, bytes.slice(1, -1), bytes[0]!, false)   // src, value, quote, escaped
t2.keyword(bytes) · t2.any(bytes)
```

`BuilderHost` re-derives that SAME classification with `.exec`/`.test` (`:1218` numeric
split, `:2842/:2852` escaped/plain quoted, `:2924` ratio, `:2962` dim, `:2834/:2857`
`@var`, …) for **one reason only**: it targets the legacy `tree/` constructors, whose
signatures are `new X(value, options, loc)` and whose value-domain wants pre-split
fields the builder historically had to recover itself. The grammar now delivers those
fields as typed leaves — so **BuilderHost's value regex is redundant with work the
dispatch-host already does correctly.**

---

## 1. Core question — can BuilderHost emit `ast/` nodes directly?

**Answer: yes, and it is already proven by the dispatch-host — but the honest endgame
is not "make BuilderHost emit `ast/` nodes and keep it." It is: RETIRE BuilderHost, let
the `ast/` dispatch-host be the single producer, and re-point the less-compat bridge
from legacy `tree/` nodes to `ast/` plain-data nodes.**

Rationale:

- A "BuilderHost that emits `ast/` nodes" would be a **byte-for-byte duplicate** of the
  dispatch-host over the same grammar — two producers of the same node set. The two
  hosts exist only because they targeted *different* node models. Once both target the
  `ast/` model, one is dead weight. Keeping it violates the ponytail ladder ("best code
  is code you never wrote").
- So the retirement is a **collapse to one producer**, not a rewrite of a second. Every
  `new Dimension(…, loc)` / `new Color(…, loc)` / `new Quoted(…, loc)` in `builders.ts`
  (23 constructions) and the regex that guards them disappears with the file.

### 1.1 What consumes BuilderHost output today, and what breaks

| Consumer | Reads | Breaks if BuilderHost is deleted? |
|---|---|---|
| **Legacy production render** (tree/ eval) | `parseLessFn(...).tree` = legacy `tree/` nodes | **YES — hard blocker.** Per `memory:eval-load-bearing-post-flip`, the legacy tree/ eval still serves production render; `ast/` render is test-only. It genuinely needs `tree/` nodes. BuilderHost cannot be deleted until production render is the `ast/` spine. |
| **less-compat bridge** | legacy `tree/` nodes → maps to less.js `tree.*` | **Goes red by construction — NON-SACRED.** Owner released bridge byte-identity (`memory:bridge-byte-identity-non-sacred-for-parser-cleanup`; `GRAMMAR-RELOCATION-DESIGN.md` §0 2026-07-18 ruling). Repaired at the less-compat re-point: bridge adapters re-point to read `ast/` field names (`number`/`unit`/`src`) instead of the legacy value-domain fields. |
| **`ast/` import sub-parse** (`import.ts:182`) | `parseLessFn(...).tree` `.rules` (legacy) | **YES — must switch.** The `ast/` import path currently piggybacks on BuilderHost to parse imported files and reads legacy `.tree`. It must re-point to the dispatch-host (drive `lessGrammar` through `dispatch-host.ts`, read the `ast/` tree). This is the "LIVE on the `ast/` render front-end" coupling. |
| **Parser unit tests** (`perf.test.ts`, `parseman-grammar-basic.test.ts`, `nested-mixin-def.test.ts`) | `parseLessFn` shape | Internal tests, freely updated (`memory:no-sacred-test-expectations`). |

**Net:** the node-emit CAN flip cleanly (proven), but **deleting the class** is gated on
the production-render cutover to the `ast/` spine (legacy tree/ eval is the real
blocker), plus the bridge re-point (non-sacred) and the `ast/` import re-point. See §4.

---

## 2. Verbatim-`src` threading — the byte-faithfulness invariant

The landed `ast/` `dimension()` constructor has a **canonicalizing default**:

```ts
export const dimension = (number, unit = '', src = `${number}${unit}`): Dimension =>
  ({ type: 'Dimension', number, unit, src });
```

That default is a **trap for parsed literals**: `1.0px` has `number:1, unit:'px'`, so
the default `src` would be `"1px"`, silently violating verbatim preservation
(`memory:v5-preserve-unoperated-values-verbatim` — an un-operated literal emits its
SOURCE spelling; only a COMPUTED value canonicalizes). `50.0%`, `0.5s`, `#FFFFFF`
(case), `~'x'` all have the same hazard.

**Spec — mandatory at every relocated value-construction site:** the `src` argument is
the grammar leaf's **verbatim span slice**, never the constructor default:

```ts
const src = sliceSpan(ctx, span);       // = source.slice(span.start, span.end)
t2.dimension(number, unit, src);        // src is REQUIRED, not defaulted
t2.quoted(src, inner, quoteChar, escaped);
t2.color(src);
```

The dispatch-host already does exactly this (`value-leaf.ts` `numericLeaf` passes
`bytes`; `quotedLeaf`/`escapedLeaf`/`color`/`keyword` pass `bytes`). Because the
retirement makes the dispatch-host the SOLE producer, the invariant is satisfied by
construction — there is no second producer to get it wrong. The constructor default
survives ONLY for genuinely SYNTHETIC dimensions (`dimension(i + 1)` each-index,
`serialize.ts`) that have no parse origin.

**Retirement DONE-criterion for `src`:** `git grep -n 't2.dimension(' core/src/ast` shows
every parse-origin call site passing a third `src` arg; the two-arg synthetic form is
allowed only in `serialize.ts` loop-index sites (documented). No relocated site relies
on the default.

---

## 3. The `_buildAtRulePrelude` coupling (S5 value + S6 query-prelude) — ONE edit

`GRAMMAR-RELOCATION-DESIGN.md` correction #1 (2026-07-18) is load-bearing here and this
doc restates it as a hard sequencing constraint:

- `_buildAtRulePrelude` (`builders.ts` ~2524–2898) hand-tokenizes the media / supports /
  container / import / use prelude with regex. It contains BOTH:
  - **S5 value constructions** — prelude-embedded `new Dimension`/`new Quoted` + their
    guarding regex (`:2842` `escapedStrRe`, `:2924` ratio, `:2962` dim, `:2834/:2857`
    `singleVarRe`, `:2873/:2907` `varAccRe`, `:2914` paren), and
  - **S6 query-prelude re-tokenize** — the media/ns-media path split (`:3098`
    `nsMediaRe`, `:3133/:3139`, `:3151` arg-ref, `:3190` at-rule name head) and the
    import/use prelude scan (`:2632/:2649/:2661-2667/:2676/:2736`, `:3243/:3252/:3254/:3259`).

Because both clusters live in the SAME method body, they **cannot be scheduled as
disjoint commits**. Sequence within the retirement:

1. **S6 first (grammar query-prelude split, TB-3).** Land the `lessGrammar`
   query-prelude structuring so the prelude arrives as typed leaves (per
   `TIER-B-INTERPOLATION-GRAMMAR-SPEC` §3.4 / `QUOTED-GRAMMAR-STRUCTURING-PLAN` Track S6).
   This ships wrong output today (`@media @{q}` misparse), so it changes real fixtures —
   gate on the `ast/` differential, NOT bridge byte-identity.
2. **S5 folds in as the same method-rewrite.** Once S6 re-expresses the prelude as
   structured children, the prelude-embedded value sites read those children (the
   dispatch-host's prelude actions already do), so their regex evaporates in the same
   edit. Do not touch `_buildAtRulePrelude` twice.

In the collapse-to-one-producer framing, this reduces to: **the dispatch-host's
at-rule-prelude actions become the sole prelude builder** once the grammar emits the
structured prelude child; `_buildAtRulePrelude` is deleted with the rest of the class.

---

## 4. What still genuinely needs legacy `tree/` nodes — the honest blockers

| Blocker | Nature | Clears when |
|---|---|---|
| **Production render (tree/ eval)** consumes `parseLessFn(...).tree` | Real load-bearing dependency (`memory:eval-load-bearing-post-flip`; ast/ render is test-only) | the object-reduction spine becomes production render — the CUTOVER (`committed-architecture-object-reduction`). This is the true gate on *deleting* BuilderHost. |
| **`ast/` import sub-parse** (`import.ts:182`) reads legacy `.tree` | Temporary piggyback | re-point `import.ts` to the dispatch-host (drive `lessGrammar` → `dispatch-host.ts`, read the `ast/` tree). Independent of the cutover; do this first to remove one coupling. |
| **less-compat bridge** maps legacy `tree/` nodes | External contract, but **non-sacred** for this work | re-point bridge adapters to `ast/` fields (`number`/`unit`/`src`) at the less-compat re-point. Bridge byte-identity MAY go red in between (owner-released). |
| **S-A4 custom-prop NAME** (`grammar.ts:96` `customPropInterp` single-leaf) | Protects legacy BuilderHost output, not just the bridge (`GRAMMAR-RELOCATION-DESIGN` §PH2 correction) | split the leaf into `--` + ident + `lessInterp` at retirement; consume via `interpFromRegion`. Gated on the retirement itself, not the ast/ differential alone. |
| **S-Q3.3** (`import.ts` TB-4 + `value-leaf.ts` TB-5 string-interp) | Blocked on the unbuilt §3.3 `Quoted` grammar structuring | land §3.3 (`QUOTED-GRAMMAR-STRUCTURING-PLAN`), then consume the structured `Interp` child. |

**If the bridge were the ONLY blocker, the node-emit flip would land now** and the
bridge would simply go red until its re-point. It is not the only blocker — the
production render is — so the *class deletion* trails the spine cutover even though the
*node model* is ready.

---

## 5. Sequenced execution plan (gate at each step) + honest residual count

Each step gates on the **`ast/` differential** (`alpha-oracle-differential.test.ts` vs
`alpha-oracle-baseline.json`) staying green, PLUS the Jess ratchet where a step touches
legacy-BuilderHost output (S-A4). Bridge byte-identity is expected to go red and is
repaired at the re-point — it is NOT a gate.

| Step | Action | Gate | Bridge |
|---|---|---|---|
| **R0** | Re-point `import.ts:182` off `parseLessFn` onto the dispatch-host (`lessGrammar` → `dispatch-host.ts`, read `ast/` tree). Removes the ast/-front-end coupling to BuilderHost. | ast/ differential + import-race/census tests | unaffected |
| **R1 = S6+S5** | Land the query-prelude grammar split (TB-3), and in the SAME landing fold the prelude-embedded value sites onto the structured children (§3). The dispatch-host prelude actions become the sole prelude builder. | ast/ differential (fixtures change: `@media @{q}`) | red OK |
| **R2 = S-A4** | Split `grammar.ts:96` `customPropInterp` into `--`+ident+`lessInterp` leaves; dispatch-host `custom-props.ts` consumes via `interpFromRegion`. | ast/ differential + **Jess ratchet** | red OK |
| **R3 = S-Q3.3** | After §3.3 `Quoted` structuring lands, consume the `Interp` child in `import.ts` (TB-4) + `value-leaf.ts` (TB-5); drop the char-scan/substring shims. | ast/ differential | red OK |
| **R4 (cutover-gated)** | When the object-reduction spine is production render: delete `parseLessFn` legacy consumers, re-point the less-compat bridge to `ast/` nodes, and **delete `builders.ts` + the `BuilderHost` subclass wholesale.** | ast/ differential + bridge re-point green + full core suite | re-pointed green |

### 5.1 Honest residual count — how many of the ~44 regex this clears

Measured on `origin/dev` `builders.ts` **today** (a moving target — a concurrent agent
is landing S1/S2/S3-clean, so counts drift down): **38 regex-op call sites
(`.test/.exec/.match/matchAll`) + 19 regex-literal defs + 17 `.replace(/…/)`/`.split(/…/)`**.
The burndown's "~64 op + 26 defs" is the pre-S1/S2 figure. The task's "~34 of 44" is the
value/prelude/bridge-fed subset that grammar-relocation + #44 leave behind — this doc's
target set. Deleting the whole file at **R4 takes the `builders.ts` regex count to ZERO
by construction.** But that is only honest if we account for where the logic GOES:

| Category | ~count | Fate under retirement |
|---|---|---|
| **Value classification** (`:1218` num, `:2842/:2852` quoted, `:2914` paren, `:2924` ratio, `:2962` dim, `:2834/:2857/:2954` `@var`, `:2873/:2907/:2958/:3108` accessor, `:2945/:2972/:3028` operand/operator) | ~16 | **VANISH.** The grammar's typed leaves already feed the sole producer (dispatch-host `value-leaf.ts`, regex-free). Genuinely cleared. |
| **Query-/import-prelude tokenize** (`:2632/:2649/:2661-2667/:2676/:2736`, `:3098/:3133/:3139/:3151/:3190`, `:3243/:3252/:3254/:3259`) | ~14 | **VANISH** at R1/R4 once the grammar emits structured prelude leaves (S6/TB-3). Cleared by grammar work, not node-emit alone. |
| **Custom-prop NAME** (paired with `grammar.ts:96`) | ~1 | **VANISH** at R2 (S-A4 grammar split). |
| **String-interp shims** (TB-4 substring, TB-5 char-scan) | ~2 | **VANISH** at R3 once §3.3 structures `Quoted`. |
| **`_buildLegacyMSFilter`** progid IE-filter reconstruction (`:1184/:1185/:1247/:1248/:1249/:1257/:1258`) | ~7 | **MIGRATES, does not vanish.** This is a SEMANTIC reconstruction of one opaque `progid:…` token (port of `processLegacyMSFilterToken`), with no grammar structure to lean on. It relocates to a dispatch-host action (or a dedicated grammar rule, out of A4 scope). Until a grammar `progid` rule exists it remains a **documented synthetic-bytes KEEP** exception, like `literal-tag.ts` `NUM_RE`/`HEX_RE`. |
| **`_lowerFormatString`** `%()` printf lowering (`:1030/:1035`) | ~2 | **MIGRATES, does not vanish.** `%s`/`%d` directive scan over a `Quoted`'s already-parsed inner VALUE — a legitimate semantic transform (not parse-structure re-derivation). It moves to the dispatch-host's FormatCall action and stays as a justified `%`-directive scan. |
| **Trivial** (`:1604` `url(` leaf filter, `:1773` division-like, `:2931/:3065/:3069` `\s`) | ~4 | VANISH (folded into structural children) or shed the regex FORM (trivial string ops), per S2/S3. |

**Honest bottom line:** of the ~34 target regex, **~33 are genuine re-derivation that
disappear** when the dispatch-host becomes the sole producer over a grammar that already
classifies — cleared across R1–R4. **~9 (`_buildLegacyMSFilter` ×7 + `_lowerFormatString`
×2) are SEMANTIC transforms that MIGRATE** to dispatch-host actions rather than vanishing;
a subset (progid, until a grammar rule exists) survives as documented synthetic-bytes
KEEP entries — the same standing exception the burndown already carves out for
`value-operate.ts` `CALC_WRAP_RE` and `literal-tag.ts` `NUM_RE`/`HEX_RE`. Claiming the
retirement clears "all 44" would be dishonest: it clears the *file*, but the progid/`%()`
semantics reappear (fewer, justified) at the sole producer.

### 5.2 Program DONE-criterion

`grep -nE '\.(test|exec|match|matchAll)\(|new RegExp|=\s*/[^/*]' packages/less-parser/src/builders.ts`
returns nothing **because `builders.ts` no longer exists** (R4). The standing
regex-outside-`regex()` law holds on the maintained path (`core/src/ast/**`) except the
documented synthetic-bytes KEEP set (progid until grammared, `CALC_WRAP_RE`,
`NUM_RE`/`HEX_RE`). Closes `PHASE1-BURNDOWN` Cluster 2 (builders.ts) + Cluster 7
(parse-host/BuilderHost deletion) + burndown 0.a/1.b/2.b.

---

## 6. OPEN(owner) items

1. **`_buildLegacyMSFilter` (progid).** Migrate as a dispatch-host action + KEEP its
   regex as documented synthetic bytes, OR add a grammar `progid:` rule (out of A4
   scope, larger)? Recommendation: migrate as-is (KEEP), grammar rule later.
2. **`_lowerFormatString` (`%()`).** Confirm the dispatch-host already owns FormatCall
   lowering, or relocate this method there at R4. (Verify: does `ast/` handle `%()`
   today, or is it BuilderHost-only?)
3. **R4 gating on the spine cutover.** The class deletion trails the production-render
   cutover to the `ast/` spine (the real blocker). If the owner wants the node-emit flip
   and bridge-red to land BEFORE the cutover (leaving BuilderHost as a thin dead shim
   until deletion), R0–R3 can proceed independently; only R4's *deletion* waits.
4. **Bridge re-point ownership.** The less-compat bridge adapter rewrite (legacy `tree/`
   fields → `ast/` `number`/`unit`/`src`) is a less-compat-package task, sequenced at
   R4; who owns it and when.
