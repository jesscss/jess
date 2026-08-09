# The unknown at-rule body: opaque, but structurally tracked

Base: `99197fff017383668fc1f9aeda1f9e689de3614d`.
Proof of concept: `packages/syntax/css/css-parser/src/grammar.ts`,
`packages/parser-shared/src/opaque-at-rule.ts`,
`packages/syntax/css/css-parser/test/opaque-at-rule-body.test.ts`.

## 0. What changed, in one line

An unknown at-rule's block is still opaque — no declaration, no rule, no
meaning — but the CST now carries its brace nesting, its strings and its
comments as nodes with spans, instead of one flat run of bytes.

## 1. The spec, checked rather than relayed

Two readings were put to me and neither survived intact, so this section is
quoted from css-syntax-3 rather than summarised from memory.

*Consume an at-rule* on a `{`:

> "Consume a simple block and assign it to the at-rule's block. Return the
> at-rule."

*Consume a simple block* produces a block "with its value initially set to an
empty list" and appends component values to it. The result is a list of
component values.

And on what that list means:

> "This specification places no limits on what an at-rule's block may contain.
> Individual at-rules must define whether they accept a block, and if so, how
> to parse it."

So the split is:

- The block's **syntactic** structure IS defined — a balanced simple block of
  component values. Recognising braces, strings and comments inside it is not
  speculation; it is what the spec says the block is.
- The block's **semantic** structure is delegated, and nothing delegates it for
  an unknown at-rule. Asserting "these component values are a rule list" would
  be a guess.

This is why the first framing of this task — *speculatively try a declaration
list, fall back to opaque, and mark the result as inferred* — is not the design
that landed. Under it, `@foo { .a { b: c } }` would produce a `Ruleset` node
that no specification licenses, and the provenance marker existed only to warn
consumers about a claim the parser should not have made. Recognising the simple
block makes no claim, so **there is no provenance to record**: no node field,
no new node kind, core AST kind count stays 45. A marker was designed and has
been removed.

## 2. The model: the custom-property construction, and what it actually is

The owner named custom properties as the model — *"basically kind of how custom
properties should work"* — and that is the right shape, with one correction
worth recording because it changes what the work was.

`CustomValue` in the CSS grammar (`css-parser/src/grammar.ts:1729-1733`) is
`scanTo` with balanced skips under `rootCapture: 'opaque'`, and its reducer is
`any(tokenText(children[0]))` — **a flat string**. The structured
`CustomPart`/`CustomGroup` family exists only in the Less, SCSS and Jess
grammars (`less-parser/src/grammar.ts:3821-3866`), and even there the AST
reducer `customValueFromParts` (`:1231`) collapses the parts back to a flat
`any(...)` unless an `Interpolation` or `VariableReference` was lifted out of
them. The parts model is there to host dialect leaves, not to expose structure.

Meanwhile `OpaqueAtRuleBodyCapture`
(`parser-shared/src/opaque-at-rule.ts:50-53`) was **already** a balanced-aware
scan with the identical skip set: `blockComment`, `escape`, `doubleQuoted`,
`singleQuoted`, and a `balanced('{','}')` over the same skips. Braces already
balanced. Strings and comments already inert.

So the gap was never in the scan. It was that the scan's result is one terminal,
which means the CST — the surface the language service reads — sees a single
opaque leaf where the bytes have known structure. That is what this change
closes, and it closes it in the CST only.

## 3. The productions

Recognition-only, added beside the captures they mirror
(`parser-shared/src/opaque-at-rule.ts`):

| rule | shape |
| `OpaqueBodyText` | `regex(/(?:\\[\s\S]\|\/(?!\*)\|[^\\/'"{}]+)+/)` — bytes up to a structural delimiter, absorbing escapes and a lone `/` |
| `OpaqueBodyComment` | the existing `blockComment` |
| `OpaqueBodyQuoted` | the existing `doubleQuoted` / `singleQuoted` |
| `OpaqueBodyStray` | `regex(/['"]/)` — an unpaired quote |

Nodes, in the CSS grammar (`css-parser/src/grammar.ts:3173-3203`):

| rule | shape |
| `OpaqueGroup` | `noTrivia(sequence(literal('{'), many(g.OpaqueBodyPart), literal('}')))` |
| `OpaqueComment` | `g.OpaqueBodyComment` |
| `OpaqueString` | `g.OpaqueBodyQuoted` |
| `OpaqueBodyPart` | `choice(text, comment, string, group, stray)` |
| `OpaqueBody` | `noTrivia(many(g.OpaqueBodyPart))` |

The `blockComment`/`doubleQuoted`/`singleQuoted` terminals are the ones the
scan already used. Nothing about balanced-group scanning is respelled — the
today's-lesson failure mode, where two sites re-spelled `balanced('(' ,')')`
inline and lost the shared `customSlash` skip so a lone `/` truncated the group,
is avoided by the `\/(?!\*)` arm inside `OpaqueBodyText` carrying that same job
and by reusing the shared terminals verbatim.

Three deliberate non-improvements:

- **`(` and `[` are not balanced**, so `@foo { a: fn(}) }` still truncates at
  the `}` inside the parens. The replaced scan did not balance them either. A
  capture that agreed with the spec but disagreed with the scan it replaces
  would change which sources parse, and that is the one thing this change may
  not do. Fixing it is a separate, non-additive decision.
- **`OpaqueBodyStray` is load-bearing.** `scanTo` walks past a quote whose
  partner never arrives by treating it as an ordinary byte. Without this arm
  `@foo { a: " }` — which parses today — would stop parsing.
- **No dispatch arm was added.** The production is reached only through the
  existing `otherwise(g.OpaqueAtRuleBlock)`, which is why the ~1.4 MB per-arm
  inlining cost documented at `grammar.ts:2620-2631` is not in play here.

## 4. What a consumer gains, and what it still does not get

Gains, in the CST:

- **Brace nesting.** `OpaqueGroup` nodes nest to arbitrary depth, each with a
  span. A language service can fold `@foo { .a { … } }`, match brackets inside
  it, and find the innermost group containing the cursor.
- **String extents.** `OpaqueString` spans mean a `}` inside a quoted value is
  visibly a string, not a block terminator.
- **Comment extents.** `OpaqueComment` spans make body comments findable — the
  AST still drops them, which `test/selector-span-trivia.test.ts` pins as a
  known defect, but the CST no longer hides where they were.

Not gained, deliberately:

- **Nothing knows `.a { b: c }` is a rule.** It is `OpaqueBodyText` followed by
  an `OpaqueGroup`. No selector, no declaration, no property, no value.
- **The AST is unchanged.** `OpaqueAtRuleBlock` still carries `name`, `prelude`
  and a flat `rawBody: string`; `walkOpaqueAtRuleBlock`
  (`core/src/ast/traversal.ts:476`) still visits nothing, and
  `emitOpaqueAtRuleBlock` (`core/src/ast/serialize.ts:12152`) still prints
  `rawBody` verbatim. That is what makes the change provably additive, and it is
  also the honest limit: an AST consumer gains nothing from this change.

## 5. Cost

Measured on this machine, steady state, `parse()` only, this build vs a build
with only `OpaqueBody` reverted to the flat capture:

| input | flat capture | structured | delta |
| `packages/jess/benchmark/benchmark.css` (123 kB, **zero** unknown at-rules) | 7.59 ms | 7.59 ms | none measurable |
| 2000 unknown at-rule blocks (110 kB, **100%** unknown at-rules) | 2.99–3.26 ms | 4.19–4.43 ms | ~+38% |
| `lib/grammar/ast.js` | 2,419,630 B | 2,419,554 B | −76 B |

The hot path is untouched, which is the structural claim and not merely the
measurement: no dispatch arm was added, so no tail was re-inlined, and the size
figure confirms it. The ~38% is the cost of recursive-descent parts with node
allocation versus a single linear scan, on input that is nothing but unknown
at-rules — a pathological upper bound, not a workload.

First-run figures of ~22 ms/parse appeared immediately after a compile and did
not reproduce; the numbers above are the second and later runs.

## 6. Scope: which bodies this reaches

**Reached.** Every site that routes to `OpaqueAtRuleBlock`: the
`opaqueAtRuleOtherwise` arm shared by `StylesheetAtRule` and
`DeclarationListAtRule`, and `otherwise(g.OpaqueAtRuleBlock)` in
`ConditionalGroupAtRule` (`:4032`). So `@foo { … }` at top level, nested in a
style rule, and nested in `@media`/`@supports`/`@container` all gain the
interior.

**Not reached, and a separate finding.** Three body grammars have no generic
at-rule STATEMENT arm at all, so an unknown at-rule *without* a block is a hard
error where the same at-rule *with* a block parses. Confirmed at this SHA:

```
@media all{@foo;}              => ERROR  Expected: "{".
@media all{@foo bar{a{b:c}}}   => OK
@page{@foo;}                   => ERROR  Expected: ";", "}".
@font-feature-values x{@foo;}  => ERROR  Expected: ";", "}".
```

`ConditionalGroupAtRule` (`:4032`), `pageBodyItem` (`:3703`) and
`fontFeatureValuesBodyBlock` (`:3706`) each need a `RoutedAtRuleStatement`-style
arm. That is additive in the same sense and independent of this change; it is
not in this PoC because it is an acceptance change, and this one is not.

**Dialects.** This lands in the CSS base only. The grammars are copies, not a
shared inheritance, and Less/SCSS/Jess route their opaque bodies through
`PreprocessorOpaqueAtRuleBodyCapture` — a different skip set (`//` line
comments) and a different sentinel (`$`). Porting is a per-dialect copy of §3
with the preprocessor terminals substituted, and each dialect needs its own
differential. Nothing here changes their behaviour: their suites are unchanged
at 724 / 618 / 510.

## 7. Why the byte-identity oracle is not the evidence here

`test/byte-identity.test.ts` is the strongest instrument in the package and it
is **blind to this production**. Deleting the `OpaqueComment` arm — which
truncates `@foo { a: b; /* } */ c }` at the comment and breaks the parse — left
all six of its assertions green, including its own four negative controls. Its
corpus contains no unknown at-rule with a comment in its body. Quoting its green
run as evidence for this change would be a null result.

The instrument that does see it is
`test/opaque-at-rule-body.test.ts`: an independent re-implementation of the
replaced flat capture, written from that algorithm rather than from the grammar,
run over 37 adversarial cases. Its controls: removing `OpaqueComment` moves 2
cases, removing `OpaqueGroup` moves 5, and the test asserts its own corpus is
non-empty.
