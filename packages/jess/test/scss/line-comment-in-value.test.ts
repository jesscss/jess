import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * Each expectation is what `sass --no-source-map` 1.101.7 writes for the source, once its
 * value is on one line: a value keeps the line break it was written with, and a comment
 * that stood before the break leaves it behind
 * (https://sass-lang.com/documentation/syntax/comments/). The first is Bootstrap 5.3.8's
 * `_utilities.scss`, cut to one utility.
 */
const cases: ReadonlyArray<readonly [string, string]> = [
  ['$m: (\n  // a\n  "b": (\n    "c": d\n  ),\n  // e\n);\n.a { x: map-get(map-get($m, "b"), "c"); }', 'x: d'],
  ['$m: (\n  "a": b,\n  // d\n); .a { x: map-get($m, "a"); }', 'x: b'],
  ['@function f($a, $b) { @return $b; } .a { x: f(a, // d\n b); }', 'x: b'],
  ['.a { x: foo(a, // d\n b); }', 'x: foo(a, b)'],
  ['.a { x: foo( // lead\n a, // mid\n b // tail\n); }', 'x: foo(a, b)'],
  ['$l: (1, // c\n 2); .a { x: $l; }', 'x: 1, 2'],
  ['.a { x: (1 + // c\n 2); }', 'x: 3'],
  ['.a { x: 1 + // c\n 2; }', 'x: 3'],
  ['.a { x: calc(1px + // c\n 2px); }', 'x: 3px'],
  ['.a { x: var(--x, // b\n red); }', 'x: var(--x, red)']
];

describe('a line comment in a value', () => {
  it.each(cases)('%s', async (source, declaration) => {
    const css = await new Compiler().renderString(source, { extension: '.scss' });
    expect(css.replace(/\s*\n\s*(?=[^}\s])/g, ' ')).toBe(`.a { ${declaration};\n}\n`);
  });
});
