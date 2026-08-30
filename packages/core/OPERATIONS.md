# Operations semantics — moved

The comparison of `.less` / `.scss` measured behaviour against the `.jess`
target lives in **[`docs/design/RESOLVED-SEMANTICS-AND-NAMING.md`](../../docs/design/RESOLVED-SEMANTICS-AND-NAMING.md)**.

This file was one of the three documents that `75417984a` folded into that one
page. Everything it held is there, and there it is pinned to oracle versions
and kept current:

- the four resolutions, and the `$foo['1px']` index-lookup example — §1
- Less and Sass measured behaviour, against lessc 4.6.3 and dart-sass 1.101.0 — §3
- the `.jess` expected block — §4, with two corrections this file predates:
  `$(b > a)` is **true** (§4.2, relational is trichotomous) and `h4` is
  `calc($($val / 2))`, not `calc($(val / 2))`
- the comparison model and the ground each operand pair picks — §4.1

Its resolution 1, "Remove `equalityMode` from Jess options", is **done**.
`equalityMode` and `EqualityMode` no longer exist anywhere in the codebase. The
comparison KIND is carried by the guard node's own `op` — `=` loose, `==`
type-equal, `sass-equal` the Sass-equality primitive — which is what each
dialect front end lowers to. See §5.1, §7.3, and the comparison-KIND doc
comment above `SASS_EQUAL` in `src/ast/value-guards.ts`.
