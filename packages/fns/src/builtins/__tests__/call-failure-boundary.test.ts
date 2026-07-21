import { describe, expect, it } from 'vitest';
import { buildEvaluator } from '@jesscss/core';
import { makeDimension, makeKeyword, makeList } from '@jesscss/core/value';
import { makeBuiltinRegistry } from '../registry.js';

const evaluator = buildEvaluator(makeBuiltinRegistry());

describe('built-in call failures', () => {
  it('lets a resolved rgb() failure escape its implementation', () => {
    const registry = makeBuiltinRegistry();
    const args = makeList([makeKeyword('not-a-color')], ',');

    expect(() => registry.dispatch('rgb', args, {
      modes: { unitMode: 'preserve' },
      stringify: value => value.bytes,
    })).toThrow('Invalid arguments for rgb function');
  });

  it('centralizes resolved-call preservation and error policy at the evaluator boundary', () => {
    const args = makeList([makeKeyword('not-a-color')], ',');

    const preserved = evaluator.call('rgb', args, { unitMode: 'preserve' });
    expect(preserved).not.toBeInstanceOf(Promise);
    expect((preserved as { bytes: string }).bytes).toBe('rgb(not-a-color)');

    expect(() => evaluator.call('rgb', args, {
      unitMode: 'preserve',
      functionMode: 'error',
    })).toThrow('Invalid arguments for rgb function');
  });

  it('lets invalid min() input escape its implementation for that same boundary', () => {
    const registry = makeBuiltinRegistry();
    const args = makeList([makeDimension(1, 'px'), makeDimension(1, 's')], ',');

    expect(() => registry.dispatch('min', args, {
      modes: { unitMode: 'preserve' },
      stringify: value => value.bytes,
    })).toThrow('min() arguments have incompatible units');

    const preserved = evaluator.call('min', args, { unitMode: 'preserve' });
    expect((preserved as { bytes: string }).bytes).toBe('min(1px, 1s)');
  });

  it('does not let extract() or data-uri() manufacture their own fallback calls', () => {
    const registry = makeBuiltinRegistry();
    const extractArgs = makeList([makeKeyword('one'), makeDimension(2)], ',');
    const emptyArgs = makeList([], ',');
    const context = {
      modes: { unitMode: 'preserve' as const },
      stringify: (value: { bytes: string }) => value.bytes,
    };

    expect(() => registry.dispatch('extract', extractArgs, context)).toThrow('extract() index is out of range');
    expect(() => registry.dispatch('data-uri', emptyArgs, context)).toThrow('data-uri() requires a path');
    expect((evaluator.call('extract', extractArgs, context.modes) as { bytes: string }).bytes).toBe('extract(one, 2)');
    expect((evaluator.call('data-uri', emptyArgs, context.modes) as { bytes: string }).bytes).toBe('data-uri()');
  });
});
