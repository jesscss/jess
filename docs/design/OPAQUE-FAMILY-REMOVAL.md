# The `Opaque*` family is on the chopping block

Base: `aa35abddb8907dd1efb5e27118966a5946c1278a`.

This is a record, not a plan that has been approved and not work that has been
scheduled. It exists because the owner ruled the whole `Opaque*` family a
violation of the grammar hard rules and asked for it written down before anyone
touches it. Everything here is OPEN.

## 0. The governing principle

**An unknown at-rule still parses known rules. Duplicating rules at that site is
not allowed.**

Comments, strings, blocks, declarations and rulesets inside an unknown at-rule's
body are the same constructs they are anywhere else, and they parse as
themselves through the ordinary productions. What an unknown at-rule adds is
**tolerance for unknown tokens** — one escape arm — not a second implementation
of CSS.

The current model is the opposite: the unknown at-rule body is a private
mini-language with its own text, comment, string, group and stray-quote
recognisers, and its own prelude recognisers on top of that. Every one of those
constructs already has a production in the grammar that recognises it.

## 1. Which hard rules this violates

From [`../architecture/parser/GRAMMAR-REVIEW-STANDARD.md`](../architecture/parser/GRAMMAR-REVIEW-STANDARD.md):

- **Rule 3 — a grammar may not define any shape that exists in the CSS grammar
  already and could have been used.** `OpaqueBodyComment` is `blockComment`,
  which the CSS grammar already carries at `css-parser/src/grammar.ts:842` and
  classifies as trivia. `OpaqueBodyQuoted` is `choice(doubleQuoted,
  singleQuoted)`, which is `Quoted` (`css-parser/src/grammar.ts:1804`).
  `OpaqueGroup` is a brace-delimited block, which every body block in the file
  already spells (`declarationListBlock:3758`, `stylesheetBodyBlock:3760`,
  `descriptorBodyBlock:3757`, `conditionalGroupBodyBlock:3759`).
- **Rule 4 — a construct may not get a new rule name because it is being parsed
  in a different context.** A comment is a comment wherever it appears. Naming
  it `OpaqueComment` because it sits inside an unknown at-rule's body is the
  `LiteralQuoted` move the rule forbids. The standard's own naming section says
  this directly: *"Do not prefix a child with its caller"*, and *"Public node
  labels and shared rule references like `StaticValueQuoted` … are findings"*.
- Consequential, same section: **rule 16 / naming as a duplication mechanism.**
  Less carries `lessOpaqueBodyBrace`, `lessOpaqueBodyCapture` and
  `lessOpaqueAtPreludeText` — a dialect prefix asserting a divergence that has
  not been shown.

Owner, verbatim:

> "There's also no such fucking thing as 'OpaqueComment'!!!!! There should only
> be Comment!!! (Or Comment and LineComment, depending on how it's structured)"

> "Also no such thing as OpaqueString, etc etc etc"

> "An unknown at rule still PARSES KNOWN RULES... Duplicating rules at that site
> is not fucking allowed."

## 2. The family, enumerated

### 2.1 `packages/parser-shared/src/opaque-at-rule.ts`

| symbol | line | what it is |
| --- | --- | --- |
| `opaqueText` | 50 | body text regex — a private token language |
| `opaqueStray` | 51 | unpaired `'`/`"` escape arm |
| `OpaqueAtRulePreludeCapture` | 65 | `scanTo({`/`;`) — flat prelude scan |
| `OpaqueAtRuleBodyCapture` | 72 | `scanTo(})` — flat body scan |
| `OpaqueBodyText` | 76 | duplicate of the token/text language |
| `OpaqueBodyComment` | 77 | duplicate of `blockComment` |
| `OpaqueBodyQuoted` | 78 | duplicate of `Quoted` |
| `OpaqueBodyStray` | 79 | unpaired-quote escape arm |
| `PreprocessorOpaqueAtRulePreludeCapture` | 86 | SCSS/Jess flat prelude scan |
| `PreprocessorOpaqueAtRuleBodyCapture` | 99 | SCSS/Jess flat body scan |

`blockComment:10`, `lineComment:11`, `escape:12`, `doubleQuoted:13`,
`singleQuoted:18` in the same file are further copies of terminals the four
grammars each already define; they are the raw material the family is built
from and belong in the same review.

### 2.2 `packages/syntax/css/css-parser/src/grammar.ts`

| symbol | line | what it is |
| --- | --- | --- |
| `opaqueBodyText` (helper) | 299 | re-joins the parts back into the bytes the flat capture used to hand over |
| `OpaqueAtPrelude` | 3157 | flat prelude node; the real prelude production is `AtRulePrelude` |
| `OpaqueGroup` | 3180 | brace-delimited group |
| `OpaqueComment` | 3189 | comment |
| `OpaqueString` | 3194 | string |
| `OpaqueBodyPart` | 3199 | the choice over the five arms |
| `OpaqueBody` | 3206 | `many(OpaqueBodyPart)` |
| `OpaqueAtRuleBlock` | 3211 | the block node |
| `opaqueAtRuleOtherwise` | 3953 | the dispatch arm, used at 3979 and 4003 |
| `otherwise(g.OpaqueAtRuleBlock)` | 4047 | the conditional-group dispatch arm |

Rule-name surface: `GrammarRuleName` lines 184–196. AST guard
`isOpaqueAtRuleBlock` at 528, reached from 645.

**Pre-existing precedent, in scope for the same reason.** The `AtRulePrelude*`
family at 3059–3103 — `AtRulePreludeWhitespace`, `AtRulePreludeComma`,
`AtRulePreludeGroup`, `AtRulePreludeQuoted`, `AtRulePreludeText`,
`AtRulePreludeSegments` — is the same pattern one construct over: a private
whitespace/comma/group/string/text mini-language, each member prefixed with its
caller. `a80abe1f9` did not invent the shape; it copied a shape already in the
file. Whoever removes the body family should not leave the prelude family
standing.

### 2.3 `packages/syntax/less/less-parser/src/grammar.ts`

Less does **not** compose `parser-shared/opaque-at-rule.ts`. It carries a
fourth, dialect-prefixed copy:

| symbol | line |
| --- | --- |
| `lessOpaqueBodyBrace` | 2377 |
| `lessOpaqueBodyCapture` | 2381 |
| `lessOpaqueAtPreludeText` | 5563 |
| `lessOpaqueAtPreludeCapture` | 5564 |
| `OpaqueAtPrelude` | 5644 |
| `OpaqueBody` | 5655 |
| `OpaqueAtRuleBlock` | 5682 |

Interface slots at 246, 247, 251; export list at 6829–6834; dispatch use at
4682; AST guard at 2218.

### 2.4 `packages/syntax/scss/scss-parser/src/grammar.ts`

| symbol | line |
| --- | --- |
| `OpaqueAtPrelude` | 5690 (over `PreprocessorOpaqueAtRulePreludeCapture`) |
| `OpaqueBody` | 5698 (over `PreprocessorOpaqueAtRuleBodyCapture`) |
| `OpaqueAtRuleBlock` | 5723 |
| `OpaqueAtRuleStatement` | 5753 |

Interface slots 199–203; guard 1214; dispatch use 3377, 3477, 3492, 5857;
exports 5990–5994.

### 2.5 `packages/syntax/jess/jess-parser/src/grammar.ts`

| symbol | line |
| --- | --- |
| `OpaqueAtPrelude` | 5596 |
| `OpaqueBody` | 5604 |
| `OpaqueAtRuleBlock` | 5609 |

Interface slots 220–222 and 269–270; guard 1163; use at 4960, 5009, 5035, 5532,
6314, 6374; exports 6472–6474.

### 2.6 Consumers

- AST node and factory: `packages/core/src/ast/at-rule.ts:64` (`OpaqueAtRuleBlock`
  interface), `:99` (`opaqueAtRuleBlock`).
- Kind registry: `packages/core/src/ast/node.ts:68`, `:91`, `:114`.
- Traversal: `packages/core/src/ast/traversal.ts:476`, `:541`.
- Serialization: `packages/core/src/ast/serialize.ts:12207` (`emitOpaqueAtRuleBlock`)
  and its nine call sites.
- Tests: `packages/core/src/ast/__tests__/opaque-at-rule-block.test.ts`,
  `packages/syntax/css/css-parser/test/opaque-at-rule-body.test.ts`,
  and the `Opaque` assertions in each dialect's `ast-grammar.test.ts` /
  `public-parse.test.ts` / `discovered-constructs.test.ts`.

## 3. The AST shape changes, and that is the correction

`OpaqueAtRuleBlock` reduces to

```
opaqueAtRuleBlock(name, prelude: string | null, rawBody: string)
```

**That flat `rawBody: string` is not an owner-sanctioned design.** It is on the
chopping block with the rest of the family, and for the same reason: it is the
AST-side expression of "an unknown at-rule body is a run of bytes", which is the
premise being rejected. Do not read this section as a cost to be weighed against
an endorsed status quo — there is no endorsed status quo here to protect.

So: **the AST shape will change, and the owner has confirmed that is correct.**
Whoever takes this up does not need a ruling on *whether* to change it. What is
still open is the resulting shape, and how the change is evidenced — a shape
change cannot land silently.

Where the change surfaces: `core/src/ast/at-rule.ts:64` and `:99`, the kind list
in `core/src/ast/node.ts:68/:91/:114`, `traversal.ts:476`, `serialize.ts:12207`
and its nine call sites, and every dialect grammar's interface slot listed in §2.

On evidence:

- **Kind count moves** if `OpaqueAtRuleBlock` folds into `AtRuleBlock`. The
  standing constraint elsewhere is 45; a fold is a deliberate reason for that
  number to move, not a number to force the design around.
- **Byte-identity cannot be the gate.** The change is intended to move the tree,
  so `oracle:less:byte-identity` will report differences and those differences
  are the deliverable. The gate has to be a positive statement about the new
  shape, not an unchanged-aggregate check.
- **The byte-identity oracle is blind to this production regardless.** Deleting
  the `OpaqueComment` arm from `a80abe1f9` leaves all six of that oracle's
  assertions green, including its four negative controls, because its
  real-world corpus contains no unknown at-rule with a comment in its body. The
  only instrument that currently sees this surface is
  `packages/syntax/css/css-parser/test/opaque-at-rule-body.test.ts`, whose own
  controls are: removing the comment arm moves 2 of its 37 cases, removing the
  group arm moves 5.
- **Four dialects, one fix.** Per §0 of the review standard the shape belongs in
  the CSS base; Less, SCSS and Jess must not restate it. Today all four restate
  it, and Less does so twice over with its own prefixed copies.

## 4. Open questions — recorded, not resolved

### 4.1 Which ordinary body production is the reuse target? OPEN

Evidence gathered so far:

- Known at-rules already choose their body by context, and the choice is already
  factored: `routedStylesheetBody` (`css-parser/src/grammar.ts:3774`) over
  `stylesheetBodyBlock:3760`, and `routedDeclarationListBody:3773` over
  `declarationListBlock:3758`. `LayerBlock:3775` and `NestedLayerBlock:3783` are
  the same at-rule taking each in its own context.
- The unknown at-rule is the one arm that ignores that split.
  `opaqueAtRuleOtherwise:3953` is the `otherwise` of **both**
  `StylesheetAtRule:3957` and `DeclarationListAtRule:3980`, and
  `ConditionalGroupAtRule:4002` uses a bare `otherwise(g.OpaqueAtRuleBlock)`.
  Three different contexts, one context-free body.
- So the likely answer is *"both, chosen by context"* — exactly as for known
  at-rules — but that is unverified.
- **The complication, unresolved:** `stylesheetBodyBlock` is
  `choice(ConditionalBlock, StylesheetAtRule, TopLevelRuleset)` and admits no
  declarations. Real unknown at-rules at stylesheet level are frequently
  declaration-bodied (`@viewport`, `@-ms-viewport`, vendor descriptor rules), so
  a straight reuse of `stylesheetBodyBlock` would *reject* sources that parse
  today. Whether the right answer is the declaration-list body at every context,
  a nesting-style permissive body, or a genuine context split, is the open
  question.
- The prelude has the same question in smaller form: `OpaqueAtPrelude` should
  plausibly be `AtRulePrelude` (`css-parser/src/grammar.ts:3773` consumers,
  built on `AtRulePreludeSegments:3091`), but `AtRulePreludeSegments` is itself
  the mini-language named in §2.2.

### 4.2 What must the escape arm genuinely cover? OPEN

Not measured. The measurement was not run — this record was cut before a build.
What is known:

- The 37 adversarial cases in
  `packages/syntax/css/css-parser/test/opaque-at-rule-body.test.ts:106–147` are
  the corpus to measure against. They already include the hard shapes:
  unterminated comment (`@foo { /* unterminated`), unpaired quotes
  (`@foo { a: " }`), an escaped brace (`@foo { a: b\}c }`), a brace inside a
  function (`@foo { a: fn(}) }`), a brace inside brackets (`@foo { x[}] }`), and
  a body that is not a declaration at all (`@foo { a}b }`).
- The `opaqueStray` arm exists because the flat `scanTo` walked past an unpaired
  quote as an ordinary byte; any replacement that drops it stops parsing bodies
  that parse today.
- The measurement to run: for each case body, determine whether the ordinary
  body productions accept it, and report the residue. The expectation stated by
  the owner is that the residue is small; that expectation is untested.

## 5. Provenance

`a80abe1f9` — *"feat(css): an unknown at-rule body is a simple block, not a run
of bytes"* — added `OpaqueGroup`, `OpaqueComment`, `OpaqueString`,
`OpaqueBodyPart`, `OpaqueBodyText`, `OpaqueBodyComment`, `OpaqueBodyQuoted`,
`OpaqueBodyStray`, `opaqueText`, `opaqueStray` and `opaqueBodyText`. It is on
`dev`.

I dispatched and approved that commit. It built the parallel mini-grammar, and
it did so four hours after the four hard rules became law in
[`../architecture/parser/GRAMMAR-REVIEW-STANDARD.md`](../architecture/parser/GRAMMAR-REVIEW-STANDARD.md).
The review I ran did not test the new productions against rules 3 and 4, which
is precisely what those rules are for. The owner caught it.

**Reverting `a80abe1f9` is a live option** for whoever takes this up. It returns
the CSS body to the single flat `OpaqueAtRuleBodyCapture` terminal, which is
still a violation of §0 but a smaller one, and it removes eleven of the symbols
in §2 without touching the AST. The design note it added,
[`UNKNOWN-AT-RULE-BODY.md`](./UNKNOWN-AT-RULE-BODY.md), argues the spec case for
a structured body; that argument is about *whether the body has an interior*, and
is orthogonal to *whether the interior may be a private copy of CSS*. It does not
survive as a defence of the naming.
