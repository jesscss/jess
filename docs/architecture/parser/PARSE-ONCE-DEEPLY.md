# Parse once, deeply — the css-parser positioning

Architecture statement for `@jesscss/css-parser`. It records *why* the parse
produces structured values and selectors in one pass, and what that trades
against PostCSS's shallower tree. It is positioning in the ledger sense of
[**Z1**](../core/DESIGN-DECISIONS.md) (Jess as the spiritual successor to
Less.js + Sass + CSS Modules + CSS-in-JS + PostCSS), narrowed to the parser.

**This document makes no measured speed claim for Jess.** The
`postcss-parse-bar` study is in flight and has not reported; see
[Measured figures](#measured-figures-not-yet-here) for the hook where its
numbers land.

## 1. The structural fact: PostCSS stops at the string boundary

Verified against the installed comparator, `postcss@8.5.23`
(`node_modules/.pnpm/postcss@8.5.23/node_modules/postcss`):

| Node surface | Type | Source |
| --- | --- | --- |
| `Declaration.value` | `string` | `lib/declaration.d.ts:118` — `get value(): string` |
| `Rule.selector` | `string` | `lib/rule.d.ts:95` — `get selector(): string` |
| `Rule.selectors` | `string[]` | `lib/rule.d.ts:113`, documented at `:100` as groups "split at commas" — not a parse |

A PostCSS parse yields a `Root`/`AtRule`/`Rule`/`Declaration`/`Comment` tree.
Inside it, a declaration's value and a rule's selector are retained as raw
strings. `selectors` is a comma split, not structure: it does not distinguish a
comma inside `:is(a, b)` or inside a quoted attribute value from a selector-list
separator.

Two companion packages exist precisely because the main parse does not produce
that structure:

- `postcss-value-parser` — installed in this repo's dependency tree at `3.3.1`
  and `4.2.0`.
- `postcss-selector-parser` — installed at `6.1.2` and `7.1.4`.

That two widely-depended-on packages exist to re-parse what the parser already
read is the observation this document is about.

**And Jess is currently one of those consumers — recorded here rather than
omitted.** `@jesscss/language-service` declares a direct dependency on
`postcss-selector-parser@^7.1.4`
([`packages/editor/language-service/package.json:34`](../../../packages/editor/language-service/package.json))
and uses it at
[`src/engine.ts:1008`](../../../packages/editor/language-service/src/engine.ts) to
compute hover specificity: it slices the selector's **bytes** back out of the
source and re-parses them. That is a §4 invariant violation inside this repo,
and it shows the failure mode in miniature — the same site must bail out when
the slice contains `@{`, `#{`, or `${` (`:999-1003`), because a byte scan cannot
see interpolation that the Jess parser already structured. It is a gap to close
against the canonical AST, not a counter-example to the argument. Tracked here;
no fix is attempted by this document.

## 2. Where the deferred work goes

The cost of parsing a value was not removed by leaving it a string. It was
**moved** — into consumers, where it recurs, and where no parse benchmark
counts it.

Verified against the installed `stylelint@17.14.1`
(`node_modules/.pnpm/stylelint@17.14.1_typescript@5.8.3/node_modules/stylelint`):

- 149 rule directories under `lib/rules/`.
- 43 of their `index.*` entry files import `postcss-value-parser`.
- 20 of their `index.*` entry files import `postcss-selector-parser`.
- The shared helper does not cache. `lib/utils/parseSelector.mjs:13` is
  `return selectorParser().astSync(selector)` — a fresh parser and a fresh
  parse on **every** call, per rule, per node. No memo, no keyed cache, no
  reuse across rules. (`lib/utils/` does contain `MemoryCache.mjs` and
  `FileCache.mjs`; neither is wired to value or selector parsing.)

So under a config enabling *n* value-touching rules, one declaration's value is
tokenized *n* times. The same holds per selector for the selector-touching
rules. The work is real, it grows as rules × nodes rather than as nodes, and it
is invisible to the benchmark that measures `postcss.parse()`.

Upstream is explicit that this is a separate measurement. `postcss/benchmark`'s
`parsers.js` ranks the deeper walk separately, as **"PostCSS Full"**, using
`postcss-selector-parser` and `postcss-value-parser` — recorded in this repo's
own harness at
[`packages/syntax/css/css-parser/test/postcss-parse-bar.mjs:456-459`](../../../packages/syntax/css/css-parser/test/postcss-parse-bar.mjs).
A "PostCSS" number and a "PostCSS Full" number are not the same measurement,
and only the first is what a parse comparison usually quotes.

**The ecosystem consequence, stated once:** because the main parse does not
produce that structure, every consumer needing it reaches for
`postcss-value-parser` or `postcss-selector-parser` independently — so the
aggregate cost is distributed across plugins and never appears anywhere anyone
would total it. That is the same shape this repo already treats as a rule: a
workaround repeated downstream is evidence of a gap upstream, not of diligent
downstream authors. It is why this belongs in an architecture document rather
than in a feature comparison table.

## 3. The shallow parse is right for one job and wrong for the other

The positioning that needs stating is not "shallow is bad." It is that
**shallow is correct for a single-purpose transform and wrong for multi-rule
analysis, and the two were never distinguished.**

- **Single-purpose transform — deferring is genuinely correct.** Autoprefixer
  touches a handful of properties. Parsing every value in the sheet to serve a
  rule that reads a few of them would be waste, and the deferral is exactly the
  right call. A transform that rewrites text and hands text back has no use for
  a value tree it would only re-serialize. For this shape, PostCSS's model is
  not a compromise; it is the correct design.

- **Broad analysis — deferring backfires.** A linter with a large config is the
  opposite shape: most nodes are touched, by many rules, each needing the same
  structure. Here the deferral does not avoid the parse, it multiplies it. The
  saving at the parse boundary is paid back with a multiplier at the consumer
  boundary.

PostCSS is used for both. The architecture was chosen for the first.

## 4. What css-parser does instead

`parse()` produces the canonical AST with selectors, at-rule preludes, and
declaration values already structured, with source spans, in the same pass —
described in the harness's own `structuralDifference` block
([`postcss-parse-bar.mjs:452-469`](../../../packages/syntax/css/css-parser/test/postcss-parse-bar.mjs), `jessAstProduces` at `:460`),
which states the difference so the ratio is interpretable and explicitly
declines to apply it as a handicap.

This is not a parser-local preference. It is the repo's keystone rule, already
enforced internally: **the parser owns structure, and neither side re-derives it
from bytes** — [`SEMANTIC-INVARIANTS.md` §6](../SEMANTIC-INVARIANTS.md), ledger
row **C2** ("the parser is the SOLE source of structure; core NEVER re-derives
structure from bytes"). The invariant exists because re-derivation is not merely
wasteful, it is lossy in a way that changes semantics: a byte scan cannot
distinguish a structural token from the same character inside a string. The
canonical probe is `:not([title="&"])`.

A consumer of `@jesscss/css-parser` therefore inherits the same guarantee
external consumers of PostCSS do not get: the structure is already there, so
reading it is a tree walk, not a re-parse.

**The expected consequence** — reasoning, not measurement — is that the
crossover favours parsing once as the number of structure-touching rules grows,
because the deep parse is paid once per node while the shallow parse defers a
cost paid once per rule per node.

## 5. Counter-considerations

These are load-bearing. A positioning that lists only advantages will not
survive contact with the numbers.

1. **Deep parsing costs more up front, so there is a crossover point.** Below
   some number of structure-touching rules, PostCSS's deferral wins outright,
   and for a single-purpose transform it wins by a lot (§3). Where that
   crossover sits is an empirical question this document does not answer.

2. **Jess's AST materializes lazily, which narrows the advantage.** Several
   selector facts are serializer-owned memos computed on demand — verified in
   `packages/core/src/ast/nodes.ts`, the fields documented `(lazy)` at
   `:671, :683, :686, :802, :805, :808, :820, :823, :826`. Value-domain
   materialization is likewise deferred rather than eager (**recorded as an
   owner decision; not cited to a line here — UNVERIFIED in this document**).
   So "the structure is already there" is partly "the structure is cheap to
   obtain, once." How much of the advantage survives depends on how much of the
   tree a given consumer actually touches: one touching very little of it
   narrows the gap, one touching most of it widens it. That also means the
   parse-once claim is about *avoided repetition*, not about the structure being
   free.

3. **The comparison is between two different trades, measured on different
   axes.** A parse-only benchmark understates PostCSS's total cost for an
   analysis workload and understates Jess's advantage; a full-walk benchmark on
   a workload that touches almost nothing would do the reverse. Any figure
   quoted here must name which workload it measured.

4. **UNVERIFIED, and deliberately not asserted:** that the aggregate re-parse
   cost is *large* in absolute terms for a real stylelint config. The recurrence
   is verified (§2); its magnitude is not, and this document does not claim it.

## 6. What this document does not claim

- **No measured speed claim for Jess.** Not "faster than stylelint," not
  "faster than PostCSS." The expected consequence in §4 is reasoning from the
  architecture and is labelled as such.
- **No claim about anyone's intent, motives, or marketing.** Every statement
  above is about API shape, import counts, and cache behaviour, all citable in
  the installed packages. A reader who prefers PostCSS should find each sentence
  accurate.
- **No claim that PostCSS's authors got it wrong for their target.** §3 says the
  opposite for the transform case.

## Measured figures (not yet here)

The standing bar lives in this repo and is designed for exactly this question:

```sh
pnpm --filter @jesscss/css-parser build          # measure the BUILT lib/
pnpm --filter @jesscss/css-parser bar:postcss    # or --gate against the baseline
```

`test/postcss-parse-bar.mjs` reports an absolute committed baseline as a ratio
against an in-run PostCSS comparator, interleaved A/B in one process, with a
noise floor and a `gateQuality` verdict. It reports parse-only today.

**Hook — fill these in when the study lands:**

| Figure | Status |
| --- | --- |
| Jess `parse()` vs `postcss.parse()`, parse-only ratio | pending |
| Jess `parse()` vs PostCSS + `postcss-value-parser` + `postcss-selector-parser` ("PostCSS Full") | pending |
| Crossover: structure-touching rule count at which parsing once wins | pending |
| Fraction of the Jess AST actually materialized on a lint-shaped walk | pending |

Until each row carries a number and the commit it was measured at, the claim it
supports stays unstated rather than hedged.

## See also

- [`packages/lint/README.md`](../../../packages/lint/README.md) — the Stylelint
  comparison from the lint side; it covers rule coverage and migration, and
  deliberately does not restate the parser argument.
- [`lint-roadmap.md`](../lint-roadmap.md) — the single tracking doc for Jess
  diagnostics, including the PostCSS parser oracles and Stylelint harnesses.
- [`SEMANTIC-INVARIANTS.md` §6](../SEMANTIC-INVARIANTS.md) — the parser-owns-structure
  invariant and its open re-derivation debt inside `packages/core/src/ast`.
- [`DESIGN-DECISIONS.md`](../core/DESIGN-DECISIONS.md) rows **C2** and **Z1**.
