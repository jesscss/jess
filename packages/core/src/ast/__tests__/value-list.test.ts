import { describe, expect, it } from 'vitest';
import {
  emitValue,
  groupItems,
  groupSeparator,
  isBracketedList,
  listValueAt,
  makeBlock,
  makeKeyword,
  makeList,
  serializeValue
} from '../../value.js';

describe('core typed value lists', () => {
  it('uses raw arrays for ordinary adjacency and List only for comma/slash facts', () => {
    const values = [makeKeyword('a'), makeKeyword('b')];
    expect(serializeValue(values)).toBe('a b');
    expect(serializeValue(makeList(values, ','))).toBe('a, b');
    expect(serializeValue(makeList(values, '/'))).toBe('a / b');
    expect(groupSeparator(values)).toBe(' ');
    expect(groupSeparator(makeList(values, ','))).toBe(',');
    expect(groupItems(makeList(values, ',')).map(emitValue)).toEqual(['a', 'b']);
  });

  it('keeps square and paren delimiters as Block facts around any structural group', () => {
    const values = [makeKeyword('a'), makeKeyword('b')];
    const square = makeBlock(values, 'square');
    const paren = makeBlock(values, 'paren');

    expect(serializeValue(square)).toBe('[a b]');
    expect(serializeValue(paren)).toBe('(a b)');
    expect(isBracketedList(square)).toBe(true);
    expect(isBracketedList(paren)).toBe(false);
    expect(groupItems(square).map(emitValue)).toEqual(['a', 'b']);
  });

  it('never recovers sequence structure from flattened bytes', () => {
    const authored = makeKeyword('one fn(a, b) "two three"');
    expect(groupItems(authored)).toEqual([authored]);
    expect(serializeValue([makeKeyword('one'), authored])).toBe('one one fn(a, b) "two three"');
  });

  it('keeps index policy outside core and enforces zero-based bounds', () => {
    const values = [makeKeyword('one'), makeKeyword('two')];
    expect(emitValue(listValueAt(values, 1))).toBe('two');
    expect(() => listValueAt(values, -1)).toThrow(RangeError);
    expect(() => listValueAt(values, 2)).toThrow(RangeError);
    expect(() => listValueAt(values, 1.5)).toThrow(RangeError);
  });
});
