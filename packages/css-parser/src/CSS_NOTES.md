## A NOTE ABOUT CSS SYNTAX

CSS, as far as syntax is defined in https://www.w3.org/TR/css-syntax-3/,
is somewhat confusing the first 50 times you read it, probably because
it contains some ambiguities and inherent self-contradictions due to
it's legacy nature. It also has no specific "spec" to draw from.

CSS essentially is not one spec of syntax and grammar, but is, in fact,
a collection of specs of syntax and grammar, some of which can mean that
parsing rules are potentially contradictory.

For example, if you were to just parse: `foo:bar {}`, if you just went by
the syntax spec alone, there's no (immediate) way to resolve this. Property values
(according to spec), may have `{}` as a value, and pseudo-selectors may start
with a colon. So this may be a property of `foo` with a value of `bar {}`
or it may be the selector `foo:bar` with a set of rules in `{}`.

CSS resolves syntactic ambiguity by specifying that blocks should have different
parsing strategies based on context. Blocks can either parse a list of rules,
or can parse a list of declarations (at-rules are considered declarations),
but not both.

However, it's not just blocks. Property values, also, are defined by their
individual parsing specifications. For example, CSS defines a "list" as
being either comma-separated or slash-separated. But a list of what? That
starts where? One might naively presume that, for a list, a slash or comma
separates and groups all preceding values from all following values. Sometimes
that's the case! But in the case of the background (shorthand) property, a
a slash separates one _single_ value (token) from one _single_ following token and those represent distinct values. Yet, in the case of the new color function
syntax, a slash separates _all_ preceding values from the final (opacity) value.

This means that CSS cannot be defined by context-free grammar. Tokenization is
different depending on context and preceding tokens. Custom properties can
be especially challenging for many CSS parsers, as it requires recursive
tokenization of matching blocks (`{}`, `[]`, `()`), which not all parsing
libraries support. In fact, the entire custom property value _should_ be
returned as a single token, including white-space and any inner comments,
so this is another case in CSS (other than a space combinator) where the spaces
cannot just be discarded.

What this results in is that most CSS parsers (that operate outside the browser)
are incorrect in any number of ways, and occassionally browsers can
easily get it wrong as well (although they are typically more rigourously
tested).

This parser aims to be as spec-compliant as possible (with supported specs),
while offering a legacy mode for some old existing CSS code in the wild
(such as early IE hacks).

CSS grammar is extremely permissive to allow modularity of the syntax and
future expansion. Basically, anything "unknown", including unknown tokens,
does not necessarily mean a parsing error of the stylesheet itself. For
example, the contents of an at-rule body (defined in a "{}") has no explicit
definition, but is instead left up to the spec for that particular at rule.
That means you could end up with some future at-rule like:
`@future {!!:foo > ; > ?bar}`
A case like that is _unlikely_, but the point is any CSS parser that lives
outside of the browser, in order to be maintainable, must parse what it
_can_, but preserve almost anything it doesn't explicitly define. (There are
a few exceptions, such as a closing block symbol e.g. `]` without a corresponding
opening block, and other such cases where the CSS spec explicitly expresses
should be a parse error.)
