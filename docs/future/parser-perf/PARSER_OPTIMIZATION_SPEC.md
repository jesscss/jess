# Parser Optimization Spec — css / less / scss / jess

> **WIP — reconcile with the reorg-A4 plan before acting.** `ast/parse-host/` is COLLAPSING
> (reorg-A4; see `HANDOFF.md`). The canonical inventory + sequencing for relocating every
> parse-host/`builders.ts` regex site into the grammar already lives in
> **`../core-architecture/GRAMMAR-RELOCATION-DESIGN.md`** (clusters PH1–PH3, S4/S-A4/S-Q3.3,
> A4-coupling, bridge rulings) and **`BUILDERHOST-RETIREMENT-DESIGN.md`**. That doc is the source
> of truth for the scanner-elimination mechanics — §3 here duplicates it less precisely and should
> be read as a cross-reference, not an independent authority. Corrections it supplies: SCAN-A3/PH2
> protects the **legacy/maintained BuilderHost output, not only the less-compat bridge**; the
> `import.ts` interp-specifier scanners are **blocked on §3.3 `Quoted` grammar structuring** (not
> yet on `origin/dev`). **The genuinely-new, non-duplicative value of THIS doc** is the perf lens
> the reorg docs don't cover: Parséman macro-compiler dispatch leverage (first-set / `FusedRule` /
> `GatedArm`), `choice`/shared-prefix restructuring, and dart-sass single-pass elision.

**Status:** research + authoring only. **Nothing here is implemented; do not edit
`grammar*.ts` / `builders.ts` / `actions/*.ts` on the strength of this doc alone.** Every
item is a candidate for a *separate*, measured landing gated on ON==OFF byte-identity. An
adversarial reviewer is expected; each item carries evidence, the exact mechanism, a
predicted win/effort, byte-safety, break-even, and known risks so it can be torn into.

Scope weighting (per the task): **SCSS first and deepest**, then Less, CSS, Jess.

**Spine (owner-directed priority order):**
1. **[PRIMARY] Eliminate post-parse scanners + runtime regex** that re-derive structure
   from bytes the parser already consumed (keystone: *parser owns structure*). §3.
2. **Grammar restructurings that let the macro-compiler dispatch/fuse** instead of
   backtracking (shared-prefix / first-set work). §4.
3. **dart-sass single-pass runtime-elision lessons.** §5.
4. **Verify the macro transform fires for all four parsers.** §2.1.

Plus the Parséman API leverage map (§2), the ranked backlog (§6), and capability-gap
flags for Parséman itself (§7).

---

## 0. TL;DR for a reviewer in a hurry

- **The macro transform fires cleanly for all four grammars** (§2.1). Built
  `lib/grammar.js`: css 54 / less 123 / scss 170 / jess 95 compiled `_r_<Name>` fns, and
  62 / 144 / 250 / 85 `codePointAt` first-char dispatch sites respectively; **exactly one
  stray textual `choice(`/`sequence(` per file** (a comment/string, not a runtime
  combinator graph). **No parser silently falls back to interpreted** — the "something
  weird" case did not happen. So compilation is *on*; it is not a lever.
- **[PRIMARY]** The real waste the owner named is **post-parse runtime regex that
  re-derives structure from bytes.** Two populations (§3):
  - **CLASS A/B — LIVE on the `ast/` render path** (core `ast/parse-host/actions/*.ts`,
    `host-context.ts`, and `import.ts` via `resolveDirectImports`): `@{…}`/`${…}` interpolation
    **byte re-tokenizers**, declaration **name/value/`!important` byte re-splitting**, and
    **import-prelude re-derivation** (`url()`/options/`.css`/interp-template). **These will NOT
    die when the legacy producer retires — they must be actively eliminated by making the
    grammar emit the structure** (split the selector/name/prelude positions into interpolation
    leaves; consume the `Url` inner / option-list / `!important` leaves instead of re-scanning).
    This is the keystone violation. **One exception — SCAN-A3 (custom-prop `--@{k}` name) is
    BLOCKED behind BuilderHost retirement.** Its regex is live on the ast/ path (costs render now),
    but it is NOT removable today: the grammar must emit the single flat name leaf so the legacy
    BuilderHost bridge emits the correct name (splitting early regresses `--@{k}`→`--`). BuilderHost
    death does not delete it for free — it UNBLOCKS the fix. At A4, once the bridge consumer is gone:
    split the grammar production + delete `interpFromString`. Do NOT attempt before A4.
  - **CLASS C — legacy `builders.ts` producers** (scss ~8 sites incl. the worst offenders
    at `311/344/427/1153/1376`; less ~74 incl. `1201/1234/1263`). **Confirmed OFF the
    `ast/` path** — core drives the grammar `build` callback through `dispatch-host.ts`,
    never the parser packages' `buildNode`. These vanish **free** when the legacy tree/
    producer + BuilderHost retire (`parser-regex-endgame-is-engine-cutover`); predicted
    `ast/` render win **≈ 0 ms** — inventory them, do not budget render time.
- **Measured floor (this doc, built `lib/`, N=61 median, warmup 25):** SCSS parse of
  `gen-workload.scss` (287,543 B) = **68.96 ms** (min 66.88). Less parse of
  `benchmark.less` (106,802 B) = **24.42 ms** (min 23.48). SCSS parse self-time is
  **63.9 % in `grammar.js`**. **Biggest single SCSS grammar fn: `_r_value` at 8.8 %**,
  then the inherited math ladder `_r_topProduct` 5.4 % + `_r_topSum` 5.3 % = 10.7 %, then
  the selector cluster ≈ 11.5 %.
- **The dominant grammar anti-pattern (§4):** non-disjoint statement/value/selector
  `choice`es where many arms share a first char (`@`, `$`, `.`/`#`/ident). Parséman's
  `firstMatch` does **not** pre-filter by first-set — it invokes *every* arm in order. Most
  arms fail cheaply (an anchored sticky-regex mismatch at char 0), so the real cost is
  **dominated by the 1–2 arms that do actual work before failing** (in SCSS
  `NsVarDeclaration` parses a full ident before failing at the missing `.`), plus the
  fixed per-arm `saveCstMark`/rollback bookkeeping — not 15 expensive descents. The count
  of arms is the anti-pattern; the *magnitude* rides on how many of them parse real input.

---

## 1. Scope, methodology, floor, LAWS

### 1.1 Read
- **Parséman v0.27.0 source** (`~/git/oss/parser-thing/src`, linked via `link:`) — the
  full combinator set (`combinators/`), macro-compile seam (`compiler/`), regex first-set
  derivation (`regex/`), CST capture (`cst/`), `CHANGELOG.md` 0.26.0→0.27.0.
- **All four grammars** + each parser's `functional-parser.ts`, `functional-driver.ts`,
  `builders.ts`, `cst.ts`, scss helper files.
- **Core `ast/parse-host/`** — `dispatch-host.ts`, `host-context.ts`, and `actions/*.ts`
  (the LIVE build path).
- **`docs/future/core-architecture/PERF_IDEAS.md`** (measured Less profile + dart-sass
  audit) and **`docs/future/parseman-perf-proposals.md`** (parseman-SIDE proposals —
  *different scope*; this doc is grammar/action-side, not parseman-internal).

### 1.2 Measured (this doc)
- **Median parse timing**, built `lib/` (the production artifact, per the PERF_IDEAS
  caveat that absolute numbers shift against the vitest src transform): warmup 25, N=61.
- **V8 CPU sampling profile** of the SCSS parse path (`--cpu-prof --cpu-prof-interval=50`,
  30-iter warmup + 250 profiled iterations over `gen-workload.scss`, self-time by compiled
  fn) — the **first SCSS-specific parse profile** (PERF_IDEAS only profiled Less). Throwaway
  harnesses deleted after capture.

### 1.3 Floor
Never regress the `ast/` **~46.6 ms** whole-render floor (PERF_IDEAS) nor the SCSS/Less
parse medians above. **Byte-identity (CST + emitted CSS) is the hard floor for every
item.** Re-confirm every parser lever against built `lib/` before landing (this doc's
numbers already are).

### 1.4 LAWS every item respects (reviewer: check these)
- **No regex outside Parséman `regex()`/`keywords()`** — every proposed gate is a
  combinator (`not`, `guard`, disjoint `choice`, `keywords()`, `scanTo`), never an ad-hoc
  `String` scan. The PRIMARY section (§3) is precisely about *removing* the ad-hoc scans.
- **Parser owns structure; core/builders NEVER re-derive from bytes** — the §3 keystone.
- **No structural node flattened to `Any`** — a value/selector list stays a structured
  node; verbatim output serializes the structured node (it does not re-parse bytes).
- **No `as any`/`: any`/`@ts-ignore`.** (Existing `(g: any)` rule-factory is the composed-
  grammar seam, not new.)
- **Every perf claim = predicted-from-real-fixture profile + break-even.** Items unmeasured
  on a representative fixture are flagged **HYPOTHESIS** and gated on a profile before
  landing.

---

## 2. Parséman API leverage map

### 2.1 Verify the macro fired (owner's "something weird" check) — CLEAN

`tsdown.config.ts` runs `parseman.rolldown()`; `vitest.config.ts` runs `parseman.vite()`.
Both compile grammars importing `parseman with { type: 'macro' }` (present at
`css grammar.ts` header + `:17`, `less :13`, `scss :13`, `jess :25`). Built-output evidence:

| Parser | `lib/grammar.js` lines | compiled `_r_` fns | `codePointAt` dispatch sites | stray runtime `choice(`/`sequence(` |
|---|---|---|---|---|
| css  | 16,688 | 54  | 62  | 1 |
| less | 41,814 | 123 | 144 | 1 |
| scss | 81,207 | 170 | 250 | 1 |
| jess | 29,786 | 95  | 85  | 1 |

All four are flat compiled code with first-char dispatch tables; the single textual
`choice(`/`sequence(` per file is a comment/string, not a live combinator graph. **No
interpreted fallback anywhere** — there is no free "turn compilation on" win. (If a future
build regresses this table — e.g. `_r_` count collapses toward 0 or stray `choice(` count
spikes — that *would* be the "something weird" bug; keep this table as the tripwire.)

### 2.2 The cost model that grounds every §4 bullet (`combinators/choice.ts`)

| Feature | What it does | Cost | Jess uses it? | Apply where |
|---|---|---|---|---|
| **Disjoint `choice`** (`choice.ts:35,59,87`) | Pairwise-disjoint non-nullable arm first-sets → 128-entry ASCII table → **O(1)** first-char dispatch, one arm, no backtrack. | O(1)+1 parse | Yes, where authored disjoint (css `simpleSelector`). | Every hot non-disjoint choice (§4). |
| **`firstMatch` fallback** (`choice.ts:51,144–165`) | Any non-disjoint/non-strategy choice: tries **every** arm in order, **no first-set pre-filter**; each failed arm pays a real parse + `saveCstMark`/`rollbackCstCapture` + `_triviaLog` truncation. | O(arms) descents | Yes, pervasively (scss `scssStatement` 17-arm, jess `Stylesheet` 8×`$`/9×`@`, css `declarationList` 4×`@`, every `value`). | The thing to eliminate. |
| **Gated arm** `{gate,combinator}` (`choice.ts:17,146`) | Per-arm `(ctx.state)⇒bool`; false ⇒ arm skipped **without parsing**. | predicate only | Yes (scss/jess `&`-gate on `inner`). | Context vetoes, not lookahead. |
| **Gated-disjoint dispatch** (0.26.1; `choice.ts:29,95`) | A gated arm with non-nullable disjoint first-set keeps its O(1) slot. | O(1) | Partially — the `&`-gate is only O(1) if the *other* arms are disjoint (they currently are not, §4.1 SCSS-6). | Keep gated arms inside an otherwise-disjoint choice. |
| **`greedyClassify`** (`choice.ts:120–200`) | One regex arm subsuming N literals → one parse + string-equality classify. | 1 parse | Not exploited. | keyword-vs-catchall where a regex superset exists. |
| **`keywords(words,{boundary})`** (`combinators/keywords.ts`) | One sticky-regex alternation, longest-first, boundary; real first-set. | 1 regex | **No** — grammars hand-roll `regex(/@if(?![-\w])/i)` arms. | `@`/`$`-keyword classifiers (§4.2). Caveat: returns *which* keyword, not a *production* — value-dependent production dispatch still needs left-factoring. |
| **`not(p)`** (`combinators/not.ts`) | Neg lookahead: **runs the inner parser** then rolls back (`firstSet=any`, so never aids dispatch). Positive = `not(not(p))`. | 1 parse+rollback | Yes, heavily (`not(selectorBoundary)` per selector iter; `not(not(importPathStart))` per import comma). | Gate `not(regex)` behind a first-char peek (§4.1 LESS-2). |
| **`guard(pred)`** | Zero-width `ctx.state` assertion (`firstSet=any`). | predicate | Yes (`inner` gate). | Context gates only. |
| **`scanTo`/`balanced`** | Linear scan to terminator with balanced/string skips; not backtracking. | O(chars) | Yes (at-rule preludes, `@forward`/`@import` tails). | Fine where used; a balanced-`:` peek could gate `ScssMapLiteral` (§4.1 SCSS-5). |
| **`run(entry,input,{profile:true})`** (0.27.0 NEW; `functional/run.ts`) | Three passes — **recognizer** / **structural-capture** / **host-construction** — per-pass `{ms,nodes,childSlots,rawSlots,triviaSlots,fieldSlots,hostCalls}`, byte-identical when omitted. | measurement | **No — Jess never calls it.** | **Tooling lever (§4.6):** attribute a lever to recognition vs capture vs host natively; catch compose-fusion dispatch regressions as a recognizer-pass spike. |
| **Macro fusion / linker** (`compiler/linker.ts`) | `compose([base,delta])` fuses to one closure; sibling refs = **direct local calls (0 % dispatch)**; override-by-name reroutes every call (open recursion). | build-time | Yes (`less/scss/jess = compose([...])`). | Call graph already optimal. |
| **First-set under compose** (`first-set.ts:99–111`) | A baked deep first-set is **unsound under override** (a delta can widen a rule's first-set) → dispatch deferred to fuse time; 0.26.1/0.26.2/0.26.3 fixed cases where a gated `choice`/`withCtx` silently dropped to a runtime fuse and lost dispatch. | — | Yes — all dialects compose + override base rules. | **Audit (§4.5):** verify overridden `value`/`Stylesheet`/`declarationList`/`simpleSelector` keep dispatch after fusion. |
| **`RegexFirstSetAnalyzer`** (`regex/first-set.ts`) | Derives a first-set from a regex arm. | build-time | Yes (implicit) — which is *why* `@if`/`@each` regex arms all get first-set `{@}` and are therefore **non-disjoint**. | Explains why §4.2 needs left-factoring, not just "add first-sets". |
| **Bare-terminal trivia-frame elision** (0.27.0; `compiler/fields.ts`) | A `node()` over a bare terminal can't log trivia → its trivia frame is elided at compile; measured CSS ~2–4 % faster. | removes dead frames | **Automatic** in 0.27.0 (Num/Color/Quoted already benefit). | Nothing to author; narrows PERF_IDEAS #4/D to non-bare nodes. |

**Bottom line:** Jess uses the compiler, fusion, gated arms, `scanTo`, the regex analyzer,
and 0.27.0 trivia-elision. It **under-uses disjoint dispatch on hot choices** (§4), **does
not use `keywords()`** for keyword classification, and **does not use the 0.27.0
`profile:true` boundary** to attribute its own parse cost.

---

## 3. [PRIMARY] Eliminate post-parse scanners + runtime regex (parser-owns-structure)

**The full inventory of runtime `.(test|exec|match|replace|split)(` / `new RegExp` outside
`regex()`**, across all four parsers' `builders.ts`/`functional-parser.ts`/`cst.ts`/helpers
**and** core's `ast/parse-host/` (including `import.ts`, LIVE via
`render-doc.ts:37 → resolveDirectImports`). Test-harness files (`__tests__/**`, `bridge.ts`,
`census`, `oracle`) are excluded — not on the render path. Classification:

- **(A) LIVE `@{…}`/`${…}` interpolation byte re-tokenizer** on the `ast/` path — the
  grammar delivers the position as **one opaque leaf**; the action re-scans bytes to
  recover interpolation structure. **Must be actively eliminated by splitting the grammar
  position into interpolation leaves.**
- **(B) LIVE declaration byte re-split** on the `ast/` path — re-derives name/value/`!important`
  from a source span. **Must be actively eliminated by consuming the grammar's leaves.**
- **(C) LEGACY `builders.ts` producer** — **confirmed OFF the `ast/` path** (core drives
  `build` via `dispatch-host.ts`, never `buildNode`; `parseToAst` never calls the parser's
  `_build*`). **Free on legacy tree/ retirement; ~0 ms `ast/` render.** Inventory only.

### 3.1 CLASS A — LIVE interpolation byte re-tokenizers (SCSS-relevant, keystone violation)

All share the `/@\{\s*([^}]+?)\s*\}/g` (or `[@$]\{…\}`) byte pattern and carry in-source
`RETIREMENT TRIGGER` comments tying them to "split the grammar into `@{…}` leaves + consume
via `interpFromRegion`." **They are LIVE core actions — deleting `builders.ts` does NOT
remove them.** The enabling fix is the same one already landed for VALUE positions
(`#{}` in-grammar `9e2810a73`; `@{head[key]}` accessor `0de1e56db`): make the grammar emit
`@{…}`/`#{}`/`$[…]` **leaves** in the remaining un-split positions, so the action consumes
leaf spans instead of re-scanning.

| ID | Site | Position the grammar delivers opaque | Fix: grammar emits |
|---|---|---|---|
| **SCAN-A1** | `actions/at-rules.ts:283 parsePreludeValue` (+ `interpFromString:260`, `scanStringInterp:100`, `AT_KEYWORD.exec:303`, `buildQueryBlock` span re-slice) | **query/statement at-rule prelude** as recovered bytes / one `atPrelude` leaf | prelude structured into typed leaves: at-keyword name, `@name`→var-ref leaf, `@@name`→indirect leaf, `@{…}`→interp leaf, literal runs. This is the **at-rule-prelude-structuring thread** (`project-atrule-prelude-structure`; ① landed `783342cf5`, ②–⑥ queued). |
| **SCAN-A2** | `actions/selector-interp.ts:56 interpFromString` | **pseudo / attribute** simple selector — interp lives inside a single `interpKey`/`singleStr`/`doubleStr` regex leaf | split `PseudoSelector` name + `AttributeSelector` name/value grammar into `@{…}`/`#{}` leaves (SCSS/Less/Jess seam per `interpolation-body-varies-by-dialect`). |
| **SCAN-A4** | `actions/interp.ts:130 interpFromBytes` | **statement at-rule prelude string** (`@charset "UTF-@{Eight}"`, `@namespace @{ns} "…"`) | same as SCAN-A1 — prelude leaves; string-interp already structured in value position, extend to statement-prelude strings. |

**SCAN-A3 — `actions/custom-props.ts:102 interpFromString` (custom-prop `--@{k}` + regular-decl
`@{prop}` interpolated NAME) — NOT independently landable; retire WITH BuilderHost.** Verified
against the in-source `RETIREMENT TRIGGER` at `custom-props.ts:94–99`: `customPropInterp` is
**deliberately kept as ONE leaf because the legacy BuilderHost that drives the less-compat bridge
consumes that single-leaf shape.** A prior attempt to split it into `@{…}` leaves **regressed the
bridge's name emission (`--@{k}` → `--`) — an external less-compat BRIDGE-CONTRACT break.** So
SCAN-A3 is a **live ast/-path scanner BLOCKED behind BuilderHost retirement** — distinct from
CLASS C (which is off-path and dies for free). The regex costs render time today, but cannot be
removed until Phase A4: BuilderHost death does not delete it, it UNBLOCKS the grammar split (emit
`--` literal + interp leaves) that lets it be deleted. It is **excluded from the standalone ranked
backlog** (§6): do NOT attempt before A4 — splitting the leaf early regresses the bridge
(`--@{k}`→`--`). At A4 it becomes a mechanical leaf-split + regex deletion.

- **Evidence.** These interpolation re-tokenizers carry the shared `/@\{…\}/g` scanner + a `RETIREMENT
  TRIGGER` doc-comment stating the grammar currently hands one opaque leaf. `_r_ExtendPseudo`
  0.6 % + selector-cluster cost in the SCSS profile shows selector/pseudo build is on the
  hot path; the interp re-scan runs only when a `@{`/`#{` is present (guarded by
  `indexOf('@{')<0 → any(text)` fast exit), so the *hot* cost is the fast-exit `indexOf`,
  not the scan — **the win here is primarily KEYSTONE-COMPLIANCE (parser owns structure)
  and secondarily removing the re-scan for interpolation-heavy sheets**, not a
  `benchmark`-scale ms win. State that honestly.
- **Mechanism.** Emit interpolation leaves from the grammar (as value positions do) and
  route the action through `interpFromRegion` (leaf-span consumption) — no byte re-scan.
- **Win/effort.** **Keystone: H / Effort: High** (grammar productions + builder-seam per
  position). **Perf: L** on `benchmark`/`gen-workload` (guarded fast-exit); **M** on
  interpolation-dense sheets — **HYPOTHESIS**, measure an interp-heavy fixture before
  claiming ms.
- **Byte-safety + break-even.** Byte-identical *iff* the split leaves fold to the identical
  `Interp`/`Any` node the byte-scan produces — the value-position split proves the pattern,
  but SCAN-A3 has a known external-contract trap (the bridge `--@{k}` case). Gate hard on
  the interpolation + bridge byte-identity suites. Break-even for perf is neutral-or-tiny;
  the payoff is keystone-compliance + deleting five byte-scanners.
- **Risks.** SCAN-A3 external contract (documented). SCAN-A1 prelude structuring is a
  multi-step thread (②–⑥) — sequence behind the landed ①. Dialect interp-body seam
  (Less single-ident vs SCSS/Jess full-expression) must be honored per position.

### 3.2 CLASS B — LIVE declaration byte re-split (keystone violation)

| ID | Site | What it re-derives from bytes | Fix: consume the grammar's structure |
|---|---|---|---|
| **SCAN-B1** | `host-context.ts:212 declParts` — `declText.replace(/;\s*$/,'')` + `indexOf(':')` | re-splits a `name: value` declaration into name + value from the **source span** | the grammar already parses `declPropName` + value as **separate children**; the `ast/` verbatim path should consume those child spans (name-leaf span, value-region span) instead of re-slicing the whole declaration span on `:`. |
| **SCAN-B2** | `actions/variables.ts:177 `/\s*!\s*important$/iu.exec`` + `:191 `/[;\s]/.test`` trailing-trim | re-detects `!important` and trims trailing `;`/ws on **value bytes** in the verbatim fallback | `!`/`important` are already **leaf children** in the grammar (per the in-source comment); consume the `Important` leaf/flag and the value-region span rather than re-scanning the byte tail. |

- **Evidence.** `declParts` is imported/used on the ast/ static path; `variables.ts` runs on
  every variable declaration whose value hits the verbatim fallback (not whole-value-matched).
  `host-context.ts` self-time appears in the SCSS profile (`host-context.ts:215` region).
- **Mechanism.** Thread the grammar's existing name-leaf / value-region / `Important` leaf
  spans through the build args so the action never re-splits the span.
- **Win/effort.** **Keystone: M / Perf: L / Effort: Medium.** Removes a per-declaration span
  re-split (SCAN-B1) and a per-verbatim-variable tail scan (SCAN-B2).
- **Byte-safety + break-even.** Byte-identical if the consumed leaf spans reproduce the exact
  name/value/importance the byte-split yields (comment-trivia peeling at
  `variables.ts:186–190` must be preserved). Break-even: consuming a known span vs
  `indexOf`+`replace` — positive, but small.
- **Risks.** The verbatim fallback exists precisely for values the structured path can't
  whole-value-match; the leaf spans must cover comment-trivia boundaries identically. Gate on
  the declaration + variable-important byte-identity suites.

### 3.3 CLASS A/B — LIVE import-prelude byte re-derivation (`import.ts`, on the render path)

`import.ts` is LIVE on the `ast/` render path (`render-doc.ts:37` imports it; `:121`
`resolveDirectImports` walks the built root — the ~0.7 % `resolveDirectImports` phase in
PERF_IDEAS). It re-derives import structure from prelude bytes the grammar already parsed:

| ID | Site | What it re-derives from bytes | Fix: grammar/parse-host emits |
|---|---|---|---|
| **SCAN-A5a** | `import.ts:561 unwrapUrl` — `/^url\(\s*(.*?)\s*\)$/is.exec` (called at `:553`) | re-parses a `url( … )` word to its inner target (quote-stripping) | the grammar already has a structured `Url` node with a structured inner target — consume the inner leaf, don't re-parse the `url(...)` bytes. |
| **SCAN-A5b** | `import.ts:572 flagsFromOptions` — `.split(/[,\s]+/)` | re-splits the `@import (reference, optional, …)` options list from a byte string | deliver the `( … )` option list as a structured comma/space list node (parser owns list structure — cf. the landed structured comma-List), consume the tokens. |
| **SCAN-A5c** | `import.ts:351` — `/\.css([?#].*)?$/.test(lower)` | classifies a `.css` (pass-through) vs preprocessed import from the raw path string | classify at parse time from the structured path node (`Url`/`Quoted` inner), or carry a typed `isCss` flag — avoid re-testing the path bytes. |
| **SCAN-A5d** | `import.ts:149 fillInterpTemplate` — `source.split('%%')` | reconstructs a filename-interpolation template from a `%%`-delimited source string + a `replacements` array | emit the interpolation template as structured parts (lit runs + refs) instead of a `%%`-joined byte template re-split at resolve time. |

- **Evidence.** All four run in `resolveDirectImports`' path-resolution helpers on every
  `@import`. Re-grepped `import.ts` directly — these are the only production runtime-scanner
  sites (the other `import.ts` regex hits are in `__tests__`, excluded).
- **Win/effort.** **Keystone: M / Perf: L / Effort: Medium.** Import resolve is 0.7 % of render,
  so the perf win is small; the value is keystone-compliance (structure-from-parser, not
  byte-re-derivation) and removing four re-scanners.
- **Byte-safety + break-even.** Byte-identical if the structured `Url` inner / option list /
  path classification / interp-template parts reproduce the exact strings the scanners derive.
  Break-even neutral-to-tiny; payoff is compliance.
- **Risks.** `@import` semantics (reference/optional/inline/css/once flags, `url()` vs quoted
  path, filename interpolation) are subtle; gate on the import + import-race byte-identity
  suites. Some of this rides the SAME prelude-structuring thread as SCAN-A1
  (`project-atrule-prelude-structure`).

### 3.4 CLASS C — LEGACY `builders.ts` producers (OFF the `ast/` path — free on retirement)

**Confirmed OFF-path:** core's `ast/parse-host/dispatch-host.ts` is the `FunctionalParseHost`
whose `build()` the grammar drives; `parseToAst` never calls the parser packages'
`buildNode`/`_build*`. So none of the below appears in the `ast/` render CPU profile (matches
PERF_IDEAS §3 for less). **Predicted `ast/` render win on retirement: ≈ 0 ms.** They are the
~34 `builders.ts` regex the memory already tracks as *"vanish free on the engine cutover"*
(`parser-regex-endgame-is-engine-cutover`); the payoff is code-hygiene + two-producer removal
+ keystone-compliance, **not** throughput. **Inventory only — do not budget render time, and
do not grind these standalone (wasted motion per the memory note); they die with the legacy
tree/ producer.**

- **scss `builders.ts` (`_buildScss*` private methods) + scss helpers (imported ONLY by
  `builders.ts`):** `_buildScssComparison:311` (`/^(?:==|!=|>=|<=|=|>|<)$/` op re-test),
  `_buildScssCondTerm:344` (`/^not$/i` re-test), `_buildScssEach:427` (`/^@each/i` re-test),
  `_buildScssForward:1153` (`/(['"])([^'"]+)\1/.exec` path re-extract + `.replace` prelude
  surgery `:1157`), `_buildScssExtend:1376` (`/@extend\s+%/` + `.replace` `:1403,:1420–1421`).
  Helpers: `scss-atrule-helpers.ts` (module-name/path `.split('/')`/`.replace(/\.(scss|…)$/)`,
  `.css` detection, `@forward` show/hide + `as *-` scanners `:71,:77,:158–167`),
  `scss-value-helpers.ts` (`:57` name test, `:88` `.split('.')`).
- **less `builders.ts` (~74 sites):** `/^progid:/i` `:1201`, numeric re-split
  `/^(\d+)([a-zA-Z]+|%)?$/` `:1234`, `=`-spacing `.replace(/\s*=\s*/g,'=')` `:1263`, and the
  balance across `_build*` methods.
- **css / jess `builders.ts`:** css 8, jess 3 runtime-regex lines — same legacy class.

**Note for the reviewer:** the eventual grammar structure that makes CLASS C unnecessary is
mostly the SAME structure CLASS A/B and §4 want (typed operator/keyword leaves instead of a
flat leaf re-tested by regex; structured `@import`/`@forward`/`@extend` prelude nodes instead
of `.exec`/`.replace` on prelude text). So landing §4's prelude/operator structuring both
enables the CLASS A/B live-scanner removal **and** pre-retires the CLASS C legacy scanners —
one structural investment, three payoffs.

---

## 4. Grammar restructurings so the macro-compiler dispatches/fuses

The compiler emits O(1) first-char dispatch **only for a first-set-disjoint (or gated-
disjoint) `choice`**; a non-disjoint choice compiles to a `firstMatch` loop that invokes
every arm (§2.2). Each bullet restructures a hot choice so the compiler can dispatch instead
of backtrack. Bullet format:
`[ID] title — file:production — evidence — mechanism — win(H/M/L)/effort — byte-safety+break-even — risks`.
Line numbers as of `origin/dev` `69ec761ae`.

### 4.1 SCSS (`packages/scss-parser/src/grammar.ts`) — first and deepest

**[SCSS-1] Two-level statement dispatch (the single biggest SCSS lever) — `grammar.ts:704` `scssStatement`, consumed by `declarationList:733`/`atRuleBody:736`/`Stylesheet`.**
- **Evidence.** 17 arms: fourteen `@`-keyword-led (`regex(/@if(?![-\w])/i)` etc.),
  `NsVarDeclaration` ident-led, three `ScssAtRoot*` re-scanning `@at-root`. Not pairwise
  disjoint (fourteen share `@`) → **`firstMatch`**. `declarationList`/`atRuleBody` front
  `scssStatement` before `Declaration`, so **every plain declaration/ruleset runs the whole
  arm list**. Honest magnitude: the fourteen `@`-arms fail *cheaply* (an anchored sticky-regex
  mismatch at char 0), so the real cost is **dominated by the one arm that parses real input —
  `NsVarDeclaration`, which consumes a full ident (`color`) before failing at the missing `.`**
  — plus the fixed per-arm `saveCstMark`/rollback bookkeeping ×17. The lever removes the whole
  list from the non-`@` path (and the `NsVarDeclaration` mis-descent), not "15 expensive
  parses". Profile corroboration: `_r_blockItem` 1.3 %, `_r_declarationList` 0.7 %,
  `_r_NsVarDeclaration` 0.7 %, `_r_ScssInclude` 0.6 %, `_r_ScssMixinName` 0.5 % all present
  despite most statements being plain declarations.
- **Mechanism.** Left-factor into a first-char-disjoint top choice: `choice({@}atStatement,
  {$}dollarStatement, nonSigilStatement)`; `atStatement` reads the `@`-keyword once
  (`keywords([...atNames],{boundary})`, §4.2) and dispatches to the one body; fold the three
  `ScssAtRoot*` behind one `@at-root` + inner branch. First-char-disjoint top ⇒ compiler emits
  O(1) ASCII dispatch; a `.`/letter declaration never touches an `@`-arm.
- **Win/effort.** **H / High.** Removes ~14 speculative arm invocations from the most-executed
  path. High effort: the keyword→production map must preserve each arm's node build + `expect`
  recovery.
- **Byte-safety + break-even.** Byte-identical iff the classifier reaches the identical
  production per keyword and ordered-PEG is preserved (at-keywords unambiguous after boundary).
  Break-even: one `keywords()` classify vs ~14 anchored-regex failures + rollbacks — strongly
  positive.
- **Risks.** `@else` is parsed inside `ScssIf`'s `many` — keep it out of the classifier;
  `@import`+`#{}` must reach `ImportAtRuleStatement` before Less's `AtRuleBlock` (ordering at
  `:709`); compose first-set integrity (§4.5).

**[SCSS-2] First-set dispatch for `value` (top grammar fn, 8.8 %) — `grammar.ts:218` `value`.**
- **Evidence.** 18 arms; `_r_value` = **8.8 % of SCSS parse self-time (largest single
  grammar fn)**, runs once per value token under the inherited `topSum→topProduct→operand→
  value` ladder. Arms overlap on first char: `NamedColor`/`Call`/`ScssIdentValue`/`anyValue`
  ident-led; `ScssMapLiteral`/`ScssValueParen` both `(`; `ScssInterpBare`/`Color` both `#`.
  `anyValue`'s first-set = `any` forces the whole choice to `firstMatch`. A plain ident value
  fails `ScssInterpBare`(`#`), speculatively descends `InterpValue` and rolls back (SCSS-3),
  then `NamedColor` scans+fails, `Call` re-scans the ident+fails on `(`, before
  `ScssIdentValue` — **the same ident is scanned 3–4×.**
- **Mechanism.** First-char sub-dispatch: `$`→Reference, digit/`.`→{Dimension,Num},
  `#`→{ScssInterpBare,Color}, `(`→{ScssMapLiteral,ScssValueParen}, `[`→SquareParen,
  `"`/`'`→Quoted, `~`→EscapedValue, ident→{InterpValue,NamedColor,CalcCall,Call,ScssIdentValue,
  anyValue}. `anyValue` can't be globally disjoint but can be isolated as the *tail of the
  ident bucket* so `$`/digit/`#`/`(`/`[`/quote get O(1). Pair with SCSS-3 + a `NamedColor`
  pre-check (or `keywords()` for color names).
- **Win/effort.** **H / High.** Top target; even halving the ident bucket's re-scans is
  material.
- **Byte-safety + break-even.** Ordered-PEG within the ident bucket preserved (`InterpValue`
  gated, then `NamedColor`,`CalcCall`,`Call`,`ScssIdentValue`,`anyValue`). Break-even: one
  codePoint switch vs up-to-18 descents — positive on every non-ident value immediately.
- **Risks.** `anyValue` operator-run semantics (`+`,`-`,`*`) must still be reachable; cross-
  check the value byte-identity suite; compose integrity (§4.5).

**[SCSS-3] Required-`#{` gate on `InterpValue` — `grammar.ts:131`, ordered 2nd in `value`.**
- **Evidence.** `sequence(optional(interpValueLead), ScssInterpBare, many(...))`. On the common
  no-`#{` value it consumes `interpValueLead` (a full ident run) then fails the required
  `ScssInterpBare`, **backtracking the ident** — one wasted ident scan per ident value. Its
  siblings (`ScssInterpDeclName`/`scssInterpPrelude`) already require an atom; `InterpValue`
  descends because the required atom is *after* the lead.
- **Mechanism.** Positive lookahead `not(not(regex(/[-_a-zA-Z0-9-￿]*#\{/)))` (Parséman has no
  `ahead`; `not(not())` is the idiom); lives in SCSS-2's ident bucket.
- **Win/effort.** **M / Low–Medium.** Folds into SCSS-2.
- **Byte-safety + break-even.** Byte-identical (the no-`#{` value fell through anyway).
  Break-even: one anchored lookahead vs a full lead scan + rollback — positive.
- **Risks.** The lookahead must match exactly what `interpValueLead` consumes before `#{`
  (incl. bare `-`); test `foo-#{$x}`, `#{$x}`, `123#{…}`→Dimension.

**[SCSS-4] Factor `ScssCallArg`/`ScssMixinParam` (value parsed once) — `grammar.ts:390`/`407`.**
- **Evidence.** `ScssCallArg = choice(sequence($var,':',valueSequence), sequence(value,'...'),
  sequence(valueSequence,'...'), valueSequence)` — arms 2/3/4 all value-led → a plain
  positional arg parses a `value` (arm 2) then a `valueSequence` (arm 3), each failing `...`,
  before arm 4 keeps it: **value parsed 2–3×.** `_r_ScssCallArg` 0.8 % + `_r_ScssCallArgsInner`
  0.5 %. `ScssMixinParam` same (arms 2/3 both `$var`-led).
- **Mechanism.** Left-factor: `choice(sequence($var,':',valueSequence),
  sequence(valueSequence, optional('...')))`; mixin-param `choice(sequence('...',$var),
  sequence($var, optional(choice('...', sequence(':',valueSequence)))))`.
- **Win/effort.** **M / Low.** Mechanical.
- **Byte-safety + break-even.** Byte-identical if the folded build keeps the keyword/spread/
  positional distinction. Break-even: unconditional.
- **Risks.** `$var:` must still win only when a `:` follows (a bare `$var` value → positional).

**[SCSS-5] Balanced-`:` gate on `ScssMapLiteral` — `grammar.ts:167`, before `ScssValueParen:194`.**
- **Evidence.** For a non-map paren (`(1 + 2)`, `(15px/30px)`), `ScssMapLiteral` opens `(`,
  **fully parses the first `value`** in `ScssMapPair`, fails the missing `:`, **backtracks the
  whole paren**, which `ScssValueParen` re-parses. Head comment `:162` documents the fall-
  through as intentional for correctness — this is a cheaper gate, not a semantic change.
- **Mechanism.** Peek for a top-level `:` inside the balanced `(...)` via
  `scanTo(literal(':'),{skip:[bParen,bSquare,bCurly,strings]})` (shape already at `:486–489`).
- **Win/effort.** **M / Medium.**
- **Byte-safety + break-even.** Byte-identical (same two productions, same order). **HYPOTHESIS
  on short parens** — the balanced scan can lose to parsing a 1-token body; measure a paren-
  dense fixture; threshold or drop if `(x)` regresses.
- **Risks.** `:` inside nested fn/string skipped (skip set); `(a: b, c)` must still classify map.

**[SCSS-6] Restore disjoint `simpleSelector` — `grammar.ts:726`.**
- **Evidence.** `AttributeSelector`(`[`)/`PseudoSelector`(`:`)/`LessAmpersand`(`&`) are
  disjoint, but `InterpolatedSelector` and `basicSel` both start `[.#]?`+ident → **whole choice
  drops to `firstMatch`**, so the "O(1) gated dispatch" the comment claims is not achieved.
  `_r_simpleSelector` = **3.8 % (2nd-largest grammar fn).** Worse, `InterpolatedSelector`
  (`grammar.ts:225` `nameSegment = choice(staticSeg, ScssInterpBare)`) accepts a bare
  `staticSeg`, so a **plain** `.foo` matches it **with no interpolation present** — every
  ordinary selector routes through the interp arm.
- **Mechanism.** (a) require ≥1 `ScssInterpBare`: `sequence(many(staticSeg), ScssInterpBare,
  many(nameSegment))`; (b) then `[`/`:`/`&`(gated)/ident are the four disjoint dispatch keys →
  O(1), gated `&` keeps its slot (0.26.1). This ALSO removes the CLASS A selector re-scan need
  by making plain selectors take `basicSel` and interpolated ones emit real leaves.
- **Win/effort.** **H / High.** Selectors ≈ 11.5 % of SCSS parse; `simpleSelector` alone 3.8 %.
- **Byte-safety + break-even.** **Highest byte-risk SCSS item** — changes which production a
  plain `.foo` builds; must stay byte-identical (`Interpolated` vs basic → identical
  `CompoundSelector`). Break-even: O(1) dispatch vs a failed ident-run descent — strongly
  positive.
- **Risks.** Selector node identity; touches `NO structural node flattened to Any` +
  `:is()` compaction invariants. Gate on the selector byte-identity suite. Same pattern →
  `ScssInterpolatedName:226`, `ScssMixinName:425`.

**[SCSS-7] Required-`#{` gate on `ScssInterpDeclName`/`ScssInterpCustomProp` — `grammar.ts:141`/`151`, ordered in `Declaration:271`/`ScssNestedDecl:248`.**
- **Evidence.** `choice(ScssInterpDeclName, scssDeclPropName)` at the declaration head. For
  `color:`, `ScssInterpDeclName` consumes `color` then fails the required atom and backtracks,
  and `scssDeclPropName` re-scans `color` — **every plain property name scanned twice.**
- **Mechanism.** A `#{`-within-name-before-`:` positive lookahead (as SCSS-3); same for
  `choice(ScssInterpCustomProp, customProp):237`.
- **Win/effort.** **M / Low–Medium.** Declarations dominate.
- **Byte-safety + break-even.** Byte-identical; break-even positive.
- **Risks.** Lookahead char-set must match `declNameChunk`/`customPropChunk`; test
  `margin-#{$s}`, `--x-#{$y}`.

**[SCSS-8] `condOperand` first-set dispatch — `grammar.ts:297`.** Same ident-backtrack as
`value`; condition-only. **L / Low. HYPOTHESIS** — not visible in the profile; measure a
condition-dense fixture. Keyword operands (`true`/`false`/`null`) must reach `anyValue`.

*Already-landed in SCSS (cite as done / template, do NOT re-propose): in-grammar `#{}`
`9e2810a73`; the `Quoted` flat fast path `grammar.ts:109–116` (flat leaf first, interp arm
only on a real opener) — the "flat fast path + structured slow path" template SCSS-3/6/7 and
CLASS A extend; `scssInterpPrelude` required-interp gate `:640`; the `&`-gate on `simpleSelector`
(the gated-arm template, once SCSS-6 makes the rest disjoint).*

### 4.2 The cross-cutting keyword-classifier (unlocks SCSS-1, CSS-1/3, JESS-1)

Replace the fan of `sequence(regex(/@if…/), …)` arms with `keywords([...atNames],{boundary})`
read **once** + a dispatch to the body. `keywords()` compiles to one sticky regex with a real
first-set. **Caveat (§2.2):** `keywords()` returns the matched string, not a production — so
the grammar must **left-factor** the `@`/`$` prefix and branch on the keyword; the compiler
then bakes it. Build this once as a reusable grammar helper; SCSS-1, CSS-1/3, and JESS-1 all
land on top of it.

### 4.3 LESS (`packages/less-parser/src/grammar.ts`)

**[LESS-1] First-char dispatch + `NamedColor`→`keywords()` for `value` — `grammar.ts:632`; `NamedColor` regex `:686`.**
- **Evidence.** 16 arms, no first-char dispatch (`anyValue`=`any` forces `firstMatch`). A
  plain keyword value (`solid`,`block`,`bold`) fails ~6 arms then runs the **150+-branch
  `NamedColor` alternation regex** (fails) before `anyValue`. The giant `NamedColor` regex runs
  on **every non-color ident value.**
- **Mechanism.** (a) first-char dispatch as SCSS-2; (b) convert `NamedColor` to
  `keywords(CSS_COLOR_NAMES,{caseInsensitive,boundary})` — one sticky regex with a first-set,
  so it dispatches and doesn't run a 150-branch alternation on every ident.
- **Win/effort.** **H / High.** Largest NEW Less value lever; hits every value token.
- **Byte-safety + break-even.** `keywords()` is byte-identical (same set, longest-first, same
  boundary). Break-even strongly positive.
- **Risks.** Case-insensitivity/boundary must match the current regex exactly; `anyValue`-forces-
  `firstMatch` means the ident bucket stays ordered.

**[LESS-2] First-char peek before per-iteration `not(selectorBoundary)` — `grammar.ts:396`, used at `CompoundSelector:410`/`ComplexSelector:418`/`extendCompound:463`/`extendComplex:465`.**
- **Evidence.** `selectorBoundary = regex(/when(?![-\w])|::?extend[ \t\n\r\f]*\(/i)` runs a
  regex **per simple-selector and per compound iteration** to prove a negative. Selectors are
  the biggest cluster (~24.6 % Less parse). It can only match `when`(`w`/`W`) or `:extend`(`:`);
  every ordinary continuation (`.`/`#`/ident/`[`/`&`) pays it.
- **Mechanism.** Gate the `not()` behind a first-char peek: run `selectorBoundary` only when the
  next non-trivia char is `:`/`w`/`W`.
- **Win/effort.** **M–H / Medium.** Broad (biggest cluster).
- **Byte-safety + break-even.** Byte-identical (boundary can only match `:`/`w`/`W`). Break-even:
  one code-point compare vs a regex exec — strongly positive.
- **Risks.** Case (`When`/`WHEN`); whitespace before `when` (peek is on next non-trivia char).

**[LESS-3] Drop `DeferredScalarDeclaration` grammar arm (builder re-derives it) — `grammar.ts:516`, `Declaration:531`.**
- **Evidence.** Tried first on **every** declaration; for any non-single-scalar value (majority)
  it parses `ident`+`:` then fails and **rolls back the name+colon**, which the full
  `Declaration` re-parses. `builders.ts:1135 _buildLessDeclaration` **already** calls
  `_buildDeferredScalarDeclaration` on the ordinary `Declaration` — a redundant producer.
  **Caveat:** that builder re-derivation is in `builders.ts`, i.e. the **legacy tree/
  producer OFF the ast/ render path** (§3.4) — so on the ast/ path the deferred-scalar node
  is produced by the *grammar arm*, and the "builder already does it" redundancy is a
  *legacy-producer* fact, not an ast/-path one. Dropping the grammar arm therefore needs the
  ast/ dispatch host (not `builders.ts`) to yield the identical deferred-scalar node.
- **Mechanism.** Delete the speculative arm; rely on the existing build-time detection (or gate
  it behind a lone-scalar lookahead).
- **Win/effort.** **M / Medium.** Removes a name+colon double-parse on most declarations.
- **Byte-safety + break-even.** **HYPOTHESIS** until ON==OFF proven — the deferred-scalar node
  must be byte-identical whether produced by the grammar arm or the builder. **Keystone tie-in:**
  this is a case where structure is *already* re-derived in the builder; dropping the grammar arm
  aligns with §3 (one producer, not two).
- **Risks.** Grammar/builder edge disagreement (`10px` vs `10` vs `10px !important`) changes
  output; gate on the declaration + deferred-scalar suites.

**[LESS-4] `@{`-peek before the `Quoted` interp arms — `grammar.ts:165`.**
- **Evidence.** A plain `"hello"` matches arm 1's `"`+`many(dqChunk)` (whole body) then fails
  the required `strInterp`(`@{`), rolls back, re-scans via `doubleStr` — **double body-scan of
  every non-interpolated string.** SCSS already fixed this (flat `dqFlat`/`sqFlat` first).
- **Mechanism.** Mirror SCSS: flat `singleStr`/`doubleStr` leaf **first**, interp arm only on a
  real `@{`.
- **Win/effort.** **M / Medium.**
- **Byte-safety + break-even.** Byte-identical (SCSS proves it). Break-even near-free.
- **Risks.** Escape handling in the flat regex must match the interp-chunk complement.

**[LESS-5] Factor `MixinOrQualifiedRule` block-vs-call prefix — `grammar.ts:296`.**
- **Evidence.** Two arms share a large prefix (path+args+guard); a mixin **call** `.mixin();`
  parses arm 1's path+args+guard, fails the required `{`, **rolls back, re-parses path+args** in
  arm 2 — args parsed twice.
- **Mechanism.** `sequence(path, optional(MixinArgs), optional(Guard), choice(blockTail,
  callTail))`. Same for `NestedMixinDefinition:491` vs `MixinCall:279`.
- **Win/effort.** **M / Medium.**
- **Byte-safety + break-even.** Byte-identical if block→ruleset / call→call routing preserved.
- **Risks.** `mixinNamePath` vs `mixinCallPath` syntax must both parse under the factored `path`.

**[LESS-6] Two-sigil `nestedRef` gate + `NsAccessor` `[`-gate — `grammar.ts:244`/`:623`.** `nestedRef`
(needs `{2,}` sigils) runs+fails on every single-sigil `@var`; `NsAccessor` `nsHead` lookbehind
matches+rolls-back on every hex `#fff`. Gate `nestedRef` on a two-sigil lookahead; gate
`NsAccessor` on a `[`-presence peek. **L / Low**, folds into LESS-1's bucket. Byte-identical.

*Confirmed already-documented (reference, don't restate): value math ladder `topSum`/`topProduct`
`:676–679` (PERF_IDEAS #3) — note per-operand `operand=choice(Negative,value):665` + `Negative`'s
`-`-lookahead `:663`; the `@{`-peek before `InterpolatedSelector` at `interpOrBasic:403`
(section-A); trivia-frame gating `functional-parser.ts:51` (#4/D, now narrower — 0.27.0 auto-elides
bare-terminal frames).*
*(Correction: an earlier draft flagged `Comparison:324` as possibly-dead — that is WRONG. It IS
exported in the rule object at `grammar.ts:1168` and `_buildComparison` is live at `builders.ts:402`.
No cleanup item; disregard.)*

### 4.4 CSS (`packages/css-parser/src/grammar.ts`) — the shared base (propagates to all 4)

**[CSS-1] `@`-vs-selector first-char split in the body/root loops — `grammar.ts:213` `declarationList`, `:123` `stylesheetBody`.** Four/five `@`-led arms share `@`; `Declaration`/`Ruleset` overlap on
letters → `firstMatch`, so **every declaration/ruleset rolls back 4–5 `@`-attempts first.** Split on
first char `@` vs not; inside the `@`-group use the §4.2 classifier. **H / Medium.** Propagates to
less/scss/jess (they override these). Byte-identical. Risk: compose integrity (§4.5).

**[CSS-2] Selector-vs-declaration head disambiguation — `grammar.ts:235` `Declaration`.** `not('{')`
sits **after** `valueList`, so `a:hover { … }` parses `propName`+`:`+the whole `valueList`, fails
`not('{')`, rolls back, and `Ruleset` re-parses the head — **double-parse of every nested-rule head.**
Needs a bounded `scanTo(choice('{',';','}'),{skip})` "reaches `{` before `;`" peek, then a single
char check at the landing offset to see which terminator hit (no Parséman gap — §7). **M /
Medium-High. HYPOTHESIS** (needs a nesting-dense profile). Lower confidence than CSS-1.

**[CSS-3] `@`-keyword classifier for `AtRuleBlock`/`AtRuleBlockTop`/`sharedKnownArms` — `grammar.ts:615`/`628`/`606`.** Each is a `choice` of `sequence(atKeyword-regex, …)` all `@`-led → `firstMatch`;
`sharedKnownArms` is itself a 6-arm `@`-choice, so an `@media` block runs 10+ keyword regexes. One
`@`-keyword classifier (§4.2) read once + dispatch fixes CSS-1, CSS-3, and the SCSS/jess `@`-groups at
once. **M–H / High.** Byte-identical (bodies + order preserved). Risk: prelude-vs-block branch +
unknown-at-rule default must be preserved.

*Non-sites (verified efficient, do not touch): `simpleSelector:170` is first-char **disjoint** →
O(1) (the model to preserve); `numeric:317` is the unified parse-number-once leaf; `Call:352`
dispatches `calc(?=\()` first; `pseudoArg:197` is bounded. selectorBoundary fusion + comma-list node
already landed.*

### 4.5 JESS (`packages/jess-parser/src/grammar.ts`)

`jess = compose([css, delta])`. Jess adds `$`-sigil + `@-`-led constructs — the worst first-set
collisions. (Jess parser intentionally trails; low current priority, but same-shape fixes.)

**[JESS-1] Two-level `$`/`@`/selector dispatch — `grammar.ts:532` `Stylesheet`, `:542` `declarationList`.** ~17–19 arms; **eight share `$`** (`Extend`,`Apply`,`VarDeclaration`,`If`,`For`,`While`,
`VariableMixinCall`,`MixinCall`), **nine share `@`**. A `$foo:1;` runs `$extend`/`$apply` regexes
(+rollback) before `VarDeclaration`; a `MixinCall` pays 7 `$`-rollbacks. Split first char `$`/`@`/
selector/mixin, then dispatch the `$`-group on the char after `$` + keyword; `@`-group reuses §4.2.
Keep the `withCtx({inner})` (JESS-3's `&`-gate reads it; must stay static-fusable, 0.26.3). **H /
High. HYPOTHESIS magnitude** (no jess corpus profiled; mechanism proven by the SCSS analogue).

**[JESS-2] `$`-group `value` dispatch; skip `UnwrapArith` for bare `$var` — `grammar.ts:526`, `UnwrapArith:220`.** Four `$`-arms; `UnwrapArith` (2 arms both `Reference`-led) descends the whole
arithmetic tree and fails for a bare `$w` before `Reference` — **every plain `$var` value pays a full
`UnwrapArith` descent.** Dispatch on the char after `$` (`(`→Expression, `[`→DollarInterp, name→
UnwrapArith-vs-Reference by a spaced-operator peek). **H / High. HYPOTHESIS magnitude.** Spaced-
operator peek must honor `v5 operators SPACED` (`a - b`).

**[JESS-3] Restore disjoint `simpleSelector` (gate `InterpolatedSelector` on `$[`) — `grammar.ts:88`.** `InterpolatedSelector`/`basicSel` both `[.#]?`+ident → `firstMatch`; every plain compound part runs a
failed `InterpolatedSelector` ident-run. Gate on `$[`-presence → `[`/`:`/`&`(gated)/ident disjoint.
Direct analogue of SCSS-6 (same risk profile; sequence after it). **M / High.**

**[JESS-4] Unify the `$(…)` numeric leaf (mirror CSS `numeric`) — `grammar.ts:134` `exprAtom`.**
`exprDimension` vs `Num` both number-led; unitless `5` inside `$(…)` backtracks. Mirror
`numeric:317`. **L / Low.** Byte-identical.

**[JESS-5] Parse the condition primary once — `grammar.ts:293` `condOr`/`condPureAnd`/`condPureOr`.**
All begin by parsing `condPrimary` → shared-prefix re-descent (`(A) or (B)` re-parses `(A)`). Parse
`condPrimary` once, branch on the joiner. **L / Medium. HYPOTHESIS** (condition-only).

*Non-sites: `Quoted` flat-string fast path `grammar.ts:158–184` (done, template); `Reference`
accessor `many(choice(refDot,refIndex)):61` disjoint (`.` vs `[`).*

### 4.6 Compile-time precompute — already done; the lever is grammar structure

`buildAsciiDispatch`, `RegexFirstSetAnalyzer`, literal/keyword interning
(`greedyClassify`/`literalsLongestFirst`), and fusion (`linker.ts`, 0 % sibling dispatch) all run at
grammar-build time. **There is no missing interning/dispatch-table compiler feature** — the only
work withheld is dispatch on *non-disjoint* choices, which is the grammar-structure problem §4.1–4.5
solve. **Compose first-set integrity is an AUDIT, not an assumption:** less/scss/jess override
`value`/`Stylesheet`/`declarationList`/`simpleSelector`; a choice that is disjoint in the delta
source can silently run `firstMatch` in the fused output (`first-set.ts:99–111`; the 0.26.x fixes).
Guard every restructuring with §4.7.

### 4.7 Use `run(entry,input,{profile:true})` (0.27.0) — prerequisite tooling

Add a test-only profiling entry (behind a flag) that runs `parseScssFn`/`parseLessFn` with
`profile:true` on the representative fixtures. It splits parse time into **recognizer /
structural-capture / host-construction** passes (byte-identical output). Judge every §3/§4 lever on
the **recognizer-pass delta** (choice restructuring), the **capture-pass delta** (trivia frames), or
the **host-pass delta** (CLASS A/B action work) — not just wall-clock. It is also the tripwire for a
compose-fusion dispatch regression (§4.6): a recognizer-pass spike with unchanged capture/host. **Do
this first — it blocks nothing and makes every other claim defensible.**

---

## 5. dart-sass single-pass runtime-elision lessons

dart-sass is ~1.25× faster and **the gap is PARSE** (PERF_IDEAS). It hand-writes `parser.dart` over
a single-pass `SpanScanner` — no token stream, no CST capture, no per-node trivia frame; whitespace
consumed inline; bounded explicit `scanner.state` save/restore. **The transferable part is peek-
gating INSIDE the combinator grammar, not abandoning it** (the LAW forbids ad-hoc char scanning —
which is exactly what §3 removes). Mapping:

- **`lookingAtIdentifier()` peek before committing a selector arm → §4.1 SCSS-6, §4.5 JESS-3,
  section-A, §4.3 LESS-4.** dart-sass peeks before descending; Jess should gate interp/basic arms so
  the non-interpolated majority never speculatively descends. Already the SCSS `Quoted` model.
- **"Classify the keyword once" single pass → §4.2 `@`/`$` classifiers.** dart-sass reads an at-rule
  name once and switches; Jess re-attempts N keyword regexes.
- **Inline whitespace vs per-node trivia frame → 0.27.0 auto-elision + PERF_IDEAS #4/D.** dart-sass
  has no trivia frame; Jess can't match that (structured trivia is load-bearing for comment lift +
  descendant-combinator detection), but 0.27.0 already elides bare-terminal frames and #4/D closes the
  residual. **No new bullet — already covered; do not re-list.**
- **Single-pass structure instead of post-parse re-scan → §3.** dart-sass's scanner *produces* the
  structure in one pass; it never re-derives from bytes afterward. That is exactly the CLASS A/B
  elimination: make the grammar emit the interpolation/decl structure so no action re-scans. dart-sass
  is the design proof that single-pass structure is achievable.

**What NOT to copy (PERF_IDEAS, reaffirmed):** a hand-coded imperative scanner (violates the LAW —
and §3 is about *deleting* our residual hand-scanners, not adding one); a separate `CssStylesheet` +
`_SerializeVisitor` (Jess fuses eval+serialize — copying would add GC); blanket value interning /
eager immutable value objects (Jess's lazy materialization already wins on V8). dart-sass's raw speed
comes from architecture Jess deliberately rejected; the transferable ~20 % is peek-gating +
keyword-classify + single-pass structure inside the compiled combinator grammar.

---

## 6. Ranked experiment backlog

One prioritized checklist. Rank = win-per-effort, weighted by **keystone-compliance (owner PRIMARY)**,
by breadth (a CSS-base fix propagates to four dialects), and by SCSS emphasis. **Every item is gated
on ON==OFF byte-identity (CST + CSS) and re-measured against built `lib/` and, per §4.7, judged on the
right profiling pass. HYPOTHESIS items require a representative-fixture profile before landing.**

| Rank | ID | Lever | Class | Win/Effort | Byte-risk | Gate |
|---|---|---|---|---|---|---|
| 0 | **§4.7** | Wire the `profile:true` harness (prerequisite for every claim below) | tooling | — / Low | none | byte-identical output |
| 1 | **SCSS-1** | Two-level `@`/`$`/non-sigil statement dispatch (kills ~14 arm invocations/statement) | grammar | H / High | Med | statement + recovery suites; §4.6 |
| 2 | **CSS-3 (+CSS-1)** | Shared `@`-keyword classifier + `@`-vs-selector split (propagates to all 4; also pre-retires CLASS C at-rule scanners) | grammar | H / High | Med | at-rule suite ×4; §4.6 |
| 3 | **SCSS-2 (+SCSS-3)** | `value` first-char dispatch + `InterpValue` gate (top grammar fn 8.8 %) | grammar | H / High | Med | value byte-identity suite |
| 4 | **LESS-1** | `value` first-char dispatch + `NamedColor`→`keywords()` | grammar | H / High | Med | value suite |
| 5 | **SCSS-6 / JESS-3** | Restore disjoint `simpleSelector`; also unblocks the CLASS A selector re-scan removal | grammar (+§3) | H / High | **High** | selector byte-identity suite |
| 6 | **SCAN-A1 / SCAN-A2 / SCAN-A4** | Structure at-rule prelude + pseudo/attr selector interp into leaves → delete the byte re-tokenizers (keystone) | §3 LIVE | Keystone-H / High | Med | interp byte-identity; prelude thread ②–⑥ |
| 7 | **LESS-2** | First-char peek before `not(selectorBoundary)` | grammar | M–H / Med | Low | selector suite |
| 8 | **SCSS-7** | Require-`#{` gate on interp decl/custom-prop names (per-decl double scan) | grammar | M / Low–Med | Low | declaration suite |
| 9 | **SCAN-B1 / SCAN-B2** | Consume grammar decl name/value/`!important` leaves instead of re-splitting bytes (keystone) | §3 LIVE | Keystone-M / Med | Med | declaration + variable-important suites |
| 10 | **SCSS-4** | Factor `ScssCallArg`/`ScssMixinParam` (2–3× value re-parse) | grammar | M / Low | Low | call/mixin suite |
| 11 | **LESS-4** | `@{`-peek before `Quoted` interp arms (mirror SCSS flat-first) | grammar | M / Med | Low | string suite |
| 12 | **LESS-5** | Factor `MixinOrQualifiedRule` block-vs-call prefix | grammar | M / Med | Low | mixin suite |
| 13 | **SCAN-A5a–d** | Consume grammar `Url` inner / structured option list / typed `.css` flag / interp-template parts in `import.ts` instead of re-scanning prelude bytes (keystone) | §3 LIVE | Keystone-M / Med | Med | import + import-race suites |
| 14 | **JESS-1 / JESS-2** | Two-level `$`/`@` statement + `value` dispatch | grammar | H / High | Med | **HYPOTHESIS** — jess corpus profile first |
| 15 | **LESS-3** | Drop `DeferredScalarDeclaration` grammar arm (builder re-derives — two-producer removal) | grammar (+§3) | M / Med | **Med (drop)** | **HYPOTHESIS** — prove ON==OFF |
| 16 | **SCSS-5** | Balanced-`:` gate on `ScssMapLiteral` | grammar | M / Med | Low | **HYPOTHESIS** — short-paren break-even |
| 17 | **CSS-2** | Selector-vs-declaration head disambiguation (nested-rule double-parse) | grammar | M / Med–High | Med | **HYPOTHESIS** — needs a which-terminator scan (§7) |
| 18 | **LESS-6 / JESS-4 / SCSS-8 / JESS-5** | Micro: two-sigil `nestedRef`, `NsAccessor` `[`-gate, unified `$(…)` numeric, `condOperand`/condition-primary-once | grammar | L / Low–Med | Low | **HYPOTHESIS** — low profile share |
| — | **SCAN-A3** (`custom-props.ts:102`) | Custom-prop/decl NAME interp split — live ast/-path scanner **BLOCKED behind BuilderHost retirement** (splitting early regresses the less-compat bridge `--@{k}`→`--`). Not deleted for free by BuilderHost death — UNBLOCKED by it; mechanical leaf-split at A4 (§3.1) | §3 BuilderHost-blocked | — | **High if early** | do NOT attempt before A4 |
| — | **CLASS C** (scss `builders.ts:311/344/427/1153/1376` + helpers; less `:1201/1234/1263`; css/jess) | Legacy `_build*` regex — dies **free** on legacy tree/ + BuilderHost retirement (~0 ms ast/) | §3 legacy | code-hygiene / — | none (off-path) | do NOT grind standalone; retire with the producer |

**Cross-cutting:** ranks 1, 2, 14 consume the §4.2 keyword-classifier — build it once. Rank 2's
prelude structuring, rank 5's selector split, and the SCAN-A/B leaf-emission all install the SAME
structure that pre-retires CLASS C — **one structural investment, three payoffs (dispatch win +
live-scanner removal + legacy-scanner pre-retirement).**

### Invariant-risk / byte-unsafe flags (for the reviewer)
- **SCSS-6 / JESS-3 / SCAN-A2 (selector identity)** — highest byte-risk; risks `NO structural node
  flattened to Any` + `:is()` compaction. Gate on the selector byte-identity suite; no landing
  without ON==OFF proof.
- **SCAN-A3 (custom-prop/decl name)** — **excluded from standalone landing** (§3.1, §6): the
  single-leaf shape is a less-compat BRIDGE CONTRACT (a prior split regressed `--@{k}`→`--`,
  documented at `custom-props.ts:94–99`). Its regex is live on the ast/ path but not removable
  until BuilderHost retires (Phase A4) — BuilderHost death UNBLOCKS the grammar split, it does not
  delete the scanner for free. Do NOT attempt before A4.
- **LESS-3 (drop a grammar arm)** — moves structure to the builder path; prove the builder yields
  the identical node before dropping, else keep + gate.
- **CSS-2 (bounded which-terminator lookahead)** — needs a scan primitive Parséman may not expose
  cheaply (§7); lowest-confidence structural item.
- **Every composed override** — §4.6: disjoint-in-delta can silently be `firstMatch`-in-fusion; the
  §4.7 recognizer-pass check is the guard.

---

## 7. Parséman capability-gap flags (upstream signal)

Where a Jess-side fix cannot stay fully in the grammar without a Parséman feature:

- **No dedicated positive-lookahead / `ahead` combinator.** The interp/keyword gates use the
  `not(not(p))` idiom (two parses + two rollbacks). A first-class `ahead(p)` (single pass, zero-width,
  cacheable) would make SCSS-3/6/7, LESS-2/4, JESS-2/3 cheaper and clearer. **Signal to parseman.**
- **~~"which-of-these-terminators" bounded scan~~ — DOWNGRADED, not a real gap.** CSS-2
  (Ruleset-vs-Declaration) needs "does `{` occur before `;`/`}` at this paren depth?" This is
  already expressible: `scanTo(choice('{',';','}'), {skip})` lands on the terminator, and a single
  char peek at the landing offset (`input[end]`) tells you which one it hit — no combinator gap. A
  `scanToTagged(choice)` returning the matched alternative would be marginally cleaner, but CSS-2
  does not depend on it.
- **No keyword→production dispatch table.** `keywords()` classifies a keyword in one regex but returns
  the string; value-dependent *production* dispatch still needs grammar-side left-factoring (§4.2). A
  compiler-supported "dispatch on `keywords()` result to sub-parser N" would turn every `@`/`$`-group
  into a true O(1) table without manual factoring. **The single highest-leverage parseman feature for
  these grammars.**
- **First-set integrity under compose-override** is a live fragility (0.26.1/0.26.2/0.26.3 were all
  fixes). A build-time assertion that "every overridden rule's fused first-set ⊇ its baked first-set,
  else dispatch is dropped loudly" would convert silent `firstMatch` regressions into build errors.

(These are *signal*, not asks — parseman is a separate project; the Jess-side items in §3–§6 stand
without them, just at higher cost.)
