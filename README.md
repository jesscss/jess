<div align="center">
  <img width="144" height="144" src="https://raw.githubusercontent.com/jesscss/jess/dev/packages/docs/static/img/android-chrome-192x192.png" alt="Jess logo">
</div>

# Jess — Less.js v5

**Jess is Less.js v5: a ground-up rewrite of the Less CSS preprocessor.**

Jess re-implements the Less language on a new, modern compiler engine. It keeps
the Less mental model you already know — variables, mixins, nesting, functions —
while replacing the aging internals with a cleaner architecture built for speed,
correctness, and extensibility. This monorepo is the home of both the engine and
the `jess` / `lessc` command-line tools.

## What Jess is becoming

For a decade, styling a serious app meant stitching together a handful of tools:
a preprocessor (Less or Sass), something for scoping (CSS Modules), something for
programmability (CSS-in-JS), and a plugin ecosystem for everything else
(PostCSS). Jess is the **spiritual successor to all four** — one engine that
converges **preprocessing + scoping + programmability + extensibility**, built on
modern native CSS (nesting, `@layer`, `@scope`, container queries) instead of
fighting it.

That convergence is the vision. Here is where it honestly stands.

**Today — earned, shipping in the alpha:**

- **Less.js.** Jess literally *is* Less v5. `.less` renders now. This is the
  first milestone, and it's being locked in first.

**The roadmap — an ordered progression:**

1. **Now:** Less.js — the current alpha, stabilizing first.
2. **Next:** the **"Sass+"** dialect — the Sass successor.
3. **Final language milestone:** the native **`.jess`** syntax.
4. **Then — a minimal browser build:** statically trace which variables a
   stylesheet actually references and exports, and emit only the minimum set of
   CSS custom properties (inlining the rest).

**The convergence — capabilities being proven along the way (not yet shipped):**

Beyond preprocessing, the same engine is where scoping, programmability, and
extensibility come together — the reason Jess aims to be *one* tool instead of
four:

- **CSS Modules** ← where CSS Modules scopes *class names*, Jess scopes **and
  tree-shakes variables** — minimum variable exposure via the minimal browser
  build (the post-`.jess` milestone above).
- **CSS-in-JS** ← **JavaScript execution** in stylesheets (`@use` / `@plugin`,
  `plugin-node-modules`) — the dynamism, without leaving your CSS files.
- **PostCSS** ← a PostCSS-*like* extensibility layer: open, AST-level transforms
  over a real parser (parseman). It plays that role rather than replacing PostCSS
  or claiming compatibility.

Everything past Less.js is being **proven through the alpha, not claimed as
done**. The capabilities that seed it exist; the full story is what we intend to
earn before Jess exits alpha.

> **Status: alpha.** The first alpha (`2.0.0-alpha.7`) is published to npm. It is
> real, it renders real Less, and it is being dogfooded against the Less test
> suite and Bootstrap — but it is early software with known rendering gaps and
> expected failures. Don't ship it to production yet, and please
> [report bugs](https://github.com/jesscss/jess/issues). Docs live at
> [jesscss.github.io](https://jesscss.github.io/) (currently pre-alpha content).

## Status

- **Version:** `2.0.0-alpha.7` on npm (both the `latest` and `alpha` dist-tags).
- **Focus of this alpha:** Less v5 compatibility — parsing and rendering `.less`.
- **Known gaps:** some Less inputs still don't render correctly (tracked as
  expected failures), `lessc` CLI parity with Less 4.x is still being assessed,
  there is no browser build yet, and source maps are deferred past this alpha.
- **Not yet / non-goals for this phase:** the native `.jess` syntax and the
  "Sass+" dialect are on the roadmap but not shipped; SCSS support exists only as
  an experimental parser and is not a goal of the Less-focused alpha (see
  [Roadmap](#roadmap)).
- **Report issues:** <https://github.com/jesscss/jess/issues>.

## The engine

At its core Jess is a compiler that turns a stylesheet into CSS in three stages:

1. **Parse** the source into an AST.
2. **Evaluate** it — resolve variables, expand mixins, run functions, apply
   `extend`, and fold nesting.
3. **Render** the result to a CSS string.

The rewrite's headline architectural bet is a **single evaluate-and-emit pass**
(the "spine") that serializes directly over one canonical source tree instead of
repeatedly cloning and re-walking nodes. You don't need to know any of that to
use Jess — but it's why the engine is being rebuilt rather than patched.

### Performance intent

Speed is a core design goal. In the alpha it's still being earned — the
architecture is built for it, the optimization work is ongoing.

### Package layout

Jess is a pnpm monorepo. The publishable packages:

| Package | Role |
| --- | --- |
| [`jess`](./packages/jess) | Main entry point — the `Compiler` API plus the `jess` and `lessc` CLIs. |
| [`@jesscss/core`](./packages/core) | The compiler engine: AST, evaluator, and single-pass serializer. |
| [`@jesscss/css-parser`](./packages/css-parser) | Spec-aligned CSS base parser that the other grammars extend. |
| [`@jesscss/less-parser`](./packages/less-parser) | Less grammar, built on the CSS parser. |
| [`@jesscss/scss-parser`](./packages/scss-parser) | SCSS grammar (experimental; not the alpha focus). |
| [`@jesscss/fns`](./packages/fns) | Built-in Less/Sass function library (color, math, string, list…), tree-shakeable. |
| [`@jesscss/plugin-less`](./packages/jess-plugin-less) | The Less language engine + v5 defaults, wired into the compiler by default. |
| [`@jesscss/plugin-scss`](./packages/jess-plugin-scss) | SCSS language engine (experimental/roadmap). |
| [`@jesscss/plugin-less-compat`](./packages/jess-plugin-less-compat) | Less.js 4.x compatibility layer for running Less plugins/visitors against the Jess AST. |
| [`@jesscss/plugin-node-modules`](./packages/jess-plugin-node-modules) | Resolves and loads npm packages from `node_modules`. |
| [`@jesscss/plugin-js`](./packages/jess-plugin-js) | JavaScript/TypeScript module imports. |
| [`@jesscss/style-resolver`](./packages/style-resolver) | Import path resolution across css/less/scss/jess (include paths, load paths, extension/index). |
| [`styles-config`](./packages/config) | Shared configuration schema/loader for styling tools. |
| [`@jesscss/awaitable-pipe`](./packages/awaitable-pipe) | Tiny typed pipe that stays sync until a step returns a Promise. |
| [`@jesscss/patch-css`](./packages/patch-css) | Runtime helper to attach cached stylesheets from `localStorage`. |

## The language

Today the working language surface is **Less (v5)**. If you write Less, you write
Jess. All the familiar features are here:

```less
@width: 10px;
@height: @width + 10px;

.card {
  width: @width;
  height: @height;
  color: cornflowerblue;
}
```

```less
.rounded(@radius: 4px) {
  border-radius: @radius;
}

.panel {
  .rounded(8px);

  & > .title {
    font-weight: bold;
  }
}
```

Variables, mixins (with parameters and guards), nesting, `extend`, maps,
operations, and the Less built-in functions are all part of the alpha surface.

### v5 output defaults

Jess targets Less **v5**, whose default output differs from Less 4.x in one
important way: **nesting is preserved by default** rather than flattened. If you
want 4.x-style selector flattening, opt in with `--collapse-nesting` on the
`lessc` CLI (or the equivalent option in config). The `lessc` binary is intended
as a drop-in for the Less 4.x command surface (flags, stdin/stdout, exit codes),
with Less v5 semantics for the output.

### Roadmap

The language ships as an ordered progression — these are intended directions,
**not** working features today:

1. **Now — Less.js.** Less v5 is the current alpha, stabilizing first.
2. **Next — the "Sass+" dialect.** The Sass successor: a dialect that fixes and
   extends Sass-style ergonomics. An SCSS parser and plugin exist as the
   experimental base, but Sass+ is not shipped.
3. **Final language milestone — native `.jess` syntax.** A first-class Jess
   language (JS/TS interop, advanced mixins, module-style imports). The `.jess`
   parser is deliberately unfinished while Less (and then Sass+) stabilize, so
   `.jess` is not ready for use.
4. **After the language — a minimal browser build.** The scoping story, proven
   post-syntax: statically trace which variables are referenced in values and
   which are exported, and emit only the minimum set of CSS custom properties
   needed (inlining the rest). Where CSS Modules scopes class names, this scopes
   and tree-shakes *variables*.

Anything you see elsewhere describing `$`-prefixed Jess syntax, JS/TS `import`
into stylesheets, or Sass migration is roadmap material — treat it as a preview,
not a promise.

## Install & usage

```sh
npm install jess
```

The `latest` and `alpha` dist-tags both point at the current alpha, so a plain
`npm install jess` gets you `2.0.0-alpha.7`. Requires Node 16+.

### CLI

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

### Programmatic API

The CLI is the stable public surface for the alpha. The JavaScript/TypeScript
API is **not yet stabilized** and is intentionally undocumented for now — use the
CLI, and watch the [docs site](https://jesscss.github.io/) for the API once it
settles.

## Contributing

Jess is openly seeking contributors. Start here:

- [Contributing guide](./CONTRIBUTING.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [`AGENTS.md`](./AGENTS.md) — repo-wide operating rules and architecture pointers
- [Open issues](https://github.com/jesscss/jess/issues)

This repo uses **pnpm** (`npm`/`yarn` are blocked via `only-allow`):

```sh
pnpm install
pnpm -r build
pnpm test
```

## Docs & license

- Documentation site: <https://jesscss.github.io/> (content is currently
  pre-alpha and being updated).
- Docs also live in [`packages/docs`](./packages/docs) (and per-package
  `README.md` files).
- Licensed under [MIT](./LICENSE).
