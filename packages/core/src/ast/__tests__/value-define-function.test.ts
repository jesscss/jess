import { describe, expect, expectTypeOf, it } from 'vitest';
import { createFnRegistry, defineFunction, emitValue, makeDimension, makeList } from '../../value.js';

function invoke(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== 'function') {
    throw new TypeError('Expected a callable value-domain function.');
  }
  return Reflect.apply(fn, undefined, args);
}

const twice = defineFunction('twice', {
  params: [{ name: 'value', type: 'Dimension' }] as const,
  body: (value) => {
    return makeDimension(value.number * 2, value.unit);
  }
});

const lazyTwice = defineFunction('lazy-twice', {
  params: [{ name: 'value', type: 'Dimension', lazy: true }] as const,
  body: value => Promise.resolve(value()).then(result => makeDimension(result.number * 2, result.unit))
});

const skipLazy = defineFunction('skip-lazy', {
  params: [{ name: 'value', type: 'Dimension', lazy: true }] as const,
  body: () => makeDimension(1)
});

const collect = defineFunction('collect', {
  params: [
    { name: 'value', type: 'Dimension' },
    { name: 'precision', type: 'Dimension', default: makeDimension(1) },
    { name: 'rest', type: 'Dimension', rest: true }
  ] as const,
  body: (value, precision, rest) => makeDimension(value.number + precision.number + rest.length, value.unit)
});

const unnamedPositional = defineFunction('unnamed-positional', {
  params: [{ type: 'Dimension' }] as const,
  body: (...args) => {
    const value = args[0];
    if (value?.type !== 'Dimension') {
      throw new TypeError('Expected a Dimension');
    }
    return makeDimension(value.number * 2, value.unit);
  }
});

describe('value-domain defineFunction', () => {
  it('is a callable plain function and keeps registry invocation positional-only', () => {
    expect(typeof twice).toBe('function');
    expect(Object.prototype.hasOwnProperty.call(twice, 'params')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(twice, 'body')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(twice, 'options')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(twice, '_internal')).toBe(false);
    expect(twice.params).toEqual([{ name: 'value', type: 'Dimension' }]);
    expect(twice(makeDimension(2, 'px'))).toEqual({ type: 'Dimension', number: 4, unit: 'px', bytes: '4px' });
    const registry = createFnRegistry();
    registry.register(twice);
    expect(registry.dispatch('twice', makeList([makeDimension(2, 'px')]), {
      modes: { mathMode: 'parens-division', unitMode: 'preserve', functionMode: 'preserve', equalityMode: 'less' },
      stringify: emitValue
    })).toEqual(makeDimension(4, 'px'));
    const invalidArgs = invoke(makeList, [{ value: makeDimension(2, 'px') }], ',');
    expect(() => invoke(registry.dispatch.bind(registry), 'twice', invalidArgs, {
      modes: { mathMode: 'parens-division', unitMode: 'preserve', functionMode: 'preserve', equalityMode: 'less' },
      stringify: value => value.bytes
    })).toThrow('structural value');
  });

  it('accepts Sass/Jess direct records and rejects missing, wrong-kind, and primitive arguments', () => {
    expect(twice({ value: makeDimension(2, 'px') })).toEqual({ type: 'Dimension', number: 4, unit: 'px', bytes: '4px' });
    expect(() => twice({})).toThrow('missing required argument value');
    expect(() => twice(makeDimension(2, 'px'), makeDimension(3))).toThrow('too many');
    expect(() => twice({ value: { type: 'Keyword', text: 'x', bytes: 'x' } })).toThrow('expected Dimension');
    expect(() => invoke(twice, 2)).toThrow('typed value node');
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

  it('dispatches unnamed positional specs without requiring record metadata', () => {
    const args = makeList([makeDimension(2, 'px')]);
    const ctx = {
      modes: { mathMode: 'parens-division', unitMode: 'preserve', functionMode: 'preserve', equalityMode: 'less' },
      stringify: emitValue
    } as const;
    expect(invoke(unnamedPositional, makeDimension(2, 'px'))).toEqual(makeDimension(4, 'px'));
    const registry = createFnRegistry();
    registry.register(unnamedPositional);
    expect(registry.dispatch('unnamed-positional', args, ctx)).toEqual(makeDimension(4, 'px'));
  });

  it('applies the arity check on the registry route and feeds a rest parameter every trailing item', () => {
    const ctx = {
      modes: { mathMode: 'parens-division', unitMode: 'preserve', functionMode: 'preserve', equalityMode: 'less' },
      stringify: emitValue
    } as const;
    const registry = createFnRegistry();
    registry.registerAll([twice, collect]);

    /*
     * The positional array used to be built by mapping over `params`, which
     * truncated every dispatch to the declared arity: the excess never reached
     * `bindDirect`, so its `too many arguments` throw was unreachable from this
     * route and a `rest` parameter only ever saw its own slot.
     */
    expect(() => registry.dispatch('twice', makeList([makeDimension(2, 'px'), makeDimension(3)], ','), ctx))
      .toThrow('too many arguments');
    expect(registry.dispatch('collect', makeList([
      makeDimension(2, 'px'),
      makeDimension(3),
      makeDimension(4),
      makeDimension(5)
    ], ','), ctx)).toEqual(makeDimension(7, 'px'));
  });

  it('infers typed value and lazy-thunk body arguments from the parameter tuple', () => {
    expectTypeOf(twice).toBeFunction();
    expectTypeOf(twice).parameter(0).toEqualTypeOf<{ type: 'Dimension'; number: number; unit: string; bytes: string }>();
    expectTypeOf(lazyTwice).parameter(0).returns.toEqualTypeOf<Promise<{ type: 'Dimension'; number: number; unit: string; bytes: string }>>();
  });
});
