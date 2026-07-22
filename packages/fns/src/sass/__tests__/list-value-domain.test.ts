import { describe, expect, it } from 'vitest';
import { emitValue, makeBlock, makeDimension, makeKeyword, makeList, makeQuoted, type Fn, type ValueGroup } from '@jesscss/core/value';
import append from '../list/append.js';
import isBracketed from '../list/is-bracketed.js';
import listIndex from '../list/list-index.js';
import length from '../list/length.js';
import nth from '../list/nth.js';
import separator from '../list/separator.js';
import setNth from '../list/set-nth.js';
import zip from '../list/zip.js';
import join from '../list/join.js';

const ctx = { modes: { unitMode: 'preserve' as const }, stringify: (value: ValueGroup) => emitValue(value) };
const call = (fn: Fn, ...args: ValueGroup[]): ValueGroup => {
  const result = fn(makeList(args, ','), ctx);
  if (result === undefined) {
    throw new TypeError('Expected Sass list function to return a value.');
  }
  return result;
};

describe('Sass list functions on the AST-v2 value domain', () => {
  it('uses List.value and preserves separator facts for append and join', () => {
    const comma = makeList([makeDimension(1), makeDimension(2)], ',');
    const appended = call(append, comma, makeDimension(3));
    expect(appended).toMatchObject({ type: 'List', sep: ',', value: [{ number: 1 }, { number: 2 }, { number: 3 }] });

    const joined = call(join, appended, makeList([makeDimension(4)], '/'), makeQuoted('slash'));
    expect(joined).toMatchObject({ type: 'List', sep: '/', value: [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }] });
  });

  it('preserves a square Block wrapper when Sass list operations create a result', () => {
    const square = makeBlock([makeDimension(1)], 'square');
    const result = call(append, square, makeDimension(2));
    expect(result).toMatchObject({ type: 'Block', delimiter: 'square', inner: [{ number: 1 }, { number: 2 }] });
    expect(call(isBracketed, result)).toMatchObject({ type: 'Bool', value: true });
  });

  it('uses raw arrays for space-separated sequences and requires integral indexes', () => {
    const list = [makeKeyword('a'), makeKeyword('b'), makeKeyword('c')];
    expect(call(nth, list, makeDimension(2))).toMatchObject({ type: 'Keyword', text: 'b' });
    expect(call(setNth, list, makeDimension(2), makeKeyword('x'))).toMatchObject([{ text: 'a' }, { text: 'x' }, { text: 'c' }]);
    expect(() => call(nth, list, makeDimension(2.9))).toThrow('integer');
    expect(() => call(setNth, list, makeDimension(2.9), makeKeyword('x'))).toThrow('integer');
    expect(() => call(nth, list, makeDimension(0))).toThrow('out of bounds');
  });

  it('normalizes negative Sass indexes from the end before core access', () => {
    const list = [makeKeyword('a'), makeKeyword('b'), makeKeyword('c')];
    expect(call(nth, list, makeDimension(-1))).toMatchObject({ type: 'Keyword', text: 'c' });
    expect(call(setNth, list, makeDimension(-2), makeKeyword('x'))).toMatchObject([{ text: 'a' }, { text: 'x' }, { text: 'c' }]);
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
    const value = zip(makeList([
      [makeDimension(1), makeDimension(2)],
      [makeDimension(3), makeDimension(4)]
    ], ','), ctx);
    if (Array.isArray(value) || value.type !== 'List') {
      throw new TypeError('Expected zip() to return a list.');
    }
    const result = value;
    expect(result).toMatchObject({ type: 'List', sep: ',' });
    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toMatchObject([{ number: 1 }, { number: 3 }]);
  });

  it('treats scalar and raw groups as space-separated without materializing a List', () => {
    const scalar = makeKeyword('a');
    const spaced = [makeKeyword('a'), makeKeyword('b')];
    expect(call(separator, scalar)).toMatchObject({ type: 'Keyword', text: 'space' });
    expect(call(separator, spaced)).toMatchObject({ type: 'Keyword', text: 'space' });
    expect(call(append, scalar, makeKeyword('b'))).toMatchObject([{ text: 'a' }, { text: 'b' }]);
  });
});
