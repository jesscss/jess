# Parseman combinator cheat sheet

**Reflects parseman 0.32.0 — the version this repo pins and the version your code
must compile against.** Derived 2026-07-25.

## Provenance — where these claims come from

The pinned package (`node_modules/parseman`) ships `dist/` only, but its published
sourcemaps carry full `sourcesContent`: the **actual 0.32.0 TypeScript**, 61 files,
recovered from `dist/**/*.js.map`. Every `src/…:N` citation below is a line in that
recovered 0.32.0 source, not in a newer checkout. `src/version.ts` in it reads
`PARSEMAN_VERSION = '0.32.0'`.

**Reproduce the extraction** — do this rather than trusting a citation you doubt.
For each `dist/**/*.js.map`, parse the JSON and write `sourcesContent[i]` to
`sources[i]` (strip the leading `../`); four maps cover 61 unique files:

```js
const m = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
m.sources.forEach((s, i) => write(s.replace(/^(\.\.\/)+/, ''), m.sourcesContent[i]))
```

Two independent checks that the recovered tree is genuine 0.32.0: `linker.ts:565`
and `gating.ts:313` land on exactly the lines
`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md` §2.1 already cites from reproduction in
this repo.

Behavioural claims are marked **[probed]** (executed against the pinned
`dist/index.js`), **[type-checked]** (run through `tsc` against the pinned
`dist/index.d.ts`), or **[unprobed]** (read from source only).

Nothing here was taken from parseman's published docs, because upstream docs
describe 0.41.0. **Where published prose and the 0.32.0 source disagree, the source
wins**; §5 lists the disagreements found.

## Honesty note

This is a **convenience copy**, and a stale cheat sheet is worse than none because
it will be trusted. A sheet documenting combinators the pin does not have produces
code that does not compile — or, worse, compiles and behaves differently.

Upstream is at 0.41.0. That gap is not closing soon: 0.36.0 was measured and
declined on a Less regression, and 0.40.0 was found to corrupt CST output (231
structural nodes collapsed to bare leaves, 55 source tokens dropped, across 13
files). Two upstream defects are being fixed before a bump is reconsidered.

So: **§1–§5 are the callable surface. §6 is explicitly NOT callable** — it exists
as the argument for bumping and must never be mixed into the working set.

When the pin moves, **re-derive from the new source** (§7); do not patch this from
a changelog. If you cannot re-derive it, delete it.

## Relationship to the other parser docs

- **`GRAMMAR-REVIEW-STANDARD.md` is the standing brief and outranks this sheet.**
  It sets the method (every `const`, no sampling), the checklist, and the outcome
  vocabulary — **conforms / converted / blocked / deliberate exception**. This
  sheet is the API reference that checklist items 6, 8, 9 and 11 are answered
  *against*; where a finding here should be recorded, it is phrased in that
  vocabulary so the two line up.
- **`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md`** — constraints reproduced on the four
  grammars at this same pin. Consistent with this sheet, with one point where the
  standard supersedes its blanket form: see §3.5.
- **One live contradiction is flagged, not silently resolved: §3.1a**, between the
  keyword-regex lint rule's stated rationale and the pinned combinator's actual
  behaviour. Read it before doing any case-insensitive keyword conversion.

---

## 1. The callable surface at 0.32.0

Enumerated from `src/index.ts:1-103`. **78 runtime exports.** Nothing described
below is absent from the pin; nothing absent from the pin is described below.

### 1.1 Terminals

| Export | What it does | Example |
| --- | --- | --- |
| `literal(s, opts?)` | Exact string match. **No word boundary.** `opts.caseInsensitive` folds **ASCII letters only** (`src/combinators/literal.ts:13`) | `literal('=>')` |
| `regex(pattern, flags?)` | Sticky `/…/y` match at the current position | `regex(/[0-9]+/)` |
| `word(s, boundary?)` | One keyword + trailing boundary guard. **Exactly two params**; default boundary `_0-9A-Za-z` (`src/combinators/keywords.ts:24`) | `word('if')` rejects `'ifdef'` |
| `keywords(words, opts?)` | One of many, longest-first, one sticky regex. `opts` is `{ caseInsensitive?, boundary? }` — **has a live soundness defect at this pin, §3.1** | `keywords(['bord','border'])` → `'border'` |
| `makeWord(boundary?)` | Definition-time factory fixing the boundary class | `const cssKw = makeWord('A-Za-z0-9_-')` |

`word()` takes **no options object** at this pin. A case-insensitive single keyword
must be spelled `keywords([str], { caseInsensitive: true, boundary })`.

### 1.2 Sequencing and choice

| Export | What it does |
| --- | --- |
| `sequence(...c)` | All in order, returns a tuple. Skips ambient trivia between terms |
| `choice(...arms)` | Ordered PEG alternatives, first match wins. An arm may be `{ gate, combinator }` (`src/combinators/choice.ts:18-19`). **Read §3.2 before adding a gated arm** |
| `attempt(c)` | All-or-nothing arm: restores capture/trivia/error sinks on failure |

### 1.3 Repetition — four exports, no options objects

```
many(c)        oneOrMore(c)        optional(c)        sepBy(c, sep)
```

Exact signatures at the pin (`src/combinators/repeat.ts:70, 122, 170, 196`):

```ts
export function many<T>(combinator: Combinator<T>): Combinator<T[]>
export function oneOrMore<T>(combinator: Combinator<T>): Combinator<T[]>
export function optional<T>(combinator: Combinator<T>): Combinator<T | null>
export function sepBy<T, S>(combinator: Combinator<T>, separator: Combinator<S>): Combinator<T[]>
```

**No overloads, no options parameter on any of them.**

- `many(x, { min: 1 })` is a **compile error** — `TS2554: Expected 1 arguments, but
  got 2` **[type-checked]**. Write `oneOrMore(x)`.

  > **Correction to something that circulated.** An earlier note — including an
  > earlier draft of this sheet — described `many(x, { min: 1 })` at this pin as
  > "silently ignored: it still matches the empty string". That was a **runtime**
  > observation against the untyped compiled JS, where an extra argument is simply
  > dropped. Against the pinned `dist/index.d.ts` it does not compile at all. Do
  > not re-derive the "silent no-op" claim from a stale brief; the failure is loud
  > and it is at build time.
- `sepBy(x, sep, { min: 1 })` is a **compile error** — `TS2554: Expected 2
  arguments, but got 3` **[type-checked]**.
- **`sepBy` is nullable at this pin and there is no way to say otherwise.** It is
  `(item (sep item)*)?` and matches the empty string: `parse(sepBy(ident, comma),
  '').ok === true` **[probed]**. A non-empty separated list — selector list, value
  list, media-query prelude — has **no non-nullable spelling here.** See §3.4.
- `many` is likewise nullable; `oneOrMore` is the non-nullable plain repeat.

### 1.4 Negation — `not` only

`not(c)` — negative lookahead (PEG `!X`), zero-width. First-set is `any()`
(`src/combinators/not.ts:17`): it cannot know what it forbids, so **keep it as a
trailing boundary and never lead a choice arm with it.**

There is **no positive lookahead at this pin.** §3.3 for what that costs.

### 1.5 Trivia

`trivia(c)` marks a combinator as skippable filler; `noTrivia(c)` clears active
trivia locally; `parser({ trivia }, root)` turns on auto-skipping;
`rules({ trivia, scanSkip }, factory)` sets it grammar-wide.

**`rules({ scanSkip })` IS available at this pin** (`src/combinators/parser.ts:56,
128`) — easy to assume otherwise, since the surrounding `scanTo`/`balanced`
ambient-skipping work is newer. Options go **first** for scope-configuring helpers
(`rules`, `parser`), last for combinator-local ones.

### 1.6 Nodes, fields, builders

| Export | What it does |
| --- | --- |
| `node(c, build?, opts?)` / `node(type, c, build?, opts?)` | The tree-building rule. The build callback receives **CST leaves with spans**, not bare strings. Inside `rules()` the type is inferred from the rule key |
| `NodeOptions` | `{ unwrap?, collapse?, captureTrivia?, trailingTrivia? }` |
| `field(name, c)` | Capture a named value+span for the nearest enclosing `node()`. Repeated names become arrays. Parse behaviour unchanged (`src/combinators/map.ts`) |
| `label(name, c)` | Metadata; changes the reported `expected` on failure |
| `transform(c, fn)` | Map a value: `fn(value, span)` |
| `skip(main, skipped)` | Match both, return `main`'s value |
| `token(c)` | Contiguous region, trivia disabled; returns matched **source text**, one CST leaf |
| `leaf(c, reducer)` | One *semantic* leaf; unlike `token` it does not touch trivia |
| `cstBuildHost(opts?)` | Ready-made `build` host producing the default CST shape |

### 1.7 Recursion and running

`ref<T>()` (low-level forward slot; use before `.define()` throws), `rules(factory)`
(named mutually-recursive bundle — prefer this), `parse(c, input, opts?)`,
`parser(opts, root)`, `compile(c, …, opts?)`, `run(runnable, input, opts?)`,
`parseDoc(…)` (incremental re-parse over a rules registry).

There is **no `parseman/run` subpath entry** at this pin — the driver is reachable
only through the main entry, which is why a package shipping a compiled grammar
carries `parseman` as a real runtime dependency.

### 1.8 Gating and context

- `gate(predicate)` — zero-width state **ASSERT** on `ctx.state`; first-set is
  `any`, so never lead an arm with it (`src/combinators/gate.ts`).
- `choice({ gate, combinator }, …)` — the arm **field**: **SELECT** a branch.
  Arm field = select; `gate()` combinator = assert. **§3.2 first.**
- `guard(...)` — deprecated alias for `gate` (`src/index.ts:53-55`).
- `withCtx(extra, c)` — merge into `ctx.state` for the duration of `c`.
- `analyzeGating(entry, opts?)`, `formatGatingWarnings(report)`,
  `firstSetToString(fs)` — **read §3.5 before reporting any result from these.**
- Anti-pattern kinds reported: `'double-not' | 'leading-not' | 'keyword-regex'`.

### 1.9 Error recovery

`expect(c, label?)` (records a `ParseError` in place and keeps parsing),
`isParseError(v)`, `completionsAt(target, input, offset)`.

### 1.10 Scanning

- `scanTo(sentinel, opts?)` — forward until `sentinel`, sentinel **not** consumed.
- `balanced(open, close, opts?)` — one balanced region **including** delimiters,
  counting nested pairs.
- Per-call `skip: [...]`, plus `orEOF: true` on `scanTo`.
- Both have `any` first-sets by nature — an arm led by either will not gate.

### 1.11 Composition

- `compose([...])` — fuse independently-compiled grammars so a dialect can override
  a base's rules. **May carry semantic builders**: callbacks travel as captured
  source (`fnSrc`/`buildSrc`).
- `composeLeaf([...])` — terminal; the result cannot be composed again
  (`src/compiler/linker.ts:536`). **Runtime composition throws**
  (`src/compiler/linker.ts:565`) — macro lowering only.
- `pick()` is deliberately not exported (`src/index.ts:42-46`).

### 1.12 CST / offset / span utilities (not combinators)

`walk`, `createVisitor`, `buildTriviaIndex`, `triviaEntries`, `triviaKindMask`,
`buildLineIndex`, `offsetToLineCol`, `annotateSpan`; the offset model —
`OffsetIndex`, `buildOffsetIndex`, `collectLeafSlots`, `gapText`, `lineBreaksIn`,
`blankLinesIn`, `lineStartWithin`, `indentWidth`, `indentMixed`, `commentsIn`,
`gapIsSignificant`; and the relative-span set `relativize`, `absolutize`,
`absoluteSpanAt`, `shiftAbsolute`, `applyEdit`, `relativizeCST`, `absolutizeCST`,
`absoluteSpanCST`.

Worth knowing: trivia is **not stored**. A leaf's span is a "slot"; trivia lives in
the gaps between consecutive slots and is recovered by subtraction and by slicing
the source (`src/cst/offset-model.ts`). This is parseman's answer to byte-faithful
layout replay, and it is fully present at the pin.

### 1.13 Coverage / observability

`GRAMMAR_COVERAGE_DEFINITIONS`, `grammarCoverageDefinitions`,
`compiledGrammarCoverageDefinitions`, `composedGrammarCoverageDefinitions`,
`createGrammarCoverageCollector`, `createGrammarInstrumentationContext`,
`createGrammarTraceSink`, `runWithGrammarCoverage`.

---

## 2. Choosing between similar — at this pin

The wrong pick usually still *works*; it silently loses first-char dispatch, and
sometimes (§3.2) changes what the grammar matches. These tables are written for
0.32.0 and deliberately do **not** recommend combinators the pin lacks.

### 2.1 Recognizing a keyword — `word` vs `literal` vs `regex`

| Use | When | First-set | Gating |
| --- | --- | --- | --- |
| `word('kw', boundary)` | a keyword that must not match inside a longer word | exact | dispatches |
| `keywords([...], opts)` | one of many keywords | exact union | dispatches — but §3.1 for `caseInsensitive` |
| `literal('kw')` | fixed token, **no** word-boundary requirement — punctuation, operators | exact | dispatches |
| `regex(/kw/)` | **avoid for keywords.** Genuine patterns only | often `any` | may not dispatch → `keyword-regex` |

All three match `if` in `'if x'`; only `word` refuses `'ifdef'`.

### 2.2 Repeating — the pin has four, not six

| Use | Separator | Empty input |
| --- | --- | --- |
| `many(item)` | none | succeeds with `[]` — **nullable** |
| `oneOrMore(item)` | none | fails |
| `sepBy(item, sep)` | yes | succeeds with `[]` — **nullable, unavoidably** |
| *non-empty separated* | — | **no spelling at this pin** — §3.4 |

### 2.3 Lookahead — `not` is the only one

| Use | Succeeds when | First-set | Position |
| --- | --- | --- | --- |
| `not(X)` | X does **not** match | `any` | **trailing only** |
| `not(not(X))` | X **does** match | `any` | works, but poisons dispatch — §3.3 |

### 2.4 Committing vs looking — `attempt` vs `not(not(…))`

| Use | Consumes on success | Rolls back on failure |
| --- | --- | --- |
| `attempt(X)` | yes — X's full match | every framework side effect |
| `not(not(X))` | no — zero-width | n/a |

`attempt` is for an arm you want to *take* atomically; the double negation is for
deciding *whether* to take one. They are not alternatives.

### 2.5 Selecting vs asserting on context — gated arm vs `gate()`

| Use | Role | Dispatch |
| --- | --- | --- |
| `choice({ gate, combinator }, …)` | **SELECT** a branch by a state predicate | arm keeps its own first-set — **but §3.2** |
| `gate(pred)` inside `sequence` | **ASSERT** a predicate mid-sequence | poisons dispatch as a leading arm term |

### 2.6 Mapping vs building — `transform` vs `node`

| Use | Produces | Captures children/trivia |
| --- | --- | --- |
| `transform(c, fn)` | whatever `fn` returns | no |
| `node(c, build?)` | a tree node | yes — terminals, trivia, `field()`s |

### 2.7 Skipping to a delimiter — `scanTo` vs `balanced`

| Use | Matches | Nesting |
| --- | --- | --- |
| `scanTo(sentinel, opts?)` | forward until `sentinel`, **not** consumed | flat; pass `skip: [balanced(...)]` for nested regions |
| `balanced(open, close, opts?)` | one balanced region **including** delimiters | tracks nested pairs |

On `'(a (b) c)'`: `scanTo(literal(')'))` → `'(a (b'`; `balanced('(', ')')` →
`'(a (b) c)'`.

### 2.8 `compose` vs `composeLeaf`

| Use | Composable again | Semantic builders in pre-final pieces |
| --- | --- | --- |
| `compose([...])` | yes | **yes** — callbacks travel as captured source |
| `composeLeaf([...])` | no, terminal (`linker.ts:536`) | **no** — every pre-final piece must prove recognition-only (`src/plugin/index.ts:1052-1053`) |

---

## 3. Gotchas at this pin

### 3.1 `keywords({ caseInsensitive: true })` has a LIVE unsound gate

The entry most likely to be believed backwards, because it is the opposite of what
upstream docs say — they describe the **fixed** behaviour, which landed in 0.34.0.

At the pin (`src/combinators/keywords.ts:64`):

```ts
const flags = opts.caseInsensitive ? 'iuy' : 'uy'
```

The `u` flag is **on** for the case-insensitive path, so matching folds by Unicode
*simple case folding*. But the first-set is widened only by `toUpperCase` /
`toLowerCase` (`src/combinators/keywords.ts:75-78`) — there is no `case-fold.ts`
module in 0.32.0 at all. The two do not cover the same set, so **the matcher accepts
inputs the gate dispatches away.**

Reproduced **[probed]**:

```
keywords(['stroke'], { caseInsensitive: true })
  first-set                      = { S, s }            (U+017F absent)
  bare combinator on 'ſtroke'    → ok: true, 'ſtroke'  (matcher accepts)
  same arm in a DISJOINT choice  → ok: false           (dispatch excludes it)
```

The arm matches on its own and fails inside a choice. That is an unsound gate, not
a slow one. It bites any case-insensitive keyword set whose first letter has a
non-ASCII fold partner.

**The defect direction matters, and it is the opposite of what you would guess**
**[probed]**. The combinator **over-accepts**; the hand-rolled regex does not:

```
regex(/(?:stroke)(?![-\w])/i)                on 'ſtroke' → ok: false   (correct)
keywords(['stroke'], { caseInsensitive })    on 'ſtroke' → ok: true    (WRONG-ACCEPT)
```

and in a **non-disjoint** choice the over-accepting arm wins outright, returning
`'ſtroke'`. In a **disjoint** choice the same arm is dispatched away and fails.
So the observable behaviour depends on the shape of the enclosing choice — that
is what a matcher/gate disagreement looks like from the outside.

**ASCII-initial keywords are not exempt.** `keywords(['stroke'])` has first-set
`{S, s}`, which does not contain U+017F, yet the matcher accepts it **[probed]**.
Every keyword whose initial has a cross-ASCII-boundary fold partner is exposed —
`s` (ſ U+017F), `k` (K U+212A), and others. What limits real-world exposure is
that the *input* must contain a non-ASCII identifier, not that the *keyword* is
ASCII.

### 3.1a Conversion guidance — this gates the keyword-regex work

This lands directly on the hand-rolled keyword regexes being converted under
`GRAMMAR-REVIEW-STANDARD.md` §2 item 8, of which a large share carry `/i`.

**Converting a hand-rolled `/i` keyword regex to
`keywords({ caseInsensitive: true })` at this pin introduces a wrong-accept the
regex did not have.** Wrong-accepts are precisely the failure class
`DIALECT-ARCHITECTURE-AND-ERROR-COVERAGE.md` records as having hidden behind a
green suite.

> **Contradiction to resolve — flagged, not silently decided.**
> `scripts/eslint-rules/grammar-rules.mjs:252-258, 285` reports every such regex
> with the rationale: *"`/i` without `/u` applies non-ASCII case folding
> incorrectly, and parseman fixed exactly that defect INSIDE the combinator — so
> every hand-rolled copy carries the unfixed bug."*
>
> **At 0.32.0 that is inverted.** The fix it invokes landed in **0.34.0**, above
> our pin. At the pinned version the combinator uses `iuy` and widens its
> first-set with only `toUpperCase`/`toLowerCase`, so the **combinator** carries
> the bug and the hand-rolled regex does not — probed above, both directions.
> The rule's *recommendation* (use the API) stays right for every other reason in
> item 8: boundary ownership, readability, exact first-set, gating. Only its
> *stated correctness rationale* is a 0.34.0 claim.

**Therefore, at this pin:**

- Convert **case-SENSITIVE** hand-rolled keyword regexes freely — they take the
  `uy` path (`src/combinators/keywords.ts:64`), which has no such defect.
- Treat **case-INSENSITIVE** conversions as **`blocked` — missing 0.34 export**,
  in `GRAMMAR-REVIEW-STANDARD.md` §1's vocabulary, and record the reason against
  the const so the next agent does not re-propose it. This is the same bump-gated
  class as the `oneOrMoreSep` work (§3.4), not a separate judgement call.
- If a case-insensitive conversion is taken anyway, assert per-site that no input
  reaching that arm can begin with a non-ASCII character, and say so explicitly —
  do not leave it implied.

### 3.2 One gated arm disables `autoNot` and strategy for the WHOLE choice

`autoNot` is computed only when `!disjoint && !hasGates && strategy is firstMatch
or sharedPrefix`; otherwise every arm gets `null`
(`src/combinators/choice.ts:55-57`). `hasGates` is true if **any** arm carries a
`gate:` field (`:21`). Strategy detection is skipped outright for a gated choice
(`:51`).

**Narrow it correctly.** `autoNot` is only ever computed for a **non-disjoint**
choice. A gated arm in a **disjoint** choice therefore loses nothing — that case is
safe. The hazard is a gated arm in a **non-disjoint** choice, and it changes
semantics by **two independent routes** **[probed]**:

**Route A — a short literal arm starts returning a prefix match.** `autoNot`
normally gives a literal arm a boundary derived from a later regex arm
(`src/combinators/choice.ts:290-311`); losing it lets the short arm win.

```
choice(literal('if'), regex(/[a-z]+/), literal('@x'))       on 'ifdef'
  ungated    strategy=firstMatch  autoNot[0]=SET   → 'ifdef'
  one gated  strategy=firstMatch  autoNot[0]=null  → 'if'
```

**Route B — declaration order lets a shorter literal shadow a longer one.** An
all-literal choice is normally reordered longest-first by `literalsLongestFirst`;
`hasGates` disables strategy detection entirely, dropping it to declaration order.

```
choice(literal('in'), literal('instanceof'))                on 'instanceof x'
  ungated    strategy=literalsLongestFirst  → 'instanceof'
  one gated  strategy=firstMatch            → 'in'
```

**Control — a disjoint choice is unaffected** **[probed]**:

```
choice(literal('@a'), literal('#b'))                        on '#b'
  ungated    disjoint=true  → '#b'
  one gated  disjoint=true  → '#b'
```

In every case the gate returns `true`; the *presence* of the field moved the result.
There is **no warning**. Treat "add a gated arm to a non-disjoint choice" as a
semantics change requiring a corpus differential.

### 3.3 No positive lookahead — `not(not(X))` is the only spelling, and it costs

`not()`'s first-set is `any()` (`src/combinators/not.ts:17`), so `not(not(X))`
reports `any()` too. An arm leading with it poisons the whole choice's first-char
dispatch, and among sibling arms sharing a first char the hand-rolled gate
miscompiles. The gating diagnostic flags it as the `double-not` anti-pattern — and
at this pin it has no fix to name.

`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md` §3 counts 5 such sites in the Less AST
grammar. They stay as-is until the pin moves.

### 3.4 There is no non-empty separated list — plan around it

`sepBy` is nullable and unparameterised at this pin (§1.3). A nullable arm matches
at every position, which disables its choice's first-char dispatch by parseman's own
first-set rule. Since essentially every real list is non-empty, this is a standing
dispatch cost across all four grammars.

Workable spellings at the pin, in preference order:

1. **Hand-roll the shape**: `sequence(item, many(sequence(sep, item)))` — genuinely
   non-nullable, carries the item's first-set, gates. Costs a flatten in the builder.
2. **Wrap the nullable list behind a concrete leading terminal**, so the *arm* is
   non-nullable even though the list is not.
3. Accept the nullable arm and list the choice's printed `id` in the gating
   snapshot allowlist — but see §3.5: the diagnostic that would print that `id` is
   largely unavailable here.

Do **not** write `sepBy(item, sep, { min: 1 })` expecting it to work; it does not
compile (§1.3).

**Read this against `GRAMMAR-REVIEW-STANDARD.md` §2 item 8**, which counts
hand-rolled separated-list sites against uses of `sepBy` as an API-avoidance
finding. At this pin that finding must not be discharged by converting them:
`sepBy` is nullable, so converting a **non-empty** list to it trades a gating arm
for a non-gating one and is a regression. The correct outcomes here are:

| the list is… | outcome |
| --- | --- |
| genuinely optional (empty is legal) | **converted** — `sepBy` is right |
| non-empty (selector list, value list, prelude) | **blocked — missing 0.34 export** (`oneOrMoreSep`) |

The standard's own vocabulary anticipates this: "missing 0.34 export" is named as
a `blocked` reason (§1). Record it per const rather than leaving the site looking
like an unconverted finding.

### 3.4a Separator capture — `field()` inside the separator works

`GRAMMAR-REVIEW-STANDARD.md` §1 names "separator capture" as a legitimate
`blocked` reason, so it is worth knowing exactly how much is blocked.

`sepBy` returns `Combinator<T[]>` — the item type only; the separator's value is
parsed and discarded (`src/combinators/repeat.ts:196`). There is no
separator-capturing repetition combinator at any version. **But `field()` inside
the separator does capture**, because `field()` pushes to `ctx._fields`
unconditionally with no nesting restriction **[probed]**:

```ts
node('List',
  sepBy(field('item', regex(/[a-z]+/)), field('sep', literal(','))),
  (_c, f) => ({ items: f.item, seps: f.sep }))
// 'a,b,c' → seps: [ {start:1,end:2}, {start:3,end:4} ]
```

So capture is available; what is missing is a combinator that does it for you.
And for byte-faithful layout replay the offset model (§1.12) is strictly better —
it recovers the whitespace too, not just the punctuation. Before recording a const
as `blocked — separator capture`, check whether either of these two answers it.

### 3.5 `analyzeGating()` results are three-ways ambiguous — never report "clean"

**Scope, per `GRAMMAR-REVIEW-STANDARD.md` §3.** The diagnostic **can** analyse
these grammars when fed their `rules()` map captured *before* `compose()`. The
blanket claim "the diagnostic cannot see our grammars" is wrong, and where this
sheet's earlier drafts implied it, the standard supersedes them. What follows is
about **what a quiet result means once you have fed it a valid input** — which
remains a live hazard, because cause (2) below is independent of which map you
feed.

The swallowing-catch fix landed in **0.38.0**, above the pin. At 0.32.0 a quiet
`analyzeGating` result has three indistinguishable causes:

1. **Genuinely clean** — every hot choice gates.
2. **Saw nothing.** The traversal resolves `lazy` rule refs inside a bare
   `try { … } catch { /* unresolved */ }` (`src/analysis/gating.ts:324`). A thunk
   that throws silently drops that entire subtree; the walk continues and reports on
   whatever it happened to reach. There is no counter and no unanalysed list.
3. **You fed it the wrong artifact.** On a **fused/compiled** artifact the walk
   throws at `src/analysis/gating.ts:313` (`if (d.tag === 'choice')`, on a node
   with no descriptor) — reproduced in this repo for **129 of 129** rules of the
   composed Less CST (`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md` §2.1). The
   macro-build route emits nothing at all, because
   `compileRuleMap`/`compileLinkable` run no analysis at this version. This cause
   is **avoidable**: feed the pre-`compose()` `rules()` map.

**Therefore "no warnings" is never a reportable result at this pin.** The only
reportable form is coverage-bearing — **"analysed N of M rules, K findings, fed
the pre-compose map"** — with N and M counted by the caller, not by parseman. A
report that cannot state N and M is not evidence of anything. This is the same
evidence bar `GRAMMAR-REVIEW-STANDARD.md` §5 sets when it requires you to say
*which* map you fed the analysis.

Use static reading with the corpus differential as the acceptance gate. Never read
a clean result obtained from the fused artifact as evidence of anything.

### 3.6 `not()` leaks its speculative probe at this pin

`not()` rolls back only the CST capture mark (`src/combinators/not.ts:32-34`) — it
does **not** roll back `_triviaLog` or the completions probe. So a probed body that
skipped ambient trivia between its terms commits that trivia and keeps it; because
`not()` consumes nothing, the enclosing rule re-parses the region and the span is
logged **twice** (nothing dedups `_triviaLog`, and `triviaEntries()` is a positional
view over the flat array). **[unprobed — read from source; fixed upstream in
0.34.0.]**

**This is higher-priority than its [unprobed] mark suggests, because of blast
radius.** Trailing `not()` is our documented boundary idiom, and
`GRAMMAR-REVIEW-STANDARD.md` §2 item 11 records the Less grammar carrying roughly
an order of magnitude more `not()` than CSS for the same surface (owner
measurement ~460 against 21, to be re-measured), with 18 leading-`not()` sites
called out as the anti-pattern. If trivia output is untrustworthy around every
`not()`, that is a property of a large fraction of the Less surface, not an edge
case.

Consequences:

- **`triviaEntries()` / `buildTriviaIndex()` output is not trustworthy around a
  `not()`.** That bears directly on the language service, which consumes exactly
  this trivia model for comment attachment and formatting.
- **The double-log is invisible to our differentials.** Both engines leaked
  identically, so interpreted-vs-compiled parity agreed while both were wrong —
  which is how it survived to 0.34.0. This is another instance of **a check that
  cannot see its own failure mode**, the root anti-criterion: parity between two
  implementations proves agreement, never correctness. The same shape appears in
  §3.5 (a clean diagnostic that never ran) and §3.7 (a green suite on an
  interpreter-fallback build). When a gate's failure mode is "both sides agree
  and both are wrong", the gate is not evidence.
- Before trusting a trivia-derived assertion near a `not()`, verify against the
  offset model (§1.12), which reconstructs trivia from leaf slots and does not
  read `_triviaLog` at all.

### 3.7 A macro-FALLBACK build is not AST-equivalent to a macro-COMPILED build

The most expensive trap at this pin, reproduced in-repo — see
`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md` §1, where the CST aggregate moved with the
fallback as the only delta. A red `check-macro-buildable` **invalidates any AST/CST
differential taken on that build**, and "tests are green" does not clear it.

What triggers the fallback, from 0.32.0 source:

| Shape | Why it falls back |
| --- | --- |
| **A call to your own factory helper** (`const kw = s => word(s, B)`, then `kw('x')`) | Only callees in the evaluator's `SUPPORTED` table are recognized; anything else returns null for the whole expression (`src/plugin/evaluator.ts:506-507`) |
| **A `...spread` anywhere** — call args, arrays, object properties, the `rules()` return object | Rejected at every argument site; a non-`key: value` property in the rules return kills the whole map (`src/plugin/evaluator.ts:665`) |
| **A hoisted MODULE-level plain const** (a boundary class, a regex source string) | Module scope is populated **only** with values that evaluate to a Combinator (`src/plugin/index.ts:1126`). A plain string never enters it, so the identifier lookup returns null (`src/plugin/evaluator.ts:558`) and any null argument voids the whole call (`:513`) |
| A const **inside** the `rules()` factory body | **This is fine.** `evalBodyStatements` stores non-combinator values in the factory's local scope (`src/plugin/evaluator.ts:690`). The "hoisted consts are forbidden" rule is specifically about **module** level |
| A `rules()` factory that is not a function of exactly one identifier param | `src/plugin/evaluator.ts:735` |
| Any statement other than a `VariableDeclaration` before the `return` | `src/plugin/evaluator.ts:757` |
| A return value that is not a plain object literal | `src/plugin/evaluator.ts:771` |
| A **direct node builder** that is not macro-static | Must be an arrow function (`src/plugin/direct-builder-static.ts:49`), **expression body — no block body** (`:92, :99`), reading only its params plus a fixed global set (`:8`) |

A `many(choice(...))` held in a module-level const is **not** itself a degrader —
both are in `SUPPORTED`, and a const evaluating to a Combinator *does* enter module
scope (`src/plugin/index.ts:1126`). If such a const degrades a build, the cause is
something its expression *contains*. Bisect the expression before blaming the shape.

### 3.8 `composeLeaf` pre-final pieces cannot carry semantics — and holes count as semantics here

`src/plugin/index.ts:1052-1053` rejects any pre-final piece with
`hasDirectBuilders !== false || isRecognitionOnly !== true`. `isRecognitionOnly` is
`!hasSemanticReduction(...)` (`src/compiler/codegen.ts:4355`), which disqualifies a
piece containing **any** `transform`, gated choice, `gate()`/`withCtx`, or `node()`
with a `build` (`src/compiler/codegen.ts:4363-4378`).

Pin-specific detail: `hasSemanticReduction` takes **no `externalRefs` parameter** at
0.32.0, and an unresolvable `lazy` ref returns `true` — i.e. counts as **semantic**
(`src/compiler/codegen.ts:4374`). So a shared grammar *shape* with holes cannot be a
pre-final `composeLeaf` piece here either. That relaxation is 0.34.0 (§6).

**But `composeLeaf` may be the wrong tool.** `compose()` (non-leaf) *does* carry
semantic builders — callbacks travel as captured source. The real constraint on that
path is `src/plugin/direct-builder-static.ts`: an arrow function, expression body
only, plain identifier params, reading only its params plus a fixed 12-global
allowlist. That is a **rewritable-builder** problem, not a capability gap, and it is
worth an experiment before accepting "every grammar must be a terminal `composeLeaf`
leaf."

### 3.9 Nullability rules you will otherwise rediscover

- `many` and `sepBy` match the empty string; `oneOrMore` does not.
- `optional` never fails.
- `not()`, `gate()`, `scanTo()`, `balanced()` all have first-set `any`.
- A sequence's first-set comes from its leading non-nullable term.
- A choice is disjoint only when arms are pairwise-disjoint **and** no arm can match
  empty (`src/combinators/choice.ts:35-36`).

---

## 4. `regex()` at this pin

- `/i` **alone is the good case**: the first-set is ASCII case-folded and the arm
  still gates (`src/combinators/regex.ts:137-141`).
- **Adding `u` or `v` to a case-insensitive pattern forfeits gating.** `/iu` and
  `/iv` fold by Unicode simple case folding, which an ASCII first-set cannot
  enumerate, so parseman falls back to `any()` — sound, but dispatch is gone.
  `regex(/cafe/i)` → `{C, c}`; `regex(/cafe/iu)` → `any` **[probed]**. The rule is
  **never add `u` to a case-insensitive pattern.**
- **Literal non-ASCII in a pattern is fine *as far as parseman is concerned*.**
  `regex(/[é]+/)` and `regex(/[é]+/)` produce the identical first-set
  `{233,233}` **[probed]**; the analyzer parses `\uXXXX` and a literal char into
  the same node. Nothing in the 0.32.0 source prohibits it.

  **But this repo hard-gates it anyway, and that gate is correct.**
  `scripts/eslint-rules/grammar-rules.mjs:207-211` requires `\uXXXX`, and
  `GRAMMAR-REVIEW-STANDARD.md` §2 items 4 and 9 make it a floor-level lint
  failure. The rationale is review, not engine behaviour: *a reviewer cannot
  verify a range they cannot see*, and a raw character does not survive
  re-encoding. So: **do not cite parseman as the reason, and do comply.** The
  lint rule is autofixable; the reviewing question it protects is not.
- Real ASCII-boundary cost: the choice dispatch table is 128 entries
  (`src/combinators/choice.ts`), so a non-ASCII first char falls to a linear
  first-set scan — correct, just not O(1).

---

## 5. Where published docs disagree with the 0.32.0 source

The source wins in all three.

| Claim in published prose | 0.32.0 source |
| --- | --- |
| `literal`'s `caseInsensitive` is "locale-aware comparison" | ASCII fold only, **deliberately not** `Intl.Collator` — measured ~9× slower, and accent folding is the wrong semantic for a parser (`src/combinators/literal.ts:9, 13`) |
| `keywords({ caseInsensitive })` folds matching and first-set over the same set | **False at this pin.** Matching uses `iuy`; the first-set uses `toUpperCase`/`toLowerCase` (`src/combinators/keywords.ts:64, 75-78`). §3.1 |
| The four repetition combinators take `{ min, max }`; `oneOrMoreSep` is the non-empty separated list | **Neither exists at this pin.** Four exports, no options, no `oneOrMoreSep` (`src/combinators/repeat.ts:70, 122, 170, 196`; `src/index.ts:22`) |

Any planning document quoting a `peek()` conversion plan, a gating finding count, or
an `oneOrMoreSep` migration is quoting a **different parseman**.

**In-repo, one rule's rationale is written against a newer parseman than we pin:**

| Claim | 0.32.0 source |
| --- | --- |
| `no-hand-rolled-keyword-regex`: "`/i` without `/u` applies non-ASCII case folding incorrectly, and parseman fixed exactly that defect INSIDE the combinator — so every hand-rolled copy carries the unfixed bug" (`scripts/eslint-rules/grammar-rules.mjs:252-258`) | Inverted at this pin. That fix is **0.34.0**. At 0.32.0 the combinator is `iuy` with a `toUpperCase`/`toLowerCase` first-set, so the **combinator** over-accepts and the hand-rolled regex does not — §3.1, both directions probed. The recommendation still holds for item 8's other reasons; the correctness rationale does not |

The pattern in all four rows is the same: **prose describing the fixed version,
applied to the pinned one.** When a rationale cites a fix, check which release it
landed in before acting on it.

---

## 6. NOT AVAILABLE AT THE PIN — do not call any of this

Everything in this section is **absent from 0.32.0**. It is recorded as the argument
for bumping and must not leak into the working set. Verified by importing the pinned
build and diffing `Object.keys` **[probed]**: 0.32.0 exports 78 names; nothing listed
here is among them.

| Missing | Version | What it would buy us |
| --- | --- | --- |
| **`peek(c)`** | 0.34.0 | Positive lookahead that **carries its body's first-set**, so a leading `peek()` narrows an arm instead of poisoning it. Retires the 5 `not(not(X))` sites in the Less AST grammar (§3.3) |
| **`oneOrMoreSep(item, sep, opts?)`** | 0.34.0 | The non-empty separated list. Retires every hand-rolled `sequence(item, many(sequence(sep, item)))` from §3.4 and restores dispatch to every list-led arm |
| **`{ min, max }` on all four repeats; `{ trailing }` on separated forms** | 0.34.0 | `min >= 1` as the general non-nullability lever |
| **`word(str, opts)` with `caseInsensitive`** | 0.34.0 | The conforming spelling for ASCII case-insensitive CSS at-keywords/units, with a case-folded first-set that still gates |
| **`keywords({ caseInsensitive })` soundness fix** | 0.34.0 | Drops `u` and folds matching + first-set over the same set. **Fixes §3.1, a live correctness defect here** |
| **`not()` probe-leak fix** | 0.34.0 | Fixes §3.6 — the double-logged trivia that makes `triviaEntries()` untrustworthy around a `not()` |
| **`analyzeGatingRules(ruleMap, opts?)`** | 0.34.0 | Rule-map-level diagnostic; `analyzeGating` becomes its single-entry case |
| **Gating diagnostic runs in the macro build** | 0.34.0 | `compileRuleMap` analyses the whole rule map in one walk, attributing every choice to its owning rule. Fixes the "emits nothing" row of §3.5 |
| **`compose()`/`composeLeaf()` re-run gating over the fused winner map** | 0.34.0 | Fixes the "throws for 129 of 129 rules" row of §3.5 — the analysis finally runs where the answer exists |
| **`gating.entryName`** | 0.34.0 | Names an unnamed entry, so a warning is actionable and usable as an `accept` key |
| **Shared grammar shapes — a `rules()` map may leave holes** | 0.34.0 | A composite shape written once, each dialect binding its own rule by name. Requires the `externalRefs` relaxation §3.8 shows is absent here |
| **Ambient trivia/`scanSkip` skipping inside `scanTo`/`balanced`** | 0.33.0 | A sentinel hidden in a comment or string is no longer matched. (The `scanSkip` **option** itself does exist at the pin — §1.5) |
| **Rollback truncations guarded on a changed length** | 0.35.0 | Against 0.32.0, measured faster on every corpus — Less `benchmark.less` −3.9%, `bootstrap.css` −18.5%, jess corpus −18.5%, 12/12 interleaved pairs |
| **`parseman/run` entry** | 0.35.0 | 3 modules / 7.2 kB instead of the full entry for a package shipping a compiled grammar |
| **Deduplicated `expected` sets** | 0.36.0 | On a 106 KB Less stylesheet the oversized sets were ~⅓ of parse time |
| **`analyzeGating` swallowing-catch fix** | 0.38.0 | Removes causes (2) and (3) from §3.5 — the reason "clean" is unreportable today |
| **`analyzeDuplication()`** | 0.40.0 | Static duplicate/overlap detection across a rule map. One of the better arguments for bumping: it is exactly the cross-grammar audit we currently do by hand |

**Caveat on bumping.** 0.36.0 was measured and declined on a Less regression, and
0.40.0 corrupts CST output (231 structural nodes collapsed to bare leaves, 55 source
tokens dropped, 13 files). Two upstream defects are being fixed first. This table is
not a green light — it is the ledger of what the bump is worth once those land.

---

## 7. When the pin moves

1. Re-extract the new source. If the package still ships `dist/**/*.js.map` with
   `sourcesContent`, that is the authoritative artifact — do not read a sibling
   checkout of a different version.
2. Re-enumerate `src/index.ts` and diff the export list against the 78 recorded here.
3. Re-derive §1–§2 from signatures, not prose.
4. Re-probe §3.1, §3.2 and §3.5 — all three are version-specific by construction and
   all three have changed within a minor before.
5. Re-verify §3.7 against `src/plugin/evaluator.ts`; the macro's static-evaluation
   surface is the least stable thing in the library and the most damaging when it
   silently narrows.
6. Move whatever §6 now provides out of §6 and into the callable surface.
7. Re-check §5 — published prose has described the opposite of the code three times.
8. Update the stamp at the top, or delete the file.
