import { defineFunction, isValueGroupArray, makeKeyword } from '@jesscss/core/value';

/**
 * Sass `meta.type-of($value)` / the global `type-of()`.
 *
 * Verified against `spec/core_functions/meta/type_of.hrx`:
 *   type-of(1) / type-of(1.5px * 3.4em) → number
 *   type-of("c") / type-of(c)           → string   (quoted AND unquoted)
 *   type-of(red)                        → color
 *   type-of(true) / type-of(false)      → bool
 *   type-of(null)                       → null
 *   type-of(()) / type-of(1 2 3)        → list
 *
 * NOT REPRESENTABLE in the value domain yet, so deliberately unimplemented
 * rather than guessed (each is a missing VALUE KIND, not a missing branch here):
 *   map          — Sass maps are still legacy `Collection` nodes (`sass/map/*.ts`)
 *   arglist      — no rest-argument value kind
 *   function     — `meta.get-function` does not exist
 *   mixin        — `meta.get-mixin` does not exist
 *   calculation  — no unsimplified-calculation value kind; note that
 *                  `type-of(calc(1px))` is `number` (simplified), only
 *                  `calc(var(--c))` / `clamp(1%, 1px, 2px)` are `calculation`
 */
const typeOf = defineFunction('type-of', {
  params: [{ name: 'value', kinds: 'any' }] as const,
  body: (value) => {
    if (isValueGroupArray(value)) {
      return makeKeyword('list');
    }
    switch (value.type) {
      case 'Dimension': return makeKeyword('number');
      case 'Quoted':
      case 'Keyword': return makeKeyword('string');
      case 'Color': return makeKeyword('color');
      case 'Bool': return makeKeyword('bool');
      case 'Nil': return makeKeyword('null');
      case 'List':
      case 'Block': return makeKeyword('list');
    }
  }
});

export { typeOf };
export default typeOf;
