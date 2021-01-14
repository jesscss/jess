## A NOTE ABOUT CSS SYNTAX

CSS, as far as syntax is defined in https://www.w3.org/TR/css-syntax-3/,
is somewhat confusing the first 50 times you read it, probably because
it contains some ambiguities and inherent self-contradictions due to
it's legacy nature. It also has no specific "spec" to draw from.

CSS essentially is not one spec of syntax and grammar, but is, in fact,
a collection of specs of syntax and grammar, some of which can mean that
parsing rules are potentially contradictory.

For example, if you were to just parse: `foo:bar {}`, if you just went by
the syntax spec alone, there's no way to resolve this. Property values
(according to spec), may have `{}` as a value, and pseudo-selectors may start
with a colon. So this may be a property of `foo` with a value of `bar {}`
or it may be the selector `foo:bar` with a set of rules in `{}`.

CSS resolves syntactic ambiguity by specifying that blocks should have different
parsing strategies based on context. Blocks can either parse a list of rules,
or can parse a list of declarations (at-rules are considered declarations),
but not both.

Here's the rub: blocks are generic, can be wrapped in `()`, `[]`, or `{}`,
and which type they consume is not defined globally; it's defined by that
particular declaration's own grammar. In addition, if one assumes that `{}`
is always a list of declarations, that's not the case. Custom properties
can contain curly blocks that contain anything.

Making a context-switching CSS parser is possible, but not useful, both for
custom properties that define a rule-like block, and for generalizing
parsing for pre-processors like Less. Unfortunately, any pre-processor with
nested syntax is inherently ambiguous for the above reasons, meaning any
pre-processor like Less, Sass, or PostCSS, using nested syntax, can never be
a 100% spec-compliant CSS parser.

However, in this CSS parser and parsers that extend it, we can intelligently
resolve ambiguities with these principles:

1. There are no element selectors that start with '--'
2. There are no currently-defined CSS properties that have a {} block as a
   possible value. (If this ever happens, CSS parsing libraries are screwed.)

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
a few exceptions, such as a closing block symbol e.g. ']' without a corresponding
opening block, and other such cases where the CSS spec explicitly expresses
should be a parse error.)
