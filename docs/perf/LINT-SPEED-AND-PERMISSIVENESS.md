# Lint speed and permissiveness — a measurement and design study

**Commit:** `99197fff017383668fc1f9aeda1f9e689de3614d` (`origin/dev`), clean tree.
**Nothing in this study optimizes anything.** It is evidence and a ranked proposal.

Two linked questions from the owner: what would make us faster at linting
against postcss/stylelint, or faster at parsing in general — whatever we can
push to diagnostic time without being overly permissive.

The short version, before the evidence:

- The guard taxonomy is **three buckets, not two**. The missing third bucket is
  where every over-acceptance incident in this repo actually lives, and the two
  named validity-narrowing candidates both turn out to belong to it.
- The stylelint hypothesis is **half confirmed and half refuted**. The
  architectural claim holds exactly: jess's lint cost is flat in rule count and
  stylelint's is linear. The practical claim does not: jess's floor is high
  enough that stylelint wins until **~30.6 rules**.
- The lazy-materialization risk **does not apply to this path at all**, for a
  structural reason, and the measurement that would have quantified it instead
  found a much larger and more actionable number.

---

## 0. Method, and what it cannot see

### The instrument

`packages/lint/test/stylelint-crossover-bench.ts`, committed with this study.
One process, one checkout, interleaved rounds, medians with p05/p95/min/max.
Two independent processes (A and B) at 25 rounds and 5 warmups each.

Corpus: `packages/syntax/css/css-parser/test/render-differential/corpus.mjs`,
imported rather than forked — 119 declared entries, bootstrap 5.3.8.

postcss, `postcss-value-parser` and `postcss-selector-parser` are resolved
through **stylelint's own resolution root**, so the timed re-parse uses the
instances stylelint runs (postcss 8.5.23, value-parser 4.2.0, selector-parser
7.1.4). This lockfile carries three postcss majors; resolving from
`packages/lint` would have timed a copy nothing under test uses.

### Population

**106 of 119 files are timed.** Thirteen are excluded and each is named in the
report rather than counted:

| Excluded by | Count | Why |
|---|---|---|
| postcss | 12 | `CssSyntaxError` — the corpus deliberately contains invalid CSS, e.g. `fixture/calc-rejects.css`, which exists so the render differential can hash a *rejection* |
| stylelint | 1 | An outright **crash**, see below |

The stylelint crash is a real upstream defect worth reporting separately:
stylelint 17.14.1's `declaration-no-important` throws `TypeError: Cannot read
properties of undefined (reading 'index')` at
`lib/rules/declaration-no-important/index.mjs:39` on
`packages/syntax/css/css-parser/test/css/important.css`, whose
`! /* comment */ important` spellings defeat its index search. stylelint cannot
lint that file at all.

### Limits — read these before quoting any number

- **Per-guard cost was NOT measured.** Part 1 ranks guards by *reach* (how often
  each is evaluated, counted over the corpus) and by the one guard that has a
  committed measurement already. No guard was individually toggled and timed.
  Any statement in Part 1 that sounds like a timing is a reach count or a
  citation, and is labelled as such.
- **The noise floor is large and asymmetric.** Within-case spread
  ((max−min)/median) reached **186%** on `postcss-parse` in run B. Medians across
  the two processes agree to within **±6%** on every case, so effects above
  roughly 10% are real and anything smaller is not resolvable here. The flat
  jess slope in Part 2 is reported as *flat*, not as *slightly negative*, for
  exactly this reason.
- **CSS only.** The corpus is CSS. Less/SCSS/Jess guards are read statically;
  their reach is not measured.
- **One machine, one Node (v24.11.1).** No cross-machine claim.
- **This is not a cross-worktree comparison and cannot be made into one.** Every
  case runs in one directory. A cross-worktree comparison in this repo has
  already produced a 56% "finding" that was pure directory bias and was
  retracted.

### Two instrument bugs found and fixed, both of which reported plausible numbers

Recorded because both are the failure mode the perf docs warn about — a broken
instrument that does not look broken.

1. **Exponential walk.** `CssCstNode` exposes both `rules` and `children`, and
   they are not two halves of a tree: they hold the **same** child references.
   Descending both doubles every subtree per level. The first version reported
   **15,112,724,507** CST nodes for a corpus whose real count is 255,161 — five
   orders of magnitude out, with no crash and no visibly wrong timing. The walk
   now descends `children` only, and `assertRulesAliasChildren` proves the
   aliasing over the whole corpus instead of trusting the sample that revealed
   it.
2. **Silently empty corpus.** A refactor left the stylelint preflight
   referencing a renamed constant; every file landed in its `catch`, and the run
   reported a tidy `0.03 ms` for a 27-rule lint of **nothing**. A
   `MINIMUM_TIMED_FILES` floor now throws instead.

---

## 1. The guard taxonomy

### The two-bucket split does not survive contact with the grammars

The brief asks for FAST-REJECT versus VALIDITY NARROWING. Applying it to the
named candidates, both of the "hottest validity-narrowing sites" fail to be
validity narrowing: removing them rejects nothing extra and accepts nothing
extra. They change which **arm** consumes the input — that is, which **node**
comes out.

That is a third category, and it is not a pedantic one. It is precisely where
this repo's over-acceptance incidents live. So:

### The mechanical discriminator

Ask one question of the guard's **failure**, and only that question:

> When this guard fails, what happens to the bytes it was guarding?

| Answer | Bucket | Removing it costs | Removing it changes |
|---|---|---|---|
| An alternative is skipped that would have been tried and backtracked out of | **FAST-REJECT** | **time** | nothing — same language, same tree |
| The bytes are consumed by a *different* arm | **DISAMBIGUATOR** | nothing | **the tree** — same language, different nodes |
| The parse fails; no other arm wants the bytes | **VALIDITY NARROWING** | nothing | **the language** — strictly more is accepted |

This is mechanical because all three are answerable from the grammar without
running it: look at what follows the guard in its `sequence`, and at what other
arms of the enclosing `choice` can start with the same bytes.

The practical consequence is the ordering of risk, which is the opposite of what
the source appearance suggests — all three are spelled `not(...)`:

- **FAST-REJECT** — removing is a pure performance regression. Safe to keep,
  costly to remove.
- **DISAMBIGUATOR** — removing is a **correctness** regression that no
  acceptance test catches, because acceptance is unchanged. Only a tree
  assertion catches it. **These must never be moved to diagnostics.**
- **VALIDITY NARROWING** — the only bucket that is a genuine candidate for
  diagnostic time, because it is the only one whose removal changes what is
  accepted and nothing else.

### The named candidates, classified

| Site | Construct | Bucket | Evidence — what happens on failure |
|---|---|---|---|
| scss `grammar.ts:2730` `directNestedPropertyAhead` | `not(regex(/[^{};]*[;}]/))` | **FAST-REJECT** | Skips the nested-property arm. The file states the cost of removal at `:2726-2728`: "Deleting it costs ~70% on a declaration-only corpus, because every `color: red;` then speculatively parses its whole value before failing on the absent `{`". |
| scss `grammar.ts:2740` `nestedPropertyColon` | `regex(/:(?=[ \t\n\r\f]\|\{)/)` | **DISAMBIGUATOR** | Routes between nested-property and Ruleset. Failure hands the bytes to the CSS path. |
| css `grammar.ts:911` `genericFunctionIdentifier` | `(?!(?:calc\|url\|var)(?=\())` | **DISAMBIGUATOR** | `calc(`/`url(`/`var(` are consumed by dedicated arms (`CSS_MATH_FUNCTION_OPENERS` → `g.MathFunction` at `:2596-2610`, `UrlFunction` at `:2592`). Failure routes; it does not reject. |
| less `grammar.ts:3347` `genericFunctionOpen` | `not(keywords(['url(', 'calc('], { caseInsensitive: true }))` | **DISAMBIGUATOR** | Same shape, different notation. |
| less `grammar.ts:5578-5580` `StaticAtRuleStatementName` | `not(CustomValueAtKeyword)` | **DISAMBIGUATOR** | Routes `@foo` between the static-statement and custom-value at-rule arms. |
| less `grammar.ts:5582-5586` `AtRuleName` | `not(CustomValueAtKeyword)`, `not(g.LayerAtKeyword)` | **DISAMBIGUATOR** | Routes to `@layer`'s own arm. |
| css `grammar.ts:1314`, `:1404`, `:1442` | `not(g.MalformedPseudoSelectorNumericArgument)` | **VALIDITY NARROWING** | The only clean instance found. `:1300-1302` states it outright: "if that arm cannot close, the public grammar **rejects** it rather than accepting malformed An+B bytes as a generic pseudo argument." No arm wants the bytes; failure is a parse error. |
| css `grammar.ts:1559` | `not(g.NthPseudoSelectorName)` | **DISAMBIGUATOR** | Routes An+B names to the typed nth arm. |

**The headline result of Part 1: of eight guard sites examined, exactly one
family is validity narrowing.** The two sites nominated as the hottest
validity-narrowing candidates are both disambiguators, and moving either to
diagnostics would produce a wrong tree, not a more permissive parser.

### Reach, since per-guard cost was not measured

Occurrence counts over the 106-file corpus (610 KB), as an upper bound on how
often each guard family is evaluated:

| Guard family | Reach proxy | Count |
|---|---|---|
| `directNestedPropertyAhead` (declaration sites) | `;` | **13,228** |
| `genericFunctionIdentifier` (function opens) | `[-\w]+\(` | **3,189** |
| — of which are exactly `calc(`/`url(`/`var(` | | **2,162 (68%)** |
| pseudo guards | `::?[-\w]+` | **1,079** |
| less at-rule name gates | `@[-\w]+` | **236** |

Two things fall out of this.

**The `calc|url|var` lookahead's excluded branch is the majority case, not the
exception.** 68% of function opens in real CSS are one of those three names. A
reader assuming the lookahead is a rare-path guard has it backwards.

**The less at-rule name gates are 56× colder than the declaration path.** They
are "every `@foo`", but `@foo` is 236 occurrences against 13,228 declarations.
Ranking them as hot because they are unconditional confuses *unconditional* with
*frequent*.

### The cost model that should shape any grammar proposal

`css/grammar.ts:2596-2607` records the real driver, and it is not what guard
count suggests:

> parseman compiles `dispatch` to a linear if/else chain with each tail fully
> INLINED, and this tail is emitted once per artifact per arm: twenty separate
> `cssCase` arms were measured at roughly **1.4 MB** of generated code across
> css+jess against roughly **70 KB** for the multi-key form.

So: **a long key list is cheap; a long arm count is not** — 20× the code for the
same dispatch. This inverts the intuitive reading of `genericFunctionIdentifier`.
Its `(?!(?:calc|url|var)(?=\())` duplicates a dispatch table, and the instinct is
to "deduplicate" it by giving each excluded name its own arm. That instinct
would trade a three-literal lookahead for exactly the 20× code-size blowup this
comment exists to prevent. **The duplication is the cheap form.** The defect it
represents is a *maintenance* one — six spellings of `calc` that can drift —
which is what the existing `test/math-function-table.test.ts` gate already
addresses (`:884-890`).

---

## 2. The stylelint comparison

### The hypothesis

> postcss is fast because it is SHALLOW — values and selectors stay raw strings.
> stylelint pays that back repeatedly, because rules re-parse: value-parser per
> value-touching rule, selector-parser per selector-touching rule, once per rule
> per node. jess parses deeply ONCE, so a lint rule is a tree walk with no
> re-parse.

### Structure — the depth difference, quantified

| | Count |
|---|---|
| Declarations | 13,211 |
| Selectors | 6,833 |
| **postcss nodes** | **20,410** |
| **jess CST nodes** | **255,161** |

**jess's tree is 12.5× deeper.** That is the cost postcss avoids and the asset
jess is meant to amortize.

### Timings (ms per full 106-file corpus pass; median of 25 rounds)

| Case | Run A | Run B | A−B |
|---|---|---|---|
| `postcss-parse` | 18.8 | 18.2 | +3.2% |
| `pc-values-1x` (one value-touching rule's re-parse) | 5.0 | 4.9 | +2.2% |
| `pc-selectors-1x` (one selector-touching rule's re-parse) | 22.3 | 22.1 | +0.7% |
| `jess-parse` | 105.2 | 102.0 | +3.2% |
| `jess-parse+walk` (full traversal of every node and leaf) | 102.9 | 97.3 | +5.8% |

### The re-parse mechanism is real and un-mitigated

stylelint does **not** memoize selector parses. `lib/utils/parseSelector.mjs`
calls `selectorParser().astSync(selector)` fresh on every invocation, with no
cache. So each selector-touching rule genuinely re-parses every selector.

The unit costs put that in proportion:

- One value-touching rule's re-parse (**5.0 ms**) is **27% of the entire postcss
  parse** (18.8 ms). Four such rules cost more than parsing the document.
- One selector-touching rule's re-parse (**22.3 ms**) **exceeds the entire
  postcss parse by 1.2×**. A single such rule more than doubles the cost of
  having read the file.

**The mechanism the hypothesis names is confirmed.**

### The slopes — the actual experiment

Both tools run the *same* K rules, from one shared ordered list
(`SHARED_RULE_ORDER`), because jess mirrors stylelint's rule names. Running both
sweeps is what makes this able to refute: a fixed jess number against a
stylelint sweep would show a crossover no matter what jess's slope was.

| K | `stylelint-K` A / B | `jess-lint-K` A / B |
|---|---|---|
| 1 | 59.5 / 57.0 | 215.1 / 219.8 |
| 2 | 59.4 / 57.3 | 196.1 / 196.4 |
| 4 | 77.8 / 74.4 | 220.5 / 217.6 |
| 8 | 109.9 / 105.6 | 217.2 / 216.0 |
| 16 | 157.0 / 148.4 | 203.6 / 204.3 |
| 27 | 173.7 / 169.6 | 206.9 / 199.0 |

Least-squares fits:

| | Run A | Run B |
|---|---|---|
| stylelint | `60.5 + 4.73·K` ms | `57.5 + 4.61·K` ms |
| jess | `211.9 − 0.20·K` ms | `213.8 − 0.51·K` ms |
| **Crossover** | **K = 30.7** | **K = 30.5** |

### Verdict: confirmed architecturally, refuted practically

**Confirmed.** stylelint costs **~4.7 ms per added rule** and jess costs
**nothing per added rule** — the jess slope is flat within a noise floor of
±10%, and jess's 27-rule config costs the same as its 1-rule config. The
"parse once, then read" architecture does exactly what was claimed.

Note also that stylelint's measured slope (4.7 ms/rule) sits right at the
value-re-parse unit cost (5.0 ms). The growth is the re-parse.

**Refuted.** jess does not win at realistic config sizes. At 27 rules jess is
**206.9 ms against stylelint's 173.7 ms — 1.19× slower**. The crossover is at
**~30.6 rules**, and jess is behind everywhere below it. jess's *parse alone*
(105 ms) already costs **5.6× postcss's** (18.8 ms) and exceeds stylelint's
entire 8-rule run.

Whether that matters depends on config size, and this is the one place the
result turns favourable: `stylelint-config-standard` is roughly 90 rules and
`stylelint-config-recommended` roughly 60 — both comfortably past 30.6. **The
architecture wins at the configs people actually adopt and loses at the small
ones**, which is the opposite of the usual deep-parser trade-off and is worth
saying plainly rather than rounding to "jess is faster".

### The lazy-materialization risk does not apply — and what was found instead

The risk was that jess's on-demand materialization means a lint rule builds
structure anyway, shrinking the "parse once" advantage.

**It does not apply to this path, structurally.** `CssCstNode`
(`packages/syntax/css/css-parser/src/cst-host.ts:23-32`) is a plain record of
`readonly` fields over `rules`/`children` arrays — no getters, no proxy, no
thunks. The CST is **100% eager**: everything is built during parse. The lazy
materialization in AST v2 is *value-domain typing at eval time*
(`ast/literal-tag.ts`, `ast/value-eval.ts`), and the lint path never enters
evaluation — `collectTolerantDiagnostics`
(`packages/diagnostics-core/src/tolerant-cst.ts:6583`) parses to CST and walks
it.

So there is no fraction to discount. The measurement confirms the reading:
`jess-parse+walk` (102.9 / 97.3) is **not distinguishable from `jess-parse`**
(105.2 / 102.0). A full traversal touching every one of 255,161 nodes and every
leaf value costs **less than the noise floor** of the parse that produced it.
Reading the whole tree is free; building it is the entire cost.

**What the measurement found instead is larger and directly actionable.**
Subtracting the parse from the 1-rule lint:

> `jess-lint-1` − `jess-parse` = **109.9 ms (A) / 117.8 ms (B)**

A *one-rule* lint does ~110 ms of diagnostic work — more than the parse itself,
and the same amount a 27-rule lint does. The reason is structural, not
incidental: **`collectTolerantDiagnostics` never receives the rule config.**
`CollectDiagnosticsInput` (`packages/diagnostics-core/src/types.ts:80-85`) is
`{ source, language, filePath, metadata }` — no rules. Every diagnostic in the
catalogue is computed unconditionally, and `applyPolicy`
(`packages/lint/src/index.ts:506`) filters afterward.

That is what makes the jess slope flat, and it is flat for the wrong reason:
disabling a rule saves nothing. This is invariant 10's shape ("policy must
reject a diagnostic before constructing it") on the lint path.

---

## 3. Ranked levers

Ranked by measured benefit over risk. Expected gains are stated against the
numbers above; where a gain is not measured, it says so.

### L1 — Gate diagnostic construction on the enabled-rule set

**Measured prize: up to ~110 ms of the ~208 ms lint, i.e. ~53%.** The largest
single number in this study, and the only lever whose benefit is already
measured rather than projected.

Thread the enabled-rule set into `CollectDiagnosticsInput` and skip constructing
what policy will discard. This does not require per-rule gating to pay: even
coarse gating by diagnostic family captures most of it.

- **Cost:** an API change to `collectTolerantDiagnostics` and its callers.
- **Effect on the crossover:** moves it sharply left. A 1-rule jess lint bounded
  by parse (~105 ms) instead of ~215 ms puts jess ahead of `stylelint-8`, and
  the crossover drops from ~30.6 toward the low single digits.
- **Invariant it must not break:** **10** — this *is* invariant 10 ("policy must
  reject a diagnostic before constructing it"). It must not be implemented as a
  post-hoc cache; the construction must not happen.
- **Risk:** low. Acceptance is unchanged; only which diagnostics are computed
  changes. Guard with a test asserting a full-config run reports what it does
  today.

### L2 — Wider first-set gating

The proven lever, at 25–48% landed. Reduces the 105 ms parse floor, which is
what jess is losing on below the crossover — and after L1, the parse floor
becomes essentially the *whole* remaining cost, so L1 and L2 compound.

- **Cost:** grammar work, byte-identity gated.
- **Invariant:** **8** — and specifically its warning. parseman already
  first-char-gates disjoint arms. **Prove a re-scan is real before optimizing
  it**; arm count on an authored macro is not a cost signal.
- **Risk:** low, well-trodden.

### L3 — Move the one genuine validity-narrowing family to diagnostics

`not(g.MalformedPseudoSelectorNumericArgument)` at css `grammar.ts:1314`,
`:1404`, `:1442`.

- **Expected gain: small, and NOT measured.** Reach is 1,079 pseudo tokens
  against 13,228 declaration sites. Do not undertake this for speed.
- **The real argument is permissiveness**, which is what the owner asked about:
  it is the one place found where the parser rejects input that could instead be
  a diagnostic, and rejecting malformed An+B fails the *whole file* rather than
  flagging one selector.
- **Invariant:** the hard constraint. The shape stays unambiguous and the node
  stays correct only if the accepted-but-malformed argument gets a node that is
  honestly *raw*, not one that pretends to be typed An+B.
- **Risk:** low, and uniquely low **because it is validity narrowing** — its
  removal cannot misroute, by the discriminator in Part 1.

### L4 — Do NOT "deduplicate" the `calc|url|var` lookaheads

Listed as a lever to **reject**, because it is the obvious-looking one.

`genericFunctionIdentifier` (css `:911`) and `genericFunctionOpen` (less
`:3347`) duplicate a dispatch table, and six spellings of `calc` is a genuine
maintenance smell. But they are **disambiguators**: removing them misroutes
`calc(` into `GenericFunction` and produces a wrong tree while accepting exactly
the same language — invisible to every acceptance test. And splitting them into
per-name arms hits the 1.4 MB-vs-70 KB code-size cliff at `:2596-2607`.

- **Expected gain: none. Expected cost: a silent correctness regression.**
- Keep the duplication; keep `test/math-function-table.test.ts` as the anti-drift
  gate. The precedent is §6.2's `<calc-sum>` ladder: **17 regressions in a
  25-case battery**, narrowing dressed as generalizing.

### L5 — Keep the diagnostic pass a separate walk over the same tree

Already true (`collectTolerantDiagnostics` = one parse, one walk; §2), already
measured to be the right shape (`jess-parse+walk` ≈ `jess-parse`).

- **Expected gain: none — it is a property to preserve, not a change to make.**
- **Invariant:** **2**. Any future lint rule that reaches for the source bytes
  instead of the node it already has reintroduces R1/R7. The guard is that the
  walk is free *because* nothing re-derives.

### Not recommended: deferring value materialization further

The brief lists it as a candidate. On this path there is nothing to defer — the
CST is already eager and the eval-time value domain is never entered. Deferring
CST construction would attack the 105 ms parse floor, but L2 attacks the same
floor with a proven method and no shape risk. Making `CssCstNode` lazy would put
getters on the hottest object in the system, which is invariant 1's territory.

---

## The hard constraint, restated from the evidence

"More general" is not "accept anything". This study found the discriminator that
makes the distinction mechanical, and it lands on the side of caution:

**Over-acceptance is safe only where the guard's failure has no other arm
waiting.** That is the definition of the validity-narrowing bucket, and it is
exactly one family out of the eight sites examined here.

The counter-example is in the tree, at scss `grammar.ts:2751-2760`, describing
the gate `nestedPropertyColon` replaced:

> That gate asked only "is there a `{` before any `;`/`}`", which is true of
> every nested rule as well, so SCSS silently turned `div:hover, span { … }`
> into a Declaration named `div` that swallowed the block.

A disambiguator that was loosened. Acceptance unchanged, tree wrong. Permissive-
ness that produces a wrong tree is worse than a parse error, because a parse
error is loud.
