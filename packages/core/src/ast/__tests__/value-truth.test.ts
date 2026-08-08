/*
 * The §4.4 truthiness table of `docs/design/RESOLVED-SEMANTICS-AND-NAMING.md`,
 * executable over the VALUE model.
 *
 * `.jess` is falsy for exactly four values — `false`, `null`, `""`, `()` — and
 * truthy for everything else, INCLUDING `0`. The principle is EMPTINESS, not
 * zero-ness, which is where this is sharper than both JavaScript (`0` and `""`
 * both falsy) and Sass (`0` truthy, but `""` and `()` truthy too).
 *
 * This is stated over the predicate rather than over rendered `.jess` because
 * the predicate IS the rule (§4.4.1): one evaluation site, one error site.
 */
import { describe, expect, it } from 'vitest';
import { isTruthy } from '../value-truth.js';
import {
  makeBlock, makeBool, makeCollection, makeColorRgb, makeDimension, makeKeyword,
  makeList, makeNull, makeQuoted
} from '../value-factory.js';
import type { ValueGroup } from '../value-eval.js';

const FALSY: ReadonlyArray<readonly [string, ValueGroup]> = [
  ['false', makeBool(false)],
  ['null', makeNull()],
  ['""', makeQuoted('', '"', false)],
  ['\'\'', makeQuoted('', '\'', false)],
  ['() — empty list', makeList([], ',')],
  ['() — empty map', makeCollection([])],
  ['() — empty group', []],
  ['(()) — paren is transparent', makeBlock(makeList([], ','), 'paren')],
  ['(false) — paren is transparent', makeBlock(makeBool(false), 'paren')],
  ['[] — empty bracketed list', makeBlock([], 'square')]
];

const TRUTHY: ReadonlyArray<readonly [string, ValueGroup]> = [
  ['true', makeBool(true)],
  ['0', makeDimension(0, '')],
  ['1', makeDimension(1, '')],
  ['-1', makeDimension(-1, '')],
  ['0px', makeDimension(0, 'px')],
  ['1px', makeDimension(1, 'px')],
  ['0%', makeDimension(0, '%')],
  ['1em', makeDimension(1, 'em')],
  ['"a"', makeQuoted('a', '"', false)],
  ['"0"', makeQuoted('0', '"', false)],
  ['"false"', makeQuoted('false', '"', false)],
  ['"true"', makeQuoted('true', '"', false)],
  ['a', makeKeyword('a')],
  ['none', makeKeyword('none')],
  ['inherit', makeKeyword('inherit')],
  ['red', makeColorRgb([255, 0, 0], 1, 1)],
  ['transparent', makeColorRgb([0, 0, 0], 0, 1)],
  ['rgba(0,0,0,0)', makeColorRgb([0, 0, 0], 0, 2)],
  ['nope() — unresolved, emits verbatim', makeKeyword('nope()')],
  ['(1 2)', makeBlock([makeDimension(1, ''), makeDimension(2, '')], 'paren')],
  ['(1, 2)', makeList([makeDimension(1, ''), makeDimension(2, '')], ',')],
  ['(a: b)', makeCollection([{ key: makeKeyword('a'), value: makeKeyword('b') }])],
  ['[false] — a one-item bracketed list', makeBlock(makeBool(false), 'square')]
];

describe('§4.4 — falsy iff absent or empty', () => {
  it.each(FALSY)('%s is falsy', (_label, value) => {
    expect(isTruthy(value)).toBe(false);
  });

  it.each(TRUTHY)('%s is truthy', (_label, value) => {
    expect(isTruthy(value)).toBe(true);
  });
});
