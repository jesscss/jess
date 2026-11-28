import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseScss } from '@jesscss/scss-parser';
import { jessFunctions } from '@jesscss/plugin-scss';
import { Compiler } from '../../src/index.js';

/**
 * Sass's `sass:meta` module, and the meta functions Sass also defines as
 * globals (`inspect`, `type-of`, `feature-exists`).
 *
 * Every expectation is Dart Sass 1.101.7's output (`sass --no-source-map`, the
 * `sass` devDependency), with the blank line Dart Sass writes between top-level
 * rules dropped; every error is Dart Sass's message.
 */
const render = async (source: string, extension: '.scss' | '.jess' = '.scss'): Promise<string> =>
  new Compiler().renderString(source, { extension });

const cases: ReadonlyArray<readonly [string, string, string]> = [
  [
    'inspect: a quoted string keeps its quotes; null and the empty list have a spelling; maps and nested lists are parenthesized',
    '@use "sass:meta"; .a { v: meta.inspect("foo"); w: meta.inspect(null); x: meta.inspect(()); y: meta.inspect((a: 1, b: (2, 3))); z: meta.inspect((1, 2) (3, 4)); }',
    '.a {\n  v: "foo";\n  w: null;\n  x: ();\n  y: (a: 1, b: (2, 3));\n  z: (1, 2) (3, 4);\n}\n'
  ],
  [
    'inspect: bracketed lists, a one-item comma list, the global spelling',
    '@use "sass:meta"; .a { v: meta.inspect([1, 2] [3]); w: meta.inspect((1,)); x: meta.inspect([]); y: meta.inspect(1px solid #fff); z: inspect(\'a\' "b"); }',
    '.a {\n  v: [1, 2] [3];\n  w: (1,);\n  x: [];\n  y: 1px solid #fff;\n  z: "a" "b";\n}\n'
  ],
  [
    'inspect returns an unquoted string that holds the quotes',
    '@use "sass:meta"; @use "sass:string"; .a { v: meta.type-of(meta.inspect("foo")); w: string.length(meta.inspect("foo")); }',
    '.a {\n  v: string;\n  w: 5;\n}\n'
  ],
  [
    'type-of: a math function that does not reduce to a number is a calculation',
    '@use "sass:meta"; .a { v: meta.type-of(calc(var(--c))); w: meta.type-of(min(1px, 2em)); x: meta.type-of(calc(1px)); y: type-of(clamp(1%, 1px, 2px)); z: meta.type-of(foo(var(--c))); }',
    '.a {\n  v: calculation;\n  w: calculation;\n  x: number;\n  y: calculation;\n  z: string;\n}\n'
  ],
  [
    'calc-name and calc-args',
    '@use "sass:meta"; .a { v: meta.calc-name(clamp(1%, 2px, 3px)); w: meta.calc-args(clamp(1%, 2px, 3px)); x: meta.calc-args(calc(1px + var(--c))); y: meta.type-of(nth(meta.calc-args(min(max(1%, 1px), 2px)), 1)); z: meta.calc-name(CALC(var(--c))); }',
    '.a {\n  v: "clamp";\n  w: 1%, 2px, 3px;\n  x: 1px + var(--c);\n  y: calculation;\n  z: "calc";\n}\n'
  ],
  [
    'feature-exists, quoted or not, and the global spelling',
    '@use "sass:meta"; .a { v: meta.feature-exists(at-error); w: meta.feature-exists("custom-property"); x: feature-exists(nope); }',
    '.a {\n  v: true;\n  w: true;\n  x: false;\n}\n'
  ],
  [
    'a namespace given with `as`, and named arguments',
    '@use "sass:meta" as m; .a { v: m.type-of(1px); w: m.inspect($value: "x"); x: m.calc-name($calc: calc(var(--c))); }',
    '.a {\n  v: number;\n  w: "x";\n  x: "calc";\n}\n'
  ],
  [
    'inspect: a list in brackets stays one item; a comma list as a map key or value is parenthesized, one item or more',
    '@use "sass:meta"; .a { v: meta.inspect([[1, 2]]); w: meta.inspect([[1]]); x: meta.inspect((a: (1,))); y: meta.inspect(((1,): 2)); z: meta.inspect([1, [2]]); }',
    '.a {\n  v: [[1, 2]];\n  w: [[1]];\n  x: (a: ((1,)));\n  y: (((1,)): 2);\n  z: [1, [2]];\n}\n'
  ],
  [
    'inspect: a quoted string takes Dart Sass\'s quote',
    '@use "sass:meta"; .a { v: meta.inspect(\'a\'); w: meta.inspect(\'a"b\'); x: meta.inspect("a\'b"); }',
    '.a {\n  v: "a";\n  w: \'a"b\';\n  x: "a\'b";\n}\n'
  ],
  [
    'calc-args: a calc() nested in a calculation is what it holds',
    '@use "sass:meta"; .a { v: meta.calc-args(clamp(1px, 2em + 1px, 3em)); w: meta.calc-args(clamp(1px, calc(var(--c)), 3em)); x: meta.type-of(nth(meta.calc-args(clamp(1px, calc(2em + 1px), 3em)), 2)); y: meta.type-of(nth(meta.calc-args(min(calc(max(1%, 1px)), 2px)), 1)); }',
    '.a {\n  v: 1px, 2em + 1px, 3em;\n  w: 1px, (var(--c)), 3em;\n  x: string;\n  y: calculation;\n}\n'
  ]
];

describe('scss: `sass:meta`', () => {
  it.each(cases)('%s', async (_name, source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });

  const errors = [
    ['a value that is not a calculation', '.a { v: meta.calc-name(1); }', '$calc: 1 is not a calculation.'],
    ['a list that is not a calculation', '.a { v: meta.calc-args(1px 2px); }', '$calc: (1px 2px) is not a calculation.'],
    ['a missing argument', '.a { v: meta.calc-args(); }', 'Missing argument $calc.'],
    ['an extra argument', '.a { v: meta.type-of(1, 2); }', 'Only 1 argument allowed, but 2 were passed.'],
    ['a feature that is not a string', '.a { v: meta.feature-exists(1px 2px); }', '$feature: (1px 2px) is not a string.']
  ] as const;

  it.each(errors)('fails the compile for %s, with Dart Sass\'s message', async (_name, source, message) => {
    await expect(render(`@use "sass:meta"; ${source}`)).rejects.toMatchObject({ reason: expect.stringContaining(message) });
  });

  /*
   * A global call that cannot compute is written out as authored by default, and
   * fails the compile with Dart Sass's message under `functionMode: 'error'`
   * (ruling J1 makes only a namespaced call fail under every mode).
   */
  it('writes a global call that cannot compute as authored, and fails it under functionMode: error', async () => {
    const source = '.a { v: inspect(); w: type-of(1, 2); }';
    await expect(render(source)).resolves.toBe('.a {\n  v: inspect();\n  w: type-of(1, 2);\n}\n');
    await expect(new Compiler({ compile: { functionMode: 'error' } }).renderString(source, { extension: '.scss' }))
      .rejects.toMatchObject({ reason: expect.stringContaining('Missing argument $value.') });
  });
});

/**
 * `.scss → .jess → .css` is `.scss → .css`, for the cases `.jess` can spell.
 * The others stop at `.jess` syntax gaps the converter reports, none of them
 * about `sass:meta`: keyword arguments, math outside `$( … )`, a map after
 * another value, and a CSS `min()` of incompatible units lowered to Sass's
 * `$min`.
 */
const jessGaps = new Set([0, 3, 4, 6, 9].map(index => cases[index]![0]));

describe('scss → jess: `sass:meta`', () => {
  const functions = jessFunctions();

  it.each(cases.filter(([name]) => !jessGaps.has(name)))('%s', async (_name, source) => {
    const jess = emitJess(parseScss(source), { functions });
    await expect(render(jess, '.jess')).resolves.toBe(await render(source));
  });
});
