import { describe, it, expect } from 'vitest';
import { Any, List, Mixin, Nil, Rules, VarDeclaration, For, Paren, Context, type FunctionThis } from '@jesscss/core';
import { eachImplementation } from '../less/each.js';

function makeMixin(paramNames?: string[]) {
  const mixinRules = new Rules([]);
  if (!paramNames) {
    return new Mixin({ rules: mixinRules.rules });
  }
  const params = new List(
    paramNames.map(name => new Any(name, { role: 'property' }))
  );
  return new Mixin({ params, rules: mixinRules.rules });
}

function assertTupleBindings(loop: For, expectedNames: string[]) {
  const { pattern } = loop;
  expect(pattern.kind).toBe('tuple');
  const vars = pattern.values;
  expect(Array.isArray(vars)).toBe(true);
  expect(vars).toHaveLength(3);
  const names = vars.map(variable => variable.name.valueOf());
  expect(names).toEqual(expectedNames);
  for (const variable of vars) {
    expect(variable).toBeInstanceOf(VarDeclaration);
    expect(variable.value).toBeInstanceOf(Nil);
    expect(variable.options.paramVar).toBe(true);
  }
}

describe('each', () => {
  const callEach = async (list: Any | List | Paren, mixin: Mixin | Rules): Promise<For> => {
    const functionThis: FunctionThis = {
      context: new Context(),
      args: () => new List([]),
      rawArgs: new List([])
    };
    return eachImplementation(functionThis, list, mixin);
  };

  it('uses default binding names when called with a rules node', async () => {
    const list = new List([new Any('a'), new Any('b')]);
    const mixinRules = new Rules([]);

    const result = await callEach(list, mixinRules);

    expect(result).toBeInstanceOf(For);
    assertTupleBindings(result, ['value', 'key', 'index']);
    expect(result.iterable.value).toBe(list);
    expect(result.rules).toBe(mixinRules.rules);
    expect(Reflect.has(result.rules, 'sourceParent')).toBe(false);
  });

  it('uses default binding names when mixin has no params', async () => {
    const list = new Any('items', { role: 'property' });
    const mixin = makeMixin();

    const result = await callEach(list, mixin);

    assertTupleBindings(result, ['value', 'key', 'index']);
    expect(result.rules).toBe(mixin.rules);
    expect(Reflect.has(result.rules, 'sourceParent')).toBe(false);
  });

  it('overrides only the first binding name with one param', async () => {
    const list = new Any('items', { role: 'property' });
    const mixin = makeMixin(['item']);

    const result = await callEach(list, mixin);

    assertTupleBindings(result, ['item', 'key', 'index']);
  });

  it('overrides first two binding names with two params', async () => {
    const list = new Any('items', { role: 'property' });
    const mixin = makeMixin(['item', 'name']);

    const result = await callEach(list, mixin);

    assertTupleBindings(result, ['item', 'name', 'index']);
  });

  it('overrides all binding names with three params', async () => {
    const list = new Any('items', { role: 'property' });
    const mixin = makeMixin(['item', 'name', 'position']);

    const result = await callEach(list, mixin);

    assertTupleBindings(result, ['item', 'name', 'position']);
  });

  it('preserves a paren-wrapped iterable for For to handle', async () => {
    const list = new Paren(new List([new Any('a'), new Any('b')]));
    const mixin = makeMixin();

    const result = await callEach(list, mixin);

    expect(result).toBeInstanceOf(For);
    expect(result.iterable.value).toBe(list);
  });
});
