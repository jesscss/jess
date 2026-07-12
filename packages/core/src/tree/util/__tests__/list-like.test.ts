import { describe, expect, it } from 'vitest';
import { Any, List, Sequence, Paren, Rules, decl } from '../../index.js';
import { coerceListItems, getListItems, isListContainer, iterateItems } from '../list-like.js';

describe('list-like utilities', () => {
  it('detects direct list containers and unwraps a single paren layer', () => {
    const list = new List([new Any('a'), new Any('b')]);
    const seq = new Sequence([new Any('x'), new Any('y')]);
    const parenList = new Paren(list);
    const nestedParenList = new Paren(parenList);

    expect(isListContainer(list)).toBe(true);
    expect(isListContainer(seq)).toBe(true);
    expect(isListContainer(parenList)).toBe(true);
    expect(isListContainer(nestedParenList)).toBe(false);

    expect(getListItems(list)?.map(item => item.valueOf())).toEqual(['a', 'b']);
    expect(getListItems(seq)?.map(item => item.valueOf())).toEqual(['x', 'y']);
    expect(getListItems(parenList)?.map(item => item.valueOf())).toEqual(['a', 'b']);
    expect(getListItems(nestedParenList)).toBeUndefined();
  });

  it('coerces scalars to length-1 and preserves Less single-list-sequence normalization', () => {
    const single = new Any('solo');
    const innerSequence = new Sequence([new Any('a'), new Any('b')]);
    const listWithSingleSequence = new List([innerSequence]);
    const nestedParenList = new Paren(new Paren(new List([new Any('wrapped')])));
    const nestedItems = coerceListItems(nestedParenList);

    expect(coerceListItems(single).map(item => item.valueOf())).toEqual(['solo']);
    expect(coerceListItems(listWithSingleSequence).map(item => item.valueOf())).toEqual(['a', 'b']);
    expect(nestedItems).toHaveLength(1);
    expect(nestedItems[0]).toBeInstanceOf(Paren);
    expect(nestedItems[0]!.toString()).toBe('((wrapped))');
  });

  it('iterates items without flattening nested containers', () => {
    const directParenList = new Paren(new List([new Any('a'), new Any('b')]));
    const nestedParenList = new Paren(new Paren(new List([new Any('wrapped')])));
    const rules = new Rules([
      decl({ name: 'one', value: new Any('red') }),
      decl({ name: 'two', value: new Any('blue') })
    ]);

    const directEntries: Array<[string, number | string]> = [];
    for (const [value, key] of iterateItems(directParenList)) {
      directEntries.push([value.valueOf(), key as number | string]);
    }
    expect(directEntries).toEqual([['a', 0], ['b', 1]]);

    const nestedEntries: Array<[string, number | string]> = [];
    for (const [value, key] of iterateItems(nestedParenList)) {
      nestedEntries.push([value.toString(), key as number | string]);
    }
    expect(nestedEntries).toEqual([['((wrapped))', 0]]);

    const ruleEntries: Array<[string, string]> = [];
    for (const [value, key] of iterateItems(rules)) {
      ruleEntries.push([value.valueOf(), String(key.valueOf())]);
    }
    expect(ruleEntries).toEqual([['red', 'one'], ['blue', 'two']]);
  });
});
