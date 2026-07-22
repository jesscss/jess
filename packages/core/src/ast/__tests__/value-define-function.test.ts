import { describe, expect, expectTypeOf, it } from 'vitest';
import { createFnRegistry, defineFunction, makeDimension, makeList } from '../../value.js';

const twice = defineFunction('twice', {
  params: [{ name: 'value', kinds: ['Dimension'] }] as const,
  body: (value) => {
    return makeDimension(value.number * 2, value.unit);
  }
});

const lazyTwice = defineFunction('lazy-twice', {
  params: [{ name: 'value', kinds: ['Dimension'], lazy: true }] as const,
  body: value => Promise.resolve(value()).then(result => makeDimension(result.number * 2, result.unit))
});

const skipLazy = defineFunction('skip-lazy', {
  params: [{ name: 'value', kinds: ['Dimension'], lazy: true }] as const,
  body: () => makeDimension(1)
});

const collect = defineFunction('collect', {
  params: [
    { name: 'value', kinds: ['Dimension'] },
    { name: 'precision', kinds: ['Dimension'], default: makeDimension(1) },
    { name: 'rest', kinds: ['Dimension'], rest: true }
  ] as const,
  body: (value, precision, rest) => makeDimension(value.number + precision.number + rest.length, value.unit)
});

describe('value-domain defineFunction', () => {
  it('is a callable plain function and keeps registry invocation positional-only', () => {
    expect(typeof twice).toBe('function');
    expect(Object.prototype.hasOwnProperty.call(twice, 'params')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(twice, 'body')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(twice, 'options')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(twice, '_internal')).toBe(false);
    expect(twice.params).toEqual([{ name: 'value', kinds: ['Dimension'] }]);
    expect(twice(makeDimension(2, 'px'))).toEqual({ type: 'Dimension', number: 4, unit: 'px', bytes: '4px' });
    const registry = createFnRegistry();
    registry.register(twice);
    expect(registry.dispatch('twice', makeList([makeDimension(2, 'px')]), {
      modes: { mathMode: 'parens-division', unitMode: 'preserve', functionMode: 'preserve', equalityMode: 'less' },
      stringify: value => value.bytes
    })).toEqual(makeDimension(4, 'px'));
    expect(() => registry.dispatch('twice', makeList([{ value: makeDimension(2, 'px') } as never]), {
      modes: { mathMode: 'parens-division', unitMode: 'preserve', functionMode: 'preserve', equalityMode: 'less' },
      stringify: value => value.bytes
    })).toThrow('typed ValueObj');
  });

  it('accepts Sass/Jess direct records and rejects missing, wrong-kind, and primitive arguments', () => {
    expect(twice({ value: makeDimension(2, 'px') })).toEqual({ type: 'Dimension', number: 4, unit: 'px', bytes: '4px' });
    expect(() => twice({})).toThrow('missing required argument value');
    expect(() => twice(makeDimension(2, 'px'), makeDimension(3))).toThrow('too many');
    expect(() => twice({ value: { type: 'Keyword', text: 'x', bytes: 'x' } })).toThrow('expected Dimension');
    expect(() => twice(2 as never)).toThrow('typed ValueObj');
  });

  it('defers a lazy parameter and validates the typed value when the thunk is invoked', async () => {
    let invoked = false;
    const skipped = skipLazy(() => {
      invoked = true;
      return makeDimension(3, 'px');
    });
    expect(invoked).toBe(false);
    expect(skipped).toEqual(makeDimension(1));
    await expect(lazyTwice(() => makeDimension(3, 'px'))).resolves.toEqual({ type: 'Dimension', number: 6, unit: 'px', bytes: '6px' });
    expect(() => lazyTwice(() => ({ type: 'Keyword', text: 'no', bytes: 'no' }))).toThrow('expected Dimension');
  });

  it('assigns Sass/Jess named fields alongside positional values, defaults, and rest values', () => {
    expect(collect(makeDimension(2, 'px'), { precision: makeDimension(3) })).toEqual(makeDimension(5, 'px'));
    expect(collect(makeDimension(2, 'px'), { rest: [makeDimension(4)] })).toEqual(makeDimension(4, 'px'));
    expect(collect({ value: makeDimension(2, 'px'), rest: [makeDimension(4), makeDimension(5)] })).toEqual(makeDimension(5, 'px'));
    expect(collect(makeDimension(2, 'px'), makeDimension(3), makeDimension(4), makeDimension(5))).toEqual(makeDimension(7, 'px'));
  });

  it('infers typed value and lazy-thunk body arguments from the parameter tuple', () => {
    expectTypeOf(twice).toBeFunction();
    expectTypeOf(twice).parameter(0).toEqualTypeOf<{ type: 'Dimension'; number: number; unit: string; bytes: string }>();
    expectTypeOf(lazyTwice).parameter(0).returns.toEqualTypeOf<Promise<{ type: 'Dimension'; number: number; unit: string; bytes: string }>>();
  });
});
