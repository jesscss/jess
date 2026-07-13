# @jesscss/patch-css

**A tiny runtime helper that attaches cached stylesheets from `localStorage` in
the document head.**

`@jesscss/patch-css` is a small browser utility from the
[Jess](https://github.com/jesscss/jess) project. Loaded synchronously in the
`<head>` — without `async` or `defer` — it re-attaches any stylesheets that were
previously cached in `localStorage`, so styling is in place before first paint.

It exposes a single function, `updateSheet(text, id)`, which inserts (or updates)
a `<style>` element for the given id and writes the current stylesheet cache back
to `localStorage`. To refresh the cache, call `updateSheet` for each stylesheet.

## Install

```sh
npm install @jesscss/patch-css
```

The `latest` and `alpha` dist-tags both point at the current alpha.

## Status

Alpha, and an early utility surface — expect the shape to change. Please
[report bugs](https://github.com/jesscss/jess/issues).

## Links

- Repository: <https://github.com/jesscss/jess>
- Documentation: <https://jesscss.github.io/> (currently pre-alpha content)

## License

[MIT](https://github.com/jesscss/jess/blob/dev/LICENSE)
