# External CSS parse corpus

An externally-sourced, parse-only CSS corpus, measured against all four dialect
grammars.

## Why

jess's CSS fixture set was 24 of the 30 cases from `postcss-parser-tests`,
copied in verbatim, plus a hand-written error directory. Coverage was therefore
whatever the last fixture author happened to think of, and the hole that made
the point was `@keyframes`: the suite carried **four** `@keyframes` fixtures and
every one of them was a *reject* case. Nothing asserted that `0% { … }` is
accepted. A grammar that rejected every percentage keyframe selector passed the
entire suite — all four reject fixtures would still have rejected, for the wrong
reason.

Reject coverage without accept coverage cannot tell "rejects what it should"
from "rejects everything". A corpus chosen by somebody outside this repo cannot
have that particular blind spot, because nobody here chose its contents.

## What is here

| file | what |
| --- | --- |
| `corpus.test.ts` | the measuring test — asserts corpus integrity, reports pass rates, **gates nothing** |
| `baseline.json` | the numbers as measured at `d948e2d75` on parseman 0.46.0, 2026-07-31 |
| `wpt-accept.json` | 17,421 vendored accept vectors extracted from web-platform-tests |
| `LICENSE.wpt.md` | web-platform-tests' BSD-3-Clause licence, verbatim — a redistribution condition, not a courtesy |
| `../dialects.ts` | the one parse verdict, spelled identically for all four dialects |
| `../../scripts/materialize-css-corpus.mjs` | assembles the manifest, and **asserts every source's entry count** |
| `../../scripts/css-corpus-report.mjs` | the full sweep with per-bucket triage |
| `../../scripts/extract-wpt-vectors.mjs` | regenerates `wpt-accept.json` from a WPT checkout |

```
node scripts/materialize-css-corpus.mjs    # -> .cache/css-corpus/manifest.json
pnpm css-corpus:report                     # full sweep + triage (needs built parsers)
npx vitest --run test/css-corpus           # the measuring test (runs against src)
```

## Sources: evaluated, licensed, adopted or not

### Adopted

**csstree** — `github:csstree/csstree#v3.2.1`, MIT, dev dependency (no
vendoring). Its `fixtures/ast` tree is 935 named cases organised by grammar
production, carrying both accepting cases and 215 dedicated error cases. It is
the only evaluated source with a usable **reject** oracle at the syntax layer.
The registry tarball ships `lib` only, so the dependency must resolve to the
GitHub source; the materializer fails loudly if `fixtures/` is absent.

Two exclusions, both about csstree being a *recovering* parser:

- the three `tolerant.json` files (27 cases) are csstree's error-recovery suite —
  `boom! {color:red}` does not throw, it parses the prelude into a `Raw` node;
- **recovery is not confined to those files.** 90 of the 694 remaining accepting
  cases carry a `Raw` node in their expected AST (`a{foo: boom!;}`, `a{ foo }`,
  `@media (foo:1`, `a{color:foo( 123`). csstree not throwing is not a claim that
  the input is valid CSS, and importing those as `accept` would both overstate
  jess's gap by 90 and pressure the grammar toward csstree's recovery policy.

Foreign ASTs are never translated. The expected tree is read for exactly one
bit — did the upstream parser recover — and nothing else crosses over. jess's
own byte-identity oracle owns tree shape.

**web-platform-tests** — commit `3b4663dbe`, **BSD-3-Clause**, vendored as
`wpt-accept.json` (WPT is not an npm package and a full clone is ~2 GB).
17,421 accept vectors, mechanically extracted from the 795 files that include
`css/support/parsing-testcommon.js`, by running each file's inline scripts in a
Node `vm` with the helpers stubbed as recorders — 939 of 963 files (97.5%)
executed cleanly, no browser needed.

Redistribution conditions, all met here: the licence text travels with the data
(`LICENSE.wpt.md`), the upstream commit is recorded in the JSON, and the
`notice` field states that jess is **not endorsed** by web-platform-tests or the
W3C. The corpus stays BSD-3-Clause; the rest of the repo stays MIT.

WPT's 8,903 **reject** vectors are deliberately excluded. `test_invalid_value`
asserts that the CSSOM refuses to *store* a declaration — a property-grammar
question, not a syntax one. A structural balance check found 8,871 of them
(99.6%) to be perfectly well-formed CSS: `color: #00000`, `color: #0000fg`,
`::checkmark::checkmark`. jess's parser accepts **shapes, not semantics** —
validity belongs to the language service — so importing them would encode ~8,871
wrong expectations. They are worth revisiting *for the language service*.

**Real-world stylesheets** — `normalize.css` (MIT) and seven `bootstrap` (MIT)
dist bundles, dev dependencies, no vendoring. Eight entries, but they carry the
adversarial *size* that hand-written fixtures never do: bootstrap's bundle is
~280 KB of CSS that real sites ship.

### Evaluated and not adopted

**postcss-parser-tests** — 8.9.0, MIT, ~105 KB. **Already adopted, and it is the
cause of the gap.** 24 of its 30 cases sit verbatim in
`packages/syntax/css/css-parser/test/css/` — jess's CSS fixture set *is*
postcss-parser-tests, which is why it has no `@keyframes` accept case. Adding
the dependency would contribute ~6 new inputs and three *conflicting*
expectations: postcss is a tolerant parser, so its verdict is "postcss did not
throw", and jess deliberately files three of those same cases under
`test/css/errors/`.

**csswg-drafts** — **W3C Software and Document License — 2023**, not MIT. 156
`.bs` files, 13.6 MB of spec text. Redistribution *is* permitted, including of
extracted portions, but on three conditions that must travel with the data: the
full W3C notice, any pre-existing IPR notices, and a per-vector statement of the
source document and modification. The corpus would have to live in its own
carved-out, W3C-licensed directory.

Mechanically extractable: 2,458 candidate blocks, of which only 1,041 (42.4%)
survive as accept vectors — 271 are prose-flagged as invalid, 335 pass every
textual heuristic and still fail a real parser (spec pseudo-code like
`co = Cs x αs + Cb x αb x (1 - αs)` sits in bare `<pre>` inside example divs,
indistinguishable from CSS by markup alone). Median vector 107 bytes. There is
**no mineable reject oracle**: in CSS, "invalid" almost always means invalid at
computed-value time, which parses fine.

Not adopted here because the accept verdicts are attested by *css-tree*, not by
the spec — so the corpus would silently inherit css-tree's mistakes, including
~30 known false negatives on exactly the bleeding-edge constructs (`@scope`,
`anchored()`, `font-tech()`) that make it interesting. Its unique value is
breadth across 110 specs; WPT covers the same ground with per-vector verdicts
from a real conformance suite and a simpler licence. Revisit if the WPT breadth
proves insufficient.

**WPT `css/css-syntax/`** — 75 files, of which 43 are the `charset/`
subdirectory (needs real HTTP header plumbing). The remaining 23 non-charset
tests (`unclosed-constructs.html`, `escaped-eof.html`, `cdc-vs-ident-tokens.html`,
`custom-property-rule-ambiguity.html`, …) are the only genuine tokenizer and
error-recovery oracle in WPT, and are **not** mechanically extractable — each is
bespoke assertions over `sheet.rules[0].cssRules[0].selectorText`. 23 is a
tractable hand-port and is the single highest-value follow-up here.

**WPT `.css` support files** — 390 files, 367 of them reftest scaffolding,
median size 42 bytes, 67 KB total. `a-green.css` is `.a { color: green; }`. Not
a corpus.

## Baseline — 18,245 entries, at `d948e2d75` (parseman 0.46.0)

Verdict is `ok && unconsumedFrom === null && errors.length === 0`. `ok` alone is
not it (parseman reports `ok` for a run that consumed *nothing*), and
`span.end === source.length` is not it either (whether the root span covers
trailing trivia is a per-dialect convention, and it differs on two of four).

| dialect | correct | rate | false-reject | false-accept | reducer crashes |
| --- | ---: | ---: | ---: | ---: | ---: |
| css | 17,748 | 97.28% | 426 | 71 | 3 |
| less | 17,952 | 98.39% | 254 | 39 | 0 |
| scss | 17,889 | 98.05% | 300 | 56 | 10 |
| jess | 17,656 | 96.77% | 558 | 31 | 0 |

**255 superset violations** — inputs `css` rejects that `less`, `scss` or `jess`
accepts. The standing ruling is one-way: `css` is the base, so every one of
these is a defect in the base grammar, not a dialect feature.

### Triage — false-rejects by bucket

Buckets are a **text classifier over the failing input**, first match wins. They
say what the failing sources are *about*; they do not by themselves prove cause.
The verified minimal repros are the table after this one.

| bucket | css (426) | less (254) | scss (300) | jess (558) |
| --- | ---: | ---: | ---: | ---: |
| calc / math fn | 118 | — | — | 123 |
| grid template | 99 | 20 | 20 | 99 |
| other | 80 | 65 | 95 | 104 |
| url() | 34 | 34 | 37 | 39 |
| dimension / number | 33 | 31 | 45 | 70 |
| @media | 14 | 18 | 14 | 23 |
| string value | 10 | 10 | 12 | 14 |
| functional pseudo | 7 | 19 | 14 | 18 |
| attribute selector | 5 | 10 | 9 | — |
| escape sequence | — | 15 | 9 | 9 |

`less` and `scss` score *better* than `css` overall precisely because they
already accept the two constructs at the head of the `css` list.

### Verified minimal repros

Each row was re-parsed in all four dialects. "accepts" is the exact set.

| repro | accepts | reading |
| --- | --- | --- |
| `a{color:rgb( 1 , 2 , 3 )}` | less | **whitespace before a comma in an argument list.** `rgb(1, 2, 3)` parses in all four. Three of four dialects reject a form every browser accepts. |
| `a{width:calc(min(1em - 2px))}` | less, scss | **a math expression inside a math function nested in `calc()`.** `min(1em - 2px)` on its own parses in css/less/scss. |
| `a{width:min(1em - 2px)}` | css, less, scss | jess alone rejects a bare math function containing an expression. |
| `a{grid:[a] 10px}`, `a{color:[foo]}` | less, scss | **grid line names in value position** (css-grid-1 `<line-names>`). |
| `[xlink\|href]{color:red}`, `\|E{color:red}` | less | **namespace selectors** (css-namespaces-3). `*\|E` is accepted by css and less only. |
| `a{background-image:url("x.png" cross-origin(anonymous))}` | *none* | `<url-modifier>` (css-values-5). A uniform gap, not a superset violation. |
| `a{top:--func()}` | *none* — **css crashes** | dashed functions (css-mixins-1). |
| `:has(){color:red}`, `:is(){color:red}` | *none* — **scss crashes** | empty forgiving selector list. |
| `a{color:()}` | scss — **css crashes** | an empty paren group. |

The first two rows plus grid line names account for the large `calc / math fn`
and `grid template` buckets, and all three are also **superset violations**:
`less` and `scss` accept today what the base rejects.

One bucket member that is *not* a defect: `@media (1 < 2 < 3)` is rejected by all
four. csstree accepts it structurally, but css-mediaqueries-4's two-sided
`<mf-range>` requires the feature name in the middle — `@media (200px < width <
400px)` parses in all four.

### The 71 `css` false-accepts are mostly not defects

64 of 71 are csstree enforcing *semantics* the parser is not supposed to
enforce: `:nth-child(xxx)`, `:nth-child(3nn)`, `a{color:20.}`, `u+123456z`,
`:dir(1)`, `:host(foo,bar)`. Under the standing ruling that the parser accepts
shapes and the language service decides validity, jess accepting these is
correct and csstree is simply a stricter tool. They are left in the corpus and
counted, because the count is a real measure of where the two tools disagree —
but they are not a defect list.

**7 of 71 are real.** All seven are an unbalanced `{` swallowed inside a
pseudo-function's argument scan:

```
:-moz-any(.a{){color:red}      :host(.a{){color:red}
:-webkit-any(.a{){color:red}   ::slotted(.a{){color:red}
:host-context(.a{){color:red}
```

### 13 reducer crashes — a different kind of defect

Thirteen inputs make a grammar reducer throw an **internal `Error`**, not the
`SyntaxError` the public `parse()` contract promises. This is not a recognition
gap and it must not be summed with one:

| dialect | input | message |
| --- | --- | --- |
| css | `a{color:()}` | `CSS AST value grammar lost its value child` |
| css | `a{color:expression(())}` | same |
| css | `a{color:expression(()())}` | same |
| scss | `:has(){color:red}`, `::slotted(*):is(){}`, `::slotted(*):where(){}` | `SCSS grammar produced a non-selector-list child.` |
| scss | `a{color:[foo bar]}`, 6 × `grid-template-*` with `[line names]` | `SCSS grammar produced a non-value child.` |

## Gating recommendation

Not now, and not on a percentage.

1. **Gate reducer crashes at zero, first.** Thirteen today, a crisp contract
   ("`parse()` throws `SyntaxError` or returns"), and no judgement calls. This
   is the one gate worth wiring as soon as the thirteen are fixed.
2. **Then gate superset violations at zero.** 255 today, and the ruling behind
   them is already settled — `css` is the base, one-way. Two constructs
   (`calc()`-nested math, grid line names) are 77% of them.
3. **Then ratchet the `css` false-reject count downward**, absolute and
   per-dialect, never as a percentage — a percentage moves when the corpus
   grows and hides which construct regressed.
4. **Never ratchet false-accepts against csstree.** 64 of 71 are csstree
   enforcing semantics jess deliberately defers to the language service.
   Gating there would be gating jess to another tool's strictness model.

The two follow-ups worth their cost, in order: hand-port the 23 non-charset
`css/css-syntax/` WPT tests (the only real tokenizer oracle anywhere in the
evaluated set), and revisit WPT's 8,903 reject vectors **for the language
service**, where they are exactly the right corpus.
