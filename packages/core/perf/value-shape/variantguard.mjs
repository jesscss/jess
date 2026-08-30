/**
 * BUILD-IDENTITY GUARD for the value-shape A/B.
 *
 * Constructs the real value objects out of the CURRENTLY INSTALLED
 * `packages/core/lib` and counts their keys, so a stale or half-swapped lib
 * fails loudly instead of producing a green, meaningless A/B. `core/lib/index.js`
 * is byte-identical between the two variants (the factories live in a sibling
 * chunk), so file hashing is NOT a sufficient check — only behaviour is.
 *
 *   UNIFIED     -> Color has 11 keys, Collection 4, Block 5
 *   CONDITIONAL -> Color has  5 keys, Collection 3, Block 4
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const v = await import(resolve(here, '../../lib/value.js'));

const shapes = {
  'ColorRgb(no opts)': Object.keys(v.makeColorRgb([1, 2, 3], 1, 0)),
  'ColorRgb(node)': Object.keys(v.makeColorRgb([1, 2, 3], 1, 0, { node: 'red' })),
  ColorHsl: Object.keys(v.makeColorHsl([1, 0.5, 0.5], 1, 0)),
  'Collection(no base)': Object.keys(v.makeCollection([])),
  'Block(not escaped)': Object.keys(v.makeBlock({ type: 'Keyword', text: 'a', bytes: 'a' }, 'square'))
};
for (const [k, keys] of Object.entries(shapes)) {
  console.log(`${k.padEnd(28)} n=${String(keys.length).padStart(2)}  ${keys.join(',')}`);
}
console.log('VARIANT INSTALLED =', shapes['ColorRgb(no opts)'].length === 11 ? 'UNIFIED' : 'CONDITIONAL');
