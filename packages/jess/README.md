<div align="center">
  <img width="144" height="144" src="https://raw.githubusercontent.com/jesscss/jess/dev/packages/docs/static/img/android-chrome-192x192.png" alt="Jess logo">
</div>

# jess

**Less.js v5 — the Less CSS preprocessor, rebuilt from the ground up.**

The `jess` package is the main entry point: the `jess` and `lessc` command-line
tools that render Less to CSS. Jess is the next major version of Less,
re-implemented on a new, modern compiler engine.

> **Alpha software.** `2.0.0-alpha.7` is published and renders real Less, but it
> is early and has known rendering gaps and expected failures. Don't ship it to
> production yet, and please [report bugs](https://github.com/jesscss/jess/issues).
> Docs: [jesscss.github.io](https://jesscss.github.io/) (currently pre-alpha content).

## Install

```sh
npm install jess
```

The `latest` and `alpha` dist-tags both point at the current alpha. Requires
Node 16+.

## CLI

```sh
# Compile a Less file to CSS (writes input.css next to it)
jess input.less

# Choose the output file, or an output directory
jess input.less output.css
jess input.less -o dist

# lessc drop-in (Less 4.x command surface, Less v5 output semantics)
lessc input.less output.css
lessc --collapse-nesting input.less   # 4.x-style flattened output
```

Jess targets Less **v5**, whose default output **preserves nesting** rather than
flattening it as Less 4.x did. Opt into 4.x-style flattening with
`--collapse-nesting`. The `lessc` binary is a drop-in for the Less 4.x command
surface (flags, stdin/stdout, exit codes) with v5 output semantics.

## Programmatic API

The CLI is the stable public surface for the alpha. The JavaScript/TypeScript API
is **not yet stabilized** and is intentionally undocumented for now — use the CLI,
and watch the [docs site](https://jesscss.github.io/) for the API once it settles.

## What works today

The working language surface is **Less (v5)** — if you write Less, you write Jess:

```less
@width: 10px;
@height: @width + 10px;

.card {
  width: @width;
  height: @height;
  color: cornflowerblue;
}

.rounded(@radius: 4px) {
  border-radius: @radius;
}

.panel {
  .rounded(8px);
  & > .title { font-weight: bold; }
}
```

Variables, mixins (parameters and guards), nesting, `extend`, maps, operations,
and the Less built-in functions are all part of the alpha surface.

## Roadmap (not yet)

The language ships as an ordered progression — only Less.js is shipping today:

1. **Now — Less.js.** Less v5, the current alpha, stabilizing first.
2. **Next — the "Sass+" dialect.** The Sass successor (an experimental SCSS
   parser/plugin is the base; not shipped).
3. **Final — native `.jess` syntax.** The `.jess` parser is deliberately
   unfinished while Less (then Sass+) stabilize.

JS/TS interop, stylesheet exports, and bundler plugins are future work.

## Contributing

Issues and ideas welcome: <https://github.com/jesscss/jess/issues>. See the
[repo README](https://github.com/jesscss/jess#readme) and
[contributing guide](https://github.com/jesscss/jess/blob/dev/CONTRIBUTING.md).

## License

[MIT](https://github.com/jesscss/jess/blob/dev/LICENSE)

### P.S. Why the hawk?

_A "jess" is a short leather strap fastened around the leg of a hawk._
