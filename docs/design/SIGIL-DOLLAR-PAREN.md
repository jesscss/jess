# `$(…)` — keep it, drop it, or narrow it

> **PROVENANCE — counts and grammar citations are against `1d4b66d16`, not `dev`.**
> Written 2026-07-24 and landed unchanged. Its line references point into
> `packages/{css,less,scss,jess}-parser/src/ast/grammar.ts`, which the host-mode
> fold deleted — each dialect now has a single `src/grammar.ts` — and into
> `packages/internal-css-recognition/`, renamed to `@jesscss/parser-shared` at
> `a74131e8f`. Re-derive any citation before relying on it.
>
> The QUESTION is still live and is why this is kept: P13 settles that the three
> `$` forms are chosen by position, not whether the third form earns its place.

Status: **EXPLORATION. Nothing here is decided.** This document puts counts and
grammar citations under a question the owner raised — whether `$(…)` could be
replaced by a plain `(…)` expression boundary, the way Less does it — so the call
is made on evidence rather than on how the three forms feel.

Ledger context: **P13** (three `$` sigil forms, chosen by position) is SETTLED and
landed. Nothing here proposes changing `${…}` or `$[…]`. It only asks whether the
third form earns its place.

Consistent with `docs/jess/02-Language/08-interpolation.mdx`,
`docs/jess/02-Language/03-expressions.mdx`, `COLLECTION-VALUE-KEYS.md`, and
`DESIGN-DECISIONS.md` rows **P13** and **Z3**.

---

## 1. The finding that reframes the whole question

**`$(…)` and `(…)` already produce the same node and already open the same math
context. The only thing the `$` does is suppress the parens on output.**

`packages/core/src/ast/nodes.ts:1088-1090`:

```ts
export const boundaryBlock = (inner: ValueSlot): Block =>
  ({ type: 'Block', inner, delimiter: 'paren', boundary: true });
```

`packages/jess-parser/src/ast/grammar.ts:1336-1345` reduces `$( … )` to exactly
that, with the production's own comment stating the intent: *"`$()` is the
explicit arithmetic boundary. Preserve that execution fact in the canonical value
graph so division operates under parens-division."*

And at eval, `packages/core/src/ast/serialize.ts:2467-2477`:

- `parenDepth` is incremented for **any** `Block` with `delimiter: 'paren'` — the
  `boundary` flag is not consulted;
- **then** `if (node.boundary) return inner;` returns the inner value *without
  emitting the delimiters*.

So `$(4px / 2)` → `2px` and `(4px / 2)` → `(2px)`. Same arithmetic. Different
output bytes.

This changes what the options are. **Option 2 is not "move the math boundary to
plain parens" — plain parens are already the math boundary.** It is "stop
suppressing the delimiters, and give up the ability to emit a literal paren."
That is a much narrower change than the framing suggested, and it relocates the
real cost.

---

## 2. What `$(…)` does today — four jobs

| # | Job | Evidence |
|---|---|---|
| 1 | Groups an arithmetic/comparison tree into one boundary `Block` | `jess-parser/src/ast/grammar.ts:1336-1345`; CST twin at `src/grammar.ts:165-166` |
| 2 | **Opens the math context** — `/` is division inside, a structural slash list outside | `serialize.ts:2505-2509`; `03-expressions.mdx:90`; `ast-grammar.test.ts:2572` (`$(4px / 2)` → `2px`) |
| 3 | **Suppresses the delimiters** — `$(foo)` → `foo`, but `$((foo))` → `(foo)` | `serialize.ts:2473-2477`; `ast-grammar.test.ts:2568,2570` |
| 4 | Flips identifier meaning: inside, a bare ident is a **keyword literal**; a variable keeps its `$` | `NOTES.md:271-273`; `03-expressions.mdx:63-68` |
| 5 | Marks "Jess starts here" to a human reader — the owner's stated goal | Owner; `DESIGN-DECISIONS.md` **Z3** |

**Jess math is not always-on.** `mathMode` defaults to `'parens-division'`
(`packages/core/src/context.ts:208`, `packages/core/src/ast/value-eval.ts:233`),
and no Jess plugin or config path overrides it — `packages/jess-plugin-jess/src/`
contains no `mathMode` reference at all. So `$(…)` genuinely *is* what gates
division in Jess, exactly as a bare paren is in Less.

Job 4 is a live trap worth naming: `$(foo)` and `${foo}` look interchangeable and
are not. `$(foo)` splices the **keyword** `foo`; `${foo}` splices the **value of
`$foo`**. `ast-grammar.test.ts:2568` asserts `content: "x$(foo)y"` renders
`"xfooy"` with no `$foo` declared anywhere.

---

## 3. Counts

Method: `grep -rn '\$('` over `*.jess *.mdx *.md *.ts *.less *.txt`, excluding
`node_modules/`, `lib/`, `dist/`, and the Less 4.x shell-script docs
(`docs/less/examples/data-URI.md`, where `$(…)` is bash command substitution).

| Bucket | Count |
|---|---|
| **Total** | **309** |
| Authored `.jess` fixtures | 45 |
| `.test.ts` (Jess source in JS strings) | 67 |
| `docs-content/docs/jess` | 52 |
| `jess-parser/src` (grammar literals, regexes, comments) | 51 |
| remainder (`NOTES.md`, architecture docs, other packages) | ~94 |

### The ratio that decides option 2

All **45** authored `.jess` occurrences are **value position. Zero are inside a
string.** Full list: `packages/fns/test/files/math.jess` (4),
`packages/jess-parser/test/data/variables.jess` (6),
`packages/jess-parser/test/data/imports.jess` (1),
`packages/jess/benchmark/chunk.jess` (33), `packages/jess/test/files/simple.jess` (1).

Across the **entire corpus**, `$(…)` inside a quoted string, a `~"…"` escape, or a
`url()` body occurs at **4 sites**, all in `packages/jess-parser/test/ast-grammar.test.ts`:

| Site | Source | Inner | Is it a real expression? |
|---|---|---|---|
| `:457` | `tone: ~'$($w * 2)'` | `Operation` | **Yes** |
| `:1978` | `content: "tone-$[tone]-$(1 + 2)"` | `Operation` | **Yes** |
| `:1694`, `:1698` | `url($(path))`, `@import url($(path))` | `Keyword 'path'` (asserted `:1704`) | No — keyword splice |
| `:2568` | `content: "x$(foo)y"` → `"xfooy"` | `Keyword 'foo'` | No — keyword splice |

**The "known cost" of option 2 is two test sites, both synthetic, neither in an
authored `.jess` fixture and neither in the docs.** The other two splice a bare
keyword through the expression grammar — a degenerate use nobody writes on purpose.

This is the headline number, and it points the opposite way from the discussion:
expression-in-string is not a widely-used capability being removed. It is a
capability that has never been used outside its own tests.

**Counter-weight.** 52 doc sites and 33 in `benchmark/chunk.jess`. Three docs pages
are structured around the form — `03-expressions.mdx` opens "In Jess, an
`Expression` is always written as `$(`...`)`"; `04-Functions/08-math.md` is entirely
about it; `08-interpolation.mdx`'s three-form table. `chunk.jess` is already exempt
from byte-identity (memory: `benchmark-less-exempt-from-byte-identity`), so it is
churn, not risk.

---

## 4. Grammar facts — is plain `(…)` free?

Read from the grammar, not assumed. Note throughout that **there are two Jess
grammars** — the CST grammar `packages/jess-parser/src/grammar.ts` and the
direct-AST grammar `packages/jess-parser/src/ast/grammar.ts` — and they differ on
this exact question.

### 4a. Direct-AST value position: vacant. CST value position: already occupied — MIXED

`packages/jess-parser/src/ast/grammar.ts:2155`:

```ts
const directJessNonBlockValueAtom = choice(g.DirectJessDollarValue, g.DirectJessExprLambda, g.DirectJessInterpolatedValue, g.DirectJessSelectorCapture, g.DirectJessUrl, g.DirectJessInterpolatedUrl, g.DirectJessCall, g.DirectJessQuoted, g.DirectJessColor, g.DirectJessDimension, g.DirectJessCustomPropertyValue, g.DirectJessKeyword);
```

No bare-paren arm; `DirectJessValueAtom` (`:2156`) adds only `DirectJessCollection`.
Every arm is led by `$`, `@`, `*[`, `url`/ident, quote, `#`, or a digit. So in the
direct-AST grammar `width: (1 + 2)` has **no production** and is a parse error, and
option 2 is a pure *addition* to this `choice`.

**But the CST grammar already has one.** `src/grammar.ts:553` lists `g.Paren` in
the jess value choice, resolving to the composed CSS rule at
`packages/css-parser/src/grammar.ts:719` (`sequence(literal('('), g.parenBody)`).
There, `color: (1 + 2)` parses to a **permissive `Paren` holding a value list** —
`Num 1`, `+` matched by `anyValue`, `Num 2` — not an `Operation`. The CSS grammar
states this is deliberate at `css-parser/src/grammar.ts:268-274`: math folding is
reached "only via `CalcCall` and the calc-nested `calcParen`, never … the general
bare `Paren` (which stays permissive)".

So "plain parens are free to claim" is **true for the direct-AST path and false
for the CST path**, where the slot already holds a deliberately non-math meaning.
Which path is the live production path for a normal compile was not established.

### 4b. Inside `$(…)`, plain `(…)` is ALREADY the grouping boundary — FOR

`packages/jess-parser/src/ast/grammar.ts:1211`, an arm of `DirectJessExpressionAtom`:

```ts
sequence(literal('('), g.DirectJessExpressionCompare, literal(')')),
```

with the production's comment at `:1195`: *"A parenthesized sub-group is the
explicit precedence boundary."*

Jess already says `(` opens an expression — just not at depth 0.

> **Doc discrepancy to fix regardless of the outcome.**
> `docs/jess/04-Functions/08-math.md:53` carries a `:::caution Not yet implemented`
> saying `$(2px * (2 + 1))` is "not accepted by the current parser". The arm at
> `:1211` and the comment at `:1195` say otherwise. This worktree has no
> `node_modules`/`lib`, so I could not execute the parser: **suspected stale
> caution, not proven.** Worth a one-line check.

### 4c. Plain `(…)` is ALREADY the expression boundary in condition position — FOR

`packages/jess-parser/src/ast/grammar.ts:3304-3307`:

```ts
const DirectJessIfCondition = node<GuardNode>(
  'DirectJessIfCondition',
  sequence(literal('('), g.DirectJessIfGuard, literal(')')),
```

`NOTES.md:263-270` records this as settled and deliberate: `$(…)` is *rejected* in
condition position because "a `when` guard / `$if` / `$while` condition's `(…)` IS
the expression, so a `$(…)` wrapper there is an expression-inside-an-expression".
`when ($a > $b)` parses; `when $(a > b)` errors.

Jess therefore **already has two expression boundaries** — `$(…)` in values, `(…)`
in conditions. That is arguably a worse inconsistency than three sigil forms.

### 4d. At-rule preludes — a narrower conflict than expected — AGAINST (mildly)

`packages/jess-parser/src/ast/grammar.ts:2408-2416`:

```ts
const DirectJessMediaVariableExpression = node<Interpolation>(
  'DirectJessMediaVariableExpression',
  sequence(literal('$('), jessDollarName, literal(')')), …
const DirectJessMediaPrelude = node<ValueNode | null>(
  'DirectJessMediaPrelude',
  choice(g.DirectJessMediaVariableExpression, g.DirectJessStaticAtPrelude),
```

`@media $(type)` is the documented dynamic-prelude form (`05-mixins.mdx:527`;
`packages/jess/test/jess/conversion-construct-support.test.ts:211`). The `$` is what
gives arm 1 a disjoint first-set. Strip it and `@media (screen)` is a prefix of both
arms — arm 1 would swallow any single-identifier media feature.

**Important correction to the obvious worry:** the direct-AST prelude grammar does
**not** share the value entry point. `DirectJessStaticValueAtom` (`:2210-2214`),
`DirectJessStaticAtQuery` (`:2329-2335`), `DirectJessSupportsFeature` /
`DirectJessGeneralEnclosed` (`:2513-2547`) are a separate family that never
references `DirectJessValue` / `directJessNonBlockValueAtom`. **Adding a bare-paren
value arm would not touch media, `@supports`, or container preludes at all.** The
only prelude conflict is the single `$(name)` media form above.

And that one is likely temporary: the position matrix landing right now moves at-rule
preludes to `${…}` and rejects `$(…)` there. If it lands, `@media $(type)` becomes
`@media ${type}` and this conflict evaporates before option 2 could be built. Real
today, probably gone tomorrow — but it must not be waved away, since it is the one
place `(` is contested rather than vacant.

### 4e. The one unresolved ambiguity: `DirectJessCall` and a detached `(` — AGAINST

`DirectJessCall` (`ast/grammar.ts:1947-1953`) is **not** wrapped in `noTrivia`,
whereas `DirectJessStaticCall` (`:2244-2248`) deliberately is —
`noTrivia(sequence(g.CssAstSyntaxKeyword, literal('(')))` — with a comment at
`:2234-2237` calling the glue "the whole disambiguation this production needs".

If `DirectJessCall` accepts a *detached* `(`, then `border: solid (1px)` already
parses as a call named `solid`, and adding a bare-paren value arm creates a genuine
ambiguity between "function call" and "keyword followed by paren group". Whether it
does depends on the compile-time trivia parseman freezes into the rule
(`docs/design/parseman-trivia-audit.md:43-60`), which cannot be determined
statically and is not covered by an existing test. **This needs a targeted parse
test before any option-2 design.** The fix, if needed, is the same `noTrivia` glue
`DirectJessStaticCall` already uses.

### 4f. String interiors — the mechanical cost is one character, six times

`ast/grammar.ts:1017-1020`, `src/grammar.ts:180,190`, and
`packages/internal-css-recognition/src/recognition.ts:165-166` all gate string
interiors on `\$(?![\[({])` — "a `$` is literal unless followed by `[`, `(`, or
`{`". Removing `$(` from string interiors is deleting `(` from that class in six
regexes. The cost of option 2 in strings is a **capability** question, not an
implementation-difficulty one.

---

## 5. Less precedent — warning, not model

Two corrections to the framing in the brief.

**First: the math-mode complexity does not live in the parser.**
`grep -rn "mathMode|parensDivision|strictMath" packages/less-parser/src` returns
**nothing**. The Less parser only records a `Block{delimiter:'paren'}`; the mode
lives in core (`packages/core/src/types/modes.ts:6` —
`'always' | 'parens-division' | 'parens' | 'strict'`;
`packages/core/src/tree/util/should-operate.ts:60-70`). Parser cost and math-mode
cost are **decoupled**. Jess already shares that core machinery and already
defaults to `parens-division`, so option 2 would not "acquire" math mode — Jess
has it now.

**Second: the grammar cost of a bare `(` in Less is large and measured.**
`packages/less-parser/src/grammar.ts` needs **five paren productions plus two
mutually-exclusive bodies** to tell value parens from everything else:

| Production | line | discriminator |
|---|---|---|
| `Paren` (value/math) | `933` | `(` at value start or preceded by space → strict `parenBody` (`737`) |
| `GluedParen` (mixin/reference args) | `941` | regex **lookbehind** `(?<=[)\]\w.#…]\|[\w.#…]-)\(` → permissive body (`744`) |
| `escapedParen` `~( … )` | `697` | preceded by `~`; raw list, not math |
| `CondArgParen` | `793-794` | body re-parsed as a full `CondArgOr` |
| `GuardInParens` | `336-340` | `default()` or `'(' GuardOr ')'` |

plus `namespaceAhead` (`734-735`, a lookahead so `(#ns.options[option])` is a
namespace lookup and not arithmetic), and `Call` vs `Paren` decided **purely by
whitespace before `(`** (`917-928`) — one space changes the node type.

The speculation cost is documented in the source itself. `grammar.ts:834-848`, the
`argHasCondAhead` gate, states verbatim that without it every plain call argument
pays a full speculative condition parse and re-parse — *"a double parse of every
call arg; **~25% of parse self-time on real fixtures**"*. The mitigation is itself a
balanced-paren scan.

**So the Less precedent argues against option 2 on grammar cost, not on math
semantics** — the opposite of both the usual "Less already does this" framing and my
own first reading. The critical question is whether Jess would inherit that cost.
On the evidence it would **not**, because Jess's ambiguity sources are absent or
already solved: there is no `~(…)` in Jess at all (§4e agent finding), preludes are
a separate grammar family (§4d), and mixin/lambda/guard parens are all reached only
after a required non-`(` token. The **one** exception is §4e, which is exactly the
`Call`-vs-`Paren` whitespace ambiguity that costs Less the most.

---

## 6. The options

### Option 1 — status quo, keep `$(…)`

**Costs.** Three sigil forms to teach. Two expression boundaries in the language
(§4c), an inconsistency that will keep generating "why doesn't `when $(a > b)`
work?" — `NOTES.md:263` shows the docs already got this wrong once. The outermost
grouping bracket is spelled differently from every inner one (§4b).

**Buys.** Job 3 (§2): the ability to write an expression whose parens *do not*
appear in output. Zero migration. Z3 separability holds in value position.
Expression-in-string keeps working (2 sites). Avoids §4e entirely.

**Impossible to express.** Nothing new.

### Option 2 — drop `$(…)`; plain `(…)` is the expression boundary

**What actually changes.** Not the math (§1). The change is that **the parens now
print**. `width: (1 + 2)` would emit `3` only if the new arm builds a *boundary*
block; if it builds an ordinary paren block it emits `(3)`.

That fork is the whole design:

- **Build it as a boundary block** → output matches today's `$(…)`, but a literal
  `(foo)` in emitted CSS becomes **inexpressible in value position**, and `(`
  then means "boundary" at depth 0 and "literal group" at depth ≥1
  (`ast-grammar.test.ts:2570` asserts `$((foo))` → `(foo)`). Two meanings for one
  bracket, selected by depth — which is Less's problem in miniature.
- **Build it as an ordinary paren block** → `(1 + 2)` emits `(3)`, and there is no
  spelling at all for "compute this and don't print parens". This silently changes
  output for all 45 `.jess` fixture sites.

Neither branch is free, and **this fork is the most important thing option 2 has to
answer.** It was invisible before §1.

**Other costs.**
- Expression interpolation in strings loses its spelling (`${…}` takes a name, by
  P13 design). **Measured: 2 synthetic test sites** (§3). Workaround is
  bind-then-splice — arguably better style, but forced, and it makes the only
  string-position computation impossible rather than discouraged.
- §4e must be settled with a parse test first.
- §4d must land (it probably will anyway).
- The CST grammar's existing permissive `Paren` (§4a) means the two grammars would
  disagree about what `(1 + 2)` means until reconciled.
- Job 4 (bare ident = keyword) attaches to `(`, a much quieter marker.
  `width: (red)` is less legible than `$(red)`.
- 52 doc sites; three pages restructured.

**Buys.** Two forms instead of three. One expression boundary instead of two (§4c).
Depth-0 and depth-N agree *if* the first fork branch is chosen (§4b). No new node
type. `.jess` corpus cost is 45 mechanical edits, all value position. Media /
`@supports` / container preludes are untouched (§4d).

**Impossible to express.** Expression-in-string; and — depending on the fork —
either literal parens in a value, or paren-free computed output.

### Option 3 — drop `$(…)` in value position only, keep it for strings

**Costs.** Does not reduce the form count. `$(…)` still has to be taught, now with
a positional restriction *inverse* to `$[…]`'s and `${…}`'s. The P13 table is
readable today because each form has one role; this makes `$(…)` "the string one"
while job 2 lives on `(…)`. Two spellings for one concept split by position is the
hardest rule to remember. Also inherits option 2's output fork **and** keeps
option 1's teaching cost.

**Buys.** Preserves the 2 string sites.

**Assessment.** Least benefit per unit of complexity of any option. Full teaching
cost of three forms retained to protect two synthetic test sites. On the evidence
this is the weakest option.

### Option 4 — keep `$(…)`; accept `(…)` as an alias in value position

**Costs.** Two spellings for one thing. The repo's own `COLLECTION-VALUE-KEYS.md`
rejects exactly this shape of decision ("if `$["foo"]` resolved differently from
`$[foo]`, no author could predict a lookup"). Inherits §4e without the
compensating simplification, and the output fork becomes *visible*: `$(1+2)` → `3`
but `(1+2)` → `(3)`, two spellings that differ only in output.

**Buys.** Nothing breaks; `when $(a > b)` could start working.

**Assessment.** Worse than 1 and 2. Recorded for completeness.

### Option 5 — keep `$(…)`; give `${…}` an expression body inside strings only

Attacks option 2's real cost rather than the syntax. `${…}`'s body is a name by
deliberate P13 design; if it took an expression *only inside string interiors*,
option 2's single genuine casualty disappears: `"w: ${1 + 2}px"`.

**Costs.** Contradicts P13's stated rationale — "an interpolation position stays a
splice point rather than turning into a place to compute"
(`08-interpolation.mdx:16-19`). Position-dependent body grammar for one form.

**Buys.** Makes option 2 lossless in strings.

**Assessment.** Worth considering only as a **rider on option 2**, and only if the
owner decides string-position computation must be preserved. Standalone it is
strictly worse than option 1.

---

## 7. The values call

Two of the repo's own settled positions are in direct tension. This part is not
resolvable by evidence.

**Position A — `DESIGN-DECISIONS.md` row Z3.** The CSSWG pact commits Jess to
*"Keep every build-time construct inside the reserved sigil, so a stylesheet's CSS
surface and its tooling surface are lexically separable"*, and names `$(…)`
explicitly in the reserved shape list. Option 2 spends a construct out of that
namespace and weakens the petition's own good-faith argument.

**Position B — internal consistency.** §4b and §4c show Jess *already* uses plain
`(…)` as an expression boundary in two of the three places it could — everywhere
except depth 0 of a value. The `$` on `$(…)` is not the rule; it is the exception.

**Z3's premise is already imperfect, by settled decision, independently of this
question:**

- `when ($a > $b)` — a build-time construct, no `$` on the boundary (§4c).
- `width: $w + 1;` — the settled "unwrapped leading-`$var` arithmetic"
  (`NOTES.md`, *Settled syntax decisions*; `03-expressions.mdx:76-90`). The
  *expression* is not enclosed in a sigil at all; only its first operand is.

So the choice is not "preserve separability vs. lose it". It is **"hold a line that
already has two settled exceptions, or stop holding it."** That is the owner's call,
and it should be resolved as a Z3 amendment either way, not silently.

---

## 8. What the evidence settles, and what it doesn't

**Settled by the evidence:**

- **`$(…)` does not carry distinct math semantics.** A plain paren already
  increments `parenDepth` (§1). The brief's worry that "dropping it moves math
  behaviour" is **not borne out** — what moves is *output*, via the `boundary`
  flag. This is the single most important correction here.
- The string-interpolation cost of dropping `$(…)` is **2 sites, both synthetic**
  (§3). Any argument weighting this heavily is unsupported by the corpus.
- **Option 3 is the weakest option** (§6).
- Plain `(…)` in **direct-AST** value position is unclaimed (§4a); it is already
  the boundary at depth ≥1 (§4b) and in conditions (§4c). In the **CST** grammar it
  is already claimed with a deliberately non-math meaning (§4a) — the two grammars
  disagree, and that must be reconciled by any option-2 work.
- Media / `@supports` / container preludes are a **separate grammar family** and
  would not be affected (§4d). The only prelude conflict is `@media $(name)`, and
  the in-flight `${…}` prelude migration removes it.
- Less's bare paren costs it **five paren productions, two bodies, a lookbehind
  regex, and a documented ~25% of parse self-time** in speculation it has to gate
  away (§5). Jess would likely not inherit this — with the §4e exception.

**Not settled — needs a parse test, not more reading:**

- **§4e**: does `DirectJessCall` accept a detached `(`? If yes, `border: solid (1px)`
  is already ambiguous and option 2 has a real grammar conflict. This is the single
  blocking unknown and it is cheap to answer.
- Whether `04-Functions/08-math.md:53`'s "not yet implemented" caution is stale (§4b).
- Which grammar (CST vs direct-AST) is the live production path (§4a).

**A values call, not a technical one:** Z3's separability commitment — already
holding with two exceptions — against the language's internal consistency. Both are
legitimate. The evidence narrows option 2's cost substantially but does not decide
this, and I will not pretend it does.

**If forced to characterise the balance:** the evidence removes most of the
*asserted* costs of option 2 (math semantics don't move; strings barely matter;
preludes are untouched) and replaces them with one cost nobody had named — the
`boundary`-flag output fork in §6 — plus one cheap unknown (§4e). Whether that
trade is worth making still turns on Z3, which is a values question.

---

## 9. Worth doing regardless of the outcome

1. **Fix the `$(…)`-vs-`(…)` inconsistency in the docs.** `03-expressions.mdx:9`
   says an Expression "is always written as `$(`...`)`", which is false in two
   documented positions (§4b, §4c) and in the settled unwrapped-arithmetic form.
   That sentence, not the form count, is what makes the language feel arbitrary.
2. **Name the jobs in §2 in the docs.** `$(…)` is taught as "expression /
   grouping". It is also the math-context marker, the delimiter-suppressor, and the
   keyword-mode marker — and `$(foo)` ≠ `${foo}` is a live trap
   (`ast-grammar.test.ts:2568`) that no page mentions.
3. **Answer §4e with a parse test.** It is a blocking unknown for option 2 and a
   latent ambiguity report for option 1.
