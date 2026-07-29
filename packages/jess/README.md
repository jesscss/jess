<div align="center">
  <img width="144" height="144" src="https://raw.githubusercontent.com/jesscss/jess/dev/packages/docs/static/img/android-chrome-192x192.png" alt="Jess logo">
</div>

# jess

> **Very early alpha.** This package is usable, but the public surface is still
> narrow and moving. Expect rough edges, missing pieces, and change. Please
> [report bugs](https://github.com/jesscss/jess/issues).

**The current public alpha CLI for Jess.**

`jess` is the main entry point right now. In this alpha, the `jess`
command-line tool compiles stylesheets to CSS and can lint CSS-family
stylesheets through Jess diagnostics.

That is the first step, not the whole story: the alpha starts with familiar
Less workflows while the broader Jess language surface settles.

Docs: [jesscss.github.io](https://jesscss.github.io/).

## Install

```sh
npm install jess
```

Jess supports the current Node LTS line and the prior three LTS lines. The
current derived floor is Node 18; it advances only when that rolling window
advances.

## CLI

```sh
# Compile a Less file to CSS (writes input.css next to it)
jess input.less

# Choose the output file, or an output directory
jess input.less output.css
jess input.less -o dist

# Lint CSS, Less, SCSS, and Jess files
jess lint
jess lint "src/**/*.{css,less,scss,jess}"
jess lint src/app.scss --format json
```

Jess follows the common CLI pattern where the default command compiles a file and
`jess lint` is a separate workflow. Use `jess <input> [output]` when you want CSS
output; use `jess lint` when you want diagnostics without writing CSS.

By default, Jess preserves nesting instead of flattening it. If you want
flattened selector output, opt in with `--collapse-nesting`.

`jess lint` prints compact per-file diagnostic rows by default. It supports
`--format json`, `--max-warnings 0`, `--syntax-only`, `--quiet`, `--config`, and
`--no-color`.

## What works today

The current public alpha entry point is:

- `.less` compilation through `jess`
- linting `.css`, `.less`, `.scss`, and `.jess` through `jess lint`
- variables, mixins, guards, nesting, `extend`, maps, operations, and built-in
  functions
- the Jess compiler engine under the hood
- a narrow first step toward the broader Jess language direction

## Programmatic API

The CLI is the public surface today. The JavaScript/TypeScript API is still
settling, so this README stays focused on the commands you can use now.

## Contributing

Issues and ideas welcome: <https://github.com/jesscss/jess/issues>.

See also:

- [repo README](https://github.com/jesscss/jess#readme)
- [contributing guide](https://github.com/jesscss/jess/blob/dev/CONTRIBUTING.md)

## License

[MIT](https://github.com/jesscss/jess/blob/dev/LICENSE)

### P.S. Why the hawk?

_A "jess" is a short leather strap fastened around the leg of a hawk._
