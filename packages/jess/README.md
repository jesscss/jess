<div align="center">
  <img width="144" height="144" src="https://raw.githubusercontent.com/jesscss/jess/dev/packages/docs/docs-jess/static/img/android-chrome-192x192.png" alt="Jess logo">
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

Jess supports the three most recent Node LTS lines: Node `^20.19.0 || >=22.12.0`
(the `engines` range in `package.json`). The range advances with that rolling
window.

## CLI

```sh
# Compile a Less file to CSS (writes input.css next to it)
jess input.less

# Choose the output file, or an existing output directory
jess input.less output.css
jess input.less -o dist

# Compile several files: one run per file
for f in src/*.less; do jess "$f" -o dist; done

# Lint CSS, Less, SCSS, and Jess files
jess lint
jess lint "src/**/*.{css,less,scss,jess}"
jess lint src/app.scss --format json
```

Jess follows the common CLI pattern where the default command compiles a file and
`jess lint` is a separate workflow. Use `jess <input> [output]` when you want CSS
output; use `jess lint` when you want diagnostics without writing CSS.

`jess <input> [output]` compiles one `.less`, `.scss`, or `.jess` file.
It never writes CSS over its input, whatever the spelling (a case variant, a
symlink, or a hard link), and never over a `.less`, `.scss`, `.sass`, or
`.jess` file: `jess a.less b.less` is refused rather than replacing `b.less`, and
a third argument is an error. Diagnostics go to stderr. Color and terminal
hyperlinks are on only when stderr is a terminal and `NO_COLOR` is unset;
`--color` and `--no-color` override that. `jess --version` prints the version.

| Exit status | Meaning |
| --- | --- |
| 0 | The CSS was written (`jess lint`: no errors, and no more warnings than `--max-warnings`). |
| 1 | The stylesheet failed to compile, or a file could not be read or written (`jess lint`: an error was found, or the warnings exceeded `--max-warnings`). |
| 2 | Invalid command line: an unknown option, a missing or extra argument, or an output path that would overwrite a stylesheet. |

By default, Jess preserves nesting instead of flattening it. If you want
flattened selector output, set `output: { collapseNesting: true }` in a
`styles.config.*` file (jess uses the nearest one at or above the input file,
up to the package root).

`jess lint` prints compact per-file diagnostic rows by default. It supports
`--format json`, `--max-warnings 0`, `--syntax-only`, `--quiet`, `--config`,
`--color`, and `--no-color` (by default, color is on only when stdout is a
terminal and `NO_COLOR` is unset). Text output uses lint rule names, while JSON
diagnostics include both the lint `ruleName` and the shared Jess diagnostic
`code`.

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
