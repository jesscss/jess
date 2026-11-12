# @jesscss/patch-css

**Sets a Jess stylesheet's exposed variables on the page.**

A `.less` or `.jess` stylesheet that exposes variables (`@expose brand;`)
compiles to CSS that reads each one as `var(--brand, …)`. Its JavaScript module
exports `vars(values)` and `set(values, target?)`. When nothing in the
stylesheet is computed from an exposed variable, those two come from this
package and nothing else is bundled. `@jesscss/fns/runtime` builds on this
package for stylesheets that recompute values in the browser.

```js
import { set } from './theme.less';

set({ brand: '#08f' }); // document.documentElement.style: --brand: #08f
```

- `exposedVars(spec, values, hold?)` maps each JavaScript key to its `--name`,
  holding what `hold` makes of the value. It throws for an unknown key.
  - No `hold`: the value as given, for exports no CSS form reads.
  - `checkUnit`: throws for a value not in the unit a CSS form reads it in.
  - `holdRatio`: `checkUnit`, then a percentage export's ratio, so `50%` becomes
    `0.5`. `ratioOf` is that division, shared with the compile.

  The compiled module passes the least `hold` its exports need, so a page
  bundles only that.
- `writeVars(vars, target?)` writes on the target's inline style, the document
  root by default. It writes only a value the style does not already hold.
  The measurements behind this choice are in `docs/perf/BENCHMARKS.md` §10.

## Status

Alpha. The API above replaces `updateSheet(text, id)` and its `localStorage`
sheet cache.

## License

[MIT](https://github.com/jesscss/jess/blob/dev/LICENSE)
