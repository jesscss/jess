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

Important default: Less 5.x keeps nested structure by default (`collapseNesting: false`), so output stays in the familiar Less style unless you explicitly enable collapsing.

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
.card .title {
  font-weight: 600;
}
@media (min-width: 48rem) {
  .card {
    padding: 1.25rem;
  }
}
```

If you enable `collapseNesting: true`, nesting may be flattened/collapsed more aggressively for deduplication and parity behaviors.

### Less-style parent suffix selectors (`&-1`)

Less 5.x also supports Less-style parent suffix composition such as `&-1`. This is a Less feature (not native CSS nesting syntax), and it remains useful for utility/variant naming.

Example:

```less
.col {
  &-1 { width: 8.333%; }
  &-2 { width: 16.666%; }
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

### Extend behavior and optional `:is(...)` collapse

`extend` behavior in 5.x is validated against fixture parity, including nested/media-scoped selectors and `all` matching.

Default migration path: with `collapseNesting: false`, most projects keep familiar Less-style selector expansion.

Optional optimization path: if you explicitly enable `collapseNesting: true`, `extend ... all` in nested selector-list cases may emit `:is(...)` selectors to reduce duplication.

Syntax note: per-selector `all` in multi-target extends is deprecated in favor of a single `!all` flag on the extend call to reduce ambiguity.

```less
// Deprecated:
&:extend(.a all, .b all);

// Preferred:
&:extend(.a, .b !all);
```

Example (mirrors core fixture patterns):

```less
.sidebar {
  .box { margin: 10px 0; }
}

.sidebar2 {
  &:extend(.sidebar all);
}

.type1 {
  .sidebar3 {
    &:extend(.sidebar all);
  }
}
```

One possible collapsed output shape (`collapseNesting: true`):

```css
:is(.sidebar, .sidebar2, .type1 .sidebar3) .box {
  margin: 10px 0;
}
```

Migration tip: keep a focused fixture around `extend` + nested/media selectors and diff CSS output before rollout.

### Safer JavaScript execution model

One surprising behavior for some teams is that legacy Less workflows could execute JavaScript (including via `.js` imports). That became a real security concern in setups where front-end input was passed directly into a Less compiler.

In 5.x, JavaScript execution has a stronger opt-in model: it is not enabled by default, requires explicit plugin installation (`@jesscss/plugin-js`), and runs on Deno, which is secure by default.

Example migration path:

```less
// 4.x-era pattern (legacy):
@columns: `Math.max(12, 8)`;
```

Prefer explicit Less expressions/functions where possible:

```less
@columns: max(12, 8);
```

If your project still requires JS evaluation, move that usage behind the optional plugin/runtime policy path and validate behavior in CI before enabling broadly.

## Deprecations and removals to plan for

These are the migration-impact items that frequently break older workflows:

### Inline JavaScript defaults

- Inline JavaScript is disabled by default.
- Existing code that relies on backtick JS must explicitly opt in where supported.

Example:

```less
// legacy
@assetVersion: `"2026-03"`;

// preferred
@assetVersion: "2026-03";
```

### Math mode changes

- Legacy `strictMath` workflows should move to `math` options.
- `strict-legacy` math mode is removed.
- `math=always` is deprecated and should be treated as legacy behavior.

Example:

```bash
# old
lessc --math=always styles.less styles.css

# preferred
lessc --math=parens-division styles.less styles.css
```

### Legacy mixin call syntax

- Calling mixins without parentheses is deprecated.
- Whitespace between a mixin name and call parentheses is deprecated.

Example:

```less
// old
.rounded;
.rounded ();

// preferred
.rounded();
```

### Deprecated CLI/option paths

- `--relative-urls` -> migrate to `--rewrite-urls=all` or explicit `rewriteUrls`.
- `--ie-compat` is deprecated/no-op in modern pipelines.
- Built-in `compress` is deprecated; use dedicated CSS minification.
- `dumpLineNumbers` / `--line-numbers` is deprecated; use sourcemaps.
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
2. Resolve parser/runtime deprecation warnings first.
3. Re-test nesting and `extend` output in selector-heavy code.
4. Verify plugin behavior, especially if JS execution was used previously.
5. Reconfirm source-map and minification outputs in CI.
6. Roll out gradually with a rollback-ready lockfile.

## Recommended follow-up docs

- [Browser Usage](./using-less-in-the-browser)
- [Less.js Options](./less-options)
- [Advanced Reference](./advanced-reference)
- [Tooling](./tooling)
