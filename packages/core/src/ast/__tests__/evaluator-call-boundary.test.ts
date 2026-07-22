import { describe, expect, it, vi } from 'vitest';
import { buildEvaluator } from '../evaluator.js';
import { createFnRegistry, defineFunction } from '../value-dispatch.js';
import { makeKeyword, makeList } from '../value-factory.js';

const args = makeList([makeKeyword('one'), makeKeyword('two')], ',');

describe('ValueEvaluator function-call boundary', () => {
  it('preserves an unresolved optional FunctionCall without treating it as a callable failure', () => {
    const evaluator = buildEvaluator(createFnRegistry());
    const onUnresolved = vi.fn();

    expect(evaluator.call('css-fn', args, { unitMode: 'preserve' }, null, undefined, onUnresolved))
      .toMatchObject({ bytes: 'css-fn(one, two)' });
    expect(onUnresolved).not.toHaveBeenCalled();
  });

  it('applies functionMode only after a registered callable rejects synchronously', () => {
    const registry = createFnRegistry();
    registry.register(defineFunction('fails', {
      params: [],
      body: () => {
        throw new RangeError('registered failure');
      }
    }));
    const evaluator = buildEvaluator(registry);
    const onUnresolved = vi.fn();

    expect(evaluator.call('fails', args, { unitMode: 'preserve' }, null, undefined, onUnresolved))
      .toMatchObject({ bytes: 'fails(one, two)' });
    expect(onUnresolved).toHaveBeenCalledWith(expect.objectContaining({ message: 'registered failure' }));
    expect(() => evaluator.call('fails', args, { unitMode: 'preserve', functionMode: 'error' }))
      .toThrow('registered failure');
  });

  it('uses the same policy for an async registered callable rejection', async () => {
    const registry = createFnRegistry();
    registry.register(defineFunction('async-fails', {
      params: [],
      body: async () => {
        throw new TypeError('async registered failure');
      }
    }));
    const evaluator = buildEvaluator(registry);

    await expect(Promise.resolve(evaluator.call('async-fails', args, { unitMode: 'preserve' })))
      .resolves.toMatchObject({ bytes: 'async-fails(one, two)' });
    await expect(Promise.resolve(evaluator.call('async-fails', args, { unitMode: 'preserve', functionMode: 'error' })))
      .rejects.toThrow('async registered failure');
  });
});
