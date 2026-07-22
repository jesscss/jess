import { describe, expect, it } from 'vitest';
import { makeBlock, makeBool, makeDimension, makeKeyword, makeList, makeQuoted, type Fn, type List, type ValueObj } from '@jesscss/core/value';
import append from '../list/append.js';
import isBracketed from '../list/is-bracketed.js';
import listIndex from '../list/list-index.js';
import length from '../list/length.js';
import nth from '../list/nth.js';
import separator from '../list/separator.js';
import setNth from '../list/set-nth.js';
import zip from '../list/zip.js';
import join from '../list/join.js';

const ctx = { modes: { unitMode: 'preserve' as const }, stringify: (value: ValueObj) => value.bytes };
const call = (fn: Fn, ...args: ValueObj[]): ValueObj => fn(makeList(args, ','), ctx) as ValueObj;
const values = (value: ValueObj): readonly ValueObj[] => value.type === 'List' ? value.value : value.type === 'Block' && value.inner.type === 'List' ? value.inner.value : [];

describe('Sass list functions on the AST-v2 value domain', () => {
  it('uses List.value and preserves separator facts for append and join', () => {
    const comma = makeList([makeDimension(1), makeDimension(2)], ',');
    const appended = call(append, comma, makeDimension(3));
    expect(appended).toMatchObject({ type: 'List', sep: ',', value: [{ number: 1 }, { number: 2 }, { number: 3 }] });

    const joined = call(join, appended, makeList([makeDimension(4)], '/'), makeQuoted('slash'));
    expect(joined).toMatchObject({ type: 'List', sep: '/', value: [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }] });
  });

  it('preserves a square Block wrapper when Sass list operations create a result', () => {
    const square = makeBlock(makeList([makeDimension(1)], ' '), 'square');
    const result = call(append, square, makeDimension(2));
    expect(result).toMatchObject({ type: 'Block', delimiter: 'square', inner: { type: 'List', sep: ' ', value: [{ number: 1 }, { number: 2 }] } });
    expect(call(isBracketed, result)).toMatchObject({ type: 'Bool', value: true });
  });

  it('keeps Sass one-based floor normalization before Core zero-based access', () => {
    const list = makeList([makeKeyword('a'), makeKeyword('b'), makeKeyword('c')], ' ');
    expect(call(nth, list, makeDimension(2.9))).toMatchObject({ type: 'Keyword', text: 'b' });
    expect(call(setNth, list, makeDimension(2.9), makeKeyword('x'))).toMatchObject({ type: 'List', value: [{ text: 'a' }, { text: 'x' }, { text: 'c' }] });
    expect(() => call(nth, list, makeDimension(0))).toThrow('out of bounds');
  });

  it('normalizes negative Sass indexes from the end before core access', () => {
    const list = makeList([makeKeyword('a'), makeKeyword('b'), makeKeyword('c')], ' ');
    expect(call(nth, list, makeDimension(-1))).toMatchObject({ type: 'Keyword', text: 'c' });
    expect(call(setNth, list, makeDimension(-2), makeKeyword('x'))).toMatchObject({ type: 'List', value: [{ text: 'a' }, { text: 'x' }, { text: 'c' }] });
    expect(() => call(nth, list, makeDimension(-4))).toThrow('out of bounds');
  });

  it('returns Sass list facts and value-domain nil/index results', () => {
    const list = makeList([makeKeyword('a'), makeKeyword('b')], ',');
    expect(call(length, list)).toMatchObject({ type: 'Dimension', number: 2, unit: '' });
    expect(call(listIndex, list, makeKeyword('b'))).toMatchObject({ type: 'Dimension', number: 2 });
    expect(call(listIndex, list, makeKeyword('x'))).toMatchObject({ type: 'Nil' });
    expect(call(separator, list)).toMatchObject({ type: 'Keyword', text: 'comma' });
  });

  it('uses the variadic registry contract for zip', () => {
    const result = zip(makeList([
      makeList([makeDimension(1), makeDimension(2)], ' '),
      makeList([makeDimension(3), makeDimension(4)], ' ')
    ], ','), ctx) as List;
    expect(result).toMatchObject({ type: 'List', sep: ',' });
    expect(values(result)).toHaveLength(2);
    expect(values(values(result)[0]!)).toMatchObject([{ number: 1 }, { number: 3 }]);
  });
});
