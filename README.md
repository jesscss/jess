<div align="center">
  <img width="144" height="144" src="https://raw.githubusercontent.com/jesscss/jess/dev/packages/docs/static/img/android-chrome-192x192.png" alt="Jess logo">
</div>

# Jess

> **Very early alpha.** Jess is still settling. The usable public entry point
> right now is the `jess` CLI compiling `.less`. Expect rough edges, missing
> pieces, and change while the language and tooling settle. Please
> [report bugs](https://github.com/jesscss/jess/issues).

**A stylesheet language and compiler for modern CSS-heavy codebases.**

Jess is about keeping the parts people reach for preprocessors for - variables,
reusable rules, functions, composition, and module boundaries - while staying
close to CSS and the platform's direction. It is meant to give stylesheets more
leverage without pushing teams into runtime styling or away from the platform.

Architecturally, Jess is growing toward a common stylesheet runtime: CSS, Less,
SCSS/Sass+, and Jess parse into one canonical stylesheet model, then share the
same evaluation and emission engine. The comparison is broad rather than
literal, but the intent is similar to what the CLR did for .NET languages or
LLVM did for compiler back ends: each language keeps its syntax while sharing a
strong lower-level representation.

The alpha starts by earning trust on familiar Less workflows, then opens toward
broader Jess syntax and composition over time. This repo is the home of the
Jess compiler, parsers, CLI tools, and supporting packages. Docs live at
[jesscss.github.io](https://jesscss.github.io/).

## Why Jess

- **CSS stays central.** Jess is for stylesheet authoring, not runtime UI code.
- **Compile-time power.** Variables, mixins, functions, and composition resolve
  ahead of time and ship as CSS.
- **A migration path, not a cliff.** The alpha starts from familiar Less
  workflows while the broader Jess language takes shape.
- **Modern CSS friendly.** Built to live with nesting, `@layer`, `@scope`,
  container queries, and the way the platform is moving.
- **A bigger language direction.** The current shipping entry point is narrow,
  but the project is broader than a Less-only toolchain.

## What you can use right now

The current alpha entry point is intentionally narrow so the engine can harden
against real workloads first:

- Write `.less`.
- Compile with `jess`.
- Keep the familiar Less mental model: variables, mixins, guards, nesting,
  `extend`, maps, operations, and built-in functions.
- Preserve nesting by default; use `--collapse-nesting` if you want flattened
  selector output.

## A quick feel

Jess the language is the bigger direction for the project, even though the
public alpha currently starts with Less-compatible input. The shape it is
growing toward looks more like this:

```jess
// Pull in styles from Less and Sass sources.
@-compose './theme.less' as theme;
@-compose './mixins.scss' as *;

// Jess keeps stylesheet authoring in CSS-space, but gives it richer composition.
.card {
  color: $theme.primary-color;
  $ > rounded(8px);

  & > .title {
    font-weight: 700;
  }
}
```

Two caveats on that snippet, since it is the shape and not the state of things:
module resolution is not wired up yet (`@-compose` currently round-trips
verbatim), and the parent selector `&` is deliberately still out of the `.jess`
parser.

## Repo layout

Jess is a pnpm monorepo. These are the major workspace packages today.
Some supporting packages are still experimental, in flux, or likely to merge
back into other packages as the alpha settles, so treat this as a map of the
repo more than a forever package contract.

| Package | Role |
| --- | --- |
| [`jess`](./packages/jess) | Main CLI entry point for the current alpha. |
| [`@jesscss/core`](./packages/core) | Compiler engine: AST, evaluation, and CSS emission. |
| [`@jesscss/css-parser`](./packages/syntax/css/css-parser) | Shared CSS base parser. |
| [`@jesscss/less-parser`](./packages/syntax/less/less-parser) | Less grammar on top of the CSS parser. |
| [`@jesscss/scss-parser`](./packages/syntax/scss/scss-parser) | Experimental SCSS grammar. |
| [`@jesscss/fns`](./packages/fns) | Built-in function library. |
| [`@jesscss/plugin-less`](./packages/jess-plugin-less) | Less language engine and defaults. |
| [`@jesscss/plugin-scss`](./packages/jess-plugin-scss) | Experimental SCSS language engine. |
| [`@jesscss/plugin-less-compat`](./packages/jess-plugin-less-compat) | AST-v2 native Less function contributions. |
| [`@jesscss/plugin-node-modules`](./packages/jess-plugin-node-modules) | Module resolution from `node_modules`. |
| [`@jesscss/plugin-js`](./packages/jess-plugin-js) | JavaScript and TypeScript module imports. |
| [`@jesscss/style-resolver`](./packages/style-resolver) | Import path resolution across stylesheet formats. |
| [`styles-config`](./packages/config) | Shared configuration schema and loader. |

Smaller helpers, tooling packages, and experiments also live under
[`packages/`](./packages), but not every workspace package should be read as a
stable long-term public surface.

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
```

## Programmatic API

The CLI is the public surface today. The JavaScript/TypeScript API is still
settling, so this README stays focused on the CLI. Watch the
[docs site](https://jesscss.github.io/) for API docs as that surface firms up.

## Contributing

Start here:

- [Contributing guide](./CONTRIBUTING.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [`AGENTS.md`](./AGENTS.md)
- [Open issues](https://github.com/jesscss/jess/issues)

This repo uses **pnpm** (`npm` and `yarn` are blocked via `only-allow`):

```sh
pnpm install
pnpm -r build
pnpm test
```

## Docs & license

- Documentation site: <https://jesscss.github.io/>
- Docs also live in [`packages/docs`](./packages/docs) and the package READMEs.
- Licensed under [MIT](./LICENSE).
