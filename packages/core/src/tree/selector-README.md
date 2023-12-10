How do we test that the following are equivalent?

:is(a) > b c {}
:is(a) :is(> b) c {}
:is(a) > :is(b c) {}
:is(a > b) c {}
:is(a > b) :is(c) {}
:is(a > b c) {}

I think what we have to do is reduce any :is() or :where() to it's simple components IF it doesn't contain a list.

But then how do we test that these are equivalent?

:is(a, b) c {}
:is(b, a) c {}
a c, b c {}
b c, a c {}

Somehow we have to normalize and group the latter selectors into their repeated elements.