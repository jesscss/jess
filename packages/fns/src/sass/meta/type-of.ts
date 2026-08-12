import { defineFunction, isValueGroupArray, makeKeyword, namedColor } from '@jesscss/core';

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
 *   type-of((a: 1))                     → map
 *
 * `()` stays `list`: Sass reads the empty list as an empty map, but its type is
 * still `list`, and only a `Collection` carries the map type.
 *
 * NOT REPRESENTABLE in the value domain yet, so deliberately unimplemented
 * rather than guessed (each is a missing VALUE KIND, not a missing branch here):
 *   arglist      — no rest-argument value kind
 *   function     — `meta.get-function` does not exist
 *   mixin        — `meta.get-mixin` does not exist
 *   calculation  — no unsimplified-calculation value kind; note that
 *                  `type-of(calc(1px))` is `number` (simplified), only
 *                  `calc(var(--c))` / `clamp(1%, 1px, 2px)` are `calculation`
 */
const typeOf = defineFunction('type-of', {
  params: [{ name: 'value', type: 'any' }] as const,
  body: (value) => {
    if (isValueGroupArray(value)) {
      return makeKeyword('list');
    }
    switch (value.type) {
      case 'Dimension': return makeKeyword('number');

      /*
       * A keyword that names a CSS color is a color (`type-of(red)` → `color`,
       * per `spec/core_functions/meta/type_of.hrx`). NamedColor→Keyword
       * convergence keeps `red` a keyword at parse; its colour-ness is consulted
       * here, at the point of use.
       */
      case 'Keyword': return makeKeyword(namedColor(value.text) !== undefined ? 'color' : 'string');
      case 'Quoted':
      case 'Any': return makeKeyword('string');
      case 'Color': return makeKeyword('color');
      case 'Bool': return makeKeyword('bool');
      case 'Null': return makeKeyword('null');
      case 'Collection': return makeKeyword('map');
      case 'List':
      case 'Block': return makeKeyword('list');
    }
  }
});

export { typeOf };
export default typeOf;
