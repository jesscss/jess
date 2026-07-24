# `$` — a co-existence pact between CSS and build-time tooling

Status: **TODO — NOT FILED, NOT AGREED, NOT a decision.** This records an action
item and the argument for it. Nothing here is settled by anyone but us, and
nothing here constrains Jess's grammar today.

Action: open an issue on [`w3c/csswg-drafts`](https://github.com/w3c/csswg-drafts)
proposing a **reciprocal boundary**: preprocessors get out of CSS's namespaces,
CSS commits to never claiming `$`.

## First, our mea culpa

Preprocessors created this problem. Two specific mistakes, both ours:

1. **We invented at-rules inside CSS's `@` namespace.** `@if`, `@else`, `@each`,
   `@for`, `@while`, `@mixin`, `@include`, `@function`, `@return`, `@content`,
   `@extend`, `@use`, `@forward` — none of these were ever ours to take. `@` is
   CSS's statement namespace and always was.
2. **We overloaded CSS function-call syntax with divergent semantics.** `min()`,
   `max()`, `round()`, `abs()` and friends: same spelling as a CSS function,
   different meaning, resolved at a different time.

Both were **risks that future CSS preprocessors should not take.** We are not
asking CSS to accommodate a land-grab. We are acknowledging the land-grab and
proposing a boundary so that it stops — permanently, for everyone.

## The pact

Obligations on **both** sides. This is the whole proposal.

**Preprocessors commit to:**

- Stop inventing at-rules in CSS's `@` namespace. Build-time control flow, mixin,
  module and function constructs move behind the reserved sigil.
- Stop overloading CSS function-call syntax with divergent semantics. A
  CSS-shaped call means the CSS thing.
- Keep every build-time construct inside the reserved sigil, so a stylesheet's
  CSS surface and its tooling surface are lexically separable.

**CSS commits to:**

- Never assign meaning to `$`-led token shapes — no future property, function,
  at-rule, selector or value syntax claims them.

CSS gets `@` and the function namespace back, unambiguously and forever. Tooling
gets a space it can build on without fear. Neither side has to keep negotiating
name by name.

### The concession that makes this coherent

**We explicitly agree with Lea Verou: CSS should not be prevented from adopting
"legacy" syntax that Sass or Less happen to occupy — including ours.**

If the WG wants `@if`, it should take `@if`. Same for `@each`, `@for`, `@while`,
`@mixin`, `@include`, `@function`, and any function name it needs. We will adapt.
That is our problem, created by our predecessors' choices, and it is not CSS's
job to route around it.

[`csswg-drafts#6684`](https://github.com/w3c/csswg-drafts/issues/6684) asks:

> How much do we contort CSS to avoid clashing with preprocessors?

Our answer is **ideally not at all** — which is exactly why we want a boundary
instead of case-by-case contortion. One line drawn once is cheaper for CSS than
an indefinite series of naming compromises, and it is the only version of this
that ever ends.

This is also the direct answer to
[`w3ctag/design-principles#335`](https://github.com/w3ctag/design-principles/issues/335),
"Do not design around third-party tools unless it actually breaks the Web." We
agree with that principle and are not asking for an exception to it. We are
asking for the opposite: **stop designing around us.** Reclaim `@` and the
function namespace in full, and in exchange draw one clean line at `$`.

## Jess's good-faith deposit — the preprocessor obligations, already implemented

Jess deliberately avoids squatting on, introducing, or extending CSS's at-rule
namespace. This matters for credibility: a proposal from someone who has already
vacated the contested namespace is worth more than one from someone still
occupying it. Sass and Less both squatted; Jess is the correction.

What is verifiable in the `.jess` grammar today:

- **Jess defines no new bare at-keyword.** There is no `@if`, `@each`, `@mixin`,
  `@include`, `@function`, `@extend`, `@use` or `@forward` in the Jess grammar.
- **Jess's five compiler at-rules are all dash-marked** — `@-import`,
  `@-compose`, `@-use`, `@-from`, `@-export` — specifically so they cannot
  collide with any current or future CSS at-rule. The dash is required for
  compiler meaning; the bare spellings are not reinterpreted, they simply stay
  ordinary CSS pass-through at-rules.
- **Standard CSS at-rules keep CSS names and CSS meanings.** Bare `@import` in a
  `.jess` file is always a plain CSS `@import`, never a compiler import — no
  heuristic, ever.
- **The build-time surface is `$`-led**: `$name` variables, `$(…)` and `$[…]`
  interpolation, and `$`-led block statements for everything Sass spells with an
  at-rule — `$if`/`$else`, `$for`, `$extend`, `$apply`.

Stated honestly, because a filing should not overclaim:

- Jess *does* add one bare `@`-led **syntax**: the anonymous mixin/function forms
  `@(…)` and `@{…}`. Under CSS tokenization these are not at-keywords — `@`
  followed by `(` or `{` is a `<delim-token>`, not an `<at-keyword-token>` — so
  they cannot collide with an at-rule name. But the honest claim is *"no new bare
  at-keyword"*, not *"no new bare `@` syntax"*.
- A few Jess constructs carry no sigil at all: mixin definitions
  (`name(params) { … }`) and the `*[…]` selector capture.
- Jess is in places *stricter* than CSS about at-rule placement and prelude
  shape, and its grammar currently rejects non-keyframes `@-vendor-` at-rules.
  Being stricter is a different failure mode from squatting, but it is not
  nothing, and the filing should not imply Jess is a pure CSS superset.

**On the choice of `@-`, pre-empted:** the WG will notice that `@-` resembles
CSS's vendor prefixes (`@-webkit-keyframes`, `@-moz-document`). The resemblance
is superficial, and the choice is deliberate.

**It is structurally unambiguous, not merely visually distinguishable.** A
vendor-specific extension requires *two* segments. [CSS 2.2 §4.1.2.1
"Vendor-specific extensions"](https://www.w3.org/TR/CSS22/syndata.html#vendor-keywords)
gives the format as

> `'-' + vendor identifier + '-' + meaningful name`

— a leading dash, a vendor identifier, a **second dash**, then the name;
`-webkit-keyframes` is `-` + `webkit` + `-` + `keyframes`. Jess's `@-import` has
one dash and one segment. Read as a vendor prefix it would parse as vendor
`import` with no name following, which is not a well-formed vendor extension. The
two forms cannot collide. (That section speaks normatively of keywords and
property names rather than at-rules; at-rule names are identifiers, and vendor
at-rules follow the same two-segment shape in practice.)

**`@--` was rejected on principle, not taste.** `--` already carries a specific,
established meaning in CSS: the **author** user space, at **runtime**. Reusing it
to mark **compiler build-time** at-rules would overload one marker with two
unrelated user spaces — exactly the namespace muddle this proposal exists to
prevent. A single dash keeps the three spaces lexically distinct:

| Marker | Space |
|---|---|
| `--` | author, runtime (custom properties) |
| `@-` | compiler, build-time (Jess at-rules) |
| `$` | tooling, build-time (proposed) |

Secondarily, and much less importantly: the double dash is noisier for a marker
authors type constantly.

### The generalized rule

This is the forward-looking rule the pact hands to *other* preprocessor authors,
and it is what makes this shared infrastructure rather than a two-vendor
carve-out:

> **Stay out of `@`. Stay out of CSS's function namespace. Build in `$`.**

## The `--*` precedent — CSS already knows how to do this

CSS has an **author user space at runtime**: `--*`. A namespace CSS deliberately
carved out, gave an intentionally permissive grammar, and promised never to
assign built-in meaning to.

The pact asks for the same construct at a different lifecycle stage: **`$` as a
tooling user space at build time.** These tokens are resolved and stripped by a
preprocessor before the stylesheet reaches a browser. CSS never has to
*interpret* them — only commit to never *claiming* them.

[css-variables-1 §2 "Defining Custom Properties: the `--*` family of
properties"](https://drafts.csswg.org/css-variables-1/#defining-variables)
defines the whole namespace as one property with a token-stream value:

> Name: `--*` — Value: `<declaration-value>?`

and states the commitment outright:

> Custom properties are solely for use by authors and users; CSS will never give
> them a meaning beyond what is presented here.

It even reserves *within* the namespace — exactly the shape of commitment being
asked for here. `<custom-property-name>` is any dashed-ident

> except `--` itself, which is reserved for future use by CSS.

[§2.1 "Custom Property Value
Syntax"](https://drafts.csswg.org/css-variables-1/#custom-property-syntax) is the
model for the grammar:

> The allowed syntax for custom properties is extremely permissive. The
> `<declaration-value>` production matches any sequence of one or more tokens, so
> long as the sequence does not contain bad-string-token, bad-url-token,
> unmatched closing brackets, or top-level semicolon tokens or exclamation
> delimiters.

The spec does not need to understand a custom property's value; it only needs to
be able to *skip* it. Same requirement here.

The namespace also already exists by accident: `$` gets no special tokenization
in [css-syntax-3](https://drafts.csswg.org/css-syntax-3/) — it falls through to
`<delim-token>` — so `$`-led tokens are already legal *inside* a `--*` value
today. What is missing is coverage of name, statement and selector positions, and
a durable commitment rather than an accident.

## Precise scope of the reservation

Reserve `$` followed by anything **other than `=`**. The shapes in use today:

| Shape | Used by |
|---|---|
| `$<ident>` | Sass variables; Jess variables (`$$name` = scoped lookup) |
| `$(…)` | Jess value-position interpolation / expression boundary |
| `$[…]` | Jess accessor / lookup (`$*[…]` = selector capture) |
| `${…}` | Less interpolation (alongside `@{…}`) |
| `$<ident>` block statements | Jess control flow — `$if`/`$else`, `$for`, `$extend`, `$apply` |

Positions that must be covered — a value-only reservation is not sufficient,
because build-time syntax appears wherever authors write names:

- **declaration value** — `color: $brand`, `width: $(2 * $w)`
- **declaration name / property position** — `$[name]: red`
- **statement start** — `$brand: blue`, `$if $cond { … }`
- **selector position** — `.a$[x]`, `$extend .b`
- **inside quoted strings and `url()` bodies** — `content: "$[x]"`

The commitment requested is narrow: CSS assigns no meaning to these and defines
no future feature that claims them. CSS is not asked to parse, evaluate or
round-trip them.

## Explicitly NOT in scope: `$=`

`[attr$="x"]` — the **suffix-match attribute selector** — is established CSS and
entirely unaffected. [Selectors 4 §6.2 "Substring matching attribute
selectors"](https://drafts.csswg.org/selectors-4/#attribute-substrings) defines
`[att$=val]` as matching an element whose attribute value ends with `val`,
alongside `^=` (prefix) and `*=` (substring). The reservation must be written to
exclude it: `$` immediately followed by `=` in a selector stays exactly what it
is today.

Checked against css-syntax-3 and selectors-4, `$=` is the only place CSS gives
`$` any meaning; everywhere else it is an unassigned `<delim-token>`. Re-verify
against current drafts before filing.

## Evidence — the current approach is applied inconsistently, and protects nobody

### 1. `@if` → `@when` — collision treated as decisive; CSS lost the natural name

CSS Conditional's generalized conditional rule is spelled `@when`, and the reason
is Sass. [`csswg-drafts#112`](https://github.com/w3c/csswg-drafts/issues/112)
(tabatkins, 2016) is the original thread that resolved on the `@when`/`@else`
proposal. [`#6684 "[css-conditional-4] Rename @when to
@if"`](https://github.com/w3c/csswg-drafts/issues/6684) (LeaVerou, Sept 2021)
opens by stating the rationale as fact:

> The reasoning for using `@when` over `@if` is that `@if` clashes with Sass, a
> widely used CSS preprocessor. To my knowledge, no other reasoning exists for
> this decision.

That issue is **still open**, `@when` is still the name in the current
[css-conditional-5](https://drafts.csswg.org/css-conditional-5/) draft, and
follow-on threads ([#12903](https://github.com/w3c/csswg-drafts/issues/12903),
[#12909](https://github.com/w3c/csswg-drafts/issues/12909)) are still working out
how `@when` and `if()` relate. Roughly five years of WG time on one name
collision, unresolved.

#6684 also notes it had happened before:

> CSS has already made syntactic decisions to avoid clashing with Sass, namely
> square brackets over parentheses in grid properties.

**Result: preprocessor collision was treated as decisive, and CSS paid.**

### 2. The function namespace — the same reasoning ignored, and preprocessors broke anyway

Meanwhile [CSS Values and Units 4](https://drafts.csswg.org/css-values-4/#math-function)
defines a full math-function suite: `min()`, `max()`, `clamp()`; `round()`,
`mod()`, `rem()`; `sin()`, `cos()`, `tan()`, `asin()`, `acos()`, `atan()`,
`atan2()`; `pow()`, `sqrt()`, `hypot()`, `log()`, `exp()`; `abs()`, `sign()`.

[Less's documented math functions](https://lesscss.org/functions/) are `ceil`,
`floor`, `percentage`, `round`, `sqrt`, `abs`, `sin`, `asin`, `cos`, `acos`,
`tan`, `atan`, `pi`, `pow`, `mod`, `min`, `max` — **ten of which CSS Values 4
also defines**: `min`, `max`, `round`, `mod`, `abs`, `pow`, `sqrt`, `sin`, `cos`,
`tan`. Less's math-function work dates to at least
[`less/less.js#648`](https://github.com/less/less.js/issues/648) (Feb 2012), and
Sass's `min()`/`max()` to Ruby Sass 3.2 — both well before CSS Values 4 defined
the same names.

CSS defined them anyway. **We think that was the right call** — but it is not the
call `@when` implies, and the ecosystem paid for the inconsistency:

- **Sass.** Its language proposal
  [`accepted/min-max.md`](https://github.com/sass/sass/blob/main/accepted/min-max.md)
  states the trap plainly: *"to retain backwards-compatibility with existing Sass
  stylesheets, it must support `min()` and `max()` as Sass functions. However, to
  provide compatibility with CSS, it must also support them as math functions
  with special syntax."* The resolution is a heuristic — one spelling, two
  languages, disambiguated by inspecting the arguments: *"If all arguments to a
  function named `min()` or `max()` are valid arguments for CSS math functions
  […] it's parsed as a math function. Otherwise, it's parsed as a SassScript
  function."* Renaming was rejected because the corpus was already too large:
  *"the eventual removal of the SassScript functions would probably create
  substantial migration pain for our users for a long time."* Tracking:
  [`sass/sass#2378`](https://github.com/sass/sass/issues/2378) (2017).
- **Authors paid in workarounds.** Ordinary CSS produced `Incompatible units`
  errors, and the field remedies were to capitalize the call as `Min(20em, 50vh)`
  to dodge Sass's function, or escape it as `#{'min(50%, 3rem)'}` (Ana Tudor,
  ["When Sass and New CSS Features
  Collide"](https://css-tricks.com/when-sass-and-new-css-features-collide/),
  CSS-Tricks, 29 June 2020). Her diagnosis generalizes: *"The problems in all of
  these cases arise from Sass or Compass having identically-named functions and
  assuming those are what we intended to use in our code."*
- **Getting the heuristic right took three releases.** Dart Sass 1.40.0 added
  first-class `calc()` plus plain-CSS `min()`/`max()`; **1.40.1 reverted an
  unintended breaking change**; 1.42.0 re-landed it ([dart-sass
  CHANGELOG](https://github.com/sass/dart-sass/blob/main/CHANGELOG.md)). Real
  builds broke in between —
  [`sass/sass#3142`](https://github.com/sass/sass/issues/3142) is Bootstrap
  failing on `max($value, 0)`.
- **It was not only `min`/`max`.** Sass has since had to deprecate passing a
  percentage to the global `abs()` because [CSS's `abs()` resolves percentages
  before the function and Sass's after](https://sass-lang.com/documentation/breaking-changes/abs-percent/)
  — authors must migrate to `math.abs()`.
- **Less broke too.**
  [`less/less.js#3463`](https://github.com/less/less.js/issues/3463) (Jan 2020)
  is one line — `border-width: max(.01rem, 1px);` — and the report: *"This code
  will break compile process."*

**Result: the same collision reasoning that renamed `@if` did not stop ten
function names, and both major preprocessors broke.**

Put 1 and 2 together and the status quo is **arbitrary**. Preprocessor collision
blocked `@if` but not `min()`. It neither preserved CSS's design freedom nor
protected the ecosystem — it produced inconsistent outcomes, a five-year-open
naming issue, and a lot of author-visible breakage. That is what happens when
there is no principle, only case-by-case judgement calls.

### 3. `@` is contested — Less's `@var` vs CSS's at-rules

The mirror image, and a cost we carry in-grammar today. Less spells variables
`@name` while CSS spells at-rules `@name`. Jess inherits both sides: its Less
grammar must actively disambiguate "variable" from "at-rule" at parse time, and
that ambiguity surfaces to users as strictness rules (a bare `@var` in an at-rule
prelude is a hard error in Jess v5). It is also why Jess's own compiler at-rules
take the `@-` dash prefix instead of plain `@name`.

`@` is genuinely shared, which is precisely the problem. `$` is not shared yet.

### 4. The CSSWG has already reasoned its way to this line

The CSSWG wiki page [Why not use `$` for variable
references?](https://wiki.csswg.org/ideas/dollar-variables) — the WG's own record
of why custom properties are `--foo`/`var()` rather than `$foo` — lists
preprocessor conflict among its reasons:

> The `$` syntax is already used by common CSS preprocessors, like Sass. Using it
> for a CSS feature with substantially different semantics […] would make it very
> difficult for users of those preprocessors to use both at the same time.

CSS already avoids `$` *de facto*, for exactly this reason. The pact asks to make
that existing, already-reasoned position **explicit and durable** — and to pay
for it with obligations on our side. That is a much smaller ask than it first
appears.

### And it is still happening

CSS is currently specifying [CSS Custom Functions and Mixins Level
1](https://drafts.csswg.org/css-mixins-1/), an Editor's Draft defining
`@function`, `@mixin`, `@apply`, `@macro`, `@result` and `@contents` —
substantially Sass's at-rule vocabulary, being standardized into the namespace we
took first. **Good.** It should proceed. But it is the next `min()`/`max()`
arriving on schedule, and it is the reason to draw the boundary now rather than
after another decade of case-by-case negotiation.

## Filing notes

- File against [`w3c/csswg-drafts`](https://github.com/w3c/csswg-drafts). Likely
  `[css-syntax]` or `[css-variables]`; reference #6684, #112 and css-mixins-1 as
  motivation.
- **File with the CSSWG first, in your own voice. Do not make Sass buy-in a
  precondition.** Pre-asking hands a veto to a party with no obligation to
  respond: silence stalls the filing indefinitely, and an explicit "we'd rather
  not" manufactures a documented objection before it is even filed. The "did you
  go around them?" problem only arises if you ask privately and then file anyway
  — filing publicly and inviting in the same motion is transparent from the
  outset. csswg-drafts is public and Sass maintainers are already parties to
  #6684 and #335, so the filing itself is the invitation. Feedback on a live
  proposal is also a better engagement frame than being asked to co-sign a draft.
- **Do not speak for Sass.** Write as the Less.js maintainer building Jess. Keep
  every Sass reference strictly factual — Sass uses `$` for variables, Sass is
  the largest affected constituency, the proposal is written to serve any
  build-time stylesheet processor rather than Jess specifically. Claim no
  endorsement. Close by welcoming their input explicitly: *"I'd particularly
  welcome input from the Sass maintainers, who have more at stake here than I
  do."*
- **After filing**, link the issue in `sass/sass` (or to `nex3`) as a
  notification — "filed this with the CSSWG, would value your input, happy to
  revise" — not as a request for permission.
- Re-verify every spec quote and issue state against current drafts at filing
  time; citations here were checked 2026-07-24, and #6684 and css-mixins-1 are
  live.
- Sass adopted `$` in Sass 3 (2010); earlier versions used `!name`. Do not claim
  "since 2006" — the project dates from 2006, the `$` sigil does not.
- Before filing, re-verify the Jess no-squatting claims against the grammar, and
  clean up or be ready to explain the stale pre-rewrite `.jess` fixtures under
  `packages/*/test/files/` that still contain bare `@let` / `@mixin` / `@include`
  — they do not parse today, but anyone auditing the repo will find them.
