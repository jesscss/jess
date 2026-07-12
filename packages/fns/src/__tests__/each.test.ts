import { describe, it, expect } from 'vitest';
import { Any, List, Mixin, Nil, Rules, VarDeclaration, For, Paren, Context, type FunctionThis } from '@jesscss/core';
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
  const { pattern } = loop.value;
  expect(pattern.kind).toBe('tuple');
  const vars = pattern.values;
  expect(Array.isArray(vars)).toBe(true);
  expect(vars).toHaveLength(3);
  const names = vars.map(variable => variable.value.name.valueOf());
  expect(names).toEqual(expectedNames);
  for (const variable of vars) {
    expect(variable).toBeInstanceOf(VarDeclaration);
    expect(variable.value.value).toBeInstanceOf(Nil);
    expect(variable.options.paramVar).toBe(true);
  }
}

type EachInternal = {
  _internal: (ctx: FunctionThis, list: Any | List | Paren, mixin: Mixin | Rules) => Promise<For>;
};

function hasEachInternal(value: unknown): value is EachInternal {
  return typeof value === 'function' && typeof Reflect.get(value, '_internal') === 'function';
}

describe('each', () => {
  if (!hasEachInternal(each)) {
    throw new Error('each() test expected a defineFunction wrapper with _internal');
  }
  const { _internal: eachInternal } = each;
  const callEach = async (list: Any | List | Paren, mixin: Mixin | Rules): Promise<For> => {
    const functionThis: FunctionThis = {
      context: new Context(),
      args: () => new List([]),
      rawArgs: new List([])
    };
    return eachInternal(functionThis, list, mixin);
  };

  it('uses default binding names when called with a rules node', async () => {
    const list = new List([new Any('a'), new Any('b')]);
    const mixinRules = new Rules([]);

    const result = await callEach(list, mixinRules);

    expect(result).toBeInstanceOf(For);
    assertTupleBindings(result, ['value', 'key', 'index']);
    expect(result.value.iterable.value).toBe(list);
    expect(result.value.rules).toBeInstanceOf(Rules);
    expect(result.value.rules).toBe(mixinRules);
    expect(Reflect.has(result.value.rules, 'sourceParent')).toBe(false);
  });

  it('uses default binding names when mixin has no params', async () => {
    const list = new Any('items', { role: 'property' });
    const mixin = makeMixin();

    const result = await callEach(list, mixin);

    assertTupleBindings(result, ['value', 'key', 'index']);
    expect(result.value.rules).toBeInstanceOf(Rules);
    expect(result.value.rules).toBe(mixin.value.rules);
    expect(Reflect.has(result.value.rules, 'sourceParent')).toBe(false);
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
    expect(result.value.iterable.value).toBe(list);
  });
});
