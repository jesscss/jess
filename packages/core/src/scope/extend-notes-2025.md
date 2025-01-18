# Rules for extend

1. `.z:extend(.a; all)` matches `.a` and `:is(.a)` and `.a.b` but not `.apple`
2. `.z:extend(.a.b; all)` matches `.a.b` and `.b.a` and `.b.c.a`
  a. `.b.c.a` becomes `:is(.b.a, .z).c`
3. Targets with combinators include all compound selectors
  e.g. `.z:extend(.a > .b; all)` matches `.a.c > .b` to become `.a.c > .b, .z` and not
       `.a.c > .b, .z.c` because that's illogical. `.c` is not "joining" `.a > .b`; it
       only joins `.a` so `.z` must replace the entire match.
4. `div:extend(.a)` will NOT match `span.a` because `:is(span):is(div)` does not make sense.

