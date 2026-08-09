# Grammar review standard

The standing brief for work on the four surviving grammar files. Attach it to
the task; do not reconstruct it.

Each dialect now has one host-mode grammar source:

- `packages/syntax/css/css-parser/src/grammar.ts`
- `packages/syntax/less/less-parser/src/grammar.ts`
- `packages/syntax/scss/scss-parser/src/grammar.ts`
- `packages/syntax/jess/jess-parser/src/grammar.ts`

Rule counts drift too quickly to belong here. Re-measure the exact file under
review with the same method you intend to use for the change.

These grammars are parseman's reference implementation. "Exemplary" has been
asked for repeatedly and has not stuck, because _make it good_ is not checkable
and a passing test ends the job. This document replaces that instruction with
sixteen questions and a rule about how many things you ask them of.

---

## The four hard rules

**Owner, verbatim. These are the law the rest of this document serves. No agent
is allowed to violate them.**

> The hard rules that no agent is allowed to violate:
>
> 1. CSS grammar defines all regular CSS
> 2. Each downstream grammar MUST extend CSS grammar (import and compose)
> 3. Each downstream grammar may ONLY define specific overrides. (It may not
>    define ANY shape that exists in css-grammar already and could have been
>    used.)
> 4. Each downstream grammar MAY NOT create a new rule just because it's
>    changing PARSING for that rule. e.g. a Quoted in CSS is still a Quoted in
>    every other language, even though it adds interpolation.

They rank above every item in §2 and every constraint in §3. If a checklist item
appears to permit something a hard rule forbids, the hard rule wins and the
checklist item is the defect.

**Rule 4 restated, because it is the one that gets rationalized away.** A
`Quoted` in CSS is still a `Quoted` in every other dialect. Adding interpolation
changes how it PARSES; it does not make it a different rule. Splitting `Quoted`
into `LiteralQuoted` plus an interpolating form is forbidden — the superset
**overrides** `Quoted`, it does not fork it.

**The burden of proof sits on the superset, always.** A construct that genuinely
does not exist in CSS — a mixin call, a Sass control directive — is a NEW rule
and is fine. A construct that exists in CSS and is being parsed differently is an
OVERRIDE and must keep the CSS name. When in doubt, it is an override. The
superset must prove CSS has no rule for the construct; CSS is never asked to
prove it does.

No exception to these four has been granted. If you believe one is structurally
necessary, record it as an OPEN QUESTION for the owner in
`docs/architecture/core/DESIGN-DECISIONS.md` — do not grant yourself a carve-out
and do not write one into this file.

### An agent may not redefine, narrow, or close an owner requirement

**When a requirement conflicts with a tool constraint, a technical limit, or an
implementation difficulty, the agent STOPS AND ESCALATES.** It may record the
constraint, the evidence, the options and a recommendation. It may NOT record
the decision.

Specifically forbidden (`CLOSURE-QUOTED:` — the phrasings below are quoted as
prohibitions, not used):

- rewriting a requirement into something achievable;
- narrowing its scope so the constraint no longer binds;
- writing "this is settled" / "do not re-propose" / "do not revisit" / "do not
  reopen" about anything the owner asked for. (`CLOSURE-QUOTED:`)

**Writing "settled" about an owner requirement is itself the violation**,
because it removes every later agent's permission to reopen it. Only the owner
closes an owner requirement.

**Corollary.** A commit that removes a shared mechanism must say so in its body.
The fold that dropped `compose()` had a one-line message.

This is not advice. The standing owner requirements are recorded verbatim in
[`../../OWNER-REQUIREMENTS.md`](../../OWNER-REQUIREMENTS.md) with stable IDs, and
`pnpm check:guardrails` fails the build on (a) any edit to that file and (b) any
closure directive in `docs/`, `.cursor/rules/`, `CLAUDE.md` or `AGENTS.md` that
does not carry an attribution marker — `OWNER-RULED: <date>`, `AGENT-EVIDENCE:`
(an agent closing its OWN measured proposal), `OWNER-LEDGER:` (the authority is a
DESIGN-DECISIONS row), or `CLOSURE-QUOTED:` (the block quotes a closure to state
this rule or repudiate it). An
`AGENT-EVIDENCE:` marker may not be used in a block that names an `OR-*`
requirement.

The live instance this rule was written for is `GRAMMAR-REBUILD-SPEC.md` §0.5
and §12.0: the parseman `direct-builder-static` constraint is real, the
conclusion drawn from it — that hard rule 2 does not apply — was not the agent's
to draw, and both sites are now marked OVERRULED and UNRESOLVED pending an owner
ruling.

### Current reality: the rules are violated wholesale

Recorded so nobody has to rediscover it. Every claim below is re-checkable at
`fb272dfc1`.

**Rule 2 is not met at all — no superset imports another grammar's
productions.** The `* CSS base: ../../../css/css-parser/src/grammar.ts` line at
the top of each superset is a COMMENT inside the opening docblock, not an
import: `less-parser/src/grammar.ts:4`, `scss-parser/src/grammar.ts:4`,
`jess-parser/src/grammar.ts:4`. Grepping the three superset grammars for a
reference to `cssGrammar`, `lessGrammar`, `cssRules`, or any `*-parser/grammar`
import returns nothing but their own local `rules<XRules>` types and
`composeLeaf` lines.

**What IS shared is token recognition only, and that is the distinction the word
`compose` in the code has been hiding.** Each grammar ends in a `composeLeaf`
over recognition tables plus its own `rules(...)` map — css/scss/jess over
`[cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, …]`
(`css-parser/src/grammar.ts:4288`, `scss-parser/src/grammar.ts:6005`,
`jess-parser/src/grammar.ts:6560`) and less over `[cssSyntax, lessSyntax,
cssPseudoSyntax, …]` (`less-parser/src/grammar.ts:6805`). `cssSyntax`
(`packages/parser-shared/src/recognition.ts:515`) is a table of TERMINALS —
`Identifier`, `AttributeOperator`, `DoubleQuotedText`, `SingleQuotedText`,
`UrlOpen`, `SimpleSelectorToken`. **Terminals compose; productions do not.**
Sharing a token table is not extending a grammar, and a `composeLeaf` line is
not evidence of rule 2 being met.

**It used to compose productions, and that is checkable.** Before `59f695d4a`
(2026-07-27, `refactor(parser): fold dialect grammars to host mode`),
`scss-parser/src/grammar.ts` read `export const scssGrammar = compose([
lessGrammar, cssAstSyntax, rules(…)])` at `:47`, with `import { lessGrammar }
from '@jesscss/less-parser/grammar'` at `:9` and a docblock at `:14` saying
"SCSS = Less + the SCSS delta. `compose` fuses the imported compiled…". Note
what it composed on: **Less, not CSS** — which rules 1 and 2 now forbid. If
production-level composition returns it must be `compose([cssRules, …])`.

**Rule 4 has measured violations today, and they are FAILS, not stylistic
drift.** Seven names in the supersets for rules CSS already spells, each
verified in the file at `fb272dfc1`:

| superset name       | where                                                        | CSS already has                          |
| ------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| `LiteralQuoted`     | less `:2767`, scss `:1598`, jess `:2540`                     | `Quoted` (`css-parser` `:1775`)          |
| `Compound`          | scss `:5537`, jess `:6188`                                   | `CompoundSelector` (`:1598`)             |
| `Complex`           | less `:6201`, scss `:5574`, jess `:6216`                     | `ComplexSelector` (`:1635`)              |
| `ComplexTail`       | less `:6229`, scss `:5561`, jess `:6203`                     | `ComplexSelector` (`:1635`)              |
| `Selector`          | less `:6239`, scss `:5603`, jess `:6245`                     | `SelectorList` (`:1676`)                 |
| `SelectorTail`      | less `:6234`, scss `:5585`, jess `:6227`                     | `SelectorList` (`:1676`)                 |
| `KeyframeSelector`  | less `:5299`, scss `:5102`, jess `:5114`                     | `keyframeSelector` (`:3990`)             |

`LiteralQuoted` is the archetype and the reason rule 4 is written: all three
supersets split it out **because** they also carry an interpolating quoted form
(`Quoted` typed `node<Quoted | Interpolation>` at scss `:1529` and jess `:2474`).
That is precisely the move rule 4 forbids. It is a hard fail. The same reasoning
condemns the other six: each is a superset inventing a name for a rule CSS
already has. (Less carries no bare `Compound`; its compounds are the
context-qualified `PseudoArgumentCompound` `:5784`, `ClassIdCompound` `:6164`,
`InlineExtendSubjectCompound` `:6250` — a separate item-1 question, not part of
this row.)

**Rules 1 and 3 have measured violations too.** The evidence base as of
2026-08-09:

- **`@charset` was absent from the CSS grammar entirely** while all three
  supersets had it — CSS failing to define regular CSS, a rule 1 violation with
  the fork pointing the wrong way. Closed at `7d32a7fca`; the prologue arm now
  lives at `css-parser/src/grammar.ts:3078-3090`.
- **`<urange>` was absent from jess** while CSS had it (`css-parser` `:1735`), so
  `a { b: U+0-7F }` — plain CSS — did not parse. Closed at `fb272dfc1`
  (`jess-parser` `:2859`).
- **SCSS forked the ident-start declaration-vs-nested-rule decision into a WRONG
  NODE** rather than overriding the CSS decision. Converged at `b518ac388`
  (`fix(scss,jess): converge ident-start declaration-vs-nested-rule on the CSS
  decision`).
- **The at-rule prelude re-spelled `balanced()` inline** and lost the shared
  `customSlash` skip that `balancedParens` (`css-parser` `:1078-1087`) already
  carries — a rule 3 violation, a re-definition of a shape CSS had. Closed at
  `d5c8f72bb`.
- **Namespaced selectors behave three different ways**, and this one is still
  open: less is correct (`AttributeNamespace` / `NamespaceTypeSelector`,
  `less-parser` `:5937-5953`, one `SimpleSelector` carrying `svg|circle`); css
  MIS-PARSES `svg|circle` into two compounds because `|` is in `combinator`
  (`css-parser` `:998`), which propagates into specificity, extend, and `:is()`
  flattening; scss REJECTS it (`scssCombinator`, `scss-parser` `:5555-5560`,
  omitting `|` while the AST type at `:49` already declares it). Recorded with
  the fix shape in
  [`OVER-NARROW-GRAMMAR-SURVEY.md`](./OVER-NARROW-GRAMMAR-SURVEY.md) §§26-27,
  104, 157, 205-220.

The ledger row for the structural blocker is
`docs/architecture/core/DESIGN-DECISIONS.md` **P22**.

---

## 0. Design pressure — grammar must earn its existence

The default review posture is adversarial toward new or duplicated grammar.
Every production, helper, branch, and public node label must prove why it
exists. A test passing is not that proof; a passing test can preserve
unnecessary grammar just as easily as it preserves necessary grammar.

For any dialect grammar (`less`, `scss`, `jess`), the proof has to answer one of
these, in this order:

1. **Inherited:** this is CSS structure reused directly.
2. **Targeted override:** this replaces the smallest CSS slot whose accepted
   language differs.
3. **Addition:** this is syntax the downstream language adds and CSS does not
   have.
4. **Blocked:** this should be inherited or targeted, but a named Parseman,
   macro, CST, AST, or diagnostic constraint prevents it today.
5. **Deliberate exception:** this looks duplicated, but the accepted language
   or emitted semantics differ for a recorded reason.

Anything else is grammar sprawl. A downstream grammar is not allowed to carry a
parallel copy of a CSS frame because one quoted string, identifier, guard, value
leaf, interpolation point, or body item differs. The correct pressure is to make
CSS call a semantic slot, then override that slot. If the slot is too broad,
split it only after implementation pressure proves the contexts need distinct
override policies, and write that proof down beside the split.

`Identifier` and `Keyword` are different semantic slots even when CSS recognizes
the same authored spelling for both today. Use `Identifier` for non-value
syntax positions: selector pieces, attribute names and modifiers, property-ish
names, at-rule names, and other grammar structure that is identifier-shaped.
Use `Keyword` only when an identifier-shaped token is already a CSS value fact.
In value position, an `IdentifierOrFunction` dispatcher is the right shape: the
routed bare identifier can reduce to a `Keyword` value, while the glued
`name(` opener routes to known or generic function bodies. Keeping these slots
separate is what lets Less, SCSS, and Jess override interpolation in selector,
property, or header positions without corrupting ordinary value keywords.

Name productions for the syntax or emitted fact, not for a recognition route.
`PseudoArgumentSelector`, `PseudoArgumentText`, and `PseudoSelector` name the
same concepts in the grammar map and CST. A static route is not a production
concept: it is simply the route that did not encounter interpolation. Reserve
an `Interpolated...` production name for the real semantic distinction where
the route produces an interpolation-backed AST fact. Do not introduce
`Static...`, `Direct...`, dialect prefixes, or compatibility-history prefixes
to explain parser implementation history.

Math and comparison are also context-owned. Less may lower value-position math
or comparison into expression structure, but only through the Less expression
rules and their `mathMode` policy. Jess expression math, comparison, and
leading-dot declaration lookup stay behind the explicit `$()` expression
boundary; ordinary Jess value slots must keep rejecting those forms.

Apply this pressure horizontally, with one exception: making CSS itself spotless
can proceed directly because CSS is the base the others should compose from.
Most historical duplication was created by repairing one derived dialect or one
syntax surface in isolation, then re-solving the same production family three
more times. When touching a family such as imports, at-rules, quoted values,
identifiers/functions, pseudo selectors, selector starts,
query/supports/container forms, guards, or custom-property values in Less, SCSS,
or Jess, audit that family across CSS, Less, SCSS, and Jess before landing the
shape. The expected result is one CSS-owned structure with targeted dialect
slots, not four local approximations that merely share a name.

---

## 1. The method — every `const`, no sampling

**The checklist is applied to every `const` in the file.** Not sampled, not "the
ones that look suspicious". In these files a rule _is_ a `const` inside the
host-mode `rules()` factory, so "every const" is literally every rule, terminal,
and helper.

The exhaustiveness _is_ the method. The failure mode being fixed is an agent
reading linearly, pattern-matching locally, and stopping when the immediate task
looks done. "Review the grammar" gets skimmed. "Answer these sixteen questions
for every `const` in this file" cannot be.

Two things make this tractable rather than crushing:

- **Most consts pass in one line.** A bare terminal that uses the API correctly,
  is documented, and duplicates nothing gets a one-word verdict. Volume is not
  the same as effort. A 200-const file is mostly a fast scroll.
- **"Conforms" is a claim, not a default.** The `less-parser` pass found a
  byte-identical copy of a shared rule _whose own docstring named the local
  copy_ — trivially visible the moment someone actually read that const, and
  invisible for however long nobody did. If you write "conforms" you are
  asserting you read it.

### Outcome vocabulary

One of exactly four per const, so reports are comparable across files and agents:

| outcome                  | means                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **conforms**             | read, nothing to do. One line.                                                                                                                                                                    |
| **converted**            | changed — cite the commit.                                                                                                                                                                        |
| **blocked**              | should change, can't yet — cite the _specific_ reason (macro-static reducer limit, CST consumer shape, compose/hostMode constraint, missing parser primitive, separator ownership, AST movement). |
| **deliberate exception** | should not change — cite the justification.                                                                                                                                                       |

**`blocked` and `deliberate exception` are the load-bearing ones.** A documented
non-collapse is worth as much as a collapse: it stops the next agent
re-proposing it. Two guard-operator spellings were correctly left alone because
they look identical and differ in whitespace framing — that fact is only useful
if it is written down against those consts.

---

## 2. The checklist

Every written rule must answer:

1. **Is this from CSS?** Does it need to be duplicated? Is it called a different
   name — and if so, why, and is that justified? This is a question about
   _duplication_, not about naming style. All CSS structure is CSS-owned unless a
   downstream grammar changes that exact structure. Even then, override only the
   smallest changed child, value slot, or reference; a dialect change is not a
   license to replace the whole CSS rule. A production that restates a CSS
   construct the base grammar already defines should compose on it, not re-spell
   it. `less-parser` carried a byte-identical copy of a shared rule; the shared
   rule's docstring even named the local copy. Less, SCSS, and Jess should be
   lean overlays that describe only the syntax they add or the specific CSS
   substructure they change. A different nested value grammar, interpolated
   leaf, body item set, or syntactic guard is a reason to parameterize or replace
   that child, not to fork the parent production unless the parent shape itself
   is different.

2. **Is it readable and well formatted?** In practice this splits into items 3
   and 4, which fail differently — see _the floor and the bar_ below.

3. **Is this pretty?** A judgement call, and it stays one. The bar: _a screenshot
   of this code should be blown up to lecture-hall size for its elegance and
   formatting._ Per const, the test is whether the rule's shape **teaches what it
   does when projected on a wall**, or needs narration. Nesting readable as
   indentation, matching parens down the left edge, no twenty-combinator
   one-liners, consistent with its neighbours. This cannot be mechanised and
   should not pretend to be — say what you judged and why.

4. **Does it pass our ESLint grammar floor?** Purely mechanical, a hard gate
   rather than an opinion. The config covers all four grammar files and the
   shared recognition sources. It deliberately does **not** force every function
   argument in a multi-line combinator call onto its own line: short Parseman
   calls such as `choice(foo, bar)`, `keywords(['+', '-'])`, and
   `sequence(literal('{'), body, literal('}'))` are allowed when they read
   better compact. The mechanical floor remains strict where it protects parser
   correctness and reviewability: JSDoc requirements, no multi-line `//`
   comments, blank line before comments, no literal non-ASCII in regexes, no
   regex outside combinators, no factories or hoisted combinator construction,
   and no macro hazards.

5. **Does it have a JSDoc block?**

6. **Is this the simplest representation in parseman combinators?**

7. **Does it duplicate parts of other rules in the grammar that could be
   reused?** — not just whole rules: shared sub-sequences, repeated bracket
   scans, the same terminal spelled twice.

8. **Does it use the API instead of hand-rolling it?** Real instances in
   `less-parser`: keyword regexes carrying a hand-written `(?![-\w])` boundary
   where `word()`/`keywords()` is the API; hand-rolled separated-list sites where
   `oneOrMoreSep(...)` is clearer; and special/generic alternatives that first
   parse the same opener instead of routing that opener once with
   `dispatch(combinator, when(...), otherwise(...))`. Use
   `PARSEMAN-COMBINATOR-CHEAT-SHEET.md` as the quick decision table. When sibling
   `choice(...)` arms consume the same broad opener, branch by that matched value
   or suffix, and include a generic fallback for the same token family,
   `dispatch(...)` is the default shape unless a const-level note proves a
   smaller or more accurate Parseman form. Keep `choice(...)` for genuine
   alternatives whose first sets are disjoint, literal-led, first-arm-dominant
   with cheap tails, or otherwise cheap for Parseman's choice strategies; do not
   rewrite literal-to-literal tables as dispatch just because dispatch exists.
   Parse shared structure outside the dispatcher, route on
   the smallest meaningful combinator whose value decides the branch, and put the
   generic continuation in `otherwise(...)`. Use `routed()` inside branch nodes
   when the selected form should own the already-consumed value/span.

   Fast decision check:

   - Same broad token opener, different exact/matcher continuations, and a
     generic continuation for that same token family: use `dispatch(...)`.
   - Already distinct starts, closed keyword tables, literal punctuation tables,
     or a short choice where Parseman can first-set gate the arms: use
     `choice(...)`, `word(...)`, or `keywords(...)`.
   - Shared opener but the real decision is a later delimiter or parse context:
     left-factor the shared structure or write a context-owned helper; do not
     move the opener into `dispatch(...)` unless the routed combinator also
     consumes the delimiter/context that decides the branch.

   Analyzer overlap is a prompt for review, not a command to dispatch. The
   accepted outcome may be a routed opener, a left-factored helper, or an
   intentionally preserved `choice(...)` when the alternatives are real language
   constructs and Parseman's first-set strategy already handles them.

   For CSS and Less, classify every touched `choice(...)` before changing it:
   routed token family, closed spelling table, separated list, construct family,
   or context decision. Only the first category is automatically a
   `dispatch(...)` candidate. Closed tables stay `word(...)` / `keywords(...)` /
   small literal `choice(...)`; separated lists use separator helpers; construct
   families stay `choice(...)` unless their shared prefix can be left-factored;
   context decisions need the deciding delimiter or caller fact in the routed
   combinator before `dispatch(...)` is appropriate.

   Dispatch review proof:

   - Name the exact routed value produced by the first combinator (`url(`,
     `@media`, `:not(`, bare `red`, etc.).
   - Prove that value already contains the syntax that chooses the branch.
     If the proof needs a later `{`, `;`, `:`, selector delimiter, or contextual
     body rule, use left-factoring or a context helper instead.
   - Prove `otherwise(...)` is the generic continuation for the same token
     family, not a catch-all for unrelated body/list constructs.

   Applied CSS/Less rule:

   - Use `dispatch(...)` for identifier-or-function families, known/generic
     function openers, pseudo-function openers, at-keyword families with a
     generic at-rule fallback, and Less `@name` families only when the routed
     opener includes enough syntax to decide the branch.
   - Keep `choice(...)` for disjoint statement/body items, literal punctuation
     tables, closed keyword lists, and delimiter decisions that happen after the
     opener has already been accepted.
   - It is valid to dispatch on a CSS at-keyword to select the legal tail family,
     then keep a local `choice(...)` between statement and block tails. It is not
     valid to dispatch on bare `@` in Less and pretend that at-rule, variable,
     reference-call, and mixin-like continuations are already decided.
   - Less `@name` and mixin families are dispatch candidates only after the
     routed opener includes the deciding delimiter or suffix. Bare `@`, bare
     `.foo`, and bare `#foo` are not enough.

   Do not use dispatch for a family whose real decision is a later delimiter
   unless that delimiter is part of the routed combinator; for example, a
   generic at-rule block-vs-statement split decided by `{` vs `;` must not
   commit on the at-keyword alone. When glue is part of the token shape, the
   routed combinator must own the glue too: CSS `url(`, `calc(`, `var(`, generic
   functions, Less `each(`, and pseudo-functions are not `ident` followed later
   by ambient trivia and `(`. The same rule applies to negative adjacency
   guards: a trailing `not(literal('('))` after a routed opener runs under
   ambient trivia and can reject both `name(` and `name (`. If adjacency matters,
   encode it in the routed opener or let the higher-priority grammar route own
   the glued form. When
   several `when(...)` or `word(...)` cases share the same case-sensitivity and
   boundary policy, create one grammar-local `makeWhen(...)` or `makeWord(...)`
   helper for that real policy; do not multiply domain-named helpers such as
   `pseudoCase`, `fnCase`, and `atCase` unless their matching policy actually
   differs. Current exemplars are CSS `IdentOrFunction` and Less
   `IdentifierOrFunction`: consume `ident` or glued `name(` once, route exact
   known openers, route `when(endsWith('('), ...)` to the generic function tail,
   and put the bare identifier in `otherwise(...)`. A closed keyword list with no
   generic continuation is not this pattern; use `word(...)` / `keywords(...)`.

   Custom-property values are a structured token-stream grammar family, not a
   permanently raw string family and not an ordinary interpreted value grammar.
   CSS Syntax defines `<declaration-value>` as a permissive token sequence with
   only the spec's forbidden tokens and unmatched delimiters rejected; CSS
   Variables says custom properties are left as an unresolved stream of CSS
   tokens, with valid `var()` functions, until substituted into a known property.
   The target Jess shape is therefore a first-class `CustomValue` made from
   nested matching group/block rules, spec-token components (`url(...)`,
   `var(...)`, function tokens, quoted strings, dimensions, colors, keywords,
   list/sequence punctuation), and explicit custom-only unknown-token fallback
   parts. Do not special-case a `url(...)` or other real token shape as a custom
   workaround; route it through the same opener/component shape where that keeps
   the token stream faithful. Do not drop the custom container and use a normal
   `ValueList` wholesale either: custom-property emission is inert CSS token
   preservation with explicit dialect dynamic slots, not ordinary Less/Jess
   value evaluation. Comments remain trivia, and nested groups/blocks must be
   parsed once by matching grammar structure rather than recovered by a second
   source scan.

9. **Does it avoid reparsing and broad lookahead?** A rule may recurse through
   Parseman grammar structure, but it must not parse a source region, then send
   the same region through another selector/value/at-rule recognizer to recover
   facts. Broad `peek(...)` / `not(...)` gates are findings unless a written
   const-level review proves they are the smallest local boundary. Prefer
   `dispatch(...)`, `routed()`, context-parameterized rules, explicit recursive
   grammar structure, and separator/list helpers. Less inline `:extend(...)` is
   the standing example: it must become a context-owned selector tail that
   collects extend facts while parsing selector branches once, not a second
   selector parse guarded by broad lookahead. Its `all` and `!all` suffixes are
   semantic facts, not interchangeable terminator trivia; preserve where those
   facts attach to the selector/ruleset result before simplifying any guard.

### Unsupported Syntax Policy

Unsupported syntax is not one bucket. When a grammar rule rejects a feature,
classify the rejection before choosing the Parseman shape:

| class                             | parser shape                                                                                                                                                                                                                     | use for                                                                                         | examples                                                                                                                                                                                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unrecognized invalid syntax**   | Recognition fails at the real grammar boundary. No semantic node or unsupported fact is needed.                                                                                                                                  | Syntax that is simply outside the language and has no useful migration or recovery structure.   | Invalid CSS `calc()` shapes, impossible delimiters, CSS-only placement errors.                                                                                                                                                                                                        |
| **Recognized unsupported syntax** | Recognition consumes the removed feature into a meaningful unsupported fact or node, then reports a fatal parse diagnostic. Public parse may still throw, but language-service recovery can keep a useful tree around the error. | Removed legacy features with a useful explanation or migration target.                          | Less inline backtick JavaScript: recognize `` `expr` ``, reject it, and point users toward `@from` / `@-from` or a script-module/plugin route. Recently deprecated plain `@name` variables in interpolated positions: understand the reference and report the exact `@{name}` change. |
| **Deprecated supported syntax**   | Parse normally and attach a warning/deprecation diagnostic when that diagnostic lane is wired.                                                                                                                                   | Supported compatibility forms that should move users to newer syntax without breaking the file. | `@plugin` to `@use`/`@-use`; discouraged leaky `@import` to `@compose`/`@-compose`; whitespace between a Less mixin name and call parens; paren-less Less mixin calls.                                                                                                                |
| **Eval/runtime invalid syntax**   | Parse structurally, then fail during eval/render with a source-backed diagnostic.                                                                                                                                                | Syntax that is grammatically valid but semantically invalid in its evaluated context.           | Undefined variables, recursive variable/property references, mixin/namespace lookup failures.                                                                                                                                                                                         |

Do not call every removed feature a raw parse error. If the source shape can
support a better diagnostic, migration hint, or language-service recovery, parse
that shape intentionally and fail with the richer diagnostic.

10. **Does it keep comments as trivia?** CSS comments are trivia. A grammar
    production that repeats `many(blockComment)`, builds a renderable `Comment`
    node, or treats comments as value/list/selector children is a finding by
    default. The target AST/render contract is not "comments are not trivia"; it
    is "extract trivia once into a source/document trivia index, and let
    render/language-service consumers query that trivia channel by source
    offsets when they need authored gaps."

    Accepted exceptions must be narrow and explicitly named:

    - scanner-local skips for `scanTo(...)` / `balanced(...)`, where comments
      must not terminate an opaque run;
    - syntax-preserving opaque text captures for non-trivia bytes, such as
      unknown at-rule preludes/bodies or custom-property values. Opaque does not
      make comments semantic payload; comments in those regions still belong to
      the source trivia index and are reintroduced by source-offset queries when
      byte preservation requires it. This establishes the required byte/CST
      contract, not that `scanTo(...)` is the final recognizer: record the
      structural fact currently lost and why a structured Parseman combinator
      cannot preserve the contract before retaining a scanner;
    - temporary compatibility while existing consumers still expect lifted
      `Comment` nodes. This is migration debt, not a grammar model.

    Do not hide this debt behind a helper named `comments(...)`. The cleanup
    target is to delete grammar-level comment nodes and production-local
    `many(blockComment)` plumbing once the parser-owned trivia map carries the
    needed source ranges.

    Public parser entry points should attach trivia with
    `createTriviaMapFromParseman(input, result.rootTrivia?.index)`, having asked
    for the labels they need via `run(entry, input, { rootTrivia: { select } })`.
    `RunResult.triviaMap` and `RunResult.triviaLog` were REMOVED in parseman
    0.44.0 and now throw on read. That adapter consumes
    Parseman's sparse root trivia index directly, so parser packages should not
    rebuild intermediate AST trivia ranges or decode raw `_triviaLog` arrays.
    Labeled trivia is useful when a grammar can keep one coherent label policy
    for the root trivia log; otherwise leave the grammar unlabeled and let the
    adapter fall back to source-range comment detection.

    Less's visible-empty behavior does not change this. A block comment can make
    an otherwise empty ruleset renderable, while a line comment does not survive
    CSS output; that is a body-span trivia/renderability check, not evidence that
    a `Comment` node belongs in the rules list. The cleanup must move the empty
    ruleset check to the trivia channel at the same time it removes lifted
    comment children.

    Permissive CSS holes still share the ordinary component/value grammar.
    Unknown at-rules and custom-property values may allow otherwise-unknown
    tokens in their local context, but they should opportunistically parse known
    value/list/group/declaration/ruleset structure instead of becoming bespoke
    raw-string languages. Model that as a context or policy on the shared
    grammar; do not invent separate unknown-at-rule/custom-property scanners for
    every place the same component syntax appears.

11. **Are its regexes correct?** Three defects found, each of which a reviewer
    can only catch by reading the pattern character by character:

- `\uXXXX` escapes instead of the literal non-ASCII character — a reviewer
  cannot verify a range they cannot see.
- the `u` flag alongside `i`, or non-ASCII case folding that is simply wrong.
- ranges that stop at the BMP, which break astral characters.

12. **Does it consume its own separator?** A declaration does not own an optional
    semicolon. `;` separates block-list items, so the list owns it. A list may
    allow a final semicolonless declaration or extra empty semicolon items only
    where the language permits that shape; it must not allow a declaration to
    run directly into a nested at-rule or qualified rule unless that dialect
    explicitly documents the deviation.

13. **Is it gated?** A leading `not()` is the anti-pattern — 18 sites. So is
    `not(regex(...))` used as an end-of-value assertion: that is gating work
    done by hand where a first-set gate is the mechanism. Less carries roughly
    an order of magnitude more `not()` than the CSS grammar for the same surface
    (owner measurement: ~460 against 21); re-measure rather than quoting the
    figure.

14. **Is it reachable and covered?** One production was CST-only, dead, and had
    zero tests. Ask which entry rule reaches this const and which test exercises
    it. If neither answer exists, that is the finding.

15. **If changed, does the AST stay byte-identical?** The oracle answers this
    mechanically (§4). **A change that moves the tree is a failed change, not a
    judgement call.**

16. **Does its name claim a divergence it does not have?** Item 1 asks whether
    the rule is duplicated. This asks whether the rule's _name_ is what let the
    duplicate survive. A dialect prefix (`css…`, `less…`, `scss…`, `jess…`) is a
    claim that this rule accepts a different language than its unprefixed
    counterpart. **Either show the accepted languages actually differ, or it is
    one rule.** See _naming is a duplication mechanism_ below.

### Naming is a duplication mechanism, not a style preference

This item is here for a causal reason, and the reason is the whole point of it.
It is not a style guide, and it must not be applied as one — the repo has
rejected codified style guides, and a reviewer who turns this into an
identifier-aesthetics pass has misread it.

**The mechanism.** A dialect prefix makes two identical rules _look_ different.
Nobody ever diffs `cssDeclaration` against `lessDeclaration`, because the names
assert they are different things. The name does not merely fail to advertise the
duplication — it **hides** it. And it is self-reinforcing: once `cssDeclaration`
exists, writing `lessDeclaration` feels like _following the convention_ rather
than like copy-pasting. That is how this codebase historically reached eight
grammar files totalling 24,305 lines where four would do (observation,
`a74131e8f`: CST 1527/1281/1379/1210, AST 3455/4750/5116/5587 for
css/less/scss/jess).

The rule:

- **Use the language's own term first.** If CSS, Less, Sass, or Jess specs/name
  ledgers already name the construct, use that term. Invented local vocabulary
  is a finding unless the spec has no usable name.
- **Default to a plain, undecorated name** — `declaration`, `selector`,
  `atRule`, `block`, `value`. Most productions are not dialect-specific at all.
- **Name the semantic family before the concrete form.** The at-rule family is
  `AtRule`; statement/block concrete kinds may be `AtRuleStatement` and
  `AtRuleBlock` / `AtRuleWithBlock`, but a top-level route named for its caller
  (`StylesheetAtRule`) or provenance (`CssAtRulePrelude`) is a finding unless
  that caller context changes the accepted language. A future CST family tag may
  make this easier for consumers, but the grammar name should already reflect
  the language concept.
- **Selectors are selectors.** A pseudo selector should be named
  `PseudoSelector`, not bare `Pseudo`; a selector helper may include a narrower
  semantic qualifier only when the accepted selector language actually differs.
- **Do not preserve a whole compound spec phrase as a prefix.** Use the spec
  term at the node that actually parses that construct, then let surrounding
  rules be plain. Even when the CSS spec uses a repeated phrase like
  `component value`, do not turn `Component` into `ComponentValueSequence`,
  `ComponentValueList`, `ComponentFunction`, or any other helper prefix. Prefer
  `Value`, `ValueSequence`, `ValueList`, `Function`, or another smaller language
  term. The spec phrase is evidence for the construct, not a namespace.
- **Do not prefix a child with its caller.** A value used by a declaration is a
  value, not `DeclarationValue`; a compound selector used by a ruleset is a
  compound selector, not `RulesetCompoundSelector`. Context belongs in the
  parent production unless the child accepts a genuinely different language.
- **A prefix is a claim of genuine divergence and must be earned.** The rule has
  to actually differ in what it _accepts_.
- **Never prefix a shared rule.** A `Declaration` used by more than one dialect
  is `declaration`.
- **`Css*` is still a prefix.** In grammar-local rule names, AST node kinds, and
  public CST labels, `Css*` is a provenance claim just like `Less*`, `Scss*`,
  or `Jess*`. It is acceptable only when the rule accepts CSS syntax in a place
  where the surrounding dialect deliberately accepts something else and that
  split is documented. Do not treat parser-shared terminal leaves as an
  architectural exception: a shared slot should be named for the semantic role
  the grammar consumes (`Keyword`, `Quoted`, `AttributeOperator`, `Nth`,
  `PseudoSelector`, `Value`, and so on), not for the package that first needed
  it.
- **CSS structure consumes semantic slots.** A CSS rule should call the reusable
  production for the concept it needs, such as `g.Quoted` or `g.Keyword`. Less,
  SCSS, and Jess then override that slot when their accepted language differs.
  Do not clone the enclosing CSS structure because one child production changes.
  Override the smallest child or value reference that actually differs.
- **Split a shared slot only under pressure.** If every downstream language can
  use the same override policy for `Quoted`, keep one `Quoted` production. If a
  real implementation case proves that one CSS quoted context must be
  interpolation-backed while another must remain static, split the CSS-level
  slots by semantic context and record the proof near the split. The split is
  evidence-driven architecture, not a naming precaution.
- **Private stricter helpers stay private.** A dialect may need a local helper
  for a truly narrower parse, but it should be lower-case/private and named by
  the constraint. Public node labels and shared rule references like
  `StaticValueQuoted` or `StaticNthChildArgument` are findings: use the actual
  semantic concept, such as `Quoted`, `NthChildArgument`, or
  `PseudoSelectorArgument`. A private helper may carry a context name such as
  `LiteralQuoted` only when that context changes recognition.
- **`Ast` / `Cst` in a name is the same error one axis over.** That is a compile
  _mode_, not an identity; one grammar serves both modes, so the mode does not
  belong in the rule's name.
- **When divergence is real, name the divergence, not the owner.**
  `declarationWithInterpolatedName` beats `lessDeclaration`.

**Reviewing a grammar, a dialect-prefixed rule name is a defect to justify, not
a neutral choice.** It gets a `deliberate exception` row naming the divergence,
or it is a finding.

#### Standing evidence

Observations, each re-checkable from the current grammar files:

- The physical fold paid the `src/ast/grammar.ts` split, but dialect- and
  mode-flavoured rule names can still survive inside the four `src/grammar.ts`
  files. Treat `CssAst*`, `DirectScss*`, `DirectJess*`, `Ast`, and `Cst` as
  findings unless the rule accepts a genuinely different language. Less has
  already burned down the local `DirectLess*` / `LessDirect*` / `LessAst*`
  migration prefixes; reintroducing one is a finding by default.
  _Interpretation:_ a shared base cannot supply `Declaration` to a dialect that
  still calls the same concept `DirectScssDeclaration`.
- `packages/parser-shared/src/` still contains transition-era recognition maps
  such as `cssSyntax`, `lessSyntax`, `cssPseudoSyntax`, and
  `opaqueAtRuleRecognition`. They removed false compile-mode words, but the
  remaining language prefixes are not the target model. The target is reusable
  semantic slots consumed by composed grammars, with dialect-specific behavior
  supplied by override.
- Compile mode and provenance do not belong in shared rule names. A CSS named
  colour, identifier, quoted value, attribute operator, or pseudo selector
  should be visible to the grammar by that concept name. If a language-scoped
  recognizer remains because Parseman composition or macro visibility currently
  requires it, document that as transition debt and keep the public grammar/CST
  name semantic.
- Grammar-local value extraction helpers are another place this happens. If two
  dialects carry the same helper with only the dialect name changed in the error
  string, either move the shared helper to the right home or rename the local
  divergence so it says what is actually different.
- Jess `CssImport*` is current evidence of provenance naming hiding duplication:
  Jess `@import` is CSS, not a Jess-specific import syntax. The fix is CSS-owned
  or shared import composition with parameterized Jess holes, not a mechanical
  rename that leaves the duplicated parser body intact.
- The same rule applies when an SCSS `Import*` family has a semantic name: Sass
  interpolation may override the target leaf, but CSS `layer`, `supports`, and
  media-tail structure still belongs upstream. A dialect-local copy requires a
  concrete syntax difference and a plan to remove every unchanged child.
- At-rule family names should converge on `AtRule` with concrete statement/block
  forms. Existing `StylesheetAtRule`, `DeclarationListAtRule`, and
  `CssAtRulePrelude` names are review prompts, not precedent.

_Interpretation, not observation:_ the target architecture in
[`DIALECT-ARCHITECTURE-AND-ERROR-COVERAGE.md`](./DIALECT-ARCHITECTURE-AND-ERROR-COVERAGE.md)
already names its seams correctly — `stylesheetItem`, `blockItem`,
`interpolation`, `variableRef`, `preprocessorBase`. The convention this item
codifies is the one that architecture assumes.

### The floor and the bar

**Lint (item 4) is the floor; prettiness (item 3) is the bar.** They fail
differently and must be reported separately: lint is pass/fail and automatable,
prettiness is a human call lint will never capture. A rule can be lint-clean and
still ugly — a correctly-formatted twenty-line `sequence` that should have been
three rules passes every mechanical check.

The mechanical items exist so the judgement items get attention. If a reviewer is
spending its effort on paren placement, the lint config is not doing its job;
that is a finding about the config, not about the const.

---

## 3. Hard constraints

These override anything the checklist might suggest.

**The macro constraint — macro-visible `rules(..., factory)` owners,
parameterless combinator `const`s inside them, and plain reducers only.** Do not
add helper factories, wrapper functions, `[...spread]`, or hoisted config
`const`s — including plain strings — inside grammar bodies unless a focused
macro gate proves the exact shape. The accepted shape is a named module-level
factory passed directly to `rules(...)` so Parseman can still see the whole rule
map. This is a
_correctness_ rule, not a style preference. When `compose()` cannot statically
resolve its argument, parseman falls back to the interpreter, and **a
macro-fallback build is not AST-equivalent to a macro-compiled build** — it emits
a different tree for the same input. Reproduced end to end in
[`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md`](./PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md)
§1: a single hoisted boundary string moved the CST aggregate, and inlining it
back moved the aggregate back byte-for-byte. So `check:macro` guards correctness,
not just speed, and a red run **invalidates any differential taken on that
build**. Literal duplication at each call site is the correct answer until the
macro gate proves otherwise.

**No regex outside `regex()`.** Pattern text belongs in a `regex()` argument,
nowhere else.

**Never create a `productions.ts`.** Upgrade `productions/*.ts` in place.

**The gating diagnostic depends on what you feed it.** The parseman analysis
surface **can** analyse these grammars when given their `rules()` map, captured
_before_ `compose()`. It is the fused compiled artifact that throws — and it now
throws with an actionable message rather than reporting empty. So "the diagnostic
cannot see our grammars" is wrong as a blanket statement; the input matters.
Feed it the pre-compose map, and never read a clean result obtained from the
fused artifact as evidence of anything. (`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md`
§2 states the blanket form of this claim; it is superseded on that point.)

---

## 4. Verification method — propose, verify, measure, keep

In that order, one conversion class at a time.

1. **Propose** the change for a named set of consts.
2. **Verify** with the oracle. It parses the built `lib/`, because that is the
   macro-compiled artifact that ships:

   ```
   pnpm --filter @jesscss/less-parser build
   pnpm run check:macro
   pnpm run oracle:less:byte-identity
   # …edit, rebuild, re-run as after.json
   ```

   Both aggregates (`aggAst` from `parse()`, `aggCst` from `parseLessCst()`) must
   be unchanged. Parse failures are hashed too, so error behaviour is in the
   differential. A grammar touching one surface should move neither — the
   untouched surface is the control.

2b. **Prove the two sides are two things, before believing any result.**
   Every oracle here compares a *before* artifact against an *after* artifact, and
   the whole family of failures in this repo — a stale `lib/`, an unpinned
   `@less/test-data` symlink, a pointer resolved from the wrong checkout — has one
   shape: **the instrument does not error, it measures the wrong object.** A green
   result comes back, faster than usual, and nothing looks wrong.

   Two checks, and the second is the one people skip:

   - **A marker present on BOTH sides** proves neither side is a stale or
     published build. Pick something that exists only in the version under test
     (a newly added export, a new option name) and assert a nonzero count on each
     side. Equal counts are the pass.
   - **A marker present on exactly ONE side** proves the sides differ by the change
     under test. Pick a symbol the change itself introduces and assert it is absent
     on the before side and present on the after side.

   Without the second check a *vacuous* pass is indistinguishable from a real one.
   That is not hypothetical: a parseman lane ran a four-dialect byte-identity oracle
   that reported **0 mismatched over 7,743 pairs / 6,918 real trees**, and the two
   builds under comparison differed only by a directory name — every emitted
   difference was the path-derived namespace token (`_495baed4__re0` vs
   `_3fcfd22e__re0`), +0 bytes on all eight files. The one-sided marker (0 vs 21
   files containing the change's new symbol) is what exposed it.

   Also report the **resolved realpath and version** of every dependency the
   comparison hinges on, beside the numbers, not in a preamble. And when two builds
   are packed for comparison, note that `pnpm pack` names the tarball from
   `package.json` `version`: two worktrees at the same version write the **same
   filename**, and the second silently overwrites the first. Pack into per-side
   directories *and* assert the tarballs' checksums differ before installing either.

3. **Measure before committing, every time.** Capture a named before/after
   parse benchmark for the affected dialect's built `lib/`, even when the
   change was motivated by readability, reuse, naming, or correctness rather
   than speed. Grammar routing, choice order, trivia ownership, and extra
   productions can all change hot-path work by accident. Use the same fixture,
   Node runtime, resolved dependency paths/versions, warm-up, and timed sample
   count for both sides; report median and spread. The Less harness is
   `packages/syntax/less/less-parser/test/parse-bench.mjs`; CSS uses the
   parse-only case in `packages/syntax/css/css-parser/test/postcss-oracle.mjs
   --bench`. Record the result with the change or in the active transient
   handoff. A result inside the documented noise band is inconclusive, not a
   performance claim. A material regression must be understood or explicitly
   accepted by the owner before the grammar commit.
4. **Also measure against the committed baseline, not only against your
   parent commit.** See "The drift gate" below. Item 3 alone cannot catch slow
   degradation and must never be the only perf evidence for a grammar commit.
5. **Keep** only what survives 2, 3, and 4. Otherwise revert, or record it as
   `blocked` / `deliberate exception` with the reason.

### The drift gate — why item 3 is not sufficient on its own

**A differential gate cannot see gradual decay.** Item 3 compares the candidate
against its immediately preceding state and calls a sub-noise result
inconclusive. Both halves are right in isolation and wrong together: with a
±1.4–3.6% noise floor, a `+2%` commit reads as inconclusive, lands, and then
**becomes the reference point for the next measurement**. Twenty such commits
compound to roughly `+49%`, and every one of them passed its gate. Nothing in
the loop remembers where the cleanup started.

This is a named owner priority for the grammar cleanup (2026-07-30): the
cleanup must not slowly degrade parse performance while every individual commit
looks clean.

**The required shape**, by direct analogy with the correctness gate — the
byte-identity oracle works because `oracle-byte-identity.baseline.json` is a
*committed absolute floor* that does not move commit-to-commit:

- **Gate against a committed perf baseline**, not against `HEAD~1`. The
  baseline is the reference for every commit in the cleanup, so drift is
  measured from the start of the cleanup rather than from yesterday.
- **Prefer a ratio over absolute milliseconds.** Record jess parse time divided
  by an in-run comparator measured in the same process on the same corpus
  (`lessc` 4.x for Less, dart-sass for SCSS). A ratio cancels machine speed, so
  one baseline is valid across laptops and CI; absolute ms are not portable and
  will produce false alarms. It is also the same axis as the standing goal of
  Less alpha reaching 4.x parse performance.
- **The standing bar for CSS parsing is PostCSS** (owner, 2026-07-30) — the
  PostCSS / Evil Martians stylesheet parsing benchmark. **PostCSS parses much
  less structure than jess does, and the goal is to beat it anyway.** That is
  deliberate and it is not a handicapped comparison: do not introduce a
  structure-adjusted score, a normalization, or an asterisk that discounts the
  work jess does and PostCSS does not. Describe the structural difference so
  the number is interpretable; never adjust the number by it. Report the honest
  wall-clock comparison on identical input, and if jess loses, that gap is the
  target rather than a footnote.
- **Baselines are NAMED CASES** — dialect × fixture — never one aggregate
  number. A single number cannot distinguish "nothing moved" from "one case got
  faster and another got slower".
- **Rebaselining requires owner sign-off**, exactly as with the byte-identity
  baseline. Without that rule an agent simply rebaselines the drift away and
  the ratchet is theatre. A commit that needs a new baseline is a commit that
  needs a decision, not a commit that needs a bigger number.
- **Direction is signal even when magnitude is not.** A sub-noise result that
  is consistently positive across several consecutive commits is a real
  regression being laundered through the noise band one commit at a time. If
  the last N grammar commits each measured `+1%` to `+2%` "inconclusive", that
  is the finding — investigate the accumulation, do not add an `N+1`th.

### Every grammar commit commits its own A/B number

**The mechanism (owner, 2026-07-30): EVERY commit carries its measured
old-vs-new A/B number, committed with the change itself.** Not every tenth one,
not only the ones that were about performance, not only the ones where someone
suspected an effect — every commit that can touch parse, eval, or emit work.
That includes readability edits, renames, reuse consolidation, and correctness
fixes, because those are precisely the commits nobody thinks to measure and
therefore the ones drift hides in. A commit with no measurable surface says so
explicitly rather than omitting the trailer, so a missing trailer always reads
as an omission and never as "not applicable". This is what makes drift
auditable. A per-commit record turns the commit log into the memory the
differential gate lacks: you do not have to rebuild ancient commits to see
accumulation, you read the chain. Eight consecutive commits that each recorded
a shrugging `+1.5%` are visibly `+12.7%` in the log, and the laundering is
obvious in a way no single gate run could show.

Record it as a commit-message trailer so it cannot drift from the commit it
describes and can be recovered with `git log --grep`:

```
Perf-AB: less-ast benchmark.less 18.04ms -> 18.31ms (+1.5%) n=15 w=5 noise=±3.6% INCONCLUSIVE
Perf-AB: less-cst benchmark.less 12.10ms -> 12.02ms (-0.7%) n=15 w=5 noise=±3.6% INCONCLUSIVE
Perf-Ratio: less-ast/lessc-4.6.7 1.42x (chain start 1.39x @ 914caa6f0)
Perf-Env: node=<v> parseman=<version> resolved=<path>
```

Every case named (dialect × surface × fixture), never one aggregate. A verdict
of `INCONCLUSIVE` is a legitimate outcome for the individual commit and is
still recorded — recording it is the entire point, because inconclusive is
precisely the verdict that accumulates.

**Two mechanisms, different jobs, both required:**

- The **committed per-commit chain** is cheap, always available, and detects
  accumulation and direction. It is a *detector*.
- The **absolute baseline ratio** is the truth check. Composed deltas are not
  reliable arithmetic — measurement error compounds, machines differ, corpora
  shift — so the chain tells you *when to go look*, and an absolute
  re-measurement against a fixed reference tells you *what is actually true*.

Do not treat a summed chain as a measurement. Treat it as an alarm that demands
one.

**Trigger rule:** when the chain since the last owner-accepted reference
exceeds the harness noise band in the positive direction — whether in one step
or accumulated across many — stop and re-measure absolutely before adding
another grammar commit. Report the accumulation, not just the latest step.

**Status: the gate is IMPLEMENTED and DISABLED; the committed baseline artifact
still does not exist.** The machinery that consumes it lives in
`scripts/perf-gate/` and is documented, with an owner enablement checklist, in
[`docs/perf/PERF-DRIFT-GATE.md`](../../perf/PERF-DRIFT-GATE.md). `PERF_GATE`
defaults to `off` and every not-a-pass outcome exits zero, so it cannot misfire
before an owner turns it on.

Two measured findings from that work bear directly on this section. First, the
largest corpus available today (`less/ast/test-data`, 136 files / 136.7 KB)
resolves only **±8.3% at 25 rounds** — it cannot enforce a 5% threshold, and
needs ~70 rounds to reach ±4.9%. Second, the measured ratio moved **3.864x →
3.564x between two runs of identical code**, so cross-run bias, not within-run
precision, is the binding constraint. Until the same-commit null calibration
supplies that number, no threshold below roughly 10% is defensible.

Until the baseline lands, item 4 is satisfied by (a) the `Perf-AB` trailer on
every grammar commit, and (b) measuring the candidate against the *oldest*
cleanup-era commit you can still build, not only against your parent, recording
both deltas. Durable
timing rows also go in
[`PARSEMAN-BENCHMARK-LEDGER.md`](./PARSEMAN-BENCHMARK-LEDGER.md), which already
requires that the parser was rebuilt from the measured commit and that the
macro/compose gates prove the shipping tree did not fall back to the
interpreter.

The Less byte-identity oracle is `pnpm run oracle:less:byte-identity`, backed by
the Less parser corpus under `packages/syntax/less/less-parser/test/`. CSS has
its own since `test/byte-identity/` landed: `pnpm --filter @jesscss/css-parser
oracle:byte-identity`, which runs in the package suite as well. `.scss` and
`.jess` still have no equivalent.

The two are different instruments and neither substitutes for the other. The
Less oracle is a **relative** differential — it digests parse output against a
committed baseline, so it detects movement and is green again after a
rebaseline. The CSS oracle is **absolute**: the input IS the expected output, so
there is nothing to rebaseline and no state in which a wrong answer passes. It
asks `serialize(parse(src), { collapseNesting: false }).css === src` over a
named authored corpus, plus the same question of every real stylesheet's own
emitted output (the fixed-point channel), and it asserts four negative controls
on every run — including one that drops a nested rule, which is the ident-start
defect's signature. Its four open findings are recorded by file and construct in
`test/byte-identity.divergences.json`; that file is a record, not an allowlist.

A `css-parser` change is **not** covered by the Less oracle. Less composes
`cssSyntax` from `@jesscss/parser-shared/recognition`, not from
`css-parser/src/grammar.ts`, and carries its own `Value`
(`less-parser/src/grammar.ts:3110`) with its own `IdentifierOrFunction`. A
change to CSS's value grammar therefore leaves every Less aggregate byte-
identical while proving nothing. An unchanged oracle on a `css-parser` change
is a null result, not a pass — say so rather than quoting it as evidence.

For `.scss` and `.jess`, where no byte-identity script exists yet, an ad-hoc
`digestInto` differential is the substitute, and it needs a **negative control**:
mutate the production under review in a way that must change output, and show
the digest moves. A corpus that never exercises the production returns
"identical" for a correct change and a broken one alike. Report the control
alongside the result.

### The drift gate — the CSS implementation

The shape required above exists for CSS. It is not yet wired into CI or a hook;
that is the owner's call.

- harness and gate: `packages/syntax/css/css-parser/test/postcss-parse-bar.mjs`
  (`pnpm --filter @jesscss/css-parser bar:postcss`, `bar:postcss:gate`)
- committed baseline: `postcss-parse-bar.baseline.json` beside it
- exit codes: `0` pass, `1` breach, `2` usage, `3` the run's own measured noise
  floor was too high for the result to mean anything — re-run; that is neither
  a pass nor a failure of the change

The comparator is PostCSS as `parsers.js` calls it,
`postcss.parse(source, { from }).toResult()`, loaded from a `postcss/benchmark`
checkout so the comparator version is tied to that lockfile. The corpus is the
same benchmark's `cache/bootstrap.css`, pinned in the baseline by SHA-256; a
changed corpus fails the gate rather than silently rebasing the ratios. An
in-repo fixture is a second case so the bar still runs without the upstream
checkout.

Named cases are fixture × surface, and the two Jess surfaces are never
collapsed. The recurring regression signature here is "AST slower while CST is
neutral or faster"; averaging the surfaces hides exactly the failure the gate
exists to catch.

**One process is not a measurement.** Gate and baseline runs fold the median
across five independent processes (`--runs`). The identical-case noise floor
inside a single process measures 1.5–5.2%, but the same case's ratio moved
12.9% *across* clean processes with no source change, and a single-process gate
went red on an unmodified tree. Gating one process needs a ~13% ceiling, loose
enough to swallow a real regression; the fold buys an 8% ceiling back. Two
consecutive folded gate runs on an unmodified tree landed within −5.8%…+2.2%.

The run measures its own noise floor rather than quoting an older
investigation's: two *identical* PostCSS cases are sampled as separate
interleaved cases, and their disagreement is this machine's floor right now. A
run that exceeds the floor limit can neither pass the gate nor be written as a
baseline — one contaminated run inflated every median by ~1.8×, and the
self-measured floor is what caught it.

The harness refuses to write a baseline without a verbatim owner sign-off
recorded in the file, so an unauthorised loosening is visible in review.
Lowering a ceiling after a real win needs no permission.

**Where the bar stands** (Node v24.11.1, darwin-arm64, `parseman@0.43.0`,
`postcss@8.5.25`, corpus `postcss/benchmark@ddc1a86`): `jess-ast` is **1.35×
PostCSS** on bootstrap and **1.65×** on the in-repo fixture; `jess-cst` is
**3.10×** and **3.94×**. Jess loses every case. It loses while producing 3.1×
the typed nodes on the AST surface and roughly 24× the tree objects plus a full
trivia log on the CST surface — measured counts are in the report under
`fixtures[].produced`. That is context for reading the number, not a defence,
and not a discount applied to it.

---

## 5. Definition of done

Not "tests pass". All four, stated with evidence:

- **diagnostic clean** — zero TypeScript/editor diagnostics in the files you
  touched (`pnpm run verify:types`), and, where you ran parseman's gating
  analysis, it was fed the pre-`compose()` `rules()` map (§3).
- **lint clean** — `pnpm run lint`.
- **oracle byte-identical** — both aggregates unchanged, quoted before/after.
- **macro-buildable clean** — `pnpm run check:macro`, `0 interpreter fallbacks`.

A green test suite is context. It is not any of these four.
