# Over-narrow grammar shapes — survey

**Base:** `99197fff0` (`origin/dev`), branch `survey/over-narrow-grammar-shapes`.
**Status:** SURVEY. Nothing here is fixed. Every row is a candidate, and the
rows marked "needs owner ruling" are not safe to act on unilaterally.

The ask: *"look for other places in css and derivative grammars where maybe the
grammar is too 'specific' and we could do more general shapes and use
diagnostics."* The settled principle behind it is **the parser accepts SHAPES,
not semantics** — validity belongs to eval and the language service.

## 0. The one finding that reframes the rest

**A narrow grammar does not only reject. It sometimes ACCEPTS, into the wrong
node — and that is worse.**

`css` accepts `svg|circle`. It should not be counted as a pass. Measured
(`test/cross-dialect/over-narrow-node-probe.test.ts`):

```
css   svg|circle  ComplexSelector[ SimpleSelector "svg", "|", SimpleSelector "circle" ]
css   svg circle  ComplexSelector[ SimpleSelector "svg", " ", SimpleSelector "circle" ]
less  svg|circle  SimpleSelector "svg|circle"
```

The namespace bar is in `combinator = keywords(['||', '>', '+', '~', '|'])`
(`packages/syntax/css/css-parser/src/grammar.ts:998`), so a namespace-qualified
type selector arrives structurally identical to a **descendant combinator**. One
compound became two. That propagates into specificity, `extend`, and `:is()`
flattening, all of which count compound segments. `scss` and `jess` merely
reject the same input, which is strictly better: a reject is loud.

This is the same failure class as the SCSS `div:hover, span { … }` incident that
produced a `Declaration` named `div`. It is also why an acceptance-only probe is
not a sufficient instrument, and why this survey carries two.

**Consequence for prioritization:** rank by OUTCOME, not by frequency —
wrong node ≫ rejection of valid CSS ≫ pure duplication.

## 1. Method, and its limits

### Prong A — behavioural

`test/cross-dialect/over-narrow-corpus.ts`, 154 probes, 149 asserted spec-valid
with a **mandatory spec clause per entry**, run through all four grammars by
`test/cross-dialect/over-narrow-probe.test.ts` on top of the existing
`test/dialects.ts` runner (which imports `src`, not `lib`, so no staleness).

The absolute reference is the SPEC, deliberately. The landed
`acceptance-matrix.test.ts` compares the four dialects TO EACH OTHER and is
therefore structurally blind to the case where all four are equally too narrow.
Six probes here are rejected by all four; the matrix scores every one of them
green.

### Prong A′ — node shape

`test/cross-dialect/over-narrow-node-probe.test.ts`. Prints the CST for the
probes where acceptance proves nothing, because §0.

### Instrument sensitivity — the controls, and one that FAILED

Three controls are asserted in the probe file, so it goes red if the instrument
stops being able to see:

| control | purpose | result |
| --- | --- | --- |
| `a { color: red } }}}` rejected by all four | proves the runner can report a reject at all | passes |
| `a { color: red }` accepted by all four | proves it can report an accept | passes |
| a divergence one dialect accepts and another rejects | proves four SEPARATE grammars are bound, not one bound four times | passes — **on the second attempt** |

The divergence control is the honest part. The first spelling used `svg|circle`,
which the brief and the css scan both describe as rejected by css. **It is not
— css accepts it**, and the control failed. Had it been written the other way
round (asserting css accepts) it would have passed while proving nothing, and
the wrong-node finding in §0 would never have surfaced. The control is now `|a`,
which has no left operand for the combinator misreading and so is genuinely
rejected by css.

### Limits, stated plainly

1. **Acceptance-only over most of the corpus.** Prong A′ covers seven inputs.
   Every other "Y" in the matrix is *parses*, not *parses into the right node*.
   Given §0, an unknown number of the 115 clean rows are wrong-node accepts. **This
   is the largest hole in the survey** and the obvious next instrument: a
   node-shape differential over the whole corpus.
2. **No eval or render.** A construct can parse into a plausible node and still
   serialize wrong.
3. **The corpus is hand-written, so its coverage is my judgement.** It does not
   sweep the specs mechanically. Constructs I did not think of are invisible,
   exactly as they were to the four per-package suites.
4. **`valid: true` is my reading of the cited clause.** Cited, so it is
   checkable — but it is not machine-verified against a reference implementation.
   No lessc/dart-sass/browser oracle was consulted.
5. **Prong B was three parallel scans of three grammars.** The `jess` scan is
   the least corroborated of the four; `jess` findings below lean more on prong
   A's measured verdicts than on source reading.
6. **`git blame`/history was not consulted**, so "duplication" findings do not
   distinguish a copy from convergent evolution.

### Calibration — which known instances the method rediscovered

| calibration instance | rediscovered? | by what |
| --- | --- | --- |
| namespaced selectors (`svg\|circle`, `*\|a`, `\|a`, `a[*\|href=x]`) | **yes, and deepened** | prong A found the rejections (sel-01…06); prong A′ found that css's "accept" is a wrong node — which was NOT in the calibration set |
| `a:not(foo(a/b))` fails in all four | **yes** | prong A, `sel-45`, the only all-four selector rejection in the corpus |
| `min(U+0-7F)` rejected by jess alone | **yes** | prong A, `val-06`, plus `val-01…05` showing jess rejects the whole `unicode-range` family, not just the math-function case |
| three constructs jess alone rejects | **yes, all three** | `at-15` `@layer base; @import`, `at-38` `@container style(--x: 1)`, `at-50/51` `@page :first` |
| eight at-rule statement forms supersets reject | **partially** | the corpus probes statement forms (`at-02`, `at-04`) and finds them clean at top level; it does NOT contain the nested `@media all { @foo; }` shape the css scan found, so this is a prong-B rediscovery only |
| `@charset` had no arm in css | n/a, fixed | `at-10` green |
| lone `/` in a bracketed prelude group | n/a, fixed | `at-19` green |
| attribute selectors fusing `[a=y i]` → `[a=yi]` | n/a, fixed | `sel-16…19` green, all four |
| escapes are the most-forgotten shape | **yes, three new instances** | `val-24/25/26` (less rejects escaped `<custom-ident>`), `cp-09` (less rejects an escaped custom-property name), `val-13` (jess rejects an escaped `url()`) |

A method that could not see the calibration set would be worthless. This one
sees all of it, and found the wrong-node dimension the calibration set did not
contain.

## 2. Prong A — the measured matrix

Columns `css less scss jess`; `Y` accept, `n` reject. Full run in
`test/cross-dialect/over-narrow-probe.test.ts`.

```
probes: 154   asserted spec-valid: 149
valid-but-rejected somewhere:                                   34
rejected by ALL FOUR (invisible to the acceptance matrix):       6
crashes:                                                         0
invalid-but-accepted everywhere:                                 1
```

### 2.1 Rejected by ALL FOUR — the acceptance matrix cannot see these

| probe | construct | spec clause | proposed generalization | resulting node | risk |
| --- | --- | --- | --- | --- | --- |
| `sel-45` | `a:not(foo(a/b))` | selectors-4 §3.5, css-syntax-3 §5.4.9 | `pseudoArgumentContent` (`css:1202-1210`) passes bare `balanced()`; pass `{ skip: [customSlash] }`, which `balancedParens` (`css:1078-1087`) already does | unchanged — the argument is already an opaque token run | **none identified.** Same one-word fix in all four |
| `cp-08` | `--: red` | css-variables-1 §2 | custom-property name is `--` plus anything, including nothing | `Declaration` name `--` | low; `--` cannot collide with a real property |
| `syn-01` | `<!-- a { } -->` | css-syntax-3 §5.4.1 | CDO/CDC are top-level no-ops | none (trivia) | low, top-level only. Nested CDO is NOT a no-op |
| `syn-02` | `a { color: red` (EOF) | css-syntax-3 §5.3.2 | EOF closes open blocks | `Ruleset` with the block ending at EOF | **needs owner ruling.** This is error RECOVERY, not grammar. Silently accepting truncated input may be worse than a clear error |
| `syn-03` | `a { content: "x` (EOF) | css-syntax-3 §4.3.5 | EOF ends the string | `Quoted` | same ruling as `syn-02` |
| `syn-04` | trailing `/* x` (EOF) | css-syntax-3 §4.3.2 | EOF ends the comment | trivia | same ruling as `syn-02` |

`sel-45` is the only one of the six that is unambiguously a grammar defect with
a known, safe, one-word fix in all four files. The three `syn-0*` EOF rows are
one question, not three: **does jess implement css-syntax-3 error recovery, or
does it reject malformed input?** That is an owner call, and the answer decides
all three at once.

### 2.2 Rejected by some — real dialect defects

| probe | construct | spec | css | less | scss | jess | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `sel-01` | `svg\|circle` | selectors-4 §6.1 | **wrong node** | Y | n | n | §0 |
| `sel-02` | `*\|a` | §6.1 | **wrong node** | Y | n | n | |
| `sel-03` | `\|a` | §6.1 | n | Y | n | n | |
| `sel-04` | `svg\|*` | §6.1 | **wrong node** | Y | n | n | |
| `sel-05` | `a[*\|href=x]` | §6.2 | n | Y | n | n | attribute position |
| `sel-06` | `@namespace` then `svg\|circle` | css-namespaces-3 §2 | wrong node | Y | n | Y | |
| `sel-42` | `a:has(> img)` | selectors-4 §4.5 | Y | Y | Y | **n** | jess alone |
| `sel-43` | `a:has(~ .b)` | §4.5 | Y | Y | Y | **n** | jess alone |
| `val-01…05` | `unicode-range` family | css-syntax-3 §4.4 | Y | Y | Y | **n** | jess alone, all five forms |
| `val-12` | `url(  a.png  )` | css-syntax-3 §4.3.6 | Y | Y | **n** | **n** | |
| `val-13` | `url(a\ b.png)` | §4.3.6 | Y | Y | Y | **n** | escape |
| `val-24/25/26` | escaped `<custom-ident>` | css-values-4 §3.2 | Y | **n** | Y | Y | **less alone** — escapes |
| `val-43` | `red !/*c*/important` | css-syntax-3 §5.4.4 | Y | Y | **n** | Y | |
| `val-58` | `var(--x,)` | css-variables-1 §3 | Y | Y | **n** | Y | |
| `at-15` | `@layer base;` then `@import` | css-cascade-5 §6.1 | Y | Y | Y | **n** | |
| `at-31` | `@media not all and (monochrome)` | mediaqueries-4 §3.1 | Y | Y | **n** | Y | |
| `at-38` | `@container style(--x: 1)` | css-contain-3 §3.3 | Y | Y | Y | **n** | |
| `at-50/51` | `@page :first`, `@page narrow:left` | css-page-3 §3 | Y | Y | Y | **n** | |
| `at-56` | `@property --x { … }` | css-props-values-api-1 §2 | Y | Y | Y | **n** | |
| `cp-09` | `--a\.b: red` | css-syntax-3 §4.3.7 | Y | **n** | Y | Y | escape |
| `syn-05` | `;;a { }` stray semicolons | css-syntax-3 §5.4.1 | **n** | Y | n | n | css rejects, less accepts |

Two patterns worth naming:

- **jess carries the most rejections** (11 rows), consistent with its documented
  trailing position. `sel-42/43` (`:has` relative selectors) and the whole
  `unicode-range` family were not in the calibration set — these are **new**.
- **less is the only dialect that rejects escapes in `<custom-ident>`**
  (`val-24/25/26`, `cp-09`). Escapes were flagged as "the single most commonly
  forgotten shape" and this is a fourth independent instance of exactly that.

### 2.3 Over-acceptance controls

Only one invalid probe is accepted by all four: `val-32` `width: 1foo`, an
unknown unit. That is **correct** — it is a well-formed `<dimension-token>` per
css-syntax-3 §4.3.3 and unknown-unit validity is a diagnostic concern. The
generalization principle is working here.

`val-51` (`foo(1, "a", [b], {c})`) is rejected by all four. Per css-syntax-3
§5.4.9 a function's contents are an arbitrary balanced token stream, so this is
arguably a defect too, but the `{c}` block inside a value is unusual enough that
I have marked it invalid rather than assert it — flagging it as **needs owner
ruling** rather than counting it in §2.1.

`at-63` (`a { color: red @media all { … } }`) splits 2–2, and the css comment at
`grammar.ts:958-970` documents that boundary as deliberate. Not a finding.

## 3. Prong B — structural findings, ranked by blast radius

Ranked by outcome class first (wrong node ≫ rejection ≫ duplication), then by
how hot the reaching production is.

### B1. `|` in the css combinator list — WRONG NODE, hot path

`packages/syntax/css/css-parser/src/grammar.ts:998`. See §0. Reaching
production is `ComplexSelector`, which every ruleset in every stylesheet enters.

**The fix already exists in the repo**, which is what makes this actionable:
less has `AttributeNamespace` (`less/less-parser/src/grammar.ts:5937-5948`) and
`NamespaceTypeSelector` (`:5949-5953`), sharing one namespace-prefix production
between the type-selector and attribute-name positions so `svg|circle` and
`[svg|href]` cannot drift. The only disambiguation it needs is
`not(literal('='))`, to keep `[a|=b]` from being read as a namespace.

- **css**: remove `'|'` from `combinator` and port the less pair. Node becomes
  one `SimpleSelector` carrying the qualified name, matching less exactly.
- **scss**: `scssCombinator` (`scss/scss-parser/src/grammar.ts:5555-5560`)
  omits `|` while the AST type at `:49` **already declares it** — the type and
  the grammar disagree today. `|` has no other meaning in SCSS, so this
  generalization has **zero ambiguity cost**.
- **jess**: same shape as scss.

**Risk:** the css change is not purely additive — it changes the node for input
that currently parses, so `sel-01/02/04/06` move from `ComplexSelector` to
`SimpleSelector`. Any oracle aggregate over a corpus containing `a|b` selectors
will move, correctly. That is a fix, not a regression, but it must be landed
with the byte-identity oracle watched rather than assumed.

### B2. No generic STATEMENT arm inside typed at-rule bodies — rejection, hot

css: `ConditionalGroupAtRule` (`:3969`), `pageBodyItem` (`:3683`),
`fontFeatureValuesBodyBlock` (`:3686`). Each admits nested at-rules only in
BLOCK form. Consequence: `@media all { @foo bar { a { b: c } } }` parses,
`@media all { @foo; }` is a hard error. css-syntax-3 §5.4.2 makes no such
distinction — an at-rule ends at `;` or at a block, and both are ordinary.

Generalization: give each body item list the same generic statement arm the
top level already has. Node: the existing opaque/generic at-rule statement node.
**Risk: low** — it is additive, and the `;` terminator is unambiguous.

This is the structural cause behind the recorded "eight at-rule statement forms
the supersets reject". Prong A did **not** find it (the corpus only probes
statement forms at top level), so it is a prong-B-only rediscovery — noted as a
corpus gap.

### B3. `OpaqueAtRuleBlock` keeps its body as RAW TEXT — silent structure loss

css. An unknown at-rule's block is never parsed, so nested rules inside it do
not exist in the tree. css-syntax-3 §5.4.2 says the body of an unknown at-rule
is consumed as a normal block of declarations/rules.

This is not a rejection and not a wrong node — it is **absence**. It is
invisible to prong A entirely (the input parses) and to the acceptance matrix
(all four agree). Given `@foo { .a { color: red } }` parses, the `.a` ruleset is
simply not in the tree, and no downstream consumer can find it.

**Ranked here, above the duplication findings, because a survey instrument that
cannot see a finding is precisely the failure mode this survey is about.**
Generalizing means parsing the body with the ordinary nested-body production.
**Risk: needs owner ruling** — some unknown at-rules legitimately have
non-CSS bodies, and this interacts with the raw-text preservation the renderer
may depend on.

### B4. `less` has no generic fallback for a KNOWN at-rule with an unparseable prelude — rejection

The inverse of B2. In less, `@madia (foo) { }` recovers cleanly through the
generic arm, but `@media <unparseable> { }` is **fatal**, because naming the
at-rule commits it to a typed prelude with no escape. A typo is more forgiving
than a construct the grammar has not learned yet, which is backwards.

Generalization: on typed-prelude failure, fall back to the generic at-rule arm.
Node: the generic at-rule node, prelude opaque. **Risk: moderate** — a fallback
that swallows genuine prelude errors turns a parse error into a silent
mis-parse, which is the §0 hazard again. **Needs owner ruling**, and probably
wants a diagnostic emitted on the fallback path rather than a silent accept.

### B5. `@-webkit-keyframes` typed, `@-foo-keyframes` opaque — duplication + node inconsistency

`packages/parser-shared/src/recognition.ts:225` admits **any** vendor prefix;
the css key list at `grammar.ts:3809-3815` enumerates **five** names. Same
construct, two node types, depending on which prefix. Two spellings of the same
rule living in two packages is exactly the duplication mechanism the review
standard's naming section describes.

Generalization: drive both from the permissive `recognition.ts` shape. Node:
every `@<vendor>keyframes` gets the typed keyframes node. **Risk: low.**

### B6. `'calc'` spelled independently in six places — duplication, hot

css `grammar.ts`. The canonical table is `CSS_MATH_FUNCTIONS` in
`@jesscss/core/ast`, and `grammar.ts:882-892` documents at length *why* the
literal is re-spelled: parseman's plugin const-folds dispatch keys at build time
and cannot follow an imported binding; importing it fails the build with
`composeLeaf() must macro-fuse`. There is a gate
(`test/math-function-table.test.ts`) against drift.

So the duplication is a **deliberate exception with a stated justification and a
gate**, not a defect — with one exception. The hand-rolled lookahead at
`grammar.ts:911`:

```
regex(/(?!(?:calc|url|var)(?=\())…/)
```

duplicates a dispatch table in a *different* form — a regex alternation rather
than a keys list — so the drift gate does not cover it. If a name is added to
`CSS_MATH_FUNCTION_OPENERS`, this lookahead does not learn about it.

**Ranked last** because it is not currently over-narrow in a way prong A can
detect: `val-50…59` (nested functions, `calc` with keywords, `round(up, …)`,
`anchor()`, relative color) all pass in all four. It is a maintenance hazard,
not a behavioural defect. And §6.2's refutation stands: routing math arguments
through a `<calc-sum>` ladder measured 17 regressions in a 25-case battery.
**Do not "generalize" the math lane.** scss's value lane, where `calc` appears
zero times, is the model.

### B7. Duplicate keys in the returned rules map — not over-narrowness, but load-bearing

The build emits, on `origin/dev`:

```
scss/scss-parser/src/grammar.ts:6681  Duplicate key "QueryValue"
jess/jess-parser/src/grammar.ts:7803  Duplicate key "QueryValue"
jess/jess-parser/src/grammar.ts:7804  Duplicate key "QueryTerm"
jess/jess-parser/src/grammar.ts:7807  Duplicate key "QueryFeatureName"
```

The scss one is the known two-config `verify:types` baseline. **jess has three,
and they are not the documented baseline.** A duplicate key means the second
binding silently wins and the first production is unreachable from the public
map. Noted because `at-31`/`at-38` (the `@media`/`@container` query rejections)
sit in exactly the `Query*` family these keys name. Not investigated further —
**flagged for a separate pass.**

## 4. Prioritized list

### Safe generalizations — no ruling needed, no ambiguity identified

1. **`sel-45` — `pseudoArgumentContent` bare `balanced()`.** Pass
   `{ skip: [customSlash] }`, as `balancedParens` already does. Four files, one
   word each. Fixes the only all-four selector rejection. `css:1202-1210`.
2. **B1 scss/jess — add `|` namespace support.** Zero ambiguity cost (`|` has no
   other meaning), the AST type already declares it in scss (`:49`), and less
   has the exact production to port (`less:5937-5953`). Purely additive: it
   turns rejections into accepts.
3. **B2 — generic statement arm in typed at-rule bodies.** Additive, `;` is
   unambiguous. `css:3683`, `:3686`, `:3969`.
4. **B5 — drive vendor-prefixed keyframes off the permissive shape.**
   Removes a two-package duplication and a node-type inconsistency.
5. **`cp-08` — `--` as a custom-property name.** Cannot collide.
6. **less escape handling in `<custom-ident>` and custom-property names**
   (`val-24/25/26`, `cp-09`). Straight defects; the escape shape is already
   spelled correctly elsewhere in the same file.
7. **The per-dialect single rejections**, each a small local fix:
   jess `sel-42/43`, `val-01…05`, `val-13`, `at-15`, `at-38`, `at-50/51`,
   `at-56`; scss `val-43`, `val-58`, `at-31`; scss+jess `val-12`.

### Needs an owner ruling

1. **B1 css — removing `'|'` from `combinator`.** The fix is clear and the
   current behaviour is a wrong node, but it CHANGES the node for input that
   parses today, so it is not additive and it will move oracle aggregates.
   Highest value item in the survey; also the only one that can regress
   something.
2. **`syn-02/03/04` — does jess implement css-syntax-3 EOF recovery?** One
   question, three probes. Accepting truncated input silently may be worse than
   erroring.
3. **B3 — parse the body of unknown at-rules instead of keeping raw text.**
   Interacts with render-time raw-text preservation.
4. **B4 — less typed-prelude fallback.** Wants a diagnostic on the fallback
   path, not a silent accept; otherwise it recreates the §0 hazard.
5. **`syn-01` CDO/CDC**, **`syn-05` stray semicolons** — trivial in isolation,
   but both are error-recovery policy, same family as (2).
6. **`val-51`** — whether `{c}` inside a function argument is a shape the
   parser should accept.

### Explicitly NOT proposed

- **Any generalization of the math-function lane.** §6.2 measured 17 regressions
  in 25 cases. B6 is a duplication note only.
- **Renaming anything.** Out of scope, and the naming law is a duplication rule,
  not a style pass.

## 5. Next instrument

The survey's own largest limit (§1, limit 1) names the next piece of work:
**extend prong A′ to a node-shape differential over the whole 154-probe corpus**,
not seven inputs. §0 is proof that acceptance and correctness are different
questions, and today only seven of 154 rows have been asked the second one.
