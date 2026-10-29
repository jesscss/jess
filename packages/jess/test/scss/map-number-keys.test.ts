import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseScss } from '@jesscss/scss-parser';
import { Compiler } from '../../src/index.js';

/**
 * `.scss` map functions match a key by value (ledger P14): a number by its value
 * and unit, a colour by its colour, a quoted string as the same unquoted word.
 * Every expectation is Dart Sass 1.101.7's output except where a case says
 * otherwise. A missing key reads `null`, so its declaration is dropped.
 */
const render = async (source: string, extension = '.scss'): Promise<string> =>
  new Compiler().renderString(source, { extension });

const MAP = '@use "sass:map";\n';

const cases: ReadonlyArray<readonly [name: string, source: string, expected: string]> = [
  ['map.get, a number key', `${MAP}$m: (1px: a); x { y: map.get($m, 1px); }`, 'x {\n  y: a;\n}\n'],
  ['map-get, a number key', '$m: (1px: a); x { y: map-get($m, 1px); }', 'x {\n  y: a;\n}\n'],
  ['map.get, the second of two number keys', `${MAP}$m: (1px: a, 2px: b); x { y: map.get($m, 2px); }`, 'x {\n  y: b;\n}\n'],
  ['map.get, unitless keys 0 and 1, read as 0 and 1.0', `${MAP}$m: (0: zero, 1: one); x { y: map.get($m, 0); z: map.get($m, 1.0); }`, 'x {\n  y: zero;\n  z: one;\n}\n'],
  ['map.get, a unitless number does not match a px key', `${MAP}$m: (1px: a); x { y: map.get($m, 1); z: b; }`, 'x {\n  z: b;\n}\n'],
  ['map.get, a number in a compatible unit', `${MAP}$m: (1in: a); x { y: map.get($m, 96px); }`, 'x {\n  y: a;\n}\n'],
  ['map.get, a computed number key', `${MAP}$m: (1px: a); x { y: map.get($m, 1px + 0); }`, 'x {\n  y: a;\n}\n'],
  ['map.get, a variable holding a number key', `${MAP}$m: (10px: a); $k: 5px * 2; x { y: map.get($m, $k); }`, 'x {\n  y: a;\n}\n'],
  ['map.get, an @each variable over number keys', `${MAP}$m: (1px: a, 2px: b); @each $k in 1px 2px { .x { v: map.get($m, $k); } }`, '.x {\n  v: a;\n}\n.x {\n  v: b;\n}\n'],
  ['map.get, a local variable holding a word key', `${MAP}$m: (a: 1, k: 2); .x { $k: a; v: map.get($m, $k); }`, '.x {\n  v: 1;\n}\n'],
  ['map.get, colour keys', `${MAP}$m: (#fff: white); x { y: map.get($m, #ffffff); z: map.get($m, white); }`, 'x {\n  y: white;\n  z: white;\n}\n'],
  ['map.get, a named colour key read as hex', `${MAP}$m: (red: r); x { y: map.get($m, #f00); z: map.get($m, red); }`, 'x {\n  y: r;\n  z: r;\n}\n'],
  ['map.get, quoted and unquoted string keys', `${MAP}$m: ("a": 1, b: 2); x { y: map.get($m, a); z: map.get($m, "b"); }`, 'x {\n  y: 1;\n  z: 2;\n}\n'],
  [
    'map.has-key, number and colour keys',
    `${MAP}$m: (1px: a, #fff: w); x { a: map.has-key($m, 1px); b: map.has-key($m, 2px); c: map.has-key($m, 1); d: map.has-key($m, #FFF); }`,
    'x {\n  a: true;\n  b: false;\n  c: false;\n  d: true;\n}\n'
  ],
  ['map.merge, the same number key replaces', `${MAP}$m: map.merge((1px: a), (1px: b)); x { y: map.get($m, 1px); z: length($m); }`, 'x {\n  y: b;\n  z: 1;\n}\n'],
  ['map.merge, two number keys', `${MAP}$m: map.merge((1px: a), (2px: b)); x { y: map.get($m, 2px); z: map.get($m, 1px); }`, 'x {\n  y: b;\n  z: a;\n}\n'],
  ['map.set and map.get, a number key', `${MAP}$m: map.set((1px: a), 1px, b); x { y: map.get($m, 1px); }`, 'x {\n  y: b;\n}\n'],
  ['map.remove, a number key', `${MAP}$m: map.remove((1px: a, 2px: b), 1px); x { y: map.has-key($m, 1px); z: map.get($m, 2px); }`, 'x {\n  y: false;\n  z: b;\n}\n'],

  /* Ledger V37: units compare case-insensitively. Dart Sass compares them case-sensitively and reads null. */
  ['map.get, a key unit in another case', `${MAP}$m: (1PX: a); x { y: map.get($m, 1px); }`, 'x {\n  y: a;\n}\n']
];

describe('scss: map functions match non-string keys by value', () => {
  it.each(cases)('%s', async (_name, source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });

  it('converts map.get with a number key to .jess and renders the same CSS', async () => {
    const scss = `${MAP}$m: (1px: a); x { y: map.get($m, 1px); }`;
    const jess = emitJess(parseScss(scss));
    expect(jess).toContain('y: $map.get($m, 1px);');
    await expect(render(jess, '.jess')).resolves.toBe('x {\n  y: a;\n}\n');
  });
});
