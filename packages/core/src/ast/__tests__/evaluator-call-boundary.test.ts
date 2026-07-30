import { describe, expect, it, vi } from 'vitest';
import { buildEvaluator } from '../evaluator.js';
import { createFnRegistry, defineFunction } from '../value-dispatch.js';
import { makeKeyword, makeList } from '../value-factory.js';

const args = makeList([makeKeyword('one'), makeKeyword('two')], ',');

describe('ValueEvaluator function-call boundary', () => {
  it('preserves an unresolved optional FunctionCall without callable dispatch', () => {
    const evaluator = buildEvaluator(createFnRegistry());

    expect(evaluator.call('css-fn', args, { unitMode: 'preserve' }))
      .toMatchObject({ bytes: 'css-fn(one, two)' });
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
    expect(evaluator.call('fails', args, { unitMode: 'preserve' }))
      .toMatchObject({ bytes: 'fails(one, two)' });
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

  it('dispatches a caller-resolved scoped function without consulting the legacy scope view', () => {
    const evaluator = buildEvaluator(createFnRegistry());
    const scoped = defineFunction('scoped', {
      params: [],
      body: () => makeKeyword('selected')
    });
    const scope = { lookup: vi.fn(() => {
      throw new Error('the direct function should bypass scope.lookup');
    }) };

    expect(evaluator.call('scoped', args, { unitMode: 'preserve' }, scope, undefined, scoped))
      .toMatchObject({ bytes: 'selected' });
    expect(scope.lookup).not.toHaveBeenCalled();
  });
});
