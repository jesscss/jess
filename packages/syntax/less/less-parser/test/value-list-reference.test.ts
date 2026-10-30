import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/less-parser';

/*
 * A lookup or namespace read (`@t[family]`, `#ns.m()[x]`) is one value like any
 * other: in a comma or space list it is one item, in place, and the items after
 * it stay. A value that is only the read is the `Reference` itself.
 */
function declaration(source: string): unknown {
  const sheet = parse(`.a { b: ${source}; }`);
  const rule = sheet.rules[0];
  if (rule?.type !== 'Ruleset') {
    throw new Error('expected a ruleset');
  }
  const first = rule.rules[0];
  if (first?.type !== 'Declaration') {
    throw new Error('expected a declaration');
  }
  return first;
}

function declarationValue(source: string): unknown {
  const value = declaration(source);
  return typeof value === 'object' && value !== null && 'value' in value ? value.value : undefined;
}

const keyword = (src: string) => ({ type: 'Keyword', src });
const reference = { type: 'Reference' };

describe('a reference in a Less value list', () => {
  it.each([
    ['a lookup', '@t[family]'],
    ['a namespace read', '#ns.m()[x]'],
    ['a mixin read', '.m()[x]'],
    ['a nested lookup', '@t[@inner][x]']
  ])('%s leading a comma list is the first of its items', (_name, read) => {
    expect(declarationValue(`${read}, y`)).toMatchObject({
      type: 'List',
      sep: ',',
      value: [reference, keyword('y')]
    });
  });

  it('keeps the items either side of a lookup', () => {
    expect(declarationValue('x, @t[family], y')).toMatchObject({
      type: 'List',
      value: [keyword('x'), reference, keyword('y')]
    });
  });

  it('keeps a namespace read leading a space list', () => {
    expect(declarationValue('#ns.m()[x] y')).toMatchObject([reference, keyword('y')]);
  });

  it('keeps the list under !important', () => {
    expect(declaration('@t[family], y !important')).toMatchObject({
      important: true,
      value: { type: 'List', value: [reference, keyword('y')] }
    });
  });

  it.each([
    ['a lookup', '@t[family]'],
    ['a namespace read', '#ns.m()[x]']
  ])('%s alone is the Reference itself', (_name, read) => {
    expect(declarationValue(read)).toMatchObject({ ...reference, steps: [{ type: 'LookupStep', kind: 'prop' }] });
  });
});
