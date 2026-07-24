# `$` as CSS's build-time tooling user space — CSSWG proposal

Status: **TODO — NOT FILED, NOT AGREED, NOT a decision.** This records an action
item and the argument for it. Nothing here is settled by anyone but us, and
nothing here constrains Jess's grammar today.

Action: open an issue on [`w3c/csswg-drafts`](https://github.com/w3c/csswg-drafts)
proposing that CSS define `$`-led token shapes as a **reserved namespace for
build-time stylesheet processing**, specified the same way `--*` custom
properties are.

## The ask, stated positively

CSS already has an **author user space at runtime**: `--*`. It is a namespace CSS
deliberately carved out, gave an intentionally permissive grammar, and promised
never to assign built-in meaning to.

The proposal is the same construct at a different lifecycle stage: **`$*` as a
tooling/processing user space at build time.** These tokens are resolved and
stripped by a preprocessor before the stylesheet ever reaches a browser. CSS
never has to *interpret* them — only commit to never *claiming* them.

That framing matters. This is not "please avoid our sigil." It is "define a
namespace," which is a thing the spec family already knows how to do.

## The `--*` precedent, verbatim

[css-variables-1 §2 "Defining Custom Properties: the `--*` family of
properties"](https://drafts.csswg.org/css-variables-1/#defining-variables)
defines the whole namespace as one property with a token-stream value:

> Name: `--*` — Value: `<declaration-value>?`

and states the commitment outright:

> Custom properties are solely for use by authors and users; CSS will never give
> them a meaning beyond what is presented here.

It even reserves *within* the namespace, which is exactly the shape of commitment
being asked for here — `<custom-property-name>` is any dashed-ident

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

Note the namespace already partially exists by accident: `$` has no special
tokenization in [css-syntax-3](https://drafts.csswg.org/css-syntax-3/) — it falls
through to `<delim-token>` — so `$`-led tokens are already legal *inside* a
`--*` value today. What is missing is (a) coverage of property-name, statement,
and selector positions, and (b) a durable commitment rather than an accident.

## Precise scope of the reservation

Reserve `$` followed by anything **other than `=`**. Concretely, the shapes in
use today:

| Shape | Used by |
|---|---|
| `$<ident>` | Sass variables; Jess variables (`$$name` = scoped lookup) |
| `$(…)` | Jess value-position interpolation / expression boundary |
| `$[…]` | Jess accessor / lookup (`$*[…]` = selector capture) |
| `${…}` | Less interpolation (alongside `@{…}`) |

Positions that must be covered — a value-only reservation is not sufficient,
because preprocessor syntax appears wherever authors write names:

- **declaration value** — `color: $brand`, `width: $(2 * $w)`
- **declaration name / property position** — `$[name]: red`
- **statement start** — `$brand: blue`
- **selector position** — `.a$[x]`, `$extend`
- **inside quoted strings and `url()` bodies** — `content: "$[x]"`

The commitment requested is narrow: CSS assigns no meaning to these, and defines
no future feature that claims them. CSS is not asked to parse, evaluate, or
round-trip them.

## Explicitly NOT in scope: `$=`

`[attr$="x"]` — the **suffix-match attribute selector** — is established CSS and
is entirely unaffected. [Selectors 4 §6.2 "Substring matching attribute
selectors"](https://drafts.csswg.org/selectors-4/#attribute-substrings) defines
`[att$=val]` as matching an element whose attribute value ends with `val`,
alongside `^=` (prefix) and `*=` (substring). The reservation must be written to
exclude it — `$` immediately followed by `=` in a selector stays exactly what it
is today.

Checked against css-syntax-3 and selectors-4: `$=` is the only place CSS gives
`$` any meaning. Everywhere else it is an unassigned `<delim-token>`. Re-verify
against current drafts before filing.

## Why — the evidence

### 1. The CSSWG has already paid for this collision: `@if` → `@when`

This is documented history, not speculation. CSS Conditional's generalized
conditional rule is spelled `@when`, and the reason is Sass.

[`w3c/csswg-drafts#112`](https://github.com/w3c/csswg-drafts/issues/112) (opened
by tabatkins, 2016) is the original conditional-rules thread that resolved on the
`@when`/`@else` proposal. [`#6684 "[css-conditional-4] Rename @when to
@if"`](https://github.com/w3c/csswg-drafts/issues/6684) (LeaVerou, Sept 2021)
opens by stating the rationale as fact:

> The reasoning for using `@when` over `@if` is that `@if` clashes with Sass, a
> widely used CSS preprocessor. To my knowledge, no other reasoning exists for
> this decision.

That issue is **still open**, and `@when` is still the name in the current
[css-conditional-5](https://drafts.csswg.org/css-conditional-5/) draft — five
years of unresolved WG time spent on one name collision, with live follow-on
threads ([#12903](https://github.com/w3c/csswg-drafts/issues/12903),
[#12909](https://github.com/w3c/csswg-drafts/issues/12909)) still working out how
`@when` and `if()` relate.

The load-bearing point is not who is right. It is that **the status quo
constrains CSS itself**, case by case, with no principled boundary. #6684 makes
that argument better than we can:

> What happens if in the future we want to add a looping construct to CSS as
> well? `@each`, `@for`, `@while` are all taken. How much do we contort CSS to
> avoid clashing with preprocessors?

and notes it has happened before:

> CSS has already made syntactic decisions to avoid clashing with Sass, namely
> square brackets over parentheses in grid properties.

A sanctioned `$` namespace is the principled answer to that question. It gives
CSS back a clean rule — **`@` and bare idents are CSS's; `$` is tooling's** — so
future features stop needing per-feature naming compromises.

### 2. `@` is contested today — the outcome to avoid for `$`

Less uses `@name` for variables while CSS uses `@` for at-rules. Jess inherits
both sides of that: it has its own `@`-led compiler at-rules and needs a `@-`
dash convention to mark them (`@-import`, `@-compose`, `@-use`), and its Less
grammar must actively disambiguate "variable" from "at-rule" at parse time. That
ambiguity is a permanent grammar tax, and it produces user-visible strictness
rules (e.g. a bare `@var` in an at-rule prelude is a hard error in Jess v5).

We are not claiming `@` belongs to CSS alone — it is genuinely shared, which is
precisely the problem. `$` is not shared yet. Reserving it keeps it that way.

### 3. The CSSWG has already articulated the reason itself

The CSSWG wiki page [Why not use `$` for variable
references?](https://wiki.csswg.org/ideas/dollar-variables) — the WG's own record
of why custom properties are `--foo`/`var()` rather than `$foo` — lists
preprocessor conflict among its reasons:

> The `$` syntax is already used by common CSS preprocessors, like Sass. Using it
> for a CSS feature with substantially different semantics […] would make it very
> difficult for users of those preprocessors to use both at the same time.

So CSS already avoids `$` *de facto*, for exactly this reason. The proposal only
asks to make that existing, already-reasoned position **explicit and durable**.
That is a much smaller ask than it first appears.

## The counter-argument, and the answer

The opposing position is real and well-organized:
[`w3ctag/design-principles#335`](https://github.com/w3ctag/design-principles/issues/335)
— "Do not design around third-party tools unless it actually breaks the Web" —
plus the arguments in #6684 that standards outlive tools and that preprocessors
can migrate.

The namespace framing answers it rather than fighting it. Designing *around*
tools case by case is what #335 objects to, and it is exactly what the status quo
forces. Defining one bounded namespace is the opposite: a one-time boundary after
which CSS never designs around a preprocessor again. It also stops being a
two-vendor request — any current or future build-time stylesheet processor gets
the same sanctioned space.

## Filing notes

- File against [`w3c/csswg-drafts`](https://github.com/w3c/csswg-drafts). Likely
  `[css-syntax]` or `[css-variables]`; reference #6684 and #112 as motivation.
- **Coordinate with the Sass team first.** Under the namespace framing they are
  co-proposers of shared infrastructure, not a competing claimant — and they are
  by far the larger constituency. A joint Sass + Jess proposal carries
  substantially more weight than a Jess-only one, and Sass maintainers are
  already parties to the #6684 / #335 threads.
- Re-verify every spec quote and issue state against current drafts at filing
  time; the citations here were checked 2026-07-24 and #6684 is a live thread.
- Sass adopted `$` in Sass 3 (2010); earlier versions used `!name`. Do not claim
  "since 2006" — the project dates from 2006, the `$` sigil does not.
