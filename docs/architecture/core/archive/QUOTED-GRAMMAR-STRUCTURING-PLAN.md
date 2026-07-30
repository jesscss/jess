# §3.3 Quoted-Grammar Structuring + S6 / TB-4 / TB-5 Execution Plan

> **Historical design evidence — not an execution plan.** Its host,
> `parse-host`, differential/bridge, and later-repoint sequencing assumptions
> are superseded. Retain only the grammar-shape observations after validating
> them against the current public direct `parse() -> Stylesheet` architecture;
> do not preserve or rebuild a bridge to use them.

> **Status:** design-only spec (no grammar/engine/host code changed this pass). Base:
> `origin/dev` @ `b47ddf9fd` ("refactor(ast): eliminate Word"). Resolves the standing
> contradiction between task **#6** ("COMPLETED") and `GRAMMAR-RELOCATION-DESIGN.md`'s
> adversarial-review claim that TB-4/TB-5 are "blocked on the unbuilt §3.3 `Quoted` grammar."
>
> **Governing law:** P0 KEYSTONE (`TREE2-CONSTITUTION.md`, `parser-owns-structure-no-byte-rederivation`)
> — the parser is the SOLE source of structure; the host NEVER re-derives structure from bytes.
> **Correctness gate:** the ast/ differential
> (`packages/core/src/ast/parse-host/__tests__/alpha-oracle-differential.test.ts` vs
> `alpha-oracle-baseline.json`) stays green. **Bridge byte-identity is NON-SACRED**
> (`GRAMMAR-RELOCATION-DESIGN.md` §0, 2026-07-18 owner ruling) and is repaired later at the
> less-compat re-point.

---

## 0. TL;DR

- **The contradiction is a scope mislabel, not a genuine conflict.** Task #6's title advertised
  four interpolation shapes; **two landed** (generic at-rule prelude §3.4, custom-prop VALUE §3.2),
  **two did not** (Quoted-string interior §3.3, custom-prop NAME §3.1). The headline
  "`Quoted = string | Node[]`" deliverable — the §3.3 shape that TB-4/TB-5 need — was **never
  built**. The review is correct; task #6 was closed on the strength of the prelude + cp-value
  shapes.
- **Two DISTINCT grammar prerequisites are conflated in the task framing.** §3.3 `Quoted`
  structuring unblocks **TB-4** (`import.ts`) + **TB-5** (`value-leaf.ts`). The query-prelude
  split (**TB-3**) unblocks **S6** (`_buildAtRulePrelude` query re-tokenize). They are separate
  grammar changes with separate risk profiles; this plan sequences both but keeps them distinct.
- **This cluster clears ~10 regex sites from `builders.ts`, essentially all from S6.** TB-4/TB-5
  clear **0** in `builders.ts` (they are parse-host host-side char-scans; 2 sites there). The
  residual is dominated by the **#44-coupled** value-construction sites (S5) and the **A4-coupled**
  custom-prop-NAME split — neither is unblocked by §3.3 grammar alone.

---

## 1. Contradiction resolution — what EXISTS vs. what is MISSING (with commit evidence)

### 1.1 What task #6 actually landed

Task #6 = "Tier B: structure interpolation in grammar.ts (Quoted = string | Node[], expressions)".
The interpolation-in-grammar work landed across these commits (`git log --oneline --all | grep -iE 'tier.?b|interp'`):

| commit | shape | position | status |
|---|---|---|---|
| `f0cb4896c` `feat(tier-b): structure generic at-rule prelude interpolation` | **§3.4 generic prelude** | `atPrelude` → `preludeToken` run (`grammar.ts:873-896`) | **LANDED** |
| `a078d5dfe` `feat(tier-b): structure custom-property VALUE interpolation` | **§3.2 cp-VALUE** | `cpInner`/`cpValue` `lessInterp`-first (`grammar.ts:500,504`) | **LANDED** |
| (pre-existing) `InterpolatedSelector` | selector interp | `grammar.ts:294-298` | LANDED (predates #6) |
| `e5f754a7b` `docs(tier-b): defer import-specifier shape (§3.3-coupled)` | **§3.3-coupled defer** | — | **explicitly DEFERRED** |
| `eaaf41f1c` `docs(tier-b): tag deferred dual-use accommodations with TODO(tier-b/A4)` | A4 markers | — | deferral bookkeeping |

Two positions were **explicitly deferred, in writing, at #6's own landing**:
- **cp-NAME (§3.1):** `a078d5dfe`'s own message — *"the custom-prop NAME split is NOT landed …
  splitting it into leaves regressed the bridge's custom-prop name emission … The name stays one
  grammar leaf + `declName` until the legacy-builder retirement (reorg Phase A4)."*
- **Quoted string interior (§3.3):** `e5f754a7b`'s title literally reads *"defer import-specifier
  shape (§3.3-coupled)."*

### 1.2 What the grammar emits TODAY (verified on `origin/dev`)

| position | grammar rule | structured `@{…}` child? | evidence |
|---|---|---|---|
| **value-position ident** (`@{c}`, `pre-@{x}`) | `InterpValue`→`interpKey` (`grammar.ts:526`) | **YES** | isolated `lessInterp` leaf |
| **selector** (`.a-@{n}`) | `InterpolatedSelector` (`grammar.ts:294`) | **YES** | interleaved leaves |
| **custom-prop VALUE** (`--x: @{a}`) | `cpInner`/`cpValue` (`grammar.ts:500,504`) | **YES** (§3.2 landed) | `lessInterp` first alt |
| **generic at-rule prelude** (`@keyframes @{n}`) | `atPrelude`→`preludeToken` (`grammar.ts:884`) | **YES** (§3.4 landed) | `lessInterp`/`nestedRef`/`lessVar` isolated among `preludeChunk` |
| **custom-prop NAME** (`--@{k}`) | `customPropInterp` (`grammar.ts:96`) | **NO** — one opaque regex leaf | single `regex(/--…@\{…\}…/)`; A4-coupled |
| **query prelude** (`@media @{q}`) | `QueryCondition` &co (`grammar.ts:900-945`) | **NO** for the builder path — the `less-parser` builder still receives a text region and hand-tokenizes it in `_buildAtRulePrelude` | see §3 |
| **Quoted string interior** (`"a@{b}c"`) | `Quoted` = `choice(singleStr, doubleStr)` (shared css `grammar.ts:573`; less `singleStr`/`doubleStr` = `grammar.ts:59-60`) | **NO** — flat regex swallows the whole `'…'`/`"…"` including any `@{…}` | **the §3.3 gap** |

**The §3.3 gap, in the source's own words** — `value-leaf.ts:71-89` JSDoc:
> *"the maintained grammar emits the whole `"…@{…}…"` as ONE opaque `singleStr`/`doubleStr` leaf
> (interpolation inside a string is not split), so the direct ast/ host re-scans the bytes here …
> RETIREMENT TRIGGER — the §3.3 `Quoted` grammar split (structured `string | Node[]`)."*

And `TIER-B-INTERPOLATION-GRAMMAR-SPEC.md` §1.3:
> *"`singleStr`/`doubleStr` … are flat regexes matching the whole `'…'`/`"…"` including any `@{…}`
> inside. Interpolation inside a string is **not** parsed. … **This is the highest-risk change**
> (§5) and is NOT required for any *Less* Tier-0b deletion."*

### 1.3 The consumers that STILL char-scan today, and why

| consumer | site | shape consumed | why it still char-scans |
|---|---|---|---|
| **TB-5** `value-leaf.ts` `quotedInterp` | `:90-117` | the flat `Quoted` leaf's whole bytes | grammar hands one opaque string leaf; the host walks bytes for `@{ident}` (a hand-rolled `charCodeAt` scanner, lines 96-113) to build an `Interp` |
| **TB-4** `import.ts` `directSpecifier` | `:464-486` | `pathNode.value` (flat `Quoted` inner text) | `raw.includes('@{') || raw.includes('@@')` (`:484`) — a substring test on the opaque path string, because the `@{…}` lives INSIDE the `Quoted` string, not as a child node |
| **S6** `builders.ts` `_buildAtRulePrelude` | `:2833-~3020` (method spans ~2524–2898 per doc, drifted) | a **text region** for the media/supports/container query prelude | the query path builds `QueryCondition` (`:2934`, `:3011`) from a hand-tokenized string — the grammar delivers the query prelude as a region the builder re-splits (whitespace-normalize `:3024-3026`, dim/ratio re-split `:2924/:2962`, comparison-op `/[><=!]/`), i.e. the builder-side twin of the TB-3 coverage gap |

Each char-scans because **the grammar has not emitted the structured child it would otherwise
consume** — a textbook P0 (`parser-owns-structure`) violation held open by a missing grammar rule.

### 1.4 Verdict

> **RESOLVED.** Task #6 structured the **value-position, selector, cp-VALUE, and generic-prelude**
> interpolation. It did **NOT** structure the **Quoted string interior (§3.3)** — the very shape
> named in its own title — nor the **cp-NAME (§3.1)** or the **query prelude (TB-3)**. The
> adversarial review's "TB-4/TB-5 blocked on the unbuilt §3.3 `Quoted` grammar structuring that
> does not exist on `origin/dev`" is **factually correct**. Both claims coexist because "task #6
> = done" refers to the shapes that landed, while "§3.3 unbuilt" refers to the shape that was
> deferred at that same landing (commit `e5f754a7b`).

---

## 2. §3.3 grammar design — structured `Quoted` interpolation

### 2.1 Target (payload shape (A), per spec §2 recommendation)

Emit the **leaf-split** shape (interleaved literal-chunk + `lessInterp` leaves), NOT a nested
`Interp` node — because Less `@{…}` is **name-only** (`lessInterp = @{ident}`, `grammar.ts:86`),
so a leaf carries everything a node would. The host consumes it with the **existing**
`interpFromLeaves`/`interpFromRegion` consumer (`interp.ts`) — the same seam cp-VALUE and the
generic prelude already use. Shape (B) (a `node('Interp', sequence('@{', <expr>, '}'))`) is the
follow-on the **scss/jess** grammars land for full-expression `#{…}`/`${…}`; it is a local upgrade
to `interpName`/`interpFromLeaves` only and adds ZERO throwaway here (spec §7 Q1, owner-endorsed).

### 2.2 Grammar edit (`less-parser/src/grammar.ts` — Less OVERRIDE only, do NOT touch css base)

Plain CSS has no interpolation, so the shared css `Quoted` stays the flat two-regex form; Less
overrides it with an interpolation-aware arm that keeps the flat regex as the fast/plain path:

```ts
// Less override (less-parser/grammar.ts). Interpolated arm FIRST; a string with no
// `@{` falls to the flat singleStr/doubleStr leaf (byte-identical to today).
const dqChunk = regex(/(?:[^"\\@]|\\[\s\S]|@(?!\{))+/);   // body up to @{ or "
const sqChunk = regex(/(?:[^'\\@]|\\[\s\S]|@(?!\{))+/);
const QuotedInterp = node('Quoted', choice(
  sequence(literal('"'), many(choice(lessInterp, dqChunk)), literal('"')),
  sequence(literal("'"), many(choice(lessInterp, sqChunk)), literal("'"))));
const Quoted = node('Quoted', choice(QuotedInterp, singleStr, doubleStr));
```

**Invariants the chunk regex MUST hold (spec §6 break-mode 1):**
- `@(?!\{)` — a bare `@name` inside a string stays literal (owner rule: strings resolve only `@{…}`).
- `\\[\s\S]` — an escaped `\@{x}` stays in the chunk and never becomes a ref.
- `""` → zero children (a `many` that matches nothing), NOT a stray empty chunk.
- `"@{a}"` end-to-end → one ref leaf, no zero-width literal chunk that serializes differently.
- Nested `@{@{x}}` is structurally impossible to over-match: `lessInterp` is name-only, so
  `@{@{x}}` falls to the chunk verbatim (Less has no nested interpolation — do not start supporting it).
- **§4.1 strictness (owner decision, LOCKED):** `lessInterp` is `@{name}`-only; `"@{ x }"`
  (interior whitespace) and `"@{a.b}"` (dot) are NOT interpolation — they stay literal chunks.
  This diverges from the bridge's permissive `_buildStringInterpolation`/`INTERPOLATION_REGEX`
  (`/([$@])\{([^}]+)\}/g`); that divergence is **intended** (matches real Less 4.x), and any expected output
  leaning on the permissive misread is corrected (suspect-expected-output rule, validate vs real 4.x).

### 2.3 Host consumers, post-grammar

- **TB-5 `value-leaf.ts` `quotedLeaf`:** add a branch — leaves present → `interpFromLeaves(…, unquote:true)`
  wrapped in a `Quoted`; single flat leaf → today's `LitFields` path unchanged. **DELETE** the
  hand-rolled `quotedInterp` charCode scanner (`:90-117`). `escapedLeaf` (`:150-158`) reuses the
  same leaf walk on the inner (`~"…"`) leaves.
- **TB-4 `import.ts` `directSpecifier`:** the path `Quoted` now carries interp children → read the
  node type (`Interpolated`/structured `Quoted`) instead of `raw.includes('@{')`. **DELETE** the
  `:484` substring test; the interpolated-vs-plain decision reads structure.
- **Payload pre-widen (spec §7 Q1 guardrail ii):** declare `InterpPart.ref` as a general value-node
  type NOW (not narrowly `VarRef`) so the later (A)→(B) widen needs no serializer/resolver fan-out.

### 2.4 Shared `Quoted` caveat (why §3.3 is genuinely coupled)

`Quoted` is **shared** — the legacy BuilderHost that drives the less-compat bridge re-tokenizes the
SAME `Quoted` via `INTERPOLATION_REGEX`/`getInterpolatedNode` to rebuild its `Interpolated` node.
Overriding the Less `Quoted` **breaks bridge byte-identity by construction** (the bridge's
`_buildStringInterpolation` and the grammar now disagree on tokenization). Under the 2026-07-18
owner ruling that is **acceptable**: gate on the ast/ differential, let the bridge tests go red, and
repair them at the less-compat re-point (or delete the bridge re-tokenizer with P1). The bridge's
own `_buildStringInterpolation` (`builders.ts` — the `INTERPOLATION_REGEX` consumer) is NOT deleted
by this grammar change; it dies with the bridge (P1) / #44, so **§3.3 clears no `builders.ts` regex
directly** — its payoff is host-side (TB-4/TB-5) plus enabling the eventual bridge deletion.

---

## 3. Sequenced execution plan

The task frames "S6 / TB-4 / TB-5" as one cluster; disentangled, it is **two grammar prerequisites**
feeding three consumer edits:

- **§3.3 `Quoted` structuring** → unblocks **TB-4** (`import.ts`) + **TB-5** (`value-leaf.ts`).
- **TB-3 query-prelude split** → unblocks **S6** (`_buildAtRulePrelude` query re-tokenize).

They are independent of each other (different grammar rules, different consumers) and may land in
either order. Within each, the ordering is **grammar first → consumer stops char-scanning →
builders regex deletion**, gated at every step on the ast/ differential.

### Track Q — §3.3 Quoted (unblocks TB-4 + TB-5)

| step | change | gate |
|---|---|---|
| Q0 | **Parser CST fixtures FIRST.** Pin current bytes for `""`, `"\@{x}"`, `"@{a}"`, `"a@{b}c"`, `"@{a}@{b}"`, single-quote twins, `"@{ x }"`/`"@{a.b}"` (§4.1 stay-literal), plus a shared-prefix backtrack check (the new `choice` arms share leading `"`/`'`). | new CST byte-snapshots pass |
| Q1 | **Grammar:** add the Less `Quoted` override (§2.2). No host change yet — the flat arm still matches plain strings; the interpolated arm now emits leaves the host does not yet read. | `less-parser` CST tests; ast/ differential unchanged (host ignores new leaves → same output) |
| Q2 | **TB-5:** `value-leaf.ts` `quotedLeaf`/`escapedLeaf` consume the interp leaves via `interpFromLeaves(unquote:true)`; **delete** `quotedInterp` (`:90-117`). | ast/ differential green; `value-expr` / string-interp host suites |
| Q3 | **TB-4:** `import.ts` `directSpecifier` reads the structured path node; **delete** the `:484` `.includes('@{')/'@@'` substring test. | `import-*-byte-identity` suites (direct path); ast/ differential green |
| Q4 | Bridge byte-identity repair (deferred): re-point less-compat OR let the bridge's `_buildStringInterpolation` die with P1. NON-SACRED — not a Track-Q blocker. | (bridge suite may be red until the re-point) |

### Track S6 — TB-3 query-prelude split (the coordinated `_buildAtRulePrelude` rewrite)

**Coupling (relocation-doc correction #1, authoritative):** **S5 and S6 edit the SAME method**
`_buildAtRulePrelude` (`builders.ts` ~2524–2898). S5's in-method prelude value construction and
S6's query re-tokenize live in one method body, so they are **one coordinated method-rewrite**, OR
**S6 lands first** and re-expresses S5's in-method value sites. They CANNOT be disjoint parallel
commits. The **four prelude-embedded L4 sites** (`:2789` `nsMediaRe`, `:2824`, `:2830`, `:2842`)
move **INTO** this S6 rewrite (they are inside `_buildAtRulePrelude`), out of the independent S3
subset.

| step | change | gate |
|---|---|---|
| S6.0 | **Parser tests FIRST (spec §6 break-mode 2).** Pin byte-exact preludes for the byte-preserving cases `@media  screen` (double space), `@page :first`, `@supports (a:b)`, AND the correction cases `@media @{q}`, `@media @{a.b}` (generic path, §4.1 stay-literal). | CST byte-snapshots pass |
| S6.1 | **Grammar (TB-3):** split the query prelude (`QueryCondition`/`QueryInParens`/`QueryFeature`) into structured leaves — literal runs, `lessInterp`, `lessVar`, `@@name`, comparison-op terminal (reuse `compareOp` `grammar.ts:235`), number+unit `Dimension` child, ratio child — so the media/supports/container prelude is no longer one opaque region. **Trivia re-join hazard:** ambient `rw` must reproduce `@media  screen`'s internal spacing byte-exactly. | `less-parser` CST tests; over-structuring check (pure CSS `@media screen and (min-width:600px)` gains NO interp structure) |
| S6.2 | **parse-host PH1:** `at-rules.ts` query path consumes the structured leaves (leaf walk → `Interp`/`VarIndirect`/`VarRef`/`Word`), replacing `AT_KEYWORD`/`parsePreludeValue`'s regexes (`:203/:209/:235`). | `at-rules-host-byte-identity` + `charset-host-byte-identity`; ast/ differential (with the `@media @{q}` **expected-output correction** isolated + owner-reviewed) |
| S6.3 | **builders `_buildAtRulePrelude` rewrite:** consume the grammar query-prelude leaves; **delete** the L5 hand-tokenizer regexes + the 4 prelude-embedded L4 sites. Coordinate with S5's in-method value sites per correction #1 (either fold S5 in, or land S6 first and re-express). | ast/ differential green; `@media @{q}` correction owner-reviewed |

> **Expected-output-correction discipline (spec §6.2, owner decision 2026-07-17 "fix it inline"):** the
> generic-prelude early-termination bug is already fixed (`f0cb4896c`); the query path's
> `@media @{q}` misparse is corrected by S6.2, NOT byte-preserved. Isolate the correction, prove
> against real Less 4.x + the alpha `.css`, get owner review before landing (suspect-expected-output rule) —
> do not let it ride silently through the byte-identity gate.

### Cross-track ordering

Track Q and Track S6 are independent; recommend **Track Q first** (lower blast radius — the plain
string fast-arm keeps §3.3 behind a byte-safe fallback, and TB-4/TB-5 are host-only deletions),
then the **S6 coordinated method-rewrite** (higher risk: real fixture corrections + the S5 coupling).
Neither blocks on #44's node-model migration EXCEPT the value-literal constructions inside S6's
method (the `Dimension`/ratio/`Quoted` `new …(…)` sites), which stay **PENDING #44** — see §4.

---

## 4. Residual regex estimate (builders.ts) + what still can't be killed

**Accounting note.** `GRAMMAR-RELOCATION-DESIGN.md` counts `builders.ts` as **64 regex-op call
sites + 26 literal defs → 55 distinct classification shapes** (its numbers are declared verified);
a narrower inline-only grep on `origin/dev` reports ~36. Line numbers in the relocation doc have
drifted slightly against the current file (import-prelude and value-reclassify regexes now interleave
around `:2632–2873`), but the **cluster membership** is stable. The task's "44 remaining" is the
post-`S1+S2+non-prelude-S3` figure (correction #7's cleared subset is landing now on
`work/regex-kill-s1-s2-s3clean`). Estimates below are expressed in the relocation doc's own units.

### What THIS cluster clears

| sub-cluster | consumer | builders.ts regex cleared |
|---|---|---|
| **S6** (TB-3 query prelude) | `_buildAtRulePrelude` rewrite | **~10** — L5 query-tokenizer cluster (`/[><=!]/`, whitespace-normalize `.replace` ×3, `/\s/` ×2, function-name sniff + `.replace(/^@/)`) **+ the 4 prelude-embedded L4 sites** (`:2789`+`:2824`, `:2830`, `:2842`) moved in by correction #1 |
| **TB-4** (§3.3) | `import.ts:484` | **0 in builders.ts** — a parse-host `.includes` substring, not a `builders.ts` regex |
| **TB-5** (§3.3) | `value-leaf.ts:90-117` | **0 in builders.ts** — a parse-host charCode scanner |

> **Cluster total against `builders.ts`: ~10 sites (all from S6).** The two `@{…}`-in-Quoted
> consumers (TB-4, TB-5) clear **host-side** char-scans in `core/ast/parse-host/**` (2 sites) and
> **zero** in `builders.ts`. Of the task's "44 remaining", this cluster removes **~10 → ~34 remain**.

### What STILL can't be killed after this cluster, and why

1. **S5 — value-literal construction sites (`≥14`, FLOOR not exact) → blocked on #44, NOT §3.3.**
   Even once §3.3 hands the builder a structured `Quoted` child, the builder still cannot drop its
   `new Quoted(...)` / `new Dimension(...)` / `new Color(...)` until #44 fixes the literal field
   shape (PascalCase `type`, verbatim image, `Word` elimination). This includes L1 (Dimension/ratio,
   4 — incl. the `:2924` ratio + `:2962` dim re-split INSIDE `_buildAtRulePrelude`), L2 (var/escaped-
   str/quoted/paren/operand, ~6 — incl. `escapedStrRe` `:2842`, `singleVarRe` `:2834`, `varAccRe`
   `:2873`, plain-str `:2852`), L3 quoted-path (import `Quoted`, ~4 — `:2649/:2676/…`), accessor-KEY
   `new Quoted` (2), plus the un-enumerated `new Color`/`new Quoted` FLOOR sites (relocation §5 #5).
   **Note the S5/S6 method overlap:** several S5 value-construction regexes physically sit inside
   `_buildAtRulePrelude`, which is exactly why correction #1 forbids scheduling S5/S6 as disjoint
   commits — the S6 rewrite must either fold them in or land first and re-express them.

2. **S-A4 — custom-prop NAME (`customPropInterp` split + `custom-props.ts` @{}-in-NAME) → blocked
   on legacy-BuilderHost retirement (reorg A4), NOT §3.3.** The single-leaf NAME shape
   (`grammar.ts:96`) protects the **legacy/maintained BuilderHost** output, not only the bridge
   (grammar retirement note: *"when the legacy BuilderHost is retired, reorg A4"*). Gated on the
   Jess ratchet / A4, carries an unscoped legacy-builder name edit — never part of this cluster.

3. **Bridge `_buildStringInterpolation` (the `INTERPOLATION_REGEX` consumer) → dies with the bridge
   (P1), NOT with §3.3.** §3.3 is its *precondition*, but the grammar change does not delete it;
   the bridge re-tokenizer is removed at the less-compat re-point / P1.

4. **Documented KEEP set (synthetic-bytes, no parse origin)** — `value-operate.ts` `CALC_WRAP_RE`,
   `literal-tag.ts` `NUM_RE`/`HEX_RE` (until a structured `Numeric` tag leaf), and the synthetic
   `isQuotedBytes`/`QUOTE_RE` default for computed/joined strings (spec §1.3, §4). These are clean
   REJECTs — not relocation targets.

5. **L5 prelude-var WARNING regexes** (`:1497` `/@[a-zA-Z][\w-]*/`, `:1504` `/\$…/`, `:1539/:1561`
   bare-`@var`) — (c)/warning-path, may shed the regex form but are not query-structure consumers;
   tracked separately, not cleared by the S6 structure rewrite itself.

**After this cluster:** `builders.ts` retains ~34 sites, dominated by the **#44-coupled S5 value
constructions** and the **A4-coupled custom-prop-NAME split**. The standing law grep
(`grep -nE '\.(test|exec|match|matchAll)\(|new RegExp|=\s*/[^/*]'`) reaches EMPTY only after S5
(with #44) + S-A4 (with A4) + the KEEP-set documentation land — this cluster is a necessary but not
sufficient step toward that DONE-criterion.

---

## 5. Gate summary

- **Every landing gates on the ast/ differential** (`alpha-oracle-differential.test.ts` vs
  `alpha-oracle-baseline.json`) staying green, plus the relevant `*-host-byte-identity` suite.
- **Parser CST byte-snapshots FIRST** for each split (Q0, S6.0), including a shared-prefix/backtrack
  regression check (§3.3/TB-3 add ordered `choice` arms sharing a leading char).
- **Expected-output corrections** (`@media @{q}` query misparse) are isolated, proven vs real Less 4.x + the
  alpha `.css`, and owner-reviewed — never ridden silently through byte-identity.
- **Bridge byte-identity is NON-SACRED** and repaired at the less-compat re-point.
- **Full workspace build** before any fail-count is trusted (`all-less needs FULL workspace built`).
