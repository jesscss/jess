import { describe, expect, expectTypeOf, it } from 'vitest';
import { callNamed } from '../../call-named.js';
import { createFnRegistry, defineFunction, emitValue, makeDimension, type Dimension, type FnCtx } from '../../value.js';

function invoke(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== 'function') {
    throw new TypeError('Expected a callable value-domain function.');
  }
  return Reflect.apply(fn, undefined, args);
}

const ctx: FnCtx = {
  modes: { mathMode: 'parens-division', unitMode: 'preserve', functionMode: 'preserve' },
  stringify: emitValue
};

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
  it('is a plain function of the arguments and the context, also reached through the registry', () => {
    expect(typeof twice).toBe('function');
    expect(Object.prototype.hasOwnProperty.call(twice, 'params')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(twice, 'body')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(twice, 'options')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(twice, '_internal')).toBe(false);
    expect(twice.params).toMatchObject([{ name: 'value', type: 'Dimension' }]);
    expect(twice([makeDimension(2, 'px')], ctx)).toEqual({ type: 'Dimension', number: 4, unit: 'px', bytes: '4px' });
    const registry = createFnRegistry();
    registry.register(twice);
    expect(registry.dispatch('twice', [makeDimension(2, 'px')], ctx)).toEqual(makeDimension(4, 'px'));
    expect(() => invoke(twice, [{ value: makeDimension(2, 'px') }], ctx)).toThrow('must be a value node');
  });

  it('rejects a missing, an extra, a wrong-kind and a primitive argument', () => {
    expect(() => twice([], ctx)).toThrow('missing required argument value');
    expect(() => twice([makeDimension(2, 'px'), makeDimension(3)], ctx)).toThrow('too many');
    expect(() => invoke(twice, [{ type: 'Keyword', text: 'x', bytes: 'x' }], ctx)).toThrow('expected Dimension');
    expect(() => invoke(twice, [2], ctx)).toThrow('must be a value node');
  });

  it('hands a lazy parameter a thunk that checks the value when invoked', async () => {
    expect(skipLazy([makeDimension(3, 'px')], ctx)).toEqual(makeDimension(1));
    await expect(lazyTwice([makeDimension(3, 'px')], ctx)).resolves.toEqual({ type: 'Dimension', number: 6, unit: 'px', bytes: '6px' });
    expect(() => invoke(lazyTwice, [{ type: 'Keyword', text: 'no', bytes: 'no' }], ctx)).toThrow('expected Dimension');
  });

  it('binds named arguments through callNamed, with defaults and rest values', () => {
    expect(callNamed(twice, { value: makeDimension(2, 'px') }, ctx)).toEqual(makeDimension(4, 'px'));
    expect(() => invoke(callNamed, twice, {}, ctx)).toThrow('missing required argument value');
    expect(callNamed(collect, { value: makeDimension(2, 'px'), precision: makeDimension(3) }, ctx)).toEqual(makeDimension(5, 'px'));
    expect(callNamed(collect, { value: makeDimension(2, 'px'), rest: [makeDimension(4), makeDimension(5)] }, ctx)).toEqual(makeDimension(5, 'px'));
    expect(callNamed(collect, { value: makeDimension(2, 'px') }, ctx)).toEqual(makeDimension(3, 'px'));
  });

  it('dispatches unnamed positional specs without requiring record metadata', () => {
    expect(unnamedPositional([makeDimension(2, 'px')], ctx)).toEqual(makeDimension(4, 'px'));
    const registry = createFnRegistry();
    registry.register(unnamedPositional);
    expect(registry.dispatch('unnamed-positional', [makeDimension(2, 'px')], ctx)).toEqual(makeDimension(4, 'px'));
  });

  it('applies the arity check and feeds a rest parameter every trailing argument', () => {
    const registry = createFnRegistry();
    registry.registerAll([twice, collect]);

    /*
     * The positional array used to be built by mapping over `params`, which
     * truncated every dispatch to the declared arity: the excess never reached
     * `bindDirect`, so its `too many arguments` throw was unreachable and a
     * `rest` parameter only ever saw its own slot.
     */
    expect(() => registry.dispatch('twice', [makeDimension(2, 'px'), makeDimension(3)], ctx)).toThrow('too many arguments');
    expect(registry.dispatch('collect', [makeDimension(2, 'px'), makeDimension(3), makeDimension(4), makeDimension(5)], ctx)).toEqual(makeDimension(7, 'px'));
  });

  it('infers typed value and lazy-thunk body arguments from the parameter tuple', () => {
    expectTypeOf(twice).toBeFunction();
    expectTypeOf<Parameters<typeof callNamed<typeof twice.params>>[1]>().toEqualTypeOf<Readonly<{ value: Dimension }>>();
    expectTypeOf<Parameters<typeof callNamed<typeof lazyTwice.params>>[1]>().toEqualTypeOf<Readonly<{ value: Dimension }>>();
  });
});
