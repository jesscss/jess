---
title: "Migrating to v5"
slug: "/usage/migrating-to-v5"
audiences:
  - less
origin: less
---

This guide focuses on practical migration from Less 4.x to the 5.x track.

## Browser usage status

:::warning
Less 5.x builds on Node, but supports dynamic style attachment in the browser (in development). Browser usage guidance is still evolving and may change before final release. If browser-side compilation is part of your product, validate behavior against your own fixtures before rollout.
:::

## Changes in 5.x

### New Jess engine

Less 5.x in this docs track runs on the Jess engine, which is designed to match CSS behavior more accurately while keeping Less semantics where expected.

### CSS nesting support

Nesting behavior is now first-class in the engine.

Important default: Less 5.x keeps nested structure by default (`collapseNesting: false`), so the output is native CSS nesting. Less 4.x always flattened nested rules; set `collapseNesting` to `'native'` or `'compact'` to flatten.

Default behavior example (`collapseNesting: false`):

```less
.card {
  padding: 1rem;

  .title {
    font-weight: 600;
  }

  @media (min-width: 48rem) {
    padding: 1.25rem;
  }
}
```

Compiles to:

```css
.card {
  padding: 1rem;
  .title {
    font-weight: 600;
  }
  @media (min-width: 48rem) {
    padding: 1.25rem;
  }
}
```

With `collapseNesting: 'native'`, the same source flattens to the shape Less 4.x wrote:

```css
.card {
  padding: 1rem;
}
.card .title {
  font-weight: 600;
}
@media (min-width: 48rem) {
  .card {
    padding: 1.25rem;
  }
}
```

`collapseNesting` takes `false` (the default), `'native'` or `'compact'`. `true` still works as a deprecated spelling of `'native'`.

### Flattened selector lists use `:is()`

When you flatten, a nested rule under a selector list is written the way a browser reads native nesting, not as Less 4.x's comma-separated cascade. The parent list is factored into one `:is()`:

```less
.a, #b {
  .c { color: red; }
}
```

```css
/* Less 4.x */
.a .c, #b .c { color: red; }

/* Less 5.x, 'native' and 'compact' */
:is(.a, #b) .c { color: red; }
```

An `:is()` scores as its most specific argument, so `.a .c` now has the specificity of `#b .c`, exactly as it does under native CSS nesting. Where every parent has the same specificity, nothing changes.

`'native'` also folds a nested child list into `:is()` where the fold changes neither specificity nor which elements match: `.t { th, .x, td, thead th { … } }` gives `.t :is(th, td), .t .x, .t thead th`. `'compact'` folds every descendant child list (`.t :is(th, td, thead th)`), scoring each branch at the group's highest specificity.

No flatten style folds a child branch with a pseudo-element into `:is()`, and none writes a selector list in which one selector a browser rejects takes the valid ones down with it. A parent that ends in a pseudo-element and would have something written after it gets a rule of its own, so the other parents keep matching:

```less
.a::before, .b, .c {
  &:hover { color: red; }
}
```

```css
/* Less 4.x: one list. A browser that rejects .a::before:hover drops all of it, .b:hover included. */
.a::before:hover, .b:hover, .c:hover { color: red; }

/* Less 5.x: the pseudo-element parent is written on its own. */
.a::before:hover { color: red; }
:is(.b, .c):hover { color: red; }
```

See [Selector Compaction](../advanced/selector-compaction) for every rule.

### At-rule variables require interpolation

Less 4.x deprecated bare variables in at-rule preludes, names, and identifiers.
Less 5.x removes that syntax so at-rules remain unambiguous as CSS evolves.
Wrap the variable reference in `@{...}` instead:

```less
@breakpoint: (min-width: 48rem);
@animation-name: fade-in;

// Removed in 5.x:
// @media @breakpoint { ... }
// @keyframes @animation-name { ... }

// Less 5.x:
@media @{breakpoint} {
  .card {
    animation: @animation-name 180ms ease-out;
  }
}

@keyframes @{animation-name} {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

This change applies anywhere a variable supplies at-rule syntax, including
`@media`, `@supports`, `@container`, `@layer`, and `@keyframes`. Variables used
inside ordinary declaration values keep the familiar `@name` spelling.

### Less-style parent suffix selectors (`&-1`)

Less 5.x also supports Less-style parent suffix composition such as `&-1`. This is a Less feature (not native CSS nesting syntax), and it remains useful for utility/variant naming.

Example:

```less
.col {
  &-1 {
    width: 8.333%;
  }
  &-2 {
    width: 16.666%;
  }
}
```

Compiles to:

```css
.col-1 {
  width: 8.333%;
}
.col-2 {
  width: 16.666%;
}
```

Less 5.x also makes the parent-template model explicit:

- `&()` keeps the parent selector but hoists the nested selector to root
- `&('')` drops the parent selector entirely
- `&(-1)` is equivalent to `&-1`

That gives you a consistent model for suffix composition, root-hoisted parent rendering, and explicit parent suppression.

### Extend groups its additions with `:is()`

An `all` extend that matches part of a selector adds the extender inside an `:is()` at that spot, instead of repeating the rest of the selector the way Less 4.x did. This happens in every output mode, nested included. An extender is grouped only with alternatives of the same specificity, so each selector keeps the specificity it had in Less 4.x:

```less
.a .c { color: red; }
.d:extend(.c all) {}
#e:extend(.c all) {}
```

```css
/* Less 4.x */
.a .c, .a .d, .a #e { color: red; }

/* Less 5.x */
.a :is(.c, .d),
.a #e {
  color: red;
}
```

An extend now also matches an `:nth-*()` target written with different spacing: `.b:extend(.x:nth-child(2n+1))` extends `.x:nth-child(2n + 1)`, which Less 4.x left alone.

See [Extend and `:is()` Wrapping](../advanced/extend-is-wrapping) for the full rules.

Syntax note: per-selector `all` in multi-target extends is deprecated in favor of a single `!all` flag on the extend call to reduce ambiguity.

```less
// Deprecated:
&:extend(.a all,
.b all);

// Preferred:
&:extend(.a,
.b !all);
```

A larger example:

```less
.sidebar {
  .box {
    margin: 10px 0;
  }
}

.sidebar2 {
  &:extend(.sidebar !all);
}

.type1 {
  .sidebar3 {
    &:extend(.sidebar !all);
  }
}
```

Less 5.x writes, in every output mode:

```css
:is(.sidebar, .sidebar2) .box,
.type1 .sidebar3 .box {
  margin: 10px 0;
}
```

`.type1 .sidebar3` stays out of the `:is()`: its specificity differs from `.sidebar`'s, and an `:is()` argument with a combinator would match more elements than the selector it replaces. Less 4.x wrote `.sidebar .box, .sidebar2 .box, .type1 .sidebar3 .box`.

Migration tip: keep a focused fixture around `extend` + nested/media selectors and diff CSS output before rollout.

### Variable resolution now follows source-order evaluation

Less 4.x had a few eager-resolution edge cases where a later mixin call could appear to retroactively change an earlier declaration in the same ruleset. Less 5.x does not preserve that behavior.

Declarations now resolve in source order against the scope that exists when the declaration is evaluated. A later mixin call can still leak variables into the current scope where Less semantics require it, but it does not rewrite an earlier declaration that has already been evaluated.

Example:

```less
@mix: blue;

.mixin() {
  @mix: #989;
}

.tiny-scope {
  color: @mix;
  .mixin();
}
```

Less 5.x compiles this to:

```css
.tiny-scope {
  color: blue;
}
```

This is a breaking change from older Less behavior, but it matches a more predictable evaluation model: later side effects do not retroactively change earlier sibling declarations.

### Values and math

Most values compile exactly as before. These are the changes you can see in the output. For comparisons and guards, see the evaluation table in [Migrating Less 4.x → 5.x](./less-v5-breaking-changes#evaluation-differences-comparison-truthiness-arguments).

**A slash between values is spaced.** A `/` that does not divide is written with a space on each side, like the other separators: `font: bold 12px/1.5 sans-serif` gives `font: bold 12px / 1.5 sans-serif`, and `16/9` gives `16 / 9`. The spaces mean nothing to CSS. See [Value & Separator Formatting](../advanced/value-formatting).

**Parentheses around a value that nothing computes are kept.** `c: (10vh)` stays `c: (10vh)`, and `var(--a, (10px))` keeps its parentheses; Less 4.x wrote `10vh` and `var(--a, 10px)`. Parentheses around math that computes still disappear: `(2px + 3px)` is `5px`.

**Two different units are kept as `calc()`.** A unitless number added to or subtracted from a dimension takes its unit, as in Less 4.x (`4 + 3px` is `7px`, `1.5 - 1rem` is `0.5rem`), whatever `unitMode` is set. Two units that do not convert are no longer guessed at:

| expression | Less 4.x | Less 5.x (default) |
| --- | --- | --- |
| `1px + 1em` | `2px` | `calc(1px + 1em)` |
| `100% - 10px` | `90%` | `calc(100% - 10px)` |
| `(1px * 2px)` | `2px` | `calc(1px * 2px)` |
| `@x * 2` with `@x: 1px + 1em` | `4px` | `calc((1px + 1em) * 2)` |

Each kept operation reports an `eval/unexpressible-unit` warning. `unitMode: 'strict'` makes it an error, and `unitMode: 'loose'` gives the Less 4.x answer. See [Unit Mode](./less-options#unit-mode).

**Math functions keep math they cannot compute.** `min(100% - 30px)` stays `min(100% - 30px)` (Less 4.x wrote `70%`), with the same warning. In `min()` and `max()`, a unitless argument compares as if it had the other arguments' unit and takes that unit when it wins: `max(4, 3px)` is `4px` (Less 4.x wrote `4`). Arguments in two different units cannot be compared, so the call is written out as you wrote it: `min(6em, 5, 4ex)` stays as written, where Less 4.x reduced it to `min(5, 4ex)`.

**A built-in call that fails is written out as-is.** A Less built-in called with more arguments than it takes, or with arguments it cannot compute, is written out instead of guessing: `percentage(0.5, 1)` stays as written (Less 4.x dropped the extra argument and wrote `50%`), and `sqrt(-4)` stays as written (Less 4.x stopped with an error). Set `functionMode: 'error'` to make every failed call an error.

**`round()` rounds a tie away from zero, as in Less 4.x** (`round(2.5)` is `3`, `round(-2.5)` is `-3`). With a number of decimal places, a value that is written exactly halfway also rounds away from zero: `round(1.005, 2)` is `1.01`, where Less 4.x wrote `1`.

**An escaped string is never read back as a number, color or keyword.** `~"…"` and `e()` produce text, and stay text wherever they are used:

```less
@x: 0.5;
.a {
  b: percentage(@x);        // 50%
  c: percentage(~"@{x}");   // percentage(0.5): written out, not computed
}
```

Less 4.x stopped with an error on `percentage(~"@{x}")`. To compute with a value, pass the value itself (`percentage(@x)`). A guard follows the same rule: `when (~"true")` no longer matches.

### Custom properties

A custom property's value is CSS text, and CSS has no `//` comment, so `//` inside one is part of the value:

```less
.a {
  --x: // note
    red;
}
```

Less 5.x writes `--x: // note red;`; Less 4.x removed the `// note`. The same holds in a `var()` fallback. Because the text after `//` is value text, a quote in it opens a string, and a string cannot run past the end of the line, so this is a parse error:

```less
.a {
  --x: // don't
    red;
}
```

Use `/* … */` for a comment in a custom property.

Block comments in a custom property's value are kept (`--y: /* c */ blue` is written as is; Less 4.x dropped the comment), and the whitespace around the value is trimmed.

### Escaped `url()` bodies are left as written

An escaped string inside `url()` — `url(~"img/b.png")`, or a variable holding one — is text you wrote exactly, so `rootpath`, `rewriteUrls` and `urlArgs` all leave it alone:

| `url(~"b.png")` with | Less 4.x | Less 5.x |
| --- | --- | --- |
| `rootpath: 'r/'` | `url(r/b.png)` | `url(b.png)` |
| `urlArgs: 'v=1'` | `url(b.png?v=1)` | `url(b.png)` |

Rewriting the body could write a broken URL: for `url(~"'b.png'")`, Less 4.x wrote `url(r/'b.png')`. Use a quoted string (`url("b.png")`, or `url("@{base}/b.png")`) when you want the options to apply.

### Selectors

- **Slashed combinators are invalid selectors.** `/deep/`, `/shadow/` and any other `/word/` between selectors are not CSS, and `.a /deep/ .b { … }` is a parse error. Less 4.x passed them through. A `/word/` inside a declaration value (`src: local(Foo/Bar/Baz)`) is unaffected.
- **Attribute selectors keep their spelling.** `a[href="y"i]` stays tight; Less 4.x inserted a space before the flag.

### Imports

Each sheet is still imported once, with these differences from Less 4.x:

- `@import (reference) "t.less"; @import "t.less";` renders the sheet. You asked to see it; Less 4.x dropped the second import and rendered nothing.
- `@import (multiple) "t.less"; @import "t.less";` renders the sheet twice. A `(multiple)` import does not count toward import-once; Less 4.x rendered it once.
- A root `@import "t.less"` after a copy imported inside another block (`@media print { @import "t.less"; }` or `.wrap { @import "t.less"; }`) still renders the sheet at the root: only an earlier import in the same scope counts. Less 4.x skipped the root import.

### Safer JavaScript execution model

One surprising behavior for some teams is that legacy Less workflows could execute JavaScript (including via `.js` imports). That became a real security concern in setups where front-end input was passed directly into a Less compiler.

In 5.x, executable JavaScript has a stronger opt-in model: local/package JS and legacy file-based `@plugin` execution require `@jesscss/plugin-js` and run on Deno, which is secure by default. JSON imports are data-only and do not need that runtime. Deno-backed scripts cannot read outside the configured script sandbox root, cannot access Node `process` or environment variables by default, and cannot use the network unless plugin-js policy explicitly allows it.

The sandbox root is the directory of the `styles.config.*` above the entry file, or the entry file's own directory when there is none (the current working directory for a source with no file path), so a `@plugin` script outside your project is refused. Set `compile.jsReadRoot` in a `styles.config.*` to an absolute path to choose another root. See [Pre-Loaded Plugins](./plugins#less-5x-script-runtime-policy).

To turn off executable scripts entirely, use `disableScriptModules`. This also
disables file-based `@plugin`. The old `disablePluginRule` option is still
recognized for Less compatibility, but it is deprecated and maps to the same
runtime switch.

A file-based `@plugin` script may `require()` its own sibling CommonJS files
(`./file`, `../file`) inside that sandbox root; Node built-ins and npm packages
are not available to it. Plugins that register functions keep working, but the
Less 4 plugin-manager hooks do not: a plugin that adds a visitor, pre-processor,
post-processor, or file manager is refused with a `plugin/unsupported-feature`
error naming the replacement
(`compress` for minifier plugins such as `less-plugin-clean-css`,
`@jesscss/plugin-node-modules` for `less-plugin-npm-import`, and running other
post-processors on the compiled CSS). See [Plugins](../features/plugins).

Example migration path:

```less
// 4.x-era pattern (legacy):
@columns: `Math.max(12, 8) `;
```

Prefer explicit Less expressions/functions where possible:

```less
@columns: max(12, 8);
```

If your project still requires JS evaluation, move that usage behind the optional plugin/runtime policy path and validate behavior in CI before enabling broadly.

### Remote imports are opt-in

Less 4.x downloaded any `@import "https://…"` while compiling. In 5.x nothing is downloaded by default: a URL import stays in the output as a plain CSS `@import`, and one that can never be plain CSS — `(reference)`, `(less)` or `(inline)` — is an error. If you import Less from a CDN, list its host with `@jesscss/plugin-remote-import` — see [Remote Imports](./less-options.md#remote-imports).

### Moving sources to `.jess`

If you convert Less files to `.jess`, note that `.jess` math is strict about units by default: `$(1px + 3em)`, `$(1px * 2px)` and `$(1 / 2px)` are `eval/invalid-unit-arithmetic` errors, where `.less` keeps them as `calc()` with a warning. A unitless number still takes the other operand's unit (`$(1 + 2px)` is `3px`). Write `calc(1px + 3em)` when the browser should resolve it, or set `unitMode: 'preserve'`.

## Deprecations and removals to plan for

These are the migration-impact items that frequently break older workflows:

### Inline JavaScript removed

- Inline backtick JavaScript is removed entirely.
- It reports a fatal unsupported-syntax diagnostic; `javascriptEnabled` does not
  opt it back in.
- Existing code that relies on backtick JS must move to a plain Less expression
  or a JavaScript module loaded with `@use` and called through its namespace.

Example:

```less
// legacy
@assetVersion: ` "2026-03" `;

// preferred
@assetVersion: "2026-03";
```

For reusable JavaScript logic, export a function from a module and call it
through the explicit module binding:

```less
@use "./asset.js";

.build {
  version: @asset.version();
}
```

### Math mode changes

- Legacy `strictMath` workflows should move to the `math` option. `strictMath` is still accepted: `true` means `math: 'parens'`, and setting it reports a deprecation warning.
- `strict-legacy` was removed in Less 4.0; it is still accepted and means `parens`.
- `math: 'always'` (Less 3.x's eager math) still works; `parens-division` is the default.
- The `./` division operator is removed: `2px ./ 2` is a parse error. Write `(2px / 2)`.

Example:

```bash
# old
lessc --math=always styles.less styles.css

# preferred
lessc --math=parens-division styles.less styles.css
```

### Legacy mixin call syntax

Both of these still compile as they did in Less 4.x, but are deprecated:

- Calling mixins without parentheses.
- Whitespace between a mixin name and call parentheses.

Example:

```less
// old
.rounded;
.rounded ();

// preferred
.rounded();
```

### Deprecated CLI/option paths

- `relativeUrls` / `--relative-urls` is not read by Less 5.x, so nothing is rewritten. Set `rewriteUrls: 'all'` (`--rewrite-urls=all`) instead.
- `--ie-compat` is deprecated/no-op in modern pipelines.
- `dumpLineNumbers` / `--line-numbers` is deprecated and has no effect: no line-number comments or debug media queries are emitted, and setting it reports a `deprecation/dump-line-numbers-option` warning. Use source maps.
- `insecure` / `--insecure` has no effect and reports a deprecation warning: remote imports are https-only and always verify the certificate.
- Error and warning positions count lines from the file as you wrote it. Less 4.x counted the text that `banner` and `globalVars` add in front of it.
- Built-in `compress` is **not** deprecated in 5.x — it is a supported minifier and replaces `less-plugin-clean-css` (see [Compressed Output](../advanced/compressed-output)).
- `strictImports` is deprecated and should be avoided in new configurations.

Example:

```bash
# old
lessc --relative-urls --line-numbers=all src/styles.less dist/styles.css

# preferred
lessc --rewrite-urls=all --source-map src/styles.less dist/styles.css
```

### Browser-runtime option model changes in 5.x

In 4.x docs, Less.js documents a browser-runtime option block for in-page behavior (for example async/file loading, polling/cache behavior, and runtime browser diagnostics).

In the 5.x track, this legacy browser runtime option block should not be carried over as-is. Less no longer runs directly "in" the browser as a full compiler runtime; instead it uses an update-script model for browser environments.

Migration guidance:

- Do not carry over 4.x browser runtime option blocks into 5.x config.
- Move compilation behavior to Node/tooling configuration.
- Keep browser usage focused on update-script integration and fixture validation.

## Migration checklist

1. Upgrade on a feature branch and run your full Less compile + snapshot diff suite.
2. Resolve parser/runtime deprecation warnings first, then look at every `eval/unexpressible-unit` warning: each marks math Less 4.x guessed at and Less 5.x keeps as `calc()`.
3. Re-test nesting and `extend` output in selector-heavy code.
4. Verify plugin behavior, especially if JS execution was used previously.
5. Reconfirm source-map and minification outputs in CI.
6. Roll out gradually with a rollback-ready lockfile.

## Recommended follow-up docs

- [Browser Usage](./using-less-in-the-browser)
- [Less.js Options](./less-options)
- [Advanced Reference](./advanced-reference)
- [Tooling](./tooling)
