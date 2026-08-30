# Grammar-dedup orchestration log

**Purpose.** Live worklog for the "smallest (but correct) grammars" effort —
driving the four dialect grammars back to *CSS base + genuine delta* per the
owner's four hard rules. This is the single accountable list: every lane, its
status, its evidence, and the standing backlog. Update it in the same turn you
learn something; do not let it drift.

Owner mandate (2026-08-11): *"ok drive all of that as orchestrator! let's get
the smallest (but correct) grammars we can think of."*

Governing rules: `docs/architecture/parser/GRAMMAR-REVIEW-STANDARD.md` (four
hard rules at top). Facts ledger: `docs/state/GRAMMAR-SIZE-FACTS.md`. Never
write a closure directive about an owner requirement (E8 / OR-*).

Base at dispatch: `origin/dev` @ `93c67d0ae`.

---

## ⟢ RECONCILIATION 2026-08-30 (origin/dev @ `dd0ce15d9`, parseman `^0.50.1`) — READ FIRST

The top-matter below and much of the lane history are frozen at parseman 0.48.1
and **undercount what has landed**. Verified against the code on 2026-08-30:

- **Stage A (parseman compose lifts) — LANDED** (dev on `^0.50.1`; the §3.2
  blocker is paid).
- **Stage B css leaf-factoring — LANDED**: `simpleSelectorAtom`, `calcValueAtom`,
  `valueAtom` are named + `g.`-referenced; `TopLevel*` selectors were **collapsed
  away** (`7cb55892d`), not re-pointed — COMPOSE-SPEC §7's "still needed
  `TopLevelCompoundSelector` twin" is obsolete.
- **§9 CST convergence — LANDED**: main tower + batch-2 (`4c2b9dc93`).
- **§9(a) nested `RelativeSelector` (P29) — LANDED in all four dialects**
  (`9612d624b`); css + jess now ACCEPT `.parent { > .child }`. COMPOSE-SPEC §9's
  "css + jess REJECT it" is contradicted by the code.
- **At-rule prelude convergence — substantially LANDED** on dev (the
  `at-prelude-superset-convergence` branch is 177 behind / 1 ahead = superseded).
- **Backlog: #41, #50, #58 — LANDED.**

**GENUINELY REMAINING grammar cleanup:**
1. **Stage C compose — NOT STARTED in any dialect** (`grep cssBaseRules` over the
   three supersets = 0 hits; `cssBaseRules` is defined at `css grammar.ts:3911`
   but no superset imports it). scss→less→jess each still restate the full
   skeleton (`composeLeaf([cssSyntax, …, rules(delta)])`). THE big unit,
   structural-deletion + oracle-gated, one dialect at a time.
2. §9(b) pseudo-arg tower merge (less `PseudoArgument*` ×37, jess `PseudoSelector*`
   tower) — structural merge, oracle-gated.
3. §9(c) less simple-selector leaf / `LESS_SELECTOR_TYPES` LS special-case.
4. §9(d) `Nth*` name convergence — byte-identical rename IFF reducers match (verify first).
5. §7 css prelude residual (~1 commit, stale branch `b4273c50d`).
6. Backlog remnants: #25 math.div, #26 trailing comma, #40/#43, #45/#46, #56 Opaque*, #62.

---

## CLEANUP EXECUTION PROGRAM (the actual work — grammar edits SERIALIZED)

The analysis lanes are the reconnaissance; THIS is the deliverable. Compose is a
separate owner-driven track (parseman is in-house; §Lane 1 steer). These are the
grammar-cleanup batches, compose-INDEPENDENT, landable on published 0.46.0, each
verified + pushed before the next (grammar files can't take parallel edits):

1. **NamedColor → Keyword + eval coercion** (lane 7, IN FLIGHT `ab6b40fbcdcc05d04`).
   Correctness + dedup; the one-representation invariant's first instance.
2. **Leaf sharing** (lane 6 promote-set): where a superset re-spells a CSS leaf it
   could import (`Color`/`Keyword`/`CustomPropertyValue` in scss/jess), converge to
   the shared leaf. GUARD: less's word-leaf escape-drop may be intentional — probe
   before converging, don't assume drift.
3. **Mechanical rule-4 dedup** (delta lanes), per-item, each a real language check:
   (a) restore dropped `field('separator', …)` (7 jess + several less) — AST change,
   semantics-adjacent, needs oracle; (b) hand-rolled `oneOrMoreSep`/`sepBy` → shared
   combinator; (c) trivia re-spelled as explicit whitespace → shared trivia scopes.
4. **LESS selector-family triplication** (~16 consts): compound/complex/selector-list
   spelled 3× (outer / pseudo-arg / extend). Biggest single concentrated dedup.
5. **Rule-4 naming conformance** (lane 4 plan `715144b73`, 17 commits, zero-consumer
   -first). BLOCKED-cheapest-2 on Q1 (the `Quoted` key collision — owner decision).
6. **Opaque* family removal** (lane 5 target): unknown at-rule body → reuse
   `declarationListBlock`, residue = `opaqueStray` (unpaired quote); folds
   `OpaqueAtRuleBlock`→`AtRuleBlock`, kills the parallel mini-grammar. Shape change
   (`rawBody`→`rules`) — semantics-reviewer + oracle.

Each batch: isolated worktree, `check:macro` 0, guardrails 0, four parser suites +
core + packages/jess green vs baseline, byte-identity oracle, semantics-reviewer for
anything that changes emitted bytes/node types, then verify at head + push.

## The plan, one line each  (compose-reachability recon — ANSWERED, see §Lane 1)

- **Target** is set by lane 3 (delta measurement) — what fraction of each
  superset vanishes under compose = how small they get.
- **Reachability** is gated by lane 1 (does a patched, composed build actually
  *parse correctly*, not just fuse).
- **Last obstacle** is removed by lane 2 (hoist ~50 module-private helpers).

If lane 1 says the patched build parses correctly, conversion is mechanical:
delete identical + alias buckets, keep overrides, each superset = CSS + delta.

---

## Lanes (live)

| # | Lane | Agent ID | Kind | Status | Evidence / result |
|---|------|----------|------|--------|-------------------|
| 1 | Validate compose prototype EXECUTES (parses correctly, one real production end-to-end) | `a311a25d13a05a0dd` | impl (serial on grammar) | **DONE** | YES it works — but see §Lane 1 for the real cost |
| 2 | Hoist ~50 module-private helpers into importable module (behaviour-neutral) | `abfdb806442e1919f` | impl (serial on grammar) | **DONE** | `ef30b2579`, see §Lane 2 below |
| 3 | Measure CSS-vs-superset delta: bucket every const identical/alias/override/new/divergent | `abb02635c17f23e25` | analysis (r/o) | **DONE (SCSS)** | see §Lane 3 below |
| 3a | Classify LESS grammar vs CSS | `a84d04005cb9c2980` | analysis (r/o) | **DONE** | see §Lane 3 synthesis |
| 3b | Classify JESS grammar vs CSS | `a0b20dbbe56fa465c` | analysis (r/o) | **DONE** | see §Lane 3 synthesis |
| 4 | Rule-4 naming plan (7 aliases + §12.4 + §12.7); renamed vs ceases-to-exist | `a757fc652b4ac4255` | analysis (r/o) | **DONE** | see §Lane 4 below |
| 5 | Settle unknown-body reuse target (Q1 reuse production, Q2 escape-arm coverage) + AtRulePrelude twin | `a42add78a9922ccd7` | analysis (r/o) | **DONE** | see §Lane 5 below |
| 6 | Leaf diff: recognition.ts leaves vs CSS-factory twins — promote leaf-identical bucket-3 rows to 1/2 | `a70150a91b5bd6e3b` | analysis (r/o) | **DONE** | see §Lane 6 below |
| 7 | NamedColor→Keyword convergence + eval coercion (task #57) | `ab6b40fbcdcc05d04` | impl (grammar+eval) | **WORK DONE, HOLDING** | see §Lane 7 — pending 8-vs-9 reconcile + semantics verdict before commit |

All lanes instructed: `node scripts/check-guardrails.mjs` must exit 0; no
grammar edits from analysis lanes; no closure directives; verify independently
(rebuild `lib/`, check `~/git/oss/less.js` status, compare failing SET by file
not count) before anything is pushed.

## Lanes (done)

### Batch 1 / Lane 7 — NamedColor→Keyword + eval coercion — ✅ LANDED + INDEPENDENTLY VERIFIED

**PUSHED: `origin/dev` fast-forwarded `bbda2ec9f..411733b9d` (FF-only, no force).**
Confirmed from the main checkout: `origin/dev == 411733b9dac1aa835fa57e273244a9093e60ec6e`,
bbda2ec9f is ancestor (clean FF), commit "feat(core): NamedColor→Keyword convergence"
= 19 files. Final gate matrix at tip (fresh serial build:release exit 0): packages/jess
base-8 by name + operations.test division guard PASS; less-parser 730; core 3346;
keeper 8/8; guardrails 0; check-macro 0; linked less.js oracle clean (`alpha`@`d6ac8c60`).
Named colors are `Keyword` in all four grammars, materialize to `Color` at 5 points of
use, fold identically to hex + lessc 4.x incl. bare `red / 2`→`#800000` under `always`;
un-operated `color: red` verbatim. V13 OPEN pending owner ratification. DRY nit = task #58.
Task #57 COMPLETE.

### Pipeline state after the parseman 0.47.1 bump (2026-08-12)

CORRECTION: I earlier wrote "pipeline PAUSED, all agents blocked" from a SINGLE
background-agent spend-limit error — an over-extrapolation (the interactive session
kept running, and the owner confirmed agents can restart). Only the hoist agent died;
it is re-running. Don't repeat that blanket claim from one agent's error. State:

- **`origin/dev` = `179049c8c`** ("chore: record parseman 0.47.1", OWNER commit). Batch 1
  (`411733b9d`) is an ANCESTOR — intact. **Dev is now on parseman 0.47.1** — the bump
  adapts the grammars to the new `node()` 5-arg signature (jess grammar +104 lines, css
  +6, package.json versions, test baselines). This is the version skew that failed the
  semantics-reviewer's stale worktree earlier. NOTE: unverified whether 0.47.1 includes
  the compose analyzer-lifts (PARSEMAN-0.47.1-ANALYZER-LIFT-SPEC) or just the emission/
  node() changes — check before assuming the compose track is unblocked.
- **Consequence for the cleanup pipeline:** every queued grammar batch now rebases onto
  0.47.1. The delta measurements (lanes 3/3a/3b) + naming plan (lane 4) + opaque target
  (lane 5) + leaf diff (lane 6) were all measured on `bbda2ec9f` (0.46.0); the 0.47.1
  grammar changes may have moved some rows — RE-CHECK each analysis against 179049c8c
  before acting on its per-const numbers.

### ✅ error regression — RESOLVED + LANDED (parseman 0.48.1, `origin/dev` @ `89679d22e`)

Closed the whole saga. `origin/dev` = `89679d22e` (verified from main checkout: clean FF
from `179049c8c`, "fix(parser): land parseman 0.48.1 + clean error-reporting…"). dev GREEN,
packages/jess back to **8-by-name**. What landed (one commit): 0.48.1 bump (correct
OP_CHOICE deepest-frame narrowing — raw singletons `[")"]`/`[";"]`); core classifier
`expectedSelectorContextSummary` + `surfaceableExpectedTokens` (never leaks regex, any
frame); css `parse-error.ts` raw-token leak removed (shape-keyed message like less); `:239`
+ `:330` reconciled to true selector-context intent (both were bug-calibrated); css
render-differential baseline regen (owner-signed-off — 31 message-only moves, ALL
reject→reject, 0 emitted-CSS/status flips, no regex in the new baseline). Semantics-reviewer:
diagnostics-only, accept/reject boundary provably unchanged, no ledger row. Follow-up:
task #60 (direct-parse vs plugin message consistency). The union bug had MANY riders — 3
tests + a fingerprint set + a live css leak, all only "green" by masking; honest narrowing
surfaced them at once (why this took several verify-don't-assume rounds).

<details><summary>historical: the diagnosis path (0.47.1→0.48.0→0.48.1)</summary>

### 0.47.1 error regression — DIAGNOSED PARSEMAN-SIDE, handed to owner (agent `ae14fb85fd294b8d2`, no changes made)

dev `179049c8c` (0.47.1) is at 10 failed, not 8: 2 rows in
`parser-error-public-semantics.test.ts` (`rgb(1,2;`→"Invalid value." should be "Missing
closing parenthesis."; `@namespace … url(//…) .x`→wrong `)` should be "Missing semicolon.").
**Root cause is PARSEMAN, not jess** — 0.47.x's table-runtime `OP_CHOICE`
(`exec.ts:961–991`) UNIONS every arm's expected set up the nesting instead of propagating
0.46.0's single DEEPEST failure; jess's classifier gates delimiter/semicolon summaries on
`expected.length===1`, so the bloated set makes the value-summary win. Grammar is a correct
CSS copy — no missing `expect()` label; a grammar "fix" would mask a parseman regression.
Per owner constraint (don't change it if it's in parseman): NO jess edit, NO parseman-clone
patch, NO test edit, NO downstream `furthestFail`/`{recover}` workaround (explicitly
rejected). **Fix spec written for the owner's parseman agent:
`docs/architecture/parser/PARSEMAN-0.47.2-ERROR-REPORTING-FIX-SPEC.md`.** dev correctly
STAYS at 10 until the owner cuts parseman 0.47.2; the 2 rows go green then.

**⚠️ 0.48.0 does NOT fix the regression — VERIFIED empirically, bump HELD (not pushed).**
Agent `a5052ccd8ad4852ed`: bumped all 10 refs 0.47.1→0.48.0, clean install (only 0.48.0
in store), serial rebuild — the 2 rows are STILL RED, output byte-identical to 0.47.1.
Notably 0.48.0 DOES contain the deepest-failure code the spec asked for (`OP_CHOICE` sets
`_fe`/`_fx`, short-circuits FAIL), yet the rows fail — so **the diagnosis I relayed was
INCOMPLETE and cost a release.** Corrected understanding (to re-verify):
- ROW 1 (`rgb(1,2;`): likely a value continuation IS legitimately expected at the failure
  point alongside `)`, so the set is inherently multi-token and jess's classifier
  (`expectedValueSummary` :163 runs BEFORE `expectedClosingDelimiterSummary` :190, gated
  `length===1`) picks value → "Invalid value." Would make this a **JESS-SIDE classifier
  fix**, opposite of what the first diagnosis (and my bug report to the owner) claimed.
- ROW 2 (`@namespace … url(http://…) .x`): a DIFFERENT mechanism — `//` inside `url()`
  read as a line comment, unbalancing parens. The `OP_CHOICE` fix never touched it.
**RE-DIAGNOSIS DONE — VERDICT: PARSEMAN-SIDE, evidence-backed** (`a5052ccd8ad4852ed`).
Raw `result.expected` dumps (0.46.0 built from `179049c8c~1`): ROW1 `rgb(1,2;` — 0.46.0
`[")"]` len 1 → 0.48.0 **82-token union** at the SAME offset 25; ROW2 `@namespace…url()`
— 0.46.0 `[";"]` len 1 → 0.48.0 **14-token union** at SAME offset 47. Position always
correct; only the SET is wrong — 0.47+/0.48.0 emit the UNION of all `OP_CHOICE` arms
instead of the deepest-frame singleton. Two downstream jess symptoms, one upstream cause:
ROW1 the union carries a value signature → `expectedValueSummary` masks the `)`; ROW2 the
union fails every `length===1` gate → falls to `delimiterConflictSummary` which misfires
on `//` in `url()` (task #59, secondary/masked). **My "probably jess-side" guess was WRONG
— the control case `@media (missing: bracket {` (a `)`-containing union that must report a
DIFFERENT column than a singleton) proves jess's `length===1` gate is the CORRECT encoding
of the deepest-frame signal; relaxing it breaks the control.** Only parseman can restore
the singleton. VERIFIED SUFFICIENCY: `[")"]`/`[";"]` through jess's UNCHANGED classifier
reproduces both expectations. Corrected evidence-backed spec:
`docs/architecture/parser/PARSEMAN-OP-CHOICE-EXPECTED-SET-UNION-BUG.md` (renamed from the
stale 0.47.2 spec). Bug report handed to owner for the parseman agent.

**parseman 0.48.1 = the CORRECT fix, VERIFIED** (agent `a5052ccd8ad4852ed`): raw dumps now
`rgb(1,2;`→`[")"]`, `@namespace…`→`[";"]` (0.46.0 singletons); rows `:274`/`:384` GREEN.
The OP_CHOICE deepest-frame narrowing is real. **BUT it flipped a THIRD row `:239` RED** —
which was passing under 0.48.0 FOR THE WRONG REASON (it rode the union bug). Input
`.val { @alias: .theme; }` fails at the `:`; 0.48.1 correctly narrows to a MIXIN/SELECTOR
frame (`{`/combinator/selector/`(`), so jess's `expectedValueSummary` (which had matched the
old union's value signature) no longer fires, ALL summaries fall through, and the fallback
LEAKS raw regex — the exact thing `:239` ("without leaking atom internals") forbids.
**Verdict: parseman correct; the new failure is a JESS-side classifier defect coupled to
the old bug — FINALLY landable jess-side.** Fix in flight (agent `a13e1f2c6770a561e`,
implementer + semantics-reviewer). First pass: classifier fix DONE — new
`expectedSelectorContextSummary` ("Expected a selector, mixin call, or block.", never
prints regex) + `surfaceableExpectedTokens` guard restricting the generic fallback to
quoted literals; `:239` reconciled (Option A — retargeted to selector-context intent,
value-summary coverage preserved at `jess-error.test.ts`). It found **2 MORE union-bug
riders** beyond `:239` (same class): less-parser `public-parse.test.ts:330` (asserts the
old union message/tokens) and the css `render-differential` (12 fixtures moved, ALL
reject→reject — parse-acceptance + emitted-CSS UNCHANGED — because css `parse-error.ts:33`
embeds the raw `expected` list, which also LEAKS regex). **Owner authorized (2026-08-12):
fix the css leak, then regen the differential baseline.** Final commit bundles: 0.48.1 bump
+ core classifier fix + `:239` + `:330` reconcile + css `parse-error.ts:33` leak fix (clean
messages, like less) + differential baseline regen (owner-signed-off, message-only moves).
Follow-up flagged: direct-parse (`parse-error.ts`) vs plugin (`core/diagnostics.ts`) paths
give inconsistent messages — the direct path lacks the nice summaries; a "one definition
two paths" unification is a separate task. Gate: green-baseline (8-by-name +
`:239`/`:274`/`:384`/`:330`/differential green) → semantics-reviewer → push FF. Once it
lands → dev GREEN on 0.48.1 → AST train (hoist rebases onto the bump + pushes → selector
1-const → #41). THE UNBLOCK.

### Batch 2 / helper hoist — ✅ LANDED `origin/dev` @ `4fb05c560` (agent `abfdb806442e1919f`)

FF from `89679d22e`, behavior-neutral, green-8 by name, check:macro 0, all parser suites +
core green, guardrails 0. Artifact delta **−32,060 B** across all 16 grammar artifacts
(−1094 css / −1581 less / −2887 scss / −2453 jess per variant × 4 variants; the earlier
"~−16KB" counted only the 2 AST variants). 10 byte-identical helpers hoisted; no divergent
helper unified. CST shrinks with AST under 0.48 table codegen (expected).

### Batch 4 / LESS selector 1-const merge — ✅ LANDED `origin/dev` @ `7a11b509` (agent `a6c2a08cfa9358e94`)

`ExtendTargetComplexTail`→`g.ComplexTail`, const deleted (net −1). PROVEN output-equivalent:
emitted CSS byte-identical across `.a:extend(.x > .y all)` / `.z ~ .w` / plain, only the CST
tail label changed (`ExtendTargetComplexTail`→`ComplexTail`); grep confirmed NO consumer of
the old label anywhere in source. Green-8, all suites, guardrails 0. Semantics-reviewer
correctly skipped (bytes empirically proven not to move).

### Batch 5 / #41 namespaced-selector wrong-node — ✅ LANDED `origin/dev` @ `3b249a075` (agent `a70f54e3163e575ed`)

All four dialects now agree: `svg|circle`/`*|a`/`|a` = ONE `SimpleSelector` (css was splitting
on `|`; scss/jess REJECT→accept; less unchanged), `[svg|attr]` = namespaced attribute, `||`
stays column combinator, `|=` intact. Emitted CSS byte-identical; css render-differential
IDENTICAL. Scope stayed contained (combinator + type-ns + attr-ns; reused `SimpleSelector`, no
new AST node; core untouched). DESIGN-DECISIONS **P27** (cites CSS spec + P22/G23, not the
reference impl). 5 css-superset-corpus entries flipped brokenIn/PINNED-DEFECT→contract.
Semantics-reviewer PASS, no blocking; closed the S7 node-shape-pin gap. Gates: css 512, scss
622, jess 510, less 730, core 3346, packages/jess 8-baseline, css byte-identity IDENTICAL,
check:macro 0, guardrails 0.
Residuals (pre-existing, out of scope): task #61 (less/scss oracle corpus drift — A/B-confirmed
NOT from #41); grammar-reviewer per-const NOT run (semantics-reviewer was the gate; optional
follow-up before a release); jess `:has(> svg|circle)` leading-combinator reject (orthogonal
.jess-trails gap, also rejects `:has(> .b)`); less accepts INVALID spaced `svg | circle`.

## Roadmap (owner, 2026-08-14, ORDERED): grammar cleanup → normalize AST → bug fixes → Less feature gaps
Memory: `weekly-roadmap-cleanup-normalize-bugs-lessgaps`. Default new work to the earliest
incomplete phase. Landed so far spans phases 1–2.

## Scoreboard (all onto green 0.48.1)
- **P2 normalize:** NamedColor→Keyword `411733b9d` · #41 namespace `3b249a075`.
- **P1 cleanup:** hoist `4fb05c560` (−32KB) · selector merge `7a11b509` · #50 jess dup-keys
  `2ed30e78c` (3 dead shorthand keys removed, behavior-neutral).
- **P1 cleanup:** dup-key GATE `c8b10cd46` — added `no-dupe-keys` to the TS eslint block;
  it caught + fixed a 4th dup (`QueryValue` in scss grammar:5952, #50's jess-only scan missed
  it). Class now can't recur on green. STILL OPEN: the TYPE-level `QueryValue` dup in BOTH
  `JessRules` (225-229) AND `ScssRules` (125+206, `Combinator<ValueNode>` vs `<unknown>`) = the
  `verify:types` baseline `Duplicate identifier 'QueryValue'` (memory:verify-types-baseline-is-one)
  — TS-level, not object-key, so no-dupe-keys can't cover it; considered change (removing may
  surface masked type errors).
- **P1 cleanup:** type-dup `8fb0a3577` — cleared the 4 `QueryValue`/`QueryTerm`/
  `QueryFeatureName` `Combinator<unknown>` shorthand dups from `JessRules`+`ScssRules`
  types; **verify:types 31→19** (zero new). Dup cleanup now closed at BOTH object + type
  level. The remaining **19 are REAL pre-existing grammar type errors** = task #62. Process
  note: an isolated verifier's branch name (`verify-clean-tip`) COLLIDED with the parent's
  worktree mid-run and reset its edits — future isolated verifiers need a DISTINCT branch
  name. Also: verify:types masks 19 real type defects behind a "known baseline" — it's not a
  real gate until #62 clears it.
- #50 flags: (a) NO dup-key GATE — `no-dupe-keys` absent from the TS eslint block
  (`compat.extends()` called with no args, so eslint:recommended not applied to .ts) → add
  `'no-dupe-keys':'error'` to catch the class (in flight). (b) `JessRules` TYPE (225-229) has
  the SAME 3 members duplicated as `Combinator<unknown>` = the documented `Duplicate identifier
  'QueryValue'` verify:types baseline (memory:verify-types-baseline-is-one) — out of scope,
  tied to the type baseline, separate considered change.
- Queue: mechanical rule-4 dedup (separator/sep/trivia — semantics-adjacent, oracle each);
  #50 jess duplicate keys; #43 pseudoArgumentContent; #45/#46 dialect accept/reject; naming
  conformance (Q1 Quoted-key owner decision); Opaque* removal (owner reuse-target decision).
- Standing debt: re-check the delta/naming/opaque analyses against the CURRENT tip (they were
  measured on bbda2ec9f/0.46.0; grammars have moved through NamedColor+hoist+selector+#41+0.48.1).

### Batch 2 / helper hoist — [superseded history]

Not an arbitrary hold: the hoist must rebase onto the 0.47.2 version-bump commit anyway
(same as it just rebased onto the 0.47.1 bump), so it naturally waits for 0.47.2, then
lands onto a GREEN-8 dev. Behavior-neutral, all gates green at its current HEAD.
[superseded log below — RE-RUNNING was the prior state]

Branch `refactor/hoist-grammar-helpers` (agent `abfdb806442e1919f`), resumed after the
spend-limit blip. Rebasing onto `179049c8c` (0.47.1 changed the grammar files, so a
bigger rebase than onto 411733b9d), serial build:release against 0.47.1, re-verify
behavior-neutral (check:macro 0, suites green, packages/jess base-8 BY NAME + NamedColor
guard), push FF. Behavior-neutral hoist; artifacts were −16KB on 0.46.0.

### Batch 3/4 / LESS selector-family true-dup analysis — DONE (agent `a15977e3f36f757e4`, base `179049c8c` 0.47.1, doc `LESS-SELECTOR-DEDUP-FINDINGS.md` `ea961cf53`, guardrails 0, no source touched)

**RE-SCOPED: the "~16 consts triple-spelled" (0.46.0 finding) does NOT survive a
recognition+reducer read on 0.47.1. Exactly ONE true duplicate exists — 16→15, not the
big dedup I'd queued.** The triple (outer/pseudo-arg/extend) is real but its members are
GENUINE CONTEXT VARIANTS, not copies — the `valueSlot`/batch-1 lesson again.
- **The one true dup:** `ExtendTargetComplexTail`(:6363) ≡ `ComplexTail`(:6315) —
  byte-identical `sequence(optional(staticCombinator), g.Compound)` + same
  `combinatorTailReducer`, only the `node()` name differs (reducer emits a nameless
  `ComplexTailFact`, so merge is output-equivalent). Plan: at :6374 use `g.ComplexTail`
  (already g-proxied :280), delete :6363-6367. Only the CST label changes; no hand-written
  consumer of the string outside grammar.ts/lib. Oracle-check inputs listed in the doc
  (`.a:extend(.x > .y all)`, `.a:extend(.x + .y, .z ~ .w)`).
- **Why the rest STAY (each read-verified):** compounds differ by arm set (15-arm
  `compoundSimple` vs 6-arm static, and the two 6-arm ones differ by `PseudoSelector` vs
  `pseudo`); `PseudoArgumentComplexTail` has a `staticSelectorTrivia` scope `ComplexTail`
  lacks; `Complex` vs `ExtendTargetComplex` differ in the `many()` stop-guard
  (`not(whenGuardAhead)` vs `!?all`) — repo rule bans a factory to parameterize; `Selector`
  vs `PseudoArgumentSelector` differ in a load-bearing source span (renderer reads it).

Net: the highest-value structural dedup I'd expected (batch 4) is a 1-const merge. The
real grammar weight is genuine per-context variation, not copy-paste — consistent with the
delta lanes' finding that OVERRIDE ≠ removable duplication. Batch 4 re-scoped to "1-const
`ExtendTargetComplexTail` merge," queued behind the hoist + the 0.47.1 error fix.

### RESUME ORDER when the limit is raised
1. Batch 2 helper hoist — rebase onto 0.47.1, land (low-risk, ready).
2. Re-check lanes 3–6 analyses against 0.47.1 grammar (numbers may have drifted).
3. Batch 3+: structural dedup — LESS selector-family triplication (needs true-dup vs
   context-variant per-const analysis FIRST), mechanical rule-4 (separator/sep/trivia,
   semantics-adjacent — oracle each), then naming conformance (lane 4; Q1 Quoted-key
   collision = owner decision) and Opaque* removal (lane 5 target; owner reuse-target Q).
4. Owner-decision backlog: V13 SETTLED-vs-OPEN ratification (task #57 landed OPEN);
   Q1 Quoted key; Opaque reuse-target + prelude-family fold.

**UPDATE (2026-08-12): the slash regression is FIXED and oracle-confirmed.** The
audit-found gap (`appendBareSlashTokens` operand gate rejected the new `red` Keyword)
is closed with a one-leaf gate addition at serialize.ts:2881
(`|| (node.type==='Keyword' && namedColor(node.src)!==undefined)` + import), fold done
downstream by the existing `operate()` coercion. Now symmetric with lessc
(`--math=always`: `red / 2`=`#ff0000 / 2`=`#800000`, `foo / 2` preserved); default mode
untouched (`promoteBareSlashValue` runs only under `always`). Guard ENABLED
(operations.test.ts color-keyword-division row, un-todo'd; font-shorthand slash-SPACING
row stays todo — that's OPEN V12, unrelated). V13 SETTLED→**OPEN** (regression framing
retracted; re-scoped correct; owner sets status). Extra sweep: no 6th gap (comparison,
color fns, color-color arithmetic all fold for named like hex). Gates: core 3346,
packages/jess base-8 by name + operations.test 59 (incl new guard), keeper 8/8,
less-parser 730, guardrails 0, check-macro 0, no `as any`. Agent will amend the commit
+ relay the semantics-reviewer verdict, then it's ready to push (clean FF onto origin/dev).

**Semantics-reviewer: PASS, no blocking findings** — all 8 invariants + S1–S7; confirms
the fix CLOSES the invariant-4 divergence (not re-homes it), un-operated `red` stays
byte-verbatim, V13 correctly OPEN (lessc as confirmation not justification, no
self-close). Reviewer's own local build FAILED on an UNTOUCHED file (`css-parser
grammar.ts` `node()` 5-vs-3 args) = stale-parseman drift in ITS worktree, NOT this
change → reviewer evidence is static. One non-blocking DRY nit: the "colour-like"
predicate is spelled at 5 sites over the one `namedColor` table → filed as task #58
(shared `isColorLike(Value)`), NOT folded in (scope). **Push in flight** (agent
`ab6b40fbcdcc05d04`): amend → fetch+confirm origin/dev unchanged `bbda2ec9f` + clean FF
→ fresh SERIAL rebuild + re-confirm gate rows at tip (packages/jess base-8 by name +
operations.test guard; less 730; core 3346; guardrails/check-macro 0; `less.js` oracle
clean) → `git push origin HEAD:dev` FF-only → verify origin/dev == amended SHA.
Re-verified in the implementer's KNOWN-GOOD build env, not a fresh worktree (which
could hit the same parseman drift the reviewer did).

Implementation clean; ALL gates green. Files: less grammar (deleted `NamedColor`
production + interface + factory-return + 4 use-sites), `parser-shared/recognition.ts`
(deleted `lessNamedColor` 148-word list + `NamedColorToken`), less `parse-error.ts` +
`core/error/diagnostics.ts` (dead disjuncts), `ast/literal-tag.ts` (new
`coerceNamedColorKeyword`), `ast/value-dispatch.ts` + `ast/value-operate.ts` +
`ast/value-guards.ts` (coercion at 3 points of use), fns `less/types.ts` +
`sass/meta/type-of.ts`, DESIGN-DECISIONS **V13**, new keeper test, 59 expectation
updates (hex stays `Color`).

Gates: packages/jess **8 failed = base-8 BY NAME** (zero regression), less 730, css
511, scss 622, jess 510, core 3346, fns 720, guardrails 0, check-macro 0. Zero parse
regression (throwing set byte-identical, 122 files). Semantics-reviewer **PASS, no
blocking findings**; "CLOSES an invariant-4 divergence."

**By-name check earned its keep:** branch initially had 9; the 9th
(`all-less::mixins-guards-default-func.less`) was a REAL regression — a FOURTH
iscolor/iskeyword impl (mixin-guard `typeCheck`) that count-only AND the reviewer's
diff-only view both missed. Fixed via `asColor`. Also closed a pre-existing bug: scss
`lighten(red)` emitted verbatim (broken), now folds.

**TWO owner follow-ups (correctly deferred):**
1. **less byte-identity oracle "moved" — NOT re-baselined** (intended reclassification;
   oracle doc: regenerate as its OWN reviewed change). Queued.
2. **HELD ON SLASH-SEMANTICS RESEARCH (owner-directed) — not just V13.** Measured:
   default mode (jess default) is FULLY consistent — `red / 2` AND `#ff0000 / 2` both
   stay slash-lists, both fold in parens. Asymmetry appears ONLY under `mathMode:
   always`: `#ff0000 / 2`→`#800000` (folds), `red / 2`→slash-list — because the
   Operation-vs-slash-list split is a PARSE-TIME decision keyed on operand NODE TYPE
   (Color=math operand, Keyword=not). **This keying appears to CONTRADICT the repo's
   own SETTLED rule DESIGN-DECISIONS P1** ("math mode is a PARSE-TIME input; `/` parses
   per mode" — the LESS operand-AGNOSTIC model, `memory:less-math-mode-is-parse-time`).
   Owner (2026-08-12) recalled the three models (Less: mode-gated, operand-agnostic;
   Sass: "outsmart" — divides only if both sides are values; CSS: always separator) and
   directed: research/audit the tests before deciding the parse rule. If P1's mode-based
   model is intended, the clean fix is to make `always` parse `/` operand-AGNOSTICALLY
   (both hex and named → `Operation`) and let the point-of-use color coercion ALREADY
   BUILT fold `red / 2` too — resolving the asymmetry with no new machinery. Open
   sub-question: what should `foo / 2` (non-color keyword) do under `always`? RESOLVED-
   SEMANTICS already flags jess `.scss` DIVERGES from dart-sass across the whole slash
   family. Audit lane dispatched (`af597fcf980d834a3`), grounded in P1, measured vs
   lessc 4.x + dart-sass. **Push held until the slash rule settles** — the NamedColor
   change may land as orthogonal (default-consistent) or wait; the audit answers which.
   V13 status remains OWNER's call and will be re-worded mode-qualified either way.

### Slash audit (agent `af597fcf980d834a3`, base `bbda2ec9f`, doc `SLASH-DIVISION-AUDIT.md`, committed `58a756c7c`, no source changed) — REFUTED my premise, CAUGHT A REGRESSION

Owner-directed research into `/` parse semantics. MEASURED (lessc 4.8.1, dart-sass
1.102, jess lib/):
- **lessc `--math=always`: folds BOTH `red / 2`→`#800000` AND `#ff0000 / 2`→`#800000`
  (symmetric), preserves `foo / 2`.** So lessc is operand-AWARE at eval (color folds,
  non-color keyword preserves), NOT operand-agnostic — my "P1 = agnostic" gloss was
  wrong; P1 governs mode→AST only, silent on operand type.
- **jess on DEV already matches lessc row-for-row** — no hex-vs-named asymmetry on base.
- **The NamedColor branch INTRODUCES the asymmetry** = a REGRESSION. It added
  `coerceNamedColorKeyword` to `operate()`/`validateValue`/`typeCheck` but MISSED the
  bare-`/` operand gate `appendBareSlashTokens` (serialize.ts:2881, accepts operand
  iff `type==='Dimension'||'Color'`). So `red` (now `Keyword`) is rejected there →
  `red / 2` under `always` regresses `#800000`→slash-list while `#ff0000 / 2` still
  folds. Two asymmetries lessc has neither of (hex-vs-named; `red * 2` folds vs
  `red / 2` separates).
- **Invisible to the suite** because the guard (`operations.test.ts` `red / 2`→
  `#800000`) is `describe.todo` — never executed. The branch's "base-8 by name, zero
  regression" was true for RUNNING tests but blind to this.
- **V13 self-blessed it** — SETTLED row calling `red/2`-as-separator a "known
  consequence," resolving AGAINST the lessc oracle + the todo-test intent. The
  self-authored-closure pattern the guardrails forbid.

Fix (audit-spec'd, now in flight on the NamedColor agent): add
`coerceNamedColorKeyword` at `appendBareSlashTokens:2881` (reuse existing helper) →
`red / 2` folds like `#ff0000 / 2`, `foo / 2` preserves naturally (`namedColor('foo')`
undefined), symmetric, matches lessc, no special-casing. PLUS enable the todo guard +
re-scope V13 to node-representation with CORRECT behavior + status OPEN (not
self-SETTLED) + re-run semantics-reviewer. **Vindicates the hold: the owner-directed
research caught a regression the suite could not see.** Per-dialect `/` model (audit
Q1, owner questions, no decision): `.css`=always separator; `.less`=mode-based
eligibility + operand-aware fold (lessc); `.scss`=separator/`math.div` (dart-sass
parity = open debt); `.jess`=marker-based (`$()` only).

### Lane 5 — unknown-body reuse target (agent `a42add78a9922ccd7`, HEAD `1bf8d81b1`, serial build, guardrails exit 0, measurement only, no grammar edits)

Method: the 37 body cases at `css-parser/test/opaque-at-rule-body.test.ts:106-147`,
each body fed to every ordinary body production through a real source vehicle.
Positive-control instrument (productions separate 9/19/23-of-28), not a null test.

- **Q1 — reuse target is `declarationListBlock` alone** (`css-parser/src/grammar.ts:3758`).
  Covers 23/28 and is a **strict superset** of all five other body productions on
  this corpus (its item is `choice(declarationListDeclaration, NestedConditionalBlock,
  DeclarationListAtRule, Ruleset, ';')`). So **no context split** — the doc's
  "both, chosen by context" guess is unneeded; an unknown at-rule has no level
  meaning to preserve. `stylesheetBodyBlock`/`conditionalGroupBodyBlock` fail 19/28
  (every declaration case). Confirmed it does **not** widen: rejects the same 4
  bodies the unknown at-rule rejects today.
- **Q2 — the escape arm is exactly ONE class: an unpaired `'`/`"`** — i.e.
  `opaqueStray` (`parser-shared/src/opaque-at-rule.ts:51`, `/['"]/`), whose own
  docstring already says so. 7 residue cases, all this class.
- **Load-bearing discovery: `EnclosedContent:3626` is an arm-for-arm structural
  twin of `OpaqueBody`, and PREDATES it.** `OpaqueGroup`'s brace group is literally
  respelled at `EnclosedGroup:3614`; `OpaqueString`→`EnclosedQuoted:3587`;
  `OpaqueComment` folds into `EnclosedRaw`. The two text regexes differ by two
  char-class members (parens/brackets).
- **Prelude family answers the same way.** `AtRulePrelude:3141` accepts 18/22;
  the 4 it rejects need one tolerance arm (unpaired quote + unbalanced group).
  But `AtRulePreludeSegments:3091` is **one of four spellings of one token
  language** — `atPreludeTextSegment:3084`, `enclosedText:1129`, `opaqueText`
  (shared:50), `importTailText:1022` (feeding `ImportTail*`, which even shares
  `AtRulePreludeSegments`' reducer `semanticTextWithTriviaGaps:371`). Removing the
  body family alone leaves 3 copies of the token language + 2 of the segment
  language standing.
- **AST consequence, measured:** `OpaqueAtRuleBlock` → `AtRuleBlock`;
  `rawBody: string` → `rules: Statement[]`; `prelude: string` → `Any`; kind count
  at `core/src/ast/node.ts` drops by one.
- **CAUTION (the non-free part):** `EnclosedContent`'s reducer (`grammar.ts:3633`)
  emits a flat `Interpolation` string. Reusing it for the residue **relocates the
  flat-`rawBody` problem, does not remove it** — only the `declarationListBlock`
  path yields a real tree. So the residue arm's reducer is the one piece needing
  design, not free reuse.

Feeds: #56 (Opaque* removal), #49 (unknown-body decision), `OPAQUE-FAMILY-REMOVAL.md`.
Owner said measurement only — replacement NOT designed. Next owner action needed:
sanction the `declarationListBlock` reuse + `opaqueStray` residue shape, and rule
on whether the prelude family is folded in the same pass (entangled with 3 more
token-language copies).

### Lane 3 — CSS-vs-SCSS delta, COMPLETE 203/203 consts (agent `abb02635c17f23e25`, base `bbda2ec9f`, build:release exit 0, guardrails 0, committed `e8e89d0a3` not pushed)

STATUS: SINGLE-SOURCE (measured on a base 4 commits behind current `origin/dev`
`93c67d0ae`; structural classification so drift is unlikely to move buckets, but
NOT yet re-verified at head). Per-const rows in the agent worktree at
`docs/architecture/parser/SUPERSET-DELTA-MEASUREMENT.md`.

Buckets: IDENTICAL 10 (4.9%) · ALIAS 8 (3.9%) → **18 vanish under compose (8.9%)**
· OVERRIDE 108 (53.2%) · NEW 71 (35.0%) · DIVERGENT 6 (3.0%).
Real compose target once 24 naming-only/inlined-body overrides + the 8-way
`PseudoSelector` split fold in: **42/203 ≈ 20.7%**.

**THE FRAMING INVERSION (surfaced to owner):** *105 of CSS's 200 consts have no
SCSS counterpart at all.* SCSS **lacks half of CSS** (`VarFallback*`×19,
`Calc*`×7, pseudo-arg typing×6, `Typed*`×6, at-rule routing×8, `Container*`×3,
`TopLevel*`×3). So it is NOT "CSS + delta with a copied CSS core" — the compose
prize on SCSS is ~a fifth of the file, not the ~90% the "supersets are copies"
memory implies. Copying runs the OTHER way. This tensions the memory
`superset-grammars-are-copies-reuse-is-byte-identity` — do NOT rewrite that
memory until less+jess (3a/3b) land and this is re-verified at head.

**The six behavioural divergences (each with its input):**
1. `scssCombinator:5572` = `choice('||','>','+','~')` — missing `'|'` vs css
   `combinator:1027`. `a|b{}` FAILs scss+jess. (= task #41, the namespace family.)
2–4. `ConditionalBlock:4702` / `NestedConditionalBlock:4934` /
   `IfBodyConditionalBlock:3865` gate `@container` with `not(QueryOnly)` →
   `@container only (width>10px){}` FAILs scss; css routes `only` as an ordinary
   container name via a dedicated `Container*` lane.
5. `Call:1906` has no empty-arg arm → `var(--x,)` **THROWS** in scss; css has
   `VarFallbackEmpty:2127`.
6. `ValueTail:2168` reads `/` as slash-list separator even inside `calc()` →
   `calc(1px*2/3)` yields an unfolded array in scss. The one visible price of the
   zero-`Calc*` value lane.

**Value lane confirmed exemplary & quantified:** `calc` occurs 0× in scss grammar
(css 82, jess 78, less 25), `VarFallback` 0× (css 68) — costs nothing for normal
`var()`, costs exactly rows 5–6. → *CSS's own 19-const `VarFallback` family is a
stronger deletion candidate than anything in SCSS* (deletion in CSS, additive fix).
Inverted forks (fix additive in css): `a{*color:red}` (scss+less accept), `[ns|attr]`
(less alone). Incidental: jess rejects `@page :first`, `@property --x{}`, `a|b`
(= task #45).

### Lane 3 SYNTHESIS — all three supersets classified, every const read (agents `abb02635c17f23e25` SCSS / `a84d04005cb9c2980` LESS / `a0b20dbbe56fa465c` JESS; base `bbda2ec9f`; SINGLE-SOURCE, bucket-5 rows are READ-DERIVED PREDICTIONS not executed parses)

**"Vanishes outright under compose" (buckets IDENTICAL+ALIAS):**

| grammar | consts | 1+2 vanish | OVERRIDE | NEW | DIVERGENT |
|---|---:|---:|---:|---:|---:|
| SCSS | 203 | 18 (8.9%) | 108 | 71 | 6 |
| LESS | 342 | 19 (5.6%) | 149 | 164 | 10 |
| JESS | 224 | 12 (5.4%) | 102 | 101 | 9 |

**The headline correction — and it cuts BOTH ways.** The "supersets are ~90%
copies of CSS" mental model is wrong *at the whole-const level*: only 5–9% of
each superset vanishes outright, because (a) the supersets **omit large parts of
CSS** (SCSS lacks half — no `VarFallback*`/`Calc*` families) and (b) each has a
big genuinely-own surface (LESS bucket-4 = 164, dominated by mixins/guards 40,
interpolation 19, extend 15, references 14). **But** the reducible prize is far
bigger than 5–9% and is hidden in bucket 3 — see next.

**THE CONVERGENT CAVEAT (both LESS and JESS agents raised it independently,
unprompted):** bucket 3 OVERRIDE is inflated by **leaf opacity**. Many 3-OVERRIDE
rows are *recognition byte-identical* and differ only by a reducer name or by a
shared-recognition leaf the agent could not see from the grammar file
(`g.Identifier` vs `identWord`, `g.NumberToken` vs `numberValue`, `g.DimensionUnit`
vs `dimensionUnit`, `g.HexColor` vs `hexColor`). Named recognition-identical rows:
LESS #194 `EnclosedGroup`, #201 `SupportsCondition`, #218 `QueryOnlyClause`, #265
`OpaqueAtRuleBlock`, #46 `Keyword`; JESS `EnclosedGroup`, `Important`, the
CalcProduct/CalcSum pair. **→ HIGHEST-VALUE NEXT MEASUREMENT, named by both agents:
diff the recognition-package leaves (`parser-shared/src/recognition.ts`) against
their CSS-factory twins. That single diff promotes an unknown but material slice of
bucket 3 into 1/2 and is the real answer to "how small."** (Recorded as lane 6, dispatched.)

**The bucket-3 deltas cluster into a few MECHANICAL, non-semantic causes** — these
are the rule-4 duplications compose is meant to erase, distinct from legitimate
interpolation overrides:
- **Dropped `field('separator', …)` capture** — JESS 7 consts, LESS several. Loses
  authored comma/space padding CSS records. Pure loss, no language change.
- **Hand-rolled `oneOrMoreSep`/`sepBy`** instead of the CSS combinator — JESS 7, LESS many.
- **Trivia re-spelled** as explicit `optional(rawWhitespace)`/`regex(/[ \t…]+/)` for
  CSS's ambient `cssValueTrivia`/`interstitialTrivia` scopes — JESS 12, LESS pervasive.
- **Selector-family TRIPLICATION (LESS)** — CSS's one `CompoundSelector`/
  `ComplexSelector`/`SelectorList` triple is spelled THREE times in LESS (outer,
  pseudo-argument, extend): ~16 consts. Single largest concentrated duplication found.
- **At-rule block collapse** — CSS's 8–9 typed block nodes → 1 generic node
  (JESS `AtRuleBlock`, LESS `AtRuleBlock`). Legitimate shape choice, but drops
  CSS's per-rule prelude typing (e.g. `@page :first`).
- **Interpolation-operand injection** — the ONE legitimate superset override (LESS
  ~34, adds `VariableInterpolation`/`Interpolation` to a CSS choice). Rule-4 says:
  keep the CSS name, this is an override not a new rule.

**Bucket 5 — behavioural divergences vs plain CSS (READ-DERIVED, must be probed
before acting).** The ones flagged as probable defects/omissions, cross-referenced
to existing tasks:
- combinator `|` missing → `svg|circle` FAILs in JESS + SCSS (= #41/#45).
- JESS `:has(> .b)` — no relative-combinator arm anywhere in the file (new, probe).
- LESS `Paren` interior is `MathSum` → `(c, d)` and `()` REJECTED (CSS accepts; css:2224 records it). Probe.
- LESS `gridLineName`/JESS `SquareValue` — grid `[a b]`/`[]` structure lost. Probe.
- `@media 10px`, `@media only layer`, `@container scroll-state(...)` — accept/reject
  splits across the three (= #45/#46). Probe each.
- **NamedColor (LESS + others): `a{color:red}` reduces to `Color` in LESS, `Keyword`
  in CSS — same bytes, DIFFERENT node type.** A real semantic divergence, not just accept/reject.
- LESS `@supports (a:b),(c:d)` — no `SupportsPrelude` comma-list arm. Probe.

Full per-const tables live in each agent worktree (SCSS committed `e8e89d0a3` at
`docs/architecture/parser/SUPERSET-DELTA-MEASUREMENT.md`; LESS/JESS in their task
output). NOT yet consolidated into the repo — consolidation pending head re-verify.

DO NOT rewrite memory `superset-grammars-are-copies-reuse-is-byte-identity` yet —
it is directionally right (every const hand-maintained, none imported) but its
implied *magnitude* (~90%) is now measured wrong; correct it only after the leaf
diff (lane 6) lands and the numbers are re-verified at head.

### Lane 4 — rule-4 naming conformance plan (agent `a757fc652b4ac4255`, base `bbda2ec9f`, guardrails 0, no grammar touched, plan committed `715144b73` not pushed at `docs/design/RULE-4-NAMING-CONFORMANCE-PLAN.md`)

**Core finding — a rule has TWO public names in different conformance states:**
- **S1 rule key** — the `const` / `g.X` / factory object key → exported grammar
  key set. Caught by `tsc`.
- **S2 CST label** — the `node('…')` first arg, read as `grammarType` by
  `cst-host.ts`, the language service, `tolerant-cst.ts`, `cst-public` tests.
  **Caught by NOTHING.** This split is why all three name sources disagree with
  the tree.

Stale-standard corrections (all at this SHA):
- `LiteralQuoted` — the owner's archetype — **already emits label `'Quoted'` in
  all three supersets**; only the KEY is wrong, zero consumers. Cheapest, not
  costliest.
- less DOES carry a bare `Compound` (`:6280`); the standard's "less has three"
  parenthetical is stale.
- css §12.4 is **6/11 done, not 0/11** (5 fixed on label surface only, so a
  const grep still finds all 11).
- `ComplexTail`/`SelectorTail` are **NOT rule-4 violations** — CSS spells the tail
  inline; they **cease to exist under compose**. Renaming = the wasted work §12.5
  warns of. Recorded do-not-touch.
- jess `Simple:2931` is an unlisted §12.4 row (scss twin fixed `:5201`, jess missed).

`Compound` ruling: bare `Compound` is a rule-4 violation on both surfaces; the
three context-qualified productions are a legitimate positional distinction (keys
keep qualifier) but their **labels must be `'CompoundSelector'`**. `ClassIdCompound`
+ `Compound` emit the same label today — a defect regardless.

Plan: 17 landable commits, ~148 lines, ordered zero-consumer-first, each green.
**First commit isn't a rename:** `tools/grammar-tournament/src/namecheck.mjs:26-57`
is a verbatim copy of cst-host's tables that 11 later commits would edit twice
with nothing gating the second. Every commit body must state AST-kind and legacy
`core/src/tree` spellings are a DIFFERENT namespace and not being renamed (else a
grep reports 10× blast radius).

**OWNER DECISION NEEDED — Q1 blocks the two cheapest commits:** all three
supersets already have a rule key `Quoted`, so `LiteralQuoted`/`ExpressionQuoted`
have nowhere to land. Choose: (a) a position-qualified second key, or (b) collapse
both arms into one `Quoted` rule. (Ties to §12.7, task #40.)

---

## Standing backlog (the #-list carried across compaction)

Not yet scheduled; recorded so nothing is lost. Promote into a lane when picked.

- #25 math.div · #26 trailing comma · #28 `:=` frame · #36 @extend propagation
- #38 not() counts stale · #39 mathMode oracle held · #40 §12.7/§12.4 (→ lane 4)
- #41 css `|` combinator mis-parse (namespace wrong-node) · #43 pseudoArgumentContent
- #44 @1foo throw type · #45/#46 jess/superset at-rule rejections
- #49 unknown-body decision (→ lane 5) · #50 jess duplicate keys
- #51 language-service re-parse (PARSE-ONCE-DEEPLY §6 violation)
- #52 node-shape survey hole · #54 collectTolerantDiagnostics ignores rule config
- #55 oracle byte-identity blind to wrong-but-round-trippable trees
- #56 Opaque* family removal (`docs/design/OPAQUE-FAMILY-REMOVAL.md`) — depends on lane 5
- #58 **parser-runtime-boundary — RESOLVED 2026-08-30** (dev `da1e33ada`; alpha
  dry-run green end-to-end). `verify:parser-runtime-boundary`'s ledger is empty (target 0)
  and it is in the alpha release preflight (PR CI deliberately skips it — see
  `.github/workflows/ci.yml` ~line 161). It flagged 3 sites; the boundary is
  "grammar combinators OK, handwritten runtime recognition banned", and the gate
  had mis-modeled that boundary for 2 of them:
  - `less/less-parser/src/grammar.ts:3444` `matches(/^(?!(?:url|calc)\($).+\($/i)`
    and `scss/scss-parser/src/grammar.ts:1876` `when(matches(/\.\$/), …)` — these
    are the Parseman `matches()` **dispatch combinator** (declarative grammar,
    macro-compiled), NOT post-processing. The gate exempted `regex(/…/)` but not
    `matches(/…/)`. **GATE FIXED** (owner ruling 2026-08-29): `GRAMMAR_REGEX_COMBINATORS`
    now covers both; regression test added. No grammar change; these were false
    positives.
  - `css/css-parser/src/cst-host.ts:157` — `value[0]` (`runtime-string-index`) in
    `startsWithDigit`, the host CST adapter re-deriving a selector's grammarType
    from its leaf string. GENUINE hit. FIXED byte-identically (`da1e33ada`): the
    same first-char digit test inlined onto the untyped `.value` receiver (the
    detector only flagged it because the extracted helper's `value: string`
    annotation made it provably-source). FOLLOW-UP (not release-critical): the
    proper fix is the css grammar emitting the selector grammarType so the host
    never inspects the leaf — deferred (BasicSelector is a shared widening point
    across all four grammars + first-set gating; needs grammar+perf review).

---

### Lane 2 — hoist module-private helpers (agent `abfdb806442e1919f`, base `bbda2ec9f`, landed `ef30b2579` on `refactor/hoist-grammar-helpers`, NOT pushed; backup `scratchpad/hoist-backup.patch`)

Home = `@jesscss/core/ast` (NOT `parser-shared` — at the time of this lane it was
private and dev-only; it is now published for cross-package grammar composition,
but core semantic helpers still belong in core/ast). Hoisted 10
values + 3 types (`withBlockBody`, `keywordOrNull`, `isToken`, `bodySpanFromRaw`, …).
Gates: check:macro 0 fallbacks all 5 pkgs; css/less/scss/jess parser suites all green;
core 3346/0; guardrails exit 0; artifacts −16 030 B total; CST artifacts byte-identical.

**THE FINDING THAT MATTERS FOR LANE 1 (compose):** of **307** module-private helpers
across the four grammars, only **11 are byte-identical everywhere**; 55 are
shared-but-DIVERGENT, 241 single-file. So the residual `direct-builder-static`
refusals are NOT "~50 identical helpers waiting to be hoisted" — they are helpers
that have quietly **drifted apart**. Worst: `valueSlot` — css/less/jess take
`ValueSlot` and early-return on an array; **scss takes `ValueNode` with no array
branch** — genuinely different functions. This tempers the compose prize: some of
the "identical override" collapse assumes helpers converge, and mostly they have not.
Brief-premise corrections: `tokenText` is css-only; `requireKeyword` differs in all
three supersets; `test/cross-dialect/` is NOT green at `origin/dev` (5 failed/104,
`mathMode`-missing harness crash, pre-existing).

### Lane 1 — compose prototype EXECUTES (agent `a311a25d13a05a0dd`, base `bbda2ec9f`, committed `db7eadeb0` on `validate/compose-prototype`, NOT pushed; parseman clone clean at `4ffce49c7`/main before+after, 0.46.0 dist restored byte-identical)

**VERDICT: YES — a patched, composed build parses correctly, end to end.** Real
production `Dimension` (the P22 css/scss duplication) as a host-mode CSS base + a
delta overriding `DimensionUnit` (a rule the base references): patched, both fuse,
artifact RUNS, and the DIALECT uses the BASE's own reducer for a rule it never
restated (`50$u` → `Dimension{50,"$u"}`). On pinned 0.46.0 the same fixture throws
on the exact refusal the patch lifts. Composition genuinely works — owner rule 2 is
technically achievable.

**BUT THE PRICE TAG WAS WRONG — it is not "two walker patches + a helper hoist."**
The patched parseman clone is `4ffce49c7` = **0.47.0**. A clean-0.47.0 attribution arm
proves the compose patch itself is **behaviour-neutral** on the four grammars — but
adopting compose (Route 1) sits ON TOP of 0.47.0 and inherits ALL of it:
- **Emission rewrite:** the parsers stop being macro-expanded charCodeAt code
  (css 14590 → **0**, same collapse all four) and become a **`parseman/table`
  runtime**. The patched build emits `parseman/table`, which 0.46.0 does not export
  — so this compose approach is COUPLED to the table runtime, not decoupled from it.
  **`check:macro` REPORTS this but does not ASSERT it — still green.** This touches
  the entire perf architecture and is UNMEASURED for perf. ← the risk to retire first.
- **18 new test failures across 5 packages** (jess +2 incl. a new file
  `test/less/parser-error-public-semantics.test.ts`; css-parser +4, less-parser +1,
  scss-parser +4, jess-parser +9). css byte-identity holds 63/63 in every arm; core
  3346/0 patched.
- **Full four-grammar compose is NOT yet reachable.** Four MORE static-analyzer
  refusal categories block real productions: `ThrowStatement` (less **55**, scss 27,
  jess 25, css 6), `unsupported callback shape` (jess **24**, less 13, scss 12),
  `ForStatement`, `ForOfStatement`. Less's `Declaration`, `SelectorBranch`,
  `MixinCall`, `Quoted`, `Url` are all in the Throw set. The two-patch prototype only
  lifts ONE category; the biggest/most-important productions need the other four lifted.

Untested: cross-package import specifiers (prototype stayed in one package on purpose)
and whether the compose-enabling analyzer patches could be back-ported to 0.46.0's
charCodeAt emission (the emitted `parseman/table` suggests NOT — they look coupled).

**STRATEGIC FORK for the owner (see bottom line):**
- Path A (full compose) = parseman 0.47.0 bump (emission rewrite, unmeasured perf,
  +18 tests, gate blind to it) + 4 more analyzer refusals lifted + helper drift
  (lane 2: only 11/307 helpers identical, `valueSlot` diverges). Big; gate on a
  parseman-emission PERF MEASUREMENT first.
- Path B (bank compose-INDEPENDENT wins now on published 0.46.0): mechanical dedup
  (separator-drop, hand-rolled sep, trivia re-spelling, less selector-family
  triplication), leaf sharing (lane 6), NamedColor convergence (lane 7), naming
  conformance (lane 4). None of these need compose or 0.47.0.
RECOMMENDATION: **Path B now, Path A as a separate tracked track whose FIRST step is
measuring the charCodeAt→table emission perf delta** (because check:macro is blind to
it and it moves the whole perf architecture). Updates tasks #18/#53.

**OWNER STEER (2026-08-12):** *"we should be using clones / builds of
`~/git/oss/parseman` on-disk… if possible, i can publish a new 0.47.1 version if i
need to."* ⇒ parseman is IN-HOUSE — the version is not a blocker; build compose/perf
work against the on-disk clone, not pinned npm. Consequences:
- The 4 remaining analyzer refusals (`ThrowStatement`/callback-shape/`ForStatement`/
  `ForOfStatement`) become **parseman 0.47.1 work the owner lands**, not jess workarounds
  (aligns with "grammars are parseman's showcase — correct-but-slower = a PARSEMAN bug").
- The ONE risk that is NOT about versioning still stands: the charCodeAt→table
  emission flip is UNMEASURED and `check:macro` is blind to it. Per "each release
  faster than the last", a slower table runtime is a 0.47.1 parseman fix to make
  BEFORE rebuilding four grammars on it. → **next step: perf-measure the local
  parseman table emission vs the current 0.46.0 charCodeAt build on the benchmark
  corpus; that number defines what 0.47.1 must contain.** (Lane dispatched.)
- Methodology going forward: build against `~/git/oss/parseman` on-disk (NEVER commit
  to it — clones/builds only; back up before any git op there).

**PARKED (owner parseman track, NOT pursued by cleanup):** the 0.47.1 analyzer-lift
spec is committed at `docs/architecture/parser/PARSEMAN-0.47.1-ANALYZER-LIFT-SPEC.md`
(agent `a311a25d13a05a0dd`, commit `97fac7441`, not pushed). Four residual refusals =
**two dependency-ordered parseman changes**: (1) extend the `statement()` walker with
`ThrowStatement`/`ForStatement`/`ForOfStatement` cases + add `Error`/`TypeError`/
`RangeError`/`SyntaxError` to `STATIC_BUILDER_GLOBALS` (clears 131 hits; Throw alone
blocks 55 Less productions); (2) relax the arrow-only gate at
`direct-builder-static.ts:49` to accept `function` reducers, guarded on
`this`/`arguments`/`async`/`generator` (clears 51; INERT without #1 — less
`foldOperation` is a `function` with a `for`+`throw` inside). Does NOT remove the
jess-side helper hoist (Route 1). Owner cuts 0.47.1 when ready; cleanup does not wait on it.

### Lane 6 — leaf diff (agent `a70150a91b5bd6e3b`, base `bbda2ec9f`, guardrails 0, no grammar touched, all read-derived)

Confirms the OVERRIDE-inflation is real but MODEST — the collapses cluster on three
leaves. Leaf pairs: `HexColor`≡`hexColor` (byte-identical → `Color` PROMOTES to
IDENTICAL in less #48, scss, jess #56); `NumberToken`≡`numberValue`; shared
`DimensionUnit` INCLUDES `%`, css-local `dimensionUnit` EXCLUDES it (→ `Dimension`
STAYS, one member); less word leaves drop `\`-escapes (→ less `Keyword`/`CustomPropertyValue`
STAY; but scss/jess import only `cssSyntax` so THEIRS promote); jess/scss calc pads
add `//` line-comment (→ Calc STAYS — corrects the "reducer-name only" label).
Per-grammar leaf-opaque over-count: **LESS ≈4 promote / 5 stay**, **JESS ≈4 / 2**,
**SCSS ≈3 / 2**. So the leaf diff shaves a handful of rows off each OVERRIDE bucket,
not dozens — the bucket-3 weight is genuine structural/interpolation override, not
opacity. Net: "smallest grammar" ≈ CSS base + the real overrides; the vanish figure
moves from ~5–9% up by only a few points once leaves are shared. `Percentage`
token-vs-`node('Dimension')` is a genuine structural split in less+scss (STAYS) —
another instance of the one-representation invariant to probe (feeds #57 siblings).

## ★ 0.48.1 ARCHITECTURE MIGRATION (owner-authorized 2026-08-14: "get as many sub-agents as you need getting us up to speed with PROPER 0.48.1 architecture")

> **CURRENT STATE 2026-08-15 → the spec is now `docs/design/COMPOSE-MIGRATION-SPEC.md`.**
> Read that first; the narrative below is history/evidence. Settled since:
> - **Criterion:** success = AST/CST identity of parse results, NOT compiled-table
>   byte-identity (parseman internal) NOR superset-source==css-source. Owner-stated.
> - **Parseman lift SHIPPED** on branch `release/0.49.0-compose-lifts` (0.49.0, green;
>   the three lifts). Whole hole-free CSS base composes + macro-fuses AST-identical
>   (`COMPOSE-SIMPLIFICATION-PROOF-REDO.md` finding 1) — refutes the SUSPECT negative
>   proof below.
> - **Residual parseman blocker:** `compose([importedBase, delta])` does not re-emit
>   the base's `buildImports` into the composing module (same-pkg ReferenceError /
>   cross-pkg runtime throw). Fix spec'd in COMPOSE-MIGRATION-SPEC §3.2; folds into
>   0.49.0. Repro `docs/design/compose-proof-probes/`.
> - **The "~83% genuine overrides / 7–17% deletion" number is a MEASUREMENT ERROR** —
>   it counted inlined-choice STRUCTURAL rules (selector tower) and ADDITIONS as
>   overrides. Verified in code: scss `Compound` (grammar.ts:5486) is css's shape + 2
>   choice arms → a LEAF-factor+inherit, not an override; only the value/math tower
>   (grammar.ts:1922–2038, `operation()` folding) is a genuine override. Correct
>   method + staged plan in the spec §4–§5.

**The realization:** jess bumped parseman to 0.48.1 but kept the ENTIRE pre-0.48
structure — four standalone factory COPIES, each emitting FOUR macro builds
(ast, ast/positions, cst, cst/positions). It adopted NEITHER 0.48 capability. My
earlier "compose is blocked on future analyzer lifts" was WRONG — the 0.48.0
changelog lists "composed" as a first-class artifact type. And the four-macro-builds
model is exactly what 0.48's table-driver retires (the TABLE-DRIVER note: ast/cst ×
line-tracking = four DATA tables totalling 8,418 B, "driver reads 0 options"; G5:
build the reference at run start, swap leafs, run with no option branching).

**Two migrations (both real 0.48 adoptions jess skipped):**
1. **Compose** the supersets onto the CSS base — kill the four hand-maintained copies
   (four-hard-rules rule 2, P22 violation).
2. **One table-driven reference per language** — kill the 4× macro-build duplication.

**UNDERSTAND phase (read-only, no source changes — scope before implementing):**
- `a447a29a4ff5a3b36` — compose REACHABILITY under 0.48.1 (which analyzer refusals
  still fire, if any) + current jess 4-variant build pipeline + the 4→1 table-driver
  migration map.
- `a4c18ec3625a4365c` — the TARGET architecture from the parseman 0.48 design docs
  (authoring/piece-library, compose API, one-vs-four builds, build pipeline, perf
  posture) — the north star.
- (separate: type-dup `a043d2a3` finishing — rebuild+push after its "14" broken-build.)

**Then:** synthesize the two into a concrete migration PLAN → DESIGN → fan out
IMPLEMENTATION broadly (compose pilot on the smallest superset delta → roll out;
one-build collapse pilot on one language → roll out), staying in the loop between
phases. Scale goes into implementation, AFTER understanding — no blind conversion.

### UNDERSTAND-PHASE RESULT + owner clarifications (2026-08-14)
- **Four-variant / "one build" question RESOLVED by owner:** the "four is the end
  state" doc is STALE; jess already authors ONE factory/language and 0.48.1 auto-derives
  the fast AST path + compact CST variants — the build/variant axis is basically ALREADY
  RIGHT (optional `foldPrograms` packaging aside). My "jess ships four builds = wrong" was
  an OVER-correction; four derived variants from one factory is correct.
- **The ONE real gap = COMPOSE across dialects.** Confirmed BLOCKED in published 0.48.1
  (empirical + `direct-builder-static.ts` source): the analyzer refuses any composed
  builder that calls an imported `@jesscss/core/ast` constructor / has a block body /
  is a non-arrow fn. Spec: `PARSEMAN-COMPOSE-ANALYZER-LIFTS-0481-CONFIRMED.md`.
- **GOAL (owner, verbatim):** "lean grammars … the compiled grammars should not contain
  any SOURCE copies of CSS rules. They can contain COMPILED copies, but not source." =
  superset SOURCE imports CSS + defines only deltas; COMPILED tables carry fused copies (fine).
- **AUTHORITY (owner):** "as orchestrator, you're in charge of the Parseman release builds,
  and of Jess dev branches." → I drive BOTH: implement + prove the parseman lift, CUT the
  parseman release, then land the jess compose conversion. (Only the actual npm publish may
  need the owner's credential.)

### ✅✅ PARSEMAN COMPOSE LIFT — IMPLEMENTED + PROVEN (agent `a851a0242c`), landed on canonical branch
**COMPOSE IS UNBLOCKED at the parseman level.** The 3 analyzer lifts are done and proven:
- Changes (vs `e6bd59e`/0.48.1): `direct-builder-static.ts` (import-provenance split + error globals
  + function-shape gate + statement walker for throw/for/forof/…), `evaluator.ts` (BuilderImportResolver
  + free-name split into imports-provenance vs fail-closed), `index.ts` (harvest + re-emit imports into
  the fused module), `ir-serialize.ts` + `linker.ts` (carry `buildImports`; runtime compose fails closed).
- **Parseman gates GREEN in the clone:** test 4086 passed / 233 files, typecheck clean, invariants 0,
  differentials 6/6, control-bytes ok. Refuse-boundary preserved (async/generator/this/arguments/
  un-modelled statements still refused, fail closed).
- **PROOF:** a real `Dimension` reducer calling imported `dimension(...)` + local `tokenText` FUSES
  (no `_rp[N].parse`), imports re-emitted into BOTH artifacts incl. `dialect.js` (cross-module
  provenance), composed grammar parses correctly (dialect `DimensionUnit` override reroutes the base
  production; pure CSS byte-identical base-vs-dialect). A/B: unpatched 0.48.1 threw on 6/7 categories;
  patched all 7 FUSE.
- **Four-grammar census: the lifts clear 100% of structural/shape refusals (css/less/scss/jess all 0).**
  The ENTIRE residual is FREE-NAME refusals to module-private helpers (`tokenText`×63, `requireToken`×62,
  `isValueNode`×33, `withBlockBody`×17, …) — **JESS-SIDE work** (hoist helpers to an importable module →
  provenance rescues them by name, exactly as the e2e probe showed with `tokenText`), NOT a parseman limit.
- **LANDED on canonical:** applied to `~/git/oss/parseman` branch `compose-analyzer-lifts` (off `main`
  @ `e6bd59e`, main untouched), commit `cf9ab1b`, 8 files / 330 insertions. Full verification on canonical
  running (bg `bhqbo9te5`). Deliverables at session `scratchpad/deliverables/` (patch + bundle + packed tgz).
- **NEXT (I own):** verify green on canonical → cut parseman **0.49.0** release (version bump + build +
  npm publish [may need owner credential]) → jess bumps → jess helper-hoist (the residual) + spine-rebuild
  (the big per-family compose work — owner strategic call on scope). Supersedes task #18/#53.

### ✅✅✅ END-TO-END COMPOSE PROOF IN REAL JESS — PASS (agent `a20f87b8`, branch `compose-e2e-pilot` off `8fb0a3577`)
Lifted parseman installed into jess via `pnpm.overrides.parseman = file:<tgz>` (confirmed active:
`buildImports`/`BuilderImportResolver` in dist). A real scss-package grammar composed the canonical
CSS `Color` rule via `compose([cssColorBaseRules, rules(scssDelta)], {hostMode:'ast'})`:
- **MACRO-FUSES:** `check:macro` 0 fallbacks (all 5 parsers); scss emits a STATIC table (not a runtime
  `compose()` call), 0 `_rp[N].parse`; the inherited CSS `Color` reducer re-lowered into scss's artifact
  with `tokenText` rescued by provenance (`require("@jesscss/core/ast")`, `children => color(tokenText(children[0]))`).
- **BYTE-IDENTICAL parse:** composed `pilot.Color` == full-css `cssGrammar.Color` node+spans for `#f00`/
  `#abcdef`/`#11223344`; scss `$brand` delta also parses. css 512/512, scss 622/622, guardrails 0, no `as any`.
- Steps: hoisted `tokenText`→`@jesscss/core/ast`; exported `cssColorBaseRules`; composed into a real
  scss grammar (`pilot-compose.ts`, wired in tsdown).

**ROLLOUT MECHANICS (de-risking findings):**
1. The composable BASE cannot be a bare `export const x = rules(cfg, factory)` — with direct builders it
   emits a runtime factory call that THROWS AT LOAD (poisons the module). Load-safe form =
   single-element `compose([rules(...)], {hostMode})` → static table carrying the re-lowerable IR piece.
   (Parseman DX feedback: an exported bare `rules()` should emit a non-executing piece-carrier, not a
   crashing initializer.)
2. The `rules()` factory must take EXACTLY ONE param (`(_g) =>`); `() =>` silently degrades to fallback.
3. Composing the whole `cssFactory` surfaces per-rule free-name refusals (`… builder for Url … unsupported
   binding(s): isValue`) — css has ~49 module-private helpers; full rollout = hoist the reducer-referenced
   subset (`tokenText`, `isValue`, …) into `@jesscss/core/ast` so provenance rescues each. Mechanical.

**VERDICT: the release + the superset rollout are SAFE.** Remaining = (a) mechanical hoist of the css
base's reducer helpers, (b) compose the ~9 cleanly-inheritable rules, (c) the big per-family spine-rebuild
(owner strategic call on scope). Task #18/#53 = PROVEN.

**OWNER-GATED, STAGED for return:** parseman 0.49.0 release cut+PUBLISH (branch `compose-analyzer-lifts`
verified green; version bump + npm publish need owner's process/credential); jess rollout SCOPE (how
aggressive the spine-rebuild). Neither done autonomously.

### ⚠️ CORRECTION (2026-08-14): the NEGATIVE proof below is LIKELY A METHODOLOGY ARTIFACT — being re-run correctly
The `ae4fafaa` proof built a THIN standalone selector base (a 2-rule sliver → `CompoundSelector` HOLE →
can't fuse) and SKIPPED hoisting css's reducer helpers — it even hit `UrlUnquoted … unsupported binding(s):
tokenText` and routed AROUND it into the broken thin-base setup. That is NOT how compose works: the base is
CSS's WHOLE (hole-free) grammar, reached after hoisting css's helpers. So its "net worse / 472+500-700 new
lines" is a straw man — css's whole grammar is EXISTING code, not new lines. Re-running correctly
(`a99435df`): hoist all css reducer helpers (line-neutral move) → whole css grammar as base → scss composes
onto it, deleting the identical rules. Expected: scss source LEANER by the inherited rules + drift-safety,
base free. The ⛔ verdict below is SUSPECT — do not act on it; await the corrected number. (Also: I keep
reaching premature conclusions today — the invented requirement-"conflicts" and this — the discipline is
measure-correctly-before-concluding.)

### ⛔ [SUSPECT — see correction above] COMPOSE SIMPLIFICATION PROOF — NEGATIVE (agent `ae4fafaa`, `COMPOSE-FAMILY-PROOF-SCSS-SELECTOR.md`)
**Composing a real scss family does NOT lean the source — net WORSE. The compose spine-rebuild is
NOT justified by leanness.** Measured against the lifted parseman (selector tower = honest best case;
value/math towers diverge further):
- **The fusion-hole law (decisive, built + probed):** a composed base that leaves a rule a HOLE
  CANNOT macro-fuse — the interpreter fallback propagates to every downstream compose. Only a
  HOLE-FREE base (defining the WHOLE subtree) fuses. The one-rule pilots (Color/Dimension) fused ONLY
  because their subtree bottoms out at one leaf regex; a real family sits atop a deep subtree.
- **The measurement:** scss could inherit **2 of 16** family rules (~12%, matching the ~18% convergence
  ceiling) = ~46 lines deleted — but to FUSE them the css base must carry the entire hole-free selector
  subtree (472 lines + ~40-rule pseudo subtree) + every helper hoisted (500–700+ lines), while scss
  keeps **10 irreducible overrides** (every interpolation point + `&`-relative/placeholder). Net global
  source: WORSE, even fully amortized.
- **Root cause:** the supersets are NOT thin deltas over css — they're **~82–88% genuine difference**
  (interpolation everywhere, different shapes/operands). There's little to inherit, so compose can't lean
  them; it only ADDS base-export + helper-hoist machinery on top of the retained overrides.
- Guardrails 0, check:macro 0; scss grammar byte-identical to dev (blocked at the fusion gate before any
  scss edit); scss oracle unusable as a gate (corpus drift, task #61).

**CONSEQUENCE — the plan reverses:**
- **DO NOT cut parseman 0.49.0 for jess's sake, DO NOT pursue the spine-rebuild.** Not justified. The
  proof-before-building saved a multi-week rewrite (the whole point of orchestrating it).
- The parseman lift is real, but jess adopting compose for LEANNESS is contradicted by measurement. If
  compose is pursued at all it's for **single-definition drift-safety of the ~12% cleanly-shared rules**
  (Color/Keyword/UnicodeRange…), NOT byte count — marginal, owner's call.
- **ESCALATION (do not self-close):** the four-hard-rules "supersets MUST import+compose CSS" assumes
  supersets are thin css deltas. Measurement shows ~82–88% genuine difference → compose makes source
  worse. This CONTRADICTS an owner requirement — surfaced to owner to reconcile; only owner closes it.
- The P1/P2 grammar-cleanup train (normalization, dedup, bug fixes, one-definition for the shared rules
  where cheap) remains the productive path and is NOT affected by this.

### COMPOSE MIGRATION — two crux lanes IN FLIGHT
- `a851a0242c211369d` — implement the 3 analyzer lifts in an ISOLATED parseman clone
  (import-provenance rescue + block-body walker + non-arrow fn; refuse-boundary preserved,
  fail closed), PROVE a real jess production composes+fuses, parseman gates green, produce
  a release-ready patch + local build.
- `af99c164a4e6293b6` — READ-ONLY: the exact jess compose-conversion recipe (compose API
  spelling, what css must export, the scss pilot delta map identical/override/new on the
  current tip, per-variant handling, byte-identity verification plan).
Sequence: lift proven → I cut parseman release (0.49.0) → jess bumps + converts scss pilot
(lean source, byte-identical compiled) → roll out less+jess. compose-independent grammar
cleanup (P1/P2 train) continues meanwhile.

### ★ COMPOSE SIZING (agent `a2326a3d5bd60d2ee`, doc `COMPOSE-CONVENTION-CONVERGENCE-SCSS.md`, current tip) — REFRAMES the job
Measured: CSS 139 rules / SCSS 152 / **shared 51 / CSS-only 88 / SCSS-only 102**; byte-identical
shared today = **0**.
- **Pure convention convergence leans out only ~9/51 (18%)** — 3 immediately (Color, Keyword,
  UnicodeRange), 6 with trivial per-rule calls. **42/51 (82%) are GENUINE overrides** (8
  interpolation-injection, 15 inlined Sass blocks vs CSS `routed()`, 7 parallel value/math/
  selector TOWERS, 10 differently-languaged operands, 2 trivia).
- **SCSS overrides the WHOLE SPINE** — it references its OWN towers (`g.Value`×12, `g.MathTopSum`
  ×10, `g.Selector`×4, `g.Complex`×3), and references **ZERO of the 88 CSS-only rules by name**.
  So under naive compose the 88 inherited CSS rules FUSE IN BUT ARE NEVER ENTERED — dead weight.
- Convention verdicts (source-verified): `node<T>` = compile-time-only, INERT for output (owner
  call whether to keep typed nodes); `requireToken` vs `tokenText` INERT on every shared rule;
  `numberNoPercentage` vs `numberValue` GENUINE (SCSS `DimensionUnit` includes `%`, CSS's
  doesn't → SCSS `Dimension` recognizes `50%`).

**THE REFRAME:** lean source is NOT "enable compose + delete identical rules." The supersets were
built as FULL PARALLEL grammars, so the payoff requires **DECOMPOSITION CONVERGENCE** — rebuild
each superset to actually EXTEND css's spine (re-point `g.Value`/`g.Selector`/etc. at the
inherited CSS rules + thin overrides), per-family design work, oracle-gated rule-by-rule. **This
IS the owner's original four-hard-rules remedy** ("extend CSS, delta ONE RULE AT A TIME"),
now quantified — a big multi-week effort, not a switch.

**Consequence for the plan:**
- Parseman lift (`a851a0242c`): CONTINUES — still the gating prerequisite for any compose.
- Jess compose spine-rebuild: HELD for an owner strategic call (full per-family rebuild vs
  incremental) — big; don't fan out blind.
- **The compose-INDEPENDENT P1/P2 cleanup train IS the incremental path** — every normalization
  (NamedColor, #41, …) nudges a rule toward inheritable. Keep running it; it's productive AND
  compounds toward compose-readiness.

## Decisions & corrections (append-only)

- 2026-08-14 — **OWNER RESOLVED naming Q1: collapse `LiteralQuoted` + `ExpressionQuoted`
  into ONE `Quoted` rule** ("ideally the latter"), NOT a position-qualified second key.
  Rule-4-correct: interpolation is an added FORM of a Quoted, not a different rule — one
  `Quoted` production parses both static and interpolating forms (emitting `Quoted` when
  static, `Interpolation` when interp parts present, as the reducer already does). This is
  the §12.7 mechanism = task **#40**, and it's phase-2 AST-normalization work (merging
  productions, semantics-adjacent → semantics-reviewer + oracle), now UNBLOCKED with owner
  direction. Removes 2 consts/superset and converges the name to `Quoted`. Queued behind the
  in-flight type-dup cleanup (both touch the grammar files — serialize). The rest of naming
  conformance (pure label/key renames, §12.4 mislabels) is phase-1 and doesn't depend on this.

- 2026-08-11 — **NamedColor is a LIVE CROSS-DIALECT BUG, not just a naming
  divergence — confirmed by reading the eval materializer.** serialize.ts materialize
  switch (~:2758): `case 'Keyword'` returns a Keyword value with NO named-color
  check; `case 'Color'` → `colorFromSrc` → `namedColor()` → Color value; only
  `Color`/`Any` nodes ever consult the table (design docstring: "typed leaf NOT
  re-classified; grammar sources the type"). `isValueForType` (value-dispatch.ts:77)
  is a pure tag check, no coercion. ⇒ **`lighten(red,10%)` / `iscolor(red)`
  materialize a Color in LESS (red is a `Color` node) but throw `expected Color, got
  Keyword` in css/scss/jess (red is a `Keyword`).** Less's parse-time color tagging
  is load-bearing for eval; the other three silently lack it — the exact failure the
  one-representation invariant predicts. Fork DECIDED by owner framing: keep
  unoperated `red` a verbatim `Keyword`, coerce a named-color Keyword→Color at the
  OPERATE boundary (arg-binder), NOT in the materializer. Dispatched as lane 7
  (`ab6b40fbcdcc05d04`): empirical failing test FIRST, then delete less NamedColor +
  wire coercion, then semantics-reviewer + DESIGN-DECISIONS row + oracle + suites.
- 2026-08-11 — Correction to my earlier framing: keeping `red` a `Keyword` is NOT
  slimmer STORAGE than a lazy `Color` node — AST v2 stores both as `{type,src}` with
  RGBA derived lazily (`ast/color.ts`), so slimness is tag-independent and already
  achieved. The real case for Keyword is UNIFORMITY + dropping the parse-time
  148-word `lessNamedColor` scan on every value ident. Storage was a red herring.

- 2026-08-11 — **NamedColor cross-grammar divergence CONFIRMED by direct read**
  (not just the read-derived lane-3 claim). `less grammar.ts:3040` `NamedColor =
  node('Color', g.NamedColorToken, …)` turns `red` into a **`Color`** node via
  `lessNamedColor` (recognition.ts:594) — a ~148-word named-color list baked into
  the **lexer**. CSS, SCSS **and JESS have no `NamedColor`** → `red` reduces to
  **`Keyword`**. Three grammars agree; **LESS is the lone outlier.** Owner principle
  (2026-08-11): *"the same CSS type should not be different in different grammars…
  if it's a CSS feature (like a color) it should be represented the same way across
  the board."* → **new invariant: a CSS construct has ONE node representation across
  all four grammars.** Convergence target (per `parser-accepts-shapes-not-semantics`
  + CSS-base-is-spec + three-agree): `red` = **`Keyword`** everywhere; remove LESS's
  `NamedColor` production and the `lessNamedColor` lexer entry. Named-color
  recognition moves to **eval, lazy, on-operation, keyed on the keyword text**
  (store lossless src, derive RGBA only when a color op runs). NOT purely subtractive:
  subtractive in the LESS grammar + additive in the eval color-op resolver (must accept
  a `Keyword` whose text is a named color). Storage note: AST v2 already stores BOTH
  `Color` and `Keyword` as `{type, src}` (`ast/nodes.ts:1259`) with RGBA derived lazily
  (`ast/color.ts:87/95`) — so an unoperated value already costs a tag + src, no
  channels; the divergence's real waste is the parse-time table test on every value
  ident in LESS. Recorded as task; needs semantics-reviewer + a DESIGN-DECISIONS row
  before the grammar edit. Sibling divergences to probe under the same invariant:
  `Percentage` token-vs-`Dimension`-node (css vs less/jess), `Dimension` %-in-unit.

- 2026-08-11 — This log created after owner flagged there was no single live
  worklog. Prior state was scattered across memory files + HANDOFF + task chips.
