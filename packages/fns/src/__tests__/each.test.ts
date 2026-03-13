import { describe, it, expect } from 'vitest';
import { Any, List, Mixin, Nil, Rules, VarDeclaration, For } from '@jesscss/core';
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
  const { pattern } = loop.data;
  expect(pattern.kind).toBe('tuple');
  expect(pattern.values).toHaveLength(3);
  const names = pattern.values.map(variable => variable.data.name.valueOf());
  expect(names).toEqual(expectedNames);
  for (const variable of pattern.values) {
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
    expect(result.data.iterable.kind).toBe('node');
    expect(result.data.iterable.value).toBe(list);
    expect(result.data.rules).toBe(mixinRules);
  });

  it('uses default binding names when mixin has no params', async () => {
    const list = new Any('items', { role: 'property' });
    const mixin = makeMixin();

    const result = await each(list, mixin);

    assertTupleBindings(result, ['value', 'key', 'index']);
    expect(result.data.rules).toBe(mixin.data.rules);
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
});
