# Parseman combinator cheat sheet

**Reflects parseman 0.36.0.** Derived 2026-07-25 by enumerating
`src/index.ts` in the parseman checkout at `/Users/matthew/git/oss/parser-thing`
(`package.json` version `0.36.0`), not from memory and not from prose. Every
non-obvious claim carries a `file:line` into that checkout. Behavioural claims
marked **[probed]** were executed against `src/` via `tsx`, not inferred.

## Honesty note — read this before you trust anything below

This is a **convenience copy**. Parseman's own docs and source are authoritative:
`docs/guide/combinators.md`, `docs/guide/first-char-gating.md`, and `AGENTS.md` in
the parseman repo. Every example in `combinators.md` is executed by
`scripts/verify-doc-examples.mjs`; nothing in *this* file is executed by anything.

**A stale cheat sheet is worse than no cheat sheet**, because it will be trusted.
Parseman is pre-1.0 and its minors carry breaking changes — 0.34.0 alone changed
what `keywords({ caseInsensitive })` matches and what `not()` leaves behind.
When the pin moves, **re-derive this file from `src/index.ts`**; do not patch it
from a changelog. If you cannot re-derive it, delete it.

This repo currently pins **parseman 0.32.0**
(`node_modules/parseman/package.json`). Sections 1–3 describe **0.36.0**, which is
*not* what this repo runs today. `docs/architecture/parser/PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md`
is the doc that describes the pinned version, and it stays authoritative for
anything you are about to write against the current pin.

---

## 1. The export surface

Enumerated from `src/index.ts:1-105`. 81 runtime exports. Everything below is
exported; nothing below is described that is not.

### 1.1 Terminals

| Export | What it does | Minimal example |
| --- | --- | --- |
| `literal(s, opts?)` | Exact string match. **No word boundary.** `opts.caseInsensitive` folds ASCII letters only (`literal.ts:6-22`) | `literal('=>')` matches `'=> x'` |
| `regex(pattern, flags?)` | Sticky (`/…/y`) match at the current position (`regex.ts:114-118`) | `regex(/[0-9]+/)` matches `'42'` in `'42px'` |
| `word(s, boundary?, opts?)` | One keyword + a trailing boundary guard. Default boundary `_0-9A-Za-z` (`keywords.ts:40`). Sugar for `keywords([s], …)` (`keywords.ts:42`) | `word('if')` rejects `'ifdef'` |
| `keywords(words, opts?)` | One of many, longest-first, one sticky regex (`keywords.ts:78-98`) | `keywords(['bord','border'])` yields `'border'` |
| `makeWord(boundary?)` | Definition-time factory fixing the boundary class (`keywords.ts:57`) | `const cssKw = makeWord('A-Za-z0-9_-')` |

### 1.2 Sequencing and choice

| Export | What it does | Minimal example |
| --- | --- | --- |
| `sequence(...c)` | All in order, returns a tuple. Skips ambient trivia between terms | `sequence(regex(/[a-z]+/), literal('='), regex(/[0-9]+/))` |
| `choice(...arms)` | Ordered PEG alternatives, first match wins. An arm may be `{ gate, combinator }` (`choice.ts:18-19`) | `choice(literal('in'), literal('instanceof'))` |
| `attempt(c)` | All-or-nothing arm: restores capture/trivia/error sinks on failure (`attempt.ts:6-9`) | `choice(attempt(callShape), bareIdent)` |

### 1.3 Repetition

One family, four names. `oneOrMore(x)` **is** `many(x, { min: 1 })` and
`oneOrMoreSep(i, s)` **is** `sepBy(i, s, { min: 1 })` — the same combinator, routed
at `repeat.ts:110-112` and `repeat.ts:291`.

| | nullable (min 0) | non-empty (min 1) |
| --- | --- | --- |
| plain | `many(item, opts?)` `repeat.ts:105` | `oneOrMore(item, opts?)` `repeat.ts:172` |
| separated | `sepBy(item, sep, opts?)` `repeat.ts:321` | `oneOrMoreSep(item, sep, opts?)` `repeat.ts:290` |

- `optional(c)` — zero or one, returns `null`, never fails (`repeat.ts:251`).
- `{ min, max }` count **items**, not separators. A bad bound throws at
  *construction*, not at parse time (`repeat.ts:82-91`).
- `{ trailing: 'forbid' | 'allow' | 'require' }`, separated forms only, default
  `'forbid'` — the trailing separator is left for the enclosing rule
  (`repeat.ts:294-307`).
- `min >= 1` is the thing that makes a repeat **non-nullable**, which is what lets
  an arm led by it keep first-char dispatch (`repeat.ts:70-77`).

### 1.4 Lookahead and negation

Both are zero-width.

- `not(c)` — negative (PEG `!X`). First-set is `any`: it cannot know what it
  forbids. **Trailing boundary only.**
- `peek(c)` — positive (PEG `&X`). **Carries the body's first-set**, so a *leading*
  `peek()` narrows an arm instead of poisoning it (`peek.ts:8-28`). A nullable body
  constrains nothing and reports `any` (`peek.ts:23-27`).

```ts
sequence(peek(regex(/[.#]/)), broadBody)   // still first-char-dispatches
```

### 1.5 Trivia

- `trivia(c)` — mark a combinator as skippable filler (`map.ts:35`).
- `noTrivia(c)` — run `c` with active trivia cleared; terms must be contiguous.
- `parser({ trivia }, root)` — turn on auto-skipping between sequence terms.
- `rules({ trivia, scanSkip }, factory)` — grammar-wide. **Options go FIRST** when
  they configure a scope, LAST when they modify one combinator (`AGENTS.md:105-120`).

### 1.6 Nodes, fields, builders

| Export | What it does |
| --- | --- |
| `node(c, build?, opts?)` / `node(type, c, build?, opts?)` | The tree-building rule. Captures terminals + trivia and hands the build callback **CST leaves with spans**, not bare strings (`node.ts:71-72`). Inside `rules()` the type is inferred from the rule key; outside it, an inferred type throws (`node.ts:67-69`) |
| `NodeOptions` | `{ unwrap?, collapse?, captureTrivia?, trailingTrivia? }` (`node.ts:50`) |
| `field(name, c)` | Capture a named value+span for the nearest enclosing `node()`. Repeated names become arrays. Parse behaviour unchanged (`map.ts:71-83`) |
| `label(name, c)` | Metadata only; changes the reported `expected` on failure (`map.ts:54-64`) |
| `transform(c, fn)` | Map a value: `fn(value, span)` (`map.ts:4`) |
| `skip(main, skipped)` | Match both, return `main`'s value, span spans both (`map.ts:20`) |
| `token(c)` | Contiguous region with trivia disabled; returns matched **source text**, one CST leaf, inner leaves suppressed (`token.ts:6-11`) |
| `leaf(c, reducer)` | One *semantic* leaf; unlike `token` it does **not** touch trivia |
| `cstBuildHost(opts?)` | Ready-made `build` host producing the default CST shape |

### 1.7 Recursion and running

`ref<T>()` (low-level forward slot; using it before `.define()` throws),
`rules(factory)` (named mutually-recursive bundle — prefer this),
`parse(c, input, opts?)`, `parser(opts, root)`, `compile(c, …, opts?)`,
`run(runnable, input, opts?)`, `parseDoc(…)` (incremental re-parse over a rules
registry, `functional/doc.ts:1-3`).

**Shipping note (0.35.0):** import the driver from `parseman/run` — a 3-module,
7.2 kB closure — not from the main entry (349.6 kB). This is what put `parseman`
in a published parser's `peerDependencies`.

### 1.8 Gating and context

- `gate(predicate)` — zero-width state **ASSERT** on `ctx.state`; first-set is
  `any`, so never lead an arm with it (`gate.ts:3-22`).
- `choice({ gate, combinator }, …)` — the arm **field**: **SELECT** a branch. Keeps
  the arm's own first-set. Arm field = select; `gate()` = assert.
- `guard(...)` — deprecated alias for `gate` (`index.ts:56-57`).
- `withCtx(extra, c)` — merge into `ctx.state` for the duration of `c`.
- `analyzeGating(entry, opts?)`, `analyzeGatingRules(ruleMap, opts?)`,
  `formatGatingWarnings(report)`, `firstSetToString(fs)`.
- Anti-pattern kinds the diagnostic reports: `'double-not' | 'leading-not' |
  'keyword-regex'` (`analysis/gating.ts:74-76`).
- A choice ungated *solely* by unresolved cross-artifact holes is `deferred` —
  silent at the shape, excluded from the `'error'` gate
  (`analysis/gating.ts:115, 161, 445-449`).

### 1.9 Error recovery

`expect(c, label?)` (required token: records a `ParseError` in place and keeps
parsing), `isParseError(v)`, `completionsAt(target, input, offset)`.

### 1.10 Scanning

- `scanTo(sentinel, opts?)` — forward until `sentinel` matches, sentinel **not**
  consumed. Skips ambient trivia **and** ambient `scanSkip` by default (0.33.0).
- `balanced(open, close, opts?)` — one balanced region **including** delimiters,
  counting nested pairs. Consults ambient `scanSkip` only, **not** trivia.
- Per-call opts: `skip: [...]` **extends** the ambient set; `raw: true` opts out of
  all ambient skipping; `orEOF: true` (`scanTo` only).
- The sentinel is checked **before** any skipper.
- Both have `any` first-sets by nature — an arm led by either will not gate.

### 1.11 Composition

- `compose([...])` — fuse independently-compiled grammars into one scope so a
  dialect can override a base's rules. **May carry semantic builders**: callbacks
  travel as captured source (`fnSrc`/`buildSrc`, `ir-serialize.ts:15-18`).
- `composeLeaf([...])` — terminal form; the result cannot be composed again
  (`linker.ts:550`). Runtime composition is **forbidden** — macro lowering only
  (`linker.ts:579-583`).
- `pick()` is deliberately **not** exported (`index.ts:44-48`).

### 1.12 CST / offset / span utilities (not combinators)

`walk`, `createVisitor`, `buildTriviaIndex`, `triviaEntries`, `triviaKindMask`,
`buildLineIndex`, `offsetToLineCol`, `annotateSpan`, and the offset model —
`OffsetIndex`, `buildOffsetIndex`, `collectLeafSlots`, `gapText`, `lineBreaksIn`,
`blankLinesIn`, `lineStartWithin`, `indentWidth`, `indentMixed`, `commentsIn`,
`gapIsSignificant` — plus the relative-span set `relativize`, `absolutize`,
`absoluteSpanAt`, `shiftAbsolute`, `applyEdit`, `relativizeCST`, `absolutizeCST`,
`absoluteSpanCST`.

The offset model is the piece worth knowing about: trivia is **not stored**. A leaf
token's span is a "slot"; trivia lives in the gaps between consecutive slots and is
reconstructed by subtraction and by slicing the source (`cst/offset-model.ts:1-24`).
See §5 — this is parseman's actual answer to byte-faithful layout replay.

### 1.13 Coverage / observability

`GRAMMAR_COVERAGE_DEFINITIONS`, `grammarCoverageDefinitions`,
`compiledGrammarCoverageDefinitions`, `composedGrammarCoverageDefinitions`,
`createGrammarCoverageCollector`, `createGrammarInstrumentationContext`,
`createGrammarTraceSink`, `runWithGrammarCoverage`.

---

## 2. Choosing between similar — the section that prevents hand-rolling

Ported from `docs/guide/combinators.md:800-948`, checked against source. The wrong
pick usually still *works*; it silently loses first-char dispatch, and sometimes
(§4.3) it changes what the grammar matches.

### 2.1 Recognizing a keyword — `word` vs `literal` vs `regex`

| Use | When | First-set | Gating |
| --- | --- | --- | --- |
| `word('kw', boundary)` | a keyword that must not match inside a longer word (`if` not `ifdef`) | exact | dispatches |
| `keywords([...], opts)` | one of many keywords (colors, units, at-rules) | exact union | dispatches |
| `literal('kw')` | fixed token with **no** word-boundary requirement — punctuation, operators | exact | dispatches |
| `regex(/kw/)` | **avoid for keywords.** Genuine patterns only (numbers, identifiers) | often `any` | may not dispatch → `keyword-regex` |

Discriminating case: all three match `if` in `'if x'`; only `word` refuses `'ifdef'`.

### 2.2 Repeating — `many` vs `oneOrMore` vs `sepBy` vs `oneOrMoreSep`

| Use | Separator | Empty input |
| --- | --- | --- |
| `many(item)` | none | succeeds with `[]` — **nullable** |
| `oneOrMore(item)` | none | fails |
| `sepBy(item, sep)` | yes | succeeds with `[]` — **nullable** |
| `oneOrMoreSep(item, sep)` | yes | fails |

This is the single most consequential nullability in the library. A selector list,
value list, media-query prelude or keyframe selector is *never* empty — use
`oneOrMoreSep`. Parseman's own audit found `sepBy` used **zero** times across ~135
hand-rolled separated lists in its reference grammars; the nullable default was
wrong for essentially every real list (CHANGELOG 0.34.0).

### 2.3 Looking ahead — `not` vs `peek`

| Use | Succeeds when | First-set | Position |
| --- | --- | --- | --- |
| `not(X)` | X does **not** match | `any` | trailing only |
| `peek(X)` | X **does** match | X's | leading is fine |

`not(not(X))` is behaviourally a positive lookahead but reports `any`, so it
poisons dispatch and miscompiles among sibling arms sharing a first char
(`peek.ts:12-21`). Replace every `not(not(X))` with `peek(X)`.

### 2.4 Committing vs looking — `attempt` vs `peek`

| Use | Consumes on success | Rolls back on failure |
| --- | --- | --- |
| `attempt(X)` | yes — X's full match | every framework side effect |
| `peek(X)` | no — zero-width | n/a, nothing was committed |

`attempt` is for an arm you want to *take* atomically; `peek` is for deciding
*whether* to take one. They are not alternatives.

### 2.5 Selecting vs asserting on context — gated arm vs `gate()`

| Use | Role | Dispatch |
| --- | --- | --- |
| `choice({ gate, combinator }, …)` | **SELECT** a branch by a cheap state predicate | arm keeps its own first-set |
| `gate(pred)` inside `sequence` | **ASSERT** a predicate mid-sequence | poisons dispatch as a leading arm term |

Caveat that the parseman table does not carry — see §4.3. Using the arm field at
all changes `choice`'s strategy for **every** arm.

### 2.6 Mapping vs building — `transform` vs `node`

| Use | Produces | Captures children/trivia |
| --- | --- | --- |
| `transform(c, fn)` | whatever `fn` returns | no |
| `node(c, build?)` | a tree node | yes — terminals, trivia, `field()`s |

### 2.7 Skipping to a delimiter — `scanTo` vs `balanced`

| Use | Matches | Nesting |
| --- | --- | --- |
| `scanTo(sentinel, opts?)` | forward until `sentinel`, sentinel **not** consumed | flat; pass `skip: [balanced(...)]` for nested regions |
| `balanced(open, close, opts?)` | one balanced region **including** delimiters | tracks nested pairs |

Discriminating case: on `'(a (b) c)'`, `scanTo(literal(')'))` yields `'(a (b'`;
`balanced('(', ')')` yields `'(a (b) c)'`.

### 2.8 `compose` vs `composeLeaf`

| Use | Composable again | Semantic builders in pre-final pieces |
| --- | --- | --- |
| `compose([...])` | yes | **yes** — callbacks travel as captured source |
| `composeLeaf([...])` | no, terminal (`linker.ts:550`) | **no** — every pre-final piece must prove recognition-only (`plugin/index.ts:1102-1105`) |

---

## 3. NEW since 0.32.0 — capability nobody in this repo has used

Verified by importing both builds and diffing `Object.keys` **[probed]**:
0.32.0 has 78 exports, 0.36.0 has 81, **nothing was removed**, and exactly three
value exports were added.

| New export | Version | What it unlocks |
| --- | --- | --- |
| **`peek(c)`** | 0.34.0 | Positive lookahead carrying its body's first-set. **Confirmed absent at 0.32.0.** Converts the `not(not(X))` sites that currently report `any`. |
| **`oneOrMoreSep(item, sep, opts?)`** | 0.34.0 | Non-empty separated list. **Confirmed absent at 0.32.0.** Every non-empty list currently spelled `sepBy` is a nullable arm today. |
| `analyzeGatingRules(ruleMap, opts?)` | 0.34.0 | Rule-map-level gating diagnostic; `analyzeGating` is its single-entry case. |

Non-export additions — capability that does *not* show up in an export diff and is
therefore easy to miss:

| Addition | Version | Note |
| --- | --- | --- |
| `word(str, opts)` / `word(str, boundary, opts)` with `caseInsensitive` | 0.34.0 | At 0.32.0 `word` is `(str, boundary = '_0-9A-Za-z')` — two params, no opts **[probed]**. This is the conforming spelling for CSS at-keywords/units instead of `regex(/media/i)`. |
| `{ min, max }` on `many`/`oneOrMore`, `{ min, max, trailing }` on `sepBy`/`oneOrMoreSep` | 0.34.0 | At 0.32.0 `sepBy` takes exactly `(c, sep)` and `many` takes `(c)` **[probed]** — and `many(x, { min: 1 })` at 0.32.0 is **silently ignored**, not rejected: it still matches the empty string. Any 0.32.0 code written in the 0.34.0 idiom is quietly nullable. |
| `keywords({ caseInsensitive })` no longer compiles under `u` | 0.34.0 | **Behaviour change.** `keywords(['stroke'], { caseInsensitive })` used to also match `ſtroke` while its ASCII-folded first-set gated that input away — an unsound gate (`keywords.ts:81-98`). |
| `rules({ scanSkip: [...] })`; `scanTo`/`balanced` skip ambient trivia | 0.33.0 | **Default-behaviour change**: a sentinel hidden in a comment is no longer matched. Per-call `skip` now *extends* rather than replaces; `raw: true` opts out. |
| Shared grammar **shapes** — a `rules()` map may leave holes | 0.34.0 | A composite shape (`<ratio> = <value> '/' <value>`, a media-feature range) is written once, each dialect binds its own rule by name, and it still macro-fuses. An unbound hole is a hard build error, never a silent drop. |
| The gating diagnostic runs in the macro build | 0.34.0 | At 0.32.0 `compileRuleMap`/`compileLinkable` ran **no** analysis, so a whole macro-built grammar reported zero findings. Directly answers `PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md` §2's first row. |
| `compose()`/`composeLeaf()` re-run gating over the **fused winner map** | 0.34.0 | `linker.ts:563`, `plugin/index.ts:1020, 1088`. Only deferred choices are reported at the fuse, so a hole-free grammar still warns exactly once. |
| `gating.entryName` | 0.34.0 | Names an unnamed entry so a top-level const warns as `choice @ directMixinReferenceAhead` instead of `choice @ <entry>` — an actionable `accept` allowlist key. |
| `not()` no longer leaks its speculative probe | 0.34.0 | It was committing skipped trivia (double-logged spans) and, when the probed parser *succeeded*, leaving captured leaves that an enclosing `optional`/`many` absorbed as real children. **Both engines leaked identically**, so interpreted/compiled parity never flagged it. |
| Rollback truncations guarded on a changed length | 0.35.0 | Repairs the +32.5% Less parse regression 0.34.0 introduced, and then some: against **0.32.0**, guarded 0.34.0 is faster on every corpus — Less `benchmark.less` −3.9%, `bootstrap.css` −18.5%, jess corpus −18.5%, winning 12/12 interleaved pairs. |
| `parseman/run` entry | 0.35.0 | 3 modules / 7.2 kB vs 349.6 kB for the main entry. |
| Deduplicated `expected` sets | 0.36.0 | Observable output change. On a 106 KB Less stylesheet the oversized sets were **about a third of parse time**. |
| Declared Node floor `^20.19.0 \|\| >=22.12.0` | 0.34.0 | 20.0–20.18 and 22.0–22.11 are **excluded**. Does not reach consumers of a macro-compiled grammar. |

---

## 4. Gotchas that have actually bitten

### 4.1 `keywords()` folds case correctly; a hand-rolled `/i` regex does not

`keywords({ caseInsensitive: true })` compiles to flags `'iy'` — it deliberately
**drops `u`** so that matching and the first-set fold the same set (`keywords.ts:97`,
rationale at `keywords.ts:81-96`). The first-set is widened by `caseFoldVariants`,
which is the exact relation `/i`-without-`u` implements — including non-ASCII pairs
(`ä`↔`Ä`, `σ`↔`Σ`↔`ς`) but never a pair crossing the ASCII boundary
(`case-fold.ts:39`). Widening by `toUpperCase`/`toLowerCase` alone would **not** be
sound: 67 BMP code points sit in fold classes those two miss (`keywords.ts:87-89`).

A hand-rolled `regex(/media/i)` gets none of that reasoning. It is flagged as the
`keyword-regex` anti-pattern (`analysis/gating.ts:74-76`), and if you reach for
`/iu` to "be safe" the first-set collapses to `any()` and the arm stops gating
entirely (`regex.ts:137-141`) — **[probed]**: `regex(/cafe/i)` → `{C, c}`,
`regex(/cafe/iu)` → `any`.

### 4.2 `literal` has no word boundary — but a later regex arm can give it one

`literal('if')` matches inside `'ifdef'`; that is the documented point of it.
What is *not* obvious is that in a `firstMatch` choice, `computeAutoNot`
(`choice.ts:290-311`) walks every arm *after* a literal arm and, for each later
regex arm, computes the continuation first-set of `lit + c`
(`choice.ts:363-377`). If that check fires, the literal arm's success is **rejected**
and the loop continues to the next arm (`choice.ts:160-165`).

So `choice(literal('if'), regex(/[a-z]+/), literal('@x'))` gives `literal('if')` a
word boundary it never asked for:

```
UNGATED | strategy=firstMatch | autoNot[0]=[{firstSet a–z}] | parse('ifdef') = 'ifdef'
```
**[probed]**. This is a real behaviour you may be depending on without knowing it —
and §4.3 is how it disappears.

Note also that `literal(s, { caseInsensitive })` is **ASCII fold only**
(`literal.ts:6-22`), deliberately not `Intl.Collator` (measured ~9× slower, and
accent folding is the wrong semantic for a parser).

> **Doc/source discrepancy.** `docs/guide/combinators.md:26` describes
> `literal`'s `caseInsensitive` as "locale-aware comparison". The source is
> explicit that it is neither locale-aware nor Unicode-aware. **Source wins.**

### 4.3 Gating any ONE arm switches `autoNot` OFF for EVERY arm

`autoNot` is computed only when `!disjoint && !hasGates && (strategy is firstMatch
or sharedPrefix)`; otherwise every arm gets `null` (`choice.ts:55-57`). `hasGates`
is true if **any** arm carries a `gate:` field (`choice.ts:21`). Strategy detection
is also skipped outright for a gated choice (`choice.ts:51`).

That means adding a gate to one arm — even an always-true one — changes what the
whole choice **matches**, not merely how fast it dispatches:

```
UNGATED | strategy=firstMatch | autoNot[0]=[{firstSet a–z}] | parse('ifdef') = 'ifdef'
GATED   | strategy=firstMatch | autoNot[0]=null             | parse('ifdef') = 'if'
```

**[probed]**, on `choice(literal('if'), regex(/[a-z]+/), literal('@x'))` vs the same
choice with arm 0 wrapped as `{ gate: () => true, combinator: literal('if') }`.
The gate is never false; the *presence* of the field is what moved the result.

Treat "add a gated arm" as a **semantics** change requiring a corpus differential,
not a dispatch tweak. The same line disables `greedyClassify` and
`literalsLongestFirst`, so a gated all-literal choice also loses longest-first
reordering.

### 4.4 What degrades a compiled grammar to the runtime interpreter

The macro plugin statically evaluates the grammar; anything it cannot evaluate
falls back to the interpreter with a build warning
(`plugin/index.ts:1015` for `compose`, `:1075` for `composeLeaf`). **A fallback
build is not AST-equivalent to a compiled build** — see
`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md` §1, where the CST aggregate moved with the
fallback as the only delta.

Mechanisms, from source:

| Shape | Why it falls back |
| --- | --- |
| **A call to your own factory helper** (`const kw = s => word(s, B)`, then `kw('x')`) | The evaluator only recognizes callees in its `SUPPORTED` table; anything else returns null for the whole expression (`plugin/evaluator.ts:548-549`) |
| **A `...spread` anywhere** — call args, array elements, object properties, the `rules()` return object | Every argument site rejects `SpreadElement` explicitly (`plugin/evaluator.ts:517, 552, 576`), and a non-`key: value` property in the rules return kills the whole map (`plugin/evaluator.ts:707-714, 721-729`) |
| **A hoisted MODULE-level plain const** (a boundary class, a regex source string) | Module scope is populated **only** with values that evaluate to a Combinator (`plugin/index.ts:1176`). A plain string never enters it, so the `Identifier` lookup returns null (`plugin/evaluator.ts:598-601`) and any null argument voids the whole call (`plugin/evaluator.ts:555`). **Inline the literal at each call site.** |
| A const **inside** the `rules()` factory body | *This is fine.* `evalBodyStatements` stores non-combinator values in the factory's local scope (`plugin/evaluator.ts:732-750`). The 0.32.0 corollary "hoisted plain-string consts are forbidden" is specifically about **module** level. |
| A `rules()` factory that is not a function of exactly one identifier param | `plugin/evaluator.ts:773-781` |
| Any statement in a factory body other than a `VariableDeclaration` before the `return` | `plugin/evaluator.ts:796-800` |
| A computed key or non-`Property` in any object literal | `plugin/evaluator.ts:586-596` |
| A **direct node builder** that is not macro-static | Must be an arrow function (`direct-builder-static.ts:49`), plain identifier params only (`:52`), an **expression body — no block body** (`:92, :99`), and may read only its params plus a fixed global set: `Array Boolean Date JSON Math NaN Number Object String Infinity parseFloat parseInt undefined` (`:8-11`). Any other lexical read is reported, and `ir-serialize.ts:140` throws `IR direct node builder for <Type> must be macro-static and self-contained`. |

`many(choice(...))` held in a module-level const is **not** itself a documented
degrader — `many` and `choice` are both in `SUPPORTED`, and a const that evaluates
to a Combinator *does* enter module scope (`plugin/index.ts:1176`). If you have
observed such a const degrading a build, the cause is almost certainly something
the const's expression *contains* (a factory call, a spread, a hoisted plain
string), not the `many(choice)` shape. Bisect the expression before blaming the
shape.

### 4.5 `regex()` — what actually costs you

The brief for this document carried two rules that the source does not support as
written. Recording both, with what is true instead.

- **"No `/i` without `/u`"** — this is **backwards**. `/i` *alone* is the good case:
  the first-set is ASCII case-folded and the arm still gates (`regex.ts:137-141`).
  Adding `u` or `v` is what forfeits gating: `/iu` and `/iv` fold by Unicode
  simple case folding, which an ASCII first-set cannot enumerate, so parseman
  falls back to `any()` — sound, but the dispatch is gone. **[probed]**. The rule
  is: **never add `u` to a case-insensitive pattern.** `keywords()` enforces this
  for you by construction (`keywords.ts:97`).
- **"No literal non-ASCII — use `\uXXXX` escapes"** — **not verified.** The
  first-set analyzer handles a literal non-ASCII char and a `\uXXXX` escape
  identically: `regex(/[é]+/)` and `regex(/[é]+/)` both report the range
  `{233, 233}` **[probed]**, and `regex/first-set.ts:186-196` parses `\uXXXX` /
  `\xHH` into the same `charNode` the literal path produces (`:214`). I could find
  no rule in the source prohibiting it.

  What *is* true about the ASCII boundary:
  - `choice`'s O(1) dispatch table is 128 entries (`choice.ts:408-419`); a
    non-ASCII first char falls to a linear first-set scan (`choice.ts:93-97`).
    Correct, just not O(1).
  - `keywords({ caseInsensitive })` containing any code point > 127 **declines**
    the fast codegen path and stays on the regex engine (`codegen.ts:1128`), as do
    astral keywords (`codegen.ts:1121`) and `caseInsensitive` combined with a
    boundary (`codegen.ts:1122`).
  - The regex short-scan fast path refuses any of `imsuvy` outright
    (`regex.ts:53-55`), and macro lowering declines `u` entirely plus `/i` on
    anything but a pure literal (`docs/guide/regex-lowering.md:175-178`).

  So: non-ASCII costs the **fast path**, not correctness.

  **This refutes the stated mechanism, not the rule.** The escape rule was
  justified by first-set gating, and gating is not what it buys — but a different
  justification survives the probe intact, and it is the stronger one:

  > **Write non-ASCII in a regex as `\uXXXX`.** A literal `é`, `ﬁ`, a Cyrillic `а`
  > or a zero-width joiner is *invisible to review*. Nobody can eyeball a character
  > class for a homoglyph, and a grammar is exactly the place where one silently
  > changes what the language accepts. The escape makes the code point auditable in
  > a diff. Parseman does not require this and the first-set is identical either
  > way — it is a reviewability rule, and it holds for that reason alone.

  Do not restate it as a performance or gating rule; that claim is false and will
  send the next reader hunting for a first-set difference that is not there. The
  genuine ASCII *performance* boundary is the 128-entry dispatch table above, which
  is about the first character a rule can match, not about how it is spelled.

### 4.6 Nullability rules you will otherwise rediscover

- `many` matches the empty string; `oneOrMore` does not.
- `sepBy` matches the empty string; `oneOrMoreSep` does not.
- `optional` never fails.
- `not()`, `gate()`, `scanTo()`, `balanced()` all have first-set `any`.
- A sequence's first-set comes from its leading non-nullable term. Lead every
  choice arm with a concrete terminal.
- A choice is disjoint only when arms are pairwise-disjoint **and** no arm can
  match empty (`choice.ts:35-36`).

---

## 5. Still absent at 0.36.0

Absences are as load-bearing as presences.

### 5.1 No repetition combinator captures its separator

**Confirmed absent.** `sepBy` returns `Combinator<T[]>` — the item type only; the
separator's value is parsed and discarded (`repeat.ts:321`). `oneOrMoreSep`
delegates to it (`repeat.ts:290-292`). There is no `sepByWith`, no
`{ keepSeparators }` option, and no separator field in `SepByOptions`
(`repeat.ts:294-307`). **[probed]**: `sepBy(regex(/[a-z]+/), literal(','))` on
`'a,b,c'` yields `["a","b","c"]`.

For byte-faithful layout replay this matters: you cannot reconstruct
`a , b ,c` from `['a','b','c']`.

**Two workarounds exist, and both are real.**

1. **`field()` inside the separator works** — verified, not assumed. `field()`
   pushes to `ctx._fields` unconditionally, with no nesting restriction
   (`map.ts:79`), and repeated names accumulate. **[probed]**:

   ```ts
   node('List',
     sepBy(field('item', regex(/[a-z]+/)), field('sep', literal(','))),
     (_c, f) => ({ items: f.item, seps: f.sep }))
   // 'a,b,c' → seps: [ {value:',',span:{1,2}}, {value:',',span:{3,4}} ]
   ```

   So the *capability* exists; what is missing is a combinator that does it for
   you. The spelling is unergonomic and undocumented — `combinators.md:520-541`
   shows `field()` only inside a flat `sequence`.

2. **The offset model is parseman's intended answer.** Trivia is not stored at
   all; leaf spans are "slots" and everything between consecutive slots is
   recovered by `gapText` / `lineBreaksIn` / `indentWidth` / `blankLinesIn` over
   the original source (`cst/offset-model.ts:1-24`). For layout replay this is
   strictly more faithful than captured separators, because it recovers the
   *whitespace* too, not just the punctuation.

**Verdict:** a dedicated separator-capturing repetition is a genuine gap and worth
filing upstream (`sepBy(item, sep, { captureSeparators: true })`, or a
`sepByPairs` returning `[T, S|null][]`). But it is an **ergonomics** gap, not a
capability blocker — do not architect around its absence before evaluating
`collectLeafSlots` + `gapText`.

### 5.2 Other absences

- **No `pick()`** — deliberately not re-exported; build-inlining a `pick()` of an
  imported grammar cannot carry that grammar's ambient trivia across the module
  boundary, so the macro would diverge from the interpreter (`index.ts:44-48`).
- **No runtime `composeLeaf()`** — it throws unconditionally outside macro
  lowering (`linker.ts:579-583`). Loading a `composeLeaf` grammar interpreted, to
  work around a macro problem, is not possible.
- **No author-settable `recognitionOnly` on `transform`** — the flag exists on the
  def (`types.ts:67`) but is set only internally, by `scanTo` (`scanTo.ts:249`).
  You cannot mark your own transform as semantics-free to get it past
  `composeLeaf`'s gate.
- **No `trailing: 'require-between-every-item'`** — deliberately excluded; that is
  not a separated list. Spell it `many(sequence(item, term))` (`AGENTS.md:93-97`).
- **No suppression mechanism for a gating finding other than the `accept`
  allowlist** — `compile(g, undefined, { gating: { level, accept: ['<id>'] } })`
  is the single lever (`AGENTS.md:40-43`).

---

## 6. When you next bump the pin

1. Re-run the export diff against the new `dist/index.js`; do not read the
   changelog for this.
2. Re-read `docs/guide/combinators.md` §"Choosing between similar" and re-port §2.
3. Re-probe §4.2 and §4.3 — they depend on `choice.ts` strategy selection, which
   has changed within a minor before.
4. Re-verify §5.1 against `repeat.ts`'s exported signatures.
5. Re-verify §4.4 against `plugin/evaluator.ts` — the macro's static-evaluation
   surface is the least stable thing in the library and the most damaging when it
   silently narrows.
6. Update the date stamp at the top, or delete the file.
