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
5. **Exclude TYPE positions — FOUR distinct forms, not one.** Each of three
   independent implementations caught a different subset, which fully explains
   three different answers on one file:
   - **generics** — `node<Declaration>(`
   - **assertions** — `as T`
   - **type predicates** — `(value): value is Declaration | AtRuleBlock =>`
   - **annotations with array/indexed suffixes** — `const parts:
     Interpolation['parts'] = []` (this form alone took less H2 from 2 to 1)

   **Every grammar exposes some form of this**, including css — an earlier
   claim that "css does not expose it" was wrong; css collides through type
   *predicates* at `grammar.ts:3372` and `:3654`.
6a. **Never gate H1/H2 behind `bareRefs >= 2`.** It silently drops every
   single-reference double-emission site — which is most of them. Seven of
   css's ten H2 sites have exactly one reference.
6b. **Do not use "referenced as `g.X`" as a stand-in for rules-map
   membership.** They are different sets: eight of css's ten real H2 sites are
   mapped but never proxy-referenced.
6. **Validate the factory-start detection per file before trusting a run.** A
   probe tuned on css detected 21 and 20 composite consts in scss and jess
   against 300+ actual. A count far below the file's `const` count is a broken
   run, not a clean grammar.
7. **Match `node<T>(...)` as well as `node(...)`. This is not an edge case —
   scss and jess use the generic form EXCLUSIVELY.** Verified by direct count
   on `dev`:

   | grammar | `node(` | `node<T>(` |
   | --- | ---: | ---: |
   | css | 141 | **0** |
   | less | 262 | **0** |
   | scss | **0** | 158 |
   | jess | **0** | 172 |

   A probe demanding `node(` finds **literally nothing** in scss and jess and
   reports a clean zero. This under-counts, so it fails the usual smell test of
   "errors inflate flatteringly" — it looks like good news. Fixing it moved
   **scss H2 from 0 → 15/32 and jess H2 from 0 → 28/51: the two largest
   double-emission counts in the repo were hiding behind a clean zero.**

   **Sanity check that catches it: a grammar cannot export more rules than it
   declares.** scss reported 38 composites against 143 map keys — impossible on
   its face. Assert this in any audit script.

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

### 2.4a css: −30.98% artifact, 29.2× → 21.0× (landed)

Branch `lane/css-grammar-shrink` from `origin/dev` `131cd9d1b`, **parseman
0.45.0** (not comparable to 0.46.0 figures).

| | source | `ast.js` | `cst.js` |
| --- | ---: | ---: | ---: |
| baseline | 114,446 | 3,341,439 | 3,385,629 |
| final | 110,031 | 2,306,424 | 2,327,653 |
| **delta** | **−3.86%** | **−30.98%** | **−31.25%** |

1. `09ecb00fc` — deleted 11 parse-dead at-rule block twins. Source −3.94% /
   artifact −2.96%. **Fails the ratio gate**; landed on correctness grounds
   (unreachable productions), not on ratio.
2. `17c699bb0` — dropped the `Routed` prefix, registered the 11 in the map,
   converted references to `g.X`. Source +0.08% / artifact **−23.09%**.
   **Carries +3.3% parse — PENDING OWNER DECISION.**
3. `2a0ca1109` — six two-character edits converting the last by-const
   references. Source +0.011% / artifact **−7.51% (−187,348 B)**. **~31 KB of
   artifact per converted reference.**

Oracle: 105 in-repo `.css` files + 54 synthetic at-rule vectors = 159 cases,
hashing both `parse()` and `parseCssCst()`, failures hashed too. Aggregates
unchanged across all three commits. **Negative control passed** — dropping
`'layer'` from `mediaTypeKeywordReserved` moved both aggregates and localised
to `vec:003:@media layer`.

**The cause was FAN-OUT, not tightness.** Inline-only cycles: **0**, in both
baseline and final — every cycle already carried a `g.*` edge, as it must or
codegen would not terminate. The defect was one body inlined into 2–3 dispatch
sites, each dragging its body-item closure. Inline edges 162 → 133;
`declarationListDeclaration` 22→11, `declarationListItem` 11→6,
`stylesheetBodyItem` 11→4, `declarationListBlock` 9→4.

**Count is not prize.** The de-contaminated H2 count on css is **six**, not 86 —
and those six were worth **187 KB**. A small count can carry a large prize and
vice versa; always price by closure, never by count.

### 2.4b Negative result: the less query win does NOT reproduce on css

Building the css analogue of the less lane's four query promotions (`QueryValue`,
`QueryTerm`, `QueryOnlyClause`, `QueryNonOnlyKeyword`, plus the four
`Query*Feature` arms, named **and** `g.`-cut) **cost** `ast.js` +2,423 B and
`cst.js` +2,416 B. Reverted.

**Cause:** css's query spine was already cut where it matters — `QueryTerm`
reaches the six parenthesized feature arms through `g.QueryFeature`, and
`QueryValue` reaches the value grammar through `g.TypedValue`. With the
expensive subtrees already shared, nine new names pay only their own ~900 B
each. **Direct confirmation of the model: the prize is transitive subtree ×
use count, and css's was already zero here.** Do not port a win between
grammars without re-measuring.

### 2.4c css leverage map — 90× between regions

| region | source | artifact | expansion |
| --- | ---: | ---: | ---: |
| module scope (reducers, guards, terminals) | 33,528 B (30.5%) | 11,463 B (0.5%) | **0.34×** |
| `rules()` factory | 75,343 B (68.5%) | 2,294,961 B (99.5%) | **30.46×** |

**90×**, against 38× in less. css module scope is **sub-unity** — 33.5 KB of
source becomes 11.5 KB of artifact. Spend nothing there.

### 2.4d css at-rules: the loose-tier prize is ≈ 0 bytes

Verified 65 consts in the contiguous at-rule/query region (2545–3296) plus the
dispatch/case/block cluster ≈ 68. Three-bucket result matches less:

- **Bucket 3 (vocabulary, relocatable): essentially empty.** The at-keyword
  vocabulary is not in `css/src/grammar.ts` at all — it lives in
  `parser-shared/src/recognition.ts` (`conditionalAtKeyword`,
  `descriptorAtKeyword`, `documentAtKeyword`, `marginAtKeyword`,
  `fontFeatureValueAtKeyword`, `keyframesAtKeyword`, …) and **every one is a
  dispatch key** selecting which at-rule tail family parses. Pure shape.
  There is no media-*type* allowlist to move — the grammar already accepts any
  identifier as a media type.
- **`mediaTypeKeywordReserved`** = `keywords(['only','layer'])` used only inside
  `not(...)`, twice. It forces `only` into the `QueryOnlyClause` arm rather than
  being eaten as a generic media type; `layer` is spec-reserved in
  `<media-type>` (css-cascade-5). **SHAPE, stays** — proven by the negative
  control above.
- **`containerNameReserved`** = `not(keywords(['none']))` inside `containerName`.
  Decides whether `none` is a container *name* or the start of a *query*;
  `<container-name>` excludes `none` per css-contain-3. **SHAPE, stays.**
- **Bucket 2 (structurally wrong) is already where the design wants it** —
  `AtRulePreludeGroup` uses `balanced()`, `OpaqueAtRuleBlock` uses the shared
  `opaqueAtRuleRecognition` capture.

**The 68 consts are expensive because of fan-out into three dispatches, not
because of tightness.** The loose-tier lead is a near-zero byte prize on both
css and less.

### 2.4e Compile-time elision beats runtime deferral — measured

Per-child read rate, measured by wrapping every builder's `children` argument in
a read-counting Proxy on the **baseline** css artifact, one bootstrap4.css AST
parse:

| | |
| --- | ---: |
| builder calls | 33,541 |
| children passed | 62,884 |
| **children read** | **62,140 — 98.82%** |
| whole-array consumers | 21,010 calls / 47,172 children |
| partial (index-only) consumers | 12,531 calls / 15,712 children, 14,968 read (95.3%) |

**Almost everything is read.** The lazy-view variant's entire upside is **744 of
62,884 children (1.18%)**, and that is the *favourable* bound. Avoiding 5,841
allocations already cost −6%; avoiding 744 cannot pay for itself.

**The principle, which generalises past this lane:**

> **"Don't build what nobody reads" is better served by NOT EMITTING the
> builder than by deferring it.** Runtime deferral pays on the common path to
> save on the rare one. Compile-time elision pays nothing and saves entirely.

The capture tape is the counter-example in miniature: **32,756 tape writes to
avoid 5,841 allocations**. Compare `commitment.ts`, which deleted the emission
outright and paid −5 to −7% across all four dialects.

Supporting: rollback is **17.5%** of parse cost against save's **4.2%** — the
win is in not having to unwind, not in cheapening the mark. And the entire
dispatch/token-keying spread is **2.4%** of css parse time.

**Recorded as the mechanism's verdict, not the goal's** (G17). The goal is
untouched and sits inside G14.

### 2.4f Rollback-boundary census, all four shipping grammars

Instrumented at the **emission point**, not at `alwaysConsumes`, splitting each
fall-back into **cycle-caused** (an analysis artifact) versus **real** (a
property of the construct):

| grammar | emitted | converted | fell back | **cycle** | real |
| --- | ---: | ---: | ---: | ---: | ---: |
| css | 26,688 | 9,824 (36.8%) | 16,864 | **96 (0.6%)** | 16,768 |
| less | 15,328 | 5,664 (37.0%) | 9,664 | **608 (6.3%)** | 9,056 |
| scss | 13,312 | 5,920 (44.5%) | 7,392 | **256 (3.5%)** | 7,136 |
| jess | 10,720 | 4,992 (46.6%) | 5,728 | **480 (8.4%)** | 5,248 |

**The `lazy` bucket is large but almost entirely NOT cycle-caused.** On css it
falls back at 2,560 sites, of which **32 are cycles** — the other 2,528 are the
resolved parser genuinely not always consuming. So a productivity fixpoint
(optimistic cycle seed, iterate down) has a **ceiling of ~96 sites on css**,
0.6% of boundaries. **Not built** — the hazard is that a seed failing to
converge downward reports a non-consuming rule as consuming and deletes a
rollback that fires, which is unsound in the dangerous direction. less/jess at
6.3%/8.4% are more defensible; revisit only if a cheaper lever is exhausted.

**Where the mass actually is (css):** `regex` 5,504, `many` 3,872, `expect`
2,688, `optional` 736. `many`/`optional`/`not`/`expect` are genuinely
zero-width — correct answers with **no headroom** — and `expect` is the
38-mismatch trap. **The one unexplained bucket is css `regex`: 5,504 sites,
zero converted**, unchanged by a structural precision fix. Unconfirmed whether
that is genuine nullability (at-rule-prelude shapes like `[^;{]*`) or remaining
imprecision.

### 2.4g The calls-vs-sites discrepancy is CLOSED

css-parser compiles ~6 grammar variants per package (`ast`, `positions`, `cst`,
`cst/positions`, …). Per artifact: 26,688 / 6 ≈ **4,448 boundaries**,
9,824 / 6 ≈ **1,637 converted** — against the design doc's **4,268 → 1,651**.
Within 4%.

**The doc's numbers and the instrumented numbers are the same measurement at
different multiplicities.** The apparent 26,688-vs-558 gap was **variant count,
not disagreement.** Before treating two counts as contradictory, check whether
one is per-artifact and the other is per-package.

### 2.4h Native-primitive bakeoff — they win microbenchmarks and vanish in situ

Microbenchmarks (0.97 MiB real CSS, one process, interleaved, rotated order,
checksums asserted equal):

| candidate | rel | wins | mechanism |
| --- | ---: | --- | --- |
| `String.indexOf`, single stop | **0.232** | 61/61 | SIMD-accelerated |
| object, **dense int keys** | **0.173** | 31/31 | elements store, not named-property IC |
| plain Array | 0.183 | 31/31 | |
| object, sparse int keys | 0.192 | 31/31 | |
| Uint8Array LUT 64 KB | 0.874 | 60/61 | one memory read replaces a 7-term `\|\|` chain |
| bitmask Int32Array indexed | 0.893 | 60/61 | |
| Map, integer keys | 0.590 | 31/31 | |
| **`Object.freeze(Array)`** | **0.594** | | **LOSES the fast elements kind — 3.4× slower. Anti-optimisation.** |
| bitmask 4× SMI **branched** | 1.093 | 3/61 | 4 branches to *select* the mask is the whole cost |
| sticky `/y` `exec()` | 3.068 | 0/61 | allocates a match array per position |

**Elements kinds measured via `%DebugPrint`, not assumed**: only the plain Array
is `PACKED`; a dense-int-keyed *object* is `HOLEY`; **nothing reached dictionary
mode**, which is why sparse cost only 4% instead of collapsing.

**Sticky regex inverts by run length** — loses 3× on short ident runs, wins
27.5% on long delimiter runs.

**In situ: −0.56% css raw bytes, speed at or below the noise floor and not
claimed.** less raw −118 B but gzip **+10** — `indexOf` is shorter yet breaks
the ubiquitous `while (_j < input.length && !(…)) _j++` run that gzip matches
everywhere else.

**The instrument is now self-calibrating, and this is the transferable part.**
graphql and json convert zero sites and were `cmp`-verified byte-identical, so
they were carried in every run as live controls: they read **1.0096 and 0.9999**
at 24/51 and 26/51 wins. **That is the floor, measured in the same run rather
than assumed.** An earlier harness measured those same byte-identical artifacts
**7.8% apart**; batching parses per sample fixed it, and every in-situ number
from before that fix was noise — including a css row that swung +7.9% → −1.9%
between runs.

### 2.4i Hot-path census — `_ctx.` field reads dominate, and `_map` is not hot

On a real 241,068 B fused artifact:

| | count |
| --- | ---: |
| `_ctx.` reads | **1,692** |
| `input.charCodeAt(` | 550 |
| `.get(` | **0** |
| `new Map` | **0** |
| bracket-index table reads | **0** |

**`_map` occurs 8 times in 4,766 lines** — the literal, the `defineProperty`
stamps, `return _map` — and **zero times inside any rule body.** Rule-to-rule
calls are direct hoisted `_r_Name(input, pos, _ctx)` references (40 interior
call sites, 0 through the map), and keys are full rule names, not ids.

**So the 5.8× integer-key win cannot apply to `_map`, which is read once per
parse.** It stays a live quantified datum for the G5 `g.` table *if* that table
lands on a hot path.

**The unexamined lead: `_ctx.` field access is 3× more common than
`charCodeAt` and nobody has looked at it.**

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

### 2.10a `g.X` is a DIRECT STATIC CALL — this is the cause of the 4.19×

`g.X` compiles to `_r_N0(input, _pos, _ctx)` — **resolved at macro time, not a
runtime indirection.** Measured 24 call sites against 12 emitted bodies.

**Therefore each variant statically re-resolves the entire graph into its own
body set**, which is why four grammars differing by two booleans share nothing.
This is the mechanism behind §2.10, not a mysterious emitter choice.

**The duplication is available**: the four bodies are **77–82% line-identical**
after normalising generated variable numbering.

| variant | bytes | shared with `ast` |
| --- | ---: | ---: |
| ast | 63,965 | — |
| ast + trackLines | 68,392 | 82.3% |
| cst | 68,120 | 82.5% |
| cst + trackLines | 72,539 | 77.3% |

One shared body plus four thin tables lands near **~105 KB against today's
267,965 B**, and drops a variant's marginal cost from 100% of the base to ~20%.

**Honest qualification — do not let this leak into a goal-2 figure.** It does
**not** shrink the single downloaded `ast.js`, which already pays 1× via
tree-shaking. Late-resolving `g.` lets the four variants share a body; it does
not change the ~950 B base per call site, because that base **is** the
call-site emission. **Goal 4 is a large aggregate and DX win.** The per-dialect
goal-2 number moves on the grammar-side multiplier and the leaf prune, not on
variant folding.

**§2.10's "naive goal 4 defeats goal 2" is RETRACTED** — it described a bad
implementation nobody proposed. See §4.

### 2.10b The unreferenced-leaf cost is an eagerly-materialised public surface

51 leaves composed, **zero** referenced by the local factory. All 51 emit
**both** an `_r_LN` body **and** a public `_map` wrapper:

```js
const _map = {
  "L0": function (input, _pos, _ctx) { const _pfv13 = _r_L0(input, _pos, _ctx) ... },
```

Each `_r_LN` appears exactly twice — its definition and its single `_map`
wrapper call. **Adding one reference (`g.L0`) costs +236 B**, confirming the
~2,310 B is paid for *existing*, not for being used.

**Not "dead code by accident" — every composed rule becomes an individually
addressable parse entry point.** Tree-shaking cannot touch it because `_map` is
a single object literal returned wholesale from the IIFE, and a bundler cannot
drop individual properties of an object returned as a unit.

Two fixes, **not equivalent**:

1. **Reachability prune from the entry.** Correct for a *terminal* `composeLeaf`
   — its contract says nothing composes further — but needs an entry
   declaration and **breaks the linkable/fusable path**, where a downstream
   dialect legitimately references base rules the base never uses.
2. **Make the surface tree-shakeable** — emit each rule as its own
   `/* @__PURE__ */` binding instead of a property of one atomic literal. No API
   change, no semantic change. **Unchecked precondition:** whether any consumer
   accesses rules by dynamic string, which would defeat it.

Same shape as the variant duplication: **the elimination is available and the
emitter declines it.**

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

## 4a. Tooling traps that make a green run meaningless

- **`.gitignore` line 60 is a bare `lib`, which matches that directory name at
  ANY depth.** Verified: `git check-ignore -v tools/grammar-tournament/lib/refshape.mjs`
  → `.gitignore:60:lib`. Lines 61–62 are `!scripts/task-runtime/lib/`, so
  someone hit this before and carved an exception rather than fixing the
  pattern. **A tool committed with a `lib/` subdirectory silently ships without
  it**, and self-checks pass for the author because their working tree has the
  files — the same class as "build succeeded but the artifact references an
  undefined identifier." **Rename the directory rather than adding a third
  negation.**
- **Verify a committed tool from a clean clone or via `git show`, never from
  the working tree.** `git ls-tree` the commit and confirm every `import`
  resolves inside it.
- **The shared scratchpad root is NOT safe for unnamespaced filenames.** A
  scratchpad `cp` collided with another agent's file via **macOS
  case-insensitivity** and overwrote `css/src/grammar.ts` with a *less*
  grammar. Separately, a mask/restore regex in a bulk rewriter ate 443 lines.
  Both were recovered from namespaced scratch copies without any destructive
  git op. **Work under `scratchpad/<lane-name>/`, always.**

---

## 4a-bis. The two traps that have each fired THREE times

**1. Calls versus sites.** `alwaysConsumes` was called 26,688 times against 558
distinct boundaries; 767 emitted capture sites against 31,673 runtime events;
a `regex` bucket of 5,504 *calls* read as 5,504 opportunities. Three wrong
headlines, two different agents, one of whom had personally reconciled the
confusion for someone else the round before. **Instrument distinct sites by
default; derive call counts only if something needs them.**

**2. Toy versus shipping artifact.** parseman's `examples/css` is 231,731 B with
61 capture sites; the shipping css grammar is ~3.1 MB with 767 emitted sites
and 31,673 runtime events. Conclusions drawn on the toy — "95% of capture sites
are rollback-able", "20 distinct regexes, 0 genuinely nullable" — do not
transfer, and the second could not be reconciled with a `converted=0` measured
on the shipping grammar. **Measure on the shipping artifact or say which you
used, every time.**

## 4b. A false win that passes EVERY gate

**The most dangerous result of the session.** The scss lane rewrote all 31
`node<AstType>(` type arguments to test the H2 hypothesis. The result:

- compiled clean
- passed **322/322** tests
- was **byte-identical on both surfaces**
- showed a **−12.3 KB "win" indistinguishable from a real one**

It was 29 mangled type annotations. **No gate we have would have caught it.**
Tree identity cannot, because the trees genuinely do not move. The only defence
is that the *edit* was nonsense on inspection.

**Consequence: byte-identity is necessary and not sufficient.** A size win must
also be explicable — if you cannot say which productions stopped being
duplicated and why, the number is not evidence.

## 4c. The build-order note in circulation is WRONG

**`internal-css-recognition` NO LONGER EXISTS** — no directory, no
`package.json` reference anywhere in the tree. It was renamed to
**`packages/parser-shared`** at `a74131e8f`. Verified.

The four parser packages import `@jesscss/parser-shared/{recognition,
opaque-at-rule,pseudo-consts}`. **Build `packages/parser-shared` first.**
Without it, `pnpm compile` dies with
`composeLeaf() must macro-fuse; runtime composition is forbidden` — which reads
like a grammar or plugin defect and is neither.

Two further traps in the same flow, both safe to measure through:

- `pnpm compile` exits **non-zero on the `.d.ts` step** unless `@jesscss/core`
  is built, **but the macro fuse succeeds and `ast.js` is emitted.**
- `packages/core`'s own build fails on a missing `@jesscss/awaitable-pipe`
  while still emitting `lib/ast.js`, which is enough to run the AST path.

## 4d. Gates confirmed to be checking nothing

- **`pnpm perf:gate` defaults `PERF_GATE=off`**, and
  `scripts/perf-gate/measure.mjs` `CASES` is **css×2 + less×2 — no scss case,
  no jess case.** It reported `PASS` having graded **zero** cases. Every scss
  and jess grammar commit in this project's history passed a gate that never
  looked at them.
- **`scoreboard.mjs:81` reads `.git/HEAD` directly**, so it cannot run in a
  worktree — where every lane is required to work. In a worktree `.git` is a
  *file*. Same class as the `.gitignore` bug: green on the author's checkout,
  dead everywhere else. Fix: `git rev-parse HEAD`.

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
