import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * Each expectation is what `sass --no-source-map` 1.101.7 writes for the source. The
 * spelling is Bootstrap 5.3.8's `helpers/_color-bg.scss`: `if()` picks the marker, which
 * then prints as text after the value (https://sass-lang.com/documentation/modules/meta/#if).
 */
const cases: ReadonlyArray<readonly [string, string]> = [
  ['$e: true; .a { color: red if($e, !important, null); }', '.a {\n  color: red !important;\n}\n'],
  ['$e: false; .a { color: red if($e, !important, null); }', '.a {\n  color: red;\n}\n'],
  ['$i: if(true, !important, null); .a { color: red $i; }', '.a {\n  color: red !important;\n}\n'],
  ['@function f($x) { @return $x; } .a { color: red f(!important); }', '.a {\n  color: red !important;\n}\n'],
  ['.a { color: foo(! important); }', '.a {\n  color: foo(!important);\n}\n']
];

describe('`!important` as a call argument', () => {
  it.each(cases)('%s', async (source, css) => {
    expect(await new Compiler().renderString(source, { extension: '.scss' })).toBe(css);
  });
});
