# @jesscss/fns

**The built-in Less/Sass style-function library — color, math, string, and list
helpers, split per-file for tree-shaking.**

`@jesscss/fns` is the standard function library for
[Jess](https://github.com/jesscss/jess) — Less.js v5, a ground-up rewrite of the
Less CSS preprocessor. It provides the built-in functions the language exposes:
color operations (`lighten`, `darken`, `mix`, `saturate`, …), math (`round`,
`floor`, `sqrt`, `pow`, …), unit and type helpers, string helpers, and list/map
utilities.

Functions live in their own files and are re-exported from a barrel, so bundlers
can tree-shake down to only the helpers you actually use.

```
@jesscss/fns          → the Less function set (the alpha surface)
@jesscss/fns/<name>   → import a single function directly
```

The Sass-side helpers exist in the source tree as part of the roadmap **Sass+**
work, but SCSS is not the focus of the Less-focused alpha — treat that surface as
experimental.

## Who uses it

This is an internal engine package. The functions are primarily invoked by the
compiler during evaluation, and several expect a Jess evaluation context on
`this` — they are not yet a general-purpose, standalone JavaScript API. Most
people should install [`jess`](https://www.npmjs.com/package/jess) and use the
`jess` / `lessc` CLIs. The JavaScript/TypeScript API is **not yet stabilized**.

## Status

Alpha. Published to npm under both the `latest` and `alpha` dist-tags. Please
[report bugs](https://github.com/jesscss/jess/issues).

## Links

- Repository: <https://github.com/jesscss/jess>
- Documentation: <https://jesscss.github.io/> (currently pre-alpha content)

## License

[MIT](https://github.com/jesscss/jess/blob/dev/LICENSE)
