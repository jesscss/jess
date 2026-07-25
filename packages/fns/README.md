# @jesscss/fns

**The built-in Less/Sass style-function library — color, math, string, and list
helpers, split per-file for tree-shaking.**

`@jesscss/fns` is the standard function library for
[Jess](https://github.com/jesscss/jess). It provides the built-in functions the language exposes:
color operations (`lighten`, `darken`, `mix`, `saturate`, …), math (`round`,
`floor`, `sqrt`, `pow`, …), unit and type helpers, string helpers, and list/map
utilities.

Functions live in their own files and are re-exported from a dialect index, so
bundlers can tree-shake down to only the helpers you actually use.

**Each dialect owns its globals.** A dialect folder's index exports what lives
in that folder plus the entries of `shared/` that dialect actually has, and that
index is simultaneously the importable module and the unit the compiler
registers. There is no merged built-in set and no fallback from one dialect to
another — a Sass function is never served the Less implementation.

```
@jesscss/fns              → dialect namespaces (`less`, `sass`, `shared`) + registry helpers
@jesscss/fns/less         → the Less dialect index (the Less built-in set)
@jesscss/fns/sass         → the Sass dialect index (Sass globals)
@jesscss/fns/sass/color   → sass:color
@jesscss/fns/sass/list    → sass:list
@jesscss/fns/sass/map     → sass:map
@jesscss/fns/sass/math    → sass:math
@jesscss/fns/sass/string  → sass:string
@jesscss/fns/shared       → functions whose behaviour is identical in Less and Sass
@jesscss/fns/registry     → `makeLessRegistry()` / `makeSassRegistry()` / `registryOf(index)`
```

Adding a built-in is a new module in the dialect folder plus one line in that
folder's index. Nothing else enumerates the set.

Entries that are still in the legacy tree-node domain remain exported for the
JavaScript-callable surface but are not registered as built-ins; converting one
in place is what registers it.

The Sass-side helpers exist in the source tree as part of the roadmap **Sass+**
work, but SCSS is not the focus of the Less-focused alpha — treat that surface as
experimental.

## Who uses it

This is an internal engine package. The functions are primarily invoked by the
compiler during evaluation, and several expect a Jess evaluation context on
`this` — they are not yet a general-purpose, standalone JavaScript API. Most
people should install [`jess`](https://www.npmjs.com/package/jess) and use the
`jess` CLI. The JavaScript/TypeScript API is **not yet stabilized**.

## Status

Alpha. Published to npm under both the `latest` and `alpha` dist-tags. Please
[report bugs](https://github.com/jesscss/jess/issues).

## Links

- Repository: <https://github.com/jesscss/jess>
- Documentation: <https://jesscss.github.io/> (currently pre-alpha content)

## License

[MIT](https://github.com/jesscss/jess/blob/dev/LICENSE)
