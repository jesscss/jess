import { describe, it, expect } from 'vitest';
import { Any, List, Mixin, Nil, Rules, VarDeclaration, For, Paren } from '@jesscss/core';
import { each } from '../less/index.js';

function makeMixin(paramNames?: string[]) {
  const mixinRules = new Rules([]);
  if (!paramNames) {
    return new Mixin({ rules: mixinRules });
  }
  const params = new List(
    paramNames.map(name => new Any(name, { role: 'property' }))
  );
  return new Mixin({ params, rules: mixinRules });
}

function assertTupleBindings(loop: For, expectedNames: string[]) {
  const { vars } = loop.data;
  expect(Array.isArray(vars)).toBe(true);
  const varArray = vars as VarDeclaration[];
  expect(varArray).toHaveLength(3);
  const names = varArray.map(variable => variable.data.name.valueOf());
  expect(names).toEqual(expectedNames);
  for (const variable of varArray) {
    expect(variable).toBeInstanceOf(VarDeclaration);
    expect(variable.data.value).toBeInstanceOf(Nil);
    expect(variable.options.paramVar).toBe(true);
  }
}

describe('each', () => {
  it('uses default binding names when called with a rules node', async () => {
    const list = new List([new Any('a'), new Any('b')]);
    const mixinRules = new Rules([]);

    const result = await each(list, mixinRules);

    expect(result).toBeInstanceOf(For);
    assertTupleBindings(result, ['value', 'key', 'index']);
    expect(result.data.iterable).toBe(list);
    expect(result.data.rules).toBeInstanceOf(Rules);
    expect(result.data.rules).not.toBe(mixinRules);
  });

  it('uses default binding names when mixin has no params', async () => {
    const list = new Any('items', { role: 'property' });
    const mixin = makeMixin();

    const result = await each(list, mixin);

    assertTupleBindings(result, ['value', 'key', 'index']);
    expect(result.data.rules).toBeInstanceOf(Rules);
    expect(result.data.rules).not.toBe(mixin.data.rules);
  });

  it('overrides only the first binding name with one param', async () => {
    const list = new Any('items', { role: 'property' });
    const mixin = makeMixin(['item']);

    const result = await each(list, mixin);

    assertTupleBindings(result, ['item', 'key', 'index']);
  });

  it('overrides first two binding names with two params', async () => {
    const list = new Any('items', { role: 'property' });
    const mixin = makeMixin(['item', 'name']);

    const result = await each(list, mixin);

    assertTupleBindings(result, ['item', 'name', 'index']);
  });

  it('overrides all binding names with three params', async () => {
    const list = new Any('items', { role: 'property' });
    const mixin = makeMixin(['item', 'name', 'position']);

    const result = await each(list, mixin);

    assertTupleBindings(result, ['item', 'name', 'position']);
  });

  it('preserves a paren-wrapped iterable for For to handle', async () => {
    const list = new Paren(new List([new Any('a'), new Any('b')]));
    const mixin = makeMixin();

    const result = await each(list, mixin);

    expect(result).toBeInstanceOf(For);
    expect(result.data.iterable).toBe(list);
  });
});
