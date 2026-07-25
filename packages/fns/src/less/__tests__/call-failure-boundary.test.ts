import { describe, expect, it } from 'vitest';
import { buildEvaluator } from '@jesscss/core';
import { makeDimension, makeKeyword, makeList, type ValueObj } from '@jesscss/core/value';
import { makeLessRegistry } from '../registry.js';

const evaluator = buildEvaluator(makeLessRegistry());

describe('built-in call failures', () => {
  it('lets a resolved rgb() failure escape its implementation', () => {
    const registry = makeLessRegistry();
    const args = makeList([makeKeyword('not-a-color')], ',');

    expect(() => registry.dispatch('rgb', args, {
      modes: { unitMode: 'preserve' },
      stringify: value => value.bytes
    })).toThrow('Invalid arguments for rgb function');
  });

  it('centralizes resolved-call preservation and error policy at the evaluator boundary', () => {
    const args = makeList([makeKeyword('not-a-color')], ',');

    const preserved = evaluator.call('rgb', args, { unitMode: 'preserve' });
    expect(preserved).not.toBeInstanceOf(Promise);
    if (preserved instanceof Promise) {
      throw new Error('Expected preserved rgb() to resolve synchronously.');
    }
    expect(preserved.bytes).toBe('rgb(not-a-color)');

    expect(() => evaluator.call('rgb', args, {
      unitMode: 'preserve',
      functionMode: 'error'
    })).toThrow('Invalid arguments for rgb function');
  });

  it('returns Less min/max survivor calls as successful values, while strict input still escapes', () => {
    const registry = makeLessRegistry();
    const args = makeList([makeDimension(1, 'px'), makeDimension(1, 's')], ',');

    expect(registry.dispatch('min', args, {
      modes: { unitMode: 'preserve' },
      stringify: value => value.bytes
    }).bytes).toBe('min(1px, 1s)');

    expect(() => registry.dispatch('min', args, {
      modes: { unitMode: 'strict' },
      stringify: value => value.bytes
    })).toThrow('min() arguments have incompatible units');
  });

  it('reduces each compatible min/max unit group before producing CSS survivors', () => {
    const registry = makeLessRegistry();
    const ctx = { modes: { unitMode: 'preserve' as const }, stringify: (value: ValueObj) => value.bytes };

    const minResult = registry.dispatch('min', makeList([
      makeDimension(6, 'em'), makeDimension(5), makeDimension(4, 'ex'),
      makeDimension(3), makeDimension(2, 'pt'), makeDimension(1)
    ], ','), ctx);
    expect(minResult.bytes).toBe('min(1, 4ex, 2pt)');

    const maxResult = registry.dispatch('max', makeList([
      makeDimension(1, 'px'), makeDimension(2), makeDimension(3, 'em'),
      makeDimension(4), makeDimension(5, 'm'), makeDimension(6)
    ], ','), ctx);
    expect(maxResult.bytes).toBe('max(5m, 3em)');
  });

  it('does not let extract() or data-uri() manufacture their own fallback calls', () => {
    const registry = makeLessRegistry();
    const extractArgs = makeList([makeKeyword('one'), makeDimension(2)], ',');
    const emptyArgs = makeList([], ',');
    const context = {
      modes: { unitMode: 'preserve' as const },
      stringify: (value: ValueObj) => value.bytes
    };

    expect(() => registry.dispatch('extract', extractArgs, context)).toThrow('extract() index 2 out of range for length 1');
    expect(() => registry.dispatch('data-uri', emptyArgs, context)).toThrow('data-uri() requires a path');
    const extractResult = evaluator.call('extract', extractArgs, context.modes);
    const dataUriResult = evaluator.call('data-uri', emptyArgs, context.modes);
    if (extractResult instanceof Promise || dataUriResult instanceof Promise) {
      throw new Error('Expected preserved calls to resolve synchronously.');
    }
    expect(extractResult.bytes).toBe('extract(one, 2)');
    expect(dataUriResult.bytes).toBe('data-uri()');
  });

  it('keeps Less singleton extract semantics for a non-finite index through the registry', () => {
    const registry = makeLessRegistry();
    const result = registry.dispatch('extract', makeList([
      makeKeyword('only'), makeDimension(Number.POSITIVE_INFINITY)
    ], ','), {
      modes: { unitMode: 'preserve' },
      stringify: value => value.bytes
    });

    expect(result.bytes).toBe('only');
  });
});
