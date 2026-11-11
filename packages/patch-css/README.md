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

- `exposedVars(spec, values)` maps each JavaScript key to its `--name` and
  checks every value a CSS form reads, which must be in the form's unit. A `%`
  value is held as its ratio, so `50%` becomes `0.5`. It throws for an unknown
  key or a value in the wrong unit.
- `writeVars(vars, target?)` writes on the target's inline style, the document
  root by default. It writes only a value the style does not already hold.
  The measurements behind this choice are in `docs/perf/BENCHMARKS.md` §10.

## Status

Alpha. The API above replaces `updateSheet(text, id)` and its `localStorage`
sheet cache.

## License

[MIT](https://github.com/jesscss/jess/blob/dev/LICENSE)
