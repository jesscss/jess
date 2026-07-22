import { describe, expect, it } from 'vitest';
import {
  asList,
  coerceListItems,
  isBracketedList,
  listValueAt,
  makeBlock,
  makeKeyword,
  makeList,
  serializeValue
} from '../../value.js';

describe('core typed value lists', () => {
  it('retains every value-domain separator fact without dialect helpers', () => {
    const values = [makeKeyword('a'), makeKeyword('b')];
    expect(serializeValue(makeList(values, ','))).toBe('a, b');
    expect(serializeValue(makeList(values, ' '))).toBe('a b');
    expect(serializeValue(makeList(values, '/'))).toBe('a / b');
    expect(serializeValue(makeList(values, 'undecided'))).toBe('a b');
    expect(asList(makeList(values, ',')).value).toHaveLength(2);
  });

  it('keeps square and paren delimiters as Block facts around a List', () => {
    const list = makeList([makeKeyword('a'), makeKeyword('b')], ',');
    const square = makeBlock(list, 'square');
    const paren = makeBlock(list, 'paren');

    expect(serializeValue(square)).toBe('[a, b]');
    expect(serializeValue(paren)).toBe('(a, b)');
    expect(isBracketedList(square)).toBe(true);
    expect(isBracketedList(paren)).toBe(false);
    expect(asList(square)).toBe(list);
  });

  it('recovers nested and quoted flattened values without splitting their interiors', () => {
    const items = coerceListItems(makeKeyword('one fn(a, b) "two three"'));
    expect(items.map(item => item.bytes)).toEqual(['one', 'fn(a, b)', '"two three"']);
  });

  it('keeps index policy outside core and enforces zero-based bounds', () => {
    const list = makeList([makeKeyword('one'), makeKeyword('two')], ' ');
    expect(listValueAt(list, 1).bytes).toBe('two');
    expect(() => listValueAt(list, -1)).toThrow(RangeError);
    expect(() => listValueAt(list, 2)).toThrow(RangeError);
    expect(() => listValueAt(list, 1.5)).toThrow(RangeError);
  });
});
