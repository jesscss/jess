# Grammar-size facts

**Every lane working on grammar size or codegen size MUST read this before
measuring anything, and MUST update it in the same commit that produces a new
fact.** A number not in this file is not a fact yet.

Each entry carries: the claim, who measured it, the evidence, and a **STATUS**.
Only `VERIFIED` entries may be used as a premise for new work. `SINGLE-SOURCE`
entries may be acted on but must be labelled as provisional when quoted.
`RETRACTED` entries are recorded so nobody re-derives them.

Last updated: 2026-07-31.

---

## 0. Why this file exists

In one working session, these claims were asserted, acted on, and then
retracted: a 203 KB artifact floor; that goal 2 needed an 8–12× call-site
reduction; that parseman could not detect crossed delimiters; that `([a}])`
was malformed input; that naming a rule costs ~904 B; that artifact bytes are
linear in call sites; that 86 css rules are emitted twice; that 95% of capture
sites are rollback-able.

Some were caught within the hour. All of them were passed to other lanes as
premises first.

**The single largest cause was measurement contamination, and it is now
diagnosed** — see §1. The second cause was generalising from a toy artifact
(§2.4). The third was quoting a figure without its baseline (§2.5).

---

## 1. The contamination fix — MANDATORY for any grammar-source analysis script

Three lanes independently wrote scripts to audit const references in
`grammar.ts`. **All three produced identically contaminated results.** One
lane's unfiltered run returned 65 hits topped by `cssCase:27`, `values:27`,
`value:21` — those are **reducer parameter names**, not combinator consts.
Another's returned 109 where the true count was 4. Another reported 86 where
an independent audit found 4 rules / 8 references.

**Four filters make independent scripts agree row-for-row. Apply all four:**

1. **Slice to the `rules()` factory body.** Slicing from line 0 counts imports
   and the node-name type union.
2. **Strip comments AND string literals.** Counting through string literals
   lets every `node('X', …)` self-reference.
3. **Use a `(?<![\w.])` lookbehind** so `g.X` cannot match a bare `X`.
4. **Filter consts to those whose initializer is actually a combinator call.**
5. **Exclude TYPE positions.** Added after the four above still produced false
   positives. A rule name that collides with an imported AST type name matches
   in `readonly guard?: MixinGuard`, `(children): MixinGuard =>`, and
   `Combinator<Interpolation>`. **css does not expose this** — its rule names
   do not collide. **less does**, on `Interpolation`, `MixinGuard`,
   `SelectorBranch`, `Declaration`, `Stylesheet`, `Url`. Any probe validated
   only on css will mis-rank every dialect grammar.
6. **Validate the factory-start detection per file before trusting a run.** A
   probe tuned on css detected 21 and 20 composite consts in scss and jess
   against 300+ actual. A count far below the file's `const` count is a broken
   run, not a clean grammar.

A script that has not been shown to agree with an independently written one is
not evidence. The tell that caught one contaminated run: a row claiming 8
references for `OpaqueAtRuleBlock`, a const already proven unreachable.

---

## 2. VERIFIED facts

### 2.1 Codegen cost model

| fact | value | source |
| --- | --- | --- |
| Base cost, named rule referenced via `g.*` | **~950 B/call-site, flat, slightly DECREASING with depth** | floor lane, depth sweep 1–6 |
| Private const (not in rules map) | ~1.05× the named base | floor lane |
| **map+const** (in the rules map AND referenced by const) | **1.50× → 6.69× and still climbing — exponential in depth** | floor lane |
| Fixed cost of an empty composed-leaf grammar | **3,641 B** | floor lane, K=0 probe |
| Per **unreferenced** composed leaf | **~2,310 B — composed leaves are NOT tree-shaken** | floor lane, K sweep 0/1/8/25/51 |
| parseman runtime (`dist/run/index.js`) | 18,134 B | floor lane |
| `node()` vs `transform()` per site | 3,425 B vs 46 B — **74×** | Candidate A |
| `keywords()` table, 30 words, vs `word()` arms | 1,077 B vs 20,002 B — **18.6×** | Candidate A |
| 2nd by-const reference / 3rd | +867 B / +567 B (no sharing) | Candidate A |

**The map+const multiplier is the master fact.** At fanout F, each level
multiplies copies by F, so cost is base × F^depth. This reconciles two
measurements that looked contradictory: 13.69× in a deep recursive grammar,
1.046× in one whose value spine already broke its own recursion via
`FunctionNotation → g.Value`, collapsing F^d to F^1.

**Consequence — the operation that pays is `name it AND convert its references
to `g.X``.** Naming a rule while still referencing it by const is the *worst*
case: emitted twice, and it looks like it worked.

### 2.2 The demonstration

Two grammars, **identical productions, identical call sites, identical
terminals, identical reducers, byte-identical trees** on nine smoke fixtures:

| shape | `ast.js` raw | gzip -9 |
| --- | ---: | ---: |
| sub-rules referenced by **const** | 3,777,733 | 382,484 |
| same grammar, referenced by **`g.X`** | **276,023** | 35,448 |

**13.69×, produced by a sed.** — Candidate A.

### 2.3 Goal-2 arithmetic

```
css source                     114,446 B
4× budget                      457,784 B
fixed cost                       3,641 B   = 0.8% of budget
remaining                      454,143 B
at ~950 B/site (named)         ~478 call sites
incumbent                      ~900–904 call sites
REQUIRED REDUCTION             1.9×
```

**Goal 2 is reachable.** Incumbent call sites independently counted at **900**
(Candidate C) and **904** (Candidate B), same method, two authors, no
coordination.

### 2.4 Landed size results

| change | source | artifact | status |
| --- | --- | --- | --- |
| less: 4 query productions promoted to named rules | +530 B (+0.20%) | **−621,785 B (−15.78%)**, 15.20× → 12.77× | landed `35140e615`, oracle byte-identical, parse speed *improved* |
| parseman: rollback elision via `commitment.ts` | — | css −5.17%, less −4.06%, scss −6.68%, jess −5.73% | landed `9705159` |
| parseman: `_cmlrg` root-trivia guard | — | css −1.20% | landed `1dc7613` |

### 2.5 Measurement discipline

- **Noise floor on this machine: 5.144 vs 5.200 ms min-of-mins at a 6/15 win
  rate on BYTE-IDENTICAL artifacts. Nothing under ~1.5% is a result.**
  Interleave in one directory; never measure across worktrees.
- **AST construction is the canonical performance measure** (owner ruling).
  CST is a convenience and an IDE/diagnostics path where slowdowns are less
  visible. A speed number that does not state its path is not a result.
- **gzip can move opposite to raw.** Measured: css −1.5% raw / **+1.6% gzip**;
  less −0.5% raw / **+3.7% gzip**. Cause: deleted mark/restore text compresses
  near-free, and a fixed ~700 B prelude that small artifacts cannot amortise.
  Report both.
- **`bench/tree-identity.ts` (`pnpm bench:treeidentity`) headline 8,328 pairs /
  6,243 real trees is the SUM of FOUR invocations**, one per parser with its
  own `--ext`. A single css run returns **315/260** and will look shrunk when
  it is not.
- **State the resolved parseman version with every artifact number.** 0.45.0
  and 0.46.0 figures are not comparable; 0.46.0 has landed several size
  commits.

### 2.6 Language / grammar facts

- **`balanced()` DOES detect crossed closures.** Its close is wrapped in
  `expect()`, which never fails — it recovers and pushes to `ctx._errors`.
  `([a)]` reports `errors=1`. A probe measuring *consumption* cannot
  distinguish acceptance from recovery.
- **The incumbent legitimately accepts `var(--x, ([c}]))`.** parseman's
  `errors=0` there is correct. Building to reject it would break the grammar.
- **less at-rules: ~60 of 68 tight consts are SHAPE**, not vocabulary — each
  arm returns a structurally different node, and `QueryComparisonFeature` /
  `QueryRangeFeature` even reverse operand order. Only `ImportOption` and
  `KeyframeSelector` are pure vocabulary: a **~200-byte** prize.
- **less has neither `mediaTypeKeywordReserved` nor `containerNameReserved`**,
  so `@media onlyé` parses cleanly in less today. That is a conformance *gap*
  at the diagnostic tier, not a relocation opportunity. In css, where the table
  exists, it is used inside `not(...)` as an arm-decider — **shape, stays hot**.
- **Loose-then-validate is not a free diagnostics win.** It clearly beats the
  tight path on `@import (referenceX) "a.less"`, where the vocabulary check
  fails the whole statement and points nowhere near the bad option. It **loses**
  on `@whatever (foo {`, where the loose route reports *"Missing semicolon"*
  for an unclosed paren.
- **Leverage is not uniform within a grammar file.** In less: module scope
  (reducers, type-guards) is 93,397 B of source → 57,843 B of artifact
  (**0.62×**); the `rules()` factory is 165,897 B → 3,882,775 B (**23.4×**).
  A **38×** difference. Source cuts to module scope are nearly free in the
  artifact and cannot pass an artifact-shrinks-more gate by construction.

### 2.7 Hazards that produce false wins

- **An interpreter fallback produces a SMALLER artifact and is NOT
  AST-equivalent.** Detector: `grep -l 'from "parseman"' lib/grammar/*.js` must
  be empty. A deliberately-constructed fake showed a 37% "win" this way.
  Scope the glob non-recursively to `grammar/` — widening to `**/*.js` reds
  every healthy build, because `cst-host.js` and `chunks/parse-with.js` import
  parseman legitimately and always will.
- **`dispatch()` costs ~2.8× the bytes of an equivalent `choice()`**, so a
  bytes-first ranking rewards a shape the review standard calls an
  anti-pattern.
- **A `rules()` map key counts as a reference** in a naive audit. Subtract it.

---

### 2.8 The two inlining defect classes — H1 dominates

**Three independently written, de-contaminated scripts now agree row-for-row.**

| class | what | incumbent css count |
| --- | --- | ---: |
| **H1** | const referenced 2+ times, **NOT** in the rules map — inlined per reference, transitively | **39** |
| **H2** | composite **both** in the rules map **and** referenced by const — emitted twice | **2** |

Top H1 offenders: `RoutedAtRuleStatement` ×11, `declarationListBlock` ×7
(`grammar.ts:3314` — `{ many(declarationListItem) }`, dragging the whole
declaration/at-rule/ruleset body closure each time), `CustomPropertyValue` ×5,
`descriptorBodyBlock` ×5, `pseudoArgumentContent` ×5.

**H1 is where the bytes are; H2 is rarer and smaller.** Measured, not argued —
closing just two trivial H1 sites (`Quoted`, two literals and a text leaf, at 3
references; `CompoundSelector` at 2) in Candidate A's own grammar:

| shape | bytes | H1 remaining |
| --- | ---: | ---: |
| Shape 2 | 276,023 | 2 |
| Shape 3 | **255,671** | 0 |

**−20,352 B (−7.4%) from two trivial sites**, trees byte-identical, both
macro-compiled. This is a floor, not an estimate, and it has **not** been
extrapolated to `src/grammar.ts`.

### 2.9 There are no uncut by-const cycles, and there cannot be

less: 328 composite consts, 53 by-const-referenced 2+ times, **0 pure by-const
cycles.**

**Zero is the only value this can take in any grammar that compiles.** An uncut
by-const cycle is unbounded inlining — the macro would not terminate. So
"ensure one edge in each cycle is a `g.*` reference" is satisfied automatically
by the build succeeding, and cannot be a lever.

**The real variable is closure bytes under each inlined const**, which is a DAG
path-multiplicity problem, not a cycle problem. less's top entries:

| refs | closure nodes | closure B | est. dup source | name |
| ---: | ---: | ---: | ---: | --- |
| 4 | 9 | 3,585 | **10,755** | `blockBody` |
| 3 | 10 | 3,698 | 7,396 | `atRuleBlockBody` |
| 3 | 9 | 3,156 | 6,312 | `rulesetBody` |
| 2 | 18 | 5,837 | 5,837 | `selectorBranch` |
| 2 | 9 | 4,935 | 4,935 | `compoundSimple` |
| 11 | 1 | 341 | 3,410 | `BareVariableInterpolation` |

Total estimated duplicated **source** ≈ **92,567 B**; at the measured 23.4×
factory expansion, ~2.17 MB of a 3.94 MB artifact.

**But the top entries are the hot statement path.** `blockBody` / `blockItem` /
`rulesetBody` / `atRuleBlockBody` are the same path whose promotion measured
**+5.5%/+6.2% on bootstrap-port at a 1–2/9 win rate** for **−9.06%** artifact.
The biggest closure savings sit exactly where the parse cost is, so the
remaining *safe* prize is smaller than the 13.69× headline suggests.

### 2.10 Variant duplication — and why naive goal 4 defeats goal 2

Same factory exported 1 / 2 / 4 ways (the jess `grammar.ts` shape):

| variants in one module | 1 | 2 | 4 |
| --- | ---: | ---: | ---: |
| bytes | 63,966 | 130,674 | 267,965 |

**4.19× — the four variants are fully duplicated inside the single lowered
module, with zero sharing.** Each export is `/* @__PURE__ */`-annotated, so a
per-entry build tree-shakes three away and **the downloaded artifact already
pays 1×**.

**Consequence: goal 4 done naively defeats goal 2.** One artifact holding all
four variants and branching at run time costs 4.19×, which the goal-2 budget
cannot absorb. The owner's design — tables parameterised by settings, built
once per `(grammar, settings)` pair and cached, with `run` doing only a lookup
— is not a nicety here; it is the only form of goal 4 compatible with goal 2.

Folding variants is a **build and DX win, not an artifact win.** Report it as
such; never let it into a per-dialect artifact figure.

### 2.11 Byte census at depth 4 (const 57,043 B vs named 27,420 B)

The named artifact is 6 functions, ~4,800 B per rule at 4 call sites each. The
const artifact is 18 functions — **12 surplus `_pf` bodies** — and non-function
module text rises from 18.2% to **48.4%** of the artifact.

**Disproved hypothesis, recorded so it is not retried:** `emit()` at
`codegen.ts:4113` excludes rule-map combinators from shared-subtree hoisting.
Patching it to restore the override invariant on the direct-object path
**changed nothing** — instrumentation showed `ctx.ruleNames` hits only 6 times
(once per rule's own body), across 86 `emit()` calls producing 206 label copies.
**The duplication is not `emit()` re-entry**, so the fix does not live at
`codegen.ts:3889`/`4113`. It is `_pf` proliferation plus per-site module text.

### 2.12 The CST host is grammar-owned, not parseman-owned

In `hostMode: 'cst'` the grammar's reducers do not run; parseman builds each
node through `ctx.build`. **That host is defined locally** at
`packages/syntax/css/css-parser/src/cst-host.ts`, and it already:

- changes a node's type *from its children* (`publicGrammarType` — one
  `Numeric` production surfaces as `Percentage` / `Dimension` / `Num`)
- remaps grammar names through `TYPE_NAMES` (`publicTypeName`), so CST names
  are already decoupled from production names
- **fabricates children no production produced** (`publicChildren`, `:290`) —
  a joined `name(` leaf for `Url` (`:305–315`), a shifted leaf for `Quoted`

Host-synthesised CST children are **established precedent in this file**, not a
new mechanism.

**Cost, stated rather than buried:** the host runs *during* the parse, not
lazily. Eager expansion speeds AST parse and **slows CST parse**. The lazy fix
— getter-backed `rules`/`children` — collides with a documented invariant:
`cst-host.ts:364–384` requires exactly **two hidden classes with identical
field order**, `%HaveSameMap`-measured, guarded by `cst-shape-digest.mjs`, at a
recorded **~2× floor cost across all four dialects**. A getter node is a third
shape.

**Ruled** (owner: AST construction is canonical, CST is the convenience and
IDE/diagnostics path): **take eager expansion and accept the honest CST
regression.** Keep two hidden classes.

### 2.13 `TYPE_NAMES` is already non-injective

The baseline's production → CST-name map is **not** injective:
`AtRuleBlock` and `AtRuleStatement` both → `AtRule`; `Declaration` and
`CustomDeclaration` both → `Declaration`.

**Ruled:** the tournament's injective-rename requirement binds a **candidate's
own declared renames** — it may not collapse two of its productions into one
name to hide a structural difference. It does **not** forbid the incumbent's
existing collapses, which are part of the target and must be reproduced.

---

## 3. SINGLE-SOURCE — act on, but label as provisional
- **`GRAMMAR-REBUILD-SPEC §0.2` is wrong**: it states that aliases declared
  *inside* a `rules()` factory lower cleanly. One was inside and still failed.
  The real constraint is narrower than the doc, and the doc actively misleads
  anyone authoring a dispatch.
- **`when(ciCase('url('), routed(...))` fails static evaluation**
  ("factory isn't statically evaluable") while
  `when('url(', g.Url, { caseInsensitive: true })` builds. The alias/factory
  shape is the cause, not the opener shape.
- **Bare-`choice()` consts cannot currently be promoted** — the union they infer
  cannot be spelled in an invariant `Combinator<T>` slot. Blocks the §2.1
  technique on a large share of remaining targets.
- **css has 64 infallible `firstMatch` arms**, and infallible arms are
  **disjoint** from mark-bearing arms — all 64 report
  `rollback=false rootlog=false err=false`. So a `mayFail` gate on choice arms
  is worth zero bytes. (Corrects an earlier note claiming no infallible arm
  exists; the conclusion held, the stated reason was false.)

---

## 4. RETRACTED — do not re-derive

| claim | why it was wrong |
| --- | --- |
| A ~203 KB fixed artifact floor | Not a floor. Linear at ~2,310 B per *unreferenced* composed leaf, because composed leaves are **not tree-shaken**. 97% of it was eliminable dead code. Fixed cost is **3,641 B**. |
| The floor consumes 44% of the goal-2 budget | It consumes **0.8%**. |
| Goal 2 needs an 8–12× call-site reduction | It needs **1.9×**. |
| Goal 2 is out of reach on the grammar side | False; see §2.3. |
| parseman cannot express multi-kind balanced matching | `balanced()` **does** detect crossing via `expect()` → `ctx._errors`. The probe measured consumption only. |
| `([a}])` is malformed and should be rejected | Fabricated from a reading of the word "crossed", never checked. The incumbent **accepts** `var(--x, ([c}]))` and is correct to. |
| Naming a rule COSTS ~904 B | Contaminated probe: rules were put in the map **while still referenced by const**, so they were emitted twice. |
| Naming a rule SAVES ~984 B (as the dominant term) | True in isolation but not dominant; the real mechanism is transitive inline multiplication (§2.1). |
| Artifact bytes are linear in call sites; predictable by `grep -c` | Self-falsified: 176 call sites unchanged, artifact moved 4.4%. Call-site count is a **lower bound**; the multiplier over it is set by uncut recursion. Good across similar-shaped grammars, misleading across differently-shaped ones. |
| "Ensure one edge per cycle is a `g.*` reference" is the rule | Withdrawn; DAG path-multiplicity evidence settles it — it is not only cycles. |
| 160 css consts by-const 2+ times, 86 emitted twice (`SelectorList` ×11 etc.) | Contaminated count — bare identifiers matched over raw source, so a rule name hit its own `node('Name')` string literal, the `GrammarRuleName` union, type imports, return annotations, comment prose, and the map key. De-contaminated: **39 H1 / 2 H2**. On `SelectorList`, all 5 real uses are `g.SelectorList` — **zero** defects. **The mechanism was right; the counting was wrong by ~10×.** |
| The incumbent is already well-authored on the inlining axis; no win in the baseline | Wrong generalisation from the corrected H2 count. Tested rather than argued: closing two trivial **H1** sites was worth −7.4% (§2.8). H1 is the dominant class. |
| 95% of capture sites are rollback-able, so deferral has no population | Measured on **61 sites** in parseman's own `examples/css` (231,731 B total). The shipping css grammar has **31,904** capture sites. Pending re-measurement on the shipping grammars. |
| "Fewest combinators" is a byte strategy | False. The 13.69×-smaller grammar has *more* named rules. |
| Parameterless-const dedup is a major lever | 4.2%, terminals only. |
| Composites referenced 2+ times get shared by the compiler | Falsified. |

---

## 5. Rules for adding to this file

1. **One fact, one row, one source named.** "A lane found" is not a source.
2. **Evidence before number.** State the resolved path, SHA, and parseman
   version *ahead* of any figure.
3. **A second independent measurement promotes SINGLE-SOURCE → VERIFIED.** The
   two must use independently written scripts, not the same script run twice.
4. **A retraction is a first-class deliverable.** Move the row to §4 with the
   cause; never delete it.
5. **An analysis script must pass §1's four filters** and be shown to agree
   with an independently written one.
