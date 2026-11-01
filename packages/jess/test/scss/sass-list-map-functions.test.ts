import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { jessFunctions } from '@jesscss/plugin-scss';
import { parse as parseScss } from '@jesscss/scss-parser';
import { Compiler } from '../../src/index.js';

/*
 * Sass's list, map and type functions on every list spelling (owner
 * 2026-10-23: *"my point is that Sass functions should still work"*). Sass's
 * empty `()` and the lists Dart Sass writes without their parens parse to the
 * curly list (`.jess` `{ … }`), and `(a: 1)` to a map (`.jess` `#{ … }`):
 * each function returns what Dart Sass returns. Each expected cell is Dart Sass
 * 1.101.7's (`sass --no-source-map`): the declaration's value (`''` when Dart
 * Sass drops it, `ERROR` when it stops the compile) and the result's
 * `type-of()`. Jess runs with `functionMode: 'error'`, where a function that
 * cannot compute stops the compile as Dart Sass's does.
 */
const INPUTS = ['()', '(1, 2)', '(1 2)', '(1,)', '[1, 2]', '[]', '(a: 1)', '((1, 2), (3, 4))'] as const;
const CALLS = new Map<string, (x: string) => string>([
  ['list.append', x => `list.append(${x}, 9)`],
  ['append', x => `append(${x}, 9)`],
  ['list.index', x => `list.index(${x}, 1)`],
  ['index', x => `index(${x}, 1)`],
  ['list.is-bracketed', x => `list.is-bracketed(${x})`],
  ['is-bracketed', x => `is-bracketed(${x})`],
  ['list.join', x => `list.join(${x}, (8, 9))`],
  ['join', x => `join(${x}, (8, 9))`],
  ['list.join (second)', x => `list.join([8], ${x})`],
  ['list.length', x => `list.length(${x})`],
  ['length', x => `length(${x})`],
  ['list.separator', x => `list.separator(${x})`],
  ['list-separator', x => `list-separator(${x})`],
  ['list.nth', x => `list.nth(${x}, 1)`],
  ['nth', x => `nth(${x}, -1)`],
  ['list.set-nth', x => `list.set-nth(${x}, 1, 9)`],
  ['set-nth', x => `set-nth(${x}, -1, 9)`],
  ['list.slash', x => `list.slash(${x}, 9)`],
  ['list.zip', x => `list.zip(${x}, (8, 9))`],
  ['zip', x => `zip(${x}, 8 9)`],
  ['map.get', x => `map.get(${x}, a)`],
  ['map-get', x => `map-get(${x}, a)`],
  ['map.has-key', x => `map.has-key(${x}, a)`],
  ['map-has-key', x => `map-has-key(${x}, a)`],
  ['map.keys', x => `map.keys(${x})`],
  ['map-keys', x => `map-keys(${x})`],
  ['map.values', x => `map.values(${x})`],
  ['map-values', x => `map-values(${x})`],
  ['map.merge', x => `map.merge(${x}, (z: 9))`],
  ['map-merge', x => `map-merge(${x}, (z: 9))`],
  ['map.remove', x => `map.remove(${x}, a)`],
  ['map-remove', x => `map-remove(${x}, a)`],
  ['map.set', x => `map.set(${x}, a, 9)`],
  ['map.deep-merge', x => `map.deep-merge(${x}, (z: 9))`],
  ['map.deep-remove', x => `map.deep-remove(${x}, a)`],
  ['inspect', x => `inspect(${x})`],
  ['type-of', x => `type-of(${x})`]
]);

/** Per function, per input (in `INPUTS` order): Dart Sass's [value, type-of]. */
const DART_SASS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> = [
  ['list.append', [['9', 'list'], ['1, 2, 9', 'list'], ['1 2 9', 'list'], ['1, 9', 'list'], ['[1, 2, 9]', 'list'], ['[9]', 'list'], ['a 1, 9', 'list'], ['1, 2, 3, 4, 9', 'list']]],
  ['append', [['9', 'list'], ['1, 2, 9', 'list'], ['1 2 9', 'list'], ['1, 9', 'list'], ['[1, 2, 9]', 'list'], ['[9]', 'list'], ['a 1, 9', 'list'], ['1, 2, 3, 4, 9', 'list']]],
  ['list.index', [['', 'null'], ['1', 'number'], ['1', 'number'], ['1', 'number'], ['1', 'number'], ['', 'null'], ['', 'null'], ['', 'null']]],
  ['index', [['', 'null'], ['1', 'number'], ['1', 'number'], ['1', 'number'], ['1', 'number'], ['', 'null'], ['', 'null'], ['', 'null']]],
  ['list.is-bracketed', [['false', 'bool'], ['false', 'bool'], ['false', 'bool'], ['false', 'bool'], ['true', 'bool'], ['true', 'bool'], ['false', 'bool'], ['false', 'bool']]],
  ['is-bracketed', [['false', 'bool'], ['false', 'bool'], ['false', 'bool'], ['false', 'bool'], ['true', 'bool'], ['true', 'bool'], ['false', 'bool'], ['false', 'bool']]],
  ['list.join', [['8, 9', 'list'], ['1, 2, 8, 9', 'list'], ['1 2 8 9', 'list'], ['1, 8, 9', 'list'], ['[1, 2, 8, 9]', 'list'], ['[8, 9]', 'list'], ['a 1, 8, 9', 'list'], ['1, 2, 3, 4, 8, 9', 'list']]],
  ['join', [['8, 9', 'list'], ['1, 2, 8, 9', 'list'], ['1 2 8 9', 'list'], ['1, 8, 9', 'list'], ['[1, 2, 8, 9]', 'list'], ['[8, 9]', 'list'], ['a 1, 8, 9', 'list'], ['1, 2, 3, 4, 8, 9', 'list']]],
  ['list.join (second)', [['[8]', 'list'], ['[8, 1, 2]', 'list'], ['[8 1 2]', 'list'], ['[8, 1]', 'list'], ['[8, 1, 2]', 'list'], ['[8]', 'list'], ['[8, a 1]', 'list'], ['[8, 1, 2, 3, 4]', 'list']]],
  ['list.length', [['0', 'number'], ['2', 'number'], ['2', 'number'], ['1', 'number'], ['2', 'number'], ['0', 'number'], ['1', 'number'], ['2', 'number']]],
  ['length', [['0', 'number'], ['2', 'number'], ['2', 'number'], ['1', 'number'], ['2', 'number'], ['0', 'number'], ['1', 'number'], ['2', 'number']]],
  ['list.separator', [['space', 'string'], ['comma', 'string'], ['space', 'string'], ['comma', 'string'], ['comma', 'string'], ['space', 'string'], ['comma', 'string'], ['comma', 'string']]],
  ['list-separator', [['space', 'string'], ['comma', 'string'], ['space', 'string'], ['comma', 'string'], ['comma', 'string'], ['space', 'string'], ['comma', 'string'], ['comma', 'string']]],
  ['list.nth', [['ERROR', 'ERROR'], ['1', 'number'], ['1', 'number'], ['1', 'number'], ['1', 'number'], ['ERROR', 'ERROR'], ['a 1', 'list'], ['1, 2', 'list']]],
  ['nth', [['ERROR', 'ERROR'], ['2', 'number'], ['2', 'number'], ['1', 'number'], ['2', 'number'], ['ERROR', 'ERROR'], ['a 1', 'list'], ['3, 4', 'list']]],
  ['list.set-nth', [['ERROR', 'ERROR'], ['9, 2', 'list'], ['9 2', 'list'], ['9', 'list'], ['[9, 2]', 'list'], ['ERROR', 'ERROR'], ['9', 'list'], ['9, 3, 4', 'list']]],
  ['set-nth', [['ERROR', 'ERROR'], ['1, 9', 'list'], ['1 9', 'list'], ['9', 'list'], ['[1, 9]', 'list'], ['ERROR', 'ERROR'], ['9', 'list'], ['1, 2, 9', 'list']]],
  ['list.slash', [['9', 'list'], ['1, 2 / 9', 'list'], ['1 2 / 9', 'list'], ['1 / 9', 'list'], ['[1, 2] / 9', 'list'], ['[] / 9', 'list'], ['ERROR', 'list'], ['1, 2, 3, 4 / 9', 'list']]],
  ['list.zip', [['ERROR', 'list'], ['1 8, 2 9', 'list'], ['1 8, 2 9', 'list'], ['1 8', 'list'], ['1 8, 2 9', 'list'], ['ERROR', 'list'], ['a 1 8', 'list'], ['1, 2 8, 3, 4 9', 'list']]],
  ['zip', [['ERROR', 'list'], ['1 8, 2 9', 'list'], ['1 8, 2 9', 'list'], ['1 8', 'list'], ['1 8, 2 9', 'list'], ['ERROR', 'list'], ['a 1 8', 'list'], ['1, 2 8, 3, 4 9', 'list']]],
  ['map.get', [['', 'null'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['', 'null'], ['1', 'number'], ['ERROR', 'ERROR']]],
  ['map-get', [['', 'null'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['', 'null'], ['1', 'number'], ['ERROR', 'ERROR']]],
  ['map.has-key', [['false', 'bool'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['false', 'bool'], ['true', 'bool'], ['ERROR', 'ERROR']]],
  ['map-has-key', [['false', 'bool'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['false', 'bool'], ['true', 'bool'], ['ERROR', 'ERROR']]],
  ['map.keys', [['ERROR', 'list'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'list'], ['a', 'list'], ['ERROR', 'ERROR']]],
  ['map-keys', [['ERROR', 'list'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'list'], ['a', 'list'], ['ERROR', 'ERROR']]],
  ['map.values', [['ERROR', 'list'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'list'], ['1', 'list'], ['ERROR', 'ERROR']]],
  ['map-values', [['ERROR', 'list'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'list'], ['1', 'list'], ['ERROR', 'ERROR']]],
  ['map.merge', [['ERROR', 'map'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'map'], ['ERROR', 'map'], ['ERROR', 'ERROR']]],
  ['map-merge', [['ERROR', 'map'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'map'], ['ERROR', 'map'], ['ERROR', 'ERROR']]],
  ['map.remove', [['ERROR', 'map'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'map'], ['ERROR', 'map'], ['ERROR', 'ERROR']]],
  ['map-remove', [['ERROR', 'map'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'map'], ['ERROR', 'map'], ['ERROR', 'ERROR']]],
  ['map.set', [['ERROR', 'map'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'map'], ['ERROR', 'map'], ['ERROR', 'ERROR']]],
  ['map.deep-merge', [['ERROR', 'map'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'map'], ['ERROR', 'map'], ['ERROR', 'ERROR']]],
  ['map.deep-remove', [['ERROR', 'map'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'ERROR'], ['ERROR', 'map'], ['ERROR', 'map'], ['ERROR', 'ERROR']]],
  ['inspect', [['()', 'string'], ['1, 2', 'string'], ['1 2', 'string'], ['(1,)', 'string'], ['[1, 2]', 'string'], ['[]', 'string'], ['(a: 1)', 'string'], ['(1, 2), (3, 4)', 'string']]],
  ['type-of', [['list', 'string'], ['list', 'string'], ['list', 'string'], ['list', 'string'], ['list', 'string'], ['list', 'string'], ['map', 'string'], ['list', 'string']]]
];

/*
 * Where Jess does not do what Dart Sass does, and why; none of these is about
 * how a list is spelled. Each is pinned with `it.fails`, so a fix shows here.
 */
const NOT_IMPLEMENTED = new Set(['list.slash', 'map.deep-remove', 'inspect']);
const divergence = (fn: string, input: string, wrap: 'value' | 'type', [value, type]: readonly [string, string]): string | undefined => {
  /*
   * A call to a function Jess lacks is written out as-is, which is typed a
   * string, as `inspect()` returns; written out with an empty list it fails, as
   * Dart Sass fails `map.deep-remove((), a)`.
   */
  const writtenAsIs = fn === 'inspect' && wrap === 'type' ? input !== '()' : fn === 'map.deep-remove' && wrap === 'value' && input === '()';
  if (NOT_IMPLEMENTED.has(fn) && !writtenAsIs) {
    return 'not implemented in Jess';
  }
  if ((fn === 'map.get' || fn === 'map-get') && (input === '()' || input === '[]')) {
    return 'a missing key is an error in Jess (the `$m[k]` accessor), `null` in Dart Sass';
  }
  if (wrap === 'value' && value === 'ERROR' && type === 'map' && !NOT_IMPLEMENTED.has(fn)) {
    return 'Jess writes a map as a declaration value, which Dart Sass rejects';
  }
  return undefined;
};

const source = (expression: string): string => `@use "sass:list";\n@use "sass:map";\n.x { r: ${expression}; }`;
const written = async (scss: string, extension: '.scss' | '.jess'): Promise<string> => {
  try {
    const css = await new Compiler({ compile: { functionMode: 'error' } }).renderString(scss, { extension });
    return /r: ([^;]*);/u.exec(css)?.[1] ?? '';
  } catch {
    return 'ERROR';
  }
};

const cells = DART_SASS.flatMap(([fn, row]) => INPUTS.flatMap((input, index) => {
  const expected = row[index]!;
  const call = CALLS.get(fn)!(input);
  return [
    { fn, input, wrap: 'value' as const, expression: call, expected: expected[0], reason: divergence(fn, input, 'value', expected) },
    { fn, input, wrap: 'type' as const, expression: `type-of(${call})`, expected: expected[1], reason: divergence(fn, input, 'type', expected) }
  ];
}));

describe('scss: Sass list, map and type functions on every list spelling do what Dart Sass does', () => {
  it.each(cells.filter(cell => cell.reason === undefined))('$expression', async ({ expression, expected }) => {
    expect(await written(source(expression), '.scss')).toBe(expected);
  });
  it.fails.each(cells.filter(cell => cell.reason !== undefined))('$expression ($reason)', async ({ expression, expected }) => {
    expect(await written(source(expression), '.scss')).toBe(expected);
  });
  it('joins an undecided first list with the second list\'s separator', async () => {
    expect(await written(source('list.separator(list.join([1], (2,)))'), '.scss')).toBe('comma');
    expect(await written(source('list.join([1], (2,))'), '.scss')).toBe('[1, 2]');
  });
});

/*
 * The same cells through the converter: `.scss` → `.jess` → CSS writes what
 * `.scss` → CSS writes, with the empty list `{}`, the curly list `{ … }` and
 * the map `#{ … }`.
 */
const SASS_FUNCTIONS = jessFunctions();
describe('scss → .jess → css writes what scss → css writes', () => {
  /* A map literal read with `map.get` lowers to an accessor on a literal, which `.jess` roots only at a `$` binding. */
  const converts = (cell: typeof cells[number]): boolean => !NOT_IMPLEMENTED.has(cell.fn) && cell.fn !== 'map.get' && cell.fn !== 'map-get';
  it.each(cells.filter(converts))('$expression', async ({ expression }) => {
    const scss = source(expression);
    expect(await written(emitJess(parseScss(scss), { functions: SASS_FUNCTIONS }), '.jess')).toBe(await written(scss, '.scss'));
  });
});
